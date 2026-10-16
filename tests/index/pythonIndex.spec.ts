import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { PythonAdapter } from '../../src/languages/python/adapter.js'

// Pass-through spawnSync wrapper; a test may rewrite only the symbol-extraction
// script's result to simulate AST output the real interpreter cannot produce.
const symbolScriptOverride = vi.hoisted(() => ({
  transform: null as null | ((result: Record<string, unknown>) => Record<string, unknown>),
}))
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawnSync: ((...args: Parameters<typeof actual.spawnSync>) => {
      const result = actual.spawnSync(...args) as unknown as Record<string, unknown>
      const argv = args[1] as string[] | undefined
      const isSymbolScript =
        argv?.[0] === '-c' && typeof argv[1] === 'string' && argv[1].includes('json.dumps({"symbols": symbols})')
      return symbolScriptOverride.transform && isSymbolScript ? symbolScriptOverride.transform(result) : result
    }) as unknown as typeof actual.spawnSync,
  }
})
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'
import type { CallGraph, SymbolIndex } from '../../src/symbol-index/types.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function makeTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mdk-python-'))
  tempDirs.push(dir)
  return dir
}

function createPythonFixture(root: string): void {
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })

  writeFileSync(
    join(src, 'utils.py'),
    `"""Utilities."""

MAX_RETRIES = 3

def format_name(first, last):
    """Return full name."""
    return f"{first} {last}"

def _private_helper(x):
    return x

class Formatter:
    """Formats output."""
    def format(self, val):
        return str(val)
`
  )

  writeFileSync(
    join(src, 'main.py'),
    `"""Main module."""

import os
from utils import format_name, Formatter

__all__ = ["greet", "UserService"]

APP_NAME = "Test"

def greet(name):
    """Greet a user."""
    return _build_msg("Hello, {name}!", name=name)

async def fetch_user(uid):
    """Fetch a user."""
    return {"id": uid}

def _build_msg(tpl, **kw):
    """Private builder."""
    return tpl.format(**kw)

class UserService:
    """Service for users."""
    def __init__(self, url):
        self.url = url

    def normalize(self, value):
        return value.strip()

    def describe(self, first, last):
        return self.normalize(format_name(first, last))
`
  )
}

function readJson<T>(dir: string, filename: string): T {
  return JSON.parse(readFileSync(join(dir, filename), 'utf8')) as T
}

