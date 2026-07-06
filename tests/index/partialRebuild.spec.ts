import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const tempDirs: string[] = []

function runCli(args: string[]) {
  return spawnSync(process.execPath, [tsxCliPath(), 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
  })
}

function tsxCliPath(): string {
  return join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
}

/** Fixture with a re-export chain and export-all so cross-file dependency edges are exercised. */
function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-partial-rebuild-'))
  tempDirs.push(root)
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'types.ts'), 'export interface Foo { x: number }\n')
  writeFileSync(join(src, 'helpers.ts'), 'export function helper(): number { return 1 }\n')
  writeFileSync(
    join(src, 'reexport.ts'),
    "export { helper } from './helpers'\nexport * from './types'\n"
  )
  writeFileSync(
    join(src, 'index.ts'),
    "import { helper } from './reexport'\nimport type { Foo } from './reexport'\nexport function useAll(foo: Foo): number { return helper() + foo.x }\n"
  )
  return root
}

function runIncremental(root: string, out: string, extraArgs: string[] = []) {
  const result = runCli(['index', '--root', root, '--src', 'src', '--out', out, '--incremental', '--json', ...extraArgs])
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout)
}

function runFull(root: string, out: string, extraArgs: string[] = []) {
  const result = runCli(['index', '--root', root, '--src', 'src', '--out', out, '--json', ...extraArgs])
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout)
}

function readSymbolIndex(root: string, out: string) {
  return JSON.parse(readFileSync(join(root, out, 'symbol-index.json'), 'utf8'))
}

function readCodeGraph(root: string, out: string) {
  return JSON.parse(readFileSync(join(root, out, 'code-graph.json'), 'utf8'))
}

