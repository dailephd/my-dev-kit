import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { PythonAdapter } from '../../src/languages/python/adapter.js'
import { assignDeclarationIdentities } from '../../src/symbol-index/declarationIdentity.js'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { buildCodeGraph } from '../../src/graph/buildCodeGraph.js'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { readIndexManifest } from '../../src/indexing/readIndexManifest.js'
import * as cacheMetadata from '../../src/indexing/cacheMetadata.js'
import { buildPartialSymbolIndex } from '../../src/indexing/partialRebuild.js'
import { searchIndex } from '../../src/search/searchIndex.js'
import { resolveSymbolTarget } from '../../src/lookup/resolveSourceTarget.js'
import { buildCodeGraphDiff } from '../../src/graph-diff/buildCodeGraphDiff.js'
import { buildSymbolIndexDiff } from '../../src/graph-diff/buildSymbolIndexDiff.js'
import { spawnSync } from 'node:child_process'
import type { SymbolIndex } from '../../src/symbol-index/types.js'

const adapter = new PythonAdapter()
const taskRoot = resolve('.my-dev-kit-workflow/tmp/v1.14.0-b03-20261019/tests')
function fixture(files: Record<string, string>) {
  mkdirSync(taskRoot, { recursive: true })
  const root = mkdtempSync(join(taskRoot, 'python-'))
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), source)
  }
  return root
}
function calls(files: Record<string, string>) {
  return adapter.extractCallGraphEdges(Object.entries(files).map(([filePath, sourceText]) => ({ filePath, sourceText })))
}
const classes = `class A:
    LIMIT = 2
    value: int = 1
    other = 3
    def run(self):
        return self.work()
    async def work(self):
        return 1
    @classmethod
    def create(cls):
        return cls.finish()
    @classmethod
    def finish(cls):
        return 1
    @staticmethod
    def normalize(x):
        return x
    @property
    def prop(self):
        return 1
    class Inner:
        def run(self):
            return 2
class B:
    def run(self):
        return self.work()
    def work(self):
        return 3
def run():
    A.normalize(1)
    A.create()
`

