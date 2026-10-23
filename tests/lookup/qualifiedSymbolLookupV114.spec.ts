import { beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { allocateV114OutputDir } from '../helpers/v114OutputRoot.js'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { loadLookupArtifacts, loadSourceArtifacts, loadViewGraphArtifact, readRequiredJson } from '../../src/indexing/loadIndexArtifacts.js'
import { loadGraphDiffArtifacts } from '../../src/graph-diff/loadGraphDiffArtifacts.js'
import { runGraphDiff } from '../../src/graph-diff/runGraphDiff.js'
import { buildCodeGraph } from '../../src/graph/buildCodeGraph.js'
import { lookupNode } from '../../src/lookup/lookupNode.js'
import { resolveFileNodeTarget, resolveSymbolTarget } from '../../src/lookup/resolveSourceTarget.js'
import { searchIndex } from '../../src/search/searchIndex.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'
import { runCli } from './testCli.js'
import { buildChangedSurface } from '../../src/context/changedSurface.js'

let baseline: string
beforeAll(async () => {
  const root = allocateV114OutputDir('qualified-reader-base-v114'); mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'sample.ts'), 'export function run() {}\n')
  await runIndexCommand({ root, src: ['src'], out: 'index' }); baseline = join(root, 'index')
})

function fixture(symbolVersion: unknown = '3', graphVersion: unknown = '1.1.0', optional: 'present' | 'missing' | 'unreadable' = 'present') {
  const dir = allocateV114OutputDir('qualified-reader-v114')
  const index = JSON.parse(readFileSync(join(baseline, 'symbol-index.json'), 'utf8'))
  const graph = JSON.parse(readFileSync(join(baseline, 'code-graph.json'), 'utf8'))
  index.schemaVersion = symbolVersion; graph.schemaVersion = graphVersion
  if (symbolVersion === 'missing') delete index.schemaVersion
  if (graphVersion === 'missing') delete graph.schemaVersion
  if (symbolVersion === '2') for (const file of index.files) for (const symbol of file.symbols) { delete symbol.nodeId; delete symbol.ownerKey; delete symbol.qualifiedName }
  writeFileSync(join(dir, 'manifest.json'), readFileSync(join(baseline, 'manifest.json')))
  writeFileSync(join(dir, 'code-graph.json'), JSON.stringify(graph))
  if (optional !== 'missing') writeFileSync(join(dir, 'symbol-index.json'), optional === 'unreadable' ? 'INVALID JSON' : JSON.stringify(index))
  return dir
}