describe('Python indexing', () => {
  it('accepts --language python and succeeds', async () => {
    const root = makeTemp()
    createPythonFixture(root)
    const result = await runIndexCommand({ root, src: ['src'], language: 'python', out: '.mdk-out' })
    expect(result.manifest.languages).toContain('python')
    expect(result.manifest.summary.fileCount).toBe(2)
  })

  it('includes python language in manifest', async () => {
    const root = makeTemp()
    createPythonFixture(root)
    const result = await runIndexCommand({ root, src: ['src'], language: 'python', out: '.mdk-out' })
    expect(result.manifest.languages).toEqual(['python'])
  })

  it('produces symbol-index.json with Python file summaries', async () => {
    const root = makeTemp()
    createPythonFixture(root)
    const result = await runIndexCommand({ root, src: ['src'], language: 'python', out: '.mdk-out' })
    const idx = readJson<SymbolIndex>(result.outputDir, 'symbol-index.json')
    expect(idx.fileCount).toBe(2)
    const mainFile = idx.files.find((f) => f.path.endsWith('main.py'))
    expect(mainFile).toBeDefined()
    expect(mainFile!.language).toBe('python')
  })

  it('extracts Python functions as symbols', async () => {
    const root = makeTemp()
    createPythonFixture(root)
    const result = await runIndexCommand({ root, src: ['src'], language: 'python', out: '.mdk-out' })
    const idx = readJson<SymbolIndex>(result.outputDir, 'symbol-index.json')
    const mainFile = idx.files.find((f) => f.path.endsWith('main.py'))!
    const fns = mainFile.symbols.filter((s) => s.kind === 'function')
    const names = fns.map((s) => s.name)
    expect(names).toContain('greet')
    expect(names).toContain('fetch_user')
    expect(names).toContain('_build_msg')
  })

  it('extracts Python classes as symbols', async () => {
    const root = makeTemp()
    createPythonFixture(root)
    const result = await runIndexCommand({ root, src: ['src'], language: 'python', out: '.mdk-out' })
    const idx = readJson<SymbolIndex>(result.outputDir, 'symbol-index.json')
    const mainFile = idx.files.find((f) => f.path.endsWith('main.py'))!
    const classes = mainFile.symbols.filter((s) => s.kind === 'class')
    expect(classes.map((s) => s.name)).toContain('UserService')
  })

  it('marks __all__ members as exported and others as unexported', async () => {
    const root = makeTemp()
    createPythonFixture(root)
    const result = await runIndexCommand({ root, src: ['src'], language: 'python', out: '.mdk-out' })
    const idx = readJson<SymbolIndex>(result.outputDir, 'symbol-index.json')
    const mainFile = idx.files.find((f) => f.path.endsWith('main.py'))!
    const greet = mainFile.symbols.find((s) => s.name === 'greet')
    const build = mainFile.symbols.find((s) => s.name === '_build_msg')
    expect(greet!.exported).toBe(true)
    expect(build!.exported).toBe(false)
  })

  it('extracts Python imports', async () => {
    const root = makeTemp()
    createPythonFixture(root)
    const result = await runIndexCommand({ root, src: ['src'], language: 'python', out: '.mdk-out' })
    const idx = readJson<SymbolIndex>(result.outputDir, 'symbol-index.json')
    const mainFile = idx.files.find((f) => f.path.endsWith('main.py'))!
    expect(mainFile.imports.length).toBeGreaterThan(0)
    expect(mainFile.imports.some((i) => i.includes('os') || i === 'os')).toBe(true)
  })

  it('extracts Python ALL_CAPS constants as const symbols', async () => {
    const root = makeTemp()
    createPythonFixture(root)
    const result = await runIndexCommand({ root, src: ['src'], language: 'python', out: '.mdk-out' })
    const idx = readJson<SymbolIndex>(result.outputDir, 'symbol-index.json')
    const utilsFile = idx.files.find((f) => f.path.endsWith('utils.py'))!
    const consts = utilsFile.symbols.filter((s) => s.kind === 'const')
    expect(consts.map((s) => s.name)).toContain('MAX_RETRIES')
  })

  it('records symbol start line location', async () => {
    const root = makeTemp()
    createPythonFixture(root)
    const result = await runIndexCommand({ root, src: ['src'], language: 'python', out: '.mdk-out' })
    const idx = readJson<SymbolIndex>(result.outputDir, 'symbol-index.json')
    const mainFile = idx.files.find((f) => f.path.endsWith('main.py'))!
    const greet = mainFile.symbols.find((s) => s.name === 'greet')
    expect(greet!.location.line).toBeGreaterThan(0)
  })

  it('produces code-graph.json with Python file nodes', async () => {
    const root = makeTemp()
    createPythonFixture(root)
    const result = await runIndexCommand({ root, src: ['src'], language: 'python', out: '.mdk-out' })
    const graph = readJson<CodeGraph>(result.outputDir, 'code-graph.json')
    const fileNodes = graph.nodes.filter((n) => n.kind === 'file')
    const paths = fileNodes.map((n) => n.path ?? '')
    expect(paths.some((p) => p.endsWith('main.py'))).toBe(true)
    expect(paths.some((p) => p.endsWith('utils.py'))).toBe(true)
  })

  it('produces code-graph.json with Python symbol nodes', async () => {
    const root = makeTemp()
    createPythonFixture(root)
    const result = await runIndexCommand({ root, src: ['src'], language: 'python', out: '.mdk-out' })
    const graph = readJson<CodeGraph>(result.outputDir, 'code-graph.json')
    const symbolNodes = graph.nodes.filter((n) => n.kind === 'symbol')
    const names = symbolNodes.map((n) => n.symbolName ?? '')
    expect(names).toContain('greet')
    expect(names).toContain('UserService')
  })

  it('produces defines edges from Python file nodes to symbol nodes', async () => {
    const root = makeTemp()
    createPythonFixture(root)
    const result = await runIndexCommand({ root, src: ['src'], language: 'python', out: '.mdk-out' })
    const graph = readJson<CodeGraph>(result.outputDir, 'code-graph.json')
    const definesEdges = graph.edges.filter((e) => e.kind === 'defines')
    expect(definesEdges.length).toBeGreaterThan(0)
    const greetEdge = definesEdges.find((e) => e.target.includes('greet'))
    expect(greetEdge).toBeDefined()
  })

  it('produces imports edges for local Python file dependencies', async () => {
    const root = makeTemp()
    createPythonFixture(root)
    const result = await runIndexCommand({ root, src: ['src'], language: 'python', out: '.mdk-out' })
    const graph = readJson<CodeGraph>(result.outputDir, 'code-graph.json')
    const importEdges = graph.edges.filter((e) => e.kind === 'imports')
    // main.py imports from utils.py — should produce an imports edge
    const mainToUtils = importEdges.find(
      (e) => e.source.includes('main') && e.target.includes('utils')
    )
    expect(mainToUtils).toBeDefined()
  })

  it('writes a call graph with --call-graph on Python files', async () => {
    const root = makeTemp()
    createPythonFixture(root)
    const result = await runIndexCommand({
      root,
      src: ['src'],
      language: 'python',
      out: '.mdk-out',
      callGraph: true,
    })
    expect(result.manifest.summary.fileCount).toBe(2)
    expect(result.callGraphPath).not.toBeNull()
    expect(result.manifest.artifacts.callGraph).toBe('call-graph.json')
    const callGraph = readJson<CallGraph>(result.outputDir, 'call-graph.json')
    expect(callGraph.edgeCount).toBeGreaterThan(0)
  })

  it('extracts a Python function-to-function call edge', async () => {
    const root = makeTemp()
    createPythonFixture(root)
    const result = await runIndexCommand({
      root,
      src: ['src'],
      language: 'python',
      out: '.mdk-out',
      callGraph: true,
    })
    const callGraph = readJson<CallGraph>(result.outputDir, 'call-graph.json')
    const greetToBuild = callGraph.edges.find(
      (edge) => edge.caller.name === 'greet' && edge.callee.name === '_build_msg'
    )
    expect(greetToBuild).toBeDefined()
    expect(greetToBuild!.callee.file).toBe('src/main.py')
  })

  it('extracts a Python method call edge for self.method()', async () => {
    const root = makeTemp()
    createPythonFixture(root)
    const result = await runIndexCommand({
      root,
      src: ['src'],
      language: 'python',
      out: '.mdk-out',
      callGraph: true,
    })
    const callGraph = readJson<CallGraph>(result.outputDir, 'call-graph.json')
    const describeToNormalize = callGraph.edges.find(
      (edge) => edge.caller.name === 'UserService.describe' && edge.callee.name === 'UserService.normalize'
    )
    expect(describeToNormalize).toBeDefined()
    expect(describeToNormalize!.callee.file).toBe('src/main.py')
  })

  it('writes an empty Python call graph when no call edges are found', async () => {
    const root = makeTemp()
    const src = join(root, 'src')
    mkdirSync(src)
    writeFileSync(join(src, 'empty.py'), 'VALUE = 1\n\ndef lonely():\n    return VALUE\n')

    const result = await runIndexCommand({
      root,
      src: ['src'],
      language: 'python',
      out: '.mdk-out',
      callGraph: true,
    })
    const callGraph = readJson<CallGraph>(result.outputDir, 'call-graph.json')

    expect(result.callGraphPath).not.toBeNull()
    expect(callGraph.edgeCount).toBe(0)
    expect(callGraph.edges).toEqual([])
  })

  it('indexes TypeScript files alongside Python files', async () => {
    const root = makeTemp()
    const src = join(root, 'src')
    mkdirSync(src)
    writeFileSync(join(src, 'index.ts'), 'export const x = 1\n')
    writeFileSync(join(src, 'helper.py'), 'def foo(): pass\n')
    // Language detection is by extension when --language is omitted.
    const result = await runIndexCommand({ root, src: ['src'], out: '.mdk-out' })
    const idx = readJson<SymbolIndex>(result.outputDir, 'symbol-index.json')
    const tsFile = idx.files.find((f) => f.path.endsWith('index.ts'))
    expect(tsFile).toBeDefined()
    expect(tsFile!.language).toBe('typescript')
  })

  it('keeps mixed TypeScript and Python call graph extraction stable', async () => {
    const root = makeTemp()
    const src = join(root, 'src')
    mkdirSync(src)
    writeFileSync(
      join(src, 'index.ts'),
      'export function tsCallee(): string { return "ok" }\nexport function tsCaller(): string { return tsCallee() }\n'
    )
    writeFileSync(
      join(src, 'helper.py'),
      'def py_callee():\n    return "ok"\n\ndef py_caller():\n    return py_callee()\n'
    )

    const result = await runIndexCommand({ root, src: ['src'], out: '.mdk-out', callGraph: true })
    const callGraph = readJson<CallGraph>(result.outputDir, 'call-graph.json')

    expect(callGraph.edges.some((edge) => edge.caller.name === 'tsCaller' && edge.callee.name === 'tsCallee')).toBe(true)
    expect(callGraph.edges.some((edge) => edge.caller.name === 'py_caller' && edge.callee.name === 'py_callee')).toBe(true)
  })
})

