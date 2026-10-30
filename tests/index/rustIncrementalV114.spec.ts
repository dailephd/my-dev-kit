import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runIndexCommand, type RunIndexCommandOptions } from '../../src/indexing/runIndexCommand.js'
import { loadTrustedBaseline } from '../../src/indexing/trustedBaseline.js'
import { computeBaselineArtifactIdentity, computeConfigFingerprint } from '../../src/indexing/cacheMetadata.js'
import { runGraphDiff } from '../../src/graph-diff/runGraphDiff.js'
import * as parser from '../../src/languages/rust/parser.js'
import { RustAdapter } from '../../src/languages/rust/adapter.js'
import { allocateV114OutputDir } from '../helpers/v114OutputRoot.js'

const base = allocateV114OutputDir('rust-incremental-v114')
const fixture = path.resolve('tests/fixtures/v114-language/rust/F11-incremental')
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const json = (dir: string, file: string) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
const write = (dir: string, file: string, value: unknown) => fs.writeFileSync(path.join(dir, file), typeof value === 'string' ? value : JSON.stringify(value))
function setup(name: string) {
  fs.mkdirSync(path.join(base, 'changed-config'), { recursive: true })
  const root = fs.mkdtempSync(path.join(base, 'changed-config', name + '-'))
  fs.cpSync(fixture, root, { recursive: true })
  const key = path.basename(root)
  const output = (family: string, suffix = '') => path.join(base, family, key, suffix)
  return { root, output }
}
function run(root: string, out: string, options: Partial<RunIndexCommandOptions> = {}) {
  return runIndexCommand({ root, out, src: ['src', 'crates/worker/src'], ...options, dryRun: false })
}
function artifacts(dir: string) {
  const result: Record<string, unknown> = {}
  // Only top-level build timestamps are volatile. Every other byte of parsed semantic data is compared.
  const volatile: Record<string, string> = { 'symbol-index.json': 'buildTime', 'code-graph.json': 'createdAt', 'classification.json': 'createdAt', 'call-graph.json': 'buildTime', 'data-model.json': 'createdAt', 'data-model-graph.json': 'createdAt', 'frontend-semantic.json': 'createdAt', 'frontend-reachability.json': 'generatedAt' }
  for (const [file, field] of Object.entries(volatile)) if (fs.existsSync(path.join(dir, file))) {
    const value = json(dir, file)
    if (Object.hasOwn(value, field)) value[field] = '<timestamp>'
    result[file] = value
  }
  return result
}
function integrity(dir: string) {
  const graph = json(dir, 'code-graph.json')
  const ids = new Set(graph.nodes.map((n: any) => n.id))
  expect(ids.size).toBe(graph.nodes.length)
  expect(new Set(graph.edges.map((e: any) => e.id)).size).toBe(graph.edges.length)
  for (const e of graph.edges) expect(ids.has(e.source) && ids.has(e.target), e.id).toBe(true)
  const manifest = json(dir, 'manifest.json')
  expect(manifest.artifacts).not.toHaveProperty('cacheMetadata')
  if (fs.existsSync(path.join(dir, 'cache-metadata.json'))) {
    const cache = json(dir, 'cache-metadata.json')
    expect(manifest.sourceRoots).toEqual(cache.sourceRoots)
    expect(cache.cacheSchemaVersion).toBe('1.3.0')
    expect(cache.baselineArtifacts).toEqual(computeBaselineArtifactIdentity(dir))
  }
}
afterEach(() => vi.restoreAllMocks())

