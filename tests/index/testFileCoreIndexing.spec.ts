import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { discoverTestInfrastructure } from '../../src/context/testInfrastructureDiscovery.js'
import { discoverSourceFiles } from '../../src/indexing/discoverSourceFiles.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'
import { runCli } from '../lookup/testCli.js'

// v1.12.4: supported `.test.`/`.spec.` files beneath an explicitly selected
// source root are ordinary core-indexed files (symbol index, code graph,
// exact-source retrieval, lookup, slice, search). `.d.ts`, user excludes, and
// default ignored directories keep their existing exclusion contract.

const tempDirs: string[] = []

function write(root: string, relativePath: string, contents: string): void {
  const fullPath = join(root, relativePath)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, contents, 'utf8')
}

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'mdk-test-file-core-indexing-'))
  tempDirs.push(root)
  write(root, 'src/example.ts', "export function formatGreeting(name: string): string {\n  return `Hello, ${name}`\n}\n")
  write(root, 'src/types.d.ts', 'export declare const declared: string\n')
  write(
    root,
    'src/example.test.ts',
    "import { formatGreeting } from './example'\nexport const COLOCATED_MARKER = 'colocated-literal-marker'\ntest('colocated greeting', () => { expect(formatGreeting('a')).toBe('Hello, a') })\n"
  )
  write(
    root,
    'tests/example.test.ts',
    "import { formatGreeting } from '../src/example'\ndescribe('formatGreeting behavior', () => {\n  it('greets by name with unique-test-literal-alpha', () => {\n    expect(formatGreeting('Ada')).toBe('Hello, Ada')\n  })\n})\n"
  )
  write(
    root,
    'tests/example.spec.ts',
    "import { formatGreeting } from '../src/example'\nexport const SPEC_TS_MARKER = 'spec-ts-literal-gamma'\ntest('spec greeting', () => { expect(formatGreeting(SPEC_TS_MARKER)).toContain('gamma') })\n"
  )
  write(
    root,
    'tests/example.test.tsx',
    "import { formatGreeting } from '../src/example'\nexport function GreetingView() { return <button aria-label=\"greet-button\">{formatGreeting('tsx')}</button> }\ntest('renders greeting view', () => { expect(GreetingView).toBeDefined() })\n"
  )
  write(
    root,
    'tests/example.spec.tsx',
    "import { formatGreeting } from '../src/example'\nexport function renderGreetingSpec(): string { return formatGreeting('spec-tsx-literal-beta') }\ntest('renders greeting', () => { expect(renderGreetingSpec()).toContain('beta') })\n"
  )
  write(root, 'tests/example.test.js', "export const jsTestMarker = 'js-test-literal'\n")
  write(root, 'tests/example.spec.js', "export const jsSpecMarker = 'js-spec-literal'\n")
  write(root, 'tests/example.test.jsx', "export const JsxTestView = () => <div>jsx-test-literal</div>\n")
  write(root, 'tests/example.spec.jsx', "export const JsxSpecView = () => <div>jsx-spec-literal</div>\n")
  write(root, 'tests/node_modules/pkg/ignored.test.ts', 'export const ignoredDependencyTest = 1\n')
  write(root, 'tests/excluded/userExcluded.test.ts', 'export const userExcludedTest = 1\n')
  return root
}

const TEST_FILES_UNDER_TESTS = [
  'tests/example.spec.js',
  'tests/example.spec.jsx',
  'tests/example.spec.ts',
  'tests/example.spec.tsx',
  'tests/example.test.js',
  'tests/example.test.jsx',
  'tests/example.test.ts',
  'tests/example.test.tsx',
]

