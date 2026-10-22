import { beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { RustAdapter } from '../../src/languages/rust/adapter.js'
import { isRustParserReady, prepareRustParser, RUST_GRAMMAR_SHA256, RUST_PARSER_REVISION } from '../../src/languages/rust/parser.js'
import { createDefaultRegistry } from '../../src/languages/registry.js'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { buildCodeGraph } from '../../src/graph/buildCodeGraph.js'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { resolveSymbolTarget } from '../../src/lookup/resolveSourceTarget.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'
import { createHash } from 'node:crypto'
import { allocateV114OutputDir } from '../helpers/v114OutputRoot.js'

const root = path.resolve('tests/fixtures/v114-language/rust')
const task = allocateV114OutputDir('rust-syntax-v114')
const adapter = new RustAdapter()
const fixture = (family: string, file = 'lib.rs') => fs.readFileSync(path.join(root, family, 'src', file), 'utf8')
const readIndex = (out: string): SymbolIndex => JSON.parse(fs.readFileSync(path.join(out, 'symbol-index.json'), 'utf8'))
const temporary = (label: string) => fs.mkdtempSync(path.join(task, label + '-'))

describe('B08 Rust syntax, shared identities and persisted evidence', () => {
  beforeAll(async () => { fs.mkdirSync(task, { recursive: true }); await prepareRustParser() })

  it('registers .rs and shares one explicit preparation', async () => {
    expect(createDefaultRegistry().adapterForFile('src/LIB.RS')).toBeInstanceOf(RustAdapter)
    await Promise.all([prepareRustParser(), prepareRustParser()])
    expect(isRustParserReady()).toBe(true)
    expect(createHash('sha256').update(fs.readFileSync('src/languages/rust/assets/tree-sitter-rust-orchard.wasm')).digest('hex')).toBe(RUST_GRAMMAR_SHA256)
    expect(RUST_PARSER_REVISION).toContain('web-tree-sitter-0.25.10:orchard-0.16.10')
  })

  it('extracts independently expected functions, types, fields, variants and modifiers', () => {
    const result = adapter.extractFromSource('src/lib.rs', fixture('F01-basic-syntax'))
    expect(result.warnings).toEqual([])
    for (const [name, kind, line] of [['greet', 'function', 1], ['fetch', 'function', 2], ['answer', 'function', 3], ['pointer', 'function', 4], ['Bits', 'union', 9], ['Number', 'type', 10], ['LIMIT', 'const', 11], ['READY', 'variable', 12]] as const) {
      expect(result.symbols.find(s => s.name === name)).toMatchObject({ kind, location: { line, endLine: line } })
    }
    for (const [name, shape] of [['Named', 'named'], ['Tuple', 'tuple'], ['Unit', 'unit']]) {
      expect(result.symbols.find(s => s.name === name && s.kind === 'struct')?.declarationMetadata?.rust?.shape).toBe(shape)
    }
    expect(result.symbols.filter(s => s.kind === 'variant').map(s => [s.name, s.ownerKey?.startsWith('rust:enum_item:Choice@8:')])).toEqual([['Named', true], ['Tuple', true], ['Unit', true]])
    const fields = result.symbols.filter(s => s.name === 'value' && s.kind === 'field')
    expect(fields).toHaveLength(2)
    expect(new Set(fields.map(s => s.ownerKey)).size).toBe(2)
    expect(result.symbols.find(s => s.name === 'fetch')?.declarationMetadata?.rust?.modifiers).toEqual(['async'])
    expect(result.symbols.find(s => s.name === 'answer')?.declarationMetadata?.rust?.modifiers).toEqual(['const'])
    expect(result.symbols.find(s => s.name === 'pointer')?.declarationMetadata?.rust?.modifiers).toEqual(['unsafe'])
  })

  it('keeps trait and impl method identities separate using the unchanged B02 serializer', () => {
    const index = buildIndex({ repoRoot: root, sourceRoots: ['F04-traits-impls/src'] }).index
    const methods = index.files[0].symbols.filter(s => s.name === 'run')
    expect(methods.map(s => s.location.line)).toEqual([4, 9, 16, 18, 19])
    const expectedOwners = ['rust:trait_item:Runner@1:0', 'rust:impl:Worker@8:142', 'rust:impl:Worker:trait:Runner@13:265', 'rust:impl:Worker@18:366', 'rust:mod_item:inner@19:403/impl:super::Worker@19:415']
    expect(methods.map(s => s.ownerKey)).toEqual(expectedOwners)
    expect(methods.map(s => s.nodeId)).toEqual(expectedOwners.map(owner => `symbolq:${encodeURIComponent('F04-traits-impls/src/lib.rs')}#${encodeURIComponent(owner)}#run#0`))
    expect(methods[0].declarationMetadata?.rust?.declarationOnly).toBe(true)
    expect(methods.slice(1).every(s => s.declarationMetadata?.rust?.declarationOnly === false)).toBe(true)
    expect(index.files[0].symbols.filter(s => s.name === 'Output')).toHaveLength(3)
    expect(index.files[0].symbols.find(s => s.name === 'Alias')?.kind).toBe('trait')
    const graph = buildCodeGraph({ symbolIndex: index })
    const ids = new Set(graph.nodes.map(n => n.id))
    expect(ids.size).toBe(graph.nodes.length)
    expect(graph.edges.every(e => ids.has(e.source) && ids.has(e.target))).toBe(true)
    expect(graph.edges.filter(e => e.kind === 'defines').map(e => e.target).sort()).toEqual(index.files[0].symbols.map(s => s.nodeId!).sort())
    expect(index.files[0].rustSyntaxFacts?.filter(f => f.kind === 'impl').map(f => f.implementation)).toEqual(['inherent', 'trait', 'inherent', 'inherent', 'trait'])
    expect(index.files[0].rustSyntaxFacts?.filter(f => f.kind === 'declaration').every(f => f.nodeId && ids.has(f.nodeId))).toBe(true)
  })

  it('never overwrites duplicate declarations in one owner, including same-line duplicates', () => {
    const project = temporary('duplicates')
    fs.mkdirSync(path.join(project, 'src'))
    fs.writeFileSync(path.join(project, 'src/lib.rs'), 'impl Same { fn run() {} fn run() {} }')
    const index = buildIndex({ repoRoot: project, sourceRoots: ['src'] }).index
    const symbols = index.files[0].symbols
    expect(symbols.map(s => s.nodeId)).toEqual(['symbolq:src%2Flib.rs#rust%3Aimpl%3ASame%401%3A0#run#0', 'symbolq:src%2Flib.rs#rust%3Aimpl%3ASame%401%3A0#run#1'])
    expect(buildCodeGraph({ symbolIndex: index }).nodes.filter(n => n.kind === 'symbol')).toHaveLength(2)
  })

  it('retains module/use/conditional/macro syntax without fabricating Rust relationships', () => {
    const index = buildIndex({ repoRoot: root, sourceRoots: ['F01-basic-syntax/src', 'F05-macros/src'] }).index
    expect(index.graph?.fileDeps).toEqual([])
    const facts = index.files.flatMap(f => f.rustSyntaxFacts ?? [])
    expect(facts.find(f => f.kind === 'module' && f.name === 'external')).toMatchObject({ inline: false })
    expect(facts.find(f => f.kind === 'module' && f.name === 'nested')).toMatchObject({ inline: true })
    expect(facts.find(f => f.kind === 'use' && f.syntaxKind === 're-export')?.forms).toEqual(expect.arrayContaining(['grouped', 'glob', 'aliased', 'named']))
    expect(facts.find(f => f.kind === 'use' && f.text === 'super::external')).toBeDefined()
    const attrs = facts.flatMap(f => f.attributes ?? []).join('\n')
    for (const attr of ['#[test]', '#[cfg(test)]', '#[derive(Debug)]', 'cfg_attr', 'custom::observe']) expect(attrs).toContain(attr)
    expect(index.files.flatMap(f => f.symbols).some(s => s.name === 'generated_only_by_expansion')).toBe(false)
    expect(facts.find(f => f.kind === 'macro' && f.name === 'generate')).toBeDefined()
  })

  it('uses parser ranges for raw strings, comments, macros, CRLF, Unicode, raw identifiers and EOF', () => {
    const source = fixture('F08-parser-robustness').trimEnd().replace(/\n/g, '\r\n')
    const result = adapter.extractFromSource('src/lib.rs', source)
    expect(result.symbols.map(s => [s.name, s.location.line, s.location.endLine])).toEqual([['bounded', 1, 6], ['neighbor', 7, 7]])
    const unicode = adapter.extractFromSource('src/unicode.rs', fixture('F08-parser-robustness', 'unicode.rs').trimEnd())
    expect(unicode.symbols.map(s => [s.name, s.location.line, s.location.endLine])).toEqual([['café', 1, 1], ['r#type', 2, 2]])
    expect(adapter.extractFromSource('empty.rs', '').symbols).toEqual([])
    const index = buildIndex({ repoRoot: root, sourceRoots: ['F08-parser-robustness/src'] }).index
    const symbol = index.files.find(f => f.path.endsWith('/lib.rs'))!.symbols[0]
    expect(resolveSymbolTarget(index, symbol.location.file, 'bounded', 120, symbol.nodeId)).toMatchObject({ startLine: 1, endLine: 6 })
  })

  it('records Rust 2015/2018/2021/2024 syntax and safe/unsafe foreign signatures', () => {
    for (const source of ['extern crate core; fn old() {}', 'async fn modern() { async {}.await; }', 'fn closures() { let f = |x: i32| x; }', 'unsafe extern "C" { safe fn safe_foreign(); unsafe fn unsafe_foreign(); }']) {
      expect(adapter.extractFromSource('edition.rs', source).warnings).toEqual([])
    }
    const result = adapter.extractFromSource('ffi.rs', fixture('F08-parser-robustness', 'unsafe-extern.rs'))
    expect(result.symbols.map(s => s.name)).toEqual(['foreign_safe', 'foreign_unsafe', 'FOREIGN', 'exported'])
    expect(result.rustSyntaxFacts?.find(f => f.kind === 'ffi')).toMatchObject({ line: 1, endLine: 5, text: 'unsafe extern "C"' })
  })

  it('persists full/partial Rust facts, identities and spans equivalently, removes stale symbols, invalidates older evidence', async () => {
    const project = temporary('incremental')
    fs.mkdirSync(path.join(project, 'src'))
    fs.writeFileSync(path.join(project, 'src/lib.rs'), fixture('F04-traits-impls'))
    fs.writeFileSync(path.join(project, 'src/change.ts'), 'export const first = 1')
    const out = path.join(project, 'incremental')
    await runIndexCommand({ root: project, src: ['src'], out, incremental: true })
    const original = readIndex(out).files.find(f => f.language === 'rust')!
    expect((await runIndexCommand({ root: project, src: ['src'], out, incremental: true })).cache?.mode).toBe('incremental-no-change')
    fs.writeFileSync(path.join(project, 'src/change.ts'), 'export const second = 2')
    const partial = await runIndexCommand({ root: project, src: ['src'], out, incremental: true })
    expect(partial.cache?.mode).toMatch(/^incremental-partial/)
    const reused = readIndex(out).files.find(f => f.language === 'rust')!
    expect(reused).toEqual(original)
    await runIndexCommand({ root: project, src: ['src'], out: path.join(project, 'full') })
    expect(readIndex(out).files).toEqual(readIndex(path.join(project, 'full')).files)
    expect(readIndex(out).graph).toEqual(readIndex(path.join(project, 'full')).graph)
    const cache = JSON.parse(fs.readFileSync(path.join(out, 'cache-metadata.json'), 'utf8'))
    cache.configFingerprint = 'pre-b08-fingerprint'
    fs.writeFileSync(path.join(out, 'cache-metadata.json'), JSON.stringify(cache))
    expect((await runIndexCommand({ root: project, src: ['src'], out, incremental: true })).cache?.mode).toBe('incremental-full-config-changed')
    fs.writeFileSync(path.join(project, 'src/lib.rs'), 'pub fn replacement() {}')
    await runIndexCommand({ root: project, src: ['src'], out, incremental: true })
    expect(readIndex(out).files.find(f => f.language === 'rust')?.symbols.map(s => s.name)).toEqual(['replacement'])
    fs.unlinkSync(path.join(project, 'src/lib.rs'))
    await runIndexCommand({ root: project, src: ['src'], out, incremental: true })
    expect(readIndex(out).files.some(f => f.language === 'rust')).toBe(false)
  })

  it('actual public CLI prepares Rust, searches, looks up, slices and retrieves an exact method', () => {
    const out = temporary('cli')
    const cli = (args: string[]) => execFileSync(process.execPath, ['dist/cli.js', ...args], { encoding: 'utf8', windowsHide: true })
    cli(['index', '--root', root, '--src', 'F04-traits-impls/src', '--out', out, '--json'])
    expect(JSON.parse(cli(['index', '--root', root, '--src', 'F04-traits-impls/src', '--dry-run', '--json'])).languageCounts).toEqual({ rust: 1 })
    const index = readIndex(out)
    const method = index.files[0].symbols.find(s => s.name === 'run' && s.location.line === 16)!
    expect(cli(['search', '--index', out, '--query', 'run', '--json'])).toContain(method.nodeId)
    expect(cli(['lookup', '--index', out, '--node', method.nodeId!, '--json'])).toContain(method.nodeId)
    expect(cli(['slice', '--index', out, '--node', method.nodeId!, '--depth', '1', '--json'])).toContain(method.nodeId)
    const source = cli(['source', '--index', out, '--node', method.nodeId!, '--format', 'numbered'])
    expect(source).toContain('16 |     fn run(&self) {}')
    expect(source).not.toContain('impl Worker { pub fn run')
  })
})
