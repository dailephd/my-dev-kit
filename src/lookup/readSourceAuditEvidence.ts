import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { isInsideRoot } from '../io/pathUtils.js'
import { readIndexManifest } from '../indexing/readIndexManifest.js'
import { SOURCE_AUDIT_EVIDENCE_FILENAME } from '../indexing/managedArtifacts.js'
import {
  AUDIT_FACT_PAGE_SIZE,
  AUDIT_INVENTORY_PAGE_SIZE,
  SOURCE_AUDIT_ARTIFACT_KIND,
  SOURCE_AUDIT_SCHEMA_VERSION,
  type SourceAuditEvidenceArtifact,
  type SourceAuditFile,
  type SourceAuditFilePage,
  type SourceAuditInventoryPage,
} from '../symbol-index/auditEvidenceTypes.js'
import {
  validateSourceAuditEvidence,
  validateSourceAuditFilePage,
  validateSourceAuditInventoryPage,
} from '../symbol-index/validateAuditEvidence.js'
import { ensureInsideProjectRoot, UnsafeSourceError } from './getSourceSlice.js'

export type SourceAuditErrorCode =
  | 'AUDIT_EVIDENCE_UNAVAILABLE'
  | 'AUDIT_EVIDENCE_INVALID'
  | 'STALE_SOURCE_EVIDENCE'
  | 'INVALID_AUDIT_PATH'
  | 'INVALID_AUDIT_PAGE'

/** Stable, machine-readable failure for the audit lookup modes. The message is bounded and contains no source text. */
export class SourceAuditEvidenceError extends Error {
  readonly code: SourceAuditErrorCode
  constructor(code: SourceAuditErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = 'SourceAuditEvidenceError'
    this.code = code
  }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function invalid(message: string): never {
  throw new SourceAuditEvidenceError('AUDIT_EVIDENCE_INVALID', message)
}

/**
 * Reads the audit artifact selected by the index manifest and verifies its persisted identity.
 * Read-only: never indexes, refreshes, repairs or executes anything. It does not prove the
 * recorded source is still current; use assertSourceAuditFileFresh for that.
 */
export function readSourceAuditEvidence(indexDir: string): SourceAuditEvidenceArtifact {
  const resolved = readIndexManifest(indexDir)
  const reference = resolved.manifest.sourceAuditEvidence
  if (reference === undefined || reference === null) {
    throw new SourceAuditEvidenceError(
      'AUDIT_EVIDENCE_UNAVAILABLE',
      'This index manifest does not reference source-audit evidence. Re-index with a my-dev-kit version that writes it.',
    )
  }
  if (typeof reference !== 'object' || reference.path !== SOURCE_AUDIT_EVIDENCE_FILENAME) {
    invalid(`Manifest sourceAuditEvidence.path must be ${SOURCE_AUDIT_EVIDENCE_FILENAME}.`)
  }
  if (reference.schemaVersion !== SOURCE_AUDIT_SCHEMA_VERSION) invalid('Manifest sourceAuditEvidence.schemaVersion is unsupported.')
  if (typeof reference.sha256 !== 'string' || !SHA256_PATTERN.test(reference.sha256)) invalid('Manifest sourceAuditEvidence.sha256 is not a lowercase SHA-256.')
  if (typeof reference.snapshotId !== 'string' || !SHA256_PATTERN.test(reference.snapshotId)) invalid('Manifest sourceAuditEvidence.snapshotId is malformed.')

  const artifactPath = path.resolve(resolved.indexDir, reference.path)
  if (!isInsideRoot(resolved.indexDir, artifactPath)) invalid('The audit artifact path escapes the index directory.')
  if (!fs.existsSync(artifactPath)) {
    invalid('The audit artifact referenced by the manifest is missing.')
  }
  let bytes: Buffer
  try {
    // A symlink or junction may not lead outside the chosen index directory.
    const physicalDir = fs.realpathSync(resolved.indexDir)
    const physicalArtifact = fs.realpathSync(artifactPath)
    if (!isInsideRoot(physicalDir, physicalArtifact)) invalid('The audit artifact resolves outside the index directory.')
    if (!fs.statSync(physicalArtifact).isFile()) invalid('The audit artifact is not a regular file.')
    bytes = fs.readFileSync(physicalArtifact)
  } catch (error) {
    if (error instanceof SourceAuditEvidenceError) throw error
    return invalid('The audit artifact could not be read.')
  }
  if (sha256Hex(bytes) !== reference.sha256) invalid('The serialized audit artifact does not match the SHA-256 recorded in the manifest.')

  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    return invalid('The audit artifact is not valid JSON.')
  }
  try {
    validateSourceAuditEvidence(parsed)
  } catch (error) {
    return invalid(`Structural validation failed: ${(error as Error).message.slice(0, 240)}`)
  }
  const artifact = parsed as SourceAuditEvidenceArtifact
  if (artifact.artifactKind !== SOURCE_AUDIT_ARTIFACT_KIND) invalid('Unexpected audit artifact kind.')
  if (artifact.schemaVersion !== SOURCE_AUDIT_SCHEMA_VERSION) invalid('Unexpected audit artifact schema version.')
  if (artifact.source.snapshotId !== reference.snapshotId) invalid('The artifact snapshotId does not match the manifest.')
  if (artifact.source.projectRoot !== resolved.manifest.projectRoot) invalid('The artifact project root does not match the manifest.')
  const manifestRoots = [...resolved.manifest.sourceRoots].map((root) => root.replace(/\\/g, '/')).sort()
  const artifactRoots = [...artifact.source.sourceRoots].sort()
  if (manifestRoots.length !== artifactRoots.length || manifestRoots.some((root, i) => root.replace(/^(\.\/)+/, '').replace(/^\/+|\/+$/g, '') !== artifactRoots[i])) {
    invalid('The artifact source roots do not match the manifest.')
  }
  return artifact
}

