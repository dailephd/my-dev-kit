import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { readSourceAuditEvidence, SourceAuditEvidenceError } from '../../src/lookup/readSourceAuditEvidence.js'
import { findExactFileOccurrences, MAX_EXACT_FILE_SCAN_BYTES } from '../../src/source/findExactMatches.js'
import { runCli } from '../lookup/testCli.js'

const tempDirs: string[] = []
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

function makeProject(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v115-exact-occurrence-'))
  tempDirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), content)
  }
  return root
}
async function build(root: string): Promise<string> {
  const out = join(root, 'out')
  await runIndexCommand({ root, src: ['src', 'tests'], out })
  return out
}
function occurrences(out: string, filePath: string, value: string, contextLines = 1) {
  return findExactFileOccurrences({ artifact: readSourceAuditEvidence(out), filePath, value, contextLines })
}
function failure(action: () => unknown): Error {
  try {
    action()
  } catch (caught) {
    return caught as Error
  }
  throw new Error('expected an error')
}
function rewriteArtifact(out: string, mutate: (artifact: any) => void): void {
  const artifactPath = join(out, 'source-audit-evidence.json')
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
  mutate(artifact)
  const text = JSON.stringify(artifact, null, 2) + '\n'
  writeFileSync(artifactPath, text)
  const manifestPath = join(out, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.sourceAuditEvidence.sha256 = createHash('sha256').update(text).digest('hex')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
}

const FILES: Record<string, string> = {
  'tests/one.test.ts': "// seed.json mentioned in a comment\nconst x = 'other'\n",
  'tests/many.test.ts': "const a = 'seed.json'\nconst b = readFile('data/seed.json', 'seed.json')\n",
  'tests/none.test.ts': "const nothing = 'here'\n",
  'tests/test_py.py': "# fixture seed.json\nvalue = open('fixtures/seed.json')\n",
  'tests/JavaTest.java': 'class JavaTest { String f = "fixtures/seed.json"; }\n',
  'tests/KotlinTest.kt': 'class KotlinTest { val f = "fixtures/seed.json" }\n',
  'tests/cmd.test.ts': "it('runs', () => { run('npm run build') })\n",
  'src/ok.ts': 'export const ok = 1\n',
}

describe('v1.15.0 KIT-FACTS-01 exact-file source occurrences', () => {
  it('returns one occurrence in a comment as a raw text match with 1-based positions', async () => {
    const out = await build(makeProject(FILES))
    const result = occurrences(out, 'tests/one.test.ts', 'seed.json', 1)
    expect(result).toMatchObject({
      schemaVersion: '1.0.0', mode: 'exact-file-occurrence', filePath: 'tests/one.test.ts', value: 'seed.json',
      complete: true, reasonCode: null, matchCount: 1, returnedMatches: 1, truncated: false,
    })
    expect(result.snapshotId).toBe(readSourceAuditEvidence(out).source.snapshotId)
    expect(result.matches[0]).toEqual({ line: 1, column: 4, windowStart: 1, windowEnd: 2, content: "// seed.json mentioned in a comment\nconst x = 'other'" })
    expect(Object.keys(result.matches[0]).sort()).toEqual(['column', 'content', 'line', 'windowEnd', 'windowStart'])
    expect(result.scannedBytes).toBe(Buffer.byteLength(FILES['tests/one.test.ts']))
  })

  it('returns multiple occurrences, including two on one line, in source order', async () => {
    const out = await build(makeProject(FILES))
    const result = occurrences(out, 'tests/many.test.ts', 'seed.json', 0)
    expect(result.matchCount).toBe(3)
    const [first, second] = FILES['tests/many.test.ts'].split('\n')
    const columns = [first.indexOf('seed.json') + 1, second.indexOf('seed.json') + 1, second.lastIndexOf('seed.json') + 1]
    expect(columns[1]).not.toBe(columns[2])
    expect(result.matches.map((m) => [m.line, m.column])).toEqual([[1, columns[0]], [2, columns[1]], [2, columns[2]]])
    expect(result.complete).toBe(true)
  })

  it('treats zero matches in a fully examined file as a complete absence proof', async () => {
    const out = await build(makeProject(FILES))
    expect(occurrences(out, 'tests/none.test.ts', 'seed.json')).toMatchObject({ matchCount: 0, returnedMatches: 0, matches: [], complete: true, reasonCode: null, truncated: false })
  })

  it('finds literal text in comments and strings regardless of language', async () => {
    const out = await build(makeProject(FILES))
    for (const file of ['tests/test_py.py', 'tests/JavaTest.java', 'tests/KotlinTest.kt']) {
      const result = occurrences(out, file, 'seed.json')
      expect(result.matchCount).toBeGreaterThan(0)
      expect(result.complete).toBe(true)
    }
    expect(occurrences(out, 'tests/test_py.py', 'seed.json').matchCount).toBe(2)
    expect(occurrences(out, 'tests/cmd.test.ts', 'npm run build')).toMatchObject({ matchCount: 1, complete: true })
  })

  it('never reports complete absence for a file over the scan limit, but keeps positive observations', async () => {
    const big = `// seed.json\n${'x'.repeat(MAX_EXACT_FILE_SCAN_BYTES + 10)}\n// tail seed.json\n`
    const out = await build(makeProject({ ...FILES, 'tests/big.test.ts': big }))
    const found = occurrences(out, 'tests/big.test.ts', 'seed.json')
    expect(found).toMatchObject({ complete: false, reasonCode: 'FILE_EXCEEDS_SCAN_LIMIT', scannedBytes: MAX_EXACT_FILE_SCAN_BYTES, matchCount: 1 })
    const absent = occurrences(out, 'tests/big.test.ts', 'never-present-value')
    expect(absent).toMatchObject({ matchCount: 0, complete: false, reasonCode: 'FILE_EXCEEDS_SCAN_LIMIT' })
  })

  it('qualifies the exact byte bound but never interprets the next byte as complete absence', async () => {
    const exact = '//' + 'x'.repeat(MAX_EXACT_FILE_SCAN_BYTES - 2)
    const out = await build(makeProject({ ...FILES, 'src/exact.ts': exact, 'src/over.ts': exact + 'x' }))
    const artifact = readSourceAuditEvidence(out)
    for (const [file, complete] of [['src/exact.ts', true], ['src/over.ts', false]] as const) {
      const result = occurrences(out, file, 'absent')
      expect(result).toMatchObject({ complete, matchCount: 0, scannedBytes: MAX_EXACT_FILE_SCAN_BYTES, snapshotId: artifact.source.snapshotId })
      expect(artifact.files.find(f => f.path === file)?.contentSha256).toBe(createHash('sha256').update(file.endsWith('exact.ts') ? exact : exact + 'x').digest('hex'))
      expect(result.reasonCode).toBe(complete ? null : 'FILE_EXCEEDS_SCAN_LIMIT')
    }
  })

  it('returns exactly 200 matches completely and caps beyond 200 with truncation', async () => {
    const lines = (count: number) => Array.from({ length: count }, (_, i) => `// m${i} NEEDLE`).join('\n') + '\n'
    const out = await build(makeProject({ ...FILES, 'tests/c200.test.ts': lines(200), 'tests/c201.test.ts': lines(201) }))
    expect(occurrences(out, 'tests/c200.test.ts', 'NEEDLE', 0)).toMatchObject({ matchCount: 200, returnedMatches: 200, truncated: false, complete: true, reasonCode: null })
    const capped = occurrences(out, 'tests/c201.test.ts', 'NEEDLE', 0)
    expect(capped).toMatchObject({ matchCount: 201, returnedMatches: 200, truncated: true, complete: false, reasonCode: 'MATCHES_TRUNCATED' })
    expect(capped.matches).toHaveLength(200)
    expect(capped.matches[0].line).toBe(1)
  })

  it('clamps context to 40 lines', async () => {
    const body = Array.from({ length: 120 }, (_, i) => (i === 60 ? '// NEEDLE' : `// filler ${i}`)).join('\n') + '\n'
    const out = await build(makeProject({ ...FILES, 'tests/ctx.test.ts': body }))
    const result = occurrences(out, 'tests/ctx.test.ts', 'NEEDLE', 500)
    expect(result.matches[0].windowEnd - result.matches[0].windowStart).toBe(80)
  })

  it('rejects stale, deleted and changed-after-index sources', async () => {
    const root = makeProject(FILES)
    const out = await build(root)
    writeFileSync(join(root, 'tests/one.test.ts'), "// changed\n")
    expect((failure(() => occurrences(out, 'tests/one.test.ts', 'seed.json')) as SourceAuditEvidenceError).code).toBe('STALE_SOURCE_EVIDENCE')
    rmSync(join(root, 'tests/none.test.ts'))
    expect((failure(() => occurrences(out, 'tests/none.test.ts', 'x')) as SourceAuditEvidenceError).code).toBe('STALE_SOURCE_EVIDENCE')
  })

  it('rejects traversal, non-canonical, unknown and unselected paths without scanning anything', async () => {
    const root = makeProject({ ...FILES, 'outside.ts': "const s = 'seed.json'\n" })
    const out = await build(root)
    for (const bad of ['../outside.ts', 'tests/../outside.ts', '/etc/passwd', 'tests\\one.test.ts', 'tests/./one.test.ts', '', 'C:/x.ts']) {
      expect((failure(() => occurrences(out, bad, 'seed.json')) as SourceAuditEvidenceError).code).toBe('INVALID_AUDIT_PATH')
    }
    // A real file on disk that is not in the selected inventory is not searched.
    expect((failure(() => occurrences(out, 'outside.ts', 'seed.json')) as SourceAuditEvidenceError).code).toBe('INVALID_AUDIT_PATH')
    expect((failure(() => occurrences(out, 'tests/unknown.test.ts', 'seed.json')) as SourceAuditEvidenceError).code).toBe('INVALID_AUDIT_PATH')
  })

  it('rejects a symlink escape', async () => {
    const root = makeProject(FILES)
    const outside = makeProject({ 'real.ts': "const s = 'seed.json'\n" })
    const out = await build(root)
    rmSync(join(root, 'tests/one.test.ts'))
    try {
      symlinkSync(join(outside, 'real.ts'), join(root, 'tests/one.test.ts'), 'file')
    } catch {
      return // the platform refuses symlink creation
    }
    expect(failure(() => occurrences(out, 'tests/one.test.ts', 'seed.json'))).toBeInstanceOf(Error)
  })

  it('does not claim a verified result for a file without a trusted content hash', async () => {
    const out = await build(makeProject(FILES))
    rewriteArtifact(out, (artifact) => { artifact.files.find((f: any) => f.path === 'tests/one.test.ts').contentSha256 = null })
    expect(occurrences(out, 'tests/one.test.ts', 'seed.json')).toMatchObject({ complete: false, reasonCode: 'CONTENT_HASH_UNAVAILABLE', scannedBytes: 0, matchCount: 0 })
  })

  it('reports invalid UTF-8 content as incomplete', async () => {
    const bytes = Buffer.concat([Buffer.from("// seed.json "), Buffer.from([0xff, 0xfe, 0xfd]), Buffer.from('\n')])
    const out = await build(makeProject({ ...FILES, 'tests/bin.test.ts': bytes }))
    const result = occurrences(out, 'tests/bin.test.ts', 'seed.json')
    expect(result).toMatchObject({ complete: false, reasonCode: 'FILE_NOT_VALID_UTF8', matchCount: 1 })
  })

  it('rejects an empty search value and values containing line breaks', async () => {
    const out = await build(makeProject(FILES))
    expect(failure(() => occurrences(out, 'tests/one.test.ts', '')).message).toContain('non-empty')
    expect(failure(() => occurrences(out, 'tests/one.test.ts', 'a\nb')).message).toContain('line breaks')
  })

  it('exposes the exact-file mode through the CLI and leaves cross-file --contains unchanged', async () => {
    const root = makeProject(FILES)
    const out = await build(root)
    const exact = runCli(['source', '--index', out, '--file', 'tests/many.test.ts', '--contains', 'seed.json', '--json'])
    expect(exact.status).toBe(0)
    expect(JSON.parse(exact.stdout)).toMatchObject({ mode: 'exact-file-occurrence', filePath: 'tests/many.test.ts', matchCount: 3, complete: true })

    expect(runCli(['source', '--index', out, '--file', 'tests/many.test.ts', '--contains', 'seed.json']).status).not.toBe(0)
    expect(runCli(['source', '--index', out, '--file', 'tests', '--contains', 'seed.json', '--json']).status).toBe(2)
    expect(runCli(['source', '--index', out, '--file', 'tests/many.test.ts', '--contains', 'seed.json', '--json', '--path', 'tests']).status).not.toBe(0)
    expect(runCli(['source', '--index', out, '--file', 'tests/many.test.ts', '--contains', '', '--json']).status).not.toBe(0)

    // Cross-file behavior: no --file, no JSON schema change, prefix path filter still honored.
    const cross = runCli(['source', '--index', out, '--contains', 'seed.json', '--format', 'json'])
    expect(cross.status).toBe(0)
    const parsed = JSON.parse(cross.stdout)
    expect(parsed).toHaveProperty('files')
    expect(parsed).not.toHaveProperty('mode')
    expect(parsed.matchCount).toBeGreaterThanOrEqual(8)
    expect(parsed.limit).toBe(200)
    const filtered = JSON.parse(runCli(['source', '--index', out, '--contains', 'seed.json', '--path', 'tests/many', '--format', 'json']).stdout)
    expect(filtered.files.map((f: any) => f.filePath)).toEqual(['tests/many.test.ts'])
  }, 60_000)
})