describe('v1.14 B03 Python extraction', () => {
  it('preserves every alias, grouped name, relative level and wildcard without claiming resolution', () => {
    const r = adapter.extractFromSource('src/a.py', `import package.module
import package.module as alias
from package import item
from package import item as renamed
from . import sibling
from ..common import helper as local_helper
from package import left, right as renamed_right
from package import *
`)
    expect(r.importBindings?.map(b => [b.localName, b.importedName, b.sourceSpecifier, b.relativeLevel, b.startLine, b.endLine])).toEqual([
      ['package', 'package.module', 'package.module', 0, 1, 1], ['alias', 'package.module', 'package.module', 0, 2, 2],
      ['item', 'item', 'package', 0, 3, 3], ['renamed', 'item', 'package', 0, 4, 4], ['sibling', 'sibling', '.', 1, 5, 5],
      ['local_helper', 'helper', '..common', 2, 6, 6], ['left', 'left', 'package', 0, 7, 7], ['renamed_right', 'right', 'package', 0, 7, 7], ['*', '*', 'package', 0, 8, 8],
    ])
    expect(r.importBindings?.every(b => b.syntaxKind === 'python' && b.resolutionStatus === 'observed')).toBe(true)
    expect(r.importBindings?.at(-1)?.wildcard).toBe(true)
    expect(r.imports).toEqual(['package.module', 'package', 'from . import sibling', 'from ..common import helper'])
  })

  it('extracts class fields, constants, async methods and nested owners with parser spans and legacy top-level IDs', () => {
    const r = adapter.extractFromSource('src/classes.py', classes)
    const symbols = assignDeclarationIdentities('src/classes.py', r.symbols)
    expect(symbols.find(s => s.qualifiedName === 'A.value')).toMatchObject({ name: 'value', kind: 'field', ownerKey: 'python/class:A', location: { line: 3, endLine: 3 } })
    expect(symbols.find(s => s.qualifiedName === 'A.LIMIT')?.kind).toBe('const')
    expect(symbols.find(s => s.qualifiedName === 'A.other')?.kind).toBe('field')
    expect(symbols.find(s => s.qualifiedName === 'A.work')).toMatchObject({ kind: 'method', location: { line: 7, endLine: 8 } })
    expect(symbols.find(s => s.qualifiedName === 'A.Inner.run')).toMatchObject({ ownerKey: 'python/class:A/class:Inner', location: { line: 22, endLine: 23 } })
    expect(symbols.filter(s => s.name === 'run').map(s => s.nodeId)).toEqual([
      'symbolq:src%2Fclasses.py#python%2Fclass%3AA#run#0', 'symbolq:src%2Fclasses.py#python%2Fclass%3AA%2Fclass%3AInner#run#0',
      'symbolq:src%2Fclasses.py#python%2Fclass%3AB#run#0', 'symbol:src/classes.py#run',
    ])
    expect(new Set(symbols.map(s => s.nodeId)).size).toBe(symbols.length)
    expect(adapter.extractFromSource('x.py', '变量 = 1\nlimit: annotations.Final[int] = 2\n').symbols.map(s => [s.name, s.kind])).toEqual([['limit', 'const']])
    expect(symbols.filter(s => s.qualifiedName === 'A.prop')).toHaveLength(1)
    expect(adapter.extractFromSource('x.py', 'class C:\n    def f(self):\n        self.dynamic = 1\n').symbols.map(s => s.name)).toEqual(['C', 'f'])
    expect(adapter.extractFromSource('x.py', 'class C:\n    left, [right, *rest] = values\n').symbols.map(s => [s.name, s.kind])).toEqual([
      ['C', 'class'], ['left', 'field'], ['right', 'field'], ['rest', 'field'],
    ])
  })

  it('records decorator syntax, scalar literals, mixed/dynamic arguments and strict metadata caps', () => {
    const source = `@router.get("/items", tags=["items"], enabled=True, count=2, empty=None)
def items(): pass
@dec(compute())
def dynamic(): pass
@dec
def simple(): pass
@ns.decorator
def attribute(): pass
@factory()[0]
def unsupported(): pass
`
    const ds = adapter.extractFromSource('x.py', source).symbols.map(s => s.declarationMetadata?.decorators?.[0])
    expect(ds[0]).toEqual({ path: 'router.get', expressionKind: 'call', startLine: 1, endLine: 1, argumentShape: 'mixed', literalArguments: [
      { positionalIndex: 0, value: '/items' }, { keywordName: 'enabled', value: true }, { keywordName: 'count', value: 2 }, { keywordName: 'empty', value: null },
    ] })
    expect(ds[1]).toMatchObject({ argumentShape: 'dynamic', expressionKind: 'call' })
    expect(ds[2]).toMatchObject({ path: 'dec', argumentShape: 'none', expressionKind: 'name' })
    expect(ds[3]).toMatchObject({ path: 'ns.decorator', expressionKind: 'attribute' })
    expect(ds[4]).toMatchObject({ expressionKind: 'unsupported' })
    const capped = adapter.extractFromSource('x.py', Array.from({ length: 30 }, () => '@dec(' + Array.from({ length: 30 }, () => '"' + 'x'.repeat(400) + '"').join(',') + ')').join('\n') + '\ndef x(): pass\n')
    expect(capped.symbols[0].declarationMetadata?.decorators).toHaveLength(16)
    expect(capped.symbols[0].declarationMetadata?.decorators?.every(d => d.path === 'dec' && d.expressionKind === 'call' && d.argumentShape === 'literal')).toBe(true)
    expect(JSON.stringify(capped.symbols[0].declarationMetadata).length).toBeLessThan(5000)
    expect(adapter.extractFromSource('x.py', '@dec(1, x=True)\ndef f(): pass\n').symbols[0].declarationMetadata?.decorators?.[0].argumentShape).toBe('literal')
    expect(adapter.extractFromSource('x.py', '@dec(-1, +2.5)\ndef f(): pass\n').symbols[0].declarationMetadata?.decorators?.[0].literalArguments).toEqual([{ positionalIndex: 0, value: -1 }, { positionalIndex: 1, value: 2.5 }])
    const overflow = 'class C:\n' + '    @staticmethod\n'.repeat(16) + '    @replace\n    def work(): pass\n    def use(self): self.work()\n'
    expect(calls({ 'x.py': overflow }).every(e => e.calleeNodeId === undefined)).toBe(true)
  })

  it('resolves named aliases, module aliases, dotted imports, sibling modules and relative calls to exact declarations', () => {
    const files = {
      'src/pkg/service.py': 'def helper(): return 1\n',
      'src/pkg/sub/calls.py': `from ..service import helper as renamed
from .. import service
import pkg.service as module
import pkg.service
from pkg.service import helper
def local(): return 1
def caller():
    local()
    renamed()
    module.helper()
    pkg.service.helper()
    service.helper()
    helper()
`,
    }
    const edges = calls(files)
    expect(edges).toHaveLength(6)
    expect(edges.every(e => e.callerNodeId === 'symbol:src/pkg/sub/calls.py#caller')).toBe(true)
    expect(edges[0].calleeNodeId).toBe('symbol:src/pkg/sub/calls.py#local')
    expect(edges.slice(1).map(e => e.calleeNodeId)).toEqual(Array(5).fill('symbol:src/pkg/service.py#helper'))
    expect(calls(Object.fromEntries(Object.entries(files).reverse()))).toEqual(edges)
    expect(calls({ 'src/pkg/service.py': files['src/pkg/service.py'], 'src/c.py': 'import pkg.service as pkg\ndef caller(): pkg.helper()\n' })[0].calleeNodeId).toBe('symbol:src/pkg/service.py#helper')
  })

  it('omits guessed targets for unrelated names, wildcard/conditional imports, missing names, dynamic imports and shadowing', () => {
    const files = {
      'src/a.py': 'def same(): pass\n', 'src/b.py': 'def same(): pass\n',
      'src/calls.py': `import importlib
if FLAG:
    from a import same as conditional
from a import absent
from a import *
module = importlib.import_module("a")
def caller(instance):
    same()
    conditional()
    absent()
    module.same()
    instance.same()
    super().same()
`,
    }
    expect(calls(files).every(e => e.callee.file === null && e.calleeNodeId === undefined)).toBe(true)
    expect(calls({ 'src/a.py': files['src/a.py'], 'src/c.py': 'from a import same\ndef caller(same):\n    same()\n' })[0].calleeNodeId).toBeUndefined()
    expect(calls({ 'src/a.py': files['src/a.py'], 'src/c.py': 'from a import same\nfrom b import *\ndef caller(): same()\n' })[0].calleeNodeId).toBeUndefined()
    expect(calls({ 'src/a.py': 'def __getattr__(name): pass\ndef same(): pass\n', 'src/c.py': 'from a import same\ndef caller(): same()\n' })[0].calleeNodeId).toBeUndefined()
  })

  it('rejects ambiguous module/package candidates and selected-root exclusions', () => {
    const base = { 'src/c.py': 'from service import helper\ndef call(): helper()\n', 'src/one/service.py': 'def helper(): pass\n', 'src/two/service.py': 'def helper(): pass\n' }
    expect(calls(base)[0].callee.file).toBeNull()
    expect(calls({ ...base, 'src/two/service.py': 'def malformed(:\n' })[0].callee.file).toBeNull()
    expect(adapter.resolveImportToFile('service', 'src/c.py', Object.keys(base))).toBeNull()
    expect(calls({ 'src/c.py': base['src/c.py'] })[0].callee.file).toBeNull()
    expect(calls({ 'src/c.py': base['src/c.py'], 'src/service.py': 'def helper(): pass\n', 'src/service/__init__.py': 'def helper(): pass\n' })[0].callee.file).toBeNull()
    expect(calls({ 'src/pkg/__init__.py': 'service = unknown\n', 'src/pkg/service.py': 'def helper(): pass\n', 'src/c.py': 'from pkg import service\ndef call(): service.helper()\n' })[0].callee.file).toBeNull()
  })

  it('does not assign unindexed lambda bodies to the enclosing function caller', () => {
    const edges = calls({ 'x.py': 'def helper(): pass\ndef caller():\n    return lambda helper: helper()\n' })
    expect(edges.filter(e => e.calleeNodeId)).toEqual([])
  })

  it('keeps self/cls and explicit static/class methods distinct and leaves dynamic or inherited dispatch unresolved', () => {
    const edges = calls({ 'src/classes.py': classes })
    expect(edges.map(e => e.calleeNodeId)).toEqual([
      'symbolq:src%2Fclasses.py#python%2Fclass%3AA#work#0', 'symbolq:src%2Fclasses.py#python%2Fclass%3AA#finish#0',
      'symbolq:src%2Fclasses.py#python%2Fclass%3AB#work#0', 'symbolq:src%2Fclasses.py#python%2Fclass%3AA#normalize#0', 'symbolq:src%2Fclasses.py#python%2Fclass%3AA#create#0',
    ])
    const negative = `def work(): pass
class Base:
    def work(self): pass
class Child(Base):
    def run(self, other):
        self.work()
        other.work()
        super().work()
        getattr(self, "work")()
    @replace
    def unknown(self):
        self.work()
    @replace
    def replaced(self): pass
    def use(self):
        self.replaced()
`
    expect(calls({ 'x.py': negative }).every(e => e.calleeNodeId === undefined)).toBe(true)
    for (const body of [
      'class C(metaclass=Meta):\n    @staticmethod\n    def work(): pass\ndef caller(): C.work()\n',
      '@replace\nclass C:\n    def work(self): pass\n    def run(self): self.work()\n',
      'class C:\n    def work(self): pass\n    work = other\n    def run(self): self.work()\n',
      'class C:\n    def work(self): pass\n    if FLAG:\n        work = other\n    def run(self): self.work()\n',
      'class C:\n    def work(self): pass\n    def __init__(self): self.work = other\n    def run(self): self.work()\n',
    ]) expect(calls({ 'x.py': body }).every(e => e.calleeNodeId === undefined)).toBe(true)
  })

  it('rejects unverified exact graph IDs while retaining real method call topology', () => {
    expect(calls({ 'x.py': 'def helper(): pass\ndef caller(): helper(); helper()\n' })).toHaveLength(1)
    const root = fixture({ 'src/classes.py': classes })
    const built = buildIndex({ repoRoot: root, sourceRoots: ['src'], buildCallGraph: true })
    const graph = buildCodeGraph({ symbolIndex: built.index, callGraph: built.callGraph })
    expect(graph.edges.filter(e => e.kind === 'calls')).toHaveLength(5)
    const forged = { ...built.callGraph!, edges: [{ ...built.callGraph!.edges[0], calleeNodeId: 'invented' }] }
    expect(buildCodeGraph({ symbolIndex: built.index, callGraph: forged }).edges.filter(e => e.kind === 'calls')).toEqual([])
    const duplicateAlias = { ...built.callGraph!, edges: [built.callGraph!.edges[0], { ...built.callGraph!.edges[0], callee: { ...built.callGraph!.edges[0].callee, name: 'anotherAlias' } }] }
    expect(buildCodeGraph({ symbolIndex: built.index, callGraph: duplicateAlias }).edges.filter(e => e.kind === 'calls')).toHaveLength(1)
  })

  it('supports exact qualified search and bounded source, unknown spans, graph diff and serialized reload', async () => {
    const root = fixture({ 'src/classes.py': classes })
    const built = buildIndex({ repoRoot: root, sourceRoots: ['src'], buildCallGraph: true })
    const idx: SymbolIndex = JSON.parse(JSON.stringify(built.index))
    const graph = buildCodeGraph({ symbolIndex: idx, callGraph: built.callGraph })
    const id = 'symbolq:src%2Fclasses.py#python%2Fclass%3AA#run#0'
    await runIndexCommand({ root, src: ['src'], out: 'retrieval', callGraph: true })
    expect(searchIndex({ resolved: readIndexManifest(join(root, 'retrieval')), symbolIndex: idx, codeGraph: graph, query: 'A.run', limit: 20 }).results.some(r => r.id === id)).toBe(true)
    expect(resolveSymbolTarget(idx, 'src/classes.py', 'run', 160, id)).toMatchObject({ nodeId: id, startLine: 5, endLine: 6, symbolEndLine: 6 })
    const cli = (args: string[]) => spawnSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), 'src/cli.ts', ...args], { encoding: 'utf8', shell: false })
    const lookup = cli(['lookup', '--index', join(root, 'retrieval'), '--node', id, '--json'])
    expect(lookup.status).toBe(0)
    expect(lookup.stdout).toContain(id)
    const source = cli(['source', '--index', join(root, 'retrieval'), '--node', id, '--format', 'json'])
    expect(source.status).toBe(0)
    expect(source.stdout).toContain('return self.work()')
    expect(() => resolveSymbolTarget(idx, 'src/classes.py', 'run', 160)).toThrow(/ambiguous/i)
    const symbol = idx.files[0].symbols.find(s => s.nodeId === id)!
    delete symbol.location.endLine
    expect(resolveSymbolTarget(idx, 'src/classes.py', 'run', 160, id).warnings).not.toEqual([])
    const changed = JSON.parse(JSON.stringify(built.index)) as SymbolIndex
    changed.files[0].symbols = changed.files[0].symbols.filter(s => s.nodeId !== id)
    const diff = buildCodeGraphDiff(graph, buildCodeGraph({ symbolIndex: changed }))
    expect(diff.nodes.removed.map(n => n.id)).toEqual([id])
    expect(idx.graph?.symbols.find(s => s.name === 'prop')?.declarationMetadata?.decorators?.[0].path).toBe('property')
    const metadataChanged = JSON.parse(JSON.stringify(built.index)) as SymbolIndex
    metadataChanged.files[0].symbols.find(s => s.qualifiedName === 'A.prop')!.declarationMetadata!.decorators![0].path = 'changed'
    expect(buildSymbolIndexDiff(built.index, metadataChanged).symbolsChanged).toEqual(['symbolq:src%2Fclasses.py#python%2Fclass%3AA#prop#0'])
  })

  it('retains metadata and exact call topology through real incremental reuse and a changed member', async () => {
    const root = fixture({ 'src/classes.py': classes, 'src/aliases.py': 'from classes import run as execute\ndef caller(): execute()\n' })
    const options = { root, src: ['src'], out: 'incremental', incremental: true, callGraph: true }
    await runIndexCommand(options)
    writeFileSync(join(root, 'src/aliases.py'), 'from classes import run as execute\ndef caller():\n    execute()\n')
    const partial = await runIndexCommand(options)
    expect(partial.mode === 'index' && partial.cache.mode).toContain('incremental-partial')
    await runIndexCommand({ ...options, out: 'full', incremental: false })
    for (const artifact of ['symbol-index.json', 'code-graph.json', 'call-graph.json']) {
      const a = JSON.parse(readFileSync(join(root, 'incremental', artifact), 'utf8'))
      const b = JSON.parse(readFileSync(join(root, 'full', artifact), 'utf8'))
      delete a.buildTime; delete b.buildTime; delete a.createdAt; delete b.createdAt
      expect(a).toEqual(b)
    }
    writeFileSync(join(root, 'src/classes.py'), classes.replace('return 3', 'return 33'))
    await runIndexCommand(options)
    await runIndexCommand({ ...options, out: 'full-after', incremental: false })
    const read = (out: string) => JSON.parse(readFileSync(join(root, out, 'symbol-index.json'), 'utf8'))
    expect(read('incremental').files).toEqual(read('full-after').files)
  })

  it('re-extracts B02 Python summaries lacking B03 evidence during partial reuse', () => {
    const root = fixture({ 'src/classes.py': classes })
    const old = buildIndex({ repoRoot: root, sourceRoots: ['src'] })
    delete old.index.files[0].importBindings
    old.index.files[0].symbols = old.index.files[0].symbols.filter(s => !s.ownerKey)
    const partial = buildPartialSymbolIndex({ repoRoot: root, sourceRoots: ['src'], buildCallGraph: false, discoveryFiles: old.discovery.files, unchangedPaths: new Set(['src/classes.py']), previousFileSummariesByPath: new Map([['src/classes.py', old.index.files[0]]]), previousCacheEntriesByPath: new Map() })
    expect(partial.freshlyExtractedPaths).toEqual(['src/classes.py'])
    expect(partial.index.files[0].symbols.some(s => s.qualifiedName === 'A.run')).toBe(true)
  })

  it('invalidates the B02 extraction fingerprint even when source content has not changed', async () => {
    // Freeze the B02 normalized fingerprint policy, independently of the new producer.
    const { createHash } = await import('node:crypto')
    const root = fixture({ 'src/classes.py': classes })
    const fingerprint = vi.spyOn(cacheMetadata, 'computeConfigFingerprint').mockImplementation(input => {
      const normalized = {
        sourceRoots: [...input.sourceRoots].map(s => s.replace(/\\/g, '/')).sort(),
        excludePatterns: [...input.excludePatterns].map(s => s.trim()).sort(),
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
    })
    const options = { root, src: ['src'], out: 'index', incremental: true }
    try { await runIndexCommand(options) } finally { fingerprint.mockRestore() }
    const refreshed = await runIndexCommand(options)
    expect(refreshed.mode === 'index' && refreshed.cache.mode).toBe('incremental-full-config-changed')
    const cache = JSON.parse(readFileSync(join(root, 'index/cache-metadata.json'), 'utf8'))
    expect(cache.cacheSchemaVersion).toBe('1.3.0')
  })

  it('reports malformed Python without executing target code and produces deterministic bounded evidence', () => {
    const bad = adapter.extractFromSource('x.py', 'def broken(:\n pass\n')
    expect(bad.symbols).toEqual([])
    expect(bad.warnings?.[0]).toContain('python-extraction')
    const source = 'raise RuntimeError("must never execute")\n' + classes
    expect(adapter.extractFromSource('x.py', source)).toEqual(adapter.extractFromSource('x.py', source))
  })

  it('reports missing interpreters conservatively', async () => {
    vi.resetModules()
    vi.doMock('node:child_process', () => ({ spawnSync: () => ({ error: new Error('ENOENT'), status: null }) }))
    try {
      const { PythonAdapter: Missing } = await import('../../src/languages/python/adapter.js')
      const r = new Missing().extractFromSource('x.py', 'def valid(): pass\n')
      expect(r.symbols).toEqual([])
      expect(r.warnings?.[0]).toContain('interpreter not found')
    } finally { vi.doUnmock('node:child_process'); vi.resetModules() }
  })

  it('isolates parser startup and parses Unicode target text without executing it', async () => {
    vi.resetModules()
    const args: string[][] = []
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>()
      return { ...actual, spawnSync: ((...input: Parameters<typeof actual.spawnSync>) => {
        args.push([...(input[1] as string[] ?? [])])
        return actual.spawnSync(...input)
      }) as typeof actual.spawnSync }
    })
    try {
      const { PythonAdapter: Isolated } = await import('../../src/languages/python/adapter.js')
      const r = new Isolated().extractFromSource('x.py', 'raise RuntimeError("target must not execute")\nclass 工作者:\n    def run(self): pass\n')
      expect(r.symbols.map(s => s.name)).toEqual(['工作者', 'run'])
      expect(r.warnings).toBeUndefined()
      expect(args.some(argv => argv[0] === '-I' && argv[1] === '-S' && argv[2] === '-c')).toBe(true)
    } finally { vi.doUnmock('node:child_process'); vi.resetModules() }
  })
})
