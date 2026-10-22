import { beforeAll, describe, expect, it, vi } from 'vitest'
import { prepareRustParser } from '../../src/languages/rust/parser.js'
import { RustAdapter } from '../../src/languages/rust/adapter.js'
import { buildRustStructure } from '../../src/graph/buildRustStructure.js'
import { buildCodeGraph } from '../../src/graph/buildCodeGraph.js'
import { buildIndex } from '../../src/symbol-index/builder.js'
import * as path from 'node:path'
import * as fs from 'node:fs'
import childProcess from 'node:child_process'
import { buildRustRelationships } from '../../src/graph/buildRustRelationships.js'
import { resolveRustUses, rustEvidenceStatus } from '../../src/languages/rust/useResolver.js'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'
import { resolveFileNodeTarget } from '../../src/lookup/resolveSourceTarget.js'
import { adaptCodeGraph } from '../../src/graph/adaptGraphArtifact.js'
import { computeConfigFingerprint } from '../../src/indexing/cacheMetadata.js'
import { RUST_PARSER_REVISION } from '../../src/languages/rust/parser.js'
import { createHash } from 'node:crypto'
import { allocateV114OutputDir } from '../helpers/v114OutputRoot.js'

const task = allocateV114OutputDir('rust-relationships-v114')
const fixture = path.resolve('tests/fixtures/v114-language/rust/F03-import-trees')
const cargo = '[package]\nname="sample"\nversion="0.1.0"\nedition="2021"\n'
function project(files: Record<string,string>) {
  fs.mkdirSync(task, { recursive:true })
  const root = fs.mkdtempSync(path.join(task,'relationships-'))
  for (const [file, source] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root,file)), { recursive:true }); fs.writeFileSync(path.join(root,file),source) }
  return root
}
function build(root: string, sourceRoots = ['src']) {
  const index = buildIndex({repoRoot:root,sourceRoots}).index
  const base = buildCodeGraph({symbolIndex:index})
  const structure = buildRustStructure(base,root,index.files)
  return { ...buildRustRelationships(structure.graph,index.files,structure.packages,structure.modules), index, structure, base }
}
const mid = (module: string, manifest='Cargo.toml', name='sample', root='src/lib.rs') => `rust-module:${encodeURIComponent(`rust-target:${encodeURIComponent(manifest)}#lib#${name}#${encodeURIComponent(root)}`)}#${encodeURIComponent(module)}`
const claims = (graph: CodeGraph) => graph.edges.filter(e => ['rust-module-uses-module','rust-module-reexports-symbol','rust-impl-for-type','rust-impl-of-trait'].includes(e.kind))
const read = (root: string, file: string) => JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))

