import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { extractFromSource } from '../../src/symbol-index/symbolExtractor.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'

let root = ''

function runCli(args: string[]) {
  return spawnSync(process.execPath, [tsxCliPath(), 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
  })
}

function tsxCliPath(): string {
  return join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-artifacts-'))
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'types.ts'), 'export interface User { id: string; name: string }\n')
  writeFileSync(
    join(src, 'service.ts'),
    "import type { User } from './types'\nexport function formatUser(user: User): string { return user.name }\n"
  )
  writeFileSync(
    join(src, 'index.ts'),
    "import { formatUser } from './service'\nimport type { User } from './types'\nexport function describeUser(user: User): string { return formatUser(user) }\n"
  )

  const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'artifacts'])
  expect(result.status).toBe(0)
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

function readJson(relativePath: string): any {
  return JSON.parse(readFileSync(join(root, 'artifacts', relativePath), 'utf8'))
}

describe('index artifacts', () => {
  it('manifest records expected contract fields', () => {
    const manifest = readJson('manifest.json')

    expect(manifest.artifactKind).toBe('my-dev-kit-v1-manifest')
    expect(manifest.projectRoot).toContain(root.replace(/\\/g, '/'))
    expect(manifest.sourceRoots).toEqual(['src'])
    expect(manifest.artifacts.symbolIndex).toBe('symbol-index.json')
    expect(manifest.artifacts.codeGraph).toBe('code-graph.json')
  })

  it('symbol-index.json has the expected top-level shape', () => {
    const symbolIndex = readJson('symbol-index.json')

    expect(symbolIndex.schemaVersion).toBe('2')
    expect(symbolIndex.fileCount).toBeGreaterThanOrEqual(2)
    expect(Array.isArray(symbolIndex.files)).toBe(true)
    expect(symbolIndex.graph).toBeDefined()
  })

  it('code-graph.json has deterministic file and symbol node IDs', () => {
    const codeGraph = readJson('code-graph.json')
    const nodeIds = codeGraph.nodes.map((node: { id: string }) => node.id)

    expect(codeGraph.artifactKind).toBe('code-graph')
    expect(nodeIds).toContain('file:src/index.ts')
    expect(nodeIds).toContain('file:src/service.ts')
    expect(nodeIds).toContain('symbol:src/index.ts#describeUser')
  })

  it('code-graph.json includes file nodes and at least one import edge', () => {
    const codeGraph = readJson('code-graph.json')

    expect(codeGraph.nodes.some((node: { kind: string }) => node.kind === 'file')).toBe(true)
    expect(codeGraph.edges.some((edge: { kind: string }) => edge.kind === 'imports')).toBe(true)
  })
})