function totalPagesFor(totalItems: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalItems / pageSize))
}

function assertPageIndex(pageIndex: number, totalPages: number): void {
  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    throw new SourceAuditEvidenceError('INVALID_AUDIT_PAGE', 'The page index must be a nonnegative integer.')
  }
  if (pageIndex >= totalPages) {
    throw new SourceAuditEvidenceError('INVALID_AUDIT_PAGE', `Page ${pageIndex} is beyond the terminal page ${totalPages - 1}.`)
  }
}

/** One bounded page of the recorded inventory in artifact (ascending path) order. */
export function getSourceAuditInventoryPage(artifact: SourceAuditEvidenceArtifact, pageIndex: number): SourceAuditInventoryPage {
  const totalItems = artifact.files.length
  const totalPages = totalPagesFor(totalItems, AUDIT_INVENTORY_PAGE_SIZE)
  assertPageIndex(pageIndex, totalPages)
  const start = pageIndex * AUDIT_INVENTORY_PAGE_SIZE
  const page: SourceAuditInventoryPage = {
    schemaVersion: SOURCE_AUDIT_SCHEMA_VERSION,
    snapshotId: artifact.source.snapshotId,
    pageIndex,
    pageSize: AUDIT_INVENTORY_PAGE_SIZE,
    totalItems,
    totalPages,
    nextPageIndex: pageIndex + 1 < totalPages ? pageIndex + 1 : null,
    mode: 'audit-files',
    coverage: artifact.coverage,
    files: artifact.files.slice(start, start + AUDIT_INVENTORY_PAGE_SIZE).map((file) => {
      const { facts: _facts, diagnostics: _diagnostics, ...summary } = file
      return summary
    }),
  }
  validateSourceAuditInventoryPage(page)
  return page
}

/**
 * True only for the exact canonical selected-path form: forward slashes, no empty, dot or dot-dot
 * segments, no drive letter, no leading slash, no NUL. Anything else is rejected, never normalized.
 */
export function isCanonicalAuditRelativePath(value: string): boolean {
  if (value.length === 0 || value.includes('\0') || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false
  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

/** One bounded fact page for an exact selected file, or an explicit not-selected result. */
export function getSourceAuditFilePage(artifact: SourceAuditEvidenceArtifact, relativePath: string, pageIndex: number): SourceAuditFilePage {
  if (!isCanonicalAuditRelativePath(relativePath)) {
    throw new SourceAuditEvidenceError('INVALID_AUDIT_PATH', 'The path must be a canonical, forward-slash, root-relative selected path without traversal.')
  }
  const file = artifact.files.find((candidate) => candidate.path === relativePath)
  if (!file) {
    assertPageIndex(pageIndex, 1)
    const notSelected: SourceAuditFilePage = {
      schemaVersion: SOURCE_AUDIT_SCHEMA_VERSION,
      snapshotId: artifact.source.snapshotId,
      pageIndex: 0,
      pageSize: AUDIT_FACT_PAGE_SIZE,
      totalItems: 0,
      totalPages: 1,
      nextPageIndex: null,
      mode: 'audit-file',
      status: 'not-selected',
      file: null,
      facts: [],
    }
    validateSourceAuditFilePage(notSelected)
    return notSelected
  }
  const totalItems = file.facts.length
  const totalPages = totalPagesFor(totalItems, AUDIT_FACT_PAGE_SIZE)
  assertPageIndex(pageIndex, totalPages)
  const start = pageIndex * AUDIT_FACT_PAGE_SIZE
  const { facts: _facts, ...record } = file
  const page: SourceAuditFilePage = {
    schemaVersion: SOURCE_AUDIT_SCHEMA_VERSION,
    snapshotId: artifact.source.snapshotId,
    pageIndex,
    pageSize: AUDIT_FACT_PAGE_SIZE,
    totalItems,
    totalPages,
    nextPageIndex: pageIndex + 1 < totalPages ? pageIndex + 1 : null,
    mode: 'audit-file',
    status: 'found',
    file: record,
    facts: file.facts.slice(start, start + AUDIT_FACT_PAGE_SIZE),
  }
  validateSourceAuditFilePage(page)
  return page
}

/**
 * Read-only freshness check for one recorded file. Where contentSha256 was recorded, the current
 * bytes must hash to it; a missing, replaced or escaping file is reported, never returned as empty success.
 * A file recorded without a content hash cannot be authenticated and is not claimed fresh.
 */
export function assertSourceAuditFileFresh(artifact: SourceAuditEvidenceArtifact, file: Pick<SourceAuditFile, 'path' | 'contentSha256'>): void {
  if (file.contentSha256 === null) return
  const projectRoot = artifact.source.projectRoot
  let bytes: Buffer
  try {
    const resolved = ensureInsideProjectRoot(projectRoot, file.path)
    bytes = fs.readFileSync(resolved)
  } catch (error) {
    if (error instanceof UnsafeSourceError) {
      throw new SourceAuditEvidenceError('INVALID_AUDIT_PATH', error.message)
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new SourceAuditEvidenceError('STALE_SOURCE_EVIDENCE', `Selected source file "${file.path}" no longer exists. Re-index before relying on this evidence.`)
    }
    throw new SourceAuditEvidenceError('STALE_SOURCE_EVIDENCE', `Selected source file "${file.path}" could not be read. Re-index before relying on this evidence.`)
  }
  if (sha256Hex(bytes) !== file.contentSha256) {
    throw new SourceAuditEvidenceError('STALE_SOURCE_EVIDENCE', `Selected source file "${file.path}" changed after it was indexed. Re-index before relying on this evidence.`)
  }
}
