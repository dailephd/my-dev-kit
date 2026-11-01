import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { buildCodeGraph } from '../../src/graph/buildCodeGraph.js'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { allocateV114OutputDir } from '../helpers/v114OutputRoot.js'

const task = allocateV114OutputDir('configured-imports-v114')
function fixture(files: Record<string, string>) {
  fs.mkdirSync(task, { recursive: true })
  const root = fs.mkdtempSync(join(task, 'config-'))
  for (const [file, text] of Object.entries(files)) put(root, file, text)
  return root
}
function put(root: string, file: string, text: string) {
  fs.mkdirSync(dirname(join(root, file)), { recursive: true })
  fs.writeFileSync(join(root, file), text)
}
const config = (paths: Record<string, string[]>, baseUrl?: string) => JSON.stringify({ compilerOptions: { paths, ...(baseUrl ? { baseUrl } : {}) } })
const source = 'export function run() { return 1 }'
const importer = (specifier: string) => `import {run} from '${specifier}'; export const value = run;`
function deps(root: string, roots = ['src']) { return buildIndex({ repoRoot: root, sourceRoots: roots }).index.graph!.fileDeps }
const edge = (to: string, from = 'src/main.ts') => ({ from, to, kind: 'import' })

describe('configured imports: selected local dependency producer', () => {
  it('persists both independent incident endpoints with ordinary imports and stable IDs', () => {
    const index = buildIndex({ repoRoot: resolve('tests/fixtures/v114-path-alias'), sourceRoots: ['src'] }).index
    const from = 'src/app/tool/[slug]/page.tsx'
    expect(index.graph!.fileDeps).toEqual([
      edge('src/component/tool/ToolPageTemplate.tsx', from), edge('src/module/tool/registry.ts', from),
    ])
    const graph = buildCodeGraph({ symbolIndex: index })
    expect(graph.edges.filter(e => e.kind === 'imports').map(e => [e.source, e.target])).toEqual([
      ['file:' + from, 'file:src/component/tool/ToolPageTemplate.tsx'], ['file:' + from, 'file:src/module/tool/registry.ts'],
    ])
    expect(index.files.find(f => f.path.endsWith('/registry.ts'))!.symbols[0].nodeId).toBe('symbol:src/module/tool/registry.ts#getToolBySlug')
  })
  it.each([
    ['exact', config({ alias: ['./src/a'] }), 'alias'],
    ['wildcard', config({ '@/*': ['./src/*'] }), '@/a'],
    ['ordered missing fallback', config({ '@/*': ['./missing/*', './src/*'] }), '@/a'],
    ['baseUrl', config({ '@/*': ['*'] }, './src'), '@/a'],
    ['JSONC', '{/* comment */"compilerOptions":{"paths":{"@/*":["./src/*",],},},}', '@/a'],
  ])('supports %s', (_name, text, specifier) => {
    expect(deps(fixture({ 'tsconfig.json': text, 'src/main.ts': importer(specifier), 'src/a.ts': source }))).toEqual([edge('src/a.ts')])
  })
  it('supports jsconfig and selects the closest nested config', () => {
    const root = fixture({ 'jsconfig.json': config({ '@/*': ['./wrong/*'] }), 'src/tsconfig.json': config({ '@/*': ['./*'] }), 'src/main.ts': importer('@/a'), 'src/a.ts': source })
    expect(deps(root)).toEqual([edge('src/a.ts')])
    expect(deps(fixture({ 'jsconfig.json': config({ '@/*': ['./src/*'] }), 'src/main.js': importer('@/a'), 'src/a.js': source }))).toEqual([edge('src/a.js', 'src/main.js')])
  })
  it('preserves defining paths/baseUrl origins across local inheritance and overrides', () => {
    const root = fixture({ 'tsconfig.json': '{"extends":"./config/base"}', 'config/base.json': config({ '@/*': ['../src/*'] }), 'src/main.ts': importer('@/a'), 'src/a.ts': source })
    expect(deps(root)).toEqual([edge('src/a.ts')])
    put(root, 'config/base.json', config({ '@/*': ['*'] }, '../src'))
    expect(deps(root)).toEqual([edge('src/a.ts')])
    put(root, 'tsconfig.json', '{"extends":"./config/base","compilerOptions":{"baseUrl":"./other"}}')
    put(root, 'other/a.ts', source)
    expect(deps(root, ['src', 'other'])).toEqual([edge('other/a.ts')])
  })
  it('applies exact/longest-prefix specificity before targets and preserves ties', () => {
    const root = fixture({ 'tsconfig.json': config({ '@/*': ['./src/b'], '@/a*': ['./src/missing'], '@/a': ['./src/a'] }), 'src/main.ts': importer('@/a'), 'src/a.ts': source, 'src/b.ts': source })
    expect(deps(root)).toEqual([edge('src/a.ts')])
    put(root, 'src/main.ts', importer('@/abc'))
    expect(deps(root)).toEqual([]) // specific mapping cannot fall through to broader mapping
    put(root, 'tsconfig.json', config({ '@/*': ['./src/b'], '@/*bc': ['./src/a'] }))
    expect(deps(root)).toEqual([])
  })
  it('respects ordered valid targets rather than treating their order as ambiguity', () => {
    expect(deps(fixture({ 'tsconfig.json': config({ alias: ['./src/a', './src/b'] }), 'src/main.ts': importer('alias'), 'src/a.ts': source, 'src/b.ts': source }))).toEqual([edge('src/a.ts')])
  })
  it.each([
    ['missing config', {}],
    ['missing mapping', { 'tsconfig.json': '{}' }],
    ['missing target', { 'tsconfig.json': config({ alias: ['./src/missing'] }) }],
    ['outside repository', { 'tsconfig.json': config({ alias: ['../a', './src/a'] }) }],
    ['node_modules target', { 'tsconfig.json': config({ alias: ['./node_modules/a', './src/a'] }), 'node_modules/a.ts': source }],
    ['unsupported target', { 'tsconfig.json': config({ alias: ['./data.json', './src/a'] }), 'data.json': '{}' }],
    ['absolute target', { 'tsconfig.json': config({ alias: [resolve('src/a')] }) }],
    ['unsupported bare target without baseUrl', { 'tsconfig.json': config({ alias: ['src/a'] }) }],
    ['malformed mapping', { 'tsconfig.json': '{"compilerOptions":{"paths":{"alias":"./src/a"}}}' }],
    ['multiple wildcards', { 'tsconfig.json': config({ 'a**': ['./src/a'] }) }],
    ['malformed JSON', { 'tsconfig.json': '{ INVALID' }],
    ['JavaScript is not JSON config', { 'tsconfig.json': 'throw new Error("EXECUTED")' }],
    ['package extends', { 'tsconfig.json': '{"extends":"uninstalled-package","compilerOptions":{"paths":{"alias":["./src/a"]}}}' }],
    ['cycle', { 'tsconfig.json': '{"extends":"./base.json"}', 'base.json': '{"extends":"./tsconfig.json"}' }],
    ['outside extends', { 'tsconfig.json': '{"extends":"../outside.json"}' }],
    ['competing configs', { 'tsconfig.json': config({ alias: ['./src/a'] }), 'jsconfig.json': config({ alias: ['./src/a'] }) }],
    ['unsupported module suffix probing', { 'tsconfig.json': '{"compilerOptions":{"moduleSuffixes":[".native",""],"paths":{"alias":["./src/a"]}}}', 'src/a.native.ts': source }],
  ] as Array<[string, Record<string, string>]>)('does not fabricate edges: %s', (_name, files) => {
    const root = fixture({ ...files, 'src/main.ts': importer('alias'), 'src/a.ts': source, 'src/unrelated.ts': 'export function alias() {}' })
    expect(deps(root)).toEqual([])
  })
  it('rejects unreadable/untrusted configuration and oversized config', () => {
    const root = fixture({ 'src/main.ts': importer('alias'), 'src/a.ts': source })
    fs.mkdirSync(join(root, 'tsconfig.json')) // not a readable config file
    expect(deps(root)).toEqual([])
    const large = fixture({ 'tsconfig.json': config({ alias: ['./src/a'] }) + ' '.repeat(1024 * 1024), 'src/main.ts': importer('alias'), 'src/a.ts': source })
    expect(deps(large)).toEqual([])
  })
  it('supports eight inheritance links and rejects nine', () => {
    const files: Record<string, string> = { 'src/main.ts': importer('alias'), 'src/a.ts': source, 'tsconfig.json': '{"extends":"./c1.json"}' }
    for (let n = 1; n <= 8; n++) files[`c${n}.json`] = n === 8 ? config({ alias: ['./src/a'] }) : `{"extends":"./c${n + 1}.json"}`
    const root = fixture(files)
    expect(deps(root)).toEqual([edge('src/a.ts')])
    put(root, 'c8.json', '{"extends":"./c9.json"}')
    put(root, 'c9.json', config({ alias: ['./src/a'] }))
    expect(deps(root)).toEqual([])
  })
  it('rejects ambiguous sources and excluded preceding targets, including NodeNext', () => {
    const root = fixture({ 'tsconfig.json': config({ alias: ['./src/a'] }), 'src/main.ts': importer('alias'), 'src/a.ts': source, 'src/a.js': source })
    expect(deps(root)).toEqual([])
    put(root, 'tsconfig.json', config({ alias: ['./excluded/a', './src/a.ts'] }))
    put(root, 'excluded/a.ts', source)
    expect(deps(root)).toEqual([])
    put(root, 'tsconfig.json', config({ alias: ['./excluded/a.js', './src/a.ts'] }))
    expect(deps(root)).toEqual([])
  })
  it.each([
    ['src/a.d.ts', './src/a', 'src/a.js'],
    ['src/a.d.ts', './src/a.js', 'src/a.js'],
    ['src/a/index.d.ts', './src/a', 'src/a/index.js'],
    ['src/a/package.json', './src/a', 'src/a/index.ts'],
    ['src/a.cts', './src/a.cjs', 'src/a.cjs'],
    ['src/a.d.cts', './src/a.cjs', 'src/a.cjs'],
  ])('does not reinterpret excluded declaration/package evidence %s as a source edge', (blocker, target, selected) => {
    const root = fixture({ 'tsconfig.json': config({ alias: [target, './src/fallback'] }), 'src/main.ts': importer('alias'), [selected]: source, 'src/fallback.ts': source,
      [blocker]: blocker.endsWith('.json') ? '{"types":"./other.d.ts"}' : 'export declare function run(): void;' })
    expect(deps(root)).toEqual([])
  })
  it('retains independently established source precedence before declarations and directory metadata', () => {
    const root = fixture({ 'tsconfig.json': config({ alias: ['./src/a'] }), 'src/main.ts': importer('alias'), 'src/a.ts': source,
      'src/a.d.ts': 'export declare function run(): void;', 'src/a/package.json': '{"types":"./index.d.ts"}', 'src/a/index.d.ts': 'export declare function run(): void;' })
    expect(deps(root)).toEqual([edge('src/a.ts')])
  })
  it('rejects escaping target/config symlinks without executing sources', () => {
    const outside = fixture({ 'a.ts': source, 'base.json': config({ alias: ['./src/a'] }) })
    const root = fixture({ 'tsconfig.json': config({ alias: ['./link/a', './src/a'] }), 'src/main.ts': importer('alias'), 'src/a.ts': 'throw new Error("TARGET EXECUTED"); ' + source })
    fs.symlinkSync(outside, join(root, 'link'), 'junction')
    expect(deps(root)).toEqual([])
    put(root, 'tsconfig.json', '{"extends":"./link/base.json"}')
    expect(deps(root)).toEqual([])
    put(root, 'tsconfig.json', config({ alias: ['./src/a'] }))
    expect(deps(root)).toEqual([edge('src/a.ts')])
  })
  it('uses ordinary existing re-export edge kinds and bounds unresolved diagnostics', () => {
    const root = fixture({ 'tsconfig.json': config({ '@/*': ['./src/*'] }), 'src/main.ts': 'export {run} from "@/a"; export * from "@/a";', 'src/a.ts': source })
    expect(deps(root)).toEqual([{ from: 'src/main.ts', to: 'src/a.ts', kind: 're-export' }, { from: 'src/main.ts', to: 'src/a.ts', kind: 'export-all' }])
    put(root, 'src/main.ts', Array.from({ length: 30 }, (_, n) => `import "@/missing${n}";`).join('\n'))
    const index = buildIndex({ repoRoot: root, sourceRoots: ['src'] }).index
    expect(index.graph!.fileDeps).toEqual([])
    expect(index.files.find(f => f.path === 'src/main.ts')!.warnings).toHaveLength(20)
  })
  it.each([
    ['./a', 'src/a.ts'], ['./folder', 'src/folder/index.ts'], ['./a.js', 'src/a.ts'], ['./a.jsx', 'src/a.tsx'], ['./a.cjs', 'src/a.cjs'],
  ])('preserves B05 relative resolution %s', (specifier, target) => {
    expect(deps(fixture({ 'src/main.ts': importer(specifier), [target]: source }))).toEqual([edge(target)])
  })
  it.each(['.ts', '.tsx', '.js', '.jsx', '.cjs'])('supports selected alias target %s and NodeNext source mapping', ext => {
    const specifier = ext === '.ts' ? '@/a.js' : ext === '.tsx' ? '@/a.jsx' : '@/a' + ext
    expect(deps(fixture({ 'tsconfig.json': config({ '@/*': ['./src/*'] }), 'src/main.ts': importer(specifier), ['src/a' + ext]: source }))).toEqual([edge('src/a' + ext)])
  })
})

