import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCodeGraph } from '../../src/graph/buildCodeGraph.js'
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'
import { SCHEMA_VERSION, type SymbolIndex } from '../../src/symbol-index/types.js'
import {
  buildCacheMetadata,
  computeBaselineArtifactIdentity,
  writeCacheMetadata,
  type ChangedFilePaths,
} from '../../src/indexing/cacheMetadata.js'
import { loadTrustedBaseline, type TrustedBaselineResult } from '../../src/indexing/trustedBaseline.js'
import { selectAffectedNeighborhood } from '../../src/indexing/affectedNeighborhood.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const tempDirs: string[] = []
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** Every listed symbol is exported, so each yields a `defines` and an `exports` edge. */
function makeSymbolIndex(files: Record<string, string[]>, deps: Array<[string, string]> = []): SymbolIndex {
  const summaries = Object.entries(files).map(([path, names]) => ({
    path,
    language: 'typescript' as const,
    lineCount: 10,
    imports: [],
    exports: names,
    hasCallGraphEntries: false,
    symbols: names.map((name, index) => ({
      name,
      kind: 'function' as const,
      location: { file: path, line: index + 1 },
      exported: true,
    })),
  }))
  return {
    schemaVersion: SCHEMA_VERSION,
    buildTime: '2026-01-01T00:00:00.000Z',
    repoRoot: '/repo',
    sourceRoots: ['src'],
    fileCount: summaries.length,
    symbolCount: summaries.reduce((n, f) => n + f.symbols.length, 0),
    files: summaries,
    graph: {
      fileDeps: deps.map(([from, to]) => ({ from, to, kind: 'import' as const })),
    } as SymbolIndex['graph'],
  }
}

/**
 * a.ts{fa,ga}  b.ts{fb}  c.ts{fc}  d.ts{fd}  e.ts{fe}  f.ts{ff}  r.ts{fr}
 * imports: b->a, a->c, c->d, b->c, e->r, plus a `related-to` edge ga -> file:f.ts
 */
function baselineParts(): { symbolIndex: SymbolIndex; codeGraph: CodeGraph } {
  const symbolIndex = makeSymbolIndex(
    {
      'src/a.ts': ['fa', 'ga'],
      'src/b.ts': ['fb'],
      'src/c.ts': ['fc'],
      'src/d.ts': ['fd'],
      'src/e.ts': ['fe'],
      'src/f.ts': ['ff'],
      'src/r.ts': ['fr'],
    },
    [
      ['src/b.ts', 'src/a.ts'],
      ['src/a.ts', 'src/c.ts'],
      ['src/c.ts', 'src/d.ts'],
      ['src/b.ts', 'src/c.ts'],
      ['src/e.ts', 'src/r.ts'],
    ]
  )
  const codeGraph = buildCodeGraph({ symbolIndex })
  codeGraph.edges.push({
    id: 'symbol:src/a.ts#ga--related-to-->file:src/f.ts',
    source: 'symbol:src/a.ts#ga',
    target: 'file:src/f.ts',
    kind: 'related-to',
  })
  return { symbolIndex, codeGraph }
}

function trusted(parts = baselineParts()): TrustedBaselineResult {
  return {
    status: 'trusted',
    baseline: { cache: {} as never, manifest: {} as never, ...parts },
  }
}

const ALL_CURRENT = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => `src/${n}.ts`)

function classification(partial: Partial<ChangedFilePaths>): ChangedFilePaths {
  return { added: [], changed: [], removed: [], unchanged: [], ...partial }
}

function select(
  partial: Partial<ChangedFilePaths>,
  parts = baselineParts(),
  currentPaths: string[] = ALL_CURRENT
) {
  return selectAffectedNeighborhood({
    baseline: trusted(parts),
    classification: classification(partial),
    currentPaths,
    sourceRoots: ['src'],
  })
}

// ---------------------------------------------------------------------------
// Trusted baseline loader
// ---------------------------------------------------------------------------

const PROJECT_ROOT = 'C:/work/project'
const CONFIG = 'cfg-fingerprint'

interface DiskBaseline {
  dir: string
  input: { outputDir: string; projectRoot: string; sourceRoots: string[]; configFingerprint: string }
}

