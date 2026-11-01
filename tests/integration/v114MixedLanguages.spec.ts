import { beforeAll, describe, expect, it } from 'vitest'
import * as path from 'node:path'
import { prepareRustParser } from '../../src/languages/rust/parser.js'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { buildCodeGraph } from '../../src/graph/buildCodeGraph.js'
import { buildRustStructure } from '../../src/graph/buildRustStructure.js'
import { buildRustRelationships } from '../../src/graph/buildRustRelationships.js'
import { searchIndex } from '../../src/search/searchIndex.js'
import { resolveSymbolTarget } from '../../src/lookup/resolveSourceTarget.js'
import { resolveFocusIntake } from '../../src/context/focusResolution.js'
import type { ResolvedIndexManifest } from '../../src/indexing/readIndexManifest.js'

const root = path.resolve('tests/fixtures/v114-language/rust/F10-mixed-language')
const rustRun = 'symbolq:src%2Fworker.rs#rust%3Aimpl%3AWorker%402%3A19#run#0'

describe('B14 independent mixed-language isolation', () => {
  beforeAll(async () => { await prepareRustParser() })

  function build() {
    const index = buildIndex({ repoRoot: root, sourceRoots: ['src'] }).index
    const base = buildCodeGraph({ symbolIndex: index })
    const structure = buildRustStructure(base, root, index.files)
    const { graph } = buildRustRelationships(structure.graph, index.files, structure.packages, structure.modules)
    const resolved = { indexDir: 'test', manifestPath: 'manifest.json', artifactPaths: {}, manifest: { projectRoot: root } } as unknown as ResolvedIndexManifest
    return { index, base, graph, resolved }
  }

  it('preserves five distinct Worker declarations and unrelated physical nodes', () => {
    const { graph, base } = build()
    expect(graph.nodes.filter(n => n.symbolName === 'Worker').map(n => n.id).sort()).toEqual([
      'symbol:src/Worker.java#Worker', 'symbol:src/Worker.kt#Worker',
      'symbol:src/worker.py#Worker', 'symbol:src/worker.rs#Worker', 'symbol:src/worker.ts#Worker',
    ])
    const nonRust = base.nodes.filter(n => n.path && !n.path.endsWith('.rs'))
    for (const node of nonRust) expect(graph.nodes.find(n => n.id === node.id)).toEqual(node)
    expect(new Set(graph.nodes.map(n => n.id)).size).toBe(graph.nodes.length)
    expect(graph.edges.filter(e => e.kind.startsWith('rust-')).every(e => {
      const source = graph.nodes.find(n => n.id === e.source)!
      const target = graph.nodes.find(n => n.id === e.target)!
      return (!source.path || source.path.endsWith('.rs')) && (!target.path || target.path.endsWith('.rs'))
    })).toBe(true)
    expect(graph.edges.filter(e => e.kind === 'calls')).toEqual([])
  })

  it.each([
    ['src/worker.rs run', rustRun, 'src/worker.rs'],
    ['src/worker.ts run', 'symbol:src/worker.ts#run', 'src/worker.ts'],
    ['src/worker.py run', 'symbolq:src%2Fworker.py#python%2Fclass%3AWorker#run#0', 'src/worker.py'],
  ])('keeps exact path-qualified ownership for %s', (query, id, file) => {
    const { index, graph, resolved } = build()
    const result = searchIndex({ symbolIndex: index, codeGraph: graph, resolved, query, intent: 'ownership', limit: 8 })
    expect(result.results[0]?.id).toBe(id)
    const symbol = result.results.find(r => r.id === id)!
    expect(symbol.path).toBe(file)
    expect(resolveSymbolTarget(index, file, 'run', 20, id).filePath).toBe(file)
  })

  it('does not resolve a Rust exact ID into a same-spelled TypeScript/Python source', () => {
    const { index, graph, resolved } = build()
    const results = searchIndex({ symbolIndex: index, codeGraph: graph, resolved, query: rustRun, intent: 'ownership', limit: 8 }).results
    expect(results[0]?.id).toBe(rustRun)
    expect(results[0]?.path).toBe('src/worker.rs')
    expect(() => resolveSymbolTarget(index, 'src/worker.ts', 'run', 20, rustRun)).toThrow()
    expect(() => resolveSymbolTarget(index, '../outside.rs', 'run', 20, rustRun)).toThrow()
    expect(graph.edges.some(e => e.kind.startsWith('rust-') && /worker\.(ts|py)/.test(e.target))).toBe(false)
  })

  it('retains physical qualified IDs in explicit file and symbol focus intake', () => {
    const { index, graph } = build()
    const focus = resolveFocusIntake({ focusFiles: ['src/worker.rs'], focusSymbols: [rustRun, 'symbol:src/missing.rs#run'], symbolIndex: index, codeGraph: graph })
    expect(focus.focusFiles[0].containedSymbolIds).toContain(rustRun)
    expect(focus.focusFiles[0].containedSymbolIds).not.toContain('symbol:src/worker.rs#run')
    expect(focus.focusSymbols[0]).toMatchObject({ symbol: rustRun, resolved: true, matchedNodeIds: [rustRun] })
    expect(focus.unresolvedFocusSymbols).toEqual(['symbol:src/missing.rs#run'])
  })
})
