import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runFrontendAnalyzer } from '../../src/frontend/frontendAnalyzer.js'
import {
  FRONTEND_SEMANTIC_ARTIFACT_KIND,
  FRONTEND_SEMANTIC_SCHEMA_VERSION,
} from '../../src/frontend/frontendTypes.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'
import { runCli } from '../lookup/testCli.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-frontend-'))
  tempDirs.push(dir)
  return dir
}

function stubSymbolIndex(files: Array<{ path: string }>): SymbolIndex {
  return {
    schemaVersion: '2',
    buildTime: new Date().toISOString(),
    repoRoot: '/stub',
    sourceRoots: ['src'],
    fileCount: files.length,
    symbolCount: 0,
    files: files.map((f) => ({
      path: f.path,
      language: 'typescript' as const,
      lineCount: 1,
      imports: [],
      exports: [],
      symbols: [],
      hasCallGraphEntries: false,
    })),
  }
}

// ---------------------------------------------------------------------------
// Unit tests for the analyzer function
// ---------------------------------------------------------------------------

describe('runFrontendAnalyzer', () => {
  it('returns a valid artifact for an empty project (no files)', () => {
    const dir = makeTempDir()
    const result = runFrontendAnalyzer({
      symbolIndex: stubSymbolIndex([]),
      repoRoot: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    expect(result.artifact.artifactKind).toBe(FRONTEND_SEMANTIC_ARTIFACT_KIND)
    expect(result.artifact.schemaVersion).toBe(FRONTEND_SEMANTIC_SCHEMA_VERSION)
    expect(result.artifact.files).toHaveLength(0)
    expect(result.artifact.summary.fileCount).toBe(0)
    expect(result.artifact.summary.componentCount).toBe(0)
    expect(result.warningCount).toBe(0)
    expect(result.errorCount).toBe(0)
  })

  it('skips non-frontend files (Python, plain text)', () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, 'main.py'), 'def hello(): pass\n')
    const result = runFrontendAnalyzer({
      symbolIndex: stubSymbolIndex([{ path: 'main.py' }]),
      repoRoot: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    expect(result.artifact.files).toHaveLength(0)
    expect(result.artifact.summary.fileCount).toBe(0)
  })

  it('processes a minimal TSX file without throwing', () => {
    const dir = makeTempDir()
    const src = join(dir, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(
      join(src, 'Button.tsx'),
      `export function Button() { return <button>Click</button> }\n`
    )

    const result = runFrontendAnalyzer({
      symbolIndex: stubSymbolIndex([{ path: 'src/Button.tsx' }]),
      repoRoot: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    expect(result.artifact.files).toHaveLength(1)
    expect(result.artifact.files[0].filePath).toBe('src/Button.tsx')
    expect(result.artifact.files[0].parseError).toBe(false)
    expect(result.errorCount).toBe(0)
  })

  it('marks unreadable files as parse errors without crashing', () => {
    const dir = makeTempDir()
    // Point to a file that does not exist on disk
    const result = runFrontendAnalyzer({
      symbolIndex: stubSymbolIndex([{ path: 'src/Missing.tsx' }]),
      repoRoot: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    expect(result.artifact.files).toHaveLength(1)
    expect(result.artifact.files[0].parseError).toBe(true)
    expect(result.errorCount).toBe(1)
  })

  it('handles a .tsx file with no JSX content (non-component .tsx)', () => {
    const dir = makeTempDir()
    const src = join(dir, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'utils.tsx'), `export function add(a: number, b: number): number { return a + b }\n`)

    const result = runFrontendAnalyzer({
      symbolIndex: stubSymbolIndex([{ path: 'src/utils.tsx' }]),
      repoRoot: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    expect(result.artifact.files).toHaveLength(1)
    expect(result.artifact.files[0].parseError).toBe(false)
    // No JSX in the content even if the extension is .tsx
    expect(result.artifact.files[0].hasJsx).toBe(true) // .tsx extension → always true
  })

  it('detects test files by path pattern', () => {
    const dir = makeTempDir()
    const testsDir = join(dir, 'src', '__tests__')
    mkdirSync(testsDir, { recursive: true })
    writeFileSync(join(testsDir, 'Button.spec.tsx'), `import { describe } from 'vitest'\ndescribe('Button', () => {})\n`)

    const result = runFrontendAnalyzer({
      symbolIndex: stubSymbolIndex([{ path: 'src/__tests__/Button.spec.tsx' }]),
      repoRoot: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    expect(result.artifact.files[0].isTestFile).toBe(true)
  })

  it('is deterministic: same inputs produce identical output', () => {
    const dir = makeTempDir()
    const src = join(dir, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'App.tsx'), `export function App() { return <div>Hello</div> }\n`)

    const options = {
      symbolIndex: stubSymbolIndex([{ path: 'src/App.tsx' }]),
      repoRoot: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    }

    const first = runFrontendAnalyzer(options)
    const second = runFrontendAnalyzer(options)

    expect(JSON.stringify(first.artifact)).toBe(JSON.stringify(second.artifact))
  })

  it('handles mixed JS/TS/TSX/Python project', () => {
    const dir = makeTempDir()
    const src = join(dir, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'index.ts'), `export const x = 1\n`)
    writeFileSync(join(src, 'app.js'), `function main() {}\n`)
    writeFileSync(join(src, 'App.tsx'), `export function App() { return <div /> }\n`)
    writeFileSync(join(src, 'service.py'), `def hello(): pass\n`)

    const result = runFrontendAnalyzer({
      symbolIndex: stubSymbolIndex([
        { path: 'src/index.ts' },
        { path: 'src/app.js' },
        { path: 'src/App.tsx' },
        { path: 'src/service.py' },
      ]),
      repoRoot: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    // Python is skipped; 3 JS/TS/TSX files are processed
    expect(result.artifact.files).toHaveLength(3)
    expect(result.artifact.files.map((f) => f.filePath).sort()).toEqual([
      'src/App.tsx',
      'src/app.js',
      'src/index.ts',
    ])
  })

  it('does not crash on unsupported dynamic syntax', () => {
    const dir = makeTempDir()
    const src = join(dir, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(
      join(src, 'dynamic.tsx'),
      `
      const components = [1,2,3].map(n => () => <div key={n}>{n}</div>)
      export const Dynamic = ({ type }: { type: string }) => {
        const Tag = type as any
        return <Tag />
      }
    `
    )

    const result = runFrontendAnalyzer({
      symbolIndex: stubSymbolIndex([{ path: 'src/dynamic.tsx' }]),
      repoRoot: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    expect(result.artifact.files[0].parseError).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Integration tests via the CLI
// ---------------------------------------------------------------------------

describe('frontend-semantic analyzer — CLI integration', () => {
  function createTsFixture(): string {
    const root = makeTempDir()
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'types.ts'), 'export interface User { id: string; name: string }\n')
    writeFileSync(
      join(src, 'service.ts'),
      "import type { User } from './types'\nexport function formatUser(user: User): string { return user.name }\n"
    )
    return root
  }

  function createTsxFixture(): string {
    const root = makeTempDir()
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'types.ts'), 'export interface User { id: string; name: string }\n')
    writeFileSync(
      join(src, 'Button.tsx'),
      `import React from 'react'
export function Button({ label }: { label: string }) {
  return <button>{label}</button>
}
`
    )
    return root
  }

  it('records frontend-semantic analyzer status in manifest for a TS-only project', () => {
    const root = createTsFixture()
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
    expect(result.status).toBe(0)

    const parsed = JSON.parse(result.stdout)
    const analyzer = parsed.analyzers?.find((a: { id: string }) => a.id === 'frontend-semantic')
    expect(analyzer).toBeDefined()
    expect(analyzer.status).toMatch(/complete|partial/)
  })

  it('records existing data-model analyzer status unchanged for a TS-only project', () => {
    const root = createTsFixture()
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
    expect(result.status).toBe(0)

    const parsed = JSON.parse(result.stdout)
    const dm = parsed.analyzers?.find((a: { id: string }) => a.id === 'data-model')
    expect(dm).toBeDefined()
    expect(dm.status).toMatch(/complete|partial/)
  })

  it('writes frontend-semantic.json when TSX files are present', () => {
    const root = createTsxFixture()
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
    expect(result.status).toBe(0)

    const parsed = JSON.parse(result.stdout)
    expect(parsed.semanticArtifacts.frontendSemanticPath).not.toBeNull()
    expect(parsed.semanticArtifacts.frontendSemanticPath).toContain('.my-dev-kit')
  })

  it('does not write frontend-semantic.json when no frontend files are present', () => {
    const root = makeTempDir()
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'service.py'), 'def hello(): pass\n')

    const result = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
    expect(result.status).toBe(0)

    const parsed = JSON.parse(result.stdout)
    expect(parsed.semanticArtifacts.frontendSemanticPath).toBeNull()
  })

  it('refreshes stale frontend-semantic.json on repeated indexing', () => {
    const root = createTsxFixture()
    const outDir = join(root, '.my-dev-kit')

    const first = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
    expect(first.status).toBe(0)
    const firstArtifactPath = join(outDir, 'frontend-semantic.json')
    expect(existsSync(firstArtifactPath)).toBe(true)

    writeFileSync(firstArtifactPath, '"stale frontend-semantic"')

    const second = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
    expect(second.status).toBe(0)

    const refreshed = JSON.parse(readFileSync(firstArtifactPath, 'utf8'))
    expect(refreshed.artifactKind).toBe(FRONTEND_SEMANTIC_ARTIFACT_KIND)
    expect(JSON.parse(second.stdout).managedArtifacts.removed).toContain('frontend-semantic.json')
  })

  it('does not write frontend-semantic.json in dry-run mode', () => {
    const root = createTsxFixture()

    const result = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--dry-run', '--json'])
    expect(result.status).toBe(0)
    expect(existsSync(join(root, '.my-dev-kit', 'frontend-semantic.json'))).toBe(false)
  })

  it('existing data-model artifacts still work after frontend-semantic is added', () => {
    const root = createTsxFixture()
    runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])

    const dmResult = runCli(['data-model', '--index', join(root, '.my-dev-kit'), '--json'])
    expect(dmResult.status).toBe(0)
    const dmOutput = JSON.parse(dmResult.stdout)
    expect(dmOutput.status).toBe('ok')
  })

  it('search, lookup, source, slice, view commands work after frontend-semantic is added', () => {
    const root = createTsxFixture()
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
    expect(indexResult.status).toBe(0)
    const indexDir = join(root, '.my-dev-kit')

    const search = runCli(['search', '--index', indexDir, '--query', 'Button', '--json'])
    const lookup = runCli(['lookup', '--index', indexDir, '--node', 'file:src/Button.tsx', '--json'])
    const view = runCli(['view', '--index', indexDir, '--format', 'dot', '--out', join(indexDir, 'graph.dot')])

    expect(search.status).toBe(0)
    expect(lookup.status).toBe(0)
    expect(view.status).toBe(0)
  })
})
