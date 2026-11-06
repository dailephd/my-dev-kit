import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { isInsideRoot } from '../io/pathUtils.js'
import { readSourceAuditEvidence } from '../lookup/readSourceAuditEvidence.js'
import { API_RELATIONSHIP_FILENAME, API_RELATIONSHIP_SCHEMA_VERSION, validateApiRelationshipEvidence, type ApiRelationshipEvidence } from '../symbol-index/apiRelationshipEvidenceTypes.js'
import type { SourceAuditEvidenceArtifact } from '../symbol-index/auditEvidenceTypes.js'
import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { SymbolIndex } from '../symbol-index/types.js'
import type { DataModelArtifact } from '../data-model/types.js'
import type { FrontendSemanticArtifact } from '../frontend/frontendTypes.js'
import type { FrontendReachabilityArtifact } from '../frontend-reachability/types.js'
import { loadClassificationArtifact } from '../classification/resolveClassificationForCommands.js'
import type { ClassificationArtifact } from '../classification/classificationTypes.js'
import { readIndexManifest, type ResolvedIndexManifest } from '../indexing/readIndexManifest.js'
import { readRequiredJson, validateStructuralArtifact } from '../indexing/loadIndexArtifacts.js'

/**
 * One side (`--before` or `--after`) of a graph-diff comparison.
 *
 * `manifest.json` and `code-graph.json` are required — missing or malformed
 * either throws (via `readIndexManifest`/`readRequiredJson`, the same
 * helpers `lookup`/`slice`/`view` already use for clear, consistent error
 * messages). Every other artifact is optional: absent or unreadable simply
 * yields `null`, never a thrown error, so graph-diff degrades gracefully
 * across indexes built with different flags/versions.
 */
export interface GraphDiffArtifacts {
  apiRelationship: GraphDiffApiSnapshot
  resolved: ResolvedIndexManifest
  codeGraph: CodeGraph
  symbolIndex: SymbolIndex | null
  classification: ClassificationArtifact | null
  dataModel: DataModelArtifact | null
  frontendSemantic: FrontendSemanticArtifact | null
  frontendReachability: FrontendReachabilityArtifact | null
}

export function loadGraphDiffArtifacts(indexDir: string): GraphDiffArtifacts {
  const resolved = readIndexManifest(indexDir)
  const codeGraph = readRequiredJson<CodeGraph>(resolved.artifactPaths.codeGraph, 'code graph')
  const symbolIndex = readOptionalJson<SymbolIndex>(resolved.artifactPaths.symbolIndex, (value) => validateStructuralArtifact(value, 'symbol index'))

  return {
    apiRelationship: loadApiSnapshot(resolved),
    resolved,
    codeGraph,
    symbolIndex,
    classification: loadClassificationArtifact(indexDir, resolved.manifest),
    dataModel: readOptionalJson<DataModelArtifact>(resolved.semanticArtifactPaths.dataModel),
    frontendSemantic: readOptionalJson<FrontendSemanticArtifact>(resolved.semanticArtifactPaths.frontendSemantic),
    frontendReachability: readOptionalJson<FrontendReachabilityArtifact>(
      resolved.semanticArtifactPaths.frontendReachability ?? null
    ),
  }
}

/** Persisted snapshot authority only: historical source bytes need not exist on disk. */
export interface GraphDiffApiSnapshot {
  registered: boolean
  artifact: ApiRelationshipEvidence | null
  audit: SourceAuditEvidenceArtifact | null
  projectRoot: string
  warnings: string[]
}

function loadApiSnapshot(resolved: ResolvedIndexManifest): GraphDiffApiSnapshot {
  const ref = resolved.manifest.apiRelationshipEvidence
  const result: GraphDiffApiSnapshot = { registered: ref !== undefined && ref !== null, artifact: null, audit: null, projectRoot: resolved.manifest.projectRoot, warnings: [] }
  if (!result.registered) return result
  try {
    if (resolved.manifest.version !== '1.0.0' || typeof resolved.manifest.projectRoot !== 'string' || !path.isAbsolute(resolved.manifest.projectRoot)) throw new Error('manifest-identity-invalid')
    if (!ref || ref.path !== API_RELATIONSHIP_FILENAME || ref.schemaVersion !== API_RELATIONSHIP_SCHEMA_VERSION) throw new Error('registration-invalid')
    const dir = fs.realpathSync(resolved.indexDir)
    const file = fs.realpathSync(path.join(dir, ref.path))
    if (!isInsideRoot(dir, file) || !fs.statSync(file).isFile()) throw new Error('artifact-containment-invalid')
    const bytes = fs.readFileSync(file)
    if (createHash('sha256').update(bytes).digest('hex') !== ref.sha256) throw new Error('artifact-checksum-invalid')
    const parsed: unknown = JSON.parse(bytes.toString('utf8'))
    const validation = validateApiRelationshipEvidence(parsed)
    if (!validation.valid) throw new Error(`artifact-invalid:${validation.errors.join(',')}`)
    const artifact = parsed as ApiRelationshipEvidence
    const audit = readSourceAuditEvidence(resolved.indexDir)
    const sorted = (v: unknown[]) => JSON.stringify([...v].sort())
    if (ref.snapshotId !== artifact.sourceSnapshot.snapshotId || audit.source.snapshotId !== ref.snapshotId || audit.source.selectionFingerprint !== artifact.sourceSnapshot.selectionFingerprint || sorted(audit.files.map(f => [f.path, f.contentSha256])) !== sorted(artifact.sourceSnapshot.files.map(f => [f.path, f.contentSha256])) || sorted(audit.source.sourceRoots) !== sorted(artifact.selection.sourceRoots) || sorted(audit.source.excludes) !== sorted(artifact.selection.excludes)) throw new Error('snapshot-registration-inconsistent')
    // The persisted relationship validator is the contract authority. Additional
    // consumer checks cover metadata used by this comparison, without a schema change.
    if (artifact.nodes.some(n => typeof n.id !== 'string' || !n.id || n.symbolId !== null && typeof n.symbolId !== 'string' || n.value !== null && typeof n.value !== 'string') || artifact.relationships.some(r => r.path !== null && typeof r.path !== 'string' || !Array.isArray(r.limitations) || r.limitations.some(l => typeof l !== 'string')) || artifact.unresolved.some(u => typeof u.reason !== 'string' || !Array.isArray(u.missingEvidence) || u.missingEvidence.some(m => typeof m !== 'string')) || artifact.limitations.some(l => typeof l.code !== 'string' || typeof l.scope !== 'string')) throw new Error('impact-record-structure-invalid')
    result.artifact = artifact
    result.audit = audit
  } catch (error) {
    // Never leak filesystem errors/absolute paths into this bounded evidence section.
    const code = error instanceof Error && /^(manifest-identity-invalid|registration-invalid|artifact-containment-invalid|artifact-checksum-invalid|artifact-invalid:[a-z,-]+|snapshot-registration-inconsistent|impact-record-structure-invalid)$/.test(error.message) ? error.message : 'persisted-evidence-unavailable-or-invalid'
    result.warnings.push(code)
  }
  return result
}

function readOptionalJson<T>(filePath: string | null | undefined, validate?: (value: unknown) => void): T | null {
  if (!filePath) return null
  let value: unknown
  try {
    if (!fs.existsSync(filePath)) return null
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
  validate?.(value)
  return value as T
}
