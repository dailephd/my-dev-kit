import { beforeAll, describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { prepareRustParser } from '../../src/languages/rust/parser.js'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { buildCodeGraph } from '../../src/graph/buildCodeGraph.js'
import { buildRustStructure } from '../../src/graph/buildRustStructure.js'
import { buildRustRelationships } from '../../src/graph/buildRustRelationships.js'
import { searchIndex } from '../../src/search/searchIndex.js'
import { lookupNode } from '../../src/lookup/lookupNode.js'
import { resolveFileNodeTarget, resolveSymbolTarget } from '../../src/lookup/resolveSourceTarget.js'
import { getSourceSlice } from '../../src/lookup/getSourceSlice.js'
import { sliceGraph } from '../../src/graph/sliceGraph.js'
import { selectSourceSlices } from '../../src/context/sourceSelection.js'
import { discoverTestInfrastructure } from '../../src/context/testInfrastructureDiscovery.js'
import { selectGraphNeighborhood } from '../../src/context/graphSelection.js'
import type { ResolvedIndexManifest } from '../../src/indexing/readIndexManifest.js'
import { allocateV114OutputDir } from '../helpers/v114OutputRoot.js'

const root = path.resolve('tests/fixtures/v114-language/rust/F13-retrieval')
const inherent = 'symbolq:src%2Fimpls.rs#rust%3Aimpl%3Acrate%3A%3Aalpha%3A%3AWorker%401%3A0#run#0'
// Line 4 starts after 27 + 35 + 2 UTF-16 units in the independently authored fixture.
const implementation = 'symbolq:src%2Fimpls.rs#rust%3Aimpl%3Acrate%3A%3Aalpha%3A%3AWorker%3Atrait%3Acrate%3A%3Aalpha%3A%3ARunner%404%3A64#run#0'
const impl = 'rust-impl:src%2Fimpls.rs#rust%3Aimpl%3Acrate%3A%3Aalpha%3A%3AWorker%3Atrait%3Acrate%3A%3Aalpha%3A%3ARunner%404%3A64#0'
const target = 'rust-target:Cargo.toml#lib#retrieval#src%2Flib.rs'
const moduleId = `rust-module:${encodeURIComponent(target)}#crate%3A%3Aalpha`

function build(projectRoot: string, sourceRoots = ['src', 'tests']) {
  const index = buildIndex({ repoRoot: projectRoot, sourceRoots }).index
  const structure = buildRustStructure(buildCodeGraph({ symbolIndex: index }), projectRoot, index.files)
  const { graph } = buildRustRelationships(structure.graph, index.files, structure.packages, structure.modules)
  const resolved = { indexDir: 'test', manifestPath: 'manifest.json', artifactPaths: { symbolIndex: 'symbol-index.json', codeGraph: 'code-graph.json' }, manifest: { projectRoot } } as unknown as ResolvedIndexManifest
  return { index, graph, resolved }
}

function synthetic(source: string, extra: Record<string, string> = {}) {
  const temp = allocateV114OutputDir('rust-retrieval-v114')
  fs.mkdirSync(temp, { recursive: true })
  const project = fs.mkdtempSync(path.join(temp, 'synthetic-'))
  for (const [file, text] of Object.entries({ 'Cargo.toml': '[package]\nname="synthetic"\nversion="0.1.0"\nedition="2021"\n', 'src/lib.rs': source, ...extra })) {
    fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true })
    fs.writeFileSync(path.join(project, file), text)
  }
  return { root: project, ...build(project, ['src']) }
}