function normalizeSymbolIndex(index: ReturnType<typeof readSymbolIndex>) {
  return {
    ...index,
    buildTime: 'NORMALIZED',
    files: [...index.files].sort((a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  }
}

function normalizeCodeGraph(graph: ReturnType<typeof readCodeGraph>) {
  return { ...graph, createdAt: 'NORMALIZED' }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('index --incremental partial rebuild equivalence', () => {
  it('produces a symbol-index and code-graph equivalent to a clean full index after a changed file', () => {
    const root = createFixture()
    runIncremental(root, 'cache-out')
    writeFileSync(join(root, 'src', 'helpers.ts'), 'export function helper(): number { return 2 }\n')

    const partial = runIncremental(root, 'cache-out')
    expect(partial.cache.mode).toBe('incremental-partial')

    runFull(root, 'full-out')

    expect(normalizeSymbolIndex(readSymbolIndex(root, 'cache-out'))).toEqual(normalizeSymbolIndex(readSymbolIndex(root, 'full-out')))
    expect(normalizeCodeGraph(readCodeGraph(root, 'cache-out'))).toEqual(normalizeCodeGraph(readCodeGraph(root, 'full-out')))
  })

  it('produces equivalent output after an added file', () => {
    const root = createFixture()
    runIncremental(root, 'cache-out')
    writeFileSync(join(root, 'src', 'extra.ts'), "import { helper } from './reexport'\nexport function extra(): number { return helper() + 1 }\n")

    const partial = runIncremental(root, 'cache-out')
    expect(partial.cache.mode).toBe('incremental-partial')

    runFull(root, 'full-out')

    expect(normalizeSymbolIndex(readSymbolIndex(root, 'cache-out'))).toEqual(normalizeSymbolIndex(readSymbolIndex(root, 'full-out')))
    expect(normalizeCodeGraph(readCodeGraph(root, 'cache-out'))).toEqual(normalizeCodeGraph(readCodeGraph(root, 'full-out')))
  })

  it('produces equivalent output after a removed file, and the removed file disappears from all artifacts', () => {
    const root = createFixture()
    writeFileSync(join(root, 'src', 'extra.ts'), 'export function extra(): number { return 42 }\n')
    runIncremental(root, 'cache-out')
    rmSync(join(root, 'src', 'extra.ts'))

    const partial = runIncremental(root, 'cache-out')
    expect(partial.cache.mode).toBe('incremental-partial')
    expect(partial.cache.changedFileSummary.removedSample).toEqual(['src/extra.ts'])

    runFull(root, 'full-out')

    const symbolIndex = readSymbolIndex(root, 'cache-out')
    const paths = symbolIndex.files.map((file: { path: string }) => file.path)
    expect(paths).not.toContain('src/extra.ts')

    const codeGraph = readCodeGraph(root, 'cache-out')
    expect(codeGraph.nodes.some((node: { id: string }) => node.id.includes('extra'))).toBe(false)
    expect(codeGraph.edges.some((edge: { source: string; target: string }) => edge.source.includes('extra') || edge.target.includes('extra'))).toBe(
      false
    )

    expect(normalizeSymbolIndex(readSymbolIndex(root, 'cache-out'))).toEqual(normalizeSymbolIndex(readSymbolIndex(root, 'full-out')))
    expect(normalizeCodeGraph(readCodeGraph(root, 'cache-out'))).toEqual(normalizeCodeGraph(readCodeGraph(root, 'full-out')))
  })

  it('preserves re-export and export-all cross-file edges for reused (unchanged) files', () => {
    const root = createFixture()
    runIncremental(root, 'cache-out')
    // Change an unrelated file only — reexport.ts and its re-export/export-all edges must be reused, not dropped.
    writeFileSync(join(root, 'src', 'index.ts'), "import { helper } from './reexport'\nimport type { Foo } from './reexport'\nexport function useAll2(foo: Foo): number { return helper() + foo.x + 1 }\n")

    const partial = runIncremental(root, 'cache-out')
    expect(partial.cache.mode).toBe('incremental-partial')
    expect(partial.cache.changedFileSummary.unchangedCount).toBeGreaterThan(0)

    const symbolIndex = readSymbolIndex(root, 'cache-out')
    const fileDeps = symbolIndex.graph.fileDeps
    expect(fileDeps).toContainEqual({ from: 'src/reexport.ts', to: 'src/helpers.ts', kind: 're-export' })
    expect(fileDeps).toContainEqual({ from: 'src/reexport.ts', to: 'src/types.ts', kind: 'export-all' })
  })

  it('keeps unchanged file and symbol node IDs stable across a partial rebuild', () => {
    const root = createFixture()
    runIncremental(root, 'cache-out')
    const before = readCodeGraph(root, 'cache-out')
    const helperFileNodeBefore = before.nodes.find((n: { id: string }) => n.id === 'file:src/helpers.ts')
    const helperSymbolNodeBefore = before.nodes.find((n: { id: string }) => n.id === 'symbol:src/helpers.ts#helper')
    expect(helperFileNodeBefore).toBeTruthy()
    expect(helperSymbolNodeBefore).toBeTruthy()

    // Change an unrelated file so helpers.ts stays "unchanged" and gets reused.
    writeFileSync(join(root, 'src', 'index.ts'), "import { helper } from './reexport'\nimport type { Foo } from './reexport'\nexport function useAllAgain(foo: Foo): number { return helper() + foo.x + 2 }\n")
    const partial = runIncremental(root, 'cache-out')
    expect(partial.cache.mode).toBe('incremental-partial')
    expect(partial.cache.changedFileSummary.unchangedSample ?? true).toBeTruthy()

    const after = readCodeGraph(root, 'cache-out')
    const helperFileNodeAfter = after.nodes.find((n: { id: string }) => n.id === 'file:src/helpers.ts')
    const helperSymbolNodeAfter = after.nodes.find((n: { id: string }) => n.id === 'symbol:src/helpers.ts#helper')

    expect(helperFileNodeAfter).toEqual(helperFileNodeBefore)
    expect(helperSymbolNodeAfter).toEqual(helperSymbolNodeBefore)
  })

  it('produces an equivalent call-graph and reports the call-graph artifact fallback', () => {
    const root = createFixture()
    runIncremental(root, 'cache-out', ['--call-graph'])
    writeFileSync(join(root, 'src', 'helpers.ts'), 'export function helper(): number { return 3 }\n')

    const partial = runIncremental(root, 'cache-out', ['--call-graph'])
    expect(partial.cache.mode).toBe('incremental-partial-with-artifact-fallback')
    expect(partial.cache.partialRebuildFallbackArtifacts).toEqual(['call-graph'])

    runFull(root, 'full-out', ['--call-graph'])

    const partialCallGraph = JSON.parse(readFileSync(join(root, 'cache-out', 'call-graph.json'), 'utf8'))
    const fullCallGraph = JSON.parse(readFileSync(join(root, 'full-out', 'call-graph.json'), 'utf8'))
    expect({ ...partialCallGraph, buildTime: 'NORMALIZED' }).toEqual({ ...fullCallGraph, buildTime: 'NORMALIZED' })
  })

  it('reports manifest partialRebuildFallbackArtifacts as empty when call-graph is not requested', () => {
    const root = createFixture()
    runIncremental(root, 'cache-out')
    writeFileSync(join(root, 'src', 'helpers.ts'), 'export function helper(): number { return 4 }\n')

    const partial = runIncremental(root, 'cache-out')
    expect(partial.cache.mode).toBe('incremental-partial')
    expect(partial.manifest.partialRebuildFallbackArtifacts).toEqual([])
    expect(partial.manifest.cacheMode).toBe('incremental-partial')
    expect(partial.manifest.indexMode).toBe('incremental')
  })

  it('does not index its own cache-metadata.json during partial rebuild', () => {
    const root = createFixture()
    runIncremental(root, 'cache-out')
    writeFileSync(join(root, 'src', 'helpers.ts'), 'export function helper(): number { return 5 }\n')
    runIncremental(root, 'cache-out')

    const symbolIndex = readSymbolIndex(root, 'cache-out')
    const paths = symbolIndex.files.map((file: { path: string }) => file.path)
    expect(paths.some((p: string) => p.includes('cache-metadata'))).toBe(false)
  })

  it('still reports preflight warnings during a partial rebuild', () => {
    const root = createFixture()
    runIncremental(root, 'cache-out')
    writeFileSync(join(root, 'src', 'helpers.ts'), 'export function helper(): number { return 6 }\n')
    const partial = runIncremental(root, 'cache-out')

    expect(Array.isArray(partial.preflightWarnings)).toBe(true)
  })

  it('keeps --progress JSON stdout parseable during a partial rebuild', () => {
    const root = createFixture()
    runIncremental(root, 'cache-out')
    writeFileSync(join(root, 'src', 'helpers.ts'), 'export function helper(): number { return 7 }\n')

    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'cache-out', '--incremental', '--progress', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.cache.mode).toBe('incremental-partial')
    expect(result.stderr).toContain('[my-dev-kit:index]')
  })

  it('falls back to a full rebuild honestly when the previous symbol-index is missing despite a valid cache', () => {
    const root = createFixture()
    runIncremental(root, 'cache-out')
    rmSync(join(root, 'cache-out', 'symbol-index.json'))
    writeFileSync(join(root, 'src', 'helpers.ts'), 'export function helper(): number { return 8 }\n')

    const result = runIncremental(root, 'cache-out')

    expect(result.cache.mode).toBe('incremental-change-detected-full-rebuild')
    expect(result.cache.invalidationReason).toBeTruthy()
    expect(existsSync(join(root, 'cache-out', 'symbol-index.json'))).toBe(true)
  })
})
