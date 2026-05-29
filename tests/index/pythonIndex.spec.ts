import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
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
