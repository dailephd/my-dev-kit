/**
 * v1.12.0 Batch 5: Android-aware extension of the existing `slice --include-tests`
 * modifier (node/composable/Android-selector slices, not the separate
 * frontend-reachability `--include-tests` path). Given the set of node ids
 * already present in a resolved slice, finds bounded, exact test evidence for
 * the production composable/route-destination/ViewModel nodes among them by
 * walking backward across the existing `android-test-references-*` edges and
 * the existing test file -> class -> method -> fact hierarchy edges. Never a
 * full class/file/artifact dump, never a fabricated node, never a runtime or
 * test-execution/coverage claim - static reference evidence only.
 */
import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from '../graph/codeGraphTypes.js'

const TEST_REFERENCE_EDGE_KINDS: ReadonlySet<string> = new Set([
  'android-test-references-composable',
  'android-test-references-route',
  'android-test-references-viewmodel',
])

/** Independent of any other slice cap (mirrors `MAX_DATA_FLOW_ADDED_NODES`). */
export const MAX_ANDROID_RELATED_TEST_NODES = 200

export interface AndroidRelatedTestsExpansion {
  addedNodeIds: string[]
  addedEdgeIds: string[]
  productionSeedCount: number
  relatedTestMethodCount: number
  truncated: boolean
}

function isProductionTestSeedNode(node: CodeGraphNode): boolean {
  if (node.kind === 'android-composable') return true
  if (node.kind === 'android-navigation-destination') return true
  if (node.kind === 'symbol' && (node.classificationRoles?.some((role) => role.role === 'view-model') ?? false)) {
    return true
  }
  return false
}

export function expandAndroidRelatedTests(
  graph: CodeGraph,
  slicedNodeIds: ReadonlySet<string>
): AndroidRelatedTestsExpansion {
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]))
  const productionSeedIds = [...slicedNodeIds].filter((id) => {
    const node = nodeMap.get(id)
    return node !== undefined && isProductionTestSeedNode(node)
  })

  const referenceEdgesByTarget = new Map<string, CodeGraphEdge[]>()
  for (const edge of graph.edges) {
    if (!TEST_REFERENCE_EDGE_KINDS.has(edge.kind)) continue
    const list = referenceEdgesByTarget.get(edge.target) ?? []
    list.push(edge)
    referenceEdgesByTarget.set(edge.target, list)
  }
  const factOwnerEdgeByFactId = edgeMapByTarget(graph, 'test-method-has-fact')
  const methodOwnerEdgeByMethodId = edgeMapByTarget(graph, 'test-class-defines-method')
  const classOwnerEdgeByClassId = edgeMapByTarget(graph, 'defines-test-class')

  const addedNodeIds = new Set<string>()
  const addedEdgeIds = new Set<string>()
  const relatedMethodIds = new Set<string>()
  let truncated = false

  const tryAddNode = (id: string): boolean => {
    if (addedNodeIds.has(id)) return true
    if (addedNodeIds.size >= MAX_ANDROID_RELATED_TEST_NODES) {
      truncated = true
      return false
    }
    addedNodeIds.add(id)
    return true
  }

  for (const seedId of productionSeedIds) {
    const refEdges = referenceEdgesByTarget.get(seedId) ?? []
    for (const refEdge of refEdges) {
      const factId = refEdge.source
      if (!tryAddNode(factId)) continue
      addedEdgeIds.add(refEdge.id)

      const methodEdge = factOwnerEdgeByFactId.get(factId)
      if (!methodEdge) continue
      const methodId = methodEdge.source
      relatedMethodIds.add(methodId)
      if (!tryAddNode(methodId)) continue
      addedEdgeIds.add(methodEdge.id)

      const classEdge = methodOwnerEdgeByMethodId.get(methodId)
      if (!classEdge) continue
      const classId = classEdge.source
      if (!tryAddNode(classId)) continue
      addedEdgeIds.add(classEdge.id)

      const fileEdge = classOwnerEdgeByClassId.get(classId)
      if (!fileEdge) continue
      if (!tryAddNode(fileEdge.source)) continue
      addedEdgeIds.add(fileEdge.id)
    }
  }

  return {
    addedNodeIds: [...addedNodeIds].sort(),
    addedEdgeIds: [...addedEdgeIds].sort(),
    productionSeedCount: productionSeedIds.length,
    relatedTestMethodCount: relatedMethodIds.size,
    truncated,
  }
}

function edgeMapByTarget(graph: CodeGraph, kind: string): Map<string, CodeGraphEdge> {
  const map = new Map<string, CodeGraphEdge>()
  for (const edge of graph.edges) {
    if (edge.kind === kind) map.set(edge.target, edge)
  }
  return map
}
