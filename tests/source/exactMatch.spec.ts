import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

const tempDirs: string[] = []
let sharedProjectDir = ''
let sharedIndexDir = ''

function makeTempProject(): { projectDir: string; indexDir: string } {
  const projectDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-exact-'))
  const indexDir = join(projectDir, '.idx')
  tempDirs.push(projectDir)
  return { projectDir, indexDir }
}

function writeFixture(projectDir: string, relativePath: string, content: string): void {
  const full = join(projectDir, relativePath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

function buildIndex(projectDir: string, indexDir: string, srcDir = 'src'): void {
  const res = runCli(['index', '--root', projectDir, '--src', srcDir, '--out', indexDir])
  if (res.status !== 0) throw new Error(`Index failed: ${res.stderr || res.stdout}`)
}

beforeAll(() => {
  const { projectDir, indexDir } = makeTempProject()
  sharedProjectDir = projectDir
  sharedIndexDir = indexDir

  writeFixture(projectDir, 'src/ui-strings.tsx', `
export function Button({ label }: { label: string }) {
  return (
    <button
      data-testid="submit-btn"
      aria-label="Submit the form"
    >
      Click here
    </button>
  )
}

export function DuplicateTestId() {
  return <div data-testid="submit-btn">Dup</div>
}
`)

  writeFixture(projectDir, 'src/duplicate-strings.ts', `
const WORKSPACE_ID = 'workspace-editor'
function getEditorId(): string { return 'workspace-editor' }
const config = { editorKey: 'workspace-editor' }
`)

  writeFixture(projectDir, 'src/near-start.ts', `const first = 'near-start-value'
const second = 'other'
const third = 'other'
const fourth = 'other'
const fifth = 'other'
`)

  writeFixture(projectDir, 'src/near-end.ts', `const a = 'other'
const b = 'other'
const c = 'other'
const d = 'other'
const e = 'near-end-value'
`)

  writeFixture(projectDir, 'src/unicode.tsx', `
export function Greeting() {
  return <div aria-label="\u{00e9}léphant" data-testid="unicode-el">\u{00e9}léphant</div>
}
`)

  writeFixture(projectDir, 'src/crlf-strings.ts', 'const a = "crlf-value"\r\nconst b = "other"\r\nconst c = "crlf-value"\r\n')

  writeFixture(projectDir, 'src/route-nav.ts', `
const DASHBOARD_ROUTE = '/dashboard'
function getRoute(): string { return '/dashboard' }
`)

  writeFixture(projectDir, 'src/adjacent.ts', `const x = 'adj-val'
const y = 'adj-val'
const z = 'other'
`)

  writeFixture(projectDir, 'src/template-literal.ts', `const msg = \`hello world\`
const other = 'hello world'
`)

  writeFixture(projectDir, 'src/regex-like.ts', `const pattern = 'a[b]c.d*'
const other = 'a[b]c.d*'
`)

  buildIndex(projectDir, indexDir)
})

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Happy path: basic semantic match kinds
// ---------------------------------------------------------------------------

describe('exact match — data-testid', () => {
  it('finds data-testid match with semantic kind', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'submit-btn', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.value).toBe('submit-btn')
    expect(parsed.matchCount).toBeGreaterThan(0)
    const allKinds = parsed.files.flatMap((f: { matches: Array<{ matchKind: string }> }) => f.matches.map((m) => m.matchKind))
    expect(allKinds.some((k: string) => k === 'data-testid')).toBe(true)
  })

  it('groups matches by file in JSON output', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'submit-btn', '--format', 'json'])
    const parsed = JSON.parse(res.stdout)
    expect(Array.isArray(parsed.files)).toBe(true)
    expect(parsed.files.every((f: { filePath: string }) => typeof f.filePath === 'string')).toBe(true)
    expect(parsed.files.every((f: { matches: unknown[] }) => Array.isArray(f.matches))).toBe(true)
  })

  it('finds duplicate data-testid in same file', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'submit-btn', '--format', 'json'])
    const parsed = JSON.parse(res.stdout)
    const uiFile = parsed.files.find((f: { filePath: string }) => f.filePath.includes('ui-strings'))
    expect(uiFile).toBeDefined()
    expect(uiFile.matchCount).toBeGreaterThanOrEqual(2)
  })
})

describe('exact match — aria-label', () => {
  it('finds aria-label match with semantic kind', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'Submit the form', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    const allKinds = parsed.files.flatMap((f: { matches: Array<{ matchKind: string }> }) => f.matches.map((m) => m.matchKind))
    expect(allKinds.some((k: string) => k === 'aria-label')).toBe(true)
  })
})

