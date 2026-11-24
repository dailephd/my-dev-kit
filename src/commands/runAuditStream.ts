import path from 'node:path'
import { performance } from 'node:perf_hooks'
import type { Command } from 'commander'
import type { SourceAuditEvidenceArtifact } from '../symbol-index/auditEvidenceTypes.js'
import {
  AUDIT_BATCH_MAX_INPUT,
  AUDIT_BATCH_MAX_OUTPUT,
  auditErrorCode,
  decodeAuditRequest,
  executeAuditBatch,
  validateAuditRequests,
  type AuditBatchFamily,
  type AuditBatchItemByFamily,
} from '../lookup/readAuditBatch.js'
import { createSourceAuditFrameReader } from '../lookup/readSourceAuditEvidence.js'
import { writeAuditJson } from './emitAuditBatch.js'

const MAX_FRAMES = 8192
const IDLE_MS = 60_000
const OUTPUT_MS = 30_000
const LIFETIME_MS = 100 * 60_000

class FrameError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

export function assertAuditStreamOptions(command: Command, options: { index: string; json?: boolean }): void {
  const allowed = new Set(['index', 'auditStream', 'json'])
  if (!options.json || !path.isAbsolute(options.index) ||
      Object.keys(options).some(key => !allowed.has(key) && command.getOptionValueSource(key) === 'cli')) {
    throw new Error('INVALID_AUDIT_STREAM_SELECTOR: --audit-stream requires an absolute --index, --json, and no other selectors or output options.')
  }
}

type InputFrame = { bytes: Uint8Array } | { error: string }

/** Keeps only the unfinished line and lets stdout backpressure stop further stdin consumption. */
async function* inputFrames(): AsyncGenerator<InputFrame> {
  const buffer = Buffer.alloc(AUDIT_BATCH_MAX_INPUT)
  let length = 0
  for await (const chunk of process.stdin) {
    const bytes: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    let offset = 0
    while (offset < bytes.length) {
      const newline = bytes.indexOf(0x0a, offset)
      const end = newline < 0 ? bytes.length : newline
      if (length + end - offset > buffer.length) {
        yield { error: 'AUDIT_STREAM_INPUT_LIMIT' }
        return
      }
      bytes.copy(buffer, length, offset, end)
      length += end - offset
      if (newline < 0) break
      yield { bytes: buffer.subarray(0, length) }
      length = 0
      offset = end + 1
    }
  }
  if (length > 0) yield { error: 'AUDIT_STREAM_TRUNCATED_FRAME' }
}

function frameRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new FrameError('AUDIT_STREAM_INVALID_FRAME')
  return input as Record<string, unknown>
}

function frameId(value: unknown): string {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,64}$/.test(value)) throw new FrameError('AUDIT_STREAM_INVALID_REQUEST_ID')
  return value
}

export async function runAuditStream<F extends AuditBatchFamily>(
  family: F,
  read: ReturnType<typeof createSourceAuditFrameReader>,
  createItemReader: () => (artifact: SourceAuditEvidenceArtifact, item: AuditBatchItemByFamily[F]) => unknown,
): Promise<void> {
  const seen = new Set<string>()
  const deadline = performance.now() + LIFETIME_MS
  let readingTimeout: NodeJS.Timeout | undefined

  const failure = (requestId: string | null, code: string, fatal: boolean) => {
    process.exitCode = 2
    return JSON.stringify({ schemaVersion: '1.0.0', requestId, status: 'incomplete', error: { code, fatal } }) + '\n'
  }
  const send = (json: string) => writeAuditJson(json, OUTPUT_MS)
  const frames = inputFrames()
  try {
    for (;;) {
      const remaining = deadline - performance.now()
      if (remaining <= 0) {
        await send(failure(null, 'AUDIT_STREAM_TIMEOUT', true))
        return
      }

      let frame: IteratorResult<InputFrame>
      readingTimeout = setTimeout(
        () => process.stdin.destroy(new FrameError('AUDIT_STREAM_TIMEOUT')), Math.min(IDLE_MS, remaining),
      )
      try {
        frame = await frames.next()
      } catch (error) {
        await send(failure(null, error instanceof FrameError ? error.code : 'AUDIT_STREAM_INPUT_FAILED', true))
        return
      } finally {
        clearTimeout(readingTimeout)
      }
      if (frame.done) return
      if ('error' in frame.value) {
        await send(failure(null, frame.value.error, true))
        return
      }

      let requestId: string | null = null
      let json: string
      let fatal = false
      try {
        const input = frameRecord(decodeAuditRequest(frame.value.bytes))
        requestId = frameId(input.requestId)
        if (input.schemaVersion !== '1.0.0' || Object.keys(input).length !== 3 || !Object.hasOwn(input, 'requests')) {
          throw new FrameError('AUDIT_STREAM_INVALID_FRAME')
        }
        if (seen.has(requestId)) throw new FrameError('AUDIT_STREAM_DUPLICATE_REQUEST_ID')
        if (seen.size === MAX_FRAMES) throw new FrameError('AUDIT_STREAM_FRAME_LIMIT')
        const items = validateAuditRequests(input.requests, family)
        seen.add(requestId)
        const { artifact, assertCurrent } = read()
        const batch = executeAuditBatch(artifact, frame.value.bytes, family, items, createItemReader())
        assertCurrent()
        if (performance.now() >= deadline) throw new FrameError('AUDIT_STREAM_TIMEOUT')
        const prefix = JSON.stringify({ schemaVersion: '1.0.0', requestId, status: batch.complete ? 'complete' : 'incomplete' }).slice(0, -1)
        if (Buffer.byteLength(prefix) + Buffer.byteLength(batch.json) + ',"batch":}'.length > AUDIT_BATCH_MAX_OUTPUT) {
          throw new FrameError('AUDIT_BATCH_OUTPUT_LIMIT')
        }
        json = prefix + ',"batch":' + batch.json.slice(0, -1) + '}\n'
        if (!batch.complete) process.exitCode = 2
      } catch (error) {
        const code = error instanceof FrameError ? error.code : auditErrorCode(error)
        fatal = code !== 'AUDIT_BATCH_OUTPUT_LIMIT'
        json = failure(requestId, code, fatal)
      }
      await send(json)
      if (fatal) return
    }
  } catch {
    process.exitCode = 2
    process.stderr.write('AUDIT_STREAM_OUTPUT_FAILED: Could not write the complete response frame.\n')
  } finally {
    clearTimeout(readingTimeout)
    process.stdin.destroy()
    await frames.return(undefined)
  }
}
