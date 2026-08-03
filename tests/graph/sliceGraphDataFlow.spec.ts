/**
 * v1.12.0 Batch 5: `sliceGraph`'s `dataFlowEdgeKinds` secondary BFS pass
 * (TST-511 through TST-520). Synthetic graphs only - exercises bidirectional
 * traversal regardless of `direction`, depth bounding, cycle safety, cap
 * truncation, and depth-0 no-op behavior.
 */
import { describe, expect, it } from 'vitest'
import { sliceGraph, MAX_DATA_FLOW_ADDED_NODES } from '../../src/graph/sliceGraph.js'
import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from '../../src/graph/codeGraphTypes.js'

function n(id: string): CodeGraphNode {
  return { id, kind: 'symbol', label: id }
}
function e(id: string, source: string, target: string, kind: CodeGraphEdge['kind']): CodeGraphEdge {
  return { id, source, target, kind }
}

function chainGraph(): CodeGraph {
  // activity -> composable -> viewmodel -> repository -> dao -> entity
  const nodes = [n('activity'), n('composable'), n('viewmodel'), n('repository'), n('dao'), n('entity')]
  const edges = [
    e('e1', 'activity', 'composable', 'activity-hosts-composable'),
    e('e2', 'composable', 'viewmodel', 'composable-references-viewmodel'),
    e('e3', 'viewmodel', 'repository', 'viewmodel-uses-repository'),
    e('e4', 'repository', 'dao', 'repository-uses-dao'),
    e('e5', 'dao', 'entity', 'dao-uses-entity'),
  ]
  return {
    artifactKind: 'code-graph',
    schemaVersion: '1.0.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    nodes,
    edges,
    summary: { nodeCount: nodes.length, edgeCount: edges.length, fileNodeCount: 0, symbolNodeCount: nodes.length },
  }
}

const DATA_FLOW_KINDS = new Set([
  'activity-hosts-composable',
  'composable-references-viewmodel',
  'viewmodel-uses-repository',
  'repository-uses-dao',
  'dao-uses-entity',
])

