import { describe, expect, it } from 'vitest'
import { buildDotGraph } from '../../src/graph/buildDotGraph.js'
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'

function minGraph(overrides: Partial<CodeGraph> = {}): CodeGraph {
  return {
    artifactKind: 'code-graph',
    schemaVersion: '1.0.0',
    createdAt: 'now',
    nodes: [],
    edges: [],
    summary: { nodeCount: 0, edgeCount: 0, fileNodeCount: 0, symbolNodeCount: 0 },
    ...overrides,
  }
}

describe('DOT output escaping', () => {
  it('escapes double-quotes in node IDs', () => {
    const dot = buildDotGraph(
      minGraph({
        nodes: [{ id: 'file:src/"evil".ts', kind: 'file', label: 'evil' }],
      }),
      { edgeStyle: 'minimal' }
    )
    // The escaped form must appear in the DOT output
    expect(dot).toContain('\\"evil\\"')
    // The node ID section must not contain raw unescaped quotes within the outer quotes
    const nodeLine = dot.split('\n').find((l) => l.includes('evil'))
    expect(nodeLine).toMatch(/^  ".*\\"evil\\".*"/)
  })

  it('escapes backslashes in node IDs', () => {
    const dot = buildDotGraph(
      minGraph({
        nodes: [{ id: 'file:src\\windows\\path.ts', kind: 'file', label: 'win' }],
      }),
      { edgeStyle: 'minimal' }
    )
    // Backslash must be doubled in DOT output
    expect(dot).toContain('\\\\')
  })

  it('escapes newlines in node labels', () => {
    const dot = buildDotGraph(
      minGraph({
        nodes: [{ id: 'file:src/a.ts', kind: 'file', label: 'line1\nline2' }],
      }),
      { edgeStyle: 'minimal' }
    )
    // Literal newline must not appear inside a quoted label value
    expect(dot).not.toMatch(/label="[^"]*\n/)
    // Escaped newline sequence must be present instead
    expect(dot).toContain('\\n')
  })

  it('escapes double-quotes in edge labels (labeled mode)', () => {
    const dot = buildDotGraph(
      minGraph({
        nodes: [
          { id: 'a', kind: 'file', label: 'a' },
          { id: 'b', kind: 'file', label: 'b' },
        ],
        edges: [{ id: 'e1', source: 'a', target: 'b', kind: 'imports', label: 'say "hi"' }],
      }),
      { edgeStyle: 'labeled' }
    )
    // Escaped form must be present
    expect(dot).toContain('\\"hi\\"')
    // The edge line must use the escaped label, not a raw embedded quote
    const edgeLine = dot.split('\n').find((l) => l.includes('"a" ->'))
    expect(edgeLine).toContain('\\"hi\\"')
  })

  it('produces valid DOT structure with angle brackets in symbol names', () => {
    const dot = buildDotGraph(
      minGraph({
        nodes: [
          { id: 'symbol:src/a.ts#fn<T>', kind: 'symbol', label: 'fn<T>', symbolName: 'fn<T>' },
        ],
      }),
      { edgeStyle: 'semantic' }
    )
    expect(dot).toContain('digraph CodeGraph')
    expect(dot).toContain('}')
    expect(dot).toContain('fn<T>')
  })

  it('does not inject DOT syntax through edge kind in semantic mode', () => {
    const dot = buildDotGraph(
      minGraph({
        nodes: [
          { id: 'a', kind: 'file', label: 'a' },
          { id: 'b', kind: 'file', label: 'b' },
        ],
        edges: [{ id: 'e1', source: 'a', target: 'b', kind: 'imports' }],
      }),
      { edgeStyle: 'semantic' }
    )
    const edgeLine = dot.split('\n').find((l) => l.includes('"a" ->') && !l.includes('legend'))
    expect(edgeLine).toBeDefined()
    expect(edgeLine).toContain('arrowhead=')
    // Edge line must be a single self-contained statement
    expect(edgeLine).toMatch(/^\s+"[^"]*" -> "[^"]*" \[.*\];$/)
  })

  it('produces well-formed DOT for all six standard edge kinds', () => {
    const kinds = ['defines', 'imports', 'exports', 'calls', 'depends-on', 'related-to'] as const
    for (const kind of kinds) {
      const dot = buildDotGraph(
        minGraph({
          nodes: [
            { id: 'src', kind: 'file', label: 'src' },
            { id: 'tgt', kind: 'file', label: 'tgt' },
          ],
          edges: [{ id: 'e', source: 'src', target: 'tgt', kind }],
        }),
        { edgeStyle: 'semantic' }
      )
      expect(dot).toContain('digraph CodeGraph')
      const edgeLine = dot.split('\n').find((l) => l.includes('"src" ->') && !l.includes('legend'))
      expect(edgeLine, `Edge line missing for kind ${kind}`).toBeDefined()
    }
  })
})