describe('B14 Rust documentation evidence', () => {
  beforeAll(async () => { await prepareRustParser() })
  const docs = ['/// owner', '//! crate docs', '/// owner\n///\n    /// details\n', '//! crate\n//! details\n', '/** owner */', '/*! crate docs */', '/** one */\n/** two */', '/// one\n/** two */', '/** one */\n/// two\n', '#[doc = "owner"]', '#![doc = "crate docs"]']
  it.each(docs)('treats parser-grounded documentation as neutral: %s', doc => {
    expect(rustEvidenceStatus({ status: 'syntax-only', endLine: 4, attributes: [doc] })).toBe('RESOLVED')
    expect(rustEvidenceStatus({ status: 'syntax-only', endLine: 4, attributes: [doc, '#[cfg(feature="extra")]'] })).toBe('CONDITIONAL')
    expect(rustEvidenceStatus({ status: 'syntax-only', endLine: 4, attributes: [doc, '#[cfg_attr(feature="extra", custom)]'] })).toBe('CONDITIONAL')
    expect(rustEvidenceStatus({ status: 'syntax-only', endLine: 4, attributes: [doc, '#[custom]'] })).toBe('UNSUPPORTED_SYNTAX')
    expect(rustEvidenceStatus({ status: 'parser-error', attributes: [doc, '#[doc ='] })).toBe('MALFORMED')
  })
  it.each(['//// ordinary', '// ordinary', '/*** ordinary */', '/**/', '/***/', '/** unfinished', '/// bad\rtext', '/// bad\r', '/// doc\npub fn injected() {}', '/// doc\n//// ordinary', '//! doc\n// ordinary', '#[doc::custom]', '#[doc :: custom]'])('does not accept a non-doc or malformed lookalike: %s', text => {
    expect(rustEvidenceStatus({ status: 'syntax-only', endLine: 4, attributes: [text] })).not.toBe('RESOLVED')
  })
  it('keeps the most restrictive non-documentation condition and preserves malformed precedence', () => {
    expect(rustEvidenceStatus({ status: 'syntax-only', endLine: 4, attributes: ['/// docs', '#[custom]', '#[cfg(test)]'] })).toBe('UNSUPPORTED_SYNTAX')
    expect(rustEvidenceStatus({ status: 'parser-error', attributes: ['/// docs', '#[cfg(test)]'] })).toBe('MALFORMED')
  })
  it.each(['//! crate docs\n', '/*! crate docs */\n', '#![doc = "crate docs"]\n'])('keeps real inner documentation neutral to nominal ownership: %s', doc => {
    const temp = allocateV114OutputDir('rust-relationships-v114')
    fs.mkdirSync(temp, { recursive: true })
    let ordinal = 1
    while (fs.existsSync(path.join(temp, `044-inner-${ordinal}`))) ordinal++
    const root = path.join(temp, `044-inner-${ordinal}`)
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'Cargo.toml'), cargo)
    fs.writeFileSync(path.join(root, 'src/lib.rs'), `${doc}pub struct Worker;\nimpl Worker { pub fn run(&self) {} }\n`)
    const { graph } = build(root)
    expect(graph.edges.filter(e => e.kind === 'rust-impl-for-type').map(e => e.target)).toEqual(['symbol:src/lib.rs#Worker'])
    expect(graph.edges.filter(e => e.kind === 'rust-impl-defines-symbol')).toHaveLength(1)
  })
  it.each(['#[cfg(feature="optional")]', '#[custom]', '#[doc =]'])('does not promote a documented conditional, unknown or malformed nominal type: %s', attribute => {
    const temp = allocateV114OutputDir('rust-relationships-v114')
    fs.mkdirSync(temp, { recursive: true })
    let ordinal = 1
    while (fs.existsSync(path.join(temp, `044-nominal-${ordinal}`))) ordinal++
    const root = path.join(temp, `044-nominal-${ordinal}`)
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'Cargo.toml'), cargo)
    fs.writeFileSync(path.join(root, 'src/lib.rs'), `/// nominal docs\n${attribute}\npub struct Worker;\nimpl Worker { pub fn run(&self) {} }\n`)
    const { graph } = build(root)
    expect(graph.edges.filter(e => e.kind === 'rust-impl-for-type')).toEqual([])
    expect(graph.edges.some(e => e.kind === 'rust-module-defines-symbol' && e.target === 'symbol:src/lib.rs#Worker')).toBe(false)
  })
  it.each(['/// docs\n', '/// docs\n///\n/// More cfg and #[custom] examples.\n', '/** docs */\n/** more docs */\n', '/// docs\n/** more docs */\n', '/** docs */\n/// more docs\n', '/** docs with /* nested */ text */\n', '#[doc = "docs"]\n'])('preserves actual documented type/impl/member relationships: %s', doc => {
    const temp = allocateV114OutputDir('rust-relationships-v114')
    fs.mkdirSync(temp, { recursive: true })
    const root = fs.mkdtempSync(path.join(temp, '031-doc-'))
    const source = `${doc}pub struct Worker;\n${doc}impl Worker {\n${doc}pub fn run(&self) {}\n}\n${doc}pub struct Other;\nimpl Other {\n${doc}pub fn run(&self) {}\n}\n`
    fs.mkdirSync(path.join(root, 'src'))
    fs.writeFileSync(path.join(root, 'Cargo.toml'), cargo)
    fs.writeFileSync(path.join(root, 'src/lib.rs'), source)
    const { graph, index } = build(root)
    const members = graph.edges.filter(e => e.kind === 'rust-impl-defines-symbol')
    expect(members).toHaveLength(2)
    expect(new Set(members.map(e => e.target)).size).toBe(2)
    expect(graph.edges.filter(e => e.kind === 'rust-impl-for-type').map(e => e.target).sort()).toEqual(['symbol:src/lib.rs#Other', 'symbol:src/lib.rs#Worker'])
    expect(index.files[0].symbols.filter(s => s.name === 'run').every(s => s.declarationMetadata?.rust?.attributes?.some(a => a.includes('docs')))).toBe(true)
    expect(graph.edges.filter(e => e.kind === 'calls')).toEqual([])
  })
  it.each(['#[cfg(feature="optional")]', '#[custom]'])('documentation cannot neutralize a restrictive method attribute: %s', attribute => {
    const temp = allocateV114OutputDir('rust-relationships-v114')
    fs.mkdirSync(temp, { recursive: true })
    const root = fs.mkdtempSync(path.join(temp, '031-negative-'))
    fs.mkdirSync(path.join(root, 'src'))
    fs.writeFileSync(path.join(root, 'Cargo.toml'), cargo)
    fs.writeFileSync(path.join(root, 'src/lib.rs'), `/// owner\npub struct Worker;\nimpl Worker {\n/// docs\n${attribute}\npub fn run(&self) {}\n}\n`)
    const { graph } = build(root)
    expect(graph.edges.filter(e => e.kind === 'rust-impl-defines-symbol')).toEqual([])
    expect(graph.edges.filter(e => e.kind === 'rust-impl-for-type').map(e => e.target)).toEqual(['symbol:src/lib.rs#Worker'])
  })
})