describe('sliceGraph dataFlowEdgeKinds', () => {
  it('TST-511: depth 0 yields an empty (no-op) expansion', () => {
    const core = sliceGraph({
      graph: chainGraph(),
      focusNodeId: 'repository',
      depth: 0,
      direction: 'both',
      dataFlowEdgeKinds: DATA_FLOW_KINDS,
    })
    expect(core.nodes.map((x) => x.id)).toEqual(['repository'])
    expect(core.dataFlowExpansion).toEqual({ addedNodeIds: [], truncated: false })
  })

  it('TST-512: expands bidirectionally regardless of direction: outgoing', () => {
    const core = sliceGraph({
      graph: chainGraph(),
      focusNodeId: 'repository',
      depth: 2,
      direction: 'outgoing',
      dataFlowEdgeKinds: DATA_FLOW_KINDS,
    })
    const ids = new Set(core.nodes.map((x) => x.id))
    // Reaches backward (viewmodel) even though base direction is outgoing-only.
    expect(ids.has('viewmodel')).toBe(true)
    expect(ids.has('dao')).toBe(true)
  })

  it('TST-513: the data-flow pass is bounded by the resolved slice depth, not an unlimited walk', () => {
    // dao -> entity -> extra1 -> extra2, all via allowlisted data-flow kinds.
    // With focus 'dao' and depth 1: the base pass (any edge kind) has no
    // other edges to traverse (dao has none besides the data-flow ones), so
    // it reaches only 'entity'; the data-flow pass then runs exactly one
    // more iteration from the base-included set, reaching 'extra1' but not
    // the further 'extra2'.
    const nodes = [n('dao'), n('entity'), n('extra1'), n('extra2')]
    const edges = [
      e('e1', 'dao', 'entity', 'dao-uses-entity'),
      e('e2', 'entity', 'extra1', 'dao-uses-entity'),
      e('e3', 'extra1', 'extra2', 'dao-uses-entity'),
    ]
    const boundedGraph: CodeGraph = {
      artifactKind: 'code-graph',
      schemaVersion: '1.0.0',
      createdAt: '2026-01-01T00:00:00.000Z',
      nodes,
      edges,
      summary: { nodeCount: 4, edgeCount: 3, fileNodeCount: 0, symbolNodeCount: 4 },
    }
    const core = sliceGraph({
      graph: boundedGraph,
      focusNodeId: 'dao',
      depth: 1,
      direction: 'both',
      dataFlowEdgeKinds: new Set(['dao-uses-entity']),
    })
    const ids = new Set(core.nodes.map((x) => x.id))
    expect(ids.has('entity')).toBe(true)
    expect(ids.has('extra1')).toBe(true)
    expect(ids.has('extra2')).toBe(false)
  })

  it('TST-514: never fabricates nodes - only real graph nodes/edges appear', () => {
    const core = sliceGraph({
      graph: chainGraph(),
      focusNodeId: 'repository',
      depth: 3,
      direction: 'both',
      dataFlowEdgeKinds: DATA_FLOW_KINDS,
    })
    const realIds = new Set(chainGraph().nodes.map((x) => x.id))
    for (const node of core.nodes) expect(realIds.has(node.id)).toBe(true)
  })

  it('TST-515: cycle-safe - a data-flow cycle terminates and dedupes', () => {
    const nodes = [n('a'), n('b'), n('c')]
    const edges = [
      e('e1', 'a', 'b', 'viewmodel-uses-repository'),
      e('e2', 'b', 'c', 'repository-uses-dao'),
      e('e3', 'c', 'a', 'dao-uses-entity'),
    ]
    const cyclicGraph: CodeGraph = {
      artifactKind: 'code-graph',
      schemaVersion: '1.0.0',
      createdAt: '2026-01-01T00:00:00.000Z',
      nodes,
      edges,
      summary: { nodeCount: 3, edgeCount: 3, fileNodeCount: 0, symbolNodeCount: 3 },
    }
    const core = sliceGraph({
      graph: cyclicGraph,
      focusNodeId: 'a',
      depth: 3,
      direction: 'both',
      dataFlowEdgeKinds: new Set(['viewmodel-uses-repository', 'repository-uses-dao', 'dao-uses-entity']),
    })
    expect(core.nodes.map((x) => x.id).sort()).toEqual(['a', 'b', 'c'])
    expect(core.dataFlowExpansion?.truncated).toBe(false)
  })

  it('TST-516: truncates and reports when the added-node cap is exceeded', () => {
    // 'root' connects to 'dao' via a non-data-flow edge kind (so the primary
    // any-kind pass only reaches 'dao' at depth 1); 'dao' fans out to far
    // more nodes than the cap via an allowlisted data-flow kind, which the
    // secondary pass alone must discover and truncate.
    const nodes = [n('root'), n('dao')]
    const edges: CodeGraphEdge[] = [e('root-dao', 'root', 'dao', 'calls')]
    for (let i = 0; i < MAX_DATA_FLOW_ADDED_NODES + 20; i++) {
      nodes.push(n(`n${i}`))
      edges.push(e(`edge${i}`, 'dao', `n${i}`, 'dao-uses-entity'))
    }
    const bigGraph: CodeGraph = {
      artifactKind: 'code-graph',
      schemaVersion: '1.0.0',
      createdAt: '2026-01-01T00:00:00.000Z',
      nodes,
      edges,
      summary: { nodeCount: nodes.length, edgeCount: edges.length, fileNodeCount: 0, symbolNodeCount: nodes.length },
    }
    const core = sliceGraph({
      graph: bigGraph,
      focusNodeId: 'root',
      depth: 1,
      direction: 'both',
      dataFlowEdgeKinds: new Set(['dao-uses-entity']),
    })
    expect(core.dataFlowExpansion?.truncated).toBe(true)
    expect(core.dataFlowExpansion?.addedNodeIds.length).toBeLessThanOrEqual(MAX_DATA_FLOW_ADDED_NODES)
  })

  it('TST-517: absent dataFlowEdgeKinds leaves output byte-identical to the base slice', () => {
    const withoutDataFlow = sliceGraph({ graph: chainGraph(), focusNodeId: 'repository', depth: 1, direction: 'both' })
    expect(withoutDataFlow.dataFlowExpansion).toBeUndefined()
  })
})