describe('B11 independent Rust retrieval oracles', () => {
  beforeAll(async () => { await prepareRustParser() })

  it('retains physical identity and the exact Runner implementation ahead of same-name alternatives', () => {
    const { index, graph, resolved } = build(root)
    expect(graph.nodes.find(n => n.id === implementation)).toMatchObject({ path: 'src/impls.rs', line: 5 })
    const result = searchIndex({ symbolIndex: index, codeGraph: graph, resolved, query: 'impl crate::alpha::Runner for crate::alpha::Worker run', intent: 'ownership', limit: 8 })
    expect(result.results.filter(r => r.kind === 'symbol')[0]?.id).toBe(implementation)
    expect(result.results.find(r => r.id === implementation)).toMatchObject({ qualifiedName: expect.any(String), ownerKey: expect.any(String), line: 5 })
    expect(graph.nodes.find(n => n.id === inherent)).toBeDefined()
  })

  it('keeps unqualified alternatives and reports no unique ownership verdict', () => {
    const { index, graph, resolved } = build(root)
    const result = searchIndex({ symbolIndex: index, codeGraph: graph, resolved, query: 'run', intent: 'ownership', limit: 40 })
    expect(result.results.map(r => r.id)).toEqual(expect.arrayContaining([inherent, implementation]))
    expect(() => resolveSymbolTarget(index, 'src/impls.rs', 'run', 20)).toThrow('AMBIGUOUS_SYMBOL')
  })

  it.each([implementation, impl, moduleId, target, 'rust-package:Cargo.toml'])('looks up exact persisted %s', nodeId => {
    const { graph } = build(root)
    const result = lookupNode({ graph, nodeId, depth: 1, indexDir: 'test', manifestPath: 'manifest.json', codeGraphPath: 'code-graph.json' })
    expect(result.node.id).toBe(nodeId)
  })
  it.each([implementation, impl, moduleId, target, 'rust-package:Cargo.toml'])('honors the exact persisted search identity %s', query => {
    const { index, graph, resolved } = build(root)
    const result = searchIndex({ symbolIndex: index, codeGraph: graph, resolved, query, intent: 'ownership', limit: 5 })
    expect(result.results[0]?.id).toBe(query)
  })

  it.each([1, 2])('preserves real directed relationships and endpoints at depth %i', depth => {
    const { graph } = build(root)
    const slice = sliceGraph({ graph, focusNodeId: impl, depth, direction: 'both' })
    expect(slice.edges.map(e => e.id)).toContain(`${impl}--rust-impl-defines-symbol-->${implementation}`)
    expect(slice.edges.map(e => e.kind)).toEqual(expect.arrayContaining(['rust-impl-for-type', 'rust-impl-of-trait']))
    expect(slice.edges.every(e => slice.nodes.some(n => n.id === e.source) && slice.nodes.some(n => n.id === e.target))).toBe(true)
  })

  it('returns exact method windows and no cursor beyond its trusted end', () => {
    const { index } = build(root)
    const t = resolveSymbolTarget(index, 'src/impls.rs', 'run', 2, implementation)
    expect(t).toMatchObject({ startLine: 5, endLine: 6, symbolEndLine: 7 })
    const first = getSourceSlice({ ...t, indexDir: 'test', projectRoot: root, startLine: t.startLine!, endLine: t.endLine!, maxLines: 2 })
    expect(first.content).toBe('    fn run(&self) -> u8 {\n        2')
    expect(first.continuationCursor).toMatchObject({ nextStartLine: 7, symbolBoundaryKnown: true })
    const last = getSourceSlice({ ...t, indexDir: 'test', projectRoot: root, startLine: 7, endLine: 8, maxLines: 2 })
    expect(last.content).toBe('    }')
    expect(last.continuationCursor).toBeUndefined()
  })

  it('uses the trusted physical impl end in the existing cursor engine', () => {
    const { graph } = build(root)
    const t = resolveFileNodeTarget(graph, impl, 2)
    expect(t).toMatchObject({ filePath: 'src/impls.rs', startLine: 4, endLine: 5, symbolEndLine: 8 })
    const s = getSourceSlice({ ...t, projectRoot: root, indexDir: 'test', startLine: t.startLine!, endLine: t.endLine!, maxLines: 2 })
    expect(s.continuationCursor).toMatchObject({ nextStartLine: 6, symbolBoundaryKnown: true })
  })

  it('keeps exact same-named method identity during context source selection', () => {
    const { index, graph, resolved } = build(root)
    const selected = selectSourceSlices({ codeGraph: graph, symbolIndex: index, resolved, targets: [{ nodeId: implementation, priority: 0, reason: 'exact focus' }], maxSourceSlices: 2 })
    expect(selected.skipped).toEqual([])
    expect(selected.slices).toEqual([expect.objectContaining({ filePath: 'src/impls.rs', startLine: 5, endLine: 7 })])
  })

  it('discovers source-grounded lexical Rust tests without claiming method coverage', () => {
    const { index } = build(root)
    const result = discoverTestInfrastructure({ role: 'test-implementation', symbolIndex: index, repoRoot: root, filesOfInterest: ['src/alpha.rs'], symbolsOfInterest: ['symbol:src/alpha.rs#work'], requestedEvidenceKinds: [] })
    expect(result.relatedTests.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'src/alpha.rs', relationship: 'rust-lexical-test-context' })]))
    expect(result.relatedTests.items.filter(i => i.path === 'tests/owner_tests.rs').every(i => !i.basis.includes(implementation))).toBe(true)
  })

  it('never invents source for missing identities or macro-generated declarations', () => {
    const { graph } = build(root)
    expect(() => resolveFileNodeTarget(graph, 'symbol:src/missing.rs#run', 20)).toThrow('Node not found')
    expect(graph.edges.some(e => e.metadata?.importedPath === 'crate::missing::Absent')).toBe(false)
    expect(graph.nodes.some(n => n.id.includes('std::') || n.id.includes('ffi'))).toBe(false)
  })

  it.each(['crate::alpha::work', 'crate::alpha::Runner', 'crate::alpha::Worker::run', 'crate::beta::work', 'impl crate::alpha::Runner for crate::alpha::Worker'])('retrieves observed qualified vocabulary %s', query => {
    const { index, graph, resolved } = build(root)
    const result = searchIndex({ symbolIndex: index, codeGraph: graph, resolved, query, limit: 20 })
    expect(result.results.length).toBeGreaterThan(0)
    expect(result.results.every(item => !item.nodeId || graph.nodes.some(node => node.id === item.nodeId))).toBe(true)
  })
  it.each([['crate::alpha::work', 'symbol:src/alpha.rs#work'], ['crate::beta::work', 'symbol:src/beta.rs#work'], ['crate::alpha::Runner', 'symbol:src/alpha.rs#Runner']])('retains uniquely grounded qualified display identity for %s', (query, expected) => {
    const { index, graph, resolved } = build(root)
    const result = searchIndex({ symbolIndex: index, codeGraph: graph, resolved, query, intent: 'ownership', limit: 5 })
    expect(result.results[0]).toMatchObject({ id: expected, qualifiedName: query })
  })

  it('rejects duplicate physical node identities instead of first-match lookup', () => {
    const { graph, index, resolved } = build(root)
    graph.nodes.push({ ...graph.nodes.find(node => node.id === implementation)!, path: 'src/beta.rs' })
    expect(() => lookupNode({ graph, nodeId: implementation, depth: 1, indexDir: 'test', manifestPath: '', codeGraphPath: '' })).toThrow(/Ambiguous/)
    expect(() => lookupNode({ graph, nodeId: impl, depth: 1, indexDir: 'test', manifestPath: '', codeGraphPath: '' })).toThrow(/Ambiguous/)
    expect(() => sliceGraph({ graph, focusNodeId: implementation, depth: 1, direction: 'both' })).toThrow(/Ambiguous/)
    expect(() => searchIndex({ codeGraph: graph, symbolIndex: index, resolved, query: implementation })).toThrow(/Ambiguous/)
  })

  it('rejects dangling selected graph references', () => {
    const { graph } = build(root)
    graph.nodes = graph.nodes.filter(node => node.id !== 'symbol:src/alpha.rs#Runner')
    expect(() => sliceGraph({ graph, focusNodeId: impl, depth: 1, direction: 'both' })).toThrow(/endpoint|reference/)
    expect(() => selectGraphNeighborhood({ codeGraph: graph, focus: { focusNodeId: implementation } as never, maxGraphNodes: 30, maxGraphEdges: 50 })).toThrow(/endpoint|reference/)
  })

  it.each([1, 2, 3])('keeps context graph caps and counts omitted endpoint edges at cap %i', cap => {
    const { graph } = build(root)
    const selected = selectGraphNeighborhood({ codeGraph: graph, focus: { focusNodeId: implementation } as never, maxGraphNodes: cap, maxGraphEdges: 1 })
    expect(selected.nodes).toHaveLength(cap)
    expect(selected.nodes.map(node => node.nodeId)).toContain(implementation)
    expect(selected.edges.length).toBeLessThanOrEqual(1)
    expect(selected.edges.every(edge => selected.nodes.some(node => node.nodeId === edge.from) && selected.nodes.some(node => node.nodeId === edge.to))).toBe(true)
    expect(selected.omittedEdgeCount).toBeGreaterThan(0)
  })
  it.each(['rust-package:Cargo.toml', target])('retains selected Cargo hierarchy for %s without adding other package owners', focusNodeId => {
    const { graph } = build(root)
    const result = selectGraphNeighborhood({ codeGraph: graph, focus: { focusNodeId } as never, maxGraphNodes: 50, maxGraphEdges: 100 })
    expect(result.nodes.map(node => node.nodeId)).toContain(moduleId)
    expect(result.nodes.filter(node => node.kind === 'rust-package').every(node => node.nodeId === 'rust-package:Cargo.toml')).toBe(true)
  })
  it('retains existing module/file and target context for a physical impl method', () => {
    const { index, graph, resolved } = build(root)
    const implModule = `rust-module:${encodeURIComponent(target)}#crate%3A%3Aimpls`
    const selected = selectGraphNeighborhood({ codeGraph: graph, focus: { focusNodeId: implementation } as never, maxGraphNodes: 30, maxGraphEdges: 50 })
    expect(selected.nodes.map(node => node.nodeId)).toContain(implModule)
    const result = searchIndex({ symbolIndex: index, codeGraph: graph, resolved, query: implementation, limit: 5 })
    expect(result.results[0].rustContext?.ownerNodeIds).toContain(implModule)
  })

  it('returns Cargo manifest evidence without fabricating a Rust declaration span', () => {
    const { graph } = build(root)
    expect(resolveFileNodeTarget(graph, 'rust-package:Cargo.toml', 3)).toMatchObject({ filePath: 'Cargo.toml', startLine: 1, endLine: 3 })
    expect(resolveFileNodeTarget(graph, target, 3).symbolEndLine).toBeUndefined()
  })

  it('selects the grounded external module file without inventing its body boundary', () => {
    const { graph } = build(root)
    const result = resolveFileNodeTarget(graph, moduleId, 3)
    expect(result).toMatchObject({ filePath: 'src/alpha.rs', startLine: 1, endLine: 3 })
    expect(result.symbolEndLine).toBeUndefined()
  })

  it('distinguishes exact symbol imports from file-only lexical test evidence', () => {
    const { index, graph } = build(root)
    const refs = discoverTestInfrastructure({ codeGraph: graph, role: 'test-implementation', symbolIndex: index, repoRoot: root, filesOfInterest: ['src/alpha.rs'], symbolsOfInterest: ['symbol:src/alpha.rs#Worker'], requestedEvidenceKinds: [] }).relatedTests.items
    expect(refs).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'tests/owner_tests.rs', basis: 'symbol:src/alpha.rs#Worker', provenance: 'indexed-rust-module-use' })]))
    expect(refs.filter(item => item.provenance === 'indexed-rust-module-use').every(item => item.basis !== implementation)).toBe(true)
    expect(refs.find(item => item.path === 'src/alpha.rs')?.metadata?.association).toBe('file-only')
  })

  it.each(['\n', '\r\n'])('keeps Unicode, nested bodies and bounded continuation under %j line endings', newline => {
    const { root: project, index } = synthetic(['pub fn work() {', '    let text = "λ🦀";', '    if true { let _ = text; }', '}', 'pub fn next() {}'].join(newline))
    const t = resolveSymbolTarget(index, 'src/lib.rs', 'work', 2, 'symbol:src/lib.rs#work')
    expect(t).toMatchObject({ startLine: 1, endLine: 2, symbolEndLine: 4 })
    const s = getSourceSlice({ ...t, projectRoot: project, indexDir: 'test', startLine: 3, endLine: 5, maxLines: 3 })
    expect(s.content).toBe('    if true { let _ = text; }\n}')
    expect(s.continuationCursor).toBeUndefined()
    expect(s.content).not.toContain('next')
  })

  it('keeps parser recovery boundaries unknown without guessing the next declaration', () => {
    const { index } = synthetic('pub fn broken() { let value = ;\n}\npub fn next() {}\n')
    const t = resolveSymbolTarget(index, 'src/lib.rs', 'broken', 2)
    expect(t.symbolEndLine).toBeUndefined()
    expect(t.warnings.length).toBeGreaterThan(0)
  })

  it.each([
    ['unresolved', 'use crate::missing::Work;'],
    ['external', 'use std::collections::HashMap;'],
    ['macro', 'macro_rules! make { () => { pub fn generated() {} } } make!();'],
    ['conditional', '#[cfg(feature="optional")] pub mod hidden { pub struct Work; } use crate::hidden::Work;'],
    ['glob', 'pub mod a { pub struct Work; } use crate::a::*; impl Work {}'],
    ['private', 'mod a { struct Work; } mod b { pub use crate::a::Work; }'],
  ])('never promotes %s syntax into unsupported retrieval relationships', (kind, source) => {
    const { graph } = synthetic(source)
    expect(graph.edges.filter(edge => edge.kind === 'rust-impl-for-type' || edge.kind === 'rust-module-reexports-symbol')).toEqual([])
    if (kind !== 'glob') expect(graph.edges.filter(edge => edge.kind === 'rust-module-uses-module')).toEqual([])
    expect(graph.nodes.some(node => node.symbolName === 'generated')).toBe(false)
  })

  it('does not associate an unrelated same-crate or filename-similar test', () => {
    const { root: project, index, graph } = synthetic('pub fn work() {}', { 'src/work_tests.rs': '#[test]\nfn work_is_correct() {}\n' })
    const result = discoverTestInfrastructure({ codeGraph: graph, role: 'test-implementation', symbolIndex: index, repoRoot: project, filesOfInterest: ['src/lib.rs'], symbolsOfInterest: ['symbol:src/lib.rs#work'], requestedEvidenceKinds: [] })
    expect(result.relatedTests.items).toEqual([])
  })

  it('keeps five language owners distinct without fabricated FFI relationships', () => {
    const { graph, index, resolved } = build(path.resolve('tests/fixtures/v114-language/rust/F10-mixed-language'), ['src'])
    const workers = graph.nodes.filter(n => n.kind === 'symbol' && n.symbolName === 'Worker')
    expect(new Set(workers.map(n => n.id)).size).toBe(5)
    expect(graph.nodes.filter(node => node.symbolName === 'run').map(node => node.id)).toEqual(expect.arrayContaining([
      'symbol:src/worker.ts#run', 'symbolq:src%2Fworker.py#python%2Fclass%3AWorker#run#0',
      'symbolq:src%2Fworker.rs#rust%3Aimpl%3AWorker%402%3A19#run#0',
    ]))
    const result = searchIndex({ symbolIndex: index, codeGraph: graph, resolved, query: 'src/worker.py run', intent: 'ownership', limit: 10 })
    expect(result.results.filter(r => r.kind === 'symbol')[0]?.path).toBe('src/worker.py')
    expect(searchIndex({ symbolIndex: index, codeGraph: graph, resolved, query: 'src/worker.ts run', intent: 'ownership', limit: 10 }).results.filter(item => item.kind === 'symbol')[0]?.id).toBe('symbol:src/worker.ts#run')
    expect(graph.edges.filter(e => e.kind === 'calls')).toEqual([])
  })
})