describe('B10 Rust relationship producer contracts', () => {
  beforeAll(async () => { await prepareRustParser() })
  it('exposes current B09 contexts to the shared relationship projector', () => {
    const root = path.resolve('tests/fixtures/v114-language/rust')
    const index = buildIndex({ repoRoot: root, sourceRoots: ['F02-modules/src'] }).index
    const result = buildRustStructure(buildCodeGraph({ symbolIndex: index }), root, index.files)
    expect(result).toHaveProperty('packages')
    expect(result).toHaveProperty('modules')
  })
  it('retains exact restricted visibility, leaf positions and impl lexical parent', () => {
    const source = 'mod m { pub(crate) use crate::a::{Thing as Local, nested::{self as n, helper}}; impl Thing {} }'
    const facts = new RustAdapter().extractFromSource('src/lib.rs', source).rustSyntaxFacts!
    const useFact = facts.find(f => f.kind === 'use')!
    expect(useFact).toMatchObject({ visibility: 'pub(crate)', sourceIndex: 8 })
    expect(useFact).toHaveProperty('useLeaves', [
      { path: 'crate::a::Thing', alias: 'Local', line: 1, sourceIndex: 34, glob: false },
      { path: 'crate::a::nested', alias: 'n', line: 1, sourceIndex: 59, glob: false },
      { path: 'crate::a::nested::helper', line: 1, sourceIndex: 70, glob: false },
    ])
    expect(facts.find(f => f.kind === 'impl')).toMatchObject({ parentOwnerKey: 'rust:mod_item:m@1:0', sourceIndex: 80 })
  })
})

