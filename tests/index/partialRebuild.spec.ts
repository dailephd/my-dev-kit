import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { buildCodeGraph } from '../../src/graph/buildCodeGraph.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'
import { buildCacheFileEntries, classifyChangedFilePaths, readCacheMetadata } from '../../src/indexing/cacheMetadata.js'
import { discoverSourceFiles } from '../../src/indexing/discoverSourceFiles.js'
import { buildPartialSymbolIndex, checkPartialRebuildEligibility } from '../../src/indexing/partialRebuild.js'
import { loadTrustedBaseline } from '../../src/indexing/trustedBaseline.js'
import { selectAffectedNeighborhood } from '../../src/indexing/affectedNeighborhood.js'

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

describe('buildPartialSymbolIndex forced re-extraction (v1.12.5 affected-neighborhood integration)', () => {
  const OUT = 'cache-out'

  /** a.ts <- b.ts (imports a); c.ts is unrelated. */
  function createNeighborhoodFixture(): string {
    const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-neighborhood-'))
    tempDirs.push(root)
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'a.ts'), 'export function fa(): number { return 1 }\n')
    writeFileSync(join(src, 'b.ts'), "import { fa } from './a'\nexport function fb(): number { return fa() + 1 }\n")
    writeFileSync(join(src, 'c.ts'), 'export function fc(): number { return 3 }\n')
    return root
  }

  function plan(root: string, buildCallGraph = false) {
    const outputDir = join(root, OUT)
    const cacheRead = readCacheMetadata(outputDir)
    if (cacheRead.status !== 'ok') throw new Error('expected a readable cache')
    const cache = cacheRead.metadata
    const discovery = discoverSourceFiles({ repoRoot: root, sourceRoots: ['src'] })
    const currentEntries = buildCacheFileEntries(discovery.files)
    const detailed = classifyChangedFilePaths(cache.files, currentEntries)
    const baseline = loadTrustedBaseline({
      outputDir,
      projectRoot: root,
      sourceRoots: ['src'],
      configFingerprint: cache.configFingerprint,
    })
    const selection = selectAffectedNeighborhood({
      baseline,
      classification: detailed,
      currentPaths: currentEntries.map((entry) => entry.path),
      sourceRoots: ['src'],
    })
    const eligibility = checkPartialRebuildEligibility(outputDir, detailed.unchanged)
    const buildPartial = (forced: readonly string[] | undefined) =>
      buildPartialSymbolIndex({
        repoRoot: root,
        sourceRoots: ['src'],
        buildCallGraph,
        discoveryFiles: discovery.files,
        unchangedPaths: new Set(detailed.unchanged),
        forceReextractPaths: forced ? new Set(forced) : undefined,
        previousFileSummariesByPath: eligibility.previousFileSummariesByPath,
        previousCacheEntriesByPath: new Map(cache.files.map((entry) => [entry.path, entry])),
      })
    return { discovery, detailed, baseline, selection, eligibility, buildPartial }
  }

  function fullBuild(root: string, buildCallGraph = false) {
    return buildIndex({ repoRoot: root, sourceRoots: ['src'], buildCallGraph })
  }

  function normalized(index: SymbolIndex) {
    return { ...index, buildTime: 'NORMALIZED' }
  }

  function normalizedGraph(index: SymbolIndex) {
    return { ...buildCodeGraph({ symbolIndex: index }), createdAt: 'NORMALIZED' }
  }

  it('freshly extracts changed and selected neighbor files, and reuses unrelated unchanged files', () => {
    const root = createNeighborhoodFixture()
    runIncremental(root, OUT)
    writeFileSync(join(root, 'src', 'a.ts'), 'export function fa(): number { return 1 }\nexport function fa2(): number { return 2 }\n')

    const { detailed, selection, buildPartial } = plan(root)
    expect(detailed).toMatchObject({ changed: ['src/a.ts'], unchanged: ['src/b.ts', 'src/c.ts'], added: [], removed: [] })
    if (selection.status !== 'selected') throw new Error(`expected selected, got ${JSON.stringify(selection)}`)
    expect(selection.unchangedNeighborFilePaths).toEqual(['src/b.ts'])

    const partial = buildPartial(selection.unchangedNeighborFilePaths)
    expect(partial.freshlyExtractedPaths).toEqual(['src/a.ts', 'src/b.ts'])
    expect(partial.forcedReextractPaths).toEqual(['src/b.ts'])
    expect(partial.reusedPaths).toEqual(['src/c.ts'])
  })

  it('converges with an ordinary full extraction of the same final source tree', () => {
    const root = createNeighborhoodFixture()
    runIncremental(root, OUT)
    writeFileSync(join(root, 'src', 'a.ts'), 'export function fa(): number { return 1 }\nexport function fa2(): number { return 2 }\n')

    const { selection, buildPartial } = plan(root)
    if (selection.status !== 'selected') throw new Error('expected selected')
    const partial = buildPartial(selection.unchangedNeighborFilePaths)
    const full = fullBuild(root)

    expect(normalized(partial.index)).toEqual(normalized(full.index))
    expect(normalizedGraph(partial.index)).toEqual(normalizedGraph(full.index))
    expect(partial.fileExtractionMeta).toEqual(full.fileExtractionMeta)
    const paths = partial.index.files.map((file) => file.path)
    expect(paths).toEqual([...paths].sort())
  })

  it('uses fresh per-file evidence, not the stale previous summary, for a forced file', () => {
    const root = createNeighborhoodFixture()
    runIncremental(root, OUT)
    const { detailed, eligibility, buildPartial } = plan(root)
    expect(detailed.changed).toEqual([])

    // Poison the previous summary of b.ts: only a fresh extraction can overwrite it.
    const stale = eligibility.previousFileSummariesByPath.get('src/b.ts')!
    eligibility.previousFileSummariesByPath.set('src/b.ts', { ...stale, symbols: [], exports: ['STALE'], lineCount: 999 })

    const reused = buildPartial(undefined).index.files.find((file) => file.path === 'src/b.ts')!
    expect(reused.exports).toEqual(['STALE'])

    const forced = buildPartial(['src/b.ts'])
    const fresh = forced.index.files.find((file) => file.path === 'src/b.ts')!
    expect(fresh.exports).toEqual(['fb'])
    expect(fresh.lineCount).not.toBe(999)
    expect(forced.fileExtractionMeta.get('src/b.ts')).toEqual(fullBuild(root).fileExtractionMeta.get('src/b.ts'))
    expect(forced.forcedReextractPaths).toEqual(['src/b.ts'])
    expect(forced.reusedPaths).toEqual(['src/a.ts', 'src/c.ts'])
  })

  it('leaves behavior unchanged when no force set is supplied', () => {
    const root = createNeighborhoodFixture()
    runIncremental(root, OUT)
    writeFileSync(join(root, 'src', 'c.ts'), 'export function fc(): number { return 4 }\nexport const extra = 1\n')
    writeFileSync(join(root, 'src', 'd.ts'), 'export function fd(): number { return 5 }\n')

    const { buildPartial } = plan(root)
    for (const forced of [undefined, []] as const) {
      const partial = buildPartial(forced)
      expect(partial.freshlyExtractedPaths).toEqual(['src/c.ts', 'src/d.ts'])
      expect(partial.reusedPaths).toEqual(['src/a.ts', 'src/b.ts'])
      expect(partial.forcedReextractPaths).toEqual([])
      expect(normalized(partial.index)).toEqual(normalized(fullBuild(root).index))
    }
  })

  it('keeps added files fresh independent of the force set', () => {
    const root = createNeighborhoodFixture()
    runIncremental(root, OUT)
    writeFileSync(join(root, 'src', 'd.ts'), "import { fc } from './c'\nexport function fd(): number { return fc() }\n")
    const { detailed, selection, buildPartial } = plan(root)
    expect(detailed.added).toEqual(['src/d.ts'])
    expect(selection.status).toBe('no-seeds')
    const partial = buildPartial([])
    expect(partial.freshlyExtractedPaths).toEqual(['src/d.ts'])
    expect(partial.reusedPaths).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
  })

  it('treats a removed seed as a baseline seed while the removed file stays absent from current output', () => {
    const root = createNeighborhoodFixture()
    runIncremental(root, OUT)
    rmSync(join(root, 'src', 'a.ts'))

    const { detailed, selection, buildPartial } = plan(root)
    expect(detailed.removed).toEqual(['src/a.ts'])
    if (selection.status !== 'selected') throw new Error('expected selected')
    expect(selection.seedFilePaths).toEqual(['src/a.ts'])
    expect(selection.unchangedNeighborFilePaths).toEqual(['src/b.ts'])

    const partial = buildPartial(selection.unchangedNeighborFilePaths)
    expect(partial.freshlyExtractedPaths).toEqual(['src/b.ts'])
    expect(partial.reusedPaths).toEqual(['src/c.ts'])
    expect(partial.index.files.map((file) => file.path)).toEqual(['src/b.ts', 'src/c.ts'])
    for (const paths of [partial.freshlyExtractedPaths, partial.reusedPaths, partial.forcedReextractPaths]) {
      expect(paths).not.toContain('src/a.ts')
    }
    expect(normalized(partial.index)).toEqual(normalized(fullBuild(root).index))
    expect(normalizedGraph(partial.index)).toEqual(normalizedGraph(fullBuild(root).index))
  })

  it('rejects forced paths that are not current unchanged discovered files', () => {
    const root = createNeighborhoodFixture()
    runIncremental(root, OUT)
    writeFileSync(join(root, 'src', 'a.ts'), 'export function fa(): number { return 9 }\n')
    const { buildPartial } = plan(root)
    expect(() => buildPartial(['src/missing.ts'])).toThrow(/not a current unchanged discovered file/)
    expect(() => buildPartial(['src/a.ts'])).toThrow(/not a current unchanged discovered file/)
  })

  it('still fully regenerates the call graph, identically to a full build, when files are forced', () => {
    const root = createNeighborhoodFixture()
    runIncremental(root, OUT, ['--call-graph'])
    writeFileSync(join(root, 'src', 'a.ts'), 'export function fa(): number { return 1 }\nexport function fa2(): number { return fa() }\n')

    const { selection, buildPartial } = plan(root, true)
    if (selection.status !== 'selected') throw new Error('expected selected')
    const partial = buildPartial(selection.unchangedNeighborFilePaths)
    const full = fullBuild(root, true)

    expect(partial.callGraphFallback).toBe(true)
    expect(partial.callGraph?.edges).toEqual(full.callGraph?.edges)
    expect(normalized(partial.index)).toEqual(normalized(full.index))
  })
})
