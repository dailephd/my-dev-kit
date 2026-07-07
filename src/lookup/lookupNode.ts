import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from '../graph/codeGraphTypes.js'
import type { SemanticArtifactRef, SemanticEvidenceRef, SemanticRole } from '../semantics/index.js'
import type { IndexManifest } from '../indexing/manifestTypes.js'
import type { ClassificationEntry, ClassificationRoleRef } from '../classification/classificationTypes.js'
import type { AndroidComponentRoleRef } from '../android/androidComponentTypes.js'
import {
  findClassificationEntryByTargetId,
  loadClassificationArtifact,
} from '../classification/resolveClassificationForCommands.js'

export interface LookupNodeResult {
  status: 'found'
  indexDir: string
  nodeId: string
  depth: number
  node: CodeGraphNode
  semanticRoles?: SemanticRole[]
  artifactRefs?: SemanticArtifactRef[]
  evidenceRefs?: SemanticEvidenceRef[]
  classificationRoles?: ClassificationRoleRef[]
  classificationRefs?: SemanticArtifactRef[]
  androidComponentRoles?: AndroidComponentRoleRef[]
  androidComponentRefs?: SemanticArtifactRef[]
  /** Full ClassificationEntry detail, resolved from classification.json only when `resolveClassification` is requested. */
  classificationDetail?: ClassificationEntry | null
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
  /** When true and `manifest` is provided, resolves the full ClassificationEntry from classification.json (on request, per classification-contract.txt section 8). */
  resolveClassification?: boolean
  manifest?: IndexManifest
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

  const classificationDetail =
    options.resolveClassification && options.manifest
      ? findClassificationEntryByTargetId(loadClassificationArtifact(options.indexDir, options.manifest), options.nodeId)
      : undefined

  return {
    status: 'found',
    indexDir: options.indexDir,
    nodeId: options.nodeId,
    depth: options.depth,
    node,
    semanticRoles: emptyToUndefined(node.semanticRoles),
    artifactRefs: emptyToUndefined(node.artifactRefs),
    evidenceRefs: emptyToUndefined(collectEvidenceRefs(node.semanticRoles)),
    classificationRoles: emptyToUndefined(node.classificationRoles),
    classificationRefs: emptyToUndefined(node.classificationRefs),
    ...(classificationDetail !== undefined ? { classificationDetail } : {}),
    androidComponentRoles: emptyToUndefined(node.androidComponentRoles),
    androidComponentRefs: emptyToUndefined(node.androidComponentRefs),
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

function collectEvidenceRefs(semanticRoles: SemanticRole[] | undefined): SemanticEvidenceRef[] {
  const refs: SemanticEvidenceRef[] = []
  const seen = new Set<string>()
  for (const role of semanticRoles ?? []) {
    for (const ref of role.evidenceRefs ?? []) {
      const key = JSON.stringify(ref)
      if (seen.has(key)) continue
      seen.add(key)
      refs.push(ref)
    }
  }
  return refs
}

function emptyToUndefined<T>(values: T[] | undefined): T[] | undefined {
  return values && values.length > 0 ? values : undefined
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