describe('B10 independent Rust graph oracles', () => {
  beforeAll(async () => { await prepareRustParser() })
  it('projects exact physical impl identities and associated members without trait-member joins', () => {
    const {graph,index,structure,base} = build(fixture)
    const id = 'rust-impl:src%2Fimpls.rs#rust%3Aimpl%3AThing%3Cu8%3E%402%3A34#0'
    expect(graph.nodes.find(n=>n.id===id)).toMatchObject({kind:'rust-impl',path:'src/impls.rs',line:2,rustMetadata:{sourceIndex:34,endLine:5,typePath:'Thing<u8>',implementation:'inherent',status:'RESOLVED'}})
    const method = 'symbolq:src%2Fimpls.rs#rust%3Aimpl%3AThing%3Cu8%3E%402%3A34#run#0'
    expect(graph.edges.find(e=>e.source===id&&e.kind==='rust-impl-defines-symbol'&&e.target===method)?.id).toBe(`${id}--rust-impl-defines-symbol-->${method}`)
    expect(graph.edges.filter(e=>e.source===id&&e.kind==='rust-impl-defines-symbol').map(e=>e.target).sort()).toEqual([
      'symbolq:src%2Fimpls.rs#rust%3Aimpl%3AThing%3Cu8%3E%402%3A34#VALUE#0', method,
    ].sort())
    expect(graph.edges.filter(e=>e.kind==='rust-impl-defines-symbol').every(e=>!e.target.includes('trait_item'))).toBe(true)
    expect(graph.edges.filter(e=>e.kind==='rust-impl-defines-symbol'&&e.target.endsWith('#Output#0'))).toHaveLength(1)
    expect(graph.nodes.filter(n=>n.kind==='rust-impl')).toHaveLength(5)
    expect(graph.edges.filter(e=>e.kind==='rust-impl-for-type').map(e=>e.target)).toEqual(Array(4).fill('symbol:src/alpha.rs#Thing'))
    expect(graph.edges.filter(e=>e.kind==='rust-impl-of-trait').map(e=>e.target)).toEqual(['symbol:src/alpha.rs#Trait'])
    expect(graph.nodes.filter(n=>n.kind==='symbol')).toEqual(base.nodes.filter(n=>n.kind==='symbol'))
    expect(graph.nodes.filter(n=>['rust-package','rust-target','rust-module'].includes(n.kind))).toEqual(structure.graph.nodes.filter(n=>['rust-package','rust-target','rust-module'].includes(n.kind)))
    expect(graph.edges.filter(e=>['rust-package-has-target','rust-target-root-file','rust-target-contains-module','rust-module-contains-module','rust-module-defined-in-file','rust-module-resolves-to-file'].includes(e.kind))).toEqual(structure.graph.edges.filter(e=>e.kind.startsWith('rust-')))
    expect(index.schemaVersion).toBe('3'); expect(graph.schemaVersion).toBe('1.1.0')
  })
  it('owns only direct declarations and preserves module context and physical symbol identity', () => {
    const {graph}=build(fixture)
    const alpha=mid('crate::alpha','Cargo.toml','import_trees')
    const owned=graph.edges.filter(e=>e.kind==='rust-module-defines-symbol'&&e.source===alpha).map(e=>e.target).sort()
    expect(owned).toEqual(['nested','Thing','Trait','Choice','Bits','Alias','Private'].map(n=>`symbol:src/alpha.rs#${n}`).sort())
    expect(owned.some(id=>id.endsWith('#value#0')||id.endsWith('#run#0')||id.endsWith('#One#0'))).toBe(false)
    expect(graph.edges.find(e=>e.kind==='rust-module-defines-symbol'&&e.target==='symbol:src/alpha/nested.rs#helper')?.source).toBe(mid('crate::alpha::nested','Cargo.toml','import_trees'))
    const ids=new Set(graph.nodes.map(n=>n.id));expect(ids.size).toBe(graph.nodes.length)
    expect(new Set(graph.edges.map(e=>e.id)).size).toBe(graph.edges.length)
    expect(graph.edges.every(e=>ids.has(e.source)&&ids.has(e.target))).toBe(true)
    expect(build(fixture).graph.nodes).toEqual(graph.nodes)
  })
  it('flattens groups, nested self aliases, qualifiers and restricted reexports with exact targets', () => {
    const {graph}=build(fixture)
    const reexports=graph.edges.filter(e=>e.kind==='rust-module-reexports-symbol')
    expect(reexports.map(e=>[e.metadata?.alias,e.metadata?.visibility,e.target]).sort()).toEqual([
      ['CrateTrait','pub(crate)','symbol:src/alpha.rs#Trait'],['ParentThing','pub(super)','symbol:src/alpha.rs#Thing'],
      ['PublicThing','pub','symbol:src/alpha.rs#Thing'],['ScopedTrait','pub(in crate::beta)','symbol:src/alpha.rs#Trait'],
    ].sort())
    const helper=claims(graph).find(e=>e.metadata?.importedPath==='crate::alpha::nested::helper')!
    expect(helper).toMatchObject({source:mid('crate','Cargo.toml','import_trees'),target:mid('crate::alpha::nested','Cargo.toml','import_trees'),metadata:{line:6,sourceIndex:151,resolvedTargetSymbolId:'symbol:src/alpha/nested.rs#helper'}})
    expect(claims(graph).some(e=>e.metadata?.alias==='nested_alias'&&e.metadata?.resolvedTargetSymbolId==='')).toBe(true)
    for(const importedPath of ['self::alpha','super::Thing','super::super::beta','super::super::alpha::nested']) expect(claims(graph).some(e=>e.metadata?.importedPath===importedPath)).toBe(true)
    const glob=claims(graph).filter(e=>e.metadata?.glob===true)
    expect(glob).toHaveLength(1); expect(glob[0].target).toBe(mid('crate::alpha','Cargo.toml','import_trees'))
    expect(glob[0].metadata?.resolvedTargetSymbolId).toBe('')
    for(const path of ['crate::missing::Absent','super::missing_parent','crate::dupe::Clash','std::collections::HashMap']) expect(claims(graph).some(e=>e.metadata?.importedPath===path)).toBe(false)
    expect(claims(graph).some(e=>e.metadata?.alias==='Conditional'||e.metadata?.line===15)).toBe(false)
  })
  it('keeps repeated imports separate, canonical single edges and deterministic evidence', () => {
    const root=project({'Cargo.toml':cargo,'src/lib.rs':'pub mod a { pub struct S; }\nuse crate::a::S as First;\nuse crate::a::S as Second;\npub use crate::a::S as Export;\n'})
    const {graph}=build(root)
    const uses=graph.edges.filter(e=>e.kind==='rust-module-uses-module')
    expect(uses).toHaveLength(3)
    expect(uses.map(e=>e.metadata?.alias).sort()).toEqual(['Export','First','Second'])
    expect(uses.every(e=>e.id.includes('#src%2Flib.rs:'))).toBe(true)
    const ex=graph.edges.find(e=>e.kind==='rust-module-reexports-symbol')!
    expect(ex.id).toBe(`${mid('crate')}--rust-module-reexports-symbol-->symbolq:src%2Flib.rs#rust%3Amod_item%3Aa%401%3A0#S#0`)
    expect(build(root).graph.edges).toEqual(graph.edges)
  })
  it('keeps grouped wildcard prefixes and sibling leaves without enumerating members', () => {
    const {graph}=build(project({'Cargo.toml':cargo,'src/lib.rs':'pub mod a { pub struct S; } use crate::a::{self as A, *};'}))
    const uses=graph.edges.filter(e=>e.kind==='rust-module-uses-module')
    expect(uses).toHaveLength(2)
    expect(uses.map(e=>e.target)).toEqual([mid('crate::a'),mid('crate::a')])
    expect(uses.filter(e=>e.metadata?.glob===true)).toHaveLength(1)
    expect(uses.every(e=>e.metadata?.resolvedTargetSymbolId==='')).toBe(true)
    expect(graph.edges.filter(e=>e.kind==='rust-module-reexports-symbol')).toEqual([])
  })
  it('resolves bounded exact alias chains independent of import order', () => {
    const root=project({'Cargo.toml':cargo,'src/lib.rs':'pub mod a { pub struct S; } mod b { use A::S; use crate::a as A; use self::A as B; use B::S as T; impl T {} }'})
    const {graph}=build(root)
    expect(graph.edges.filter(e=>e.kind==='rust-impl-for-type').map(e=>e.target)).toEqual(['symbolq:src%2Flib.rs#rust%3Amod_item%3Aa%401%3A0#S#0'])
    expect(claims(graph).filter(e=>e.metadata?.importedPath==='B::S')).toHaveLength(1)
  })
  it('uses F04 exact inherited physical associated identities without cloning trait methods', () => {
    const root=project({'Cargo.toml':cargo,'src/lib.rs':fs.readFileSync(path.resolve('tests/fixtures/v114-language/rust/F04-traits-impls/src/lib.rs'),'utf8')})
    const {graph,index}=build(root)
    expect(index.files[0].symbols.filter(s=>s.name==='run').map(s=>s.nodeId)).toEqual([
      'symbolq:src%2Flib.rs#rust%3Atrait_item%3ARunner%401%3A0#run#0',
      'symbolq:src%2Flib.rs#rust%3Aimpl%3AWorker%408%3A142#run#0',
      'symbolq:src%2Flib.rs#rust%3Aimpl%3AWorker%3Atrait%3ARunner%4013%3A265#run#0',
      'symbolq:src%2Flib.rs#rust%3Aimpl%3AWorker%4018%3A366#run#0',
      'symbolq:src%2Flib.rs#rust%3Amod_item%3Ainner%4019%3A403%2Fimpl%3Asuper%3A%3AWorker%4019%3A415#run#0',
    ])
    expect(graph.edges.filter(e=>e.kind==='rust-impl-defines-symbol'&&e.target.includes('trait_item'))).toEqual([])
  })
  it('projects one physical impl across multiple selected targets', () => {
    const root=project({'Cargo.toml':cargo+'[[bin]]\nname="tool"\npath="src/lib.rs"\n','src/lib.rs':'struct S; impl S { fn f() {} }'})
    const {graph}=build(root)
    expect(graph.nodes.filter(n=>n.kind==='rust-impl')).toHaveLength(1)
    expect(graph.edges.filter(e=>e.kind==='rust-impl-for-type')).toHaveLength(1)
    expect(graph.edges.filter(e=>e.kind==='rust-module-defines-symbol')).toHaveLength(2)
  })
  it('keeps conflicting module contexts ambiguous even when their physical symbol ID is equal', () => {
    const root=project({'Cargo.toml':cargo,'src/lib.rs':'#[path="shared.rs"] mod a; #[path="shared.rs"] mod b; use crate::a::S as T; use crate::b::S as T; use T as U; impl T {}','src/shared.rs':'pub struct S;'})
    const {graph}=build(root)
    expect(graph.nodes.filter(n=>n.id==='symbol:src/shared.rs#S')).toHaveLength(1)
    expect(graph.edges.filter(e=>e.kind==='rust-module-defines-symbol'&&e.target==='symbol:src/shared.rs#S')).toHaveLength(2)
    expect(claims(graph)).toEqual([])
  })
  it.each(['2015','2018','2021','2024'])('supports established local use ownership in edition %s', edition => {
    const root=project({'Cargo.toml':cargo.replace('2021',edition),'src/lib.rs':'pub mod a { pub struct S; } mod b { use crate::a::S; } use a::S as RootS;'})
    const {graph}=build(root)
    expect(graph.edges.filter(e=>e.kind==='rust-module-uses-module')).toHaveLength(2)
  })
  it.each([['2015',true],['2018',false],['2021',false],['2024',false]] as const)('distinguishes edition %s bare use roots', (edition,resolved) => {
    const root=project({'Cargo.toml':cargo.replace('2021',edition),'src/lib.rs':'pub mod a { pub struct S; } mod b { use a::S; }'})
    expect(build(root).graph.edges.some(e=>e.kind==='rust-module-uses-module')).toBe(resolved)
  })
})