describe('exact match — raw text fallback', () => {
  it('finds raw string in non-TSX/test file', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'workspace-editor', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.matchCount).toBeGreaterThanOrEqual(3)
    const dupFile = parsed.files.find((f: { filePath: string }) => f.filePath.includes('duplicate-strings'))
    expect(dupFile).toBeDefined()
    expect(dupFile.matchCount).toBe(3)
  })

  it('reports raw-text semanticSource for non-semantic matches', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'workspace-editor', '--format', 'json'])
    const parsed = JSON.parse(res.stdout)
    const dupFile = parsed.files.find((f: { filePath: string }) => f.filePath.includes('duplicate-strings'))
    for (const match of dupFile.matches) {
      expect(match.semanticSource).toBe('raw')
      expect(match.matchKind).toBe('raw-text')
    }
  })
})

describe('exact match — duplicate across files', () => {
  it('finds same string in multiple files', () => {
    const { projectDir, indexDir } = makeTempProject()
    writeFixture(projectDir, 'src/a.ts', `const x = 'shared-token'`)
    writeFixture(projectDir, 'src/b.ts', `const y = 'shared-token'`)
    buildIndex(projectDir, indexDir)

    const res = runCli(['source', '--index', indexDir, '--contains', 'shared-token', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.files.length).toBe(2)
    expect(parsed.matchCount).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Context window behavior
// ---------------------------------------------------------------------------

describe('--context flag', () => {
  it('defaults to 3 context lines', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'workspace-editor', '--format', 'json'])
    const parsed = JSON.parse(res.stdout)
    expect(parsed.contextLines).toBe(3)
  })

  it('context 0 returns the matched line only', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'workspace-editor', '--context', '0', '--format', 'json'])
    const parsed = JSON.parse(res.stdout)
    expect(parsed.contextLines).toBe(0)
    for (const file of parsed.files) {
      for (const match of file.matches) {
        expect(match.windowStart).toBe(match.line)
        expect(match.windowEnd).toBe(match.line)
      }
    }
  })

  it('context clamps to MAX_CONTEXT_LINES (40) for huge values', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'workspace-editor', '--context', '9999', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.contextLines).toBe(40)
  })

  it('negative context is rejected', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'workspace-editor', '--context', '-1'])
    expect(res.status).not.toBe(0)
    expect(res.stderr + res.stdout).toContain('non-negative')
  })

  it('context window clamps at start of file', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'near-start-value', '--context', '10', '--format', 'json'])
    const parsed = JSON.parse(res.stdout)
    const file = parsed.files.find((f: { filePath: string }) => f.filePath.includes('near-start'))
    const match = file.matches[0]
    expect(match.windowStart).toBe(1)
    expect(match.line).toBe(1)
  })

  it('context window clamps at end of file', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'near-end-value', '--context', '10', '--format', 'json'])
    const parsed = JSON.parse(res.stdout)
    const file = parsed.files.find((f: { filePath: string }) => f.filePath.includes('near-end'))
    const match = file.matches[0]
    expect(match.windowEnd).toBe(5) // file has 5 lines
  })
})

// ---------------------------------------------------------------------------
// Output format tests
// ---------------------------------------------------------------------------

describe('output formats', () => {
  it('JSON output has required fields', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'submit-btn', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(typeof parsed.value).toBe('string')
    expect(typeof parsed.contextLines).toBe('number')
    expect(typeof parsed.matchCount).toBe('number')
    expect(Array.isArray(parsed.files)).toBe(true)
    expect(Array.isArray(parsed.warnings)).toBe(true)
    expect(typeof parsed.truncated).toBe('boolean')
    expect(typeof parsed.limit).toBe('number')
  })

  it('JSON per-file match fields are stable', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'submit-btn', '--format', 'json'])
    const parsed = JSON.parse(res.stdout)
    const match = parsed.files[0].matches[0]
    expect(typeof match.line).toBe('number')
    expect(typeof match.column).toBe('number')
    expect(typeof match.windowStart).toBe('number')
    expect(typeof match.windowEnd).toBe('number')
    expect(typeof match.content).toBe('string')
    expect(typeof match.matchKind).toBe('string')
    expect(typeof match.semanticSource).toBe('string')
  })

  it('numbered output includes line numbers and FILE: header', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'workspace-editor', '--format', 'numbered'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('FILE:')
    expect(res.stdout).toMatch(/\d+ \|/)
  })

  it('plain output is readable without line numbers', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'workspace-editor', '--format', 'plain'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('FILE:')
    expect(res.stdout).toContain('workspace-editor')
    expect(res.stdout).not.toMatch(/^\d+ \|/m)
  })

  it('--json flag produces JSON', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'workspace-editor', '--json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.value).toBe('workspace-editor')
  })

  it('no matches returns empty result', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'zzz-no-such-string-zzz', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.matchCount).toBe(0)
    expect(parsed.files).toHaveLength(0)
  })

  it('no matches returns readable message in numbered mode', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'zzz-no-such-string-zzz', '--format', 'numbered'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('No matches')
  })
})

