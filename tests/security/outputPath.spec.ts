import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeSourceOutput } from '../../src/source/renderSourceOutput.js'
import { writeGraphView } from '../../src/graph/writeGraphView.js'
import { writeGraphSlice } from '../../src/graph/writeGraphSlice.js'
import type { GraphSlice } from '../../src/graph/graphSliceTypes.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function makeTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mdk-sec-out-'))
  tempDirs.push(dir)
  return dir
}

const minSlice: GraphSlice = {
  artifactKind: 'my-dev-kit-v1-graph-slice',
  version: '1.0.0',
  createdAt: 'now',
  indexDir: '.my-dev-kit-v1',
  focusNodeId: 'a',
  depth: 1,
  direction: 'both',
  nodes: [],
  edges: [],
  summary: { nodeCount: 0, edgeCount: 0, nodesByKind: {}, edgesByKind: {} },
  artifactPaths: { manifest: 'manifest.json', codeGraph: 'code-graph.json' },
  warnings: [],
}

describe('output path writers', () => {
  describe('writeSourceOutput', () => {
    it('writes content to an existing directory', () => {
      const dir = makeTemp()
      const outPath = join(dir, 'output.ts')
      writeSourceOutput(outPath, 'hello world\n')
      expect(readFileSync(outPath, 'utf8')).toBe('hello world\n')
    })

    it('creates parent directories that do not exist', () => {
      const dir = makeTemp()
      const outPath = join(dir, 'a', 'b', 'c', 'output.ts')
      writeSourceOutput(outPath, 'created\n')
      expect(existsSync(outPath)).toBe(true)
    })

    it('returns the resolved absolute path', () => {
      const dir = makeTemp()
      const outPath = join(dir, 'out.txt')
      const returned = writeSourceOutput(outPath, 'x\n')
      expect(returned).toContain('out.txt')
    })
  })

  describe('writeGraphView', () => {
    it('writes string DOT content to a file', () => {
      const dir = makeTemp()
      const outPath = join(dir, 'graph.dot')
      writeGraphView(outPath, 'digraph G {}')
      expect(readFileSync(outPath, 'utf8')).toBe('digraph G {}')
    })

    it('writes buffer content (PNG/SVG simulation)', () => {
      const dir = makeTemp()
      const outPath = join(dir, 'graph.svg')
      const buf = Buffer.from('<svg/>', 'utf8')
      writeGraphView(outPath, buf)
      expect(readFileSync(outPath).equals(buf)).toBe(true)
    })

    it('creates parent directories automatically', () => {
      const dir = makeTemp()
      const outPath = join(dir, 'nested', 'graph.dot')
      writeGraphView(outPath, 'digraph G {}')
      expect(existsSync(outPath)).toBe(true)
    })

    it('returns path with forward slashes', () => {
      const dir = makeTemp()
      const outPath = join(dir, 'graph.dot')
      const returned = writeGraphView(outPath, '')
      expect(returned).not.toContain('\\')
    })
  })

  describe('writeGraphSlice', () => {
    it('writes a valid JSON slice artifact', () => {
      const dir = makeTemp()
      const outPath = join(dir, 'slice.json')
      writeGraphSlice(outPath, minSlice)
      const parsed = JSON.parse(readFileSync(outPath, 'utf8'))
      expect(parsed.artifactKind).toBe('my-dev-kit-v1-graph-slice')
    })

    it('creates parent directories automatically', () => {
      const dir = makeTemp()
      const outPath = join(dir, 'deep', 'slice.json')
      writeGraphSlice(outPath, minSlice)
      expect(existsSync(outPath)).toBe(true)
    })

    it('returns path with forward slashes', () => {
      const dir = makeTemp()
      const outPath = join(dir, 'slice.json')
      const returned = writeGraphSlice(outPath, minSlice)
      expect(returned).not.toContain('\\')
    })
  })
})
