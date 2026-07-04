import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from '../graph/codeGraphTypes.js'
import { sliceGraph } from '../graph/sliceGraph.js'
import type { ContextFocus, SelectedGraph, SelectedGraphEdge, SelectedGraphNode } from './types.js'

const NEIGHBORHOOD_DEPTH = 1

export function selectGraphNeighborhood(options: {
  codeGraph: CodeGraph
  focus: ContextFocus
  maxGraphNodes: number | null
  maxGraphEdges: number | null
}): SelectedGraph {
  const { codeGraph, focus, maxGraphNodes, maxGraphEdges } = options

  if (!focus.focusNodeId) {
    return {
      nodes: [],
      edges: [],
      omittedNodeCount: 0,
      omittedEdgeCount: 0,
      warnings: ['No primary focus was selected; no graph neighborhood was built.'],
    }
  }

  const focusNodeId = focus.focusNodeId
  const core = sliceGraph({ graph: codeGraph, focusNodeId, depth: NEIGHBORHOOD_DEPTH, direction: 'both' })

  let cappedNodes = maxGraphNodes != null ? core.nodes.slice(0, maxGraphNodes) : core.nodes
  if (!cappedNodes.some((node) => node.id === focusNodeId)) {
    const focusNode = core.nodes.find((node) => node.id === focusNodeId)
    if (focusNode) {
      cappedNodes = cappedNodes.length > 0 ? [focusNode, ...cappedNodes.slice(0, -1)] : [focusNode]
    }
  }

  const keptNodeIds = new Set(cappedNodes.map((node) => node.id))
  const edgesAmongKept = core.edges.filter((edge) => keptNodeIds.has(edge.source) && keptNodeIds.has(edge.target))
  const cappedEdges = maxGraphEdges != null ? edgesAmongKept.slice(0, maxGraphEdges) : edgesAmongKept

  return {
    nodes: cappedNodes.map((node) => toSelectedGraphNode(node, focusNodeId)),
    edges: cappedEdges.map((edge) => toSelectedGraphEdge(edge, focusNodeId)),
    omittedNodeCount: core.nodes.length - cappedNodes.length,
    omittedEdgeCount: edgesAmongKept.length - cappedEdges.length,
    warnings: core.warnings,
  }
}

function toSelectedGraphNode(node: CodeGraphNode, focusNodeId: string): SelectedGraphNode {
  return {
    nodeId: node.id,
    kind: node.kind,
    label: node.label,
    ...(node.path ? { filePath: node.path } : {}),
    reasons: [node.id === focusNodeId ? 'primary focus node' : 'direct neighbor of focus node'],
  }
}

function toSelectedGraphEdge(edge: CodeGraphEdge, focusNodeId: string): SelectedGraphEdge {
  const touchesFocus = edge.source === focusNodeId || edge.target === focusNodeId
  return {
    from: edge.source,
    to: edge.target,
    kind: edge.kind,
    reasons: [touchesFocus ? 'connects directly to focus node' : 'edge among retained neighborhood nodes'],
  }
}
