import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { afterEach, expect, it } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { readSourceAuditEvidence } from '../../src/lookup/readSourceAuditEvidence.js'
import { cliArgs } from '../lookup/testCli.js'

const scratch: string[] = []
afterEach(() => {
  for (const folder of scratch.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})

async function fixture(prefix = '') {
  const root = fs.mkdtempSync(join(tmpdir(), 'kit-stream-'))
  scratch.push(root)
  const target = join(root, 'p')
  fs.mkdirSync(join(target, 'src'), { recursive: true })
  const source = join(target, 'src', 'a.ts')
  fs.writeFileSync(source, prefix + 'export const probe = "yes"\r\n')
  fs.writeFileSync(join(target, 'src', 'b.ts'), 'export const other = "yes"\n')
  const index = join(root, 'i')
  await runIndexCommand({ root: target, src: ['src'], out: index, sourceAuditSchema: '1.2.0' })
  return { root, target, source, index }
}

it('matches the standalone ordinary proof and rechecks premises on later frames', async () => {
  const f = await fixture('import "./b.js"\r\n')
  const artifact = readSourceAuditEvidence(f.index)
  const factId = artifact.files.find(file => file.path === 'src/a.ts')!.facts.find(fact => fact.sourceSpecifier === './b.js')!.id
  const item = { id: 'ordinary', selector: 'audit-import-target', factId }
  const standalone = spawnSync(process.execPath, cliArgs(['lookup', '--index', f.index, '--audit-import-target', factId, '--json']),
    { encoding: 'utf8', windowsHide: true })
  expect(standalone.status, standalone.stderr).toBe(0)
  const proof = JSON.parse(standalone.stdout)
  expect(proof.sourceReferenceProof).toMatchObject({
    candidateDomain: ['src/b.js', 'src/b.ts', 'src/b.tsx'], qualifiedReference: { targetPath: 'src/b.ts' },
  })
  const lookup = open(f.index)
  try {
    const first = await lookup.send(frame('initial', [item]))
    expect(first.batch.results).toEqual([{ id: item.id, selector: item.selector, status: 'ok', response: proof }])
    fs.writeFileSync(join(f.target, 'src/b.js'), 'export const extra = 1\n')
    const second = await lookup.send(frame('changed', [item]))
    expect(second.batch.results[0].response.sourceReferenceProof).toMatchObject({
      candidateEnumerationComplete: false, candidateDomain: null, qualifiedReference: null,
    })
    expect(await lookup.end()).toBe(0)
  } finally { lookup.kill() }
}, 30_000)

const frame = (requestId: string, requests: unknown[]) => JSON.stringify({ schemaVersion: '1.0.0', requestId, requests })
const fact = (path: string) => ({ selector: 'audit-file', id: path, path })
const inventory = [{ selector: 'audit-files', id: 'p0' }]

it('returns equivalent computed witnesses over standalone, batch and stream lookups', async () => {
  const f = await fixture('const prefix = "./"; void import(prefix + "b.ts")\r\n')
  const artifact = readSourceAuditEvidence(f.index)
  const factId = artifact.files.find(file => file.path === 'src/a.ts')!.facts.find(entry => entry.kind === 'dynamic-import-expression')!.id
  const item = { id: 'computed', selector: 'audit-import-domain', factId }
  const prefix = ['lookup', '--index', f.index, '--json']
  const run = (selector: string, value: string) => spawnSync(process.execPath, cliArgs([...prefix, selector, value]),
    { encoding: 'utf8', windowsHide: true })
  const single = run('--audit-import-domain', factId)
  expect(single.status, single.stderr).toBe(0)
  const proof = JSON.parse(single.stdout)
  expect(proof).toMatchObject({
    qualifiedPositiveWitnesses: [],
    expressionReferenceProof: { expressionFactId: factId, targetPath: 'src/b.ts', premiseIndexes: [0, 1] },
  })
  const file = join(f.root, 'batch.json')
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: '1.0.0', mode: 'audit-batch-request', family: 'lookup', expectedSnapshotId: artifact.source.snapshotId,
    selectionFingerprint: artifact.source.selectionFingerprint, requests: [item],
  }))
  const batch = run('--audit-batch-file', file)
  expect(batch.status, batch.stderr).toBe(0)
  const results = [{ id: item.id, selector: item.selector, status: 'ok', response: proof }]
  expect(JSON.parse(batch.stdout).results).toEqual(results)
  const lookup = open(f.index)
  try {
    expect((await lookup.send(frame('initial-computed', [item]))).batch.results).toEqual(results)
    fs.writeFileSync(join(f.target, 'src/jsconfig.json'), '{}')
    const after = (await lookup.send(frame('new-config', [item]))).batch.results[0].response
    expect(after).toMatchObject({ domainComplete: true, operandAlternatives: [{ resolution: { candidateEnumerationComplete: false } }] })
    expect(after).not.toHaveProperty('expressionReferenceProof')
    expect(await lookup.end()).toBe(0)
  } finally { lookup.kill() }
}, 30_000)