function writeDiskBaseline(options: { symbolIndexName?: string; manifestSourceRoots?: string[] } = {}): DiskBaseline {
  const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-baseline-'))
  tempDirs.push(dir)
  const { symbolIndex, codeGraph } = baselineParts()
  const symbolIndexName = options.symbolIndexName ?? 'symbol-index.json'
  writeFileSync(join(dir, symbolIndexName), JSON.stringify(symbolIndex))
  writeFileSync(join(dir, 'code-graph.json'), JSON.stringify(codeGraph))
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      artifactKind: 'my-dev-kit-v1-manifest',
      version: '1.0.0',
      projectRoot: PROJECT_ROOT,
      sourceRoots: options.manifestSourceRoots ?? ['src'],
      artifacts: { symbolIndex: symbolIndexName, codeGraph: 'code-graph.json', callGraph: null },
    })
  )
  writeCacheMetadata(
    dir,
    buildCacheMetadata({
      projectRoot: PROJECT_ROOT,
      sourceRoots: ['src'],
      configFingerprint: CONFIG,
      files: [],
      baselineArtifacts: computeBaselineArtifactIdentity(dir),
    })
  )
  return { dir, input: { outputDir: dir, projectRoot: PROJECT_ROOT, sourceRoots: ['src'], configFingerprint: CONFIG } }
}

function rewriteCache(dir: string, mutate: (cache: Record<string, unknown>) => void): void {
  const path = join(dir, 'cache-metadata.json')
  const cache = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  mutate(cache)
  writeFileSync(path, JSON.stringify(cache))
}

