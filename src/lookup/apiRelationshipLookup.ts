import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { readIndexManifest } from '../indexing/readIndexManifest.js'
import { isInsideRoot } from '../io/pathUtils.js'
import { readSourceAuditEvidence, assertSourceAuditFileFresh } from './readSourceAuditEvidence.js'
import {
  API_RELATIONSHIP_FILENAME, API_RELATIONSHIP_SCHEMA_VERSION, API_RELATIONSHIP_KINDS,
  isApiEvidencePath, validateApiRelationshipEvidence,
  type ApiRelationshipEvidence, type ApiRelationshipKind,
} from '../symbol-index/apiRelationshipEvidenceTypes.js'

export interface ApiRelationshipQuery {
  sourceNodeId?: string
  targetNodeId?: string
  kind?: ApiRelationshipKind
  files?: readonly string[]
  maxResults?: number
}

/** Only the manifest-selected artifact and inherited selected-source freshness authority are read. */
export function readApiRelationshipEvidence(indexDir: string): ApiRelationshipEvidence {
  const resolved = readIndexManifest(indexDir)
  const ref = resolved.manifest.apiRelationshipEvidence
  if (!ref) throw new Error('API_RELATIONSHIP_EVIDENCE_UNAVAILABLE')
  if (ref.path !== API_RELATIONSHIP_FILENAME || ref.schemaVersion !== API_RELATIONSHIP_SCHEMA_VERSION) throw new Error('API_RELATIONSHIP_EVIDENCE_INVALID')
  const physicalDir = fs.realpathSync(resolved.indexDir)
  const artifactPath = fs.realpathSync(path.join(physicalDir, ref.path))
  if (!isInsideRoot(physicalDir, artifactPath) || !fs.statSync(artifactPath).isFile()) throw new Error('API_RELATIONSHIP_EVIDENCE_INVALID')
  const bytes = fs.readFileSync(artifactPath)
  if (createHash('sha256').update(bytes).digest('hex') !== ref.sha256) throw new Error('API_RELATIONSHIP_EVIDENCE_INVALID')
  const parsed: unknown = JSON.parse(bytes.toString('utf8'))
  if (!validateApiRelationshipEvidence(parsed).valid) throw new Error('API_RELATIONSHIP_EVIDENCE_INVALID')
  const artifact = parsed as ApiRelationshipEvidence
  const audit = readSourceAuditEvidence(indexDir)
  if (ref.snapshotId !== artifact.sourceSnapshot.snapshotId || audit.source.snapshotId !== ref.snapshotId || audit.source.selectionFingerprint !== artifact.sourceSnapshot.selectionFingerprint || JSON.stringify(audit.files.map(f => [f.path, f.contentSha256]).sort()) !== JSON.stringify(artifact.sourceSnapshot.files.map(f => [f.path, f.contentSha256]).sort())) throw new Error('STALE_API_RELATIONSHIP_EVIDENCE')
  // Hash selected bytes through the existing authenticated source owner, never user-supplied query paths.
  for (const file of audit.files) assertSourceAuditFileFresh(audit, file)
  return artifact
}