describe('symbol end lines (TypeScript-family extractor)', () => {
  const lines = [
    'export function add(a: number, b: number): number {', // 1
    '  return a + b', // 2
    '}', // 3
    'export class Box {', // 4
    '  value = 1', // 5
    '}', // 6
    'export interface Shape {', // 7
    '  area: number', // 8
    '}', // 9
    'export type Pair = {', // 10
    '  a: number', // 11
    '}', // 12
    'export enum Color {', // 13
    '  Red,', // 14
    '}', // 15
    'export const config = {', // 16
    '  retries: 3,', // 17
    '}', // 18
    'let counter = 0', // 19
    'var legacy = 1', // 20
    'const first = 1,', // 21
    '  second = {', // 22
    '    nested: true,', // 23
    '  }', // 24
    'function last() {', // 25
    '  return 1', // 26
    '}', // 27 (EOF when no trailing newline)
  ]
  const expected: Array<[string, string, number, number]> = [
    ['add', 'function', 1, 3],
    ['Box', 'class', 4, 6],
    ['Shape', 'interface', 7, 9],
    ['Pair', 'type', 10, 12],
    ['Color', 'enum', 13, 15],
    ['config', 'const', 16, 18],
    ['counter', 'variable', 19, 19],
    ['legacy', 'variable', 20, 20],
    ['first', 'const', 21, 21],
    ['second', 'const', 22, 24],
    ['last', 'function', 25, 27],
  ]
  const spans = (path: string, text: string) =>
    extractFromSource(path, text).symbols.map((s) => [s.name, s.kind, s.location.line, s.location.endLine])

  it('derives inclusive end lines from parser declaration ends without leaking into the next declaration', () => {
    expect(spans('src/a.ts', lines.join('\n'))).toEqual(expected)
  })

  it('produces the same boundaries for LF, CRLF and a trailing newline', () => {
    expect(spans('src/a.ts', lines.join('\n') + '\n')).toEqual(expected)
    expect(spans('src/a.ts', lines.join('\r\n'))).toEqual(expected)
    expect(spans('src/a.ts', lines.join('\r\n') + '\r\n')).toEqual(expected)
  })

  it('keeps each declarator of a multi-declarator statement on its own boundary', () => {
    const result = extractFromSource('src/a.ts', lines.join('\n'))
    const first = result.symbols.find((s) => s.name === 'first')!
    const second = result.symbols.find((s) => s.name === 'second')!
    expect(first.location).toEqual({ file: 'src/a.ts', line: 21, endLine: 21 })
    expect(second.location).toEqual({ file: 'src/a.ts', line: 22, endLine: 24 })
  })

  it('preserves existing symbol fields alongside endLine', () => {
    const [add] = extractFromSource('src/a.ts', lines.join('\n')).symbols
    expect(add).toEqual({
      name: 'add',
      kind: 'function',
      location: { file: 'src/a.ts', line: 1, endLine: 3 },
      exported: true,
      signature: 'export function add(a: number, b: number): number {',
    })
  })

  it('handles a TSX component containing JSX', () => {
    const text = ['export function Card() {', '  return (', '    <div>', '      hello', '    </div>', '  )', '}'].join('\n')
    const result = extractFromSource('src/Card.tsx', text)
    expect(result.language).toBe('typescript')
    expect(result.symbols.map((s) => [s.name, s.location.line, s.location.endLine])).toEqual([['Card', 1, 7]])
  })

  it('handles JSX and JS files, including a declaration ending at EOF', () => {
    const jsx = ['export const Banner = () => (', '  <p>', '    hi', '  </p>', ')'].join('\n')
    const fromJsx = extractFromSource('src/Banner.jsx', jsx)
    expect(fromJsx.language).toBe('javascript')
    expect(fromJsx.symbols.map((s) => [s.name, s.kind, s.location.line, s.location.endLine])).toEqual([['Banner', 'const', 1, 5]])

    const js = ['function a() {', '  return 1', '}', 'const b = 2'].join('\n')
    expect(extractFromSource('src/a.js', js).symbols.map((s) => [s.name, s.location.line, s.location.endLine])).toEqual([
      ['a', 1, 3],
      ['b', 4, 4],
    ])
  })

  it('omits endLine for every symbol of a file with parser diagnostics', () => {
    const text = ['export function ok() {', '  return 1', '}', 'export function broken( {', '  return 2'].join('\n')
    const result = extractFromSource('src/bad.ts', text)
    expect(result.symbols.map((s) => s.name)).toContain('ok')
    for (const symbol of result.symbols) {
      expect(symbol.location).not.toHaveProperty('endLine')
      expect(symbol.location.line).toBeGreaterThan(0)
    }
  })

  it('does not index destructured or anonymous declarations and tolerates empty files', () => {
    const text = ['export const { a, b } = obj', 'const [c] = arr', 'export default function () {}', 'export default class {}'].join('\n')
    expect(extractFromSource('src/d.ts', text).symbols).toEqual([])
    const empty = extractFromSource('src/empty.ts', '')
    expect(empty.symbols).toEqual([])
    expect(empty.lineCount).toBe(1)
  })

  it('serializes endLine in symbol-index.json while graph nodes stay unchanged', () => {
    const symbolIndex = readJson('symbol-index.json')
    const service = symbolIndex.files.find((f: { path: string }) => f.path === 'src/service.ts')
    expect(service.symbols[0].name).toBe('formatUser')
    expect(service.symbols[0].location).toEqual({ file: 'src/service.ts', line: 2, endLine: 2 })

    const codeGraph = readJson('code-graph.json')
    const node = codeGraph.nodes.find((n: { id: string }) => n.id === 'symbol:src/service.ts#formatUser')
    expect(node).toBeDefined()
    expect(node).not.toHaveProperty('endLine')
    expect(JSON.stringify(symbolIndex.graph)).not.toContain('endLine')
  })

  it('keeps an old symbol record without endLine structurally valid', () => {
    const legacy: SymbolIndex['files'][number]['symbols'][number] = {
      name: 'legacy',
      kind: 'function',
      location: { file: 'src/legacy.ts', line: 3 },
      exported: true,
      signature: 'export function legacy() {',
    }
    expect(legacy.location.endLine).toBeUndefined()
    expect(JSON.parse(JSON.stringify(legacy))).toEqual(legacy)
  })
})