describe('loadTrustedBaseline', () => {
  it('accepts a cache whose recorded identities match the manifest, symbol index and code graph', () => {
    const { input } = writeDiskBaseline()
    const result = loadTrustedBaseline(input)
    expect(result.status).toBe('trusted')
  })

  it('accepts a manifest-registered symbol index that is not named symbol-index.json', () => {
    const { input } = writeDiskBaseline({ symbolIndexName: 'renamed-symbols.json' })
    expect(loadTrustedBaseline(input).status).toBe('trusted')
  })

  it('does not trust an unregistered same-named stale file over the manifest-referenced one', () => {
    const { dir, input } = writeDiskBaseline({ symbolIndexName: 'renamed-symbols.json' })
    writeFileSync(join(dir, 'symbol-index.json'), '{"stale":true}')
    expect(loadTrustedBaseline(input).status).toBe('trusted')
  })

  it.each([
    ['manifest.json', 'manifest-hash-mismatch'],
    ['symbol-index.json', 'symbol-index-hash-mismatch'],
    ['code-graph.json', 'code-graph-hash-mismatch'],
  ])('rejects a %s whose bytes differ from the recorded SHA-256', (file, reason) => {
    const { dir, input } = writeDiskBaseline()
    const original = readFileSync(join(dir, file), 'utf8')
    writeFileSync(join(dir, file), `${original}\n`)
    expect(loadTrustedBaseline(input)).toMatchObject({ status: 'unsafe', reason })
  })

  it('reports a missing cache as unavailable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-baseline-'))
    tempDirs.push(dir)
    expect(loadTrustedBaseline({ ...writeDiskBaseline().input, outputDir: dir })).toMatchObject({
      status: 'unavailable',
      reason: 'cache-missing',
    })
  })

  it('reports missing artifacts as unavailable', () => {
    const missingManifest = writeDiskBaseline()
    rmSync(join(missingManifest.dir, 'manifest.json'))
    expect(loadTrustedBaseline(missingManifest.input)).toMatchObject({ status: 'unavailable', reason: 'manifest-missing' })

    const missingSymbols = writeDiskBaseline()
    rmSync(join(missingSymbols.dir, 'symbol-index.json'))
    expect(loadTrustedBaseline(missingSymbols.input)).toMatchObject({ status: 'unavailable', reason: 'symbol-index-missing' })

    const missingGraph = writeDiskBaseline()
    rmSync(join(missingGraph.dir, 'code-graph.json'))
    expect(loadTrustedBaseline(missingGraph.input)).toMatchObject({ status: 'unavailable', reason: 'code-graph-missing' })
  })

  it('treats a malformed artifact with a matching hash as unreadable', () => {
    const { dir, input } = writeDiskBaseline()
    writeFileSync(join(dir, 'code-graph.json'), '{not json')
    rewriteCache(dir, (cache) => {
      ;(cache.baselineArtifacts as Record<string, string>).codeGraphSha256 = sha('{not json')
    })
    expect(loadTrustedBaseline(input)).toMatchObject({ status: 'unsafe', reason: 'code-graph-unreadable' })
  })

  it('rejects an unsupported symbol-index schema and an unsupported code-graph schema', () => {
    const symbols = writeDiskBaseline()
    const badSymbols = JSON.stringify({ ...baselineParts().symbolIndex, schemaVersion: '999' })
    writeFileSync(join(symbols.dir, 'symbol-index.json'), badSymbols)
    rewriteCache(symbols.dir, (cache) => {
      ;(cache.baselineArtifacts as Record<string, string>).symbolIndexSha256 = sha(badSymbols)
    })
    expect(loadTrustedBaseline(symbols.input)).toMatchObject({ status: 'incompatible', reason: 'symbol-index-incompatible' })

    const graph = writeDiskBaseline()
    const badGraph = JSON.stringify({ ...baselineParts().codeGraph, schemaVersion: '999' })
    writeFileSync(join(graph.dir, 'code-graph.json'), badGraph)
    rewriteCache(graph.dir, (cache) => {
      ;(cache.baselineArtifacts as Record<string, string>).codeGraphSha256 = sha(badGraph)
    })
    expect(loadTrustedBaseline(graph.input)).toMatchObject({ status: 'incompatible', reason: 'code-graph-incompatible' })
  })

  it('rejects a manifest-referenced artifact path that escapes the index directory', () => {
    const { dir, input } = writeDiskBaseline()
    const escaping = JSON.stringify({
      artifactKind: 'my-dev-kit-v1-manifest',
      version: '1.0.0',
      projectRoot: PROJECT_ROOT,
      sourceRoots: ['src'],
      artifacts: { symbolIndex: '../outside.json', codeGraph: 'code-graph.json', callGraph: null },
    })
    writeFileSync(join(dir, 'manifest.json'), escaping)
    rewriteCache(dir, (cache) => {
      ;(cache.baselineArtifacts as Record<string, string>).manifestSha256 = sha(escaping)
    })
    expect(loadTrustedBaseline(input)).toMatchObject({ status: 'unsafe', reason: 'artifact-path-escape' })
  })

  it('rejects mismatched project root, source roots and configuration fingerprint', () => {
    const { input } = writeDiskBaseline()
    expect(loadTrustedBaseline({ ...input, projectRoot: 'C:/work/other' })).toMatchObject({
      status: 'incompatible',
      reason: 'project-root-mismatch',
    })
    expect(loadTrustedBaseline({ ...input, sourceRoots: ['src', 'tests'] })).toMatchObject({
      status: 'incompatible',
      reason: 'source-root-mismatch',
    })
    expect(loadTrustedBaseline({ ...input, configFingerprint: 'different' })).toMatchObject({
      status: 'incompatible',
      reason: 'config-mismatch',
    })
  })

  it('rejects a manifest whose source roots differ from the current run', () => {
    const { input } = writeDiskBaseline({ manifestSourceRoots: ['lib'] })
    // the manifest bytes are hashed into the cache, so only its own identity differs
    expect(loadTrustedBaseline(input)).toMatchObject({ status: 'incompatible', reason: 'source-root-mismatch' })
  })

  it('treats the previous cache schema as incompatible', () => {
    const { dir, input } = writeDiskBaseline()
    rewriteCache(dir, (cache) => {
      cache.cacheSchemaVersion = '1.1.0'
      delete cache.baselineArtifacts
    })
    expect(loadTrustedBaseline(input)).toMatchObject({ status: 'incompatible', reason: 'cache-incompatible' })
  })

  it('is insensitive to source-root order and separator style', () => {
    const { input } = writeDiskBaseline()
    expect(loadTrustedBaseline({ ...input, sourceRoots: ['./src/'] }).status).toBe('trusted')
  })
})

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

