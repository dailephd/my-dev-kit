import * as fs from 'node:fs'
import * as path from 'node:path'
import { createDefaultRegistry } from '../languages/registry.js'
import { PythonAdapter } from '../languages/python/adapter.js'
import { TypeScriptAdapter, enumerateJsTsCandidatePaths } from '../languages/typescript/adapter.js'
import type { SourceAuditEvidenceArtifact, SourceAuditFact, SourceAuditFile } from '../symbol-index/auditEvidenceTypes.js'
import { SOURCE_AUDIT_SCHEMA_VERSION } from '../symbol-index/auditEvidenceTypes.js'
import { assertSourceAuditFileFresh, readSourceAuditEvidence, SourceAuditEvidenceError } from './readSourceAuditEvidence.js'
import { ensureInsideProjectRoot, UnsafeSourceError } from './getSourceSlice.js'

/**
 * Filesystem/source-selection evidence for one recorded import fact. It is NOT a claim that the import
 * binds semantically; the fact's own importResolution and targetPaths keep their meanings.
 */
export interface AuditImportTargetProof {
  schemaVersion: '1.0.0'
  mode: 'audit-import-target'
  snapshotId: string
  importFactId: string
  originFile: string
  sourceSpecifier: string
  status: 'present' | 'proven-missing' | 'outside-selected-roots' | 'indeterminate'
  candidatePaths: string[]
  selectionComplete: boolean
  reasonCode: string
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function findImportFact(artifact: SourceAuditEvidenceArtifact, factId: string): { file: SourceAuditFile; fact: SourceAuditFact } {
  for (const file of artifact.files) {
    const fact = file.facts.find((candidate) => candidate.id === factId)
    if (!fact) continue
    if (fact.kind !== 'import') {
      throw new SourceAuditEvidenceError('AUDIT_FACT_NOT_IMPORT', `Fact "${factId}" is a ${fact.kind} fact, not an import fact.`)
    }
    if (fact.span.path !== file.path) {
      throw new SourceAuditEvidenceError('AUDIT_EVIDENCE_INVALID', `Import fact "${factId}" span path does not match its recorded file.`)
    }
    return { file, fact }
  }
  throw new SourceAuditEvidenceError('AUDIT_FACT_NOT_FOUND', `No source-audit fact with id "${factId}" is recorded in this index.`)
}

function insideSelectedRoots(roots: readonly string[], candidate: string): boolean {
  return roots.some((root) => root === '.' || candidate === root || candidate.startsWith(`${root}/`))
}

/** True when the candidate is lexically inside the project root; ".." prefixed paths are never followed. */
function insideProjectRoot(candidate: string): boolean {
  return candidate !== '' && candidate !== '..' && !candidate.startsWith('../') && !candidate.startsWith('/') && !/^[A-Za-z]:/.test(candidate)
}

type ProbeResult = 'absent' | 'exists' | 'unknown'

/** Read-only existence probe of one already-enumerated, root-contained candidate; never reads content. */
function probeCandidate(projectRoot: string, candidate: string): ProbeResult {
  try {
    fs.lstatSync(path.resolve(projectRoot, candidate))
    return 'exists'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'absent' : 'unknown'
  }
}

/**
 * Decides a complete, enumerated candidate set when no candidate is a selected file. `proven-missing`
 * requires: every candidate inside the project and the selected roots, a complete selection, and no
 * candidate present on disk (a present-but-unselected candidate is excluded or newer than the index).
 */
function classifyAbsentCandidates(
  projectRoot: string,
  roots: readonly string[],
  candidates: readonly string[],
  selectionComplete: boolean,
): { status: AuditImportTargetProof['status']; reasonCode: string } {
  if (candidates.some((candidate) => !insideSelectedRoots(roots, candidate))) {
    return { status: 'outside-selected-roots', reasonCode: 'CANDIDATE_OUTSIDE_SELECTED_ROOTS' }
  }
  if (!selectionComplete) return { status: 'indeterminate', reasonCode: 'SELECTION_INCOMPLETE' }
  const probes = candidates.map((candidate) => probeCandidate(projectRoot, candidate))
  if (probes.includes('unknown')) return { status: 'indeterminate', reasonCode: 'CANDIDATE_PROBE_FAILED' }
  if (probes.includes('exists')) return { status: 'indeterminate', reasonCode: 'CANDIDATE_EXISTS_BUT_NOT_SELECTED' }
  return { status: 'proven-missing', reasonCode: 'ALL_CANDIDATES_ABSENT_IN_COMPLETE_SELECTION' }
}

/**
 * Read-only existence proof for one indexed import fact. Uses the identity-verified source-audit artifact,
 * the existing language resolvers and the recorded selected inventory; it never reparses source, rebuilds
 * the index or writes anything. Unresolved is never translated into missing without a complete enumerated
 * candidate set in a complete selection.
 */
export function resolveAuditImportTarget(indexDir: string, importFactId: string): AuditImportTargetProof {
  const artifact = readSourceAuditEvidence(indexDir)
  const { file, fact } = findImportFact(artifact, importFactId)
  // The origin file must still be the indexed one before any conclusion is drawn from its import.
  assertSourceAuditFileFresh(artifact, file)

  const projectRoot = artifact.source.projectRoot
  const roots = artifact.source.sourceRoots
  const selectionComplete = artifact.coverage.inventoryComplete && artifact.coverage.exclusionsAreExplicit
  const inventory = artifact.files.map((entry) => entry.path).sort(compareText)
  const inventorySet = new Set(inventory)
  const specifier = fact.sourceSpecifier

  const proof = (status: AuditImportTargetProof['status'], candidatePaths: readonly string[], reasonCode: string): AuditImportTargetProof => ({
    schemaVersion: SOURCE_AUDIT_SCHEMA_VERSION,
    mode: 'audit-import-target',
    snapshotId: artifact.source.snapshotId,
    importFactId,
    originFile: file.path,
    sourceSpecifier: specifier ?? '',
    status,
    candidatePaths: [...new Set(candidatePaths)].sort(compareText),
    selectionComplete,
    reasonCode,
  })

  if (!specifier) return proof('indeterminate', [], 'NO_STATIC_SPECIFIER')

  const registry = createDefaultRegistry(projectRoot)
  const adapter = registry.adapterForFile(file.path)
  if (!adapter) return proof('indeterminate', [], 'UNSUPPORTED_LANGUAGE_RESOLUTION')

  // A present candidate must still be the indexed file; a vanished or replaced one is stale evidence.
  const confirmPresent = (paths: readonly string[]): void => {
    for (const candidate of paths) {
      const record = artifact.files.find((entry) => entry.path === candidate)
      if (record) assertSourceAuditFileFresh(artifact, record)
    }
  }

  let enumerated: string[] | null = null
  let existing: string[] = []
  let notEnumerableReason = 'UNSUPPORTED_LANGUAGE_RESOLUTION'

  try {
    if (adapter instanceof TypeScriptAdapter) {
      existing = adapter.resolveCandidates(specifier, file.path, inventory)
      enumerated = enumerateJsTsCandidatePaths(specifier, file.path)
      notEnumerableReason = specifier.startsWith('.') ? 'UNSUPPORTED_SPECIFIER_SHAPE' : 'EXTERNAL_OR_CONFIGURED_SPECIFIER'
    } else if (adapter instanceof PythonAdapter) {
      existing = adapter.resolveAuditCandidates(specifier, fact.importedNames ?? [], file.path, inventory)
      enumerated = adapter.enumerateAuditCandidatePaths(specifier, file.path)
      notEnumerableReason = 'PYTHON_CANDIDATES_NOT_ENUMERABLE'
    } else {
      // Java, Kotlin and Rust resolvers return at most one existing selected file and cannot enumerate
      // candidates (source sets, classpath and nested declarations are not modeled), so absence is unprovable.
      const target = adapter.resolveImportToFile(specifier, file.path, inventory)
      existing = target ? [target] : []
      notEnumerableReason = file.language === 'rust' ? 'RUST_CANDIDATES_NOT_ENUMERABLE' : 'JVM_CANDIDATES_NOT_ENUMERABLE'
    }
  } catch (error) {
    if (error instanceof SourceAuditEvidenceError || error instanceof UnsafeSourceError) throw error
    return proof('indeterminate', [], 'RESOLVER_FAILED')
  }

  existing = existing.filter((candidate) => inventorySet.has(candidate))
  if (existing.length > 0) {
    confirmPresent(existing)
    return proof('present', enumerated ?? existing, existing.length === 1 ? 'TARGET_IN_SELECTED_INVENTORY' : 'MULTIPLE_TARGETS_IN_SELECTED_INVENTORY')
  }
  if (enumerated === null) return proof('indeterminate', [], notEnumerableReason)

  if (enumerated.some((candidate) => !insideProjectRoot(candidate))) {
    // A path escaping the target root is neither followed nor listed.
    return proof('indeterminate', enumerated.filter(insideProjectRoot), 'CANDIDATE_ESCAPES_PROJECT_ROOT')
  }
  // Defense in depth: the lexical candidate must also resolve inside the project root physically.
  try {
    for (const candidate of enumerated) ensureInsideProjectRoot(projectRoot, candidate)
  } catch {
    return proof('indeterminate', enumerated, 'CANDIDATE_ESCAPES_PROJECT_ROOT')
  }
  const decision = classifyAbsentCandidates(projectRoot, roots, enumerated, selectionComplete)
  return proof(decision.status, enumerated, decision.reasonCode)
}
