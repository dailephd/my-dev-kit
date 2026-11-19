import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { readSourceAuditEvidence } from '../../src/lookup/readSourceAuditEvidence.js'
import { findExactByteMatches } from '../../src/source/findExactByteMatches.js'
import { findExactFileOccurrences } from '../../src/source/findExactMatches.js'
import { runCli } from '../lookup/testCli.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

function project(files: Record<string, string | Buffer>) {
  const root = mkdtempSync(join(tmpdir(), 'kit-b2-bytes-'))
  roots.push(root)
  mkdirSync(join(root, 'src'))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content)
  return root
}

describe('versioned selected-source byte occurrence', () => {
  it('authenticates non-UTF8, NUL, CRLF and empty bytes without graph or legacy-output changes', async () => {
    const bytes = Buffer.from([0xff, 0, 0, 0, 13, 10])
    const root = project({
      'src/payload.properties': bytes, 'src/empty.txt': '', 'src/text.txt': 'abc\r\nabc\n',
      'src/anchor.ts': 'export const x = 1', 'outside.properties': bytes, 'src/excluded.properties': bytes,
    })
    const legacy = join(root, 'legacy')
    const feature = join(root, 'feature')
    const options = { root, src: ['src'], exclude: ['src/excluded.properties'] }
    await runIndexCommand({ ...options, out: legacy })
    await runIndexCommand({ ...options, out: feature, sourceAuditSchema: '1.2.0' })
    const old = readSourceAuditEvidence(legacy)
    const artifact = readSourceAuditEvidence(feature)
    expect(old.schemaVersion).toBe('1.1.0')
    expect(artifact.schemaVersion).toBe('1.2.0')
    expect(old.files.find(file => file.path === 'src/payload.properties')?.contentSha256).toBeNull()
    expect(artifact.files.find(file => file.path === 'src/payload.properties')).toMatchObject({
      status: 'unsupported', contentSha256: digest(bytes), facts: [], capabilities: { imports: 'unsupported' },
    })
    expect(JSON.parse(readFileSync(join(feature, 'code-graph.json'), 'utf8')).nodes).toEqual(
      JSON.parse(readFileSync(join(legacy, 'code-graph.json'), 'utf8')).nodes,
    )
    const text = (audit: typeof artifact) => findExactFileOccurrences({ artifact: audit, filePath: 'src/text.txt', value: 'abc', contextLines: 0 })
    expect(text(artifact)).toEqual({ ...text(old), snapshotId: artifact.source.snapshotId })
    expect(findExactByteMatches(artifact, 'src/payload.properties', '0000')).toMatchObject({
      matching: 'literal-bytes-overlapping', expectedContentSha256: digest(bytes), verifiedContentSha256: digest(bytes),
      complete: true, matchCount: 2, matches: [{ startByte: 1, endByteExclusive: 3 }, { startByte: 2, endByteExclusive: 4 }],
    })
    expect(findExactByteMatches(artifact, 'src/payload.properties', '0D0A')).toMatchObject({
      needleHex: '0d0a', matches: [{ startByte: 4, endByteExclusive: 6 }],
    })
    expect(findExactByteMatches(artifact, 'src/empty.txt', '00')).toMatchObject({ complete: true, scannedBytes: 0, matchCount: 0 })
    for (const file of ['outside.properties', 'src/excluded.properties', '../outside.properties']) {
      expect(() => findExactByteMatches(artifact, file, '00')).toThrow(/INVALID_AUDIT_PATH/)
    }
    expect(() => findExactByteMatches(old, 'src/payload.properties', '00')).toThrow(/1.2.0/)
    writeFileSync(join(root, 'src/payload.properties'), Buffer.from([0]))
    expect(() => findExactByteMatches(artifact, 'src/payload.properties', '00')).toThrow(/STALE_SOURCE_EVIDENCE/)
  })

  it('enforces scan, needle, overlap-count and returned-match limits', async () => {
    const root = project({
      'src/limit.bin': Buffer.alloc(200000, 0xaa), 'src/over.bin': Buffer.alloc(200001, 0xaa),
      'src/200.bin': Buffer.alloc(200), 'src/201.bin': Buffer.alloc(201),
    })
    const out = join(root, 'out')
    await runIndexCommand({ root, src: ['src'], out, sourceAuditSchema: '1.2.0' })
    const artifact = readSourceAuditEvidence(out)
    const query = (file: string, hex = '00') => findExactByteMatches(artifact, 'src/' + file, hex)
    for (const hex of ['', 'a', 'zz', 'aabb\n', 'aa'.repeat(4097)]) expect(() => query('200.bin', hex)).toThrow(/INVALID_BYTE_NEEDLE/)
    expect(query('limit.bin', '00'.repeat(4096))).toMatchObject({ scanComplete: true, scannedBytes: 200000, matchCount: 0, complete: true })
    expect(query('over.bin')).toMatchObject({ reasonCode: 'FILE_EXCEEDS_SCAN_LIMIT', sourceAuthenticated: false, scannedBytes: 0, verifiedContentSha256: null, complete: false })
    expect(query('200.bin')).toMatchObject({ matchCount: 200, returnedMatches: 200, complete: true })
    expect(query('201.bin')).toMatchObject({ matchCount: 201, matchCountExact: true, returnedMatches: 200, matchesComplete: false, truncated: true, complete: false })
  })

  it('keeps schema mode in cache identity and validates the built selector and manifest linkage', async () => {
    const root = project({ 'src/blob.bin': Buffer.from([255, 0]), 'src/base.ts': 'export const base = 1' })
    const out = join(root, 'out')
    const options = { root, src: ['src'], out, incremental: true }
    await runIndexCommand(options)
    const legacy = readSourceAuditEvidence(out)
    const switched = await runIndexCommand({ ...options, sourceAuditSchema: '1.2.0' })
    expect(switched.mode === 'index' && switched.cache?.mode).toBe('incremental-full-config-changed')
    const current = readSourceAuditEvidence(out)
    expect(current.source.snapshotId).not.toBe(legacy.source.snapshotId)
    await runIndexCommand({ ...options, sourceAuditSchema: '1.2.0' })
    const full = join(root, 'full')
    await runIndexCommand({ ...options, out: full, incremental: false, sourceAuditSchema: '1.2.0' })
    expect(readSourceAuditEvidence(out)).toEqual(readSourceAuditEvidence(full))
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
    expect(manifest.version).toBe('1.0.0')
    expect(manifest.sourceAuditEvidence).toMatchObject({
      schemaVersion: '1.2.0', snapshotId: current.source.snapshotId, sha256: digest(readFileSync(join(out, 'source-audit-evidence.json'))),
    })
    const command = ['source', '--index', out, '--file', 'src/blob.bin', '--contains-bytes-hex', 'ff00', '--json']
    const result = runCli(command)
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ complete: true, matchCount: 1 })
    for (const flag of ['--context', '--start', '--max-lines']) expect(runCli([...command, flag, '1']).status).not.toBe(0)
    expect(runCli([...command, '--contains', 'x']).status).not.toBe(0)
    expect(runCli(['index', '--root', root, '--src', 'src', '--source-audit-schema', '1.3.0', '--json']).status).not.toBe(0)
    manifest.sourceAuditEvidence.schemaVersion = '1.1.0'
    writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest))
    expect(() => readSourceAuditEvidence(out)).toThrow(/schema version/)
  }, 60_000)
})