describe('B12 F11 serialized Rust incremental correctness', () => {
  it('retains every inherited interpretation term in an independently hashed fingerprint', () => {
    const input = {
      rustCargoFingerprint: 'cargo-bytes-and-selection', configuredImportsFingerprint: 'configured-import-evidence',
      sourceRoots: ['src'], excludePatterns: ['generated'], callGraphEnabled: true, language: null,
      defaultIgnoredDirectoryNames: ['node_modules'], defaultIgnoredDirectoryPrefixes: ['.my-dev-kit'], defaultFileExcludePatterns: ['.d.ts'],
      androidEvidenceFingerprint: 'android', androidGradleEvidenceFingerprint: 'gradle', androidManifestEvidenceFingerprint: 'manifest',
      androidResourcesEvidenceFingerprint: 'resources', androidNavigationXmlEvidenceFingerprint: 'navigation', androidTestEvidenceFingerprint: 'tests',
    }
    const expected = {
      rustParserRevision: 'rust-b08:web-tree-sitter-0.25.10:orchard-0.16.10:d98c6aa1db69cfd204bf07dfefb2451b987160cbb2db95ddac8ac04b5f1eb1d0:1',
      rustCargoStructureRevision: 'v1.14.0-b09', rustRelationshipRevision: 'v1.14.0-b14-doc-comments', rustCargoFingerprint: input.rustCargoFingerprint,
      pythonExtractionRevision: 'v1.14.0-b04', jsTsExtractionRevision: 'v1.14.0-b05', jsFrameworkExtractionRevision: 'v1.14.0-b06',
      frontendFrameworkRevision: 'v1.14.0-b07', configuredImportsRevision: 'v1.14.0-configured-imports',
      configuredImportsFingerprint: input.configuredImportsFingerprint,
      ...Object.fromEntries(Object.entries(input).filter(([key]) => !['rustCargoFingerprint', 'configuredImportsFingerprint'].includes(key))),
    }
    expect(computeConfigFingerprint(input)).toBe(sha(JSON.stringify(expected)))
    expect(computeConfigFingerprint({ ...input, rustCargoFingerprint: 'changed' })).not.toBe(computeConfigFingerprint(input))
  })

  it('workspace membership never expands selected roots and selected worker removal removes its package and targets', async () => {
    const { root, output } = setup('workspace-add-remove')
    const before = output('before-full'), out = output('after-incremental')
    write(root, 'Cargo.toml', fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8').replace('members = ["crates/worker"]', 'members = []'))
    await run(root, before, { src: ['src'], incremental: true })
    fs.cpSync(before, out, { recursive: true })
    write(root, 'Cargo.toml', fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8').replace('members = []', 'members = ["crates/worker"]'))
    expect((await run(root, out, { src: ['src'], incremental: true })).cache.mode).toBe('incremental-full-config-changed')
    expect(json(out, 'code-graph.json').nodes.some((n: any) => n.id === 'file:crates/worker/src/lib.rs')).toBe(false)
    expect(json(out, 'code-graph.json').edges.some((e: any) => e.kind === 'rust-target-root-file' && e.target === 'file:crates/worker/src/lib.rs')).toBe(false)
    const selected = output('before-incremental-baseline')
    await run(root, selected, { incremental: true })
    const mutable = output('after-incremental', 'selected-worker')
    fs.cpSync(selected, mutable, { recursive: true })
    fs.unlinkSync(path.join(root, 'crates/worker/Cargo.toml'))
    const result = await run(root, mutable, { incremental: true })
    expect(result.cache.mode).toBe('incremental-full-config-changed')
    const diff = runGraphDiff({ before: selected, after: mutable })
    expect(diff.nodes.removed).toContainEqual(expect.objectContaining({ id: 'rust-package:crates%2Fworker%2FCargo.toml' }))
    expect(diff.nodes.removed).toContainEqual(expect.objectContaining({ id: 'rust-target:crates%2Fworker%2FCargo.toml#lib#workspace_worker#crates%2Fworker%2Fsrc%2Flib.rs' }))
    expect(diff.symbolIndex.symbolsRemoved).toEqual([])
    integrity(mutable)
  })

  const scenarios: Array<[string, (root: string) => void, boolean, Partial<RunIndexCommandOptions>?]> = [
    ['method', root => write(root, 'src/beta.rs', fs.readFileSync(path.join(root, 'src/beta.rs'), 'utf8').replace('-> u8', '-> u16')), false],
    ['package', root => write(root, 'Cargo.toml', fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8').replace('cache-fixture', 'renamed-package')), true],
    ['target', root => write(root, 'Cargo.toml', fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8').replace('src/lib.rs', 'src/beta.rs')), true],
    ['workspace', root => write(root, 'Cargo.toml', fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8').replace('members = ["crates/worker"]', 'members = []')), true],
    ['module-rename', root => { write(root, 'src/lib.rs', fs.readFileSync(path.join(root, 'src/lib.rs'), 'utf8').replace('pub mod alpha;', 'pub mod renamed;').replace('crate::alpha', 'crate::renamed')); fs.renameSync(path.join(root, 'src/alpha.rs'), path.join(root, 'src/renamed.rs')) }, false],
    ['module-relocate', root => { write(root, 'src/lib.rs', fs.readFileSync(path.join(root, 'src/lib.rs'), 'utf8').replace('pub mod alpha;', '#[path = "beta.rs"]\npub mod alpha;')); }, false],
    ['cfg', root => write(root, 'src/extra.rs', '#[cfg(feature = "beta")]\npub struct Conditional;\n'), false],
    ['cfg-attr', root => write(root, 'src/lib.rs', '#[cfg_attr(feature = "beta", path = "beta.rs")]\n' + fs.readFileSync(path.join(root, 'src/lib.rs'), 'utf8')), false],
    ['literal-path', root => write(root, 'src/lib.rs', fs.readFileSync(path.join(root, 'src/lib.rs'), 'utf8').replace('"extra.rs"', '"beta.rs"')), false],
    ['missing-path', root => write(root, 'src/lib.rs', fs.readFileSync(path.join(root, 'src/lib.rs'), 'utf8').replace('"extra.rs"', '"missing.rs"')), false],
    ['escaping-path', root => write(root, 'src/lib.rs', fs.readFileSync(path.join(root, 'src/lib.rs'), 'utf8').replace('"extra.rs"', '"../../outside.rs"')), false],
    ['roots', () => {}, true, { src: ['crates/worker/src'] }],
    ['exclude', () => {}, true, { exclude: ['src/extra.rs', 'crates/worker'] }],
  ]
  it.each(scenarios)('%s converges with full extraction and removes stale evidence', async (name, mutate, config, options = {}) => {
    const { root, output } = setup(name)
    const before = output('before-full'), changed = output('after-incremental', 'changed-files'), affected = output('after-incremental', 'affected-neighborhood'), full = output('after-full')
    await run(root, before, { incremental: true, callGraph: true })
    const beforeHash = sha(fs.readFileSync(path.join(before, 'code-graph.json')))
    fs.cpSync(before, output('before-incremental-baseline'), { recursive: true })
    for (const dir of [changed, affected]) fs.cpSync(before, dir, { recursive: true })
    mutate(root)
    const spy = vi.spyOn(RustAdapter.prototype, 'extractFromSource')
    const result = await run(root, changed, { incremental: true, callGraph: true, ...options })
    const parses = spy.mock.calls.length
    if (config) expect(result.cache.mode).toBe('incremental-full-config-changed')
    else {
      expect(result.cache.mode).toBe('incremental-partial-with-artifact-fallback')
      expect(result.incrementalRefresh!.freshExtractionFileCount).toBe(parses)
      expect(result.incrementalRefresh!.reusedFileCount).toBeGreaterThan(0)
      const unchanged = json(before, 'symbol-index.json').files.find((f: any) => f.path === 'crates/worker/src/lib.rs')
      expect(json(changed, 'symbol-index.json').files.find((f: any) => f.path === unchanged.path)).toEqual(unchanged)
    }
    await run(root, affected, { incremental: true, refreshScope: 'affected-neighborhood', callGraph: true, ...options })
    await run(root, full, { callGraph: true, ...options })
    expect(artifacts(changed)).toEqual(artifacts(full))
    expect(artifacts(affected)).toEqual(artifacts(full))
    for (const dir of [changed, affected, full]) integrity(dir)
    const diff = runGraphDiff({ before: full, after: changed })
    expect(Object.values(diff.summary)).toEqual(Object.values(diff.summary).map(() => 0))
    expect(sha(fs.readFileSync(path.join(before, 'code-graph.json')))).toBe(beforeHash)
    const graph = json(full, 'code-graph.json')
    if (['literal-path', 'missing-path', 'escaping-path'].includes(name)) expect(graph.edges.some((e: any) => e.kind === 'rust-module-resolves-to-file' && e.target === 'file:src/extra.rs')).toBe(false)
    if (name === 'roots') expect(graph.nodes.some((n: any) => n.id === 'file:src/lib.rs')).toBe(false)
    if (name === 'cfg') {
      expect(json(full, 'symbol-index.json').files.find((f: any) => f.path === 'src/extra.rs').rustSyntaxFacts).toEqual(expect.arrayContaining([expect.objectContaining({ attributes: ['#[cfg(feature = "beta")]'], status: 'syntax-only' })]))
      expect(graph.edges.some((e: any) => e.kind === 'rust-module-defines-symbol' && e.target === 'symbol:src/extra.rs#Conditional')).toBe(false)
    }
    fs.writeFileSync(path.join(output('after-full'), 'b12-invocation-evidence.json'), JSON.stringify({ name, parses, cache: result.cache, refresh: result.incrementalRefresh, artifacts: Object.keys(artifacts(full)) }))
  })

  it('genuine no-change preserves all bytes without parser preparation or extraction', async () => {
    const { root, output } = setup('no-change'), out = output('after-incremental')
    await run(root, out, { incremental: true })
    const bytes = Object.fromEntries(fs.readdirSync(out).map(f => [f, sha(fs.readFileSync(path.join(out, f)))]))
    const prepare = vi.spyOn(parser, 'prepareRustParser'), extract = vi.spyOn(RustAdapter.prototype, 'extractFromSource')
    for (const refreshScope of ['changed-files', 'affected-neighborhood'] as const) {
      const result = await run(root, out, { incremental: true, refreshScope })
      expect(result.cache.mode).toBe('incremental-no-change')
      expect(result.incrementalRefresh).toMatchObject({ appliedScope: 'none', freshExtractionFileCount: 0 })
    }
    expect(prepare).not.toHaveBeenCalled(); expect(extract).not.toHaveBeenCalled()
    expect(Object.fromEntries(fs.readdirSync(out).map(f => [f, sha(fs.readFileSync(path.join(out, f)))]))).toEqual(bytes)
  })

  it('falls back truthfully when Rust structural neighbors have no supported N11 file mapping', async () => {
    const { root, output } = setup('unsupported-rust-neighborhood'), out = output('after-incremental')
    await run(root, out, { incremental: true })
    write(root, 'src/beta.rs', 'pub struct Other;\nimpl Other { pub fn run(&self) -> u16 { 3 } }\n')
    const result = await run(root, out, { incremental: true, refreshScope: 'affected-neighborhood' })
    expect(result.incrementalRefresh).toMatchObject({ appliedScope: 'full', selectionStatus: 'fallback-full', fallbackReason: 'unsupported-rust-neighborhood' })
    await run(root, output('after-full'))
    expect(artifacts(out)).toEqual(artifacts(output('after-full')))
  })

  it('retains safe affected-neighborhood reuse for Rust file/symbol evidence without structural neighbors', async () => {
    const { root, output } = setup('safe-rust-neighborhood'), out = output('after-incremental')
    fs.unlinkSync(path.join(root, 'Cargo.toml'))
    await run(root, out, { incremental: true })
    write(root, 'src/alpha/nested.rs', 'pub fn nested() -> u16 { 4 }\n')
    const result = await run(root, out, { incremental: true, refreshScope: 'affected-neighborhood' })
    expect(result.incrementalRefresh).toMatchObject({ appliedScope: 'affected-neighborhood', selectionStatus: 'applied', fallbackReason: null, freshExtractionFileCount: 1, reusedFileCount: 5 })
    await run(root, output('after-full'))
    expect(artifacts(out)).toEqual(artifacts(output('after-full')))
  })

  it.each(['changed-files', 'affected-neighborhood'] as const)('rejects damaged baselines before %s no-change or partial reuse', async refreshScope => {
    for (const damage of ['manifest-hash', 'symbol-hash', 'graph-corrupt', 'graph-missing', 'cache-corrupt', 'schema', 'incomplete']) {
      const { root, output } = setup('damaged-' + refreshScope + '-' + damage), before = output('before-full'), out = output('damaged-cache')
      await run(root, before, { incremental: true })
      fs.cpSync(before, out, { recursive: true })
      const cache = json(out, 'cache-metadata.json')
      if (damage === 'manifest-hash') { const m = json(out, 'manifest.json'); m.summary.fileCount = 999; write(out, 'manifest.json', m) }
      if (damage === 'symbol-hash') { const s = json(out, 'symbol-index.json'); s.files[0].symbols = []; write(out, 'symbol-index.json', s) }
      if (damage === 'graph-corrupt') write(out, 'code-graph.json', '{')
      if (damage === 'graph-missing') fs.unlinkSync(path.join(out, 'code-graph.json'))
      if (damage === 'cache-corrupt') write(out, 'cache-metadata.json', '{')
      if (damage === 'schema') { cache.cacheSchemaVersion = '0.0.0'; write(out, 'cache-metadata.json', cache) }
      if (damage === 'incomplete') { const s = json(out, 'symbol-index.json'); delete s.files; write(out, 'symbol-index.json', s); cache.baselineArtifacts.symbolIndexSha256 = sha(fs.readFileSync(path.join(out, 'symbol-index.json'))); write(out, 'cache-metadata.json', cache) }
      const trusted = loadTrustedBaseline({ outputDir: out, projectRoot: root, sourceRoots: ['src', 'crates/worker/src'], configFingerprint: cache.configFingerprint })
      expect(trusted.status).not.toBe('trusted')
      const result = await run(root, out, { incremental: true, refreshScope })
      expect(result.cache.mode, damage).not.toBe('incremental-no-change')
      expect(result.incrementalRefresh!.appliedScope).toBe('full')
      expect(artifacts(out)).toEqual(artifacts(before))
      // Now damage an independently mutable copy with a simultaneous source edit.
      const partial = output('damaged-cache', 'with-edit')
      fs.cpSync(before, partial, { recursive: true })
      const s = json(partial, 'symbol-index.json'); s.files.find((f: any) => f.path === 'src/beta.rs').symbols = []; write(partial, 'symbol-index.json', s)
      write(root, 'src/extra.rs', 'pub struct Changed;\n')
      const edited = await run(root, partial, { incremental: true, refreshScope })
      expect(edited.incrementalRefresh!.appliedScope).toBe('full')
      await run(root, output('after-full'))
      expect(artifacts(partial)).toEqual(artifacts(output('after-full')))
    }
  })

  it('simulates incompatible parser/grammar identity through the real fingerprint producer', async () => {
    const { root, output } = setup('parser-revision'), out = output('after-incremental')
    await run(root, out, { incremental: true })
    const original = parser.RUST_PARSER_REVISION
    const spy = vi.spyOn(parser, 'RUST_PARSER_REVISION', 'get').mockReturnValue((original + ':simulated-incompatible') as typeof original)
    const result = await run(root, out, { incremental: true })
    expect(result.cache.mode).toBe('incremental-full-config-changed')
    spy.mockRestore()
    expect((await run(root, out, { incremental: true })).cache.mode).toBe('incremental-full-config-changed')
    expect(sha(fs.readFileSync('src/languages/rust/assets/tree-sitter-rust-orchard.wasm'))).toBe('d98c6aa1db69cfd204bf07dfefb2451b987160cbb2db95ddac8ac04b5f1eb1d0')
  })
})