describe('selectAffectedNeighborhood seeds', () => {
  it('seeds a modified baseline file node and its valid symbol nodes', () => {
    const result = select({ changed: ['src/a.ts'] })
    expect(result).toMatchObject({ status: 'selected', seedFileCount: 1, seedSymbolCount: 2, seedFilePaths: ['src/a.ts'] })
  })

  it('seeds a removed baseline file node and its symbols, but never returns it as a current target', () => {
    const result = select({ removed: ['src/r.ts'] })
    expect(result).toMatchObject({ status: 'selected', seedFileCount: 1, seedSymbolCount: 1 })
    if (result.status !== 'selected') throw new Error('expected selected')
    expect(result.affectedNodeIds).toContain('file:src/e.ts')
    expect(result.selectedCurrentFilePaths).toEqual(['src/e.ts'])
    expect(result.selectedCurrentFilePaths).not.toContain('src/r.ts')
  })

  it('does not seed added files or fabricate baseline identities for them', () => {
    const result = select({ added: ['src/new.ts'] }, baselineParts(), [...ALL_CURRENT, 'src/new.ts'])
    expect(result).toMatchObject({ status: 'no-seeds', seedFileCount: 0, seedSymbolCount: 0, affectedNodeCount: 0 })
    if (result.status !== 'no-seeds') throw new Error('expected no-seeds')
    expect(result.selectedCurrentFilePaths).toEqual([])
  })

  it('does not fabricate a seed for a modified path unknown to the baseline', () => {
    const result = select({ changed: ['src/unknown.ts'] })
    expect(result).toMatchObject({ status: 'no-seeds', unseededPaths: ['src/unknown.ts'] })
  })

  it('skips a symbol whose graph node does not exist instead of inventing one', () => {
    const parts = baselineParts()
    parts.codeGraph.nodes = parts.codeGraph.nodes.filter((node) => node.id !== 'symbol:src/a.ts#ga')
    parts.codeGraph.edges = parts.codeGraph.edges.filter((edge) => !edge.id.includes('#ga'))
    expect(select({ changed: ['src/a.ts'] }, parts)).toMatchObject({ status: 'selected', seedSymbolCount: 1 })
  })

  it('collapses duplicate seed identities deterministically', () => {
    const result = select({ changed: ['src/a.ts', 'src/a.ts'], removed: ['src\\a.ts'] })
    expect(result).toMatchObject({ status: 'selected', seedFileCount: 1, seedSymbolCount: 2 })
  })
})

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

describe('selectAffectedNeighborhood geometry', () => {
  it('selects exactly the one-hop neighborhood in both directions across edge kinds', () => {
    const result = select({ changed: ['src/a.ts'] })
    if (result.status !== 'selected') throw new Error('expected selected')

    // seeds remain affected
    expect(result.affectedNodeIds).toEqual(
      expect.arrayContaining(['file:src/a.ts', 'symbol:src/a.ts#fa', 'symbol:src/a.ts#ga'])
    )
    // incoming import (b->a), outgoing import (a->c), related-to (ga->f)
    expect(result.affectedNodeIds).toEqual(expect.arrayContaining(['file:src/b.ts', 'file:src/c.ts', 'file:src/f.ts']))
    // second hop excluded, neighbors' own symbols excluded
    expect(result.affectedNodeIds).not.toContain('file:src/d.ts')
    expect(result.affectedNodeIds).not.toContain('symbol:src/b.ts#fb')
    expect(result.selectedCurrentFilePaths).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/f.ts'])
    expect(result.unchangedNeighborFilePaths).toEqual(['src/b.ts', 'src/c.ts', 'src/f.ts'])
  })

  it('counts only distinct edges incident to an original seed', () => {
    const result = select({ changed: ['src/a.ts'] })
    if (result.status !== 'selected') throw new Error('expected selected')
    // 3 defines + 3... : (a->fa, a->ga) x (defines, exports) = 4, plus b->a, a->c, ga->f = 7.
    // b->c connects two affected neighbors but neither is a seed, so it is not counted.
    expect(result.affectedEdgeCount).toBe(7)
    expect(result.affectedNodeCount).toBe(6)
  })

  it('does not recurse from a discovered neighbor', () => {
    const result = select({ changed: ['src/e.ts'] })
    if (result.status !== 'selected') throw new Error('expected selected')
    // e -> r is one hop; r has no further hop and nothing beyond it is reached.
    expect(result.selectedCurrentFilePaths).toEqual(['src/e.ts'])
    expect(result.affectedNodeIds).toContain('file:src/r.ts')
    expect(result.affectedNodeIds).not.toContain('symbol:src/r.ts#fr')
  })

  it('returns identical ordered evidence on repeated invocation', () => {
    const first = select({ changed: ['src/a.ts', 'src/e.ts'], removed: ['src/r.ts'] })
    const second = select({ removed: ['src/r.ts'], changed: ['src/e.ts', 'src/a.ts'] })
    expect(second).toEqual(first)
    if (first.status !== 'selected') throw new Error('expected selected')
    expect(first.selectedCurrentFilePaths).toEqual([...first.selectedCurrentFilePaths].sort())
    expect(first.affectedNodeIds).toEqual([...first.affectedNodeIds].sort())
  })

  it('collapses identical repeated edge records without double counting', () => {
    const parts = baselineParts()
    parts.codeGraph.edges.push({ ...parts.codeGraph.edges.find((edge) => edge.kind === 'related-to')! })
    const result = select({ changed: ['src/a.ts'] }, parts)
    if (result.status !== 'selected') throw new Error('expected selected')
    expect(result.affectedEdgeCount).toBe(7)
  })

  it('tolerates overload-style duplicate symbol nodes that differ only by line', () => {
    const parts = baselineParts()
    const original = parts.codeGraph.nodes.find((node) => node.id === 'symbol:src/a.ts#fa')!
    parts.codeGraph.nodes.push({ ...original, line: 99 })
    expect(select({ changed: ['src/a.ts'] }, parts).status).toBe('selected')
  })
})