function open(index: string, family = 'lookup') {
  const processHandle = spawn(process.execPath, cliArgs([family, '--index', index, '--audit-stream', '--json']), { windowsHide: true })
  const lines = createInterface({ input: processHandle.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]()
  let stderr = ''
  processHandle.stderr.setEncoding('utf8').on('data', data => { stderr += data })
  const done = new Promise<number | null>((resolve, reject) => {
    processHandle.on('error', reject)
    processHandle.on('close', resolve)
  })
  return {
    async send(body: string) {
      processHandle.stdin.write(body + '\n')
      const next = await lines.next()
      expect(next.done, stderr).toBe(false)
      return JSON.parse(next.value!)
    },
    async end() {
      processHandle.stdin.end()
      const exit = await done
      expect(stderr).toBe('')
      expect((await lines.next()).done).toBe(true)
      return exit
    },
    kill() { processHandle.kill() },
  }
}

it('correlates a dependent frame and preserves the standalone batch item', async () => {
  const f = await fixture()
  const lookup = open(f.index)
  try {
    const first = await lookup.send(frame('first', inventory))
    const file = first.batch.results[0].response.files[0].path
    const raw = frame('second', [fact(file)])
    const next = await lookup.send(raw)
    expect(next).toMatchObject({
      schemaVersion: '1.0.0', requestId: 'second', status: 'complete',
      batch: { inputSha256: createHash('sha256').update(raw).digest('hex'), complete: true },
    })
    const single = spawnSync(process.execPath, cliArgs(['lookup', '--index', f.index, '--audit-file', file, '--json']),
      { encoding: 'utf8', windowsHide: true })
    expect(single.status, single.stderr).toBe(0)
    expect(next.batch.results).toEqual([{ id: file, selector: 'audit-file', status: 'ok', response: JSON.parse(single.stdout) }])
    expect(await lookup.end()).toBe(0)
  } finally { lookup.kill() }
}, 30_000)

it('keeps a changed origin and its successful-looking sibling inside an incomplete response', async () => {
  const f = await fixture()
  const lookup = open(f.index)
  try {
    expect((await lookup.send(frame('before', [fact('src/a.ts')]))).status).toBe('complete')
    fs.writeFileSync(f.source, 'export const probe = "no"\n')
    const after = await lookup.send(frame('after', [fact('src/a.ts'), fact('src/b.ts')]))
    expect(after).toMatchObject({ status: 'incomplete', batch: { complete: false } })
    expect(after.batch.results[0]).toMatchObject({ status: 'error', error: { code: 'STALE_SOURCE_EVIDENCE' } })
    expect(after.batch.results[0]).not.toHaveProperty('response')
    expect((await lookup.send(frame('independent', [fact('src/b.ts')]))).status).toBe('complete')
    expect(await lookup.end()).toBe(2)
  } finally { lookup.kill() }
}, 30_000)

it.each(['manifest.json', 'source-audit-evidence.json', 'symbol-index.json'])(
  'fails closed on a same-byte replacement of %s between frames', async file => {
    const f = await fixture()
    const source = open(f.index, 'source')
    const range = [{ id: 'range', selector: 'line-range', path: 'src/a.ts', start: 1, end: 1 }]
    try {
      expect((await source.send(frame('before', range))).status).toBe('complete')
      const artifact = join(f.index, file)
      fs.renameSync(artifact, join(f.root, 'removed'))
      fs.copyFileSync(join(f.root, 'removed'), artifact)
      expect(await source.send(frame('after', range))).toEqual({
        schemaVersion: '1.0.0', requestId: 'after', status: 'incomplete',
        error: { code: 'AUDIT_EVIDENCE_INVALID', fatal: true },
      })
      expect(await source.end()).toBe(2)
    } finally { source.kill() }
  }, 30_000,
)

it('rejects oversized and truncated input and refuses incompatible selectors', async () => {
  const f = await fixture()
  const run = (input: string, extra: string[] = []) => spawnSync(process.execPath,
    cliArgs(['lookup', '--index', f.index, '--audit-stream', '--json', ...extra]), {
      encoding: 'utf8', windowsHide: true, input, timeout: 20_000,
    })
  const oversized = run('x'.repeat(65_537))
  expect(oversized.status).toBe(2)
  expect(JSON.parse(oversized.stdout)).toMatchObject({ status: 'incomplete', error: { code: 'AUDIT_STREAM_INPUT_LIMIT', fatal: true } })
  const truncated = run(frame('eof', inventory))
  expect(truncated.status).toBe(2)
  expect(JSON.parse(truncated.stdout)).toMatchObject({ error: { code: 'AUDIT_STREAM_TRUNCATED_FRAME' } })
  const conflict = run('', ['--audit-files'])
  expect(conflict.status).toBe(2)
  expect(conflict.stdout).toBe('')
  expect(conflict.stderr).toMatch(/^INVALID_AUDIT_STREAM_SELECTOR:/)
}, 30_000)

it('rejects duplicate frame IDs even when pipelined', async () => {
  const f = await fixture()
  const input = frame('repeat', inventory) + '\n'
  const result = spawnSync(process.execPath, cliArgs(['lookup', '--index', f.index, '--audit-stream', '--json']), {
    encoding: 'utf8', windowsHide: true, input: input + input + frame('late', inventory) + '\n', timeout: 20_000,
  })
  expect(result.status, result.stderr).toBe(2)
  const responses = result.stdout.trimEnd().split('\n').map(line => JSON.parse(line))
  expect(responses).toHaveLength(2)
  expect(responses[0]).toMatchObject({ requestId: 'repeat', status: 'complete' })
  expect(responses[1]).toMatchObject({ requestId: 'repeat', status: 'incomplete', error: { code: 'AUDIT_STREAM_DUPLICATE_REQUEST_ID', fatal: true } })
}, 30_000)
