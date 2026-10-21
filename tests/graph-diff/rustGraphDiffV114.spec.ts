import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { runGraphDiff } from '../../src/graph-diff/runGraphDiff.js'
import { buildCodeGraphDiff } from '../../src/graph-diff/buildCodeGraphDiff.js'
import { buildSymbolIndexDiff } from '../../src/graph-diff/buildSymbolIndexDiff.js'
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'

const base = path.resolve('.my-dev-kit-workflow/tmp/v1.14.0-b12-20261021/tests')
const read = (dir: string, file: string) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
const put = (root: string, file: string, text: string) => fs.writeFileSync(path.join(root, file), text)
const fixture = path.resolve('tests/fixtures/v114-language/rust/F11-incremental')
const betaRun = 'symbolq:src%2Fbeta.rs#rust%3Aimpl%3AOther%402%3A18#run#0'
const packageId = 'rust-package:Cargo.toml'
const targetId = 'rust-target:Cargo.toml#lib#cache_fixture#src%2Flib.rs'
const moduleId = (name: string) => `rust-module:rust-target%3ACargo.toml%23lib%23cache_fixture%23src%252Flib.rs#crate%3A%3A${name}`
const edgeId = (from: string, kind: string, to: string) => `${from}--${kind}-->${to}`
function project(name: string) {
  fs.mkdirSync(path.join(base, 'changed-config'), { recursive: true })
  const root = fs.mkdtempSync(path.join(base, 'changed-config', 'diff-' + name + '-'))
  fs.cpSync(fixture, root, { recursive: true })
  // Independent mixed-language witnesses; they are temporary, never executed.
  put(root, 'src/worker.ts', 'export class TypeScriptWorker {}\n')
  put(root, 'src/worker.py', 'class PythonWorker:\n    pass\n')
  const key = path.basename(root)
  const out = (family: string) => path.join(base, family, key)
  return { root, before: out('before-full'), after: out('after-full'), partial: out('after-incremental') }
}
const index = (root: string, out: string, incremental = false) => runIndexCommand({ root, src: ['src'], out, incremental })
function hashes(dir: string) {
  return Object.fromEntries(fs.readdirSync(dir).map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex')]))
}
function zero(diff: ReturnType<typeof runGraphDiff>) {
  for (const count of Object.values(diff.summary)) expect(count).toBe(0)
}
function sorted(diff: ReturnType<typeof runGraphDiff>) {
  for (const section of [diff.nodes, diff.edges]) for (const records of Object.values(section)) {
    const ids = records.map((r: any) => r.id)
    expect(ids).toEqual([...ids].sort())
    expect(new Set(ids).size).toBe(ids.length)
  }
}

describe('B12 generic graph diff over immutable Rust artifacts', () => {
  it('compares exact qualified methods, preserving unrelated same-name and language owners', async () => {
    const { root, before, after, partial } = project('method')
    await index(root, before, true)
    const original = hashes(before)
    fs.cpSync(before, partial, { recursive: true })
    put(root, 'src/beta.rs', 'pub struct Other;\nimpl Other {\n\n    pub fn run(&self) -> u16 { 3 }\n}\n')
    await index(root, after)
    await index(root, partial, true)
    const diff = runGraphDiff({ before, after })
    expect(diff.symbolIndex.symbolsChanged).toEqual([betaRun])
    expect(diff.symbolIndex.symbolsAdded).toEqual([])
    expect(diff.symbolIndex.symbolsRemoved).toEqual([])
    expect(diff.nodes.changed.some(n => n.id === betaRun)).toBe(true)
    expect(diff.nodes.changed.every(n => n.id.includes('beta.rs'))).toBe(true)
    expect(diff.nodes.added).toEqual([]); expect(diff.nodes.removed).toEqual([])
    expect(diff.edges.added).toEqual([]); expect(diff.edges.removed).toEqual([])
    expect(diff.edges.changed).toEqual([expect.objectContaining({ id: edgeId('rust-impl:src%2Fbeta.rs#rust%3Aimpl%3AOther%402%3A18#0', 'rust-impl-defines-symbol', betaRun), changedFields: ['metadata'], after: { metadata: { file: 'src/beta.rs', line: 4, sourceIndex: 36, syntaxKind: 'function_item', resolutionStatus: 'RESOLVED' } } })])
    sorted(diff)
    expect(runGraphDiff({ before, after })).toEqual(diff)
    zero(runGraphDiff({ before, after: before }))
    zero(runGraphDiff({ before: after, after: partial }))
    expect(hashes(before)).toEqual(original)
  })

  it('adds and removes a separate same-name method with exact impl/member identities', async () => {
    const { root, before, after } = project('added-method')
    const initial = 'pub struct Other;\nimpl Other {\n    pub fn run(&self) -> u8 { 3 }\n}\n'
    await index(root, before)
    put(root, 'src/beta.rs', initial + 'impl Other { pub fn run(&self) -> u8 { 5 } }\n')
    await index(root, after)
    const owner = 'rust:impl:Other@5:' + initial.length
    const method = `symbolq:src%2Fbeta.rs#${encodeURIComponent(owner)}#run#0`
    const impl = `rust-impl:src%2Fbeta.rs#${encodeURIComponent(owner)}#0`
    const diff = runGraphDiff({ before, after })
    expect(diff.symbolIndex.symbolsAdded).toEqual([method])
    expect(diff.symbolIndex.symbolsRemoved).toEqual([])
    expect(diff.nodes.added.map(n => n.id).sort()).toEqual([method, impl].sort())
    expect(diff.edges.added).toEqual(expect.arrayContaining([expect.objectContaining({ id: edgeId(impl, 'rust-impl-defines-symbol', method) })]))
    const reverse = runGraphDiff({ before: after, after: before })
    expect(reverse.nodes.removed.map(n => n.id).sort()).toEqual([method, impl].sort())
    expect(reverse.symbolIndex.symbolsRemoved).toEqual([method])
    expect(diff.symbolIndex.symbolsChanged).not.toContain(betaRun)
  })

  it('detects Cargo-only target identity replacement and package metadata without changing physical symbols', async () => {
    const { root, before, after } = project('cargo')
    await index(root, before)
    put(root, 'Cargo.toml', fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8').replace('cache-fixture', 'renamed').replace('src/lib.rs', 'src/beta.rs'))
    await index(root, after)
    const diff = runGraphDiff({ before, after })
    const newTarget = 'rust-target:Cargo.toml#lib#cache_fixture#src%2Fbeta.rs'
    expect(diff.nodes.removed).toContainEqual(expect.objectContaining({ id: targetId }))
    expect(diff.nodes.added).toContainEqual(expect.objectContaining({ id: newTarget }))
    expect(diff.nodes.changed).toContainEqual(expect.objectContaining({ id: packageId, changedFields: ['label'] }))
    expect(diff.edges.removed).toContainEqual(expect.objectContaining({ id: edgeId(targetId, 'rust-target-root-file', 'file:src/lib.rs') }))
    expect(diff.edges.added).toContainEqual(expect.objectContaining({ id: edgeId(newTarget, 'rust-target-root-file', 'file:src/beta.rs') }))
    expect(diff.symbolIndex.symbolsAdded).toEqual([]); expect(diff.symbolIndex.symbolsRemoved).toEqual([]); expect(diff.symbolIndex.symbolsChanged).toEqual([])
    sorted(diff)
  })

  it('reports module rename, exact resolved files, and deleted physical endpoints', async () => {
    const { root, before, after } = project('module')
    await index(root, before)
    put(root, 'src/lib.rs', fs.readFileSync(path.join(root, 'src/lib.rs'), 'utf8').replace('pub mod alpha;', 'pub mod renamed;').replace('crate::alpha', 'crate::renamed'))
    fs.renameSync(path.join(root, 'src/alpha.rs'), path.join(root, 'src/renamed.rs'))
    await index(root, after)
    const diff = runGraphDiff({ before, after })
    expect(diff.nodes.removed).toContainEqual(expect.objectContaining({ id: moduleId('alpha') }))
    expect(diff.nodes.added).toContainEqual(expect.objectContaining({ id: moduleId('renamed') }))
    expect(diff.edges.removed).toContainEqual(expect.objectContaining({ id: edgeId(moduleId('alpha'), 'rust-module-resolves-to-file', 'file:src/alpha.rs') }))
    expect(diff.edges.added).toContainEqual(expect.objectContaining({ id: edgeId(moduleId('renamed'), 'rust-module-resolves-to-file', 'file:src/renamed.rs') }))
    const graph = read(after, 'code-graph.json'), ids = new Set(graph.nodes.map((n: any) => n.id))
    expect(ids.has('file:src/alpha.rs')).toBe(false)
    for (const e of graph.edges) expect(ids.has(e.source) && ids.has(e.target)).toBe(true)
  })

  it.each(['condition', 'path', 'alias'])('reports persisted %s metadata through existing changed fields', async mode => {
    const { root, before, after } = project(mode)
    await index(root, before)
    let text = fs.readFileSync(path.join(root, 'src/lib.rs'), 'utf8')
    if (mode === 'condition') text = text.replace('pub mod alpha;', '#[cfg(feature = "alpha")]\npub mod alpha;')
    if (mode === 'path') text = text.replace('"extra.rs"', '"missing.rs"')
    if (mode === 'alias') text = text.replace('Exported', 'RenamedAlias')
    put(root, 'src/lib.rs', text)
    await index(root, after)
    const diff = runGraphDiff({ before, after })
    if (mode === 'alias') expect(diff.edges.changed.some(e => e.kind === 'rust-module-reexports-symbol' && e.changedFields.includes('metadata'))).toBe(true)
    else {
      const id = moduleId(mode === 'condition' ? 'alpha' : 'selected')
      expect(diff.nodes.changed).toContainEqual(expect.objectContaining({ id, changedFields: expect.arrayContaining(['rustMetadata']) }))
      const graph = read(after, 'code-graph.json')
      expect(graph.edges.some((e: any) => e.source === id && e.kind === 'rust-module-resolves-to-file')).toBe(false)
      expect(graph.nodes.find((n: any) => n.id === id).rustMetadata.status).toBe(mode === 'condition' ? 'CONDITIONAL' : 'UNRESOLVED_SELECTED_ROOTS')
    }
    sorted(diff)
  })

  it('keeps generic changed fields for source provenance, status, conditions and alias occurrence', () => {
    const before = { nodes: [{ id: betaRun, kind: 'symbol', line: 3, rustMetadata: { status: 'RESOLVED' } }], edges: [{ id: 'exact-edge', source: betaRun, target: betaRun, kind: 'rust-module-uses-module', metadata: { alias: 'Before', occurrence: 0 } }] } as unknown as CodeGraph
    const after = structuredClone(before)
    after.nodes[0].line = 4
    after.nodes[0].rustMetadata = { origin: 'syntax', status: 'CONDITIONAL' }
    after.edges[0].metadata = { alias: 'After', occurrence: 1 }
    const diff = buildCodeGraphDiff(before, after)
    expect(diff.nodes.changed).toEqual([expect.objectContaining({ id: betaRun, changedFields: ['line', 'rustMetadata'] })])
    expect(diff.edges.changed).toEqual([expect.objectContaining({ id: 'exact-edge', changedFields: ['metadata'] })])
  })

  it('preserves legacy simple-name symbols alongside persisted qualified identities', () => {
    const legacy = { schemaVersion: '2', files: [{ path: 'legacy.ts', symbols: [{ name: 'run', kind: 'function', location: { file: 'legacy.ts', line: 1 }, exported: true }] }] } as unknown as SymbolIndex
    const after = structuredClone(legacy)
    after.files[0].symbols.push({ ...after.files[0].symbols[0], nodeId: betaRun, ownerKey: 'rust:impl:Other@2:18', location: { file: 'src/beta.rs', line: 3 } })
    expect(buildSymbolIndexDiff(legacy, after)).toMatchObject({ symbolsAdded: [betaRun], symbolsRemoved: [], symbolsChanged: [] })
  })
})
