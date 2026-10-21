import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import childProcess from 'node:child_process'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import * as cacheMetadata from '../../src/indexing/cacheMetadata.js'
import type { ConfigFingerprintInput } from '../../src/indexing/cacheMetadata.js'
import { RUST_PARSER_REVISION } from '../../src/languages/rust/parser.js'
import { resolveFileNodeTarget, resolveSymbolTarget } from '../../src/lookup/resolveSourceTarget.js'
import { getSourceSlice } from '../../src/lookup/getSourceSlice.js'
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'

const corpus = path.resolve('tests/fixtures/v114-language/rust/F14-licensed-corpus')
const temp = path.resolve('.my-dev-kit-workflow/tmp/v1.14.0-b14-20261021/tests')
function nextOutput(prefix: string): string {
  fs.mkdirSync(temp, { recursive: true })
  let n = 1
  while (fs.existsSync(path.join(temp, `${prefix}${String(n).padStart(2, '0')}`))) n++
  const out = path.join(temp, `${prefix}${String(n).padStart(2, '0')}`)
  fs.mkdirSync(out)
  return out
}
// Independent values frozen from the approved pinned upstream Git blobs, not analyzer output.
const projects = [
  { dir: 'async-service', repo: 'tokio-rs/mini-redis', commit: '3d93b42bc363220f85af4fc9e1bebd35b588a4a3', license: 'MIT', roots: ['src'], files: [
    ['LICENSE', '2b582d811c69024b8fe7e69a25b6359e7291303ef0b30428e214dbf8d9848d35'],
    ['Cargo.toml', '6ab3fe0a05aed0f910c502887eb90cd157c6ae25a12350b629b18d72d4ecc5fc'],
    ['src/lib.rs', '693a6d114e8a41fe36c9c1e434a44284a03e9641797c2f5fd3568ab8c30da0d4'],
    ['src/server.rs', 'fa167b058427fa716a6874568f5989153d3ac5d0a261485b2f6bcf957f503d4e'],
    ['src/db.rs', 'f42f9dae74de01394de6c2471101c22cbfe27d5f0282ac9144620ec70adc02fd'],
    ['src/shutdown.rs', '411dfa5201b37c5627077ec7b55e68b0dabfaaa4596198f71bb19c2b031d56c4'],
    ['src/connection.rs', '27cbca440dd79d095b42801db49b2835b8175386c181c2b0f718f594da26fd03'],
    ['src/frame.rs', 'b0e00edf693935a3c1474e9b693cb257868cf4121c0f61014c10d1fd26c150d5'],
    ['src/parse.rs', 'de6f5fd03f2d56c965cd48adb2adb7efb3728c31bee60ce63fefd4a7c53e8caf'],
  ] },
  { dir: 'cli', repo: 'sharkdp/fd', commit: 'cfed17a2bc4a2a27eeb90932b94f4c5680a78741', license: 'MIT OR Apache-2.0', roots: ['src'], files: [
    ['LICENSE-MIT', '322cfc7aa0c774d0eca3b2610f1d414de3ddbd7d8dd4b9dea941a13a6eb07455'],
    ['LICENSE-APACHE', '73c83c60d817e7df1943cb3f0af81e4939a8352c9a96c2fd00451b1116fa635c'],
    ['Cargo.toml', 'e990d95dcee8a6f362f344970e5c00c70f27a1a3998c6bb32e4290cd35ce3b57'],
    ['src/main.rs', '293fce692ef5f9564925431e13e1a8893e4720b47283e9cf7fc9f3c52a634b54'],
    ['src/cli.rs', '4d957fd33d1cd37bb7fca1f82e0b2273a3531c62eb2c9e9ae2e971657b0bbde4'],
    ['src/config.rs', '448f224f277ea02a5f1a28f9cdfa93d4227b0981811e4eddb2f63b0dd694338d'],
    ['src/error.rs', '4c421b880c67bcb07e3880815e1904c288e8eba1c361047ebc5fb829079e9f54'],
    ['src/exit_codes.rs', '02411adc693bf610b077a77d1bf42b9cd95dcb1bc3d707dbbd35c76d187346b5'],
  ] },
  { dir: 'multi-crate-library', repo: 'tokio-rs/tracing', commit: '9d0e557728ecb91e467fc29dfe738b9f28cf6684', license: 'MIT', roots: ['tracing/src', 'tracing-core/src'], files: [
    ['LICENSE', '898b1ae9821e98daf8964c8d6c7f61641f5f5aa78ad500020771c0939ee0dea1'],
    ['Cargo.toml', '0ecfacd7a666662dac018df4f214ccea8ef573e1cfd7769bb65496cbc84f915d'],
    ['tracing/Cargo.toml', '13aaeffa24118b7a29647a886145616f3cd4b136a81441d4249dc46e2693acac'],
    ['tracing/src/lib.rs', 'a317f30bc270f8339b793f2a52e654098540bf9fd9f39b26befb3b2ec6a9e506'],
    ['tracing/src/dispatcher.rs', 'a8732392ffe56b1178f8fd3d6e6e02d40b51475c38bb4600abd9cd170df1bf6c'],
    ['tracing/src/field.rs', 'f4ba4bb680a844733682b21b8fef46773054989b6dd4f31aac38ee39ec287d4d'],
    ['tracing-core/Cargo.toml', '20e34bb11c91680b2f8ff5c35358c2361690c65eb679410b22e3b86604a46866'],
    ['tracing-core/src/lib.rs', 'd16824b9d2748116de57f5df213a33cae8d8da1c48cd5b1d25d716e72f98d292'],
    ['tracing-core/src/callsite.rs', '82d54507e629d231ad58ce33adacadd45654372067a40e082a24b1847bb7eb3e'],
    ['tracing-core/src/dispatcher.rs', 'd2a0584196c7e053006490baebfa61c6b3145138e3209f82f44d1afbe066acb6'],
  ] },
]
type Snapshot = { graph: CodeGraph; index: SymbolIndex; out: string }
const snapshots = new Map<string, Snapshot>()
const read = <T,>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T

