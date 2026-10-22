import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { TypeScriptAdapter } from '../../src/languages/typescript/adapter.js'
import { PythonAdapter } from '../../src/languages/python/adapter.js'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { buildCodeGraph } from '../../src/graph/buildCodeGraph.js'
import { buildPartialSymbolIndex } from '../../src/indexing/partialRebuild.js'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { computeConfigFingerprint, CACHE_SCHEMA_VERSION } from '../../src/indexing/cacheMetadata.js'
import { searchIndex } from '../../src/search/searchIndex.js'
import { buildSymbolIndexDiff } from '../../src/graph-diff/buildSymbolIndexDiff.js'
import { readIndexManifest } from '../../src/indexing/readIndexManifest.js'
import * as cacheMetadata from '../../src/indexing/cacheMetadata.js'
import { allocateV114OutputDir } from '../helpers/v114OutputRoot.js'

const adapter = new TypeScriptAdapter()
const taskRoot = allocateV114OutputDir('ts-js-v114')
function fixture(files: Record<string, string>) {
  mkdirSync(taskRoot, { recursive: true })
  const root = mkdtempSync(join(taskRoot, 'jsts-'))
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), source)
  }
  return root
}
function calls(files: Record<string, string>) {
  return adapter.extractCallGraphEdges(Object.entries(files).map(([filePath, sourceText]) => ({ filePath, sourceText })))
}
const docs = `/**
 * @template T
 * @param {T} value input value
 * @returns {T} output value
 * @deprecated use replacement
 */
export function identity(value) {
  return value;
}
/** @type {number} count of items */
const count = 1;
/**
 * @typedef {Object} Options
 * @property {string} title display title
 */
`

