import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from './codeGraphTypes.js'
import type { GraphSliceCore, GraphSliceDirection } from './graphSliceTypes.js'

/** v1.12.0 Batch 5: cap on nodes added by the `dataFlowEdgeKinds` secondary pass, independent of any other slice cap. */
export const MAX_DATA_FLOW_ADDED_NODES = 200

export function sliceGraph(options: {
  graph: CodeGraph
  focusNodeId: string
  depth: number
  direction: GraphSliceDirection
  includeEdgeKinds?: Set<string>
  /** v1.12.0 Batch 5 (`slice --include-data-flow`): additive secondary BFS pass that always traverses `both` directions, regardless of `options.direction`, bounded by `options.depth`. */
  dataFlowEdgeKinds?: Set<string>
}): GraphSliceCore {
  validateSliceInputs(options.depth, options.direction)
  const nodeMap = new Map(options.graph.nodes.map((node) => [node.id, node]))
  if (!nodeMap.has(options.focusNodeId)) throw new Error(`Node not found: ${options.focusNodeId}`)

  const includedNodeIds = new Set([options.focusNodeId])
  let frontier = new Set([options.focusNodeId])

  for (let level = 0; level < options.depth; level++) {
    const next = new Set<string>()
    for (const current of frontier) {
      for (const edge of options.graph.edges) {
        for (const adjacent of adjacentNodes(edge, current, options.direction)) {
          if (includedNodeIds.has(adjacent)) continue
          includedNodeIds.add(adjacent)
          next.add(adjacent)
        }
      }
    }
    frontier = next
  }

  if (options.includeEdgeKinds && options.includeEdgeKinds.size > 0) {
    let flowFrontier = new Set(includedNodeIds)
    const flowDepth = Math.max(3, options.depth)
    for (let level = 0; level < flowDepth; level++) {
      const next = new Set<string>()
      for (const current of flowFrontier) {
        for (const edge of options.graph.edges) {
          if (!options.includeEdgeKinds.has(edge.kind)) continue
          for (const adjacent of adjacentNodes(edge, current, options.direction)) {
            if (includedNodeIds.has(adjacent)) continue
            includedNodeIds.add(adjacent)
            next.add(adjacent)
          }
        }
      }
      flowFrontier = next
      if (flowFrontier.size === 0) break
    }
  }

  let dataFlowExpansion: GraphSliceCore['dataFlowExpansion']
  if (options.dataFlowEdgeKinds && options.dataFlowEdgeKinds.size > 0) {
    const addedNodeIds: string[] = []
    let truncated = false
    let dataFlowFrontier = new Set(includedNodeIds)
    for (let level = 0; level < options.depth; level++) {
      const next = new Set<string>()
      for (const current of dataFlowFrontier) {
        for (const edge of options.graph.edges) {
          if (!options.dataFlowEdgeKinds.has(edge.kind)) continue
          for (const adjacent of adjacentNodes(edge, current, 'both')) {
            if (includedNodeIds.has(adjacent)) continue
            if (addedNodeIds.length >= MAX_DATA_FLOW_ADDED_NODES) {
              truncated = true
              continue
            }
            includedNodeIds.add(adjacent)
            addedNodeIds.push(adjacent)
            next.add(adjacent)
          }
        }
      }
      dataFlowFrontier = next
      if (dataFlowFrontier.size === 0 && !truncated) break
    }
    dataFlowExpansion = { addedNodeIds, truncated }
  }

  const nodes = [...includedNodeIds]
    .map((id) => nodeMap.get(id))
    .filter((node): node is CodeGraphNode => node !== undefined)
    .sort(compareById)
  const edges = dedupeEdges(options.graph.edges)
    .filter((edge) => includedNodeIds.has(edge.source) && includedNodeIds.has(edge.target))
    .filter((edge) => edgeAllowedForDirection(edge, includedNodeIds, options.focusNodeId, options.direction))
    .sort(compareById)

  return { nodes, edges, warnings: [], ...(dataFlowExpansion ? { dataFlowExpansion } : {}) }
}

export function validateSliceInputs(depth: number, direction: GraphSliceDirection): void {
  if (!Number.isInteger(depth)) throw new Error('Depth must be an integer.')
  if (depth < 0) throw new Error('Depth must be 0 or greater.')
  if (depth > 3) throw new Error('Depth greater than 3 is not supported.')
  if (!['both', 'incoming', 'outgoing'].includes(direction)) {
    throw new Error('Direction must be one of: both, incoming, outgoing.')
  }
}

export function summarizeSlice(nodes: CodeGraphNode[], edges: CodeGraphEdge[]) {
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodesByKind: countBy(nodes.map((node) => node.kind)),
    edgesByKind: countBy(edges.map((edge) => edge.kind)),
  }
}

function adjacentNodes(edge: CodeGraphEdge, current: string, direction: GraphSliceDirection): string[] {
  if (direction === 'outgoing') return edge.source === current ? [edge.target] : []
  if (direction === 'incoming') return edge.target === current ? [edge.source] : []
  if (edge.source === current) return [edge.target]
  if (edge.target === current) return [edge.source]
  return []
}

function edgeAllowedForDirection(
  edge: CodeGraphEdge,
  includedNodeIds: Set<string>,
  focusNodeId: string,
  direction: GraphSliceDirection
): boolean {
  if (direction === 'both') return true
  if (focusNodeId && includedNodeIds.size > 0) return true
  return edge.source !== edge.target
}

function dedupeEdges(edges: CodeGraphEdge[]): CodeGraphEdge[] {
  const seen = new Set<string>()
  const result: CodeGraphEdge[] = []
  for (const edge of edges) {
    if (seen.has(edge.id)) continue
    seen.add(edge.id)
    result.push(edge)
  }
  return result
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values.sort()) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

function compareById<T extends { id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id)
}
