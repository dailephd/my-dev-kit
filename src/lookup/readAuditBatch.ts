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
  | { selector: 'audit-file'; path: string; page?: number }
  | { selector: 'audit-import-target' | 'audit-import-domain'; factId: string }
)

export type SourceBatchItem = AuditBatchItem & (
  | { selector: 'exact-file-occurrence'; path: string; literal: string; context?: number }
  | { selector: 'exact-file-byte-occurrence'; path: string; needleHex: string }
  | { selector: 'line-range'; path: string; start: number; end: number; maxLines?: number }
)

type BatchItem = LookupBatchItem | SourceBatchItem
const MAX_INPUT_BYTES = 64 * 1024
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
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
      const bytes = readSourceBytes(path.dirname(normalized), path.basename(normalized), MAX_INPUT_BYTES)
      if (canonical()) return bytes
    }
  } catch {
    // The request path and its contents are caller data. Keep global errors bounded.
  }
  return invalid('Expected a regular, nonsymlink input file of at most 64 KiB in its real parent directory.')
}

function record(value: unknown): Record<string, unknown> {
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
  const item = record(raw)
  if (typeof item.id !== 'string' || !/^[\x21-\x7e]{1,64}$/.test(item.id)) invalid('Expected a printable ASCII request ID of 1–64 characters.')
  const fields = (requiredStrings: string[], requiredNumbers: string[], optionalNumbers: string[]) => {
    keys(item, ['id', 'selector', ...requiredStrings, ...requiredNumbers, ...optionalNumbers])
    if (!requiredStrings.every(key => string(item[key])) ||
        !requiredNumbers.every(key => Number.isSafeInteger(item[key])) ||
        !optionalNumbers.every(key => item[key] === undefined || Number.isSafeInteger(item[key]))) {
      invalid('Invalid selector parameters.')
    }
  }
  if (family === 'lookup') {
    switch (item.selector) {
      case 'audit-files': fields([], [], ['page']); break
      case 'audit-file': fields(['path'], [], ['page']); break
      case 'audit-import-target':
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

function errorCode(error: unknown): string {
  if (error instanceof UnsafeSourceError) return 'UNSAFE_SOURCE'
  if (error instanceof Error) {
    return /^([A-Z][A-Z0-9_]{1,63}):/.exec(error.message)?.[1] ?? 'COMMAND_ERROR'
  }
  return 'COMMAND_ERROR'
}

/** An invocation shares only persisted evidence. The item reader retains all live checks. */
export function readAuditBatch(
  indexDir: string,
  file: string,
  family: 'lookup',
  readItem: (artifact: SourceAuditEvidenceArtifact, item: LookupBatchItem) => unknown,
): { json: string; complete: boolean }
export function readAuditBatch(
  indexDir: string,
  file: string,
  family: 'source',
  readItem: (artifact: SourceAuditEvidenceArtifact, item: SourceBatchItem) => unknown,
): { json: string; complete: boolean }
export function readAuditBatch(
  indexDir: string,
  file: string,
  family: AuditBatchFamily,
  readItem: ((artifact: SourceAuditEvidenceArtifact, item: LookupBatchItem) => unknown) |
    ((artifact: SourceAuditEvidenceArtifact, item: SourceBatchItem) => unknown),
): { json: string; complete: boolean } {
  const bytes = readInput(file)
  const inputSha256 = createHash('sha256').update(bytes).digest('hex')
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes))
  } catch {
    return invalid('Expected a valid UTF-8 JSON input file.')
  }

  const input = record(raw)
  keys(input, ['schemaVersion', 'mode', 'family', 'expectedSnapshotId', 'selectionFingerprint', 'requests'])
  if (input.schemaVersion !== '1.0.0' || input.mode !== 'audit-batch-request' || input.family !== family ||
      typeof input.expectedSnapshotId !== 'string' || !sha256.test(input.expectedSnapshotId) ||
      typeof input.selectionFingerprint !== 'string' || !sha256.test(input.selectionFingerprint)) {
    invalid('Invalid schema, mode, family or snapshot/selection identity.')
  }
  if (!Array.isArray(input.requests) || input.requests.length < 1 || input.requests.length > MAX_REQUESTS) {
    invalid('Expected 1–32 requests.')
  }
  const items = input.requests.map(item => validateItem(item, family))
  if (new Set(items.map(item => item.id)).size !== items.length) invalid('Duplicate request ID.')

  const artifact = readSourceAuditEvidence(indexDir)
  const { snapshotId, selectionFingerprint } = artifact.source
  if (snapshotId !== input.expectedSnapshotId || selectionFingerprint !== input.selectionFingerprint) {
    throw new Error('AUDIT_BATCH_IDENTITY_MISMATCH: Expected snapshot or selection does not match the authenticated artifact.')
  }

  const header = {
    schemaVersion: '1.0.0', mode: 'audit-batch', family, snapshotId, selectionFingerprint, inputSha256,
    requestedCount: items.length, returnedCount: items.length,
  }
  const envelope = (complete: boolean, results: string[]) =>
    JSON.stringify({ ...header, complete }).slice(0, -1) + ',"results":[' + results.join(',') + ']}\n'
  let size = Buffer.byteLength(envelope(false, []))
  let complete = true
  const results: string[] = []
  for (const item of items) {
    const identity = { id: item.id, selector: item.selector }
    let result: unknown
    try {
      const response = (readItem as (artifact: SourceAuditEvidenceArtifact, item: BatchItem) => unknown)(artifact, item)
      if (response === undefined) throw new Error('AUDIT_BATCH_MISSING_RESULT: Selector returned no evidence.')
      result = { ...identity, status: 'ok', response }
    } catch (error) {
      complete = false
      result = { ...identity, status: 'error', error: { code: errorCode(error), exitCode: 2 } }
    }
    const serialized = JSON.stringify(result)
    size += Buffer.byteLength(serialized) + (results.length === 0 ? 0 : 1)
    if (size > MAX_OUTPUT_BYTES) {
      throw new Error('AUDIT_BATCH_OUTPUT_LIMIT: Serialized responses exceed 8 MiB.')
    }
    results.push(serialized)
  }
  return { json: envelope(complete, results), complete }
}
