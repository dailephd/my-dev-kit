import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import * as path from 'node:path'
import type { SourceAuditEvidenceArtifact } from '../symbol-index/auditEvidenceTypes.js'
import { readSourceBytes, UnsafeSourceError } from './getSourceSlice.js'
import { readSourceAuditEvidence } from './readSourceAuditEvidence.js'

export type AuditBatchFamily = 'lookup' | 'source'

interface AuditBatchItem {
  id: string
}

export type LookupBatchItem = AuditBatchItem & (
  | { selector: 'audit-files'; page?: number }
  | { selector: 'audit-file'; path: string; page?: number; testModifierProof?: true }
  | { selector: 'audit-import-target'; factId: string; directExternalReferenceProof?: true }
  | { selector: 'audit-import-domain'; factId: string }
)

export type SourceBatchItem = AuditBatchItem & (
  | { selector: 'exact-file-occurrence'; path: string; literal: string; context?: number }
  | { selector: 'exact-file-byte-occurrence'; path: string; needleHex: string }
  | { selector: 'line-range'; path: string; start: number; end: number; maxLines?: number }
)

export type AuditBatchItemByFamily = { lookup: LookupBatchItem; source: SourceBatchItem }
type BatchItem = AuditBatchItemByFamily[AuditBatchFamily]
export const AUDIT_BATCH_MAX_INPUT = 64 * 1024
export const AUDIT_BATCH_MAX_OUTPUT = 8 * 1024 * 1024
const MAX_REQUESTS = 32
const sha256 = /^[a-f0-9]{64}$/

function invalid(message: string): never {
  throw new Error('INVALID_AUDIT_BATCH: ' + message)
}

function readInput(file: string): Buffer {
  const normalized = process.platform === 'win32' ? file.replaceAll('/', '\\') : file
  const windowsPath = /^[a-z]:\\[^:]+$/i.test(normalized) &&
    !normalized.slice(3).split('\\').some(part => /[ .]$|^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))
  if (!path.isAbsolute(normalized) || normalized !== path.resolve(normalized) || normalized.includes('\0') ||
      (process.platform === 'win32' && !windowsPath)) invalid('Expected a canonical absolute input file path.')
  const canonical = () => path.relative(normalized, realpathSync.native(normalized)) === ''
  try {
    if (canonical()) {
      const bytes = readSourceBytes(path.dirname(normalized), path.basename(normalized), AUDIT_BATCH_MAX_INPUT)
      if (canonical()) return bytes
    }
  } catch {
    // The request path and its contents are caller data. Keep global errors bounded.
  }
  return invalid('Expected a regular, nonsymlink input file of at most 64 KiB in its real parent directory.')
}

function auditRequestRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected a JSON object.')
  return value as Record<string, unknown>
}

function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid('Unexpected field.')
}

function string(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0')
}

function validateItem(raw: unknown, family: AuditBatchFamily): BatchItem {
  const item = auditRequestRecord(raw)
  if (typeof item.id !== 'string' || !/^[\x21-\x7e]{1,64}$/.test(item.id)) invalid('Expected a printable ASCII request ID of 1–64 characters.')
  const fields = (requiredStrings: string[], requiredNumbers: string[], optionalNumbers: string[], extraKeys: string[] = []) => {
    keys(item, ['id', 'selector', ...requiredStrings, ...requiredNumbers, ...optionalNumbers, ...extraKeys])
    if (!requiredStrings.every(key => string(item[key])) ||
        !requiredNumbers.every(key => Number.isSafeInteger(item[key])) ||
        !optionalNumbers.every(key => item[key] === undefined || Number.isSafeInteger(item[key]))) {
      invalid('Invalid selector parameters.')
    }
  }
  if (family === 'lookup') {
    switch (item.selector) {
      case 'audit-files': fields([], [], ['page']); break
      case 'audit-file':
        fields(['path'], [], ['page'], ['testModifierProof'])
        if (Object.hasOwn(item, 'testModifierProof') &&
            (item.testModifierProof !== true || (item.page ?? 0) !== 0)) {
          invalid('testModifierProof must be true and requires page zero.')
        }
        break
      case 'audit-import-target':
        fields(['factId'], [], [], ['directExternalReferenceProof'])
        if (Object.hasOwn(item, 'directExternalReferenceProof') && item.directExternalReferenceProof !== true) {
          invalid('directExternalReferenceProof must be true.')
        }
        break
      case 'audit-import-domain': fields(['factId'], [], []); break
      default: invalid('Unsupported lookup selector.')
    }
  } else {
    switch (item.selector) {
      case 'exact-file-occurrence': fields(['path', 'literal'], [], ['context']); break
      case 'exact-file-byte-occurrence': fields(['path', 'needleHex'], [], []); break
      case 'line-range': fields(['path'], ['start', 'end'], ['maxLines']); break
      default: invalid('Unsupported source selector.')
    }
  }
  return item as unknown as BatchItem
}

export function auditErrorCode(error: unknown): string {
  if (error instanceof UnsafeSourceError) return 'UNSAFE_SOURCE'
  if (error instanceof Error) {
    return /^([A-Z][A-Z0-9_]{1,63}):/.exec(error.message)?.[1] ?? 'COMMAND_ERROR'
  }
  return 'COMMAND_ERROR'
}

