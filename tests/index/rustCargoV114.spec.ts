import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { discoverCargoStructure, safeRustPath } from '../../src/languages/rust/cargo.js'
import { allocateV114OutputDir } from '../helpers/v114OutputRoot.js'

const task = allocateV114OutputDir('rust-cargo-v114')
const fixtures = path.resolve('tests/fixtures/v114-language/rust')
function project(files: Record<string,string>): string {
  fs.mkdirSync(task,{recursive:true})
  const root = fs.mkdtempSync(path.join(task,'cargo-'))
  for (const [file,text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true}); fs.writeFileSync(path.join(root,file),text) }
  return root
}
const manifest = '[package]\nname="sample"\nversion="0.1.0"\nedition="2024"\n'
const discover = (root: string, files = ['src/lib.rs']) => discoverCargoStructure(root,files)

describe('B09 bounded Cargo evidence', () => {
  it('interprets a real package and conventional library without executing Cargo', () => {
    const root = project({'Cargo.toml':manifest,'src/lib.rs':'pub fn run() {}'})
    const result = discover(root)
    expect(result.warnings).toEqual([])
    expect(result.packages).toMatchObject([{manifest:'Cargo.toml',name:'sample',edition:'2024',targets:[{kind:'lib',name:'sample',root:'src/lib.rs',origin:'conventional',status:'RESOLVED'}]}])
    expect(result.workspaces).toEqual([])
  })
  it('observes virtual workspace membership, globs, exclusions, default-members and inherited metadata', () => {
    const base = 'F07-cargo-workspaces/'
    const sources = ['crates/core/src/lib.rs','crates/cli/src/main.rs','crates/skip/src/lib.rs'].map(p => base+p)
    const result = discoverCargoStructure(fixtures,sources)
    expect(result.packages.map(p => p.manifest)).toEqual([base+'crates/cli/Cargo.toml',base+'crates/core/Cargo.toml'])
    expect(result.workspaces).toMatchObject([{manifest:base+'Cargo.toml',members:[base+'crates/cli/Cargo.toml',base+'crates/core/Cargo.toml'],excludes:[base+'crates/skip/Cargo.toml'],defaultMembers:[base+'crates/core/Cargo.toml'],status:'RESOLVED'}])
    expect(result.packages.every(p => p.edition === '2024' && p.inheritedMetadata.version === '0.1.0')).toBe(true)
    expect(result.packages.find(p => p.name === 'workspace-core')?.dependencies).toEqual([{name:'renamed-cli',packageName:'workspace-cli',manifest:base+'crates/cli/Cargo.toml',optional:true,conditional:false,selected:true,status:'CONDITIONAL'}])
  })
  it('does not expand selected roots from workspace members', () => {
    const base = 'F07-cargo-workspaces/'
    const result = discoverCargoStructure(fixtures,[base+'crates/core/src/lib.rs'])
    expect(result.packages.find(p => p.name === 'workspace-cli')?.targets.every(t => t.status === 'UNRESOLVED_SELECTED_ROOTS')).toBe(true)
    expect(result.packages.some(p => p.name === 'excluded')).toBe(false)
    expect(result.packages.find(p => p.name === 'workspace-core')?.dependencies[0].selected).toBe(false)
  })
  it('keeps same-name physical packages separate and supports a package workspace root', () => {
    const root = project({'Cargo.toml':manifest+'[workspace]\nmembers=["child"]\n','src/lib.rs':'','child/Cargo.toml':manifest,'child/src/lib.rs':''})
    const result = discover(root,['src/lib.rs','child/src/lib.rs'])
    expect(result.packages.map(p => [p.manifest,p.name])).toEqual([['Cargo.toml','sample'],['child/Cargo.toml','sample']])
    expect(result.workspaces[0].members).toEqual(['Cargo.toml','child/Cargo.toml'])
  })
  it('normalizes safe inherited source references and rejects absolute/escaping metadata paths', () => {
    const root = project({'Cargo.toml':'[workspace]\nmembers=["child"]\n[workspace.package]\nreadme="README.md"\nlicense-file="C:/outside/private.md"\ninclude=["C:/outside/*"]\n','child/Cargo.toml':manifest+'readme.workspace=true\nlicense-file.workspace=true\ninclude.workspace=true\n','child/src/lib.rs':''})
    const result = discover(root,['child/src/lib.rs'])
    expect(result.packages[0].inheritedMetadata).toEqual({readme:'README.md'})
    expect(JSON.stringify(result.packages)).not.toContain('C:/outside')
    expect(result.warnings.join()).toContain('Unsafe inherited')
  })
  it('finds every supported conventional target kind and a static build script', () => {
    const base = 'F07-cargo-workspaces/crates/core/'
    const files = ['src/lib.rs','src/bin/tool.rs','tests/api.rs','examples/demo.rs','benches/perf.rs','build.rs'].map(p => base+p)
    const pkg = discoverCargoStructure(fixtures,files).packages.find(p => p.name === 'workspace-core')!
    expect(pkg.targets.map(t => [t.kind,t.name,t.root,t.status])).toEqual([
      ['lib','workspace_core',base+'src/lib.rs','RESOLVED'],['bin','tool',base+'src/bin/tool.rs','RESOLVED'],['test','api',base+'tests/api.rs','RESOLVED'],['example','demo',base+'examples/demo.rs','RESOLVED'],['bench','perf',base+'benches/perf.rs','RESOLVED'],['build-script','build-script-build',base+'build.rs','RESOLVED'],
    ])
  })
  it('supports directory/main.rs layouts without treating helper modules as targets', () => {
    const files = ['src/bin/tool/main.rs','examples/demo/main.rs','tests/api/main.rs','benches/perf/main.rs','tests/support/helper.rs']
    const root = project({'Cargo.toml':manifest,...Object.fromEntries(files.map(f => [f,'']))})
    expect(discover(root,files).packages[0].targets.map(t => [t.kind,t.name])).toEqual([['bin','tool'],['test','api'],['example','demo'],['bench','perf']])
  })
  it('does not infer integration tests from explicit library or build-script roots', () => {
    const root = project({'Cargo.toml':manifest+'build="tests/build.rs"\n[lib]\npath="tests/support.rs"\n','tests/support.rs':'','tests/build.rs':''})
    const result = discover(root,['tests/support.rs','tests/build.rs'])
    expect(result.packages[0].targets.map(t => t.kind)).toEqual(['lib','build-script'])
    expect(result.packages[0].targets.some(t => t.kind === 'test')).toBe(false)
  })
  it('reports missing Cargo tables and invalid crate-type values without target claims', () => {
    const noTables = discover(project({'Cargo.toml':'[unrelated]\nvalue=true','src/lib.rs':''}))
    expect(noTables.packages).toEqual([])
    expect(noTables.warnings.join()).toContain('no package/workspace table')
    const wrongType = discover(project({'Cargo.toml':manifest+'[lib]\ncrate-type=42\n','src/lib.rs':''}))
    expect(wrongType.packages[0].targets).toEqual([])
    expect(wrongType.warnings.join()).toContain('Malformed lib target')
  })
  it('supports explicit nonstandard roots, proc-macro libraries and build paths', () => {
    const root = project({'Cargo.toml':manifest+'build="support/build.rs"\n[lib]\nname="macros"\npath="custom/root.rs"\nproc-macro=true\n[[bin]]\nname="tool"\npath="custom/main.rs"\n','custom/root.rs':'','custom/main.rs':'','support/build.rs':''})
    expect(discover(root,['custom/root.rs','custom/main.rs','support/build.rs']).packages[0].targets).toMatchObject([{kind:'proc-macro',name:'macros',root:'custom/root.rs',origin:'manifest',status:'RESOLVED'},{kind:'bin',name:'tool',root:'custom/main.rs',status:'RESOLVED'},{kind:'build-script',root:'support/build.rs',status:'RESOLVED'}])
  })
  it.each(['autolib','autobins','autoexamples','autotests','autobenches'])('respects %s=false', control => {
    const files = ['src/lib.rs','src/main.rs','examples/demo.rs','tests/api.rs','benches/perf.rs']
    const root = project({'Cargo.toml':manifest+`${control}=false\n`,...Object.fromEntries(files.map(f => [f,'']))})
    const kind = ({autolib:'lib',autobins:'bin',autoexamples:'example',autotests:'test',autobenches:'bench'} as Record<string,string>)[control]
    expect(discover(root,files).packages[0].targets.some(t => t.kind === kind)).toBe(false)
  })
  it.each(['2015','2018','2021','2024'])('accounts for edition %s auto-discovery defaults', edition => {
    const root = project({'Cargo.toml':manifest.replace('2024',edition)+'[[bin]]\nname="manual"\npath="src/manual.rs"\n','src/lib.rs':'','src/manual.rs':''})
    const targets = discover(root,['src/lib.rs','src/manual.rs']).packages[0].targets
    expect(targets.some(t => t.kind === 'lib')).toBe(edition !== '2015')
    expect(targets.find(t => t.name === 'manual')?.status).toBe('RESOLVED')
  })
  it('retains missing/unselected and conditional targets without resolved claims', () => {
    const root = project({'Cargo.toml':manifest+'[[bin]]\nname="missing"\npath="missing.rs"\n[[bin]]\nname="unselected"\npath="unselected.rs"\n[[example]]\nname="feature"\npath="src/lib.rs"\nrequired-features=["extra"]\n','src/lib.rs':'','unselected.rs':''})
    const targets = discover(root).packages[0].targets
    expect(targets.find(t => t.name === 'missing')?.status).toBe('UNRESOLVED_SELECTED_ROOTS')
    expect(targets.find(t => t.name === 'unselected')?.status).toBe('UNRESOLVED_SELECTED_ROOTS')
    expect(targets.find(t => t.name === 'feature')?.status).toBe('CONDITIONAL')
  })
  it('does not guess conflicting binary roots or duplicate declarations', () => {
    const root = project({'Cargo.toml':manifest+'[[bin]]\nname="same"\npath="a.rs"\n[[bin]]\nname="same"\npath="b.rs"\n','src/lib.rs':'','a.rs':'','b.rs':''})
    expect(discover(root,['src/lib.rs','a.rs','b.rs']).packages[0].targets.filter(t => t.kind === 'bin').map(t => t.status)).toEqual(['AMBIGUOUS','AMBIGUOUS'])
  })
  it('allows supported local path membership and observes conditional/renamed dependencies', () => {
    const root = project({'Cargo.toml':'[workspace]\nmembers=["a"]\n','a/Cargo.toml':manifest+'[dependencies]\nrenamed={package="sample",path="../b"}\n[target.\'cfg(unix)\'.dependencies]\nconditional={path="../b"}\n','a/src/lib.rs':'','b/Cargo.toml':manifest,'b/src/lib.rs':''})
    const result = discover(root,['a/src/lib.rs','b/src/lib.rs'])
    expect(result.workspaces[0].members).toEqual(['a/Cargo.toml','b/Cargo.toml'])
    expect(result.packages[0].dependencies).toMatchObject([{name:'renamed',packageName:'sample',manifest:'b/Cargo.toml',status:'RESOLVED'},{name:'conditional',conditional:true,status:'CONDITIONAL'}])
  })
  it('never traverses an escaping dependency or target path', () => {
    const root = project({'Cargo.toml':manifest+'[dependencies]\nescape={path="../../outside"}\n[[bin]]\nname="escape"\npath="../escape.rs"\n','src/lib.rs':''})
    const pkg = discover(root).packages[0]
    expect(pkg.dependencies).toMatchObject([{name:'escape',status:'UNSUPPORTED_SYNTAX'}])
    expect(pkg.dependencies[0].manifest).toBeUndefined()
    expect(pkg.targets.some(t => t.name === 'escape')).toBe(false)
  })
  it.each(['[package]\nname=42','[package]\nname=["bad"]','[package]\nname={workspace=true}','[package','package="bad"','[package]\nname="bad"\nedition=2024','[package]\nname="bad"\nautobins="yes"'])('does not fabricate package claims from invalid TOML/types: %s', text => {
    const result = discover(project({'Cargo.toml':text,'src/lib.rs':''}))
    expect(result.packages).toEqual([])
    expect(result.warnings.length).toBeGreaterThan(0)
  })
  it.each(['crates/**','crates/[ab]','crates/{a,b}'])('reports unsupported workspace glob %s without guessed members', pattern => {
    const root = project({'Cargo.toml':`[workspace]\nmembers=["${pattern}"]`,'crates/a/Cargo.toml':manifest,'crates/a/src/lib.rs':''})
    const result = discover(root,['crates/a/src/lib.rs'])
    expect(result.workspaces[0].status).toBe('UNSUPPORTED_SYNTAX')
    expect(result.workspaces[0].members).toEqual([])
    expect(result.packages.flatMap(p => p.targets)).toEqual([])
  })
  it('bounds members, packages and dependencies without claiming complete evidence', () => {
    const files: Record<string,string> = {'Cargo.toml':'[workspace]\nmembers=["crates/*"]\n'}
    const sources: string[] = []
    for (let i = 0; i < 258; i++) {
      const folder = `crates/p${String(i).padStart(3,'0')}`
      files[folder+'/Cargo.toml'] = manifest
      files[folder+'/src/lib.rs'] = ''
      sources.push(folder+'/src/lib.rs')
    }
    const result = discover(project(files),sources)
    expect(result.packages.length).toBeLessThanOrEqual(256)
    expect(result.workspaces[0].members.length).toBeLessThanOrEqual(256)
    expect(result.workspaces[0].status).toBe('UNSUPPORTED_SYNTAX')
    expect(result.warnings.join()).toContain('truncated')
    const deps = Array.from({length:258},(_,i) => `dep${i}={path="other"}`).join('\n')
    const depResult = discover(project({'Cargo.toml':manifest+'[dependencies]\n'+deps,'src/lib.rs':''}))
    expect(depResult.packages[0].dependencies).toHaveLength(256)
    expect(depResult.packages[0].status).toBe('UNSUPPORTED_SYNTAX')
  })
  it('reports ancestry exhaustion and does not inspect beyond eight levels', () => {
    const file = 'a/b/c/d/e/f/g/h/i/src/lib.rs'
    const root = project({'Cargo.toml':manifest,[file]:''})
    const result = discover(root,[file])
    expect(result.packages).toEqual([])
    expect(result.warnings.join()).toContain('eight levels')
  })
  it('bounds manifest bytes and target records with explicit incomplete evidence', () => {
    const oversized = discover(project({'Cargo.toml':'#'.repeat(1024*1024+1),'src/lib.rs':''}))
    expect(oversized.packages).toEqual([])
    expect(oversized.warnings.join()).toContain('size')
    const declarations = Array.from({length:130},(_,i) => `[[bin]]\nname="t${i}"\npath="src/lib.rs"\n`).join('')
    const bounded = discover(project({'Cargo.toml':manifest+declarations,'src/lib.rs':''}))
    expect(bounded.packages[0].targets).toHaveLength(128)
    expect(bounded.warnings.join()).toContain('truncated')
  })
  it('rejects generated target directories and symlink escapes', () => {
    const root = project({'Cargo.toml':manifest,'src/lib.rs':''})
    const outside = project({'escaped.rs':''})
    fs.symlinkSync(outside,path.join(root,'linked'),'junction')
    expect(safeRustPath(root,'','linked/escaped.rs')).toBeUndefined()
    expect(safeRustPath(root,'','target/debug/generated.rs')).toBeUndefined()
    expect(discover(root,['linked/escaped.rs']).packages).toEqual([])
  })
  it('avoids unrelated Cargo reads for non-Rust input and fingerprints relevant metadata', () => {
    const root = project({'Cargo.toml':'invalid','src/code.ts':''})
    expect(discover(root,['src/code.ts'])).toEqual({packages:[],workspaces:[],warnings:[],fingerprint:'no-selected-rust'})
    fs.writeFileSync(path.join(root,'Cargo.toml'),manifest)
    fs.writeFileSync(path.join(root,'src/lib.rs'),'')
    const before = discover(root)
    fs.appendFileSync(path.join(root,'Cargo.toml'),'description="changed"\n')
    expect(discover(root).fingerprint).not.toBe(before.fingerprint)
  })
})