// ---------------------------------------------------------------------------
// Error and validation tests
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('rejects empty --contains value', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', ''])
    expect(res.status).not.toBe(0)
    expect(res.stderr + res.stdout).toMatch(/non-empty|empty/i)
  })

  it('rejects --contains combined with --node', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'foo', '--node', 'some:id'])
    expect(res.status).not.toBe(0)
    expect(res.stderr + res.stdout).toContain('--contains')
  })

  it('rejects --contains combined with --symbol', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'foo', '--file', 'src/a.ts', '--symbol', 'bar'])
    expect(res.status).not.toBe(0)
  })

  it('rejects --contains combined with --file', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'foo', '--file', 'src/a.ts'])
    expect(res.status).not.toBe(0)
    expect(res.stderr + res.stdout).toContain('--file')
  })

  it('rejects --contains combined with --start', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'foo', '--start', '1', '--end', '5'])
    expect(res.status).not.toBe(0)
  })

  it('rejects missing index directory', () => {
    const res = runCli(['source', '--index', '/no/such/dir', '--contains', 'foo'])
    expect(res.status).not.toBe(0)
  })

  it('rejects unsupported format', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'foo', '--format', 'yaml'])
    expect(res.status).not.toBe(0)
    expect(res.stderr + res.stdout).toContain('yaml')
  })
})

// ---------------------------------------------------------------------------
// Adversarial tests
// ---------------------------------------------------------------------------

describe('adversarial: CRLF line endings', () => {
  it('finds matches in CRLF files', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'crlf-value', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    const file = parsed.files.find((f: { filePath: string }) => f.filePath.includes('crlf'))
    expect(file).toBeDefined()
    expect(file.matchCount).toBe(2)
  })
})

describe('adversarial: Unicode strings', () => {
  it('finds Unicode strings correctly', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'éléphant', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    const file = parsed.files.find((f: { filePath: string }) => f.filePath.includes('unicode'))
    expect(file).toBeDefined()
    expect(file.matchCount).toBeGreaterThan(0)
  })
})

describe('adversarial: adjacent matches', () => {
  it('finds adjacent matches on consecutive lines', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'adj-val', '--context', '0', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    const file = parsed.files.find((f: { filePath: string }) => f.filePath.includes('adjacent'))
    expect(file).toBeDefined()
    expect(file.matchCount).toBe(2)
    expect(file.matches[0].line).toBe(1)
    expect(file.matches[1].line).toBe(2)
  })
})

describe('adversarial: template literals', () => {
  it('finds string value that appears in both template literal and string literal', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'hello world', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    const file = parsed.files.find((f: { filePath: string }) => f.filePath.includes('template'))
    expect(file).toBeDefined()
    expect(file.matchCount).toBe(2)
  })
})

describe('adversarial: regex-like strings', () => {
  it('treats --contains value as literal string, not regex', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'a[b]c.d*', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    const file = parsed.files.find((f: { filePath: string }) => f.filePath.includes('regex-like'))
    expect(file).toBeDefined()
    expect(file.matchCount).toBe(2)
  })
})

describe('adversarial: route-like strings in production file', () => {
  it('finds route-like string in a production file', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', '/dashboard', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    const file = parsed.files.find((f: { filePath: string }) => f.filePath.includes('route-nav'))
    expect(file).toBeDefined()
    expect(file.matchCount).toBe(2)
    const allKinds = file.matches.map((m: { matchKind: string }) => m.matchKind)
    expect(allKinds.every((k: string) => k === 'route-like-string' || k === 'raw-text')).toBe(true)
  })
})

describe('adversarial: malformed frontend artifact', () => {
  it('falls back to raw text when artifact JSON is malformed', () => {
    const { projectDir, indexDir } = makeTempProject()
    writeFixture(projectDir, 'src/simple.ts', `const x = 'find-this-value'`)
    buildIndex(projectDir, indexDir)

    // Corrupt the frontend semantic artifact (if it exists)
    const artifactPath = join(indexDir, 'frontend-semantic.json')
    try {
      writeFileSync(artifactPath, '{ invalid json !!!', 'utf8')
    } catch {
      // file might not exist, that's fine
    }

    const res = runCli(['source', '--index', indexDir, '--contains', 'find-this-value', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.matchCount).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Regression: existing source by file/symbol/node still works
// ---------------------------------------------------------------------------

describe('regression: existing source modes', () => {
  let basicIndexDir = ''

  beforeAll(() => {
    basicIndexDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-src-reg-'))
    tempDirs.push(basicIndexDir)
    const res = runCli(['index', '--root', 'examples/basic-ts', '--src', 'src', '--out', basicIndexDir])
    expect(res.status).toBe(0)
  })

  it('source by symbol still works', () => {
    const res = runCli(['source', '--index', basicIndexDir, '--file', 'src/index.ts', '--symbol', 'describeUser', '--format', 'numbered'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('describeUser')
  })

  it('source by node still works', () => {
    const res = runCli(['source', '--index', basicIndexDir, '--node', 'symbol:src/userTypes.ts#User', '--json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.symbolName).toBe('User')
  })

  it('source by line range still works', () => {
    const res = runCli(['source', '--index', basicIndexDir, '--file', 'src/index.ts', '--start', '1', '--end', '5', '--format', 'numbered'])
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/1 \|/)
  })
})
