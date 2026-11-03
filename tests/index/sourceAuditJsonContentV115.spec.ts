import { createHash } from 'node:crypto'
import fs, { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { readSourceAuditEvidence } from '../../src/lookup/readSourceAuditEvidence.js'
import { findExactFileOccurrences } from '../../src/source/findExactMatches.js'
import { SOURCE_AUDIT_EXTRACTOR_CONTRACT_REVISION } from '../../src/indexing/buildSourceAuditEvidence.js'
import { runCli } from '../lookup/testCli.js'

const owned: string[] = []
afterAll(() => { for (const dir of owned) rmSync(dir, { recursive: true, force: true }) })
function project(files: Record<string, string | Buffer>) {
  const root = mkdtempSync(join(tmpdir(), 'kit-json-')); owned.push(root)
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'tests'))
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), content)
  }
  return root
}
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const jsonPath = 'tests/fixtures/payload.json'
// Exact original Lab ambiguous fixture bytes; JSON is raw text, never parsed here.
const labJson = Buffer.from('{}\n')
const labJsonHash = 'ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356'
async function build(root: string, extra: Record<string, unknown> = {}) {
  const out = join(root, 'out')
  await runIndexCommand({ root, src: ['src', 'tests'], out, ...extra })
  return out
}
function query(out: string, filePath = jsonPath, value = 'from') {
  return findExactFileOccurrences({ artifact: readSourceAuditEvidence(out), filePath, value, contextLines: 1 })
}
const fileRecord = (out: string, filePath = jsonPath) => readSourceAuditEvidence(out).files.find(f => f.path === filePath)
const contents = (out: string, file: string) => readFileSync(join(out, file))

