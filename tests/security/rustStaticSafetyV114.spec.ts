import { beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { RustAdapter } from '../../src/languages/rust/adapter.js'
import { prepareRustParser } from '../../src/languages/rust/parser.js'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { allocateV114OutputDir } from '../helpers/v114OutputRoot.js'

const task = allocateV114OutputDir('rust-static-safety-v114')
const adapter = new RustAdapter()
const temporary = (name: string) => fs.mkdtempSync(path.join(task, name + '-'))
const moduleUrl = (file: string) => pathToFileURL(path.resolve(file)).href

describe('B08 static Rust safety and explicit failures', () => {
  beforeAll(async () => { fs.mkdirSync(task, { recursive: true }); await prepareRustParser() })

  it('requires preparation for synchronous Rust callers but never initializes for TS-only indexing', () => {
    const project = temporary('preparation')
    fs.mkdirSync(path.join(project, 'src'))
    fs.writeFileSync(path.join(project, 'src/example.ts'), 'export function safe() {}')
    fs.writeFileSync(path.join(project, 'src/example.js'), 'export function javascript() {}')
    fs.writeFileSync(path.join(project, 'src/example.py'), 'def python():\n    pass\n')
    const script = `
      import assert from 'node:assert/strict';
      import {isRustParserReady} from ${JSON.stringify(moduleUrl('src/languages/rust/parser.ts'))};
      import {RustAdapter} from ${JSON.stringify(moduleUrl('src/languages/rust/adapter.ts'))};
      import {runIndexCommand} from ${JSON.stringify(moduleUrl('src/indexing/runIndexCommand.ts'))};
      assert.equal(isRustParserReady(), false);
      assert.throws(() => new RustAdapter().extractFromSource('empty.rs', ''), /await prepareRustParser/);
      await runIndexCommand({root:${JSON.stringify(project)},src:['src'],out:'index'});
      assert.equal(isRustParserReady(), false);
    `
    execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], { windowsHide: true })
  })

  it('does not fabricate complete boundaries for malformed or recovery-contaminated declarations', () => {
    const result = adapter.extractFromSource('bad.rs', 'fn broken( { let x = ; }\nfn recovered() {}')
    expect(result.warnings?.join(' ')).toContain('incomplete')
    expect(result.symbols.find(s => s.name === 'broken')?.location.endLine).toBeUndefined()
    expect(result.rustSyntaxFacts?.some(f => f.kind === 'diagnostic' && f.status === 'parser-error')).toBe(true)
    const recovered = adapter.extractFromSource('bad.rs', 'fn outer() { fn child() {} @@@ }')
    expect(recovered.symbols.find(s => s.name === 'outer')?.location.endLine).toBeUndefined()
    expect(recovered.symbols.find(s => s.name === 'child')?.location.endLine).toBeUndefined()
    for (const fact of recovered.rustSyntaxFacts?.filter(f => f.status === 'parser-error') ?? []) expect(fact.endLine).toBeUndefined()
  })

  it('does not resolve modules, imports or foreign declarations by matching names', () => {
    const project = temporary('unresolved')
    fs.mkdirSync(path.join(project, 'src'))
    fs.writeFileSync(path.join(project, 'src/lib.rs'), 'mod sibling; use crate::sibling::run; extern "C" { fn run(); }')
    fs.writeFileSync(path.join(project, 'src/sibling.rs'), 'pub fn run() {}')
    fs.writeFileSync(path.join(project, 'src/sibling.ts'), 'export function run() {}')
    expect(buildIndex({ repoRoot: project, sourceRoots: ['src'] }).index.graph?.fileDeps).toEqual([])
  })

  it('never executes macros, target sources, Cargo, build scripts or a network download', () => {
    const project = temporary('nonexecution')
    fs.mkdirSync(path.join(project, 'src'))
    fs.writeFileSync(path.join(project, 'src/lib.rs'), 'macro_rules! danger { () => { fn expanded() {} } } danger!(); #[custom::execute] pub fn observed() {}')
    fs.writeFileSync(path.join(project, 'build.rs'), 'compile_error!("must never run");')
    const script = `
      import assert from 'node:assert/strict';
      import child from 'node:child_process'; import http from 'node:http'; import https from 'node:https';
      const forbidden = () => { throw new Error('forbidden execution/network') };
      for (const key of ['exec','execFile','spawn','fork','execSync','execFileSync','spawnSync']) child[key] = forbidden;
      http.request = http.get = https.request = https.get = globalThis.fetch = forbidden;
      const {prepareRustParser} = await import(${JSON.stringify(moduleUrl('src/languages/rust/parser.ts'))});
      const {buildIndex} = await import(${JSON.stringify(moduleUrl('src/symbol-index/builder.ts'))});
      await prepareRustParser();
      const index = buildIndex({repoRoot:${JSON.stringify(project)},sourceRoots:['src']}).index;
      assert.deepEqual(index.files[0].symbols.map(s=>s.name), ['danger','observed']);
      assert.deepEqual(index.graph.fileDeps, []);
    `
    execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], { windowsHide: true })
    expect(fs.existsSync(path.join(project, 'target'))).toBe(false)
  })

  it('rejects invalid Unicode/UTF-8 evidence and limits huge or deeply nested input', () => {
    for (const text of ['fn café() {}\uFFFD', 'fn x() {}\uD800', 'fn x() {}\uDC00']) expect(() => adapter.extractFromSource('invalid.rs', text)).toThrow(/Unicode encoding/)
    expect(() => adapter.extractFromSource('huge.rs', ' '.repeat(65_537))).toThrow(/65536-byte/)
    const nested = 'pub fn deep() {' + '{'.repeat(500) + '1' + '}'.repeat(500) + '}'
    const result = adapter.extractFromSource('deep.rs', nested)
    expect(result.symbols.map(s => s.name)).toEqual(['deep'])
    expect(JSON.stringify(result).length).toBeLessThan(nested.length * 8)
    const repeatedOwners = 'mod nested {'.repeat(300) + 'fn leaf() {}' + '}'.repeat(300)
    expect(() => adapter.extractFromSource('owners.rs', repeatedOwners)).toThrow(/Rust retained syntax evidence exceeds storage envelope/)
  })

  it('does not follow a selected-source symlink outside the project', () => {
    const parent = temporary('containment')
    const project = path.join(parent, 'project'), outside = path.join(parent, 'outside')
    fs.mkdirSync(path.join(project, 'src'), { recursive: true }); fs.mkdirSync(outside)
    fs.writeFileSync(path.join(project, 'src/lib.rs'), 'pub fn inside() {}')
    fs.writeFileSync(path.join(outside, 'escape.rs'), 'pub fn escaped() {}')
    fs.symlinkSync(outside, path.join(project, 'src/linked'), process.platform === 'win32' ? 'junction' : 'dir')
    const result = buildIndex({ repoRoot: project, sourceRoots: ['src'] }).index
    expect(result.files.map(f => f.path)).toEqual(['src/lib.rs'])
    expect(result.files.flatMap(f => f.symbols).some(s => s.name === 'escaped')).toBe(false)
  })

  it.each(['missing', 'corrupt'])('fails explicitly for %s packaged grammar and preserves an existing output manifest', (mode) => {
    const project = temporary('asset-' + mode)
    fs.mkdirSync(path.join(project, 'src')); fs.mkdirSync(path.join(project, 'index'))
    fs.copyFileSync('dist/cli.js', path.join(project, 'cli.js'))
    fs.writeFileSync(path.join(project, 'package.json'), '{"type":"module"}')
    fs.writeFileSync(path.join(project, 'src/example.ts'), 'export function previous() {}')
    const args = [path.join(project, 'cli.js'), 'index', '--root', project, '--src', 'src', '--out', 'index', '--json']
    expect(spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true }).status).toBe(0)
    const manifest = fs.readFileSync(path.join(project, 'index/manifest.json'), 'utf8')
    const previousSymbols = fs.readFileSync(path.join(project, 'index/symbol-index.json'), 'utf8')
    fs.writeFileSync(path.join(project, 'src/lib.rs'), 'pub fn observed() {}')
    if (mode === 'corrupt') { fs.mkdirSync(path.join(project, 'assets')); fs.writeFileSync(path.join(project, 'assets/tree-sitter-rust-orchard.wasm'), 'corrupt') }
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Rust parser asset preparation failed')
    expect(fs.readFileSync(path.join(project, 'index/manifest.json'), 'utf8')).toBe(manifest)
    expect(fs.readFileSync(path.join(project, 'index/symbol-index.json'), 'utf8')).toBe(previousSymbols)
  })
})
