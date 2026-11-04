/**
 * v1.15.0 KIT-FACTS-01 source-audit evidence contract (Batch 0).
 *
 * Pure, versioned type contract only. Nothing in this module produces,
 * reads, registers or writes `source-audit-evidence.json`; the runtime
 * producer, manifest registration and lookup selectors belong to later
 * batches. This contract adds a capability beside, and never replaces,
 * symbol-index schema 3, code-graph schema 1.1.0 or index manifest 1.0.0.
 */

export const SOURCE_AUDIT_SCHEMA_VERSION = '1.1.0'
export const SOURCE_AUDIT_ARTIFACT_KIND = 'my-dev-kit-v1-source-audit-evidence'
export const SOURCE_AUDIT_FILENAME = 'source-audit-evidence.json'

export const AUDIT_INVENTORY_PAGE_SIZE = 64
export const AUDIT_FACT_PAGE_SIZE = 128
export const AUDIT_LITERAL_MAX_CHARS = 256
/** Shared bound for selected raw test-content identity and exact-file occurrence retrieval. */
export const AUDIT_CONTENT_MAX_BYTES = 200000

export const SOURCE_AUDIT_ROLES = ['source', 'test', 'script', 'unknown'] as const
export type SourceAuditRole = (typeof SOURCE_AUDIT_ROLES)[number]

export const SOURCE_AUDIT_FILE_STATUSES = [
  'parsed',
  'partial',
  'file-level-only',
  'unsupported',
  'failed',
  'skipped',
] as const
export type SourceAuditFileStatus = (typeof SOURCE_AUDIT_FILE_STATUSES)[number]

export const SOURCE_AUDIT_CAPABILITIES = [
  'declarations',
  'jvmDeclarations',
  'imports',
  'exports',
  'identifier-literals',
  'test-observations',
  'fixture-references',
  'process-observations',
  'api-client-calls',
  'source-ranges',
] as const
export type SourceAuditCapability = (typeof SOURCE_AUDIT_CAPABILITIES)[number]

export const SOURCE_AUDIT_CAPABILITY_STATUSES = [
  'complete',
  'partial',
  'unsupported',
  'failed',
  'not-applicable',
] as const
export type SourceAuditCapabilityStatus = (typeof SOURCE_AUDIT_CAPABILITY_STATUSES)[number]

export const SOURCE_AUDIT_FACT_KINDS = [
  'declaration',
  'import',
  'export',
  'identifier-literal',
  'test-observation',
  'fixture-reference',
  'process-observation',
  'api-client-call',
] as const
export type SourceAuditFactKind = (typeof SOURCE_AUDIT_FACT_KINDS)[number]

export const SOURCE_AUDIT_OBSERVATION_KINDS = [
  'test-title',
  'test-modifier-skip',
  'test-modifier-only',
  'embedded-test-command',
  'registry-id',
  'fixture-basename',
  'process-invocation',
  'process-option',
  'newline-split',
  'path-separator-split',
  'source-literal',
] as const
export type SourceAuditObservationKind = (typeof SOURCE_AUDIT_OBSERVATION_KINDS)[number]

export const SOURCE_AUDIT_EXTRACTION_METHODS = [
  'typescript-ast',
  'python-ast',
  'rust-tree-sitter',
  'java-lexical',
  'kotlin-lexical',
  'lexical',
  'metadata',
] as const
export type SourceAuditExtractionMethod = (typeof SOURCE_AUDIT_EXTRACTION_METHODS)[number]

export const SOURCE_AUDIT_VISIBILITIES = [
  'public',
  'internal',
  'protected',
  'private',
  'package',
  'module',
  'unknown',
] as const
export type SourceAuditVisibility = (typeof SOURCE_AUDIT_VISIBILITIES)[number]

export const SOURCE_AUDIT_EXPORT_ORIGINS = [
  'declared-export',
  're-export',
  'commonjs',
  'python-all',
  'python-convention',
  'visibility-inferred',
  'none',
  'unknown',
] as const
export type SourceAuditExportOrigin = (typeof SOURCE_AUDIT_EXPORT_ORIGINS)[number]

