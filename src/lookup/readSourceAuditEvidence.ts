import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { isInsideRoot } from '../io/pathUtils.js'
import { readIndexManifest, type ResolvedIndexManifest } from '../indexing/readIndexManifest.js'
import { SOURCE_AUDIT_EVIDENCE_FILENAME } from '../indexing/managedArtifacts.js'
import {
  AUDIT_CONTENT_MAX_BYTES,
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
import { readSourceBytes, UnsafeSourceError } from './getSourceSlice.js'
import { isTestModifierProofSource, resolveAuditTestModifierProof } from './resolveAuditTestModifierProof.js'
import type { resolveAuditImportTargetFromArtifact } from './resolveAuditImportTarget.js'

export type SourceAuditErrorCode =
  | 'AUDIT_EVIDENCE_UNAVAILABLE'
  | 'AUDIT_EVIDENCE_INVALID'
  | 'STALE_SOURCE_EVIDENCE'
  | 'INVALID_AUDIT_PATH'
  | 'INVALID_AUDIT_PAGE'
  | 'INVALID_TEST_MODIFIER_PROOF_SELECTOR'
  | 'INVALID_TEST_MODIFIER_PROOF_SCHEMA'
  | 'AUDIT_FACT_NOT_FOUND'
  | 'AUDIT_FACT_NOT_IMPORT'

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
  const { reference, artifactPath } = resolveAuditRegistration(resolved)
  let bytes: Buffer
  try {
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
  return parseRegisteredArtifact(bytes, resolved, reference)
}

function resolveAuditRegistration(resolved: ResolvedIndexManifest) {
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
  if (reference.schemaVersion !== SOURCE_AUDIT_SCHEMA_VERSION && reference.schemaVersion !== '1.2.0') invalid('Manifest sourceAuditEvidence.schemaVersion is unsupported.')
  if (typeof reference.sha256 !== 'string' || !SHA256_PATTERN.test(reference.sha256)) invalid('Manifest sourceAuditEvidence.sha256 is not a lowercase SHA-256.')
  if (typeof reference.snapshotId !== 'string' || !SHA256_PATTERN.test(reference.snapshotId)) invalid('Manifest sourceAuditEvidence.snapshotId is malformed.')

  const artifactPath = path.resolve(resolved.indexDir, reference.path)
  if (!isInsideRoot(resolved.indexDir, artifactPath)) invalid('The audit artifact path escapes the index directory.')
  if (!fs.existsSync(artifactPath)) {
    invalid('The audit artifact referenced by the manifest is missing.')
  }
  return { reference, artifactPath }
}

function parseRegisteredArtifact(bytes: Buffer, resolved: ResolvedIndexManifest, reference: ReturnType<typeof resolveAuditRegistration>['reference']): SourceAuditEvidenceArtifact {
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
  if (artifact.schemaVersion !== reference.schemaVersion) invalid('Unexpected audit artifact schema version.')
  if (artifact.source.snapshotId !== reference.snapshotId) invalid('The artifact snapshotId does not match the manifest.')
  if (artifact.source.projectRoot !== resolved.manifest.projectRoot) invalid('The artifact project root does not match the manifest.')
  const manifestRoots = [...resolved.manifest.sourceRoots].map((root) => root.replace(/\\/g, '/')).sort()
  const artifactRoots = [...artifact.source.sourceRoots].sort()
  if (manifestRoots.length !== artifactRoots.length || manifestRoots.some((root, i) => root.replace(/^(\.\/)+/, '').replace(/^\/+|\/+$/g, '') !== artifactRoots[i])) {
    invalid('The artifact source roots do not match the manifest.')
  }
  return artifact
}

/** A session pins static index identity and reauthenticates its bytes before every frame. */
export function createSourceAuditFrameReader(indexDir: string, extraPaths?: (resolved: ResolvedIndexManifest) => Array<string | null>) {
  let pinned: { artifact: SourceAuditEvidenceArtifact; manifestSha256: string; stamps: string } | undefined
  return () => {
    try {
      const manifestBytes = readSourceBytes(indexDir, 'manifest.json')
      const manifestSha256 = sha256Hex(manifestBytes)
      const resolved = readIndexManifest(indexDir)
      if (JSON.stringify(JSON.parse(manifestBytes.toString('utf8'))) !== JSON.stringify(resolved.manifest)) {
        invalid('The index manifest changed while it was being read.')
      }
      const { reference, artifactPath } = resolveAuditRegistration(resolved)
      const paths = [resolved.indexDir, resolved.manifestPath, artifactPath, ...(extraPaths?.(resolved) ?? [])]
      const stamp = () => JSON.stringify(paths.map(file => {
        if (file === null) return null
        try {
          const real = fs.realpathSync(file)
          const stat = fs.statSync(real, { bigint: true })
          return [real, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        }
      }))
      const stamps = stamp()
      if (pinned && (pinned.manifestSha256 !== manifestSha256 || pinned.stamps !== stamps)) {
        invalid('The index changed during the audit stream.')
      }
      const bytes = readSourceBytes(indexDir, SOURCE_AUDIT_EVIDENCE_FILENAME)
      if (sha256Hex(bytes) !== reference.sha256) invalid('The serialized audit artifact does not match its registration.')
      const artifact = pinned?.artifact ?? parseRegisteredArtifact(bytes, resolved, reference)
      const assertCurrent = () => {
        if (stamps !== stamp() || manifestSha256 !== sha256Hex(readSourceBytes(indexDir, 'manifest.json'))) {
          invalid('The index changed during the audit stream frame.')
        }
      }
      assertCurrent()
      pinned = { artifact, manifestSha256, stamps }
      return { artifact, assertCurrent }
    } catch (error) {
      if (error instanceof SourceAuditEvidenceError) throw error
      return invalid('The audit stream index or manifest could not be authenticated.')
    }
  }
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
    schemaVersion: artifact.schemaVersion,
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
      schemaVersion: artifact.schemaVersion,
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
    schemaVersion: artifact.schemaVersion,
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

/** Reads a fact page and verifies live selected bytes before returning it. */
export function readFreshSourceAuditFilePage(
  artifact: SourceAuditEvidenceArtifact, relativePath: string, pageIndex: number,
  resolveImportTarget: typeof resolveAuditImportTargetFromArtifact,
  testModifierProof?: true,
): SourceAuditFilePage {
  if (testModifierProof) {
    if (pageIndex !== 0) {
      throw new SourceAuditEvidenceError('INVALID_TEST_MODIFIER_PROOF_SELECTOR', 'A test modifier proof requires page zero.')
    }
    if (artifact.schemaVersion !== '1.2.0') {
      throw new SourceAuditEvidenceError('INVALID_TEST_MODIFIER_PROOF_SCHEMA', 'A test modifier proof requires source-audit artifact schema 1.2.0.')
    }
  }
  const page = getSourceAuditFilePage(artifact, relativePath, pageIndex)
  if (!page.file) return page
  if (!testModifierProof || !isTestModifierProofSource(page.file)) {
    assertSourceAuditFileFresh(artifact, page.file)
    return page
  }
  const origin = artifact.files.find(file => file.path === relativePath)!
  let bytes: Buffer
  try {
    bytes = readProofBytes(origin)
  } catch (error) {
    // Keep the legacy freshness error when the current source no longer fits
    // the proof-time read bound.
    assertSourceAuditFileFresh(artifact, origin)
    throw error
  }
  let checkedWrapperReference = false
  try {
    const proof = resolveAuditTestModifierProof(artifact, origin, bytes, readProofBytes, (current, factId) => {
      checkedWrapperReference = true
      return resolveImportTarget(current, factId)
    })
    if (proof) page.testModifierProof = proof
  } catch (error) {
    // Proof-time parser depth or a stale/unsafe wrapper must never turn an
    // otherwise fresh legacy page into a failure. Recheck the origin below.
    if (!isUnavailableProofSource(error) && !(error instanceof RangeError)) throw error
  }
  if (checkedWrapperReference) assertSourceAuditFileFresh(artifact, page.file)
  if (page.testModifierProof) validateSourceAuditFilePage(page)
  return page

  function readProofBytes(file: SourceAuditFile): Buffer {
    const bytes = readSourceAuditFileBytes(artifact, file, AUDIT_CONTENT_MAX_BYTES)
    if (file.sizeBytes !== bytes.length) invalid('Selected record size contradicts authenticated bytes.')
    return bytes
  }
}

function isUnavailableProofSource(error: unknown): boolean {
  return error instanceof SourceAuditEvidenceError &&
    (error.code === 'STALE_SOURCE_EVIDENCE' || error.code === 'INVALID_AUDIT_PATH')
}

/**
 * Read-only freshness check for one recorded file. Where contentSha256 was recorded, the current
 * bytes must hash to it; a missing, replaced or escaping file is reported, never returned as empty success.
 * A file recorded without a content hash cannot be authenticated and is not claimed fresh.
 */
export function assertSourceAuditFileFresh(artifact: SourceAuditEvidenceArtifact, file: Pick<SourceAuditFile, 'path' | 'contentSha256'>): void {
  if (file.contentSha256 === null) return
  readSourceAuditFileBytes(artifact, file)
}

/** Hash verification and descriptor-safe retrieval share one read, including unsupported raw content. */
export function readSourceAuditFileBytes(artifact: SourceAuditEvidenceArtifact, file: Pick<SourceAuditFile, 'path' | 'contentSha256'>, maxBytes = Infinity): Buffer {
  const projectRoot = artifact.source.projectRoot
  let bytes: Buffer
  try {
    bytes = readSourceBytes(projectRoot, file.path, maxBytes)
  } catch (error) {
    if ((error instanceof Error && (error.cause as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') ||
        (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new SourceAuditEvidenceError('STALE_SOURCE_EVIDENCE', `Selected source file "${file.path}" no longer exists. Re-index before relying on this evidence.`)
    }
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
  return bytes
}