/** An invocation shares only persisted evidence. The item reader retains all live checks. */
export function readAuditBatch<F extends AuditBatchFamily>(
  indexDir: string, file: string, family: F,
  readItem: (artifact: SourceAuditEvidenceArtifact, item: AuditBatchItemByFamily[F]) => unknown,
): { json: string; complete: boolean } {
  const bytes = readInput(file)
  const input = auditRequestRecord(decodeAuditRequest(bytes))
  keys(input, ['schemaVersion', 'mode', 'family', 'expectedSnapshotId', 'selectionFingerprint', 'requests'])
  if (input.schemaVersion !== '1.0.0' || input.mode !== 'audit-batch-request' || input.family !== family ||
      typeof input.expectedSnapshotId !== 'string' || !sha256.test(input.expectedSnapshotId) ||
      typeof input.selectionFingerprint !== 'string' || !sha256.test(input.selectionFingerprint)) {
    invalid('Invalid schema, mode, family or snapshot/selection identity.')
  }
  const items = validateAuditRequests(input.requests, family)
  const artifact = readSourceAuditEvidence(indexDir)
  if (artifact.source.snapshotId !== input.expectedSnapshotId || artifact.source.selectionFingerprint !== input.selectionFingerprint) {
    throw new Error('AUDIT_BATCH_IDENTITY_MISMATCH: Expected snapshot or selection does not match the authenticated artifact.')
  }
  return executeAuditBatch(artifact, bytes, family, items, readItem)
}

export function decodeAuditRequest(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes))
  } catch {
    return invalid('Expected a valid UTF-8 JSON input file.')
  }
}

export function validateAuditRequests<F extends AuditBatchFamily>(raw: unknown, family: F): AuditBatchItemByFamily[F][] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_REQUESTS) {
    invalid('Expected 1–32 requests.')
  }
  const items = raw.map(item => validateItem(item, family))
  if (new Set(items.map(item => item.id)).size !== items.length) invalid('Duplicate request ID.')
  return items as AuditBatchItemByFamily[F][]
}

export function executeAuditBatch<F extends AuditBatchFamily>(
  artifact: SourceAuditEvidenceArtifact, bytes: Uint8Array, family: F, items: readonly AuditBatchItemByFamily[F][],
  readItem: (artifact: SourceAuditEvidenceArtifact, item: AuditBatchItemByFamily[F]) => unknown,
  reservedOutputBytes = 0,
): { json: string; complete: boolean } {
  const { snapshotId, selectionFingerprint } = artifact.source
  const inputSha256 = createHash('sha256').update(bytes).digest('hex')

  const header = {
    schemaVersion: '1.0.0', mode: 'audit-batch', family, snapshotId, selectionFingerprint, inputSha256,
    requestedCount: items.length, returnedCount: items.length,
  }
  const envelope = (complete: boolean, results: string[]) =>
    JSON.stringify({ ...header, complete }).slice(0, -1) + ',"results":[' + results.join(',') + ']}\n'
  let legacySize = Buffer.byteLength(envelope(false, []))
  let supplementalSize = 0
  let complete = true
  const legacyResults: string[] = []
  const supplementalResults = new Map<number, string>()
  for (const item of items) {
    const identity = { id: item.id, selector: item.selector }
    let result: unknown
    let expanded: string | undefined
    try {
      const response = readItem(artifact, item)
      if (response === undefined) throw new Error('AUDIT_BATCH_MISSING_RESULT: Selector returned no evidence.')
      result = { ...identity, status: 'ok', response }
      if (item.selector === 'audit-file' && response && typeof response === 'object' && Object.hasOwn(response, 'testModifierProof')) {
        const { testModifierProof: _proof, ...legacy } = response as { testModifierProof: unknown }
        if (supplementalSize !== Infinity) expanded = JSON.stringify(result)
        result = { ...identity, status: 'ok', response: legacy }
      }
    } catch (error) {
      complete = false
      result = { ...identity, status: 'error', error: { code: auditErrorCode(error), exitCode: 2 } }
    }
    const serialized = JSON.stringify(result)
    const legacyBytes = Buffer.byteLength(serialized)
    legacySize += legacyBytes + (legacyResults.length === 0 ? 0 : 1)
    if (expanded !== undefined) supplementalSize += Buffer.byteLength(expanded) - legacyBytes
    if (legacySize > AUDIT_BATCH_MAX_OUTPUT) {
      throw new Error('AUDIT_BATCH_OUTPUT_LIMIT: Serialized responses exceed 8 MiB.')
    }
    if (legacySize + supplementalSize + reservedOutputBytes > AUDIT_BATCH_MAX_OUTPUT) {
      // Supplemental evidence must not turn a fitting fact response into an overflow.
      supplementalResults.clear()
      supplementalSize = Infinity
    } else if (expanded !== undefined) {
      supplementalResults.set(legacyResults.length, expanded)
    }
    legacyResults.push(serialized)
  }
  return { json: envelope(complete, legacyResults.map((result, index) => supplementalResults.get(index) ?? result)), complete }
}
