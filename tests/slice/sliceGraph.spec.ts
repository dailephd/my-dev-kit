import { describe, expect, it } from 'vitest'
import { sliceGraph } from '../../src/graph/sliceGraph.js'
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'

function graph(): CodeGraph {
  return {
    artifactKind: 'code-graph',
    schemaVersion: '1.0.0',
    createdAt: 'now',
    nodes: [
      { id: 'a', kind: 'file', label: 'a' },
      { id: 'b', kind: 'file', label: 'b' },
      { id: 'c', kind: 'file', label: 'c' },
      { id: 'd', kind: 'symbol', label: 'd' },
    ],
    edges: [
      { id: 'a-b', source: 'a', target: 'b', kind: 'imports' },
      { id: 'b-c', source: 'b', target: 'c', kind: 'imports' },
      { id: 'c-a', source: 'c', target: 'a', kind: 'imports' },
      { id: 'b-d', source: 'b', target: 'd', kind: 'defines' },
      { id: 'b-d', source: 'b', target: 'd', kind: 'defines' },
    ],
    summary: { nodeCount: 4, edgeCount: 5, fileNodeCount: 3, symbolNodeCount: 1 },
  }
}

describe('sliceGraph', () => {
  it('depth 0 returns only focus node', () => {
    const slice = sliceGraph({ graph: graph(), focusNodeId: 'b', depth: 0, direction: 'both' })
    expect(slice.nodes.map((node) => node.id)).toEqual(['b'])
    expect(slice.edges).toEqual([])
  })

  it('depth 1 returns direct neighbors', () => {
    const slice = sliceGraph({ graph: graph(), focusNodeId: 'b', depth: 1, direction: 'both' })
    expect(slice.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('depth 2 handles cycles without infinite traversal', () => {
    const slice = sliceGraph({ graph: graph(), focusNodeId: 'a', depth: 2, direction: 'both' })
    expect(slice.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('incoming direction follows incoming edges', () => {
    const slice = sliceGraph({ graph: graph(), focusNodeId: 'b', depth: 1, direction: 'incoming' })
    expect(slice.nodes.map((node) => node.id)).toEqual(['a', 'b'])
  })

  it('outgoing direction follows outgoing edges', () => {
    const slice = sliceGraph({ graph: graph(), focusNodeId: 'b', depth: 1, direction: 'outgoing' })
    expect(slice.nodes.map((node) => node.id)).toEqual(['b', 'c', 'd'])
  })

  it('does not repeat duplicate edges', () => {
    const slice = sliceGraph({ graph: graph(), focusNodeId: 'b', depth: 1, direction: 'outgoing' })
    expect(slice.edges.filter((edge) => edge.id === 'b-d')).toHaveLength(1)
  })

  it('fails clearly for missing focus node', () => {
    expect(() => sliceGraph({ graph: graph(), focusNodeId: 'missing', depth: 1, direction: 'both' })).toThrow('Node not found')
  })

  it('output ordering is deterministic', () => {
    const slice = sliceGraph({ graph: graph(), focusNodeId: 'b', depth: 1, direction: 'both' })
    expect(slice.edges.map((edge) => edge.id)).toEqual([...slice.edges.map((edge) => edge.id)].sort())
  })
})
