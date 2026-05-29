import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from '../graph/codeGraphTypes.js'

export interface LookupNodeResult {
  status: 'found'
  indexDir: string
  nodeId: string
  depth: number
  node: CodeGraphNode
  incomingEdges: CodeGraphEdge[]
  outgoingEdges: CodeGraphEdge[]
  neighbors: CodeGraphNode[]
  artifactPaths: {
    manifest: string
    codeGraph: string
  }
  warnings: string[]
}

export function lookupNode(options: {
  graph: CodeGraph
  indexDir: string
  nodeId: string
  depth: number
  manifestPath: string
  codeGraphPath: string
}): LookupNodeResult {
  validateDepth(options.depth)
  const node = options.graph.nodes.find((candidate) => candidate.id === options.nodeId)
  if (!node) throw new Error(`Node not found: ${options.nodeId}`)

  const incomingEdges = options.graph.edges
    .filter((edge) => edge.target === options.nodeId)
    .sort(compareById)
  const outgoingEdges = options.graph.edges
    .filter((edge) => edge.source === options.nodeId)
    .sort(compareById)
  const neighbors = collectNeighbors(options.graph, options.nodeId, options.depth)

  return {
    status: 'found',
    indexDir: options.indexDir,
    nodeId: options.nodeId,
    depth: options.depth,
    node,
    incomingEdges,
    outgoingEdges,
    neighbors,
    artifactPaths: {
      manifest: options.manifestPath,
      codeGraph: options.codeGraphPath,
    },
    warnings: [],
  }
}

export function validateDepth(depth: number): void {
  if (!Number.isInteger(depth)) throw new Error('Depth must be an integer.')
  if (depth < 0) throw new Error('Depth must be 0 or greater.')
  if (depth > 3) throw new Error('Depth greater than 3 is not supported.')
}

function collectNeighbors(graph: CodeGraph, nodeId: string, depth: number): CodeGraphNode[] {
  if (depth === 0) return []
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  const visited = new Set([nodeId])
  const neighborIds = new Set<string>()
  let frontier = new Set([nodeId])

  for (let level = 0; level < depth; level++) {
    const next = new Set<string>()
    for (const current of frontier) {
      for (const edge of graph.edges) {
        const adjacent = edge.source === current ? edge.target : edge.target === current ? edge.source : null
        if (!adjacent || visited.has(adjacent)) continue
        visited.add(adjacent)
        neighborIds.add(adjacent)
        next.add(adjacent)
      }
    }
    frontier = next
  }

  return [...neighborIds]
    .map((id) => nodesById.get(id))
    .filter((node): node is CodeGraphNode => node !== undefined)
    .sort(compareById)
}

function compareById<T extends { id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id)
}
