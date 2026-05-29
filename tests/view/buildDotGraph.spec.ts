import { describe, expect, it } from 'vitest'
import { buildDotGraph } from '../../src/graph/buildDotGraph.js'
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'

function graph(): CodeGraph {
  return {
    artifactKind: 'code-graph',
    schemaVersion: '1.0.0',
    createdAt: 'now',
    nodes: [
      { id: 'symbol:src/index.ts#say"Hi"', kind: 'symbol', label: 'say"Hi', symbolName: 'say"Hi' },
      { id: 'file:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts' },
    ],
    edges: [
      { id: 'z-edge', source: 'file:src/index.ts', target: 'symbol:src/index.ts#say"Hi"', kind: 'defines' },
    ],
    summary: { nodeCount: 2, edgeCount: 1, fileNodeCount: 1, symbolNodeCount: 1 },
  }
}

function multiEdgeGraph(): CodeGraph {
  return {
    artifactKind: 'code-graph',
    schemaVersion: '1.0.0',
    createdAt: 'now',
    nodes: [
      { id: 'file:src/a.ts', kind: 'file', label: 'a.ts', path: 'src/a.ts' },
      { id: 'file:src/b.ts', kind: 'file', label: 'b.ts', path: 'src/b.ts' },
      { id: 'symbol:src/a.ts#foo', kind: 'symbol', label: 'foo', symbolName: 'foo' },
    ],
    edges: [
      { id: 'e1', source: 'file:src/a.ts', target: 'symbol:src/a.ts#foo', kind: 'defines' },
      { id: 'e2', source: 'file:src/a.ts', target: 'file:src/b.ts', kind: 'imports' },
      { id: 'e3', source: 'file:src/a.ts', target: 'symbol:src/a.ts#foo', kind: 'exports' },
      { id: 'e4', source: 'symbol:src/a.ts#foo', target: 'symbol:src/a.ts#foo', kind: 'calls' },
      { id: 'e5', source: 'file:src/a.ts', target: 'file:src/b.ts', kind: 'depends-on' },
      { id: 'e6', source: 'file:src/a.ts', target: 'file:src/b.ts', kind: 'related-to' },
    ],
    summary: { nodeCount: 3, edgeCount: 6, fileNodeCount: 2, symbolNodeCount: 1 },
  }
}

describe('buildDotGraph - semantic mode (default)', () => {
  it('is deterministic', () => {
    expect(buildDotGraph(graph())).toBe(buildDotGraph(graph()))
  })

  it('emits digraph CodeGraph', () => {
    expect(buildDotGraph(graph())).toContain('digraph CodeGraph')
  })

  it('emits node shapes for file and symbol nodes', () => {
    const dot = buildDotGraph(graph())
    expect(dot).toContain('shape="box"')
    expect(dot).toContain('shape="ellipse"')
  })

  it('emits a legend', () => {
    const dot = buildDotGraph(graph())
    expect(dot).toContain('cluster_legend')
    expect(dot).toContain('Edge Legend')
  })

  it('does not add inline label="defines" to the real graph edge', () => {
    const dot = buildDotGraph(graph())
    const lines = dot.split('\n')
    const realEdgeLine = lines.find(l => l.includes('"file:src/index.ts" ->') && !l.includes('legend'))
    expect(realEdgeLine).toBeDefined()
    expect(realEdgeLine).not.toContain('label="defines"')
  })

  it('includes expected semantic attributes for defines', () => {
    const dot = buildDotGraph(graph())
    const lines = dot.split('\n')
    const realEdgeLine = lines.find(l => l.includes('"file:src/index.ts" ->') && !l.includes('legend'))
    expect(realEdgeLine).toContain('arrowtail="dot"')
    expect(realEdgeLine).toContain('arrowhead="normal"')
    expect(realEdgeLine).toContain('style="solid"')
    expect(realEdgeLine).toContain('dir="both"')
  })

  it('includes expected semantic attributes for imports', () => {
    const dot = buildDotGraph(multiEdgeGraph(), { edgeStyle: 'semantic' })
    const lines = dot.split('\n')
    const importsLine = lines.find(l => l.includes('"file:src/a.ts" ->') && l.includes('arrowhead="inv"'))
    expect(importsLine).toBeDefined()
  })

  it('includes expected semantic attributes for exports', () => {
    const dot = buildDotGraph(multiEdgeGraph(), { edgeStyle: 'semantic' })
    const lines = dot.split('\n')
    const exportsLine = lines.find(l => l.includes('"file:src/a.ts" ->') && l.includes('arrowhead="onormal"'))
    expect(exportsLine).toBeDefined()
  })

  it('includes expected semantic attributes for calls', () => {
    const dot = buildDotGraph(multiEdgeGraph(), { edgeStyle: 'semantic' })
    const lines = dot.split('\n')
    const callsLine = lines.find(l => l.includes('style="bold"') && !l.includes('legend'))
    expect(callsLine).toBeDefined()
  })

  it('includes expected semantic attributes for depends-on', () => {
    const dot = buildDotGraph(multiEdgeGraph(), { edgeStyle: 'semantic' })
    const lines = dot.split('\n')
    const dashedLine = lines.find(l => l.includes('style="dashed"') && !l.includes('legend'))
    expect(dashedLine).toBeDefined()
  })

  it('includes expected semantic attributes for related-to', () => {
    const dot = buildDotGraph(multiEdgeGraph(), { edgeStyle: 'semantic' })
    const lines = dot.split('\n')
    const dottedLine = lines.find(l => l.includes('style="dotted"') && l.includes('arrowtail="odot"') && !l.includes('legend'))
    expect(dottedLine).toBeDefined()
  })
})