describe('B11 current CLI integration', () => {
  let output: string
  const cli = (...args: string[]) => JSON.parse(execFileSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('src/cli.ts'), ...args], { encoding: 'utf8', windowsHide: true }))
  beforeAll(async () => {
    await prepareRustParser()
    const temp = allocateV114OutputDir('rust-retrieval-v114')
    fs.mkdirSync(temp, { recursive: true })
    output = fs.mkdtempSync(path.join(temp, 'retrieval-'))
    cli('index', '--root', root, '--src', 'src', '--src', 'tests', '--out', path.join(output, 'index'), '--json')
  })
  it('continues a physical impl from its first window and never its file beginning', () => {
    const result = cli('source', '--index', path.join(output, 'index'), '--node', impl, '--max-lines', '2', '--continue', '--format', 'json')
    expect(result).toMatchObject({ startLine: 6, endLine: 7, content: '        2\n    }' })
    expect(result.continuationCursor).toMatchObject({ nextStartLine: 8, symbolBoundaryKnown: true })
  })
  it('keeps exact method and impl ranges in source bundles', () => {
    for (const [id, startLine, endLine] of [[implementation, 5, 7], [impl, 4, 8]] as const) {
      const result = cli('source', '--index', path.join(output, 'index'), '--node', id, '--include-local-types', '--max-lines', '20', '--format', 'json')
      expect(result.primaryBlock).toMatchObject({ startLine, endLine })
      expect(result.continuationCursors).toEqual([])
    }
  })
  it('continues unknown structural source from the actual bounded preview end', () => {
    const project = synthetic('pub fn work() {}\n' + Array.from({ length: 50 }, (_, i) => `// evidence ${i}`).join('\n'))
    const unknownIndex = path.join(output, 'unknown-index')
    cli('index', '--root', project.root, '--src', 'src', '--out', unknownIndex, '--json')
    const id = 'rust-target:Cargo.toml#lib#synthetic#src%2Flib.rs'
    const first = cli('source', '--index', unknownIndex, '--node', id, '--max-lines', '40', '--format', 'json')
    const continued = cli('source', '--index', unknownIndex, '--node', id, '--max-lines', '40', '--continue', '--format', 'json')
    expect(first.endLine).toBe(12)
    expect(first.continuationCursor.symbolBoundaryKnown).toBe(false)
    expect(continued.startLine).toBe(first.continuationCursor.nextStartLine)
    expect(continued.startLine).toBe(13)
  })
  it('walks later same-name method windows with the persisted identity and existing file-symbol controls', () => {
    const window = cli('source', '--index', path.join(output, 'index'), '--file', 'src/impls.rs', '--symbol', implementation, '--continue-from', '6', '--max-lines', '1', '--format', 'json')
    expect(window.continuationCursor).toMatchObject({ targetId: implementation, nextStartLine: 7, symbolBoundaryKnown: true })
    const result = cli('source', '--index', path.join(output, 'index'), '--file', 'src/impls.rs', '--symbol', implementation, '--continue-from', '7', '--max-lines', '1', '--format', 'json')
    expect(result).toMatchObject({ startLine: 7, endLine: 7, content: '    }' })
    expect(result.continuationCursor).toBeUndefined()
    const completed = cli('source', '--index', path.join(output, 'index'), '--file', 'src/impls.rs', '--symbol', implementation, '--continue-from', '8', '--max-lines', '1', '--format', 'json')
    expect(completed.content).toBe('')
    expect(completed.lineCount).toBe(0)
  })
  it('does not label parser-unknown file-symbol continuation as a trusted boundary', () => {
    const project = synthetic('pub fn broken() { let value = ;\n}\n// three\n// four\n// five\n')
    const unknownIndex = path.join(output, 'recovery-index')
    cli('index', '--root', project.root, '--src', 'src', '--out', unknownIndex, '--json')
    const result = cli('source', '--index', unknownIndex, '--file', 'src/lib.rs', '--symbol', 'broken', '--continue-from', '3', '--max-lines', '1', '--format', 'json')
    expect(result.continuationCursor).toMatchObject({ symbolBoundaryKnown: false, reason: 'symbol-end-unknown' })
  })
  it.each(['run', 'crate::alpha::Worker::run'])('keeps ambiguous same-name context explicit for %s', query => {
    const capsule = path.join(output, `ambiguous-${query.length}.json`)
    cli('context', '--index', path.join(output, 'index'), '--query', query, '--role', 'implementation', '--out', capsule, '--json')
    const result = JSON.parse(fs.readFileSync(capsule, 'utf8'))
    expect(result.focus.selectionMode).toBe('best-effort-ambiguous')
    expect(result.roleAdequacy.status).not.toBe('context sufficient for implementation')
  })
  it('never counts conditional owners as a required exact witness', () => {
    const capsule = path.join(output, 'conditional.json')
    cli('context', '--index', path.join(output, 'index'), '--query', 'conditional', '--role', 'implementation', '--out', capsule, '--json')
    const result = JSON.parse(fs.readFileSync(capsule, 'utf8'))
    expect(result.selectedOwners.map((owner: { id: string }) => owner.id)).not.toContain('symbol:src/lib.rs#conditional')
    expect(result.roleAdequacy.status).not.toBe('context sufficient for implementation')
  })
  it('keeps graph identities and semantic retrieval equivalent after compatible incremental reuse', () => {
    const beforeGraph = JSON.parse(fs.readFileSync(path.join(output, 'index/code-graph.json'), 'utf8'))
    const beforeSearch = cli('search', '--index', path.join(output, 'index'), '--query', 'impl crate::alpha::Runner for crate::alpha::Worker run', '--intent', 'ownership', '--json')
    cli('index', '--root', root, '--src', 'src', '--src', 'tests', '--out', path.join(output, 'index'), '--incremental', '--json')
    const afterGraph = JSON.parse(fs.readFileSync(path.join(output, 'index/code-graph.json'), 'utf8'))
    expect(afterGraph.nodes).toEqual(beforeGraph.nodes)
    expect(afterGraph.edges).toEqual(beforeGraph.edges)
    expect(cli('search', '--index', path.join(output, 'index'), '--query', 'impl crate::alpha::Runner for crate::alpha::Worker run', '--intent', 'ownership', '--json').results).toEqual(beforeSearch.results)
  })
  it('retains grounded test references for an explicitly changed exact method', () => {
    const request = path.join(output, 'test-request.json')
    const capsule = path.join(output, 'test-changed.json')
    fs.writeFileSync(request, JSON.stringify({ schemaVersion: '1.0.0', role: 'test-implementation', query: 'impl crate::alpha::Runner for crate::alpha::Worker run', index: path.join(output, 'index'), focusSymbols: [implementation], changedSymbols: [implementation], output: capsule }))
    cli('context', '--request', request, '--json')
    const result = JSON.parse(fs.readFileSync(capsule, 'utf8'))
    expect(result.testInfrastructure.relatedTests).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'tests/owner_tests.rs', basis: 'symbol:src/alpha.rs#Worker' })]))
    expect(result.testInfrastructure.relatedTests.every((ref: { basis: string }) => ref.basis !== implementation)).toBe(true)
  })
  it.each(['architecture', 'implementation', 'test-implementation'])('preserves exact method source and owner relationships for %s', role => {
    const capsule = path.join(output, `${role}.json`)
    const audit = path.join(output, `${role}-audit.json`)
    cli('context', '--index', path.join(output, 'index'), '--query', 'impl crate::alpha::Runner for crate::alpha::Worker run', '--role', role, '--out', capsule, '--audit-out', audit, '--json')
    const result = JSON.parse(fs.readFileSync(capsule, 'utf8'))
    expect(JSON.stringify(result)).toContain(implementation)
    expect(JSON.stringify(result)).toContain(impl)
    expect(result.focus.focusNodeId).toBe(implementation)
    expect(result.selectedSource.slices).toEqual(expect.arrayContaining([expect.objectContaining({ filePath: 'src/impls.rs', startLine: 5, endLine: 7 })]))
    if (role !== 'test-implementation') {
      expect(result.selectedOwners.map((owner: { id: string }) => owner.id)).toContain(implementation)
      expect(result.selectedOwners.map((owner: { id: string }) => owner.id)).not.toContain(inherent)
    } else {
      expect(result.testInfrastructure.relatedTests).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'tests/owner_tests.rs', provenance: 'indexed-rust-module-use' })]))
    }
    expect(JSON.stringify(result)).not.toContain('test executed')
    expect(fs.existsSync(audit)).toBe(true)
  })
})