describe('B14 pinned licensed corpus and structural evidence', () => {
  beforeAll(async () => {
    fs.mkdirSync(temp, { recursive: true })
    for (const p of projects) {
      const out = nextOutput('corpus-')
      await runIndexCommand({ root: path.join(corpus, p.dir), src: p.roots, out, incremental: true })
      snapshots.set(p.dir, { out, graph: read<CodeGraph>(path.join(out, 'code-graph.json')), index: read<SymbolIndex>(path.join(out, 'symbol-index.json')) })
    }
  })

  it.each(projects)('preserves exact upstream bytes and complete provenance for $repo', p => {
    const doc = fs.readFileSync(path.join(corpus, p.dir, 'SOURCE.md'), 'utf8')
    for (const text of [p.repo, p.commit, p.license, '2026-10-21', 'partial source selection', 'static-analysis tests only', 'Copied bytes modified: **No**']) expect(doc).toContain(text)
    const expected = ['SOURCE.md', ...p.files.map(([file]) => file)].sort()
    // Ignore retained local generated directories; they are never corpus inputs or tracked fixtures.
    const actual = fs.readdirSync(path.join(corpus, p.dir), { recursive: true, withFileTypes: true })
      .filter(e => e.isFile() && !path.relative(path.join(corpus, p.dir), e.parentPath).split(path.sep).some(s => s.startsWith('.')))
      .map(e => path.relative(path.join(corpus, p.dir), path.join(e.parentPath, e.name)).split(path.sep).join('/')).sort()
    expect(actual).toEqual(expected)
    for (const [file, sha] of p.files) {
      const bytes = fs.readFileSync(path.join(corpus, p.dir, file))
      expect(createHash('sha256').update(bytes).digest('hex'), file).toBe(sha)
      expect(doc).toContain(`| ${file} | ${file} | ${bytes.length} | ${sha} |`)
      if (file.endsWith('.rs')) expect(bytes.length).toBeLessThanOrEqual(65536)
      if (file.startsWith('LICENSE')) expect(bytes.toString()).toMatch(/Copyright|copyright/)
    }
  })

  it('keeps the three server run owners independently addressable', () => {
    const { graph, index } = snapshots.get('async-service')!
    const runs = graph.nodes.filter(n => n.path === 'src/server.rs' && n.symbolName === 'run')
    expect(runs.map(n => n.id).sort()).toEqual([
      'symbol:src/server.rs#run',
      'symbolq:src%2Fserver.rs#rust%3Aimpl%3AHandler%40304%3A12682#run#0',
      'symbolq:src%2Fserver.rs#rust%3Aimpl%3AListener%40200%3A8444#run#0',
    ])
    const target = resolveSymbolTarget(index, 'src/server.rs', 'run', 160, 'symbol:src/server.rs#run')
    // The parser includes the original doc comments starting at 114; the function header is at 123.
    expect(target).toMatchObject({ startLine: 114, endLine: 198, symbolEndLine: 198 })
    const source = getSourceSlice({ ...target, projectRoot: path.join(corpus, 'async-service'), indexDir: 'test', startLine: 114, endLine: 220, maxLines: 160 })
    expect(source.content).toContain('pub async fn run(listener: TcpListener, shutdown: impl Future)')
    expect(source.content).not.toContain('impl Listener')
    expect(source.continuationCursor).toBeUndefined()
    expect(() => resolveSymbolTarget(index, 'src/server.rs', 'run', 20)).toThrow('AMBIGUOUS_SYMBOL')
  })

  it('retains CLI main, Config and its separate physical impl member', () => {
    const { graph, index } = snapshots.get('cli')!
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'symbol:src/main.rs#main', path: 'src/main.rs' }),
      expect.objectContaining({ id: 'symbol:src/config.rs#Config', path: 'src/config.rs', line: 13 }),
      expect.objectContaining({ id: 'symbolq:src%2Fconfig.rs#rust%3Aimpl%3AConfig%40138%3A4824#is_printing#0', path: 'src/config.rs', line: 139 }),
    ]))
    const target = resolveSymbolTarget(index, 'src/config.rs', 'is_printing', 20)
    expect(target).toMatchObject({ startLine: 139, endLine: 142, symbolEndLine: 142 })
    const member = graph.edges.find(e => e.kind === 'rust-impl-defines-symbol' && e.target.endsWith('#is_printing#0'))!
    expect(member, 'The documented physical Config::is_printing member must retain its impl ownership edge').toBeDefined()
    expect(member.source).toBe('rust-impl:src%2Fconfig.rs#rust%3Aimpl%3AConfig%40138%3A4824#0')
    expect(graph.edges).toContainEqual(expect.objectContaining({ source: member.source, kind: 'rust-impl-for-type', target: 'symbol:src/config.rs#Config' }))
    expect(member.id).toBe(`${member.source}--rust-impl-defines-symbol-->${member.target}`)
    expect(graph.edges.filter(e => e.source === member.source).map(e => e.kind).sort()).toEqual(['rust-impl-defines-symbol', 'rust-impl-for-type'])
  })

  it('retains real grouped-line documentation as async owner evidence in graph and context', async () => {
    const snapshot = snapshots.get('async-service')!
    const owner = 'symbol:src/server.rs#run'
    const declaration = snapshot.index.files.find(f => f.path === 'src/server.rs')!.symbols.find(s => s.nodeId === owner)!
    expect(declaration.declarationMetadata?.rust?.attributes.some(a => a.includes('///\n///'))).toBe(true)
    expect(snapshot.graph.edges.some(e => e.kind === 'rust-module-defines-symbol' && e.target === owner)).toBe(true)
    const output = nextOutput('077-async-context-')
    const request = path.join(output, 'request.json'), capsule = path.join(output, 'capsule.json')
    fs.writeFileSync(request, JSON.stringify({ schemaVersion: '1.0.0', role: 'implementation', query: 'src/server.rs run', focusSymbols: [owner] }))
    childProcess.execFileSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('src/cli.ts'), 'context', '--request', request, '--index', snapshot.out, '--out', capsule, '--json'], { encoding: 'utf8', windowsHide: true })
    const result = read<{ selectedOwners: { id: string }[]; selectedSource: { slices: { nodeId: string; startLine: number; endLine: number }[] }; provenance: { sourceId: string }[]; roleAdequacy: { missingConditions: string[] } }>(capsule)
    expect(result.selectedOwners.some(o => o.id === owner)).toBe(true)
    expect(result.selectedSource.slices).toContainEqual(expect.objectContaining({ nodeId: owner, startLine: 114, endLine: 198 }))
    expect(result.provenance.some(p => p.sourceId === owner)).toBe(true)
    expect(result.roleAdequacy.missingConditions).not.toContain('owner missing')
  })

  it('invalidates a trusted pre-correction fingerprint, repairs missing edges and preserves corrected warm evidence', async () => {
    const out = nextOutput('033-old-cache-')
    // Independent old normalized algorithm contract; no production revision override is introduced.
    const oldFingerprint = (input: ConfigFingerprintInput) => createHash('sha256').update(JSON.stringify({
      rustParserRevision: RUST_PARSER_REVISION, rustCargoStructureRevision: 'v1.14.0-b09', rustRelationshipRevision: 'v1.14.0-b10', rustCargoFingerprint: input.rustCargoFingerprint ?? null,
      pythonExtractionRevision: 'v1.14.0-b04', jsTsExtractionRevision: 'v1.14.0-b05', jsFrameworkExtractionRevision: 'v1.14.0-b06', frontendFrameworkRevision: 'v1.14.0-b07', configuredImportsRevision: 'v1.14.0-configured-imports', configuredImportsFingerprint: input.configuredImportsFingerprint ?? null,
      sourceRoots: [...input.sourceRoots].map(p => p.replaceAll('\\', '/')).sort(), excludePatterns: [...input.excludePatterns].map(p => p.trim()).sort(), callGraphEnabled: input.callGraphEnabled, language: input.language,
      defaultIgnoredDirectoryNames: [...input.defaultIgnoredDirectoryNames].sort(), defaultIgnoredDirectoryPrefixes: [...input.defaultIgnoredDirectoryPrefixes].sort(), defaultFileExcludePatterns: [...input.defaultFileExcludePatterns].sort(),
      androidEvidenceFingerprint: input.androidEvidenceFingerprint, androidGradleEvidenceFingerprint: input.androidGradleEvidenceFingerprint, androidManifestEvidenceFingerprint: input.androidManifestEvidenceFingerprint, androidResourcesEvidenceFingerprint: input.androidResourcesEvidenceFingerprint, androidNavigationXmlEvidenceFingerprint: input.androidNavigationXmlEvidenceFingerprint, androidTestEvidenceFingerprint: input.androidTestEvidenceFingerprint,
    })).digest('hex')
    const spy = vi.spyOn(cacheMetadata, 'computeConfigFingerprint').mockImplementation(oldFingerprint)
    try { await runIndexCommand({ root: path.join(corpus, 'cli'), src: ['src'], out, incremental: true }) } finally { spy.mockRestore() }
    const graphPath = path.join(out, 'code-graph.json')
    const graph = read<CodeGraph>(graphPath)
    const implId = 'rust-impl:src%2Fconfig.rs#rust%3Aimpl%3AConfig%40138%3A4824#0'
    graph.edges = graph.edges.filter(e => e.source !== implId)
    graph.summary.edgeCount = graph.edges.length
    fs.writeFileSync(graphPath, JSON.stringify(graph))
    const metadataPath = path.join(out, 'cache-metadata.json')
    const metadata = read<cacheMetadata.CacheMetadata>(metadataPath)
    metadata.baselineArtifacts = cacheMetadata.computeBaselineArtifactIdentity(out)
    fs.writeFileSync(metadataPath, JSON.stringify(metadata))
    expect(graph.edges.filter(e => e.source === implId)).toEqual([])
    const fixed = await runIndexCommand({ root: path.join(corpus, 'cli'), src: ['src'], out, incremental: true })
    expect(fixed.mode === 'index' && fixed.cache?.mode).toBe('incremental-full-config-changed')
    const corrected = read<CodeGraph>(graphPath)
    expect(corrected.edges.filter(e => e.source === implId).map(e => e.kind).sort()).toEqual(['rust-impl-defines-symbol', 'rust-impl-for-type'])
    const before = fs.readFileSync(graphPath)
    const warm = await runIndexCommand({ root: path.join(corpus, 'cli'), src: ['src'], out, incremental: true })
    expect(warm.mode === 'index' && warm.cache?.mode).toBe('incremental-no-change')
    expect(fs.readFileSync(graphPath)).toEqual(before)
    expect(corrected.edges).toEqual(snapshots.get('cli')!.graph.edges)
    expect(corrected.nodes).toEqual(snapshots.get('cli')!.graph.nodes)
  })

  it('removes stale doc-enabled ownership after a restrictive attribute edit in an isolated corpus copy', async () => {
    const root = nextOutput('033-mutated-cli-')
    for (const [file] of projects[1].files) {
      const target = path.join(root, file)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(path.join(corpus, 'cli', file), target)
    }
    const out = nextOutput('033-mutated-index-')
    await runIndexCommand({ root, src: ['src'], out, incremental: true })
    const before = read<CodeGraph>(path.join(out, 'code-graph.json'))
    const member = 'symbolq:src%2Fconfig.rs#rust%3Aimpl%3AConfig%40138%3A4824#is_printing#0'
    expect(before.edges.some(e => e.kind === 'rust-impl-defines-symbol' && e.target === member)).toBe(true)
    const source = path.join(root, 'src/config.rs')
    fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replace('    pub fn is_printing', '    #[cfg(feature="optional")]\n    pub fn is_printing'))
    await runIndexCommand({ root, src: ['src'], out, incremental: true })
    const after = read<CodeGraph>(path.join(out, 'code-graph.json'))
    expect(after.edges.some(e => e.kind === 'rust-impl-defines-symbol' && e.target.endsWith('#is_printing#0'))).toBe(false)
    const fresh = nextOutput('033-mutated-full-')
    await runIndexCommand({ root, src: ['src'], out: fresh })
    expect(read<CodeGraph>(path.join(fresh, 'code-graph.json')).edges).toEqual(after.edges)
    expect(read<SymbolIndex>(path.join(out, 'symbol-index.json')).files.map(f => f.path).sort()).toEqual(projects[1].files.map(([f]) => f).filter(f => f.endsWith('.rs')).sort())
    expect(createHash('sha256').update(fs.readFileSync(path.join(corpus, 'cli/src/config.rs'))).digest('hex')).toBe('448f224f277ea02a5f1a28f9cdfa93d4227b0981811e4eddb2f63b0dd694338d')
  })

  it('records selected multi-crate roots, observed workspace and local dependency without inventing bodies', () => {
    const { graph } = snapshots.get('multi-crate-library')!
    expect(graph.nodes.filter(n => n.kind === 'rust-package').map(n => n.id)).toEqual(['rust-package:tracing-core%2FCargo.toml', 'rust-package:tracing%2FCargo.toml'])
    for (const [manifest, name, root] of [['tracing/Cargo.toml', 'tracing', 'tracing/src/lib.rs'], ['tracing-core/Cargo.toml', 'tracing_core', 'tracing-core/src/lib.rs']]) {
      const id = `rust-target:${encodeURIComponent(manifest)}#lib#${name}#${encodeURIComponent(root)}`
      expect(graph.edges).toContainEqual(expect.objectContaining({ source: id, kind: 'rust-target-root-file', target: `file:${root}` }))
    }
    const pkg = graph.nodes.find(n => n.id === 'rust-package:tracing%2FCargo.toml')!
    expect(pkg.rustMetadata).toMatchObject({ workspace: { manifest: 'Cargo.toml', status: 'UNSUPPORTED_SYNTAX' }, dependencies: expect.arrayContaining([expect.objectContaining({ name: 'tracing-core', selected: true, status: 'RESOLVED', manifest: 'tracing-core/Cargo.toml' })]) })
    expect(graph.nodes.some(n => n.id === 'rust-package:Cargo.toml')).toBe(false)
    expect(graph.nodes.some(n => n.kind === 'file' && n.path?.includes('tracing-subscriber'))).toBe(false)
    expect(graph.nodes.some(n => n.path?.endsWith('macros.rs'))).toBe(false)
  })

  it.each(projects)('has no fabricated module targets, calls, dispatch or unselected source for $dir', p => {
    const { graph, index } = snapshots.get(p.dir)!
    const files = new Set(index.files.map(f => f.path))
    expect(files).toEqual(new Set(p.files.map(([file]) => file).filter(f => f.endsWith('.rs'))))
    expect(new Set(graph.nodes.map(n => n.id)).size).toBe(graph.nodes.length)
    const ids = new Set(graph.nodes.map(n => n.id))
    expect(graph.edges.every(e => ids.has(e.source) && ids.has(e.target))).toBe(true)
    expect(graph.edges.filter(e => e.kind === 'calls')).toEqual([])
    for (const e of graph.edges.filter(e => ['rust-module-resolves-to-file', 'rust-target-root-file'].includes(e.kind))) {
      expect(files.has(e.target.slice('file:'.length))).toBe(true)
      expect(e.metadata?.conditional).not.toBe(true)
    }
    expect(graph.edges.some(e => e.target === 'file:src/cmd.rs' || e.target === 'file:src/walk.rs' || e.target.includes('tracing-subscriber'))).toBe(false)
    const missing = graph.nodes.filter(n => n.kind === 'rust-module' && n.rustMetadata?.status !== 'RESOLVED')
    expect(missing.length).toBeGreaterThan(0)
    expect(graph.edges.filter(e => e.kind === 'rust-module-resolves-to-file' && missing.some(n => n.id === e.source))).toEqual([])
  })

  it.each(projects)('preserves full semantic evidence and compatible warm no-change results for $dir', async p => {
    const snapshot = snapshots.get(p.dir)!
    const graphBytes = fs.readFileSync(path.join(snapshot.out, 'code-graph.json'))
    const warm = await runIndexCommand({ root: path.join(corpus, p.dir), src: p.roots, out: snapshot.out, incremental: true })
    expect(warm.mode).toBe('index')
    expect(fs.readFileSync(path.join(snapshot.out, 'code-graph.json'))).toEqual(graphBytes)
    const fresh = nextOutput('fresh-')
    await runIndexCommand({ root: path.join(corpus, p.dir), src: p.roots, out: fresh })
    const graph = read<CodeGraph>(path.join(fresh, 'code-graph.json'))
    expect(graph.nodes).toEqual(snapshot.graph.nodes)
    expect(graph.edges).toEqual(snapshot.graph.edges)
    expect(read<SymbolIndex>(path.join(fresh, 'symbol-index.json')).files).toEqual(snapshot.index.files)
  })

  it('does not execute target code, Cargo, build scripts or network during indexing', async () => {
    const deny = () => { throw new Error('B14 forbidden target execution/network') }
    const spies = [vi.spyOn(childProcess, 'spawn').mockImplementation(deny), vi.spyOn(childProcess, 'spawnSync').mockImplementation(deny), vi.spyOn(childProcess, 'execFileSync').mockImplementation(deny), vi.spyOn(globalThis, 'fetch').mockImplementation(deny)]
    try {
      const out = nextOutput('nonexecution-')
      await runIndexCommand({ root: path.join(corpus, 'async-service'), src: ['src'], out })
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
      const { graph } = snapshots.get('async-service')!
      expect(() => resolveFileNodeTarget(graph, 'file:../outside.rs', 20)).toThrow()
    } finally { for (const spy of spies) spy.mockRestore() }
  })

  it('keeps exact F13 method and physical impl continuation inside trusted ends', async () => {
    const root = path.resolve('tests/fixtures/v114-language/rust/F13-retrieval')
    const out = nextOutput('044-continuation-')
    await runIndexCommand({ root, src: ['src', 'tests'], out })
    const index = read<SymbolIndex>(path.join(out, 'symbol-index.json'))
    const graph = read<CodeGraph>(path.join(out, 'code-graph.json'))
    const method = 'symbolq:src%2Fimpls.rs#rust%3Aimpl%3Acrate%3A%3Aalpha%3A%3AWorker%3Atrait%3Acrate%3A%3Aalpha%3A%3ARunner%404%3A64#run#0'
    const impl = 'rust-impl:src%2Fimpls.rs#rust%3Aimpl%3Acrate%3A%3Aalpha%3A%3AWorker%3Atrait%3Acrate%3A%3Aalpha%3A%3ARunner%404%3A64#0'
    const target = resolveSymbolTarget(index, 'src/impls.rs', 'run', 2, method)
    const first = getSourceSlice({ ...target, projectRoot: root, indexDir: out, startLine: 5, endLine: 6, maxLines: 2 })
    expect(first.content).toBe('    fn run(&self) -> u8 {\n        2')
    expect(first.continuationCursor).toMatchObject({ nextStartLine: 7, symbolBoundaryKnown: true })
    const last = getSourceSlice({ ...target, projectRoot: root, indexDir: out, startLine: 7, endLine: 20, maxLines: 20 })
    expect(last.content).toBe('    }')
    expect(last.continuationCursor).toBeUndefined()
    const physical = resolveFileNodeTarget(graph, impl, 2)
    expect(physical).toMatchObject({ startLine: 4, endLine: 5, symbolEndLine: 8 })
    const middle = getSourceSlice({ ...physical, projectRoot: root, indexDir: out, startLine: 6, endLine: 7, maxLines: 2 })
    expect(middle.continuationCursor).toMatchObject({ nextStartLine: 8, symbolBoundaryKnown: true })
    const end = getSourceSlice({ ...physical, projectRoot: root, indexDir: out, startLine: 8, endLine: 20, maxLines: 20 })
    expect(end.content).toBe('}')
    expect(end.continuationCursor).toBeUndefined()
    expect(() => resolveSymbolTarget(index, 'src/impls.rs', 'run', 20)).toThrow('AMBIGUOUS_SYMBOL')
  })

  it('keeps private real-world impl methods private and unsupported module dependencies absent', () => {
    const { graph, index } = snapshots.get('async-service')!
    for (const owner of ['Listener', 'Handler']) {
      const method = graph.nodes.find(n => n.path === 'src/server.rs' && n.symbolName === 'run' && n.ownerKey?.startsWith(`rust:impl:${owner}@`))!
      expect(method.exported).toBe(false)
      expect(graph.edges.filter(e => e.kind === 'exports' && e.target === method.id)).toEqual([])
    }
    expect(index.files.some(f => f.path === 'src/cmd.rs')).toBe(false)
    expect(graph.edges.some(e => e.target === 'file:src/cmd.rs')).toBe(false)
    const multi = snapshots.get('multi-crate-library')!.graph
    expect(multi.nodes.filter(n => n.kind === 'rust-package').map(n => n.label).sort()).toEqual(['tracing', 'tracing-core'])
    expect(multi.edges.filter(e => e.kind === 'rust-target-root-file').every(e => ['file:tracing/src/lib.rs', 'file:tracing-core/src/lib.rs'].includes(e.target))).toBe(true)
  })

  it('does not turn cfg or attribute examples inside documentation into uncertain context ownership', async () => {
    const output = nextOutput('046-doc-context-')
    const root = path.join(output, 'project')
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname="docs"\nversion="0.1.0"\nedition="2021"\n')
    fs.writeFileSync(path.join(root, 'src/lib.rs'), '/// Discuss cfg without feature activation.\npub struct Worker;\nimpl Worker {\n/// #[custom] is a documentation example only.\npub fn run(&self) {}\n}\n')
    const out = path.join(output, 'index')
    await runIndexCommand({ root, src: ['src'], out })
    const graph = read<CodeGraph>(path.join(out, 'code-graph.json'))
    const method = graph.nodes.find(n => n.path === 'src/lib.rs' && n.symbolName === 'run')!
    expect(graph.edges.some(e => e.kind === 'rust-impl-defines-symbol' && e.target === method.id)).toBe(true)
    const request = path.join(output, 'request.json')
    const capsule = path.join(output, 'capsule.json')
    fs.writeFileSync(request, JSON.stringify({ schemaVersion: '1.0.0', role: 'implementation', query: 'Worker::run', focusSymbols: [method.id] }))
    childProcess.execFileSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('src/cli.ts'), 'context', '--request', request, '--index', out, '--out', capsule, '--json'], { encoding: 'utf8', windowsHide: true })
    const result = read<{ selectedOwners: { id: string }[]; roleAdequacy: { status: string } }>(capsule)
    expect(result.selectedOwners.some(o => o.id === method.id)).toBe(true)
    expect(result.roleAdequacy.status).toBe('context sufficient for implementation')
  })
})