describe('Python symbol end lines', () => {
  const adapter = new PythonAdapter()
  const spans = (source: string) =>
    adapter.extractFromSource('src/sample.py', source).symbols.map((s) => [s.name, s.kind, s.location.line, s.location.endLine])

  afterEach(() => {
    symbolScriptOverride.transform = null
  })

  it('preserves AST end_lineno for functions, async functions, classes and constants', () => {
    const source = [
      'import os', // 1
      '', // 2
      '@dec', // 3
      'def decorated():', // 4
      '    return 1', // 5
      '', // 6
      'async def fetch():', // 7
      '    await x()', // 8
      '', // 9
      '@dec(', // 10
      '    1,', // 11
      ')', // 12
      'class Service:', // 13
      '    value = 1', // 14
      '', // 15
      '    def run(self):', // 16
      '        return self.value', // 17
      '', // 18
      'MAX_RETRIES = (1 +', // 19
      '    2)', // 20
      'LIMIT: int = 3', // 21
    ].join('\n')

    expect(spans(source)).toEqual([
      ['decorated', 'function', 4, 5],
      ['fetch', 'function', 7, 8],
      ['Service', 'class', 13, 17],
      ['MAX_RETRIES', 'const', 19, 20],
      ['LIMIT', 'const', 21, 21],
    ])
  })

  it('keeps the existing symbol fields next to endLine', () => {
    const [fn] = adapter.extractFromSource('src/sample.py', 'def helper():\n    return 1\n').symbols
    expect(fn).toMatchObject({
      name: 'helper',
      kind: 'function',
      location: { file: 'src/sample.py', line: 1, endLine: 2 },
      exported: true,
    })
  })

  it('does not add unsupported symbol kinds or fabricate a boundary for malformed source', () => {
    expect(spans('lowercase = 1\nfor i in range(3):\n    pass\n')).toEqual([])
    expect(spans('def broken(:\n    pass\nVALUE = 1\n')).toEqual([])
  })

  it('writes end lines into symbol-index.json through the index pipeline', async () => {
    const root = makeTemp()
    createPythonFixture(root)
    const result = await runIndexCommand({ root, src: ['src'], language: 'python', out: '.mdk-out' })
    const idx = readJson<SymbolIndex>(result.outputDir, 'symbol-index.json')
    const mainFile = idx.files.find((f) => f.path.endsWith('main.py'))!
    const byName = Object.fromEntries(mainFile.symbols.map((s) => [s.name, [s.location.line, s.location.endLine]]))
    expect(byName.APP_NAME).toEqual([8, 8])
    expect(byName.greet).toEqual([10, 12])
    expect(byName.fetch_user).toEqual([14, 16])
    expect(byName.UserService).toEqual([22, 31])
  })

  const injectEndLine = (endLine: unknown) => {
    symbolScriptOverride.transform = (result) => ({
      ...result,
      stdout: JSON.stringify({
        symbols: [{ name: 'greet', kind: 'function', line: 3, end_line: endLine, exported: true, signature: 'def greet():' }],
      }),
    })
    return adapter.extractFromSource('src/sample.py', 'x = 1\n\ndef greet():\n    pass\n').symbols
  }

  it('keeps a valid end_line and omits null, missing, malformed or out-of-range ones', () => {
    expect(injectEndLine(4)[0].location).toEqual({ file: 'src/sample.py', line: 3, endLine: 4 })
    // 'x = 1\n\ndef greet():\n    pass\n' splits into 5 lines.
    expect(injectEndLine(5)[0].location).toEqual({ file: 'src/sample.py', line: 3, endLine: 5 })
    for (const bad of [null, undefined, 2, 6, 4.5, '4', Number.NaN, -1]) {
      const [symbol] = injectEndLine(bad)
      expect(symbol.name).toBe('greet')
      expect(symbol.location).toEqual({ file: 'src/sample.py', line: 3 })
    }
  })

  it('does not report successful symbols when the interpreter call fails or returns garbage', () => {
    symbolScriptOverride.transform = (result) => ({ ...result, error: new Error('spawn failed') })
    expect(adapter.extractFromSource('src/sample.py', 'MAX = 1\n').symbols).toEqual([])

    symbolScriptOverride.transform = (result) => ({ ...result, stdout: 'not json' })
    expect(adapter.extractFromSource('src/sample.py', 'MAX = 1\n').symbols).toEqual([])
  })
})
