import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import childProcess from 'node:child_process'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { buildCodeGraph } from '../../src/graph/buildCodeGraph.js'
import { buildRustStructure } from '../../src/graph/buildRustStructure.js'
import { prepareRustParser } from '../../src/languages/rust/parser.js'
import { RustAdapter } from '../../src/languages/rust/adapter.js'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { resolveFileNodeTarget } from '../../src/lookup/resolveSourceTarget.js'
import { adaptCodeGraph } from '../../src/graph/adaptGraphArtifact.js'
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'

const task = path.resolve('.my-dev-kit-workflow/tmp/v1.14.0-b09-20261020/tests')
const fixtures = path.resolve('tests/fixtures/v114-language/rust')
const manifest = '[package]\nname="sample"\nversion="0.1.0"\nedition="2024"\n'
function project(files: Record<string,string>): string {
  fs.mkdirSync(task,{recursive:true})
  const root = fs.mkdtempSync(path.join(task,'modules-'))
  for (const [file,text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true}); fs.writeFileSync(path.join(root,file),text) }
  return root
}
function build(root: string, sourceRoots = ['src']) {
  const index = buildIndex({repoRoot:root,sourceRoots}).index
  const base = buildCodeGraph({symbolIndex:index})
  return {...buildRustStructure(base,root,index.files),index,base}
}
function module(graph: CodeGraph, modulePath: string) {
  const nodes = graph.nodes.filter(n => n.kind === 'rust-module' && n.rustMetadata?.modulePath === modulePath)
  expect(nodes).toHaveLength(1)
  return nodes[0]
}
const resolutions = (graph:CodeGraph) => graph.edges.filter(e => e.kind === 'rust-module-resolves-to-file')
const read = <T,>(root: string,file: string): T => JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))
const cli = (...args:string[]) => childProcess.execFileSync(process.execPath,['node_modules/tsx/dist/cli.mjs','src/cli.ts',...args],{cwd:process.cwd(),encoding:'utf8',windowsHide:true})

