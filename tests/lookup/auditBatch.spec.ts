import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { readAuditBatch } from '../../src/lookup/readAuditBatch.js'
import {
  readFreshSourceAuditFilePage, readSourceAuditEvidence,
} from '../../src/lookup/readSourceAuditEvidence.js'
import { runCli } from './testCli.js'

const roots: string[] = []
const sourcePath = 'src/marker.ts'
const original = 'export const marker = 1\r\nexport const peer = 2\r\n'
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function fixture() {
  // CI can expose the temporary directory through a symlink or junction.
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'kit-audit-batch-')))
  roots.push(root)
  const project = join(root, 'p')
  mkdirSync(join(project, 'src'), { recursive: true })
  const source = join(project, sourcePath)
  writeFileSync(source, original)
  const index = join(root, 'i')
  await runIndexCommand({ root: project, src: ['src'], out: index, sourceAuditSchema: '1.2.0' })
  const audit = readSourceAuditEvidence(index)
  const input = join(root, 'batch.json')
  const writeRequest = (family: 'source' | 'lookup', requests: unknown[]) => writeFileSync(input, JSON.stringify({
    schemaVersion: '1.0.0', mode: 'audit-batch-request', family, expectedSnapshotId: audit.source.snapshotId,
    selectionFingerprint: audit.source.selectionFingerprint, requests,
  }))
  return { root, project, source, index, input, writeRequest }
}

describe('bounded audit batches', () => {
  it('preserves the installed source selectors’ JSON responses and binds ordered IDs to exact input bytes', async () => {
    const f = await fixture()
    const items = [
      { selector: 'line-range', id: 'range', path: sourcePath, start: 1, end: 2 },
      { selector: 'exact-file-occurrence', id: 'text', path: sourcePath, literal: 'peer' },
      { selector: 'exact-file-byte-occurrence', id: 'bytes', path: sourcePath, needleHex: '0d0a' },
    ]
    f.writeRequest('source', items)
    const cli = (...args: string[]) => runCli(['source', '--index', f.index, ...args, '--json'])
    const batch = cli('--audit-batch-file', f.input)
    const rawResults = [
      cli('--file', sourcePath, '--start', '1', '--end', '2'),
      cli('--file', sourcePath, '--contains', 'peer'),
      cli('--file', sourcePath, '--contains-bytes-hex', '0d0a'),
    ]
    expect(batch.status, batch.stderr).toBe(0)
    for (const raw of rawResults) expect(raw.status, raw.stderr).toBe(0)
    expect(JSON.parse(batch.stdout)).toMatchObject({
      schemaVersion: '1.0.0', mode: 'audit-batch', family: 'source',
      inputSha256: createHash('sha256').update(readFileSync(f.input)).digest('hex'),
      requestedCount: 3, returnedCount: 3, complete: true,
    })
    expect(JSON.parse(batch.stdout).results).toEqual(items.map(({ id, selector }, i) => ({
      id, selector, status: 'ok', response: JSON.parse(rawResults[i]!.stdout),
    })))
    expect(cli('--audit-batch-file', f.input, '--file', sourcePath).status).toBe(2)
  }, 30_000)

  it.each(['edit', 'delete', 'rename', 'junction'])('checks live bytes again after a between-item %s', async (action) => {
    const f = await fixture()
    const selector = 'audit-file'
    f.writeRequest('lookup', [
      { id: 'before', selector, path: sourcePath },
      { id: 'after', selector, path: sourcePath },
    ])
    const result = readAuditBatch(f.index, f.input, 'lookup', (artifact, item) => {
      if (item.selector !== 'audit-file') throw new Error('Unexpected selector')
      if (item.id === 'after') {
        const outside = join(f.root, 'outside')
        switch (action) {
          case 'edit': writeFileSync(f.source, original.replace('marker = 1', 'marker = 9')); break
          case 'delete': rmSync(f.source); break
          case 'rename': renameSync(f.source, join(f.root, 'old.ts')); break
          case 'junction':
            renameSync(join(f.project, 'src'), outside)
            symlinkSync(outside, join(f.project, 'src'), 'junction')
            break
        }
      }
      return readFreshSourceAuditFilePage(artifact, item.path, item.page ?? 0)
    })
    expect(result.complete).toBe(false)
    const response = JSON.parse(result.json)
    expect(response.results[0]).toMatchObject({ id: 'before', status: 'ok' })
    expect(response.results[1]).toEqual({
      id: 'after', selector, status: 'error',
      error: { exitCode: 2, code: action === 'junction' ? 'INVALID_AUDIT_PATH' : 'STALE_SOURCE_EVIDENCE' },
    })
  })

  it('rejects duplicate IDs and discards output on overflow', async () => {
    const f = await fixture()
    const item = { id: 'first', selector: 'audit-files' }
    f.writeRequest('lookup', [item, item])
    expect(() => readAuditBatch(f.index, f.input, 'lookup', () => {
      throw new Error('Unexpected item execution')
    })).toThrow(/Duplicate request ID/)
    f.writeRequest('lookup', [item, { ...item, id: 'second' }])
    const body = 'x'.repeat(4 * 1024 * 1024)
    expect(() => readAuditBatch(f.index, f.input, 'lookup', () => ({ body }))).toThrow(/AUDIT_BATCH_OUTPUT_LIMIT/)
  })
})