// ---------------------------------------------------------------------------
// Current-file mapping
// ---------------------------------------------------------------------------

describe('selectAffectedNeighborhood current-file mapping', () => {
  it('maps an affected symbol through its grounded owning file', () => {
    const parts = baselineParts()
    parts.codeGraph.edges.push({
      id: 'symbol:src/a.ts#fa--calls-->symbol:src/d.ts#fd',
      source: 'symbol:src/a.ts#fa',
      target: 'symbol:src/d.ts#fd',
      kind: 'calls',
    })
    const result = select({ changed: ['src/a.ts'] }, parts)
    if (result.status !== 'selected') throw new Error('expected selected')
    expect(result.affectedNodeIds).toContain('symbol:src/d.ts#fd')
    expect(result.selectedCurrentFilePaths).toContain('src/d.ts')
  })

  it('excludes affected files that no longer survive in the current set', () => {
    const result = select({ changed: ['src/a.ts'] }, baselineParts(), ['src/a.ts', 'src/b.ts'])
    if (result.status !== 'selected') throw new Error('expected selected')
    expect(result.selectedCurrentFilePaths).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('excludes paths outside the accepted source roots', () => {
    const result = selectAffectedNeighborhood({
      baseline: trusted(),
      classification: classification({ changed: ['src/a.ts'] }),
      currentPaths: ALL_CURRENT,
      sourceRoots: ['src/only'],
    })
    if (result.status !== 'selected') throw new Error('expected selected')
    expect(result.selectedCurrentFilePaths).toEqual([])
  })

  it('does not fabricate a path for a pathless or unowned affected node', () => {
    const parts = baselineParts()
    parts.codeGraph.nodes.push({ id: 'frontend-fact:orphan', kind: 'frontend-fact', label: 'src/d.ts' })
    parts.codeGraph.edges.push({
      id: 'file:src/a.ts--related-to-->frontend-fact:orphan',
      source: 'file:src/a.ts',
      target: 'frontend-fact:orphan',
      kind: 'related-to',
    })
    const result = select({ changed: ['src/a.ts'] }, parts)
    if (result.status !== 'selected') throw new Error('expected selected')
    expect(result.affectedNodeIds).toContain('frontend-fact:orphan')
    expect(result.selectedCurrentFilePaths).not.toContain('src/d.ts')
    expect(result.unmappedAffectedNodeCount).toBe(1)
  })

  it('does not trust a node whose path is not a baseline-owned file', () => {
    const parts = baselineParts()
    parts.codeGraph.nodes.push({ id: 'symbol:src/ghost.ts#g', kind: 'symbol', label: 'g', path: 'src/ghost.ts', symbolName: 'g' })
    parts.codeGraph.edges.push({
      id: 'file:src/a.ts--related-to-->symbol:src/ghost.ts#g',
      source: 'file:src/a.ts',
      target: 'symbol:src/ghost.ts#g',
      kind: 'related-to',
    })
    const result = select({ changed: ['src/a.ts'] }, parts, [...ALL_CURRENT, 'src/ghost.ts'])
    if (result.status !== 'selected') throw new Error('expected selected')
    expect(result.selectedCurrentFilePaths).not.toContain('src/ghost.ts')
  })

  it('normalizes Windows separators in classified paths to the forward-slash identity', () => {
    const result = select({ changed: ['src\\a.ts'] }, baselineParts(), ALL_CURRENT.map((p) => p.replace(/\//g, '\\')))
    if (result.status !== 'selected') throw new Error('expected selected')
    expect(result.seedFilePaths).toEqual(['src/a.ts'])
    expect(result.selectedCurrentFilePaths).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/f.ts'])
  })
})

// ---------------------------------------------------------------------------
// Fail-closed behavior
// ---------------------------------------------------------------------------

describe('selectAffectedNeighborhood fail-closed behavior', () => {
  it('reports a dangling edge as unsafe', () => {
    const parts = baselineParts()
    parts.codeGraph.edges.push({ id: 'x', source: 'file:src/a.ts', target: 'file:src/missing.ts', kind: 'imports' })
    expect(select({ changed: ['src/a.ts'] }, parts)).toMatchObject({ status: 'unsafe', reason: 'dangling-edge' })
  })

  it('reports a conflicting duplicate node id as unsafe', () => {
    const parts = baselineParts()
    parts.codeGraph.nodes.push({ id: 'file:src/a.ts', kind: 'file', label: 'a.ts', path: 'src/other.ts' })
    expect(select({ changed: ['src/a.ts'] }, parts)).toMatchObject({ status: 'unsafe', reason: 'conflicting-duplicate-node' })
  })

  it('reports a conflicting duplicate edge id as unsafe', () => {
    const parts = baselineParts()
    const edge = parts.codeGraph.edges[0]!
    parts.codeGraph.edges.push({ ...edge, target: 'file:src/d.ts' })
    expect(select({ changed: ['src/a.ts'] }, parts)).toMatchObject({ status: 'unsafe', reason: 'conflicting-duplicate-edge' })
  })

  it('reports malformed node and edge records as unsafe', () => {
    const badNode = baselineParts()
    ;(badNode.codeGraph.nodes as unknown[]).push({ kind: 'file' })
    expect(select({ changed: ['src/a.ts'] }, badNode)).toMatchObject({ status: 'unsafe', reason: 'malformed-node' })

    const badEdge = baselineParts()
    ;(badEdge.codeGraph.edges as unknown[]).push({ id: 'e', source: 'file:src/a.ts' })
    expect(select({ changed: ['src/a.ts'] }, badEdge)).toMatchObject({ status: 'unsafe', reason: 'malformed-edge' })
  })

  it('reports malformed required symbol ownership as unsafe', () => {
    const parts = baselineParts()
    ;(parts.symbolIndex.files[0] as unknown as { symbols: unknown }).symbols = 'nope'
    expect(select({ changed: ['src/a.ts'] }, parts)).toMatchObject({ status: 'unsafe', reason: 'malformed-symbol-ownership' })
  })

  it('reports a seed file with no file node, or a disagreeing symbol node, as unsafe', () => {
    const noNode = baselineParts()
    noNode.codeGraph.nodes = noNode.codeGraph.nodes.filter((node) => node.id !== 'file:src/a.ts')
    noNode.codeGraph.edges = noNode.codeGraph.edges.filter((edge) => edge.source !== 'file:src/a.ts' && edge.target !== 'file:src/a.ts')
    expect(select({ changed: ['src/a.ts'] }, noNode)).toMatchObject({ status: 'unsafe', reason: 'seed-file-node-missing' })

    const wrongOwner = baselineParts()
    const node = wrongOwner.codeGraph.nodes.find((n) => n.id === 'symbol:src/a.ts#fa')!
    node.path = 'src/b.ts'
    expect(select({ changed: ['src/a.ts'] }, wrongOwner)).toMatchObject({ status: 'unsafe', reason: 'inconsistent-symbol-identity' })
  })

  it('passes a non-trusted baseline through with its status and reason', () => {
    const result = selectAffectedNeighborhood({
      baseline: { status: 'unsafe', reason: 'code-graph-hash-mismatch', detail: 'x' },
      classification: classification({ changed: ['src/a.ts'] }),
      currentPaths: ALL_CURRENT,
    })
    expect(result).toEqual({
      status: 'baseline-not-trusted',
      baselineStatus: 'unsafe',
      reason: 'code-graph-hash-mismatch',
      detail: 'x',
    })
  })

})
