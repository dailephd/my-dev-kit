import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from './codeGraphTypes.js'

/**
 * Merges Batch 5 Android artifact-backed nodes/edges into the existing code
 * graph additively — same merge shape as `addFrontendRelationshipsToCodeGraph`
 * (dedup by `id`, re-sort, refresh summary counts). The Android relationship
 * layer is always regenerated from scratch by the caller on every run (see
 * `buildAndroidArtifactRelationships`), so this merge never needs to reconcile
 * against a stale prior Android layer — it only needs to avoid colliding with
 * the base graph's existing file/symbol node and edge IDs, which it never can
 * by construction (distinct ID prefixes).
 */
export function addAndroidRelationshipsToCodeGraph(
  graph: CodeGraph,
  relationships: { nodes: CodeGraphNode[]; edges: CodeGraphEdge[] }
): CodeGraph {
  if (relationships.nodes.length === 0 && relationships.edges.length === 0) return graph

  const nodes = [...graph.nodes]
  const edges = [...graph.edges]
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edgeIds = new Set(edges.map((edge) => edge.id))

  for (const node of relationships.nodes) {
    if (nodeIds.has(node.id)) continue
    nodes.push(node)
    nodeIds.add(node.id)
  }
  for (const edge of relationships.edges) {
    if (edgeIds.has(edge.id)) continue
    edges.push(edge)
    edgeIds.add(edge.id)
  }

  sortById(nodes)
  sortById(edges)

  return {
    ...graph,
    nodes,
    edges,
    summary: {
      ...graph.summary,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      fileNodeCount: nodes.filter((node) => node.kind === 'file').length,
      symbolNodeCount: nodes.filter((node) => node.kind === 'symbol').length,
    },
  }
}

function sortById<T extends { id: string }>(items: T[]): void {
  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
