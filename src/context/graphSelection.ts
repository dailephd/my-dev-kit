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
  const nodesById = new Map(codeGraph.nodes.map(node => [node.id, node]))
  const rustOwners = codeGraph.edges.filter(edge => edge.target === focusNodeId && (edge.kind === 'rust-impl-defines-symbol' || edge.kind === 'rust-module-defines-symbol')).map(edge => edge.source)
  if (rustOwners.length > 0) {
    const ids = new Set(core.nodes.map(node => node.id))
    for (const owner of rustOwners.slice(0, 16)) {
      for (const edge of codeGraph.edges) {
        if (edge.source !== owner || !['rust-impl-for-type', 'rust-impl-of-trait'].includes(edge.kind)) continue
        if (!nodesById.has(edge.target)) throw new Error(`Missing graph endpoint reference: ${edge.target}`)
        ids.add(edge.target)
      }
    }
    const sourcePath = nodesById.get(focusNodeId)?.path
    const fileContext = codeGraph.edges.filter(edge => edge.target === `file:${sourcePath}` && (edge.kind === 'rust-module-resolves-to-file' || edge.kind === 'rust-module-defined-in-file' && nodesById.get(edge.source)?.rustMetadata?.origin === 'root')).slice(0, 16)
    let moduleFrontier = new Set(fileContext.map(edge => edge.source))
    for (const id of moduleFrontier) ids.add(id)
    for (let depth = 0; depth < 2; depth++) {
      const parents = new Set<string>()
      for (const edge of codeGraph.edges) {
        if (!moduleFrontier.has(edge.target) || !['rust-module-contains-module', 'rust-target-contains-module'].includes(edge.kind)) continue
        if (nodesById.has(edge.source)) { ids.add(edge.source); parents.add(edge.source) }
      }
      moduleFrontier = parents
    }
    core.nodes = codeGraph.nodes.filter(node => ids.has(node.id)).sort((a, b) => {
      const priority = (id: string) => id === focusNodeId ? 0 : rustOwners.includes(id) ? 1 : nodesById.get(id)?.kind === 'symbol' ? 2 : 3
      return priority(a.id) - priority(b.id) || a.id.localeCompare(b.id)
    })
    core.edges = codeGraph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target))
  }
  const focusKind = nodesById.get(focusNodeId)?.kind
  if (focusKind === 'rust-package' || focusKind === 'rust-target') {
    const ids = new Set(core.nodes.map(node => node.id))
    // Retain target roots and their direct module children inside the selected
    // package/target only, under the existing node/edge caps.
    const targets = focusKind === 'rust-target' ? [focusNodeId] : core.nodes.filter(node => node.kind === 'rust-target').map(node => node.id)
    for (const edge of codeGraph.edges) {
      if (!targets.includes(edge.source) || !['rust-target-root-file', 'rust-target-contains-module'].includes(edge.kind)) continue
      if (!nodesById.has(edge.target)) throw new Error(`Missing graph endpoint reference: ${edge.target}`)
      ids.add(edge.target)
    }
    const moduleRoots = new Set([...ids].filter(id => nodesById.get(id)?.kind === 'rust-module'))
    for (const edge of codeGraph.edges) {
      if (edge.kind === 'rust-module-contains-module' && moduleRoots.has(edge.source) && nodesById.has(edge.target)) ids.add(edge.target)
    }
    core.nodes = codeGraph.nodes.filter(node => ids.has(node.id)).sort((a, b) => Number(b.id === focusNodeId) - Number(a.id === focusNodeId) || a.id.localeCompare(b.id))
    core.edges = codeGraph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target))
  }

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
  const directNodeIds = new Set(codeGraph.edges.filter(edge => edge.source === focusNodeId || edge.target === focusNodeId).flatMap(edge => [edge.source, edge.target]))

  return {
    nodes: cappedNodes.map((node) => toSelectedGraphNode(node, focusNodeId, directNodeIds.has(node.id))),
    edges: cappedEdges.map((edge) => toSelectedGraphEdge(edge, focusNodeId)),
    omittedNodeCount: core.nodes.length - cappedNodes.length,
    omittedEdgeCount: core.edges.length - cappedEdges.length,
    warnings: core.warnings,
  }
}

function toSelectedGraphNode(node: CodeGraphNode, focusNodeId: string, direct: boolean): SelectedGraphNode {
  const rustMetadata = node.rustMetadata
    ? Object.fromEntries(Object.entries(node.rustMetadata).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)))
    : undefined
  return {
    nodeId: node.id,
    kind: node.kind,
    label: node.label,
    ...(node.path ? { filePath: node.path } : {}),
    ...(node.kind === 'framework-route' ? { routeMetadata: node.routeMetadata } : {}),
    ...(node.rustMetadata || node.path?.endsWith('.rs') ? { rustMetadata, qualifiedName: node.qualifiedName, ownerKey: node.ownerKey, line: node.line } : {}),
    reasons: [node.id === focusNodeId ? 'primary focus node' : direct ? 'direct neighbor of focus node' : 'bounded Rust ownership neighbor of focus node'],
  }
}

function toSelectedGraphEdge(edge: CodeGraphEdge, focusNodeId: string): SelectedGraphEdge {
  const touchesFocus = edge.source === focusNodeId || edge.target === focusNodeId
  return {
    from: edge.source,
    to: edge.target,
    kind: edge.kind,
    ...(edge.kind === 'framework-router-mounts-route' || edge.kind.startsWith('rust-') ? { metadata: edge.metadata, edgeId: edge.id } : {}),
    reasons: [touchesFocus ? 'connects directly to focus node' : 'edge among retained neighborhood nodes'],
  }
}