export const SOURCE_AUDIT_IMPORT_RESOLUTIONS = [
  'resolved-local',
  'ambiguous',
  'unresolved',
  'external',
  'outside-selected-roots',
  'observed',
] as const
export type SourceAuditImportResolution = (typeof SOURCE_AUDIT_IMPORT_RESOLUTIONS)[number]

export const SOURCE_AUDIT_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'UNKNOWN'] as const
export const SOURCE_AUDIT_HTTP_CLIENT_KINDS = ['fetch', 'axios'] as const

export interface SourceAuditSpan {
  path: string
  startLine: number
  startColumn: number | null
  endLine: number | null
  endColumn: number | null
}

export interface JvmDeclarationIdentity {
  packageName: string
  qualifiedName: string
  role: 'type' | 'kotlin-top-level-function' | 'kotlin-top-level-property'
}

export interface JvmImportTarget {
  kind: 'java-type' | 'java-static-owner' | 'kotlin-direct' | 'unsupported'
  qualifiedName: string | null
}

export interface SourceAuditFact {
  id: string
  kind: SourceAuditFactKind
  span: SourceAuditSpan
  extractionMethod: SourceAuditExtractionMethod
  name?: string
  jvmDeclaration?: JvmDeclarationIdentity
  jvmImportTarget?: JvmImportTarget
  observationKind?: SourceAuditObservationKind
  symbolId?: string
  declarationKind?: string
  ownerKey?: string | null
  visibility?: SourceAuditVisibility
  exported?: boolean | null
  exportOrigin?: SourceAuditExportOrigin
  sourceSpecifier?: string
  owningSymbolId?: string | null
  httpMethod?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'UNKNOWN'
  httpClientKind?: 'fetch' | 'axios'
  staticUrl?: string | null
  importedNames?: string[]
  importResolution?: SourceAuditImportResolution
  targetPaths?: string[]
  value?: string | null
  valueSha256?: string
  valueTruncated?: boolean
}

export interface SourceAuditFile {
  path: string
  language: string
  /** Missing means unknown; empty string is a positively qualified default package. */
  jvmPackageName?: string
  role: SourceAuditRole
  status: SourceAuditFileStatus
  contentSha256: string | null
  sizeBytes: number | null
  lineCount: number | null
  analyzerId: string | null
  capabilities: Record<SourceAuditCapability, SourceAuditCapabilityStatus>
  facts: SourceAuditFact[]
  warnings: string[]
  diagnostics: Array<{
    code: string
    message: string
    span: SourceAuditSpan | null
  }>
}

export interface SourceAuditEvidenceArtifact {
  artifactKind: typeof SOURCE_AUDIT_ARTIFACT_KIND
  schemaVersion: typeof SOURCE_AUDIT_SCHEMA_VERSION
  producer: {
    packageName: '@dailephd/my-dev-kit'
    packageVersion: string
  }
  source: {
    projectRoot: string
    sourceRoots: string[]
    excludes: string[]
    symbolIndexSchemaVersion: '3'
    codeGraphSchemaVersion: '1.1.0'
    selectionFingerprint: string
    snapshotId: string
  }
  coverage: {
    selectedFileCount: number
    recordedFileCount: number
    unreadableFileCount: number
    excludedPathCount: number
    unsupportedFileCount: number
    inventoryComplete: boolean
    exclusionsAreExplicit: boolean
  }
  files: SourceAuditFile[]
}

export interface SourceAuditPageEnvelope {
  schemaVersion: typeof SOURCE_AUDIT_SCHEMA_VERSION
  snapshotId: string
  pageIndex: number
  pageSize: number
  totalItems: number
  totalPages: number
  nextPageIndex: number | null
}

export interface SourceAuditInventoryPage extends SourceAuditPageEnvelope {
  mode: 'audit-files'
  coverage: SourceAuditEvidenceArtifact['coverage']
  files: Array<Omit<SourceAuditFile, 'facts' | 'diagnostics'>>
}

export interface SourceAuditFilePage extends SourceAuditPageEnvelope {
  mode: 'audit-file'
  status: 'found' | 'not-selected'
  file: Omit<SourceAuditFile, 'facts'> | null
  facts: SourceAuditFact[]
}