describe('configuration-aware incremental graph parity', () => {
  it('invalidates additions/changes/removals/inheritance/nesting/baseUrl/roots and removes stale edges', async () => {
    const root = fixture({ 'src/main.ts': importer('alias'), 'src/a.ts': source, 'src/b.ts': source })
    const opts = { root, src: ['src'], out: 'inc', incremental: true }
    const read = (out: string, file: string) => JSON.parse(fs.readFileSync(join(root, out, file), 'utf8'))
    const parity = async (src = ['src']) => {
      const result = await runIndexCommand({ ...opts, src })
      await runIndexCommand({ root, src, out: 'full' })
      for (const artifact of ['symbol-index.json', 'code-graph.json']) {
        const a = read('inc', artifact), b = read('full', artifact)
        for (const value of [a, b]) { delete value.createdAt; delete value.buildTime }
        expect(a).toEqual(b)
      }
      return result
    }
    await parity()
    expect((await parity()).mode === 'index').toBe(true)
    for (const text of [config({ alias: ['./src/a'] }), config({ alias: ['./src/b'] }), config({ alias: ['b'] }, './src'), '{}']) {
      put(root, 'tsconfig.json', text)
      const result = await parity()
      expect(result.mode === 'index' && result.cache.mode).toBe('incremental-full-config-changed')
    }
    put(root, 'tsconfig.json', '{"extends":"./base.json"}')
    put(root, 'base.json', config({ alias: ['./src/a'] }))
    await parity()
    put(root, 'base.json', config({ alias: ['./src/b'] }))
    const inherited = await parity()
    expect(inherited.mode === 'index' && inherited.cache.mode).toBe('incremental-full-config-changed')
    put(root, 'src/tsconfig.json', config({ alias: ['./a'] }))
    await parity()
    expect(read('inc', 'symbol-index.json').graph.fileDeps).toEqual([edge('src/a.ts')])
    fs.unlinkSync(join(root, 'src/a.ts')) // test-owned fixture only
    await parity()
    expect(read('inc', 'symbol-index.json').graph.fileDeps).toEqual([])
    put(root, 'src/a.ts', source)
    await parity()
    expect(read('inc', 'symbol-index.json').graph.fileDeps).toEqual([edge('src/a.ts')])
    fs.renameSync(join(root, 'src/a.ts'), join(root, 'src/moved.ts'))
    await parity()
    expect(read('inc', 'symbol-index.json').graph.fileDeps).toEqual([])
    put(root, 'src/main.ts', importer('alias') + '\n// importer changed')
    const edited = await parity()
    expect(edited.mode === 'index' && edited.cache.mode).toContain('partial')
    expect(read('inc', 'symbol-index.json').graph.fileDeps).toEqual([])
    put(root, 'src/main.ts', importer('./moved'))
    await parity()
    expect(read('inc', 'symbol-index.json').graph.fileDeps).toEqual([edge('src/moved.ts')])
    fs.unlinkSync(join(root, 'src/tsconfig.json'))
    fs.unlinkSync(join(root, 'tsconfig.json'))
    await parity()
    put(root, 'other/c.ts', source)
    const roots = await parity(['src', 'other'])
    expect(roots.mode === 'index' && roots.cache.mode).toBe('incremental-full-config-changed')
    const noop = await runIndexCommand({ ...opts, src: ['src', 'other'] })
    expect(noop.mode === 'index' && noop.cache.mode).toBe('incremental-no-change')
  })
  it('invalidates an excluded earlier target appearing, without widening selected roots', async () => {
    const root = fixture({ 'tsconfig.json': config({ alias: ['./excluded/a', './src/a'] }), 'src/main.ts': importer('alias'), 'src/a.ts': source })
    const opts = { root, src: ['src'], out: 'inc', incremental: true }
    await runIndexCommand(opts)
    expect(JSON.parse(fs.readFileSync(join(root, 'inc/symbol-index.json'), 'utf8')).graph.fileDeps).toEqual([edge('src/a.ts')])
    put(root, 'excluded/a.ts', source)
    const changed = await runIndexCommand(opts)
    expect(changed.mode === 'index' && changed.cache.mode).toBe('incremental-full-config-changed')
    const index = JSON.parse(fs.readFileSync(join(root, 'inc/symbol-index.json'), 'utf8'))
    expect(index.graph.fileDeps).toEqual([])
    expect(index.files.some((f: { path: string }) => f.path === 'excluded/a.ts')).toBe(false)
    fs.unlinkSync(join(root, 'excluded/a.ts'))
    await runIndexCommand(opts)
    expect(JSON.parse(fs.readFileSync(join(root, 'inc/symbol-index.json'), 'utf8')).graph.fileDeps).toEqual([edge('src/a.ts')])
  })
  it('invalidates newly present excluded declarations and directory package metadata', async () => {
    for (const blocker of ['src/a/index.d.ts', 'src/a/package.json']) {
      const root = fixture({ 'tsconfig.json': config({ alias: ['./src/a'] }), 'src/main.ts': importer('alias'), 'src/a/index.js': source })
      const opts = { root, src: ['src'], out: 'inc', incremental: true }
      await runIndexCommand(opts)
      put(root, blocker, blocker.endsWith('.json') ? '{"types":"./other.d.ts"}' : 'export declare function run(): void;')
      const changed = await runIndexCommand(opts)
      expect(changed.mode === 'index' && changed.cache.mode).toBe('incremental-full-config-changed')
      expect(JSON.parse(fs.readFileSync(join(root, 'inc/symbol-index.json'), 'utf8')).graph.fileDeps).toEqual([])
    }
  })
})