describe('B10 conservative negatives and dependency provenance', () => {
  beforeAll(async () => { await prepareRustParser() })
  it.each([
    ['missing module','use crate::missing::S;'],
    ['invalid parent','use super::absent::S;'],
    ['external prelude','use std::collections::HashMap;'],
    ['global external','pub mod a { pub struct S; } use ::a::S;'],
    ['glob members','pub mod a { pub struct S; } use crate::a::*; impl S {}'],
    ['cyclic aliases','use B as A; use A as B; impl A {}'],
    ['cyclic reexports','pub use self::B as A; pub use self::A as B;'],
    ['competing aliases','pub mod a { pub struct S; } pub mod b { pub struct S; } use crate::a::S as T; use crate::b::S as T; impl T {}'],
    ['cfg import','pub mod a { pub struct S; } #[cfg(test)] use crate::a::S; impl S {}'],
    ['cfg_attr import','pub mod a { pub struct S; } #[cfg_attr(test,allow(dead_code))] use crate::a::S; impl S {}'],
    ['conditional ancestor','#[cfg(test)] mod a { pub struct S; impl S {} use self::S; } use crate::a::S;'],
    ['inner condition','mod a { #![cfg(test)] pub struct S; impl S {} } use crate::a::S;'],
    ['macro generated','macro_rules! make { () => {pub struct S;} } make!(); use crate::S; impl S {}'],
    ['include generated','include!("generated.rs"); use crate::S; impl S {}'],
    ['block local','pub mod a { pub struct S; } fn f() { use crate::a::S; } impl S {}'],
    ['private sibling','mod a { struct S; } mod b { pub use crate::a::S; }'],
    ['private reexport','struct S; pub use self::S as Public;'],
    ['negative impl','struct S; trait T {} impl !T for S {}'],
    ['generic parameter','struct T; impl<T> T {}'],
    ['blanket generic','trait Local {} impl<T> Local for T {}'],
    ['external impl','impl std::string::String {}'],
    ['trait object spelling','trait Trait {} struct dynTrait; impl dyn Trait {}'],
    ['generic associated prefix','pub mod a { pub struct S; } impl a<u8>::S {}'],
    ['Unicode generic shadowing','struct Δ; impl<Δ> Δ {}'],
    ['raw generic declaration','struct T; impl<r#T> T {}'],
    ['raw generic target','struct T; impl<T> r#T {}'],
    ['spaced generic target','struct T; impl<T> T <u8> {}'],
    ['alias impl','struct S; type Alias=S; impl Alias {}'],
    ['same name elsewhere','pub mod a { pub struct S; pub trait T {} } mod b { impl T for S {} }'],
    ['associated import','struct S; impl S { fn method() {} } use crate::S::method;'],
    ['namespace conflict','struct S {} const S:u8=1; use crate::S;'],
    ['type namespace conflict','struct S; trait S {} impl S {}'],
    ['duplicate modules','mod a {pub struct S;} mod a {pub struct S;} use crate::a::S;'],
    ['malformed use','pub mod a { pub struct S; } use crate::a::{S as ;'],
    ['macro attribute','#[generate] pub struct S; impl S {}'],
  ])('never fabricates %s relationships', (label,source) => {
    const {graph}=build(project({'Cargo.toml':cargo,'src/lib.rs':source}))
    const edges=claims(graph)
    // Glob prefixes and the two exact competing observations remain observed.
    if(label==='glob members') {
      expect(edges.map(e=>e.kind)).toEqual(['rust-module-uses-module'])
      expect(edges[0].metadata?.glob).toBe(true)
    } else if(label==='associated import') {
      expect(edges.map(e=>e.kind)).toEqual(['rust-impl-for-type'])
    } else expect(edges).toEqual([])
    expect(graph.edges.filter(e=>e.kind==='calls')).toEqual([])
  })
  it('suppresses unselected and unsafe module sources and preserves F06 conditional evidence', () => {
    const root=project({'Cargo.toml':cargo,'src/lib.rs':'pub mod a; use crate::a::S; #[path="../../outside.rs"] mod escape; use crate::escape::S;','src/a.rs':'pub struct S;'})
    expect(claims(build(root,['src/lib.rs']).graph)).toEqual([])
    const inherited=build(path.resolve('tests/fixtures/v114-language/rust'),['F06-conditional/src'])
    expect(claims(inherited.graph)).toEqual([])
  })
  it.each(['dependencies','dev-dependencies','build-dependencies'])('requires exact dependency class for %s', section => {
    const root=project({'Cargo.toml':'[workspace]\nmembers=["a","b"]\n','a/Cargo.toml':cargo+`[${section}]\nrenamed={path="../b",package="dep"}\n`,'a/src/lib.rs':'use renamed::S;','b/Cargo.toml':cargo.replace('sample','dep'),'b/src/lib.rs':'pub struct S;'})
    const {graph}=build(root,['a/src','b/src'])
    const edges=graph.edges.filter(e=>e.kind==='rust-module-uses-module')
    if(section==='dependencies') {
      expect(edges).toHaveLength(1)
      expect(edges[0]).toMatchObject({source:mid('crate','a/Cargo.toml','sample','a/src/lib.rs'),target:mid('crate','b/Cargo.toml','dep','b/src/lib.rs'),metadata:{resolvedTargetSymbolId:'symbol:b/src/lib.rs#S',importedPath:'renamed::S'}})
    } else expect(edges).toEqual([])
  })
  it('does not force a bare local module over an unverified external namespace competitor', () => {
    const root=project({'Cargo.toml':cargo+'[dependencies]\na="1"\n','src/lib.rs':'pub mod a { pub struct S; } use a::S;'})
    expect(claims(build(root).graph)).toEqual([])
  })
  it('does not expose normal dependencies to a build-script target', () => {
    const root=project({'Cargo.toml':'[workspace]\nmembers=["a","b"]\n','a/Cargo.toml':cargo+'[dependencies]\nrenamed={path="../b",package="dep"}\n','a/src/lib.rs':'','a/build.rs':'use renamed::S; fn main() {}','b/Cargo.toml':cargo.replace('sample','dep'),'b/src/lib.rs':'pub struct S;'})
    expect(claims(build(root,['a/src','a/build.rs','b/src']).graph)).toEqual([])
  })
  it.each(['unselected','private','conditional','optional','duplicate','transitive','edition2015'])('rejects %s cross-crate evidence', mode => {
    const conditional=mode==='conditional'?'target.\'cfg(unix)\'.dependencies':'dependencies'
    const root=project({'Cargo.toml':'[workspace]\nmembers=["a","b","c"]\n','a/Cargo.toml':(mode==='edition2015'?cargo.replace('2021','2015'):cargo)+`[${conditional}]\n${mode==='transitive'?'other':'renamed'}={path="../b",package="dep"${mode==='optional'?',optional=true':''}}\n`+(mode==='duplicate'?'[dev-dependencies]\nrenamed={path="../c",package="dep"}\n':''),'a/src/lib.rs':'use renamed::S;','b/Cargo.toml':cargo.replace('sample','dep')+'[dependencies]\nrenamed={path="../c",package="dep"}\n','b/src/lib.rs':mode==='private'?'struct S;':'pub struct S;','c/Cargo.toml':cargo.replace('sample','dep'),'c/src/lib.rs':'pub struct S;'})
    const {graph}=build(root,mode==='unselected'?['a/src']:['a/src','b/src','c/src'])
    expect(claims(graph)).toEqual([])
  })
  it('does not execute source, macros, Cargo, build scripts or cross-language matching', () => {
    const root=project({'Cargo.toml':cargo,'build.rs':'fn main() { panic!("never"); }','src/lib.rs':'extern "C" { fn foreign(); } macro_rules! m { () => {pub struct S;} } m!(); use crate::S; impl S {}','src/helper.ts':'export function foreign() {}'})
    const spies=['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork'].map(name=>vi.spyOn(childProcess,name as 'spawn').mockImplementation(()=>{throw Error('Target execution forbidden')}))
    try { expect(claims(build(root).graph)).toEqual([]); for(const spy of spies)expect(spy).not.toHaveBeenCalled() } finally { spies.forEach(s=>s.mockRestore()) }
  })
  it('leaves non-Rust graph bytes unchanged', () => {
    const result=build(project({'src/main.ts':'export class Worker { run() {} }'}))
    expect(result.graph).toBe(result.structure.graph)
    expect(result.graph).toEqual(result.base)
  })
  it.each(['enum E { One } impl E {}','union U { value: u8 } impl U {}'])('supports selected nominal enum/union targets: %s', source => {
    const {graph}=build(project({'Cargo.toml':cargo,'src/lib.rs':source}))
    expect(graph.edges.filter(e=>e.kind==='rust-impl-for-type').map(e=>e.target)).toEqual([source.startsWith('enum')?'symbol:src/lib.rs#E':'symbol:src/lib.rs#U'])
  })
  it('keeps an impl physical without Cargo or resolved type and rejects untrusted physical paths', () => {
    const {graph,index}=build(project({'src/lib.rs':'impl Unknown { fn f() {} }'}))
    expect(graph.nodes.filter(n=>n.kind==='rust-impl')).toHaveLength(1)
    expect(claims(graph)).toEqual([])
    const unsafe=structuredClone(index.files)
    unsafe[0].path='../escape.rs'
    const result=buildRustRelationships(buildCodeGraph({symbolIndex:index}),unsafe,[],[])
    expect(result.graph.nodes.filter(n=>n.kind==='rust-impl')).toEqual([])
  })
})