/** Pure bounded query: no filesystem access and no source-text exposure. */
export function apiRelationshipLookup(artifact: ApiRelationshipEvidence, query: ApiRelationshipQuery = {}) {
  if (!validateApiRelationshipEvidence(artifact).valid) throw new Error('API_RELATIONSHIP_EVIDENCE_INVALID')
  const max = query.maxResults ?? 64
  if (!Number.isInteger(max) || max < 1 || max > 256) throw new Error('INVALID_API_RELATIONSHIP_LIMIT')
  if (query.kind !== undefined && !API_RELATIONSHIP_KINDS.includes(query.kind)) throw new Error('INVALID_API_RELATIONSHIP_KIND')
  if (query.files && (query.files.length > 64 || query.files.some(f => !isApiEvidencePath(f)))) throw new Error('INVALID_API_RELATIONSHIP_FILES')
  const nodes = new Map(artifact.nodes.map(n => [n.id, n]))
  const files = query.files ? new Set(query.files) : null
  const limitations = [...artifact.limitations]
  for (const [label, id] of [['source', query.sourceNodeId], ['target', query.targetNodeId]] as const) if (id !== undefined && !nodes.has(id)) limitations.push({ code: `${label}-node-not-found`, scope: id })
  for (const file of files ?? []) if (!artifact.sourceSnapshot.files.some(f => f.path === file)) limitations.push({ code: 'file-outside-selection', scope: file })
  const matches = artifact.relationships.filter(r => (query.sourceNodeId === undefined || r.source === query.sourceNodeId) && (query.targetNodeId === undefined || r.target === query.targetNodeId) && (query.kind === undefined || r.kind === query.kind) && (!files || files.has(nodes.get(r.source)!.file) || r.target !== null && files.has(nodes.get(r.target)!.file) || r.witnesses.some(w => files.has(w.span.path))))
  const unknown = artifact.unresolved.filter(u => (query.sourceNodeId === undefined || u.source === query.sourceNodeId) && (query.targetNodeId === undefined || u.candidates.includes(query.targetNodeId)) && (query.kind === undefined || u.family === query.kind) && (!files || files.has(u.location.path)))
  const relationships = matches.slice(0, max)
  const unresolved = unknown.slice(0, max - relationships.length)
  const resultTruncated = relationships.length + unresolved.length < matches.length + unknown.length
  const candidateTruncated = relationships.some(r => r.limitations.includes('candidate-limit-truncated')) || unresolved.some(u => u.missingEvidence.includes('candidate-limit-truncated'))
  const relevantFiles = new Set(files ?? [])
  for (const id of [query.sourceNodeId, query.targetNodeId]) if (id && nodes.has(id)) relevantFiles.add(nodes.get(id)!.file)
  for (const r of relationships) for (const w of r.witnesses) relevantFiles.add(w.span.path)
  for (const u of unresolved) relevantFiles.add(u.location.path)
  const capabilities = artifact.capabilities.filter(c => relevantFiles.has(c.file))
  const relevantLimitations = limitations.filter(l => l.scope === 'artifact' || l.scope === 'query' || relevantFiles.has(l.scope) || l.code.endsWith('node-not-found') || l.code === 'file-outside-selection')
  const metadataTruncated = capabilities.length > 256 || relevantLimitations.length > 256
  const boundedLimitations = relevantLimitations.slice(0, 256)
  if (resultTruncated) boundedLimitations.push({ code: 'result-limit-truncated', scope: 'query' })
  if (candidateTruncated) boundedLimitations.push({ code: 'candidate-limit-truncated', scope: 'query' })
  if (metadataTruncated) boundedLimitations.push({ code: 'metadata-limit-truncated', scope: 'query' })
  const truncated = resultTruncated || candidateTruncated || metadataTruncated
  const capabilitySummary = { complete: 0, unsupported: 0, failed: 0 }
  for (const c of artifact.capabilities) capabilitySummary[c.status] += 1
  return {
    artifactKind: artifact.artifactKind, schemaVersion: artifact.schemaVersion,
    artifactIdentity: artifact.integrity.digest,
    sourceSnapshot: { snapshotId: artifact.sourceSnapshot.snapshotId, selectionFingerprint: artifact.sourceSnapshot.selectionFingerprint },
    selection: { complete: artifact.selection.complete, production: artifact.selection.production, sourceRootCount: artifact.selection.sourceRoots.length, excludeRuleCount: artifact.selection.excludes.length, selectedFileCount: artifact.sourceSnapshot.files.length },
    capabilities: capabilities.slice(0, 256), capabilitySummary,
    relationships, unresolved, limitations: boundedLimitations, truncated, metadataTruncated,
    totalMatches: matches.length + unknown.length,
    complete: artifact.selection.complete && artifact.selection.production === 'complete' && !truncated && unknown.length === 0 && !limitations.some(l => l.code === 'source-node-not-found' || l.code === 'target-node-not-found' || l.code === 'file-outside-selection'),
  }
}