describe('selected JSON test-content source evidence', () => {
  it('authenticates the exact Lab payload while keeping semantic parsing unsupported', async () => {
    expect(digest(labJson)).toBe(labJsonHash)
    const root = project({ 'src/peer.ts': 'export const peer = 1;\n', [jsonPath]: labJson })
    const out = await build(root)
    const artifact = readSourceAuditEvidence(out)
    const file = artifact.files.find(f => f.path === jsonPath)!
    expect(file).toMatchObject({ status: 'unsupported', language: 'unsupported', analyzerId: null, contentSha256: labJsonHash, facts: [] })
    expect(Object.values(file.capabilities).every(status => status === 'unsupported')).toBe(true)
    expect(query(out)).toMatchObject({ complete: true, reasonCode: null, matchCount: 0, scannedBytes: 3 })
    expect(query(out, jsonPath, '{}')).toMatchObject({ complete: true, matchCount: 1, matches: [{ line: 1, column: 1, content: '{}' }] })
    const index = JSON.parse(readFileSync(join(out, 'symbol-index.json'), 'utf8'))
    const graph = JSON.parse(readFileSync(join(out, 'code-graph.json'), 'utf8'))
    expect(index.files.some((f: { path: string }) => f.path === jsonPath)).toBe(false)
    expect(graph.nodes.some((n: { path: string }) => n.path === jsonPath)).toBe(false)
    const manifest = JSON.parse(contents(out, 'manifest.json').toString('utf8'))
    expect(manifest.sourceAuditEvidence.sha256).toBe(digest(contents(out, 'source-audit-evidence.json')))
    expect(manifest.sourceAuditEvidence.snapshotId).toBe(artifact.source.snapshotId)
    expect(SOURCE_AUDIT_EXTRACTOR_CONTRACT_REVISION).toBe('source-audit-v1.3.0')
  })

  it('uses the same exact-file CLI authority without exposing JSON through other source modes', async () => {
    const out = await build(project({ 'src/peer.ts': 'export const peer = 1;\n', [jsonPath]: '// RAW_JSON_NEEDLE\r\n{"raw":"RAW_JSON_NEEDLE"}\r\n' }))
    const exact = runCli(['source', '--index', out, '--file', jsonPath, '--contains', 'RAW_JSON_NEEDLE', '--json'])
    expect(exact.status).toBe(0)
    expect(JSON.parse(exact.stdout)).toMatchObject({ complete: true, matchCount: 2, matches: [{ line: 1, column: 4 }, { line: 2, column: 9 }] })
    const global = runCli(['source', '--index', out, '--contains', 'RAW_JSON_NEEDLE', '--json'])
    expect(global.status).toBe(0)
    expect(JSON.parse(global.stdout).files).toEqual([])
    expect(runCli(['source', '--index', out, '--file', jsonPath, '--start', '1', '--end', '1', '--json']).status).toBe(2)
  })

  it.each(['tests/nested/payload.JSON', 'src/test/data.json', 'src/__tests__/data.json', 'src/fixtures/data.json'])(
    'authenticates selected whole-directory test/fixture path %s', async file => {
      const bytes = Buffer.from('{ "z":2, "a":"from" }\r\n')
      const out = await build(project({ [file]: bytes }))
      expect(fileRecord(out, file)).toMatchObject({ path: file, contentSha256: digest(bytes), status: 'unsupported' })
      expect(query(out, file)).toMatchObject({ complete: true, matchCount: 1 })
    })

  it('does not grant raw content to metadata, unrelated JSON, generated or vendor files', async () => {
    const ineligible = ['package.json', 'src/settings.json', 'src/contests/payload.json', 'tests/package-lock.json',
      'tests/package.json', 'tests/tsconfig.json', 'tests/generated/payload.json', 'tests/vendor/payload.json']
    const root = project(Object.fromEntries(ineligible.map(file => [file, '{}\n'])))
    const out = join(root, 'out')
    await runIndexCommand({ root, src: ['.'], out })
    for (const file of ineligible) {
      expect(fileRecord(out, file)?.contentSha256).toBeNull()
      expect(query(out, file)).toMatchObject({ complete: false, reasonCode: 'CONTENT_HASH_UNAVAILABLE' })
    }
  })

  it.each(['build', 'dist', 'node_modules', 'target', '.cache'])('keeps default-ignored %s content unselected', async dir => {
    const file = `tests/${dir}/payload.json`
    const out = await build(project({ [file]: '{}\n' }))
    expect(fileRecord(out, file)).toBeUndefined()
    expect(() => query(out, file)).toThrow(/selected/)
  })

  it('honors source-root selection and user exclusions', async () => {
    const root = project({ [jsonPath]: labJson, 'fixtures/outside.json': labJson, 'src/ok.ts': 'export const ok = 1\n' })
    const out = await build(root, { exclude: ['tests/fixtures'] })
    expect(fileRecord(out)).toBeUndefined()
    expect(() => query(out)).toThrow(/selected/)
    expect(() => query(out, 'fixtures/outside.json')).toThrow(/selected/)
    expect(runCli(['source', '--index', out, '--file', jsonPath, '--contains', '{}', '--json']).status).toBe(2)
  })

  it.each([
    ['invalid UTF-8', Buffer.from([123, 255, 125])],
    ['NUL/binary', Buffer.from([123, 0, 125])],
    ['oversized', Buffer.alloc(200001, 120)],
  ] as const)('never authenticates complete textual evidence for %s', async (_label, bytes) => {
    const out = await build(project({ [jsonPath]: bytes }))
    expect(fileRecord(out)).toMatchObject({ status: 'unsupported', contentSha256: null, sizeBytes: bytes.length })
    expect(query(out)).toMatchObject({ complete: false, reasonCode: 'CONTENT_HASH_UNAVAILABLE', matchCount: 0, scannedBytes: 0 })
  })

  it('examines the exact 200000-byte boundary without truncating or normalizing bytes', async () => {
    const bytes = Buffer.from('x'.repeat(199996) + 'from')
    const out = await build(project({ [jsonPath]: bytes }))
    expect(fileRecord(out)?.contentSha256).toBe(digest(bytes))
    expect(query(out)).toMatchObject({ complete: true, scannedBytes: 200000, matchCount: 1, matches: [{ line: 1, column: 199997 }] })
    expect(query(out, jsonPath, 'absent')).toMatchObject({ complete: true, matchCount: 0 })
  })

  it('retains the match cap and context bounds for raw JSON', async () => {
    const out = await build(project({ [jsonPath]: 'from\n'.repeat(201) }))
    const capped = findExactFileOccurrences({ artifact: readSourceAuditEvidence(out), filePath: jsonPath, value: 'from', contextLines: 500 })
    expect(capped).toMatchObject({ complete: false, reasonCode: 'MATCHES_TRUNCATED', matchCount: 201, returnedMatches: 200 })
    expect(capped.matches[100].windowEnd - capped.matches[100].windowStart).toBe(80)
  })

  it.each(['modified', 'deleted', 'nonregular'] as const)('rejects %s selected JSON after indexing with CLI exit 2', async state => {
    const root = project({ [jsonPath]: labJson }); const out = await build(root)
    if (state === 'modified') writeFileSync(join(root, jsonPath), '[]\n')
    else { rmSync(join(root, jsonPath)); if (state === 'nonregular') mkdirSync(join(root, jsonPath)) }
    expect(() => query(out)).toThrow()
    expect(runCli(['source', '--index', out, '--file', jsonPath, '--contains', '{}', '--json']).status).toBe(2)
  })

  it('rejects traversal and unknown paths', async () => {
    const out = await build(project({ [jsonPath]: labJson }))
    for (const file of ['../payload.json', 'tests/../payload.json', '/payload.json', 'tests\\fixtures\\payload.json', 'tests/fixtures/unknown.json']) {
      expect(() => query(out, file)).toThrow()
    }
  })

  it.for(['file', 'junction'] as const)('rejects physical %s escape where supported', async (kind, context) => {
    const root = project({ [jsonPath]: labJson }); const outside = project({ 'payload.json': labJson })
    const out = await build(root)
    const link = kind === 'file' ? join(root, jsonPath) : join(root, 'tests/fixtures')
    rmSync(link, { recursive: true })
    try { symlinkSync(kind === 'file' ? join(outside, 'payload.json') : outside, link, kind === 'file' ? 'file' : 'junction') }
    catch { context.skip(); return } // Explicit platform skip if link creation is refused.
    expect(() => query(out)).toThrow()
    expect(runCli(['source', '--index', out, '--file', jsonPath, '--contains', '{}', '--json']).status).toBe(2)
  })

  it('rejects content substitution during the descriptor read', async () => {
    const root = project({ [jsonPath]: labJson }); const out = await build(root)
    const original = fs.readSync
    const spy = vi.spyOn(fs, 'readSync').mockImplementation((...args: Parameters<typeof fs.readSync>) => {
      const count = original(...args)
      writeFileSync(join(root, jsonPath), '[]\n')
      return count
    })
    try { expect(() => query(out)).toThrow(/substitution|changed/) } finally { spy.mockRestore() }
  })

  it.each(['artifact', 'manifest-pointer', 'missing-artifact', 'missing-reference'] as const)('rejects %s evidence', async damage => {
    const out = await build(project({ [jsonPath]: labJson }))
    if (damage === 'artifact') writeFileSync(join(out, 'source-audit-evidence.json'), '{}')
    else if (damage === 'missing-artifact') rmSync(join(out, 'source-audit-evidence.json'))
    else {
      const manifest = JSON.parse(contents(out, 'manifest.json').toString('utf8'))
      if (damage === 'missing-reference') delete manifest.sourceAuditEvidence
      else manifest.sourceAuditEvidence.path = '../source-audit-evidence.json'
      writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest))
    }
    expect(() => query(out)).toThrow()
    expect(runCli(['source', '--index', out, '--file', jsonPath, '--contains', '{}', '--json']).status).toBe(2)
  })

  it('refreshes JSON-only edits, additions and removals without changing semantic artifact bytes', async () => {
    const root = project({ 'src/peer.ts': 'export const peer = 1;\n', [jsonPath]: labJson })
    const out = await build(root, { incremental: true })
    const symbol = contents(out, 'symbol-index.json'); const graph = contents(out, 'code-graph.json')
    const first = readSourceAuditEvidence(out).source.snapshotId
    const repeat = await runIndexCommand({ root, src: ['src', 'tests'], out, incremental: true })
    expect(repeat.mode === 'index' && repeat.cache?.mode).toBe('incremental-no-change')
    expect(readSourceAuditEvidence(out).source.snapshotId).toBe(first)
    writeFileSync(join(root, jsonPath), '{"new":"from"}\n')
    await build(root, { incremental: true })
    expect(query(out)).toMatchObject({ complete: true, matchCount: 1 })
    expect(fileRecord(out)?.contentSha256).toBe(digest('{"new":"from"}\n'))
    expect(readSourceAuditEvidence(out).source.snapshotId).not.toBe(first)
    const added = 'tests/fixtures/added.json'; writeFileSync(join(root, added), '// raw from\n')
    await build(root, { incremental: true })
    expect(query(out, added)).toMatchObject({ complete: true, matchCount: 1 })
    rmSync(join(root, jsonPath)); await build(root, { incremental: true })
    expect(fileRecord(out)).toBeUndefined(); expect(() => query(out)).toThrow(/selected/)
    expect(contents(out, 'symbol-index.json')).toEqual(symbol)
    expect(contents(out, 'code-graph.json')).toEqual(graph)
    const manifest = JSON.parse(contents(out, 'manifest.json').toString('utf8'))
    const cache = JSON.parse(contents(out, 'cache-metadata.json').toString('utf8'))
    expect(cache.cacheSchemaVersion).toBe('1.4.0')
    expect(cache.baselineArtifacts.manifestSha256).toBe(digest(contents(out, 'manifest.json')))
    expect(manifest.sourceAuditEvidence.sha256).toBe(digest(contents(out, 'source-audit-evidence.json')))
    await runIndexCommand({ root, src: ['src', 'tests'], out: join(root, 'full') })
    expect(readSourceAuditEvidence(join(root, 'full'))).toEqual(readSourceAuditEvidence(out))
  })

  it('refreshes excluded or newly invalid JSON and invalidates old cache configuration', async () => {
    const root = project({ [jsonPath]: labJson, 'src/a.ts': 'export const a = 1\n' })
    const out = await build(root, { incremental: true })
    writeFileSync(join(root, jsonPath), Buffer.alloc(200001, 120)); await build(root, { incremental: true })
    expect(fileRecord(out)?.contentSha256).toBeNull(); expect(query(out).complete).toBe(false)
    writeFileSync(join(root, jsonPath), labJson); await build(root, { incremental: true })
    expect(query(out).complete).toBe(true)
    await build(root, { incremental: true, exclude: ['fixtures'] })
    expect(fileRecord(out)).toBeUndefined()
    await runIndexCommand({ root, src: ['src'], out, incremental: true })
    expect(fileRecord(out)).toBeUndefined()
    const cachePath = join(out, 'cache-metadata.json')
    const cache = JSON.parse(readFileSync(cachePath, 'utf8')); cache.configFingerprint = '0'.repeat(64)
    writeFileSync(cachePath, JSON.stringify(cache))
    const rebuilt = await runIndexCommand({ root, src: ['src'], out, incremental: true })
    expect(rebuilt.mode === 'index' && rebuilt.cache?.mode).toBe('incremental-full-config-changed')
  })
})
