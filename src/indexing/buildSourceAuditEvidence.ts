/**
 * v1.15.0 Batch 1: pure in-memory projection of discovery and index evidence
 * into the Batch 0 source-audit evidence contract.
 *
 * This function reads no files, walks no directories, runs no parsers, hashes
 * nothing and writes nothing. Every file-derived value comes from the supplied
 * discovery ledger, symbol index and content-hash map. Batch 1 extracts no new
 * language facts, so no capability is ever reported `complete` and every
 * record carries an empty `facts` array; absence of facts is never presented
 * as completeness. The artifact is not persisted or registered here.
 */

import { createHash } from 'node:crypto'
import {
  DEFAULT_FILE_EXCLUDE_PATTERNS,
  DEFAULT_IGNORED_DIRECTORY_NAMES,
  DEFAULT_IGNORED_DIRECTORY_PREFIXES,
  languageNameForPath,
  type AuditSelectedFile,
  type SourceDiscoveryResult,
} from './discoverSourceFiles.js'
import { toForwardSlash } from '../io/pathUtils.js'
import {
  SOURCE_AUDIT_ARTIFACT_KIND,
  SOURCE_AUDIT_CAPABILITIES,
  SOURCE_AUDIT_SCHEMA_VERSION,
  type SourceAuditCapability,
  type SourceAuditCapabilityStatus,
  type SourceAuditEvidenceArtifact,
  type SourceAuditFile,
  type SourceAuditRole,
} from '../symbol-index/auditEvidenceTypes.js'
import { AUDIT_PRODUCER_CAPABILITIES, BATCH2_AUDIT_CAPABILITIES } from '../symbol-index/auditObservations.js'
import type { FileSummary, SymbolIndex } from '../symbol-index/types.js'
import { validateSourceAuditEvidence } from '../symbol-index/validateAuditEvidence.js'
import type { SourceAuditEvidenceReference } from './manifestTypes.js'

/** Source extractor contract revision folded into the snapshot identity. */
export const SOURCE_AUDIT_EXTRACTOR_CONTRACT_REVISION = 'source-audit-v1.5.0'

export interface BuildSourceAuditEvidenceInput {
  projectRoot: string
  sourceRoots: readonly string[]
  excludes: readonly string[]
  discovery: SourceDiscoveryResult
  symbolIndex: SymbolIndex
  /** Lowercase SHA-256 of the exact bytes each file's evidence was produced from, keyed by relative path. */
  fileHashes: ReadonlyMap<string, string>
  producerVersion: string
}

export interface BuildSourceAuditEvidenceResult {
  artifact: SourceAuditEvidenceArtifact
  /** Deterministically ordered reasons explaining every false completeness flag. */
  incompleteReasons: string[]
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const TEST_DIRECTORY_SEGMENTS = new Set(['__tests__', 'tests', 'test'])
const FIXTURE_SEGMENTS = new Set(['fixtures', 'fixture', '__fixtures__', 'testdata', '__mocks__'])
const SCRIPT_SEGMENTS = new Set(['scripts'])
const API_CLIENT_LANGUAGES = new Set(['typescript', 'javascript'])
const SELECTION_STATUS_RANK = { supported: 0, unsupported: 1, unreadable: 2 } as const

function sha256OfJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function normalizeRule(value: string): string {
  return toForwardSlash(value.trim()).replace(/^(\.\/)+/, '').replace(/^\/+|\/+$/g, '')
}

function normalizeRoot(value: string): string {
  const normalized = normalizeRule(value)
  return normalized === '' ? '.' : normalized
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText)
}