function indexFixture(root: string, out: string, sourceRoots: string[], extraArgs: string[] = []) {
  const srcArgs = sourceRoots.flatMap((src) => ['--src', src])
  const result = runCli(['index', '--root', root, ...srcArgs, '--out', out, '--json', ...extraArgs])
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function cliJson(args: string[]) {
  const result = runCli([...args, '--json'])
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}

let root: string
let indexDir: string

beforeAll(() => {
  root = createFixture()
  indexDir = join(root, 'out')
  indexFixture(root, 'out', ['src', 'tests'], ['--exclude', 'tests/excluded'])
}, 120_000)

afterAll(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

describe('TST-001/TST-012: discovery admits test-shaped files but keeps existing exclusions', () => {
  it('returns supported .test./.spec. files as eligible and does not count them as skipped by file pattern', () => {
    const result = discoverSourceFiles({ repoRoot: root, sourceRoots: ['src', 'tests'], userExcludes: ['tests/excluded'] })
    const paths = result.files.map((file) => file.relPath)

    for (const testPath of [...TEST_FILES_UNDER_TESTS, 'src/example.test.ts']) expect(paths).toContain(testPath)
    expect(paths).toContain('src/example.ts')
    // Only the declaration file is skipped by the default filename pattern.
    expect(result.skippedByFilePattern).toBe(1)
    expect(result.sampleSkippedFiles).toContainEqual({ path: 'src/types.d.ts', reason: 'file-pattern' })
  })

  it('keeps .d.ts files excluded (TST-012)', () => {
    const result = discoverSourceFiles({ repoRoot: root, sourceRoots: ['src'] })
    expect(result.files.map((file) => file.relPath)).not.toContain('src/types.d.ts')
  })

  it('keeps user excludes and default ignored directories authoritative over test-file admission', () => {
    const result = discoverSourceFiles({ repoRoot: root, sourceRoots: ['tests'], userExcludes: ['tests/excluded'] })
    const paths = result.files.map((file) => file.relPath)

    expect(paths).not.toContain('tests/excluded/userExcluded.test.ts')
    expect(paths).not.toContain('tests/node_modules/pkg/ignored.test.ts')
    expect(result.skippedByUserExclude).toBeGreaterThan(0)
    expect(result.skippedByDefaultIgnore).toBeGreaterThan(0)
  })
})

describe('TST-002/TST-003: test files become ordinary indexed files under selected roots', () => {
  it('indexes test files under an explicit --src tests root', () => {
    const out = 'out-tests-only'
    indexFixture(root, out, ['tests'], ['--exclude', 'tests/excluded'])
    const symbolIndex = readJson(join(root, out, 'symbol-index.json')) as SymbolIndex

    expect(symbolIndex.files.map((file) => file.path).sort()).toEqual(TEST_FILES_UNDER_TESTS)
  }, 120_000)

  it('indexes a colocated test file under --src src without scanning outside the selected root', () => {
    const out = 'out-src-only'
    indexFixture(root, out, ['src'])
    const symbolIndex = readJson(join(root, out, 'symbol-index.json')) as SymbolIndex
    const paths = symbolIndex.files.map((file) => file.path).sort()

    expect(paths).toEqual(['src/example.test.ts', 'src/example.ts'])
    const colocated = symbolIndex.files.find((file) => file.path === 'src/example.test.ts')
    expect(colocated?.symbols.map((symbol) => symbol.name)).toContain('COLOCATED_MARKER')
  }, 120_000)
})

describe('TST-004: exact source retrieval covers indexed test files', () => {
  it('finds a literal in a test file with path/line/context evidence', () => {
    const parsed = cliJson(['source', '--index', indexDir, '--contains', 'unique-test-literal-alpha', '--path', 'tests/example.test.ts'])

    expect(parsed.matchCount).toBe(1)
    expect(parsed.files).toHaveLength(1)
    expect(parsed.files[0].filePath).toBe('tests/example.test.ts')
    const match = parsed.files[0].matches[0]
    expect(match.line).toBe(3)
    expect(match.matchKind).toBe('raw-text')
    expect(match.content).toContain("describe('formatGreeting behavior'")
  })

  it('finds literals across test files under a path prefix, including JS/JSX variants', () => {
    const parsed = cliJson(['source', '--index', indexDir, '--contains', '-literal', '--path', 'tests/'])
    const filePaths = parsed.files.map((file: { filePath: string }) => file.filePath).sort()

    expect(filePaths).toEqual(TEST_FILES_UNDER_TESTS.filter((path) => path !== 'tests/example.test.tsx'))
  })

  it('keeps production-file exact matching unchanged (control)', () => {
    const parsed = cliJson(['source', '--index', indexDir, '--contains', 'return `Hello', '--path', 'src/example.ts'])

    expect(parsed.matchCount).toBe(1)
    expect(parsed.files[0].filePath).toBe('src/example.ts')
    expect(parsed.files[0].matches[0].line).toBe(2)
  })
})

describe('TST-005/TST-006/TST-007: graph identity, lookup, and slice for test files', () => {
  it('creates normal file:<path> nodes for indexed test files (TST-005)', () => {
    const graph = readJson(join(indexDir, 'code-graph.json'))
    const fileNodeIds = graph.nodes.filter((node: { kind: string }) => node.kind === 'file').map((node: { id: string }) => node.id)

    for (const testPath of [...TEST_FILES_UNDER_TESTS, 'src/example.test.ts']) expect(fileNodeIds).toContain(`file:${testPath}`)
    expect(fileNodeIds).not.toContain('file:src/types.d.ts')
    expect(fileNodeIds).not.toContain('file:tests/excluded/userExcluded.test.ts')
    expect(new Set(fileNodeIds).size).toBe(fileNodeIds.length)
  })

  it('looks up a test file node through the existing lookup command (TST-006)', () => {
    const parsed = cliJson(['lookup', '--index', indexDir, '--node', 'file:tests/example.test.ts'])

    expect(parsed.status).toBe('found')
    expect(parsed.node).toMatchObject({ id: 'file:tests/example.test.ts', kind: 'file', path: 'tests/example.test.ts' })
    expect(parsed.outgoingEdges.map((edge: { target: string }) => edge.target)).toContain('file:src/example.ts')
  })

  it('slices a test file node deterministically through the existing slice command (TST-007)', () => {
    const first = cliJson(['slice', '--index', indexDir, '--node', 'file:tests/example.spec.tsx'])
    const second = cliJson(['slice', '--index', indexDir, '--node', 'file:tests/example.spec.tsx'])
    const nodeIds = first.nodes.map((node: { id: string }) => node.id)

    expect(first.focusNodeId).toBe('file:tests/example.spec.tsx')
    expect(nodeIds).toContain('file:tests/example.spec.tsx')
    expect(nodeIds).toContain('symbol:tests/example.spec.tsx#renderGreetingSpec')
    expect(nodeIds).toContain('file:src/example.ts')
    expect(second.nodes).toEqual(first.nodes)
    expect(second.edges).toEqual(first.edges)
  })
})

describe('TST-008: search sees ordinary indexed test evidence', () => {
  function searchIds(query: string): string[] {
    const parsed = cliJson(['search', '--index', indexDir, '--query', query])
    return parsed.results.map((result: { id: string }) => result.id)
  }

  it('finds an indexed test file by filename', () => {
    expect(searchIds('example.spec.ts').slice(0, 3)).toContain('file:tests/example.spec.ts')
  })

  it('finds a symbol declared in an indexed test file', () => {
    expect(searchIds('renderGreetingSpec')[0]).toBe('symbol:tests/example.spec.tsx#renderGreetingSpec')
  })

  it('finds an indexed test file by its describe title via existing frontend-test evidence', () => {
    expect(searchIds('formatGreeting behavior')).toContain('file:tests/example.test.ts')
  })
})

describe('TST-009: incremental cache from the old exclusion policy is not reused as equivalent', () => {
  it('rebuilds fully and admits test files when the cached configuration predates test-file admission', () => {
    const cacheRoot = createFixture()
    const incrementalArgs = ['--incremental']
    indexFixture(cacheRoot, 'cache-out', ['src', 'tests'], incrementalArgs)

    // Simulate a v1.12.3-era cache: same file set minus test-shaped files, and a
    // configuration fingerprint computed without the default file exclusion policy.
    const cachePath = join(cacheRoot, 'cache-out', 'cache-metadata.json')
    const cache = readJson(cachePath)
    cache.files = cache.files.filter((entry: { path: string }) => !/\.(test|spec)\./.test(entry.path))
    cache.configFingerprint = 'legacy-fingerprint-without-default-file-exclude-patterns'
    writeFileSync(cachePath, JSON.stringify(cache, null, 2))

    const parsed = indexFixture(cacheRoot, 'cache-out', ['src', 'tests'], incrementalArgs)
    expect(parsed.cache.mode).toBe('incremental-full-config-changed')

    const symbolIndex = readJson(join(cacheRoot, 'cache-out', 'symbol-index.json')) as SymbolIndex
    const paths = symbolIndex.files.map((file) => file.path)
    for (const testPath of [...TEST_FILES_UNDER_TESTS, 'src/example.test.ts']) expect(paths).toContain(testPath)

    const rewritten = readJson(cachePath)
    expect(rewritten.files.map((entry: { path: string }) => entry.path)).toContain('tests/example.test.ts')

    const noChange = indexFixture(cacheRoot, 'cache-out', ['src', 'tests'], incrementalArgs)
    expect(noChange.cache.mode).toBe('incremental-no-change')
  }, 180_000)
})

describe('TST-010: frontend-test semantic extraction coexists with core indexing', () => {
  it('extracts test blocks and UI strings once per test file without duplicate semantic ids', () => {
    const frontend = readJson(join(indexDir, 'frontend-semantic.json'))
    const filePaths: string[] = frontend.files.map((file: { filePath: string }) => file.filePath)
    expect(new Set(filePaths).size).toBe(filePaths.length)

    const testFile = frontend.files.find((file: { filePath: string }) => file.filePath === 'tests/example.test.ts')
    expect(testFile.isTestFile).toBe(true)
    expect(testFile.testBlocks.map((block: { kind: string; title: string }) => [block.kind, block.title])).toEqual([
      ['describe', 'formatGreeting behavior'],
      ['it', 'greets by name with unique-test-literal-alpha'],
    ])

    const tsxTestFile = frontend.files.find((file: { filePath: string }) => file.filePath === 'tests/example.test.tsx')
    expect(tsxTestFile.uiStrings.map((entry: { value: string }) => entry.value)).toContain('greet-button')

    const production = frontend.files.find((file: { filePath: string }) => file.filePath === 'src/example.ts')
    expect(production.isTestFile).toBe(false)

    const blockIds: string[] = frontend.files.flatMap((file: { testBlocks: Array<{ id: string }> }) => file.testBlocks.map((block) => block.id))
    expect(new Set(blockIds).size).toBe(blockIds.length)

    const graph = readJson(join(indexDir, 'code-graph.json'))
    const nodeIds: string[] = graph.nodes.map((node: { id: string }) => node.id)
    expect(new Set(nodeIds).size).toBe(nodeIds.length)
  })
})

describe('TST-011: context test-infrastructure discovery stays compatible', () => {
  it('lists each related test once when test files are also core-indexed', () => {
    const symbolIndex = readJson(join(indexDir, 'symbol-index.json')) as SymbolIndex
    const result = discoverTestInfrastructure({
      role: 'test-implementation',
      symbolIndex,
      filesOfInterest: ['src/example.ts'],
      symbolsOfInterest: ['symbol:src/example.ts#formatGreeting'],
      requestedEvidenceKinds: [],
      repoRoot: root,
    })
    const relatedPaths = result.relatedTests.items.map((item) => item.path)

    expect(new Set(relatedPaths).size).toBe(relatedPaths.length)
    for (const testPath of ['src/example.test.ts', 'tests/example.test.ts', 'tests/example.spec.ts', 'tests/example.spec.tsx']) {
      expect(relatedPaths).toContain(testPath)
    }
    expect(relatedPaths).not.toContain('src/example.ts')
  })

  it('keeps test-implementation context grounded in the changed production surface', () => {
    const requestPath = join(root, 'context-request.json')
    writeFileSync(
      requestPath,
      JSON.stringify({ schemaVersion: '1.0.0', query: 'formatGreeting', role: 'test-implementation', changedFiles: ['src/example.ts'] })
    )
    const capsulePath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexDir, '--request', requestPath, '--out', capsulePath])
    expect(result.status, result.stderr).toBe(0)

    const capsule = readJson(capsulePath)
    const selectedTestPaths: string[] = capsule.selectedTests.map((item: { path: string }) => item.path)
    expect(new Set(selectedTestPaths).size).toBe(selectedTestPaths.length)
    expect(selectedTestPaths).toContain('tests/example.test.ts')
    // Newly indexed test files must not displace the production owner.
    expect(capsule.focus.focusFilePath).toBe('src/example.ts')
    expect(capsule.candidateFiles.map((file: { path: string }) => file.path)).toEqual(['src/example.ts'])
    expect(capsule.roleAdequacy.role).toBe('test-implementation')
  }, 120_000)
})
