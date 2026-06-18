import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { classifyMatch } from '../../src/source/findExactMatches.js'
import { runCli } from '../lookup/testCli.js'

const tempDirs: string[] = []
let sharedProjectDir = ''
let sharedIndexDir = ''

function makeTempProject(): { projectDir: string; indexDir: string } {
  const projectDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-refmatch-'))
  const indexDir = join(projectDir, '.idx')
  tempDirs.push(projectDir)
  return { projectDir, indexDir }
}

function writeFixture(projectDir: string, relativePath: string, content: string): void {
  const full = join(projectDir, relativePath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

function buildIndex(projectDir: string, indexDir: string): void {
  const res = runCli(['index', '--root', projectDir, '--src', 'src', '--out', indexDir])
  if (res.status !== 0) throw new Error(`Index failed: ${res.stderr || res.stdout}`)
}

beforeAll(() => {
  const { projectDir, indexDir } = makeTempProject()
  sharedProjectDir = projectDir
  sharedIndexDir = indexDir

  writeFixture(projectDir, 'src/constants.ts', `
const WIDGET_ID = 'shared-token'
function getWidget(): string { return 'shared-token' }
export const config = { widgetKey: 'shared-token' }
`)

  writeFixture(projectDir, 'src/usage.ts', `
import { config } from './constants'
const id = config.widgetKey
function check(id: string): boolean { return id === 'shared-token' }
`)

  writeFixture(projectDir, 'src/components.tsx', `
export function Card({ id }: { id: string }) {
  return (
    <div
      data-testid="card-widget"
      aria-label="Widget card"
    >
      <span data-testid="card-widget">inner</span>
    </div>
  )
}
`)

  writeFixture(projectDir, 'src/deep/nested.ts', `
const TOKEN = 'deep-value'
`)

  buildIndex(projectDir, indexDir)
})

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Classification tests (unit-level)
// ---------------------------------------------------------------------------

describe('classifyMatch — declaration-like', () => {
  it('classifies const assignment', () => {
    expect(classifyMatch("  const WIDGET_ID = 'shared-token'", 22)).toBe('declaration-like')
  })

  it('classifies let assignment', () => {
    expect(classifyMatch("  let x = 'val'", 11)).toBe('declaration-like')
  })

  it('classifies var assignment', () => {
    expect(classifyMatch("  var y = 'val'", 11)).toBe('declaration-like')
  })

  it('classifies object property value', () => {
    expect(classifyMatch("  { widgetKey: 'shared-token' }", 17)).toBe('declaration-like')
  })

  it('classifies type alias literal', () => {
    expect(classifyMatch("type Mode = 'dark'", 13)).toBe('declaration-like')
  })
})

describe('classifyMatch — usage-like', () => {
  it('classifies === comparison', () => {
    expect(classifyMatch("  return id === 'shared-token'", 18)).toBe('usage-like')
  })

  it('classifies !== comparison', () => {
    expect(classifyMatch("  if (x !== 'val') {", 13)).toBe('usage-like')
  })

  it('classifies function call argument', () => {
    expect(classifyMatch("  fn('submit-btn')", 6)).toBe('usage-like')
  })

  it('classifies second function argument', () => {
    expect(classifyMatch("  fn(a, 'val')", 9)).toBe('usage-like')
  })

  it('classifies JSX attribute value', () => {
    expect(classifyMatch('      data-testid="submit-btn"', 20)).toBe('usage-like')
  })

  it('classifies aria-label attribute', () => {
    expect(classifyMatch('      aria-label="Submit the form"', 19)).toBe('usage-like')
  })
})

describe('classifyMatch — unknown', () => {
  it('classifies return statement as unknown', () => {
    expect(classifyMatch("  return 'workspace-editor'", 10)).toBe('unknown')
  })

  it('classifies JSX text as unknown (no preceding operator)', () => {
    expect(classifyMatch('  Click here', 3)).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// Classification in match output
// ---------------------------------------------------------------------------

describe('classification in JSON match output', () => {
  it('includes classification field in each match', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'shared-token', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    for (const file of parsed.files) {
      for (const match of file.matches) {
        expect(['declaration-like', 'usage-like', 'unknown']).toContain(match.classification)
      }
    }
  })

  it('classifies const assignment as declaration-like', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'shared-token', '--format', 'json'])
    const parsed = JSON.parse(res.stdout)
    const constantsFile = parsed.files.find((f: { filePath: string }) => f.filePath.includes('constants'))
    const constMatch = constantsFile?.matches.find((m: { line: number }) => m.line === 2)
    expect(constMatch?.classification).toBe('declaration-like')
  })

  it('classifies === comparison as usage-like', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'shared-token', '--format', 'json'])
    const parsed = JSON.parse(res.stdout)
    const usageFile = parsed.files.find((f: { filePath: string }) => f.filePath.includes('usage'))
    // The usage.ts file has `return id === 'shared-token'`
    const compMatch = usageFile?.matches.find((m: { classification: string }) => m.classification === 'usage-like')
    expect(compMatch).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Repeated literal reporting (multi-file)
// ---------------------------------------------------------------------------

describe('repeated literal reporting', () => {
  it('reports one literal in one file', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'deep-value', '--format', 'json'])
    const parsed = JSON.parse(res.stdout)
    expect(parsed.matchCount).toBe(1)
    expect(parsed.files).toHaveLength(1)
  })

  it('reports one literal repeated in one file', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'shared-token', '--format', 'json'])
    const parsed = JSON.parse(res.stdout)
    const constantsFile = parsed.files.find((f: { filePath: string }) => f.filePath.includes('constants'))
    expect(constantsFile.matchCount).toBe(3)
  })

  it('reports literal repeated across multiple files', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'shared-token', '--format', 'json'])
    const parsed = JSON.parse(res.stdout)
    expect(parsed.files.length).toBeGreaterThanOrEqual(2)
  })

  it('reports total matchCount across all files', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'shared-token', '--format', 'json'])
    const parsed = JSON.parse(res.stdout)
    const sumFromFiles = parsed.files.reduce((sum: number, f: { matchCount: number }) => sum + f.matchCount, 0)
    expect(parsed.matchCount).toBe(sumFromFiles)
  })

  it('data-testid repeated in same TSX file', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'card-widget', '--format', 'json'])
    const parsed = JSON.parse(res.stdout)
    const comp = parsed.files.find((f: { filePath: string }) => f.filePath.includes('components'))
    expect(comp).toBeDefined()
    expect(comp.matchCount).toBeGreaterThanOrEqual(2)
    const allKinds = comp.matches.map((m: { matchKind: string }) => m.matchKind)
    expect(allKinds.some((k: string) => k === 'data-testid')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Path filter (--path)
// ---------------------------------------------------------------------------

describe('--path filter', () => {
  it('filters results to specified path prefix', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'shared-token', '--path', 'src/constants', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.files.every((f: { filePath: string }) => f.filePath.startsWith('src/constants'))).toBe(true)
    expect(parsed.pathFilter).toBe('src/constants')
  })

  it('filters to directory prefix', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'deep-value', '--path', 'src/deep', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.files.every((f: { filePath: string }) => f.filePath.startsWith('src/deep'))).toBe(true)
  })

  it('returns empty when prefix matches no files', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'shared-token', '--path', 'src/nonexistent', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.matchCount).toBe(0)
  })

  it('rejects path traversal in --path', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'foo', '--path', '../etc'])
    expect(res.status).not.toBe(0)
    expect(res.stderr + res.stdout).toContain('..')
  })

  it('rejects --path without --contains', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--path', 'src', '--file', 'src/constants.ts', '--symbol', 'WIDGET_ID'])
    expect(res.status).not.toBe(0)
    expect(res.stderr + res.stdout).toContain('--path')
  })

  it('Windows-style path separator is normalized', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'shared-token', '--path', 'src\\constants', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    // All returned file paths use forward slashes
    expect(parsed.files.every((f: { filePath: string }) => !f.filePath.includes('\\'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('deterministic output', () => {
  it('returns same results for repeated calls', () => {
    const res1 = runCli(['source', '--index', sharedIndexDir, '--contains', 'shared-token', '--format', 'json'])
    const res2 = runCli(['source', '--index', sharedIndexDir, '--contains', 'shared-token', '--format', 'json'])
    expect(res1.stdout).toBe(res2.stdout)
  })
})

// ---------------------------------------------------------------------------
// Adversarial: match in comment
// ---------------------------------------------------------------------------

describe('adversarial: match in comment', () => {
  it('finds literal inside code comment (raw-text match)', () => {
    const { projectDir, indexDir } = makeTempProject()
    writeFixture(projectDir, 'src/commented.ts', `
// This uses comment-token in the comment
const x = 1
`)
    buildIndex(projectDir, indexDir)

    const res = runCli(['source', '--index', indexDir, '--contains', 'comment-token', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    // comment-token appears in a comment line - raw text matching finds it
    expect(parsed.matchCount).toBeGreaterThan(0)
    expect(parsed.files[0].matches[0].semanticSource).toBe('raw')
  })
})

// ---------------------------------------------------------------------------
// Regression: existing source and search behavior
// ---------------------------------------------------------------------------

describe('regression: source command', () => {
  it('existing source --contains still works', () => {
    const res = runCli(['source', '--index', sharedIndexDir, '--contains', 'deep-value', '--format', 'json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.value).toBe('deep-value')
  })
})