describe('B05 JSDoc syntax evidence', () => {
  it('records parameters, returns, templates, deprecation and exact declaration boundaries', () => {
    const result = adapter.extractFromSource('docs.js', docs)
    expect(result.symbols[0]).toMatchObject({ name: 'identity', kind: 'function', exported: true, location: { line: 7, endLine: 9 } })
    expect(result.symbols[0].declarationMetadata?.jsdoc).toEqual(expect.arrayContaining([
      expect.objectContaining({ tagName: 'template', parameterName: 'T', status: 'syntax-only' }),
      expect.objectContaining({ tagName: 'param', parameterName: 'value', typeExpression: 'T', textSummary: 'input value', startLine: 3 }),
      expect.objectContaining({ tagName: 'returns', typeExpression: 'T', startLine: 4 }),
      expect.objectContaining({ tagName: 'deprecated', textSummary: 'use replacement' }),
    ]))
    expect(result.symbols.find(s => s.name === 'count')?.declarationMetadata?.jsdoc?.[0]).toMatchObject({ tagName: 'type', typeExpression: 'number' })
    const typedef = result.symbols.find(s => s.name === 'Options')
    expect(typedef).toMatchObject({ kind: 'type', exported: false, location: { line: 13 } })
    expect(typedef?.declarationMetadata?.jsdoc).toEqual(expect.arrayContaining([expect.objectContaining({ tagName: 'property', parameterName: 'title', typeExpression: 'string' })]))
  })
  it('keeps explicit TypeScript annotations and documentation separate', () => {
    const r = adapter.extractFromSource('a.ts', '/** @return {string} documented */\nexport function run(): number { return 1 }')
    expect(r.symbols[0].signature).toContain('number')
    expect(r.symbols[0].declarationMetadata?.jsdoc?.[0]).toMatchObject({ tagName: 'return', typeExpression: 'string' })
  })
  it('bounds entries, names, descriptions and types with partial evidence and warnings', () => {
    const r = adapter.extractFromSource('a.js', '/**\n' + Array.from({ length: 30 }, () => ` * @param {${'A'.repeat(600)}} ${'p'.repeat(150)} ${'d'.repeat(200)}`).join('\n') + '\n */\nfunction run() {}')
    const tags = r.symbols[0].declarationMetadata?.jsdoc ?? []
    expect(tags).toHaveLength(24)
    expect(tags.every(t => t.status === 'partial' && t.parameterName!.length <= 128 && t.typeExpression!.length <= 512 && t.textSummary!.length <= 160)).toBe(true)
    expect(r.warnings?.length).toBeGreaterThan(0)
  })
  it('does not invent types from unknown or unnamed comments, or trust malformed source spans', () => {
    const r = adapter.extractFromSource('a.js', '/** @mystery whatever */\nconst x = 1;\n/** @typedef */\n// nothing')
    expect(r.symbols.map(s => s.name)).toEqual(['x'])
    expect(r.symbols[0].declarationMetadata?.jsdoc?.[0]).toMatchObject({ status: 'unsupported' })
    expect(adapter.extractFromSource('broken.js', '/** @type {number} */\nfunction bad( {').symbols.every(s => s.location.endLine === undefined)).toBe(true)
  })
  it('preserves Python decorator evidence', () => {
    const r = new PythonAdapter().extractFromSource('a.py', '@route.get("/x")\ndef run(): pass\n')
    expect(r.symbols[0].declarationMetadata?.decorators?.[0]).toMatchObject({ path: 'route.get', expressionKind: 'call' })
    expect(r.symbols[0].declarationMetadata?.jsdoc).toBeUndefined()
  })
  it.each(['object', 'Object[]'])('retains the exact typedef expression %s despite compiler property folding', type => {
    const r = adapter.extractFromSource('a.js', `/** @typedef {${type}} Options\n * @property {string} title\n */`)
    expect(r.symbols.find(s => s.name === 'Options')?.declarationMetadata?.jsdoc?.[0].typeExpression).toBe(type)
  })
  it('preserves the legacy identity of a value sharing a typedef name', () => {
    const root = fixture({ 'a.js': '/**\n * @typedef {string} Value\n */\nconst Value = 1' })
    const { index } = buildIndex({ repoRoot: root, sourceRoots: ['.'] })
    expect(index.files[0].symbols.find(s => s.kind === 'const')?.nodeId).toBe('symbol:a.js#Value')
    const ids = index.files[0].symbols.map(s => s.nodeId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('B05 CommonJS', () => {
  it('retains literal imports, destructured aliases, module bindings and side effects', () => {
    const r = adapter.extractFromSource('a.cjs', 'const service = require("./service");\nconst { run, stop: finish } = require("./service");\nrequire("./bootstrap");')
    expect(r.language).toBe('javascript')
    expect(r.imports).toEqual(['./service', './bootstrap'])
    expect(r.importBindings?.map(b => [b.localName, b.importedName, b.syntaxKind, b.startLine])).toEqual([
      ['service', '*', 'commonjs', 1], ['run', 'run', 'commonjs', 2], ['finish', 'stop', 'commonjs', 2], ['', '', 'commonjs', 3],
    ])
  })
  it.each(['exports.run = run', 'module.exports.run = run', 'module.exports = run', 'module.exports = { run, stop: stopHandler }'])('records supported exports: %s', assignment => {
    const r = adapter.extractFromSource('a.cjs', 'function run() {}\nfunction stopHandler() {}\n' + assignment)
    expect(r.commonJsExports?.every(f => f.resolutionStatus === 'resolved-local')).toBe(true)
    expect(r.commonJsExports?.[0]).toMatchObject({ bindingName: 'run', startLine: 3 })
    expect(r.symbols[0].exported).toBe(true)
  })
  it.each([
    'const require = loader; const x = require("./service")',
    'function f(require) { return require("./service") }',
    'const x = require(variable)', 'const x = require("./" + name)',
    'if (flag) { const x = require("./service") }',
  ])('does not resolve unsupported require: %s', source => {
    const r = adapter.extractFromSource('a.js', source)
    expect(r.imports).toEqual([])
    expect(calls({ 'a.js': source, 'service.js': 'export function run() {}' }).filter(e => e.callee.file)).toEqual([])
  })
  it.each([
    'if (flag) exports.run = run', 'const exports = {}; exports.run = run',
    'let module = {}; module.exports = run', 'exports[name] = run',
    'exports.run = run; exports.run = other',
  ])('does not prove dynamic, conditional or shadowed exports: %s', source => {
    const r = adapter.extractFromSource('a.js', 'function run() {}\nfunction other() {}\n' + source)
    expect(r.commonJsExports?.filter(f => f.resolutionStatus === 'resolved-local')).toEqual([])
    expect(r.symbols.filter(s => s.exported)).toEqual([])
  })
  it('does not create a physical symbol for anonymous expressions', () => {
    const r = adapter.extractFromSource('a.cjs', 'module.exports = () => 1')
    expect(r.symbols).toEqual([])
    expect(r.commonJsExports?.[0]).toMatchObject({ exportedName: null, resolutionStatus: 'observed' })
  })
  it.each([
    'exports.run = run; exports[key] = other',
    'module.exports = { run, ...other }',
    'exports.run = run; delete exports.run',
    'exports.run = run; const alias = exports; alias.run = other',
    'module.exports.run = run; module.exports[key] = other',
    'module.exports = {run}; module.exports = {other}',
    'exports.run = run; exports.run += other',
    'exports.run = run; exports.run++',
    'module.exports = {run}; exports.other = other',
    'exports.run = run; let alias; alias = exports; alias.run = other',
  ])('does not prove exports after unsupported mutation: %s', assignment => {
    const source = 'function run() {}\nfunction other() {}\n' + assignment
    const r = adapter.extractFromSource('a.cjs', source)
    expect(r.commonJsExports?.filter(f => f.resolutionStatus === 'resolved-local')).toEqual([])
    expect(calls({ 'a.cjs': source, 'main.js': 'const {run} = require("./a.cjs"); function main() {run()}' }).filter(e => e.callee.file)).toEqual([])
  })
})

describe('B05 selected mixed source resolution and calls', () => {
  it.each([
    ['./left', ['left.ts'], 'left.ts'], ['./left.js', ['left.ts'], 'left.ts'],
    ['./left.jsx', ['left.tsx'], 'left.tsx'], ['./pkg', ['pkg/index.js'], 'pkg/index.js'],
    ['./left.js', ['left.js', 'left.ts'], 'left.js'], ['./left.ts', ['left.ts', 'left.js'], 'left.ts'],
    ['./left', ['left.js', 'left.ts'], null], ['./left.js', ['left.ts', 'left.tsx'], null],
    ['./left.cjs', ['left.cjs'], 'left.cjs'], ['./left.mjs', ['left.ts'], null],
    ['package', ['package/index.js'], null],
    ['./left.py', ['left.py'], null], ['./left.kt', ['left.kt'], null], ['./left.java', ['left.java'], null],
    ['./left.mjs', ['left.mjs'], null], ['./left.mts', ['left.mts'], null], ['./left.cts', ['left.cts'], null],
  ] as const)('resolves %s in %j conservatively', (spec, files, expected) => {
    expect(adapter.resolveImportToFile(spec, 'consumer.js', files)).toBe(expected)
  })
  it('uses the actual module, alias and exact identities despite same-name exports', () => {
    const edges = calls({ 'left.ts': 'export function run() {}', 'right.js': 'export function run() {}', 'consumer.js': 'import { run as execute } from "./left";\nexport function main() { execute() }' })
    expect(edges).toEqual([expect.objectContaining({ callerNodeId: 'symbol:consumer.js#main', calleeNodeId: 'symbol:left.ts#run', callee: { file: 'left.ts', name: 'execute' } })])
  })
  it('handles default, namespace, named CommonJS and whole-module calls across JS/TS/CJS', () => {
    const edges = calls({
      'a.ts': 'export default function run() {}', 'b.js': 'export function stop() {}',
      'c.cjs': 'function work() {}\nmodule.exports = work',
      'd.js': 'function run() {}\nexports.go = run',
      'main.ts': 'import run from "./a.js"; import * as service from "./b"; const work = require("./c.cjs"); const {go: execute} = require("./d.js"); export function main() { run(); service.stop(); work(); execute(); }',
    })
    expect(edges.map(e => e.calleeNodeId)).toEqual(['symbol:a.ts#run', 'symbol:b.js#stop', 'symbol:c.cjs#work', 'symbol:d.js#run'])
  })
  it.each([
    'import { run } from "./left"; function main(run) { run() }',
    'import { run } from "./left"; function main() { const run = other; run() }',
    'const {run} = require(target); function main() { run() }',
    'import { run } from "external"; function main() { run() }',
    'import type { run } from "./left"; function main() { run() }',
  ])('emits no guessed calls for %s', source => {
    const edges = calls({ 'left.ts': 'export function run() {}', 'right.js': 'export function run() {}', 'main.ts': source })
    expect(edges.filter(e => e.callee.file || e.calleeNodeId)).toEqual([])
  })
  it('leaves ambiguous extensionless bindings and calls unresolved', () => {
    const root = fixture({ 'left.ts': 'export function run() {}', 'left.js': 'export function run() {}', 'main.js': 'import {run} from "./left"; export function main() { run() }' })
    const result = buildIndex({ repoRoot: root, sourceRoots: ['.'], buildCallGraph: true })
    expect(result.index.graph?.fileDeps).toEqual([])
    expect(result.index.files.find(f => f.path === 'main.js')?.importBindings?.[0].resolutionStatus).toBe('ambiguous')
    expect(buildCodeGraph({ symbolIndex: result.index, callGraph: result.callGraph }).edges.filter(e => e.kind === 'calls')).toEqual([])
  })
  it.each(['api.run = other', 'api.run++', 'delete api.run', 'let alias; alias = api; alias.run = other'])('does not resolve mutated namespace properties: %s', mutation => {
    expect(calls({ 'left.js': 'export function run() {}', 'main.ts': `import * as api from "./left"; ${mutation}; function main() {api.run()}` }).filter(e => e.callee.file)).toEqual([])
  })
  it('does not resolve a CommonJS member after its namespace escapes into a mutable alias', () => {
    expect(calls({ 'left.cjs': 'function run() {}\nexports.run = run', 'main.js': 'const api = require("./left.cjs"); const alias = api; alias.run = other; function main(){api.run()}' }).filter(e => e.callee.file)).toEqual([])
  })
  it('distinguishes a named star member from a callable whole-module require', () => {
    expect(calls({ 'left.cjs': 'function run() {}\nmodule.exports = run', 'main.js': 'const {"*": execute} = require("./left.cjs"); function main(){execute()}' }).filter(e => e.callee.file)).toEqual([])
  })
  it('does not emit a JS dependency edge to a selected Python source', () => {
    const root = fixture({ 'a.py': 'def run(): pass', 'main.js': 'const api = require("./a.py")' })
    const built = buildIndex({ repoRoot: root, sourceRoots: ['.'] })
    expect(built.index.graph?.fileDeps).toEqual([])
    expect(built.index.files.find(f => f.path === 'main.js')?.importBindings?.[0].resolutionStatus).toBe('unresolved')
  })
  it('resolves local ES export aliases and CommonJS default interop', () => {
    expect(calls({ 'a.js': 'function run() {}\nexport {run as go}', 'b.cjs': 'function run() {}\nmodule.exports = run', 'main.ts': 'import {go} from "./a"; import run from "./b.cjs"; function main() {go(); run()}' }).map(e => e.calleeNodeId)).toEqual(['symbol:a.js#run', 'symbol:b.cjs#run'])
  })
  it('resolves a default export of a uniquely named local declaration', () => {
    expect(calls({ 'a.js': 'const run = () => 1; export default run', 'main.ts': 'import execute from "./a.js"; function main(){execute()}' }).map(e => e.calleeNodeId)).toEqual(['symbol:a.js#run'])
  })
  it('does not turn whole-module export binding names into named members or follow re-exports by coincidence', () => {
    const files = { 'whole.cjs': 'function run() {}\nmodule.exports = run', 'other.js': 'export function run() {}', 'barrel.js': 'function run() {}\nexport {run} from "./other"', 'types.ts': 'function run() {}\nexport type {run}', 'main.ts': 'const {run} = require("./whole.cjs"); import {run as barrel} from "./barrel"; import {run as typed} from "./types"; function main(){run(); barrel(); typed()}' }
    expect(calls(files).filter(e => e.callee.file)).toEqual([])
  })
})

describe('B05 persistence and integration', () => {
  it('indexes static source containing a top-level execution trap without running it', () => {
    const root = fixture({ 'trap.cjs': 'throw new Error("source must never execute");\nfunction run() {}\nexports.run = run' })
    expect(buildIndex({ repoRoot: root, sourceRoots: ['.'] }).index.files[0].symbols[0].name).toBe('run')
  })
  it('refreshes unresolved unchanged bindings when a selected target is added', () => {
    const root = fixture({ 'main.js': 'import {run} from "./added"; function main(){run()}' })
    const before = buildIndex({ repoRoot: root, sourceRoots: ['.'] })
    writeFileSync(join(root, 'added.ts'), 'export function run() {}')
    const full = buildIndex({ repoRoot: root, sourceRoots: ['.'] })
    const partial = buildPartialSymbolIndex({ repoRoot: root, sourceRoots: ['.'], buildCallGraph: false, discoveryFiles: full.discovery.files, unchangedPaths: new Set(['main.js']), previousFileSummariesByPath: new Map(before.index.files.map(f => [f.path, f])), previousCacheEntriesByPath: new Map() })
    expect(partial.index.files).toEqual(full.index.files)
    expect(partial.index.graph).toEqual(full.index.graph)
    expect(before.index.files[0].importBindings?.[0].resolutionStatus).toBe('unresolved')
  })
  it('discovers .cjs and preserves full/partial semantic evidence and exact graph edges', () => {
    const root = fixture({ 'docs.js': docs, 'worker.cjs': 'function run() {}\nexports.run = run', 'main.ts': 'const { run } = require("./worker.cjs"); export function main() { run() }' })
    const initial = buildIndex({ repoRoot: root, sourceRoots: ['.'], buildCallGraph: true })
    writeFileSync(join(root, 'main.ts'), 'const { run } = require("./worker.cjs"); export function main() { run();\n run() }')
    const full = buildIndex({ repoRoot: root, sourceRoots: ['.'], buildCallGraph: true })
    const partial = buildPartialSymbolIndex({ repoRoot: root, sourceRoots: ['.'], buildCallGraph: true, discoveryFiles: full.discovery.files,
      unchangedPaths: new Set(['docs.js', 'worker.cjs']), previousFileSummariesByPath: new Map(initial.index.files.map(f => [f.path, f])),
      previousCacheEntriesByPath: new Map([...initial.fileExtractionMeta].map(([path, meta]) => [path, { path, contentHash: '', sizeBytes: 0, ...meta }])),
    })
    expect(partial.reusedPaths).toEqual(['docs.js', 'worker.cjs'])
    expect(partial.index.files).toEqual(full.index.files)
    expect(partial.index.graph).toEqual(full.index.graph)
    expect(partial.callGraph?.edges).toEqual(full.callGraph?.edges)
    expect(buildCodeGraph({ symbolIndex: full.index, callGraph: full.callGraph }).edges.filter(e => e.kind === 'calls')).toHaveLength(2)
    expect(full.index.schemaVersion).toBe('3')
    expect(buildCodeGraph({ symbolIndex: full.index }).schemaVersion).toBe('1.1.0')
    expect(CACHE_SCHEMA_VERSION).toBe('1.3.0')
    expect(JSON.parse(JSON.stringify(partial.index)).files).toEqual(full.index.files)
  })
  it('makes JSDoc descriptions searchable through the shared index', async () => {
    const root = fixture({ 'src/docs.js': '/** @param {string} x uniqueDocumentationNeedle */\nexport function run(x) {}' })
    await runIndexCommand({ root, src: ['src'], out: 'retrieval' })
    const index = JSON.parse(readFileSync(join(root, 'retrieval/symbol-index.json'), 'utf8'))
    const result = searchIndex({ resolved: readIndexManifest(join(root, 'retrieval')), symbolIndex: index, codeGraph: buildCodeGraph({ symbolIndex: index }), query: 'uniqueDocumentationNeedle', limit: 5 })
    expect(result.results.some(r => r.id === 'symbol:src/docs.js#run')).toBe(true)
  })
  it('reports documentation-only changes through the existing symbol diff', () => {
    const root = fixture({ 'a.js': '/** @param {string} x before */\nexport function run(x) {}' })
    const a = buildIndex({ repoRoot: root, sourceRoots: ['.'] }).index
    writeFileSync(join(root, 'a.js'), '/** @param {string} x after */\nexport function run(x) {}')
    const b = buildIndex({ repoRoot: root, sourceRoots: ['.'] }).index
    expect(buildSymbolIndexDiff(a, b).symbolsChanged).toEqual(['symbol:a.js#run'])
  })
  it('invalidates a B04 fingerprint before no-change reuse and preserves real incremental parity', async () => {
    const root = fixture({
      'src/a.js': '/** @returns {number} documented */\nexport function run() {return 1}',
      'src/b.ts': 'import {run} from "./a.js"; export function b() {run()}',
      'src/c.cjs': 'const {b} = require("./b"); function main() {b()}\nmodule.exports = main',
    })
    const options = { root, src: ['src'], out: 'incremental', incremental: true, callGraph: true }
    const oldFingerprint = (input: Parameters<typeof computeConfigFingerprint>[0]) => {
      const normalized = {
        pythonExtractionRevision: 'v1.14.0-b04',
        sourceRoots: [...input.sourceRoots].map(p => p.replace(/\\/g, '/')).sort(),
        excludePatterns: [...input.excludePatterns].map(v => v.trim()).sort(),
        callGraphEnabled: input.callGraphEnabled, language: input.language,
        defaultIgnoredDirectoryNames: [...input.defaultIgnoredDirectoryNames].sort(),
        defaultIgnoredDirectoryPrefixes: [...input.defaultIgnoredDirectoryPrefixes].sort(),
        defaultFileExcludePatterns: [...input.defaultFileExcludePatterns].sort(),
        androidEvidenceFingerprint: input.androidEvidenceFingerprint,
        androidGradleEvidenceFingerprint: input.androidGradleEvidenceFingerprint,
        androidManifestEvidenceFingerprint: input.androidManifestEvidenceFingerprint,
        androidResourcesEvidenceFingerprint: input.androidResourcesEvidenceFingerprint,
        androidNavigationXmlEvidenceFingerprint: input.androidNavigationXmlEvidenceFingerprint,
        androidTestEvidenceFingerprint: input.androidTestEvidenceFingerprint,
      }
      return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
    }
    const spy = vi.spyOn(cacheMetadata, 'computeConfigFingerprint').mockImplementationOnce(oldFingerprint)
    try { await runIndexCommand(options) } finally { spy.mockRestore() }
    const rebuilt = await runIndexCommand(options)
    expect(rebuilt.mode === 'index' && rebuilt.cache.mode).toBe('incremental-full-config-changed')
    writeFileSync(join(root, 'src/b.ts'), 'import {run} from "./a.js"; export function b() {\nrun();\nrun()}')
    const partial = await runIndexCommand(options)
    expect(partial.mode === 'index' && partial.cache.mode).toContain('incremental-partial')
    await runIndexCommand({ ...options, out: 'full', incremental: false })
    for (const artifact of ['symbol-index.json', 'code-graph.json', 'call-graph.json']) {
      const a = JSON.parse(readFileSync(join(root, 'incremental', artifact), 'utf8'))
      const b = JSON.parse(readFileSync(join(root, 'full', artifact), 'utf8'))
      for (const value of [a, b]) { delete value.buildTime; delete value.createdAt }
      expect(a).toEqual(b)
    }
  })
})