function isCanonicalAuditPath(value: string): boolean {
  if (value.length === 0 || value.includes('\\') || value.startsWith('/') || value.endsWith('/')) return false
  if (/^[A-Za-z]:/.test(value)) return false
  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function isUnderRoot(relPath: string, root: string): boolean {
  return root !== '.' && (relPath === root || relPath.startsWith(`${root}/`))
}

function isTestFileName(basename: string): boolean {
  const lower = basename.toLowerCase()
  return (
    /\.(test|spec)\.[a-z0-9]+$/.test(lower) ||
    /^test_.+\.py$/.test(lower) ||
    /_test\.(py|rs)$/.test(lower) ||
    (/test\.(java|kt)$/.test(lower) && /^[A-Z]/.test(basename))
  )
}

/**
 * Conservative role evidence. Explicit test names and recognized test
 * directories are `test`; recognized script directories are `script`; paths
 * under a selected non-root source root or a top-level `src` are `source`;
 * anything else, including fixture content without a proven role, is `unknown`.
 */
function classifyRole(relPath: string, language: string, supported: boolean, roots: readonly string[]): SourceAuditRole {
  const segments = relPath.split('/')
  const basename = segments[segments.length - 1] as string
  const directories = segments.slice(0, -1).map((segment) => segment.toLowerCase())
  if (isTestFileName(basename)) return 'test'
  if (!supported || language === 'unsupported') return 'unknown'
  if (directories.some((segment) => FIXTURE_SEGMENTS.has(segment))) return 'unknown'
  if (directories.some((segment) => TEST_DIRECTORY_SEGMENTS.has(segment))) return 'test'
  if (directories.some((segment) => SCRIPT_SEGMENTS.has(segment))) return 'script'
  if (roots.some((root) => isUnderRoot(relPath, root)) || directories[0] === 'src') return 'source'
  return 'unknown'
}

function uniformCapabilities(status: SourceAuditCapabilityStatus): Record<SourceAuditCapability, SourceAuditCapabilityStatus> {
  const capabilities = {} as Record<SourceAuditCapability, SourceAuditCapabilityStatus>
  for (const capability of SOURCE_AUDIT_CAPABILITIES) capabilities[capability] = status
  return capabilities
}

const ANALYZER_BY_LANGUAGE: Readonly<Record<string, string>> = {
  typescript: 'typescript-ast',
  javascript: 'typescript-ast',
  python: 'python-ast',
  rust: 'rust-tree-sitter',
  java: 'java-lexical',
  kotlin: 'kotlin-lexical',
}

/** Extension-based language for records without an index entry; covers the extensions the adapters own. */
function auditLanguageForPath(relPath: string): string {
  const lower = relPath.toLowerCase()
  if (lower.endsWith('.cjs') || lower.endsWith('.mjs')) return 'javascript'
  if (lower.endsWith('.mts') || lower.endsWith('.cts')) return 'typescript'
  if (lower.endsWith('.kts')) return 'kotlin'
  return languageNameForPath(relPath)
}

/** Applicable capabilities are `unsupported` in Batch 1 (nothing extracted); genuinely inapplicable ones are `not-applicable`. */
function indexedFileCapabilities(role: SourceAuditRole, language: string): Record<SourceAuditCapability, SourceAuditCapabilityStatus> {
  const capabilities = uniformCapabilities('unsupported')
  if (!API_CLIENT_LANGUAGES.has(language)) capabilities['api-client-calls'] = 'not-applicable'
  if (role === 'source' || role === 'script') {
    capabilities['test-observations'] = 'not-applicable'
    capabilities['fixture-references'] = 'not-applicable'
  }
  return capabilities
}

interface SelectedEntry {
  relPath: string
  sizeBytes: number | null
  selectionStatus: AuditSelectedFile['selectionStatus']
  contentSha256?: string
}

/** Deduplicates by canonical path; conflicting identities keep the most conservative status and flag the ledger. */
function dedupeSelected(selected: readonly AuditSelectedFile[], reasons: Set<string>): SelectedEntry[] {
  const byPath = new Map<string, SelectedEntry>()
  for (const file of selected) {
    const relPath = toForwardSlash(file.relPath)
    const existing = byPath.get(relPath)
    if (!existing) {
      byPath.set(relPath, { relPath, sizeBytes: file.sizeBytes, selectionStatus: file.selectionStatus, contentSha256: file.contentSha256 })
      continue
    }
    if (existing.selectionStatus === file.selectionStatus && existing.sizeBytes === file.sizeBytes && existing.contentSha256 === file.contentSha256) continue
    reasons.add('conflicting-selection-identity')
    if (SELECTION_STATUS_RANK[file.selectionStatus] > SELECTION_STATUS_RANK[existing.selectionStatus]) {
      existing.selectionStatus = file.selectionStatus
    }
    if (existing.sizeBytes !== file.sizeBytes) existing.sizeBytes = null
    if (existing.contentSha256 !== file.contentSha256) existing.contentSha256 = undefined
  }
  return [...byPath.values()].sort((a, b) => compareText(a.relPath, b.relPath))
}

interface FileProjection {
  record: SourceAuditFile
  unreadable: boolean
  identityGap: boolean
}

function projectFile(
  entry: SelectedEntry,
  summary: FileSummary | undefined,
  hash: string | undefined,
  roots: readonly string[],
): FileProjection {
  const validHash = hash !== undefined && SHA256_PATTERN.test(hash) ? hash : null
  const invalidHash = hash !== undefined && validHash === null
  const base = { path: entry.relPath, sizeBytes: entry.sizeBytes, contentSha256: validHash }

  if (entry.selectionStatus === 'unsupported') {
    const record: SourceAuditFile = {
      ...base,
      language: 'unsupported',
      role: classifyRole(entry.relPath, 'unsupported', false, roots),
      status: 'unsupported',
      lineCount: null,
      analyzerId: null,
      capabilities: uniformCapabilities('unsupported'),
      facts: [],
      warnings: [],
      diagnostics: invalidHash
        ? [{ code: 'invalid-content-hash', message: 'Supplied content hash is not a lowercase SHA-256 hex string.', span: null }]
        : [],
    }
    return { record, unreadable: false, identityGap: false }
  }

  const extensionLanguage = auditLanguageForPath(entry.relPath)
  const knownLanguage = extensionLanguage === 'unknown' ? 'unsupported' : extensionLanguage

  if (entry.selectionStatus === 'unreadable') {
    const record: SourceAuditFile = {
      path: entry.relPath,
      language: knownLanguage,
      role: classifyRole(entry.relPath, knownLanguage, knownLanguage !== 'unsupported', roots),
      status: 'failed',
      contentSha256: null,
      sizeBytes: null,
      lineCount: null,
      analyzerId: null,
      capabilities: uniformCapabilities('failed'),
      facts: [],
      warnings: [],
      diagnostics: [{ code: 'selection-unreadable', message: 'Selected file could not be read or stat-ed during discovery.', span: null }],
    }
    return { record, unreadable: true, identityGap: true }
  }

  // Supported file selected for indexing.
  if (!summary) {
    const unreadable = validHash === null
    const record: SourceAuditFile = {
      ...base,
      language: knownLanguage,
      role: classifyRole(entry.relPath, knownLanguage, true, roots),
      status: 'failed',
      lineCount: null,
      analyzerId: null,
      capabilities: uniformCapabilities('failed'),
      facts: [],
      warnings: [],
      diagnostics: [
        unreadable
          ? { code: 'content-unreadable', message: 'No index entry and no content identity exist for this selected file.', span: null }
          : { code: 'missing-file-summary', message: 'No index entry exists for this selected file.', span: null },
      ],
    }
    return { record, unreadable, identityGap: true }
  }

  const role = classifyRole(entry.relPath, summary.language, true, roots)
  const warnings = [...(summary.warnings ?? [])]
  const diagnostics: SourceAuditFile['diagnostics'] = []
  if (validHash === null) {
    diagnostics.push({
      code: invalidHash ? 'invalid-content-hash' : 'content-identity-unavailable',
      message: 'Content identity matching the analyzed source is unavailable; no capability can be complete.',
      span: null,
    })
  }
  const capabilities = indexedFileCapabilities(role, summary.language)
  const payload = summary.sourceAudit
  if (!payload) {
    // A legacy summary is not proof of current audit capability; it is never promoted to complete.
    diagnostics.push({
      code: 'source-audit-evidence-missing',
      message: 'The index entry carries no source-audit evidence; re-extract it before relying on language facts.',
      span: null,
    })
    const record: SourceAuditFile = {
      ...base,
      language: summary.language,
      role,
      status: validHash === null || warnings.length > 0 ? 'partial' : 'file-level-only',
      lineCount: summary.lineCount,
      analyzerId: null,
      capabilities,
      facts: [],
      warnings,
      diagnostics,
    }
    return { record, unreadable: false, identityGap: validHash === null }
  }

  const parserFailed = BATCH2_AUDIT_CAPABILITIES.every((capability) => payload.capabilities[capability] === 'failed')
  const factKinds = new Set<string>(payload.facts.map((fact) => fact.kind))
  const kindOf: Partial<Record<SourceAuditCapability, string>> = {
    'identifier-literals': 'identifier-literal',
    'test-observations': 'test-observation',
    'fixture-references': 'fixture-reference',
    'process-observations': 'process-observation',
  }
  for (const capability of AUDIT_PRODUCER_CAPABILITIES) {
    const reported = payload.capabilities[capability]
    const inapplicable = capabilities[capability] === 'not-applicable'
    // A role-inapplicable family (e.g. test observations in a production source file) stays not-applicable
    // while the extractor found nothing and reports a clean scan; observed facts or uncertainty always surface.
    if (inapplicable && reported === 'complete' && !factKinds.has(kindOf[capability] ?? '')) continue
    // Without content identity matching the analyzed bytes, nothing may be complete.
    capabilities[capability] = reported === 'complete' && validHash === null ? 'partial' : reported
  }
  diagnostics.unshift(...payload.diagnostics)
  const recovered = payload.diagnostics.some((d) => d.code === 'syntax-errors' || d.code === 'rust-parser-recovery')
  const record: SourceAuditFile = {
    ...base,
    language: summary.language,
    role,
    status: parserFailed ? 'failed' : validHash === null || recovered ? 'partial' : 'parsed',
    lineCount: summary.lineCount,
    analyzerId: ANALYZER_BY_LANGUAGE[summary.language] ?? null,
    capabilities,
    facts: parserFailed ? [] : payload.facts.map((fact) => structuredClone(fact)),
    ...(payload.jvmPackageName !== undefined ? { jvmPackageName: payload.jvmPackageName } : {}),
    warnings,
    diagnostics,
  }
  return { record, unreadable: false, identityGap: validHash === null }
}

export function buildSourceAuditEvidence(input: BuildSourceAuditEvidenceInput): BuildSourceAuditEvidenceResult {
  const reasons = new Set<string>()
  const ledger = input.discovery.auditSelection

  const sourceRoots = sortedUnique(input.sourceRoots.map(normalizeRoot))
  const userRules = sortedUnique(input.excludes.map(normalizeRule).filter((rule) => rule.length > 0))
  // Effective exclusion policy: default rules (literal owners in discoverSourceFiles) plus normalized user rules.
  const excludes = sortedUnique([
    ...DEFAULT_IGNORED_DIRECTORY_NAMES.map((name) => `default-directory:${normalizeRule(name)}`),
    ...DEFAULT_IGNORED_DIRECTORY_PREFIXES.map((prefix) => `default-directory-prefix:${normalizeRule(prefix)}`),
    ...DEFAULT_FILE_EXCLUDE_PATTERNS.map((pattern) => `default-file-pattern:${pattern}`),
    ...userRules.map((rule) => `user:${rule}`),
  ])

  for (const reason of ledger.incompleteReasons) reasons.add(reason)
  if (ledger.inaccessibleDirectoryCount > 0) reasons.add('directory-enumeration-failed')

  const selected = dedupeSelected(ledger.selectedFiles, reasons)
  const summariesByPath = new Map(input.symbolIndex.files.map((file) => [toForwardSlash(file.path), file]))

  const files: SourceAuditFile[] = []
  let unreadableFileCount = 0
  let unsupportedFileCount = 0
  let identityGaps = 0
  for (const entry of selected) {
    if (!isCanonicalAuditPath(entry.relPath)) {
      // A path outside the canonical root-relative form cannot be recorded without corrupting the contract.
      reasons.add('noncanonical-selected-path')
      continue
    }
    const projection = projectFile(entry, summariesByPath.get(entry.relPath), input.fileHashes.get(entry.relPath) ?? entry.contentSha256, sourceRoots)
    files.push(projection.record)
    if (projection.unreadable) unreadableFileCount += 1
    if (projection.record.status === 'unsupported') unsupportedFileCount += 1
    if (projection.identityGap) identityGaps += 1
  }
  if (unreadableFileCount > 0) reasons.add('selected-file-unreadable')
  if (identityGaps > 0) reasons.add('content-identity-gap')

  const selectedFileCount = selected.length
  const recordedFileCount = files.length
  const traversalComplete = ledger.inaccessibleDirectoryCount === 0 && ledger.incompleteReasons.length === 0
  const inventoryComplete =
    recordedFileCount === selectedFileCount && traversalComplete && identityGaps === 0 && !reasons.has('conflicting-selection-identity')

  // Exclusion accounting: rules available, consistent with discovery, and expressible in this artifact.
  const discoveryExcludes = sortedUnique(input.discovery.userExcludes.map(normalizeRule).filter((rule) => rule.length > 0))
  const excludesMatch = discoveryExcludes.length === userRules.length && discoveryExcludes.every((rule, i) => rule === userRules[i])
  const observedExclusions =
    input.discovery.skippedByDefaultIgnore + input.discovery.skippedByUserExclude + input.discovery.skippedByFilePattern
  const accountingConsistent = observedExclusions === 0 || ledger.excludedPathCount > 0
  const rulesRecorded = excludes.length > 0
  if (!excludesMatch) reasons.add('configured-excludes-inconsistent')
  if (!accountingConsistent) reasons.add('excluded-path-accounting-inconsistent')
  if (!rulesRecorded) reasons.add('exclusion-rules-not-recorded')
  const exclusionsAreExplicit =
    sourceRoots.length > 0 && excludesMatch && accountingConsistent && rulesRecorded && traversalComplete

  const recordsByPath = new Map(files.map((file) => [file.path, file]))
  const selectionFingerprint = sha256OfJson({
    schemaVersion: SOURCE_AUDIT_SCHEMA_VERSION,
    sourceRoots,
    excludes,
  })
  const snapshotId = sha256OfJson({
    schemaVersion: SOURCE_AUDIT_SCHEMA_VERSION,
    selectionFingerprint,
    extractorContractRevision: SOURCE_AUDIT_EXTRACTOR_CONTRACT_REVISION,
    files: selected.map((entry) => {
      const record = recordsByPath.get(entry.relPath)
      return {
        path: entry.relPath,
        contentSha256: record?.contentSha256 ?? null,
        selectionStatus: entry.selectionStatus,
        language: record?.language ?? null,
        role: record?.role ?? null,
        status: record?.status ?? null,
      }
    }),
  })

  const artifact: SourceAuditEvidenceArtifact = {
    artifactKind: SOURCE_AUDIT_ARTIFACT_KIND,
    schemaVersion: SOURCE_AUDIT_SCHEMA_VERSION,
    producer: { packageName: '@dailephd/my-dev-kit', packageVersion: input.producerVersion },
    source: {
      projectRoot: toForwardSlash(input.projectRoot),
      sourceRoots,
      excludes,
      symbolIndexSchemaVersion: '3',
      codeGraphSchemaVersion: '1.1.0',
      selectionFingerprint,
      snapshotId,
    },
    coverage: {
      selectedFileCount,
      recordedFileCount,
      unreadableFileCount,
      excludedPathCount: ledger.excludedPathCount,
      unsupportedFileCount,
      inventoryComplete,
      exclusionsAreExplicit,
    },
    files,
  }
  return { artifact, incompleteReasons: [...reasons].sort(compareText) }
}

export interface SerializedSourceAuditEvidence {
  /** The exact bytes' text form: JSON.stringify(artifact, null, 2) + "\n", encoded as UTF-8 when written. */
  json: string
  reference: SourceAuditEvidenceReference
}

/**
 * Validates the artifact with the pure Batch 0 validator, then serializes it with the repository JSON
 * convention and hashes those exact UTF-8 bytes. Throws (fail closed) when the artifact is invalid.
 */
export function serializeSourceAuditEvidence(artifact: SourceAuditEvidenceArtifact): SerializedSourceAuditEvidence {
  validateSourceAuditEvidence(artifact)
  const json = `${JSON.stringify(artifact, null, 2)}\n`
  return {
    json,
    reference: {
      path: 'source-audit-evidence.json',
      schemaVersion: SOURCE_AUDIT_SCHEMA_VERSION,
      sha256: createHash('sha256').update(Buffer.from(json, 'utf8')).digest('hex'),
      snapshotId: artifact.source.snapshotId,
    },
  }
}