describe('B09 conservative structure in the existing graph', () => {
  beforeAll(async () => { await prepareRustParser() })
  it('projects independent exact package, target and module IDs and endpoints', () => {
    const {graph,index,base} = build(fixtures,['F02-modules/src'])
    const pkg = 'rust-package:F02-modules%2FCargo.toml'
    const target = 'rust-target:F02-modules%2FCargo.toml#lib#module_layouts#F02-modules%2Fsrc%2Flib.rs'
    const root = `rust-module:${encodeURIComponent(target)}#crate`
    expect(graph.nodes.find(n => n.id === pkg)?.kind).toBe('rust-package')
    expect(graph.nodes.find(n => n.id === target)?.rustMetadata).toMatchObject({origin:'conventional',status:'RESOLVED',targetKind:'lib'})
    expect(graph.edges).toContainEqual({id:`${target}--rust-target-root-file-->file:F02-modules/src/lib.rs`,source:target,kind:'rust-target-root-file',target:'file:F02-modules/src/lib.rs'})
    expect(graph.edges).toContainEqual({id:`${target}--rust-target-contains-module-->${root}`,source:target,kind:'rust-target-contains-module',target:root})
    expect(module(graph,'crate::outer::inner').id).toBe(`rust-module:${encodeURIComponent(target)}#crate%3A%3Aouter%3A%3Ainner`)
    expect(resolutions(graph).map(e => e.target).sort()).toEqual(['file:F02-modules/src/baz/mod.rs','file:F02-modules/src/baz/nested.rs','file:F02-modules/src/foo.rs','file:F02-modules/src/foo/bar.rs','file:F02-modules/src/path_overridden.rs'])
    const inline = module(graph,'crate::outer::inner')
    const parent = module(graph,'crate::outer')
    expect(graph.edges.some(e => e.source === parent.id && e.target === inline.id && e.kind === 'rust-module-contains-module')).toBe(true)
    expect(graph.edges.some(e => e.source === inline.id && e.target === 'file:F02-modules/src/lib.rs' && e.kind === 'rust-module-defined-in-file')).toBe(true)
    expect(graph.edges.some(e => e.source === module(graph,'crate::foo').id && e.kind === 'rust-module-defined-in-file')).toBe(false)
    const ids = new Set(graph.nodes.map(n => n.id))
    expect(ids.size).toBe(graph.nodes.length)
    expect(new Set(graph.edges.map(e => e.id)).size).toBe(graph.edges.length)
    expect(graph.edges.every(e => ids.has(e.source) && ids.has(e.target))).toBe(true)
    expect(graph.nodes.filter(n => n.kind === 'symbol')).toEqual(base.nodes.filter(n => n.kind === 'symbol'))
    expect(index.schemaVersion).toBe('3')
    expect(graph.schemaVersion).toBe('1.1.0')
    expect(build(fixtures,['F02-modules/src']).graph.nodes).toEqual(graph.nodes)
  })
  it('limits workspace roots and never creates a virtual/excluded package node', () => {
    const {graph,index} = build(fixtures,['F07-cargo-workspaces/crates/core/src'])
    expect(index.files.every(f => f.path.startsWith('F07-cargo-workspaces/crates/core/src/'))).toBe(true)
    expect(graph.nodes.filter(n => n.kind === 'rust-package').map(n => n.label).sort()).toEqual(['workspace-cli','workspace-core'])
    const rootEdges = graph.edges.filter(e => e.kind === 'rust-target-root-file')
    expect(rootEdges.map(e => e.target).sort()).toEqual(['file:F07-cargo-workspaces/crates/core/src/bin/tool.rs','file:F07-cargo-workspaces/crates/core/src/lib.rs'])
    expect(graph.nodes.some(n => n.id === 'rust-package:F07-cargo-workspaces%2FCargo.toml')).toBe(false)
    expect(graph.nodes.some(n => n.kind === 'rust-target' && n.rustMetadata?.manifest?.includes('/skip/'))).toBe(false)
  })
  it('retains missing and unselected target metadata without root edges or fabricated root modules', () => {
    const root = project({'Cargo.toml':manifest+'[[bin]]\nname="missing"\npath="absent.rs"\n[[bin]]\nname="outside-selection"\npath="other/main.rs"\n','src/lib.rs':'','other/main.rs':''})
    const {graph} = build(root)
    for (const target of graph.nodes.filter(n => n.kind === 'rust-target' && n.rustMetadata?.status !== 'RESOLVED')) expect(graph.edges.filter(e => e.source === target.id).map(e => e.kind)).toEqual([])
    expect(graph.edges.filter(e => e.kind === 'rust-target-root-file').map(e => e.target)).toEqual(['file:src/lib.rs'])
  })
  it('keeps targets sharing one physical source distinct without cloning symbols', () => {
    const root = project({'Cargo.toml':manifest+'[[bin]]\nname="tool"\npath="src/lib.rs"\n','src/lib.rs':'mod same { pub fn run() {} }'})
    const {graph,index} = build(root)
    expect(graph.nodes.filter(n => n.kind === 'rust-target')).toHaveLength(2)
    expect(graph.nodes.filter(n => n.kind === 'rust-module' && n.label === 'crate::same')).toHaveLength(2)
    expect(graph.nodes.filter(n => n.kind === 'symbol')).toHaveLength(index.files[0].symbols.length)
  })
  it('resolves nested inline descendants and path attributes in root, mod.rs and non-mod.rs contexts', () => {
    const root = project({'Cargo.toml':manifest,'src/lib.rs':'mod foo; mod baz; mod inline { #[path="custom.rs"] mod inner; }','src/foo.rs':'#[path="direct.rs"] mod direct; mod inline { #[path="custom.rs"] mod inner; }','src/direct.rs':'','src/foo/inline/custom.rs':'','src/baz/mod.rs':'mod inline { #[path="custom.rs"] mod inner; }','src/baz/inline/custom.rs':'','src/inline/custom.rs':''})
    const {graph} = build(root)
    expect(resolutions(graph).map(e => e.target).sort()).toEqual(['file:src/baz/inline/custom.rs','file:src/baz/mod.rs','file:src/direct.rs','file:src/foo.rs','file:src/foo/inline/custom.rs','file:src/inline/custom.rs'])
    expect(module(graph,'crate::foo::inline::inner').rustMetadata?.resolvedFile).toBe('src/foo/inline/custom.rs')
  })
  it('supports inline directory path overrides and nonstandard target roots', () => {
    const root = project({'Cargo.toml':manifest+'[lib]\npath="src/custom.rs"\n','src/custom.rs':'#[path="support"] mod inline { mod child; }','src/support/child.rs':''})
    const {graph} = build(root)
    expect(module(graph,'crate::inline::child').rustMetadata?.resolvedFile).toBe('src/support/child.rs')
  })
  it('retains cfg/cfg_attr observations without resolving conditional modules or inventing macro modules', () => {
    const {graph} = build(fixtures,['F06-conditional/src'])
    expect(resolutions(graph)).toEqual([])
    expect(module(graph,'crate::extra').rustMetadata?.status).toBe('CONDITIONAL')
    expect(module(graph,'crate::fallback').rustMetadata?.status).toBe('CONDITIONAL')
    expect(graph.nodes.some(n => n.kind === 'rust-module' && n.label.includes('invented'))).toBe(false)
    expect(graph.edges.filter(e => e.kind === 'rust-module-contains-module').every(e => e.metadata?.conditional === true)).toBe(true)
  })
  it.each(['#![cfg(test)]\nmod extra;','mod gated { #![cfg(test)] mod extra; }','#[cfg(test)] mod gated { mod extra; }'])('propagates inner and outer conditions: %s', source => {
    const root = project({'Cargo.toml':manifest,'src/lib.rs':source,'src/extra.rs':'','src/gated/extra.rs':''})
    const {graph} = build(root)
    expect(resolutions(graph)).toEqual([])
    expect(graph.nodes.filter(n => n.kind === 'rust-module' && n.label.endsWith('::extra')).every(n => n.rustMetadata?.status === 'CONDITIONAL')).toBe(true)
  })
  it('does not resolve a module file with an inner cfg attribute', () => {
    const root = project({'Cargo.toml':manifest,'src/lib.rs':'mod extra;','src/extra.rs':'#![cfg(feature="extra")]\npub fn run() {}'})
    const {graph} = build(root)
    expect(resolutions(graph)).toEqual([])
    expect(module(graph,'crate::extra').rustMetadata?.status).toBe('CONDITIONAL')
  })
  it('rejects competing module file candidates and gives duplicate declarations unique IDs', () => {
    const root = project({'Cargo.toml':manifest,'src/lib.rs':'mod foo; mod duplicate; mod duplicate;','src/foo.rs':'','src/foo/mod.rs':'','src/duplicate.rs':''})
    const {graph} = build(root)
    expect(resolutions(graph)).toEqual([])
    expect(module(graph,'crate::foo').rustMetadata).toMatchObject({status:'AMBIGUOUS',candidates:['src/foo.rs','src/foo/mod.rs']})
    const duplicates = graph.nodes.filter(n => n.label === 'crate::duplicate' && n.kind === 'rust-module')
    expect(duplicates).toHaveLength(2)
    expect(new Set(duplicates.map(n => n.id)).size).toBe(2)
  })
  it('disambiguates raw-identifier duplicates without resolving either declaration', () => {
    const root = project({'Cargo.toml':manifest,'src/lib.rs':'mod foo; mod r#foo;','src/foo.rs':''})
    const {graph} = build(root)
    expect(resolutions(graph)).toEqual([])
    expect(new Set(graph.nodes.map(n => n.id)).size).toBe(graph.nodes.length)
    expect(graph.nodes.filter(n => n.kind === 'rust-module' && n.label === 'crate::foo')).toHaveLength(2)
  })
  it.each(['#[path="a.rs"] #[path="b.rs"] mod item;','#[path=concat!("a", ".rs")] mod item;','#[custom::generate] mod item;','#[path="../../escape.rs"] mod item;'])('does not invent unsupported/escaping module resolution: %s', source => {
    const root = project({'Cargo.toml':manifest,'src/lib.rs':source,'src/item.rs':'','src/a.rs':'','src/b.rs':''})
    const {graph} = build(root)
    expect(resolutions(graph)).toEqual([])
    expect(module(graph,'crate::item').rustMetadata?.status).not.toBe('RESOLVED')
  })
  it('does not follow missing, excluded or unsafe symlink module targets', () => {
    const root = project({'Cargo.toml':manifest,'src/lib.rs':'mod excluded; mod missing; mod escaped;','src/excluded.rs':''})
    const outside = project({'escaped.rs':''})
    fs.symlinkSync(outside,path.join(root,'src/escaped'),'junction')
    const index = buildIndex({repoRoot:root,sourceRoots:['src'],excludePatterns:['src/excluded.rs']}).index
    const {graph} = buildRustStructure(buildCodeGraph({symbolIndex:index}),root,index.files)
    expect(resolutions(graph)).toEqual([])
    expect(graph.nodes.some(n => n.id === 'file:src/excluded.rs')).toBe(false)
  })
  it('retains source symbols while reporting malformed Cargo structure as partial', async () => {
    const root = project({'Cargo.toml':'[package','src/lib.rs':'pub fn valid() {}'})
    const result = await runIndexCommand({root,src:['src'],out:'index'})
    if (result.mode !== 'index') throw new Error('expected index')
    const graph = read<CodeGraph>(root,'index/code-graph.json')
    expect(graph.nodes.some(n => n.kind === 'symbol' && n.label === 'valid')).toBe(true)
    expect(graph.nodes.some(n => n.kind.startsWith('rust-'))).toBe(false)
    expect(result.analyzers?.find(a => a.id === 'rust-structure')?.status).toBe('partial')
  })
  it('does not execute target build/source/dependencies or invent use/impl/call edges', () => {
    const root = project({'Cargo.toml':manifest,'build.rs':'fn main() { panic!("do not execute"); }','src/lib.rs':'pub use absent::Thing; include!("generated.rs"); impl Thing { fn run() {} }'})
    const spies = ['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork'].map(name => vi.spyOn(childProcess,name as 'spawn').mockImplementation(() => { throw new Error('Target execution forbidden') }))
    try {
      const {graph,index} = build(root,['src','build.rs'])
      expect(index.graph?.fileDeps).toEqual([])
      expect(graph.nodes.some(n => n.kind === 'rust-target' && n.rustMetadata?.targetKind === 'build-script')).toBe(true)
      expect(graph.edges.some(e => /uses|reexports|impl|calls/.test(e.kind))).toBe(false)
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally { for (const spy of spies) spy.mockRestore() }
  })
  it('preserves non-Rust graph behavior without inspecting unrelated malformed Cargo', () => {
    const root = project({'Cargo.toml':'broken','src/main.ts':'export function run() {}'})
    const {graph,base,warnings} = build(root)
    expect(graph).toBe(base)
    expect(warnings).toEqual([])
  })
  it('does not discover or parse generated Cargo target output under a selected root', () => {
    const root = project({'Cargo.toml':manifest,'src/lib.rs':'','target/debug/deps/generated.rs':'x'.repeat(65537)})
    const result = build(root,['.'])
    expect(result.index.files.map(f => f.path)).toEqual(['src/lib.rs'])
  })
  it('supports generic source/view consumers using the exact declaration location', () => {
    const {graph} = build(fixtures,['F02-modules/src'])
    const node = module(graph,'crate::outer')
    expect(resolveFileNodeTarget(graph,node.id,160)).toMatchObject({filePath:'F02-modules/src/lib.rs',startLine:5,endLine:7})
    expect(adaptCodeGraph(graph).nodes.some(n => n.id === node.id)).toBe(true)
  })
  it('keeps current CLI search, lookup, slice and source usable for structure and B08 symbols', async () => {
    const root = project({'Cargo.toml':manifest,'src/lib.rs':'mod child;\npub fn run() {}','src/child.rs':'pub fn child() {}'})
    await runIndexCommand({root,src:['src'],out:'index'})
    const out = path.join(root,'index')
    const graph = read<CodeGraph>(out,'code-graph.json')
    const node = module(graph,'crate::child')
    const search = JSON.parse(cli('search','--index',out,'--query','crate child','--limit','100','--json'))
    expect(search.results.some((r:{id:string}) => r.id === node.id)).toBe(true)
    expect(cli('lookup','--index',out,'--node',node.id,'--json')).toContain(node.id)
    expect(cli('slice','--index',out,'--node',node.id,'--depth','1','--json')).toContain('rust-module-resolves-to-file')
    expect(cli('source','--index',out,'--node',node.id,'--format','numbered')).toContain('pub fn child() {}')
    expect(cli('source','--index',out,'--file','src/lib.rs','--start','1','--end','2','--format','numbered')).toContain('mod child;')
    expect(cli('source','--index',out,'--node','symbol:src/lib.rs#run','--format','numbered')).toContain('pub fn run() {}')
  })
  it('reconstructs all structure during partial reuse, invalidates Cargo-only changes and removes stale edges', async () => {
    const root = project({'Cargo.toml':manifest,'src/lib.rs':'mod old;','src/old.rs':'pub fn old() {}','src/new.rs':'pub fn new() {}'})
    await runIndexCommand({root,src:['src'],out:'incremental',incremental:true})
    const before = read<CodeGraph>(root,'incremental/code-graph.json')
    const factsBefore = read<SymbolIndex>(root,'incremental/symbol-index.json').files.find(f => f.path === 'src/old.rs')!.rustSyntaxFacts
    fs.writeFileSync(path.join(root,'src/lib.rs'),'mod new;')
    const spy = vi.spyOn(RustAdapter.prototype,'extractFromSource')
    let partial
    try { partial = await runIndexCommand({root,src:['src'],out:'incremental',incremental:true}); expect(spy.mock.calls.map(c => c[0])).toEqual(['src/lib.rs']) } finally { spy.mockRestore() }
    if (partial.mode !== 'index') throw new Error('expected index')
    expect(partial.cache?.mode).toMatch(/^incremental-partial/)
    const after = read<CodeGraph>(root,'incremental/code-graph.json')
    expect(resolutions(before).map(e => e.target)).toEqual(['file:src/old.rs'])
    expect(resolutions(after).map(e => e.target)).toEqual(['file:src/new.rs'])
    expect(read<SymbolIndex>(root,'incremental/symbol-index.json').files.find(f => f.path === 'src/old.rs')!.rustSyntaxFacts).toEqual(factsBefore)
    await runIndexCommand({root,src:['src'],out:'full'})
    const full = read<CodeGraph>(root,'full/code-graph.json')
    expect(after.nodes).toEqual(full.nodes); expect(after.edges).toEqual(full.edges)
    fs.writeFileSync(path.join(root,'Cargo.toml'),manifest.replace('sample','renamed'))
    const config = await runIndexCommand({root,src:['src'],out:'incremental',incremental:true})
    if (config.mode !== 'index') throw new Error('expected index')
    expect(config.cache?.mode).toBe('incremental-full-config-changed')
    expect(read<CodeGraph>(root,'incremental/code-graph.json').nodes.some(n => n.kind === 'rust-package' && n.label === 'sample')).toBe(false)
    const noChange = await runIndexCommand({root,src:['src'],out:'incremental',incremental:true})
    if (noChange.mode !== 'index') throw new Error('expected index')
    expect(noChange.cache?.mode).toBe('incremental-no-change')
  })
})