describe('B10 generic consumers, complete reconstruction and cache', () => {
  beforeAll(async () => { await prepareRustParser() })
  it('uses generic source locations for an exact physical impl boundary', () => {
    const {graph}=build(fixture)
    const id='rust-impl:src%2Fimpls.rs#rust%3Aimpl%3AThing%3Cu8%3E%402%3A34#0'
    expect(resolveFileNodeTarget(graph,id,160)).toMatchObject({filePath:'src/impls.rs',startLine:2,endLine:5})
    expect(adaptCodeGraph(graph).nodes.some(n=>n.id===id)).toBe(true)
  })
  it('makes a Rust impl discoverable through generic search', async () => {
    const root=project({'Cargo.toml':cargo,'src/lib.rs':'pub struct Worker; impl Worker { fn run() {} }'})
    await runIndexCommand({root,src:['src'],out:'index'})
    const out=path.join(root,'index')
    const id=read(out,'code-graph.json').nodes.find((n:{kind:string})=>n.kind==='rust-impl').id
    const result=JSON.parse(childProcess.execFileSync(process.execPath,['node_modules/tsx/dist/cli.mjs','src/cli.ts','search','--index',out,'--query','impl Worker','--limit','100','--json'],{encoding:'utf8',windowsHide:true}))
    expect(result.results.some((r:{id:string})=>r.id===id)).toBe(true)
  })
  it('fingerprints the B10 relationship revision while retaining every previous semantic revision', () => {
    const input={sourceRoots:['src'],excludePatterns:[],callGraphEnabled:false,language:null,defaultIgnoredDirectoryNames:[],defaultIgnoredDirectoryPrefixes:[],defaultFileExcludePatterns:[],androidEvidenceFingerprint:'none',androidGradleEvidenceFingerprint:'none',androidManifestEvidenceFingerprint:'none',androidResourcesEvidenceFingerprint:'none',androidNavigationXmlEvidenceFingerprint:'none',androidTestEvidenceFingerprint:'none'}
    const expected={rustParserRevision:RUST_PARSER_REVISION,rustCargoStructureRevision:'v1.14.0-b09',rustRelationshipRevision:'v1.14.0-b14-doc-comments',rustCargoFingerprint:null,pythonExtractionRevision:'v1.14.0-b04',jsTsExtractionRevision:'v1.14.0-b05',jsFrameworkExtractionRevision:'v1.14.0-b06',frontendFrameworkRevision:'v1.14.0-b07',configuredImportsRevision:'v1.14.0-configured-imports',configuredImportsFingerprint:null,...input}
    expect(computeConfigFingerprint(input)).toBe(createHash('sha256').update(JSON.stringify(expected)).digest('hex'))
  })
  it('matches serialized full/partial graphs after every relationship, selection and Cargo edit', async () => {
    const root=project({'Cargo.toml':cargo,'src/lib.rs':'pub mod a; mod b;','src/a.rs':'pub struct S; pub struct U; pub trait T {}','src/b.rs':'use crate::a::S as Local; pub use crate::a::U as Export; impl Local { fn method() {} }','src/other.rs':'pub fn untouched() {}'})
    const options={root,src:['src'],out:'incremental',incremental:true}
    await runIndexCommand(options)
    const originalFacts=read(root,'incremental/symbol-index.json').files.find((f:{path:string})=>f.path==='src/a.rs').rustSyntaxFacts
    const phases: Array<()=>void>=[
      ()=>{},
      ()=>fs.appendFileSync(path.join(root,'src/b.rs'),' use crate::a::T;'),
      ()=>fs.writeFileSync(path.join(root,'src/b.rs'),'use crate::a::U as Local; pub use crate::a::U as Export; impl Local { fn method() {} }'),
      ()=>fs.writeFileSync(path.join(root,'src/b.rs'),'use crate::a::U as Local; pub(crate) use crate::a::S as Changed; impl Local { fn method() {} }'),
      ()=>fs.writeFileSync(path.join(root,'src/b.rs'),'use crate::a::S as Local; pub(crate) use crate::a::S as Changed; impl crate::a::T for Local { fn method() {} }'),
      ()=>{fs.mkdirSync(path.join(root,'src/moved'));fs.writeFileSync(path.join(root,'src/moved/a.rs'),fs.readFileSync(path.join(root,'src/a.rs')));fs.writeFileSync(path.join(root,'src/lib.rs'),'#[path="moved/a.rs"] pub mod a; mod b;')},
      ()=>fs.writeFileSync(path.join(root,'Cargo.toml'),cargo.replace('sample','renamed')),
      ()=>fs.writeFileSync(path.join(root,'src/b.rs'),'pub fn now_empty() {}'),
      ()=>{},
    ]
    for(const [phase,edit] of phases.entries()) {
      edit()
      const result=await runIndexCommand(options)
      if(result.mode!=='index') throw Error('expected index')
      if([0,8].includes(phase))expect(result.cache?.mode).toBe('incremental-no-change')
      // B09 fingerprints manifest ancestry for a newly selected directory too.
      else if([5,6].includes(phase))expect(result.cache?.mode).toBe('incremental-full-config-changed')
      else expect(result.cache?.mode).toMatch(/^incremental-partial/)
      await runIndexCommand({root,src:['src'],out:`full-${phase}`})
      const partial=read(root,'incremental/code-graph.json'),full=read(root,`full-${phase}/code-graph.json`)
      expect(partial.nodes).toEqual(full.nodes);expect(partial.edges).toEqual(full.edges)
      expect(read(root,'incremental/symbol-index.json').files).toEqual(read(root,`full-${phase}/symbol-index.json`).files)
      if(phase<5)expect(read(root,'incremental/symbol-index.json').files.find((f:{path:string})=>f.path==='src/a.rs').rustSyntaxFacts).toEqual(originalFacts)
      if(phase>=7)expect(claims(partial)).toEqual([])
    }
    await runIndexCommand({...options,exclude:['src/moved','src/a.rs']})
    await runIndexCommand({root,src:['src'],exclude:['src/moved','src/a.rs'],out:'full-selection'})
    expect(read(root,'incremental/code-graph.json').edges).toEqual(read(root,'full-selection/code-graph.json').edges)
    expect(claims(read(root,'incremental/code-graph.json'))).toEqual([])
  })
})
