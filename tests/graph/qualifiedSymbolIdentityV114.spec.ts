import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assignDeclarationIdentities, parseDeclarationNodeId, qualifiedDeclarationId } from '../../src/symbol-index/declarationIdentity.js'
import { buildIndex } from '../../src/symbol-index/builder.js'
import type { SymbolDefinition, SymbolIndex } from '../../src/symbol-index/types.js'
import { buildCodeGraph } from '../../src/graph/buildCodeGraph.js'
import { buildSymbolIndexDiff } from '../../src/graph-diff/buildSymbolIndexDiff.js'
import { buildCodeGraphDiff } from '../../src/graph-diff/buildCodeGraphDiff.js'
import { buildPartialSymbolIndex } from '../../src/indexing/partialRebuild.js'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { selectAffectedNeighborhood } from '../../src/indexing/affectedNeighborhood.js'
import { buildCacheMetadata } from '../../src/indexing/cacheMetadata.js'
import type { IndexManifest } from '../../src/indexing/manifestTypes.js'
import { TypeScriptAdapter } from '../../src/languages/typescript/adapter.js'

function declaration(line: number, ownerKey?: string, name = 'run'): SymbolDefinition {
  return { name, kind: 'function', location: { file: 'src/sample.ts', line, endLine: line + 1 }, exported: false, ...(ownerKey ? { ownerKey, qualifiedName: `${ownerKey}::${name}` } : {}) }
}
function index(symbols: SymbolDefinition[]): SymbolIndex {
  return { schemaVersion: '3', repoRoot: '.', buildTime: '', sourceRoots: ['src'], fileCount: 1, symbolCount: symbols.length, files: [{ path: 'src/sample.ts', language: 'typescript', lineCount: 100, imports: [], exports: [], symbols, hasCallGraphEntries: false }] }
}