describe('buildDotGraph - labeled mode', () => {
  it('preserves inline edge labels', () => {
    const dot = buildDotGraph(graph(), { edgeStyle: 'labeled' })
    expect(dot).toContain('label="defines"')
  })

  it('does not emit a legend', () => {
    const dot = buildDotGraph(graph(), { edgeStyle: 'labeled' })
    expect(dot).not.toContain('cluster_legend')
  })

  it('is deterministic', () => {
    expect(buildDotGraph(graph(), { edgeStyle: 'labeled' })).toBe(buildDotGraph(graph(), { edgeStyle: 'labeled' }))
  })
})

describe('buildDotGraph - minimal mode', () => {
  it('omits inline labels and legend', () => {
    const dot = buildDotGraph(graph(), { edgeStyle: 'minimal' })
    expect(dot).not.toContain('label="defines"')
    expect(dot).not.toContain('cluster_legend')
  })

  it('still emits the edge', () => {
    const dot = buildDotGraph(graph(), { edgeStyle: 'minimal' })
    expect(dot).toContain('"file:src/index.ts" ->')
  })
})

describe('buildDotGraph - edge cases', () => {
  it('escapes quotes in labels', () => {
    expect(buildDotGraph(graph())).toContain('say\\"Hi')
  })

  it('handles empty graph gracefully', () => {
    const dot = buildDotGraph({
      artifactKind: 'code-graph',
      schemaVersion: '1.0.0',
      createdAt: 'now',
      nodes: [],
      edges: [],
      summary: { nodeCount: 0, edgeCount: 0, fileNodeCount: 0, symbolNodeCount: 0 },
    })
    expect(dot).toContain('digraph CodeGraph')
    expect(dot).toContain('}')
  })

  it('unknown edge kind falls back safely without crashing', () => {
    const g: CodeGraph = {
      artifactKind: 'code-graph',
      schemaVersion: '1.0.0',
      createdAt: 'now',
      nodes: [
        { id: 'file:src/a.ts', kind: 'file', label: 'a.ts', path: 'src/a.ts' },
        { id: 'file:src/b.ts', kind: 'file', label: 'b.ts', path: 'src/b.ts' },
      ],
      edges: [
        { id: 'e1', source: 'file:src/a.ts', target: 'file:src/b.ts', kind: 'unknown-kind' as never },
      ],
      summary: { nodeCount: 2, edgeCount: 1, fileNodeCount: 2, symbolNodeCount: 0 },
    }
    expect(() => buildDotGraph(g, { edgeStyle: 'semantic' })).not.toThrow()
    const dot = buildDotGraph(g, { edgeStyle: 'semantic' })
    expect(dot).toContain('"file:src/a.ts" ->')
  })
})