describe('v1.14 structural artifact readers and exact lookup', () => {
  it('preserves qualified changed-surface identity and decoded source ownership', () => {
    const id = 'symbolq:src%2Fsample.ts#class%3AB#run#0'
    const surface = buildChangedSurface({ changedFiles: [], changedSymbols: [id], beforeIndex: null, afterIndex: null })
    expect(surface.symbols).toEqual([{ symbolId: id, status: 'unknown', provenance: 'caller', filePath: 'src/sample.ts', name: 'run' }])
  })
  it('compares supported historical/new symbol schemas in context without a false incompatibility', () => {
    const surface = buildChangedSurface({ changedFiles: [], changedSymbols: [], beforeIndex: fixture('2', '1.0.0'), afterIndex: fixture('3', '1.1.0') })
    expect(surface.diffRequested).toBe(true)
    expect(() => buildChangedSurface({ changedFiles: [], changedSymbols: [], beforeIndex: fixture(), afterIndex: fixture('99.0.0') })).toThrow(/Incompatible beforeIndex\/afterIndex symbol-index schema versions/)
  })
  it.each(['2', '3'])('accepts symbol schema %s without requiring new optional metadata', (version) => {
    const dir = fixture(version)
    expect(loadSourceArtifacts({ indexDir: dir, loadSymbolIndex: true }).symbolIndex?.schemaVersion).toBe(version)
    expect(loadGraphDiffArtifacts(dir).symbolIndex?.schemaVersion).toBe(version)
  })
  it.each(['1.0.0', '1.1.0'])('accepts graph schema %s through lookup/source/view/diff', (version) => {
    const dir = fixture('2', version)
    expect(loadLookupArtifacts(dir).codeGraph.schemaVersion).toBe(version)
    expect(loadSourceArtifacts({ indexDir: dir, loadCodeGraph: true }).codeGraph?.schemaVersion).toBe(version)
    expect(loadViewGraphArtifact(dir, 'code').artifact).toMatchObject({ schemaVersion: version })
    expect(loadGraphDiffArtifacts(dir).codeGraph.schemaVersion).toBe(version)
  })
  it.each(['99.0.0', 'missing', null, 3, {}, ''])('rejects unsupported/missing/malformed symbol version %j', (version) => {
    const dir = fixture(version)
    expect(() => readRequiredJson(join(dir, 'symbol-index.json'), 'symbol index')).toThrow(/symbol index.*schema version/i)
    expect(() => loadSourceArtifacts({ indexDir: dir, loadSymbolIndex: true })).toThrow(/symbol index.*schema version/i)
    expect(() => loadGraphDiffArtifacts(dir)).toThrow(/symbol index.*schema version/i)
  })
  it.each(['99.0.0', 'missing', null, 1, {}, ''])('rejects unsupported/missing/malformed graph version %j across shared readers', (version) => {
    const dir = fixture('3', version)
    expect(() => loadLookupArtifacts(dir)).toThrow(/code graph.*schema version/i)
    expect(() => loadSourceArtifacts({ indexDir: dir, loadCodeGraph: true })).toThrow(/code graph.*schema version/i)
    expect(() => loadViewGraphArtifact(dir, 'code')).toThrow(/code graph.*schema version/i)
  })
  it.each(['before', 'after'] as const)('rejects a future symbol schema on the %s graph-diff side', (side) => {
    const valid = fixture(); const future = fixture('99.0.0')
    expect(() => runGraphDiff({ before: side === 'before' ? future : valid, after: side === 'after' ? future : valid })).toThrow(/99\.0\.0/)
  })
  it.each(['before', 'after'] as const)('rejects a future graph schema on the %s graph-diff side', (side) => {
    const valid = fixture(); const future = fixture('3', '99.0.0')
    expect(() => runGraphDiff({ before: side === 'before' ? future : valid, after: side === 'after' ? future : valid })).toThrow(/99\.0\.0/)
  })
  it.each(['missing', 'unreadable'] as const)('keeps genuinely %s optional diff artifacts optional', (state) => {
    const dir = fixture('3', '1.1.0', state)
    expect(loadGraphDiffArtifacts(dir).symbolIndex).toBeNull()
    expect(runGraphDiff({ before: dir, after: fixture() }).symbolIndex.available).toBe(false)
  })
  it('does not hide a parsed null artifact as absent optional evidence', () => {
    const dir = fixture(); writeFileSync(join(dir, 'symbol-index.json'), 'null')
    expect(() => loadGraphDiffArtifacts(dir)).toThrow(/schema version/)
  })
  it('regresses the reproduced CLI defect: future graph and symbol artifacts fail with exit 2', () => {
    const graph = runCli(['lookup', '--index', fixture('3', '99.0.0'), '--node', 'file:src/sample.ts', '--json'])
    expect(graph.status).toBe(2); expect(graph.stderr).toContain('99.0.0')
    const symbols = runCli(['source', '--index', fixture('99.0.0'), '--file', 'src/sample.ts', '--symbol', 'run', '--json'])
    expect(symbols.status).toBe(2); expect(symbols.stderr).toContain('99.0.0')
  })
  it('resolves exact qualified IDs and returns multiple same-name search hits', () => {
    const dir = fixture(); const loaded = loadSourceArtifacts({ indexDir: dir, loadSymbolIndex: true })
    const index = loaded.symbolIndex!
    index.files[0].symbols = [
      { name: 'run', kind: 'function', exported: false, location: { file: 'src/sample.ts', line: 1 }, nodeId: 'symbolq:src%2Fsample.ts#class%3AA#run#0', ownerKey: 'class:A', qualifiedName: 'A.run' },
      { name: 'run', kind: 'function', exported: false, location: { file: 'src/sample.ts', line: 2 }, nodeId: 'symbolq:src%2Fsample.ts#class%3AB#run#0', ownerKey: 'class:B', qualifiedName: 'B.run' },
    ]
    index.files[0].lineCount = 5
    const graph = buildCodeGraph({ symbolIndex: index })
    const nodeId = 'symbolq:src%2Fsample.ts#class%3AB#run#0'
    const result = lookupNode({ graph, nodeId, indexDir: dir, depth: 1, manifestPath: '', codeGraphPath: '' })
    expect(result.node).toMatchObject({ id: nodeId, line: 2, ownerKey: 'class:B', qualifiedName: 'B.run' })
    expect(resolveFileNodeTarget(graph, nodeId, 10).nodeId).toBe(nodeId)
    expect(resolveSymbolTarget(index, 'src/sample.ts', 'run', 10, nodeId).startLine).toBe(2)
    const search = searchIndex({ symbolIndex: index, codeGraph: graph, resolved: loaded.resolved, query: 'run', limit: 20 })
    expect(search.results.filter((r) => r.kind === 'symbol').map((r) => r.id)).toEqual(expect.arrayContaining(index.files[0].symbols.map((s) => s.nodeId)))
    expect(searchIndex({ symbolIndex: index, codeGraph: graph, resolved: loaded.resolved, query: 'B.run' }).results.some((r) => r.id === nodeId)).toBe(true)
    expect(() => resolveFileNodeTarget(graph, 'symbolq:broken', 10)).toThrow(/Malformed/)
    expect(() => resolveFileNodeTarget(graph, 'symbolq:src%2Fsample.ts#class%3AC#run#0', 10)).toThrow(/not found/i)
    const old = { ...index, schemaVersion: '2', files: [{ ...index.files[0], symbols: index.files[0].symbols.map(({ nodeId: _id, ...s }) => s) }] } as SymbolIndex
    expect(() => resolveSymbolTarget(old, 'src/sample.ts', 'run', 10, 'symbol:src/sample.ts#run')).toThrow(/AMBIGUOUS_SYMBOL/)
  })
})