describe('v1.14 qualified declaration identity', () => {
  it('uses independent literal identities for Rust-like traits/impls and Python-like class methods', () => {
    const symbols = assignDeclarationIdentities('src/sample.ts', [
      declaration(1, 'rust/mod:alpha/trait:Runner'), declaration(5, 'rust/mod:alpha/impl:inherent:Client:0'),
      declaration(9, 'rust/mod:beta/impl:inherent:Client:0'), declaration(13, 'python/class:Worker'), declaration(17, 'python/class:Other'),
    ])
    expect(symbols.map((s) => s.nodeId)).toEqual([
      'symbolq:src%2Fsample.ts#rust%2Fmod%3Aalpha%2Ftrait%3ARunner#run#0',
      'symbolq:src%2Fsample.ts#rust%2Fmod%3Aalpha%2Fimpl%3Ainherent%3AClient%3A0#run#0',
      'symbolq:src%2Fsample.ts#rust%2Fmod%3Abeta%2Fimpl%3Ainherent%3AClient%3A0#run#0',
      'symbolq:src%2Fsample.ts#python%2Fclass%3AWorker#run#0',
      'symbolq:src%2Fsample.ts#python%2Fclass%3AOther#run#0',
    ])
    const graph = buildCodeGraph({ symbolIndex: index(symbols) })
    expect(new Set(graph.nodes.map((n) => n.id)).size).toBe(6)
    expect(graph.edges.every((e) => graph.nodes.some((n) => n.id === e.source) && graph.nodes.some((n) => n.id === e.target))).toBe(true)
  })

  it('keeps first source-order top-level identity and ordinal source locations independently', () => {
    const symbols = assignDeclarationIdentities('src/sample.ts', [declaration(20), declaration(2), declaration(9)])
    expect(symbols.map((s) => [s.location.line, s.nodeId])).toEqual([
      [20, 'symbolq:src%2Fsample.ts##run#2'], [2, 'symbol:src/sample.ts#run'], [9, 'symbolq:src%2Fsample.ts##run#1'],
    ])
    expect(assignDeclarationIdentities('src/sample.ts', symbols)).toEqual(symbols)
  })

  it('encodes separators, percent signs and Unicode without treating display name as identity', () => {
    const id = qualifiedDeclarationId('src\\a#%.ts', 'class:A/B#%', 'r#%é', 0)
    expect(id).toBe('symbolq:src%2Fa%23%25.ts#class%3AA%2FB%23%25#r%23%25%C3%A9#0')
    expect(parseDeclarationNodeId(id)).toEqual({ filePath: 'src/a#%.ts', ownerKey: 'class:A/B#%', symbolName: 'r#%é', ordinal: 0 })
    const symbol = assignDeclarationIdentities('src/sample.ts', [{ ...declaration(1, 'class:A'), qualifiedName: 'DISPLAY' }])[0]
    expect(symbol.nodeId).not.toContain('DISPLAY')
    for (const path of ['/absolute.ts', 'C:\\host.ts', '../escape.ts']) expect(() => qualifiedDeclarationId(path, '', 'x', 0)).toThrow()
    for (const malformed of ['symbolq:x#y#z#-1', 'symbolq:x#y#z#01', 'symbolq:%ZZ#y#z#0', 'symbolq:x#y#z#0#1']) expect(() => parseDeclarationNodeId(malformed)).toThrow()
  })

  it('preserves real existing TS, JS, Python, Kotlin and Java top-level IDs', () => {
    const root = mkdtempSync(join(tmpdir(), 'mdk-qualified-languages-'))
    mkdirSync(join(root, 'src'))
    const fixtures = { 'a.ts': 'export function run() {}', 'b.js': 'export function run() {}', 'c.py': 'def run():\n    pass\n', 'd.kt': 'fun run() {}', 'Plain.java': 'public class Plain {}' }
    for (const [file, text] of Object.entries(fixtures)) writeFileSync(join(root, 'src', file), text)
    const result = buildIndex({ repoRoot: root, sourceRoots: ['src'] })
    const ids = result.index.files.flatMap((f) => f.symbols.map((s) => s.nodeId))
    expect(ids).toEqual(expect.arrayContaining(['symbol:src/a.ts#run', 'symbol:src/b.js#run', 'symbol:src/c.py#run', 'symbol:src/d.kt#run', 'symbol:src/Plain.java#Plain']))
    expect(result.index.schemaVersion).toBe('3')
    expect(result.index.graph?.symbols.every((s) => s.nodeId)).toBe(true)
  })

  it('is independent of physical file enumeration order and rejects duplicate/orphan graphs', () => {
    const one = index(assignDeclarationIdentities('src/sample.ts', [declaration(1), declaration(5)]))
    const two = { ...one.files[0], path: 'src/other.ts', symbols: assignDeclarationIdentities('src/other.ts', [declaration(1, 'class:A')]) }
    const first = buildCodeGraph({ symbolIndex: { ...one, files: [...one.files, two] } })
    const second = buildCodeGraph({ symbolIndex: { ...one, files: [two, ...one.files] } })
    expect(first.nodes).toEqual(second.nodes)
    expect(first.edges).toEqual(second.edges)
    expect(first.schemaVersion).toBe('1.1.0')
    expect(() => buildCodeGraph({ symbolIndex: index([{ ...declaration(1), nodeId: 'duplicate' }, { ...declaration(5), nodeId: 'duplicate' }]) })).toThrow(/Duplicate code graph node/)
    expect(() => buildCodeGraph({ symbolIndex: { ...one, graph: { symbols: [], fileDeps: [{ from: 'src/sample.ts', to: 'missing.ts', kind: 'import' }] } } })).toThrow(/endpoint/)
  })

  it('diffs additions/removals by exact identity without mutating another same-name declaration', () => {
    const a = assignDeclarationIdentities('src/sample.ts', [declaration(1, 'class:A')])[0]
    const b = assignDeclarationIdentities('src/sample.ts', [declaration(10, 'class:B')])[0]
    const before = index([a]); const after = index([a, b])
    expect(buildSymbolIndexDiff(before, after)).toMatchObject({ symbolsAdded: [b.nodeId], symbolsRemoved: [], symbolsChanged: [] })
    expect(buildSymbolIndexDiff(after, before)).toMatchObject({ symbolsAdded: [], symbolsRemoved: [b.nodeId], symbolsChanged: [] })
    const diff = buildCodeGraphDiff(buildCodeGraph({ symbolIndex: before }), buildCodeGraph({ symbolIndex: after }))
    expect(diff.nodes.added.map((n) => n.id)).toEqual([b.nodeId])
    expect(diff.nodes.changed).toEqual([])
  })

  it('retains all identity metadata through partial reuse and exact neighborhood traversal', () => {
    const symbols = assignDeclarationIdentities('src/sample.ts', [declaration(1, 'class:A'), declaration(5, 'class:B')])
    const previous = index(symbols)
    const partial = buildPartialSymbolIndex({ repoRoot: '.', sourceRoots: ['src'], buildCallGraph: false, discoveryFiles: [{ relPath: 'src/sample.ts', absPath: 'not-read.ts', sizeBytes: 0 }], unchangedPaths: new Set(['src/sample.ts']), previousFileSummariesByPath: new Map([['src/sample.ts', previous.files[0]]]), previousCacheEntriesByPath: new Map() })
    expect(partial.index.files[0].symbols).toEqual(symbols)
    expect(partial.index.graph?.symbols.map((s) => s.nodeId)).toEqual(symbols.map((s) => s.nodeId))
    const graph = buildCodeGraph({ symbolIndex: previous })
    const selection = selectAffectedNeighborhood({ baseline: { status: 'trusted', baseline: { symbolIndex: previous, codeGraph: graph, cache: buildCacheMetadata({ projectRoot: '.', sourceRoots: ['src'], configFingerprint: '', files: [], baselineArtifacts: { manifestSha256: '0'.repeat(64), symbolIndexSha256: '0'.repeat(64), codeGraphSha256: '0'.repeat(64) } }), manifest: {} as IndexManifest } }, classification: { changed: ['src/sample.ts'], added: [], removed: [], unchanged: [] }, currentPaths: ['src/sample.ts'], sourceRoots: ['src'] })
    expect(selection.status).toBe('selected')
    if (selection.status === 'selected') {
      expect(selection.seedSymbolCount).toBe(2)
      expect(selection.affectedNodeIds).toEqual(expect.arrayContaining(symbols.map((s) => s.nodeId)))
    }
  })

  it('fully rebuilds cache 1.2.0 truthfully and keeps full/incremental duplicate graphs equivalent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mdk-qualified-incremental-')); mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'sample.ts'), 'export function run() {}\nexport function run() {}\n')
    const options = { root, src: ['src'], out: 'index', incremental: true }
    const first = await runIndexCommand(options)
    expect(first.mode).toBe('index')
    const cachePath = join(root, 'index', 'cache-metadata.json')
    const cache = JSON.parse(readFileSync(cachePath, 'utf8')); cache.cacheSchemaVersion = '1.2.0'; writeFileSync(cachePath, JSON.stringify(cache))
    const fallback = await runIndexCommand(options)
    if (fallback.mode !== 'index') throw new Error('Expected index')
    expect(fallback.cache.mode).toBe('incremental-full-cache-incompatible')
    expect(fallback.cache.invalidationReason).toContain('1.2.0')
    writeFileSync(join(root, 'src', 'other.ts'), 'export const other = 1\n')
    const partial = await runIndexCommand(options)
    if (partial.mode !== 'index') throw new Error('Expected index')
    expect(partial.cache.mode).toContain('incremental-partial')
    await runIndexCommand({ ...options, out: 'full', incremental: false })
    const graph = JSON.parse(readFileSync(join(root, 'index', 'code-graph.json'), 'utf8'))
    const full = JSON.parse(readFileSync(join(root, 'full', 'code-graph.json'), 'utf8'))
    expect(graph.nodes).toEqual(full.nodes); expect(graph.edges).toEqual(full.edges)
    expect(new Set(graph.nodes.map((n: { id: string }) => n.id)).size).toBe(graph.nodes.length)
  })
  it('does not publish conflicting artifacts or replace an authoritative manifest on graph failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mdk-qualified-publication-')); mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'sample.ts'), 'function first() {}\nfunction second() {}\n')
    const options = { root, src: ['src'], out: 'index' }
    await runIndexCommand(options)
    const names = ['manifest.json', 'symbol-index.json', 'code-graph.json']
    const before = names.map((name) => readFileSync(join(root, 'index', name), 'utf8'))
    const mock = vi.spyOn(TypeScriptAdapter.prototype, 'extractFromSource').mockImplementation(() => ({
      language: 'typescript', lineCount: 2, imports: [], exports: [], reExportSpecifiers: [], exportAllSpecifiers: [],
      symbols: [{ ...declaration(1), nodeId: 'duplicate' }, { ...declaration(2), nodeId: 'duplicate' }],
    }))
    try { await expect(runIndexCommand(options)).rejects.toThrow(/Duplicate code graph node ID/) } finally { mock.mockRestore() }
    expect(names.map((name) => readFileSync(join(root, 'index', name), 'utf8'))).toEqual(before)
  })
})
