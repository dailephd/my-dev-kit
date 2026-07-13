import type { DataModelGraphArtifact, DataModelGraphNode } from '../data-model/dataModelGraphTypes.js'
import { DATA_MODEL_GRAPH_ARTIFACT_KIND } from '../data-model/dataModelGraphTypes.js'
import type { ModelViewLineageArtifact, ModelViewLineageNode } from '../lineage/types.js'
import { MODEL_VIEW_LINEAGE_ARTIFACT_KIND } from '../lineage/types.js'
import type { CodeGraph, CodeGraphNode } from './codeGraphTypes.js'
import type { RenderableGraph } from './renderableGraphTypes.js'

export type GraphArtifactSelection =
  | 'code'
  | 'data-model'
  | 'model-view-lineage'
  | 'react-component'
  | 'react-flow'
  | 'react-prop-event-flow'
  | 'frontend-test'
  | 'route'
  | 'browser-storage'
  | 'ui-reachability'
  | 'android-module'
  | 'android-manifest'
  | 'android-navigation'

export function adaptCodeGraph(graph: CodeGraph): RenderableGraph {
  if (!graph || typeof graph !== 'object') throw new Error('Invalid code-graph.json: expected an object.')
  if (graph.artifactKind !== 'code-graph') {
    throw new Error('Invalid code-graph.json: artifactKind must be code-graph.')
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error('Invalid code-graph.json: nodes and edges must be arrays.')
  }
  return {
    id: 'code',
    label: 'CodeGraph',
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: codeNodeLabel(node),
      shape: codeNodeShape(node),
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      label: edge.label ?? edge.kind,
    })),
  }
}

function validateCodeGraph(graph: CodeGraph): void {
  if (!graph || typeof graph !== 'object') throw new Error('Invalid code-graph.json: expected an object.')
  if (graph.artifactKind !== 'code-graph') {
    throw new Error('Invalid code-graph.json: artifactKind must be code-graph.')
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error('Invalid code-graph.json: nodes and edges must be arrays.')
  }
}

function toRenderableNode(node: CodeGraphNode) {
  return { id: node.id, kind: node.kind, label: codeNodeLabel(node), shape: codeNodeShape(node) }
}

function toRenderableEdge(edge: CodeGraph['edges'][number]) {
  return { id: edge.id, source: edge.source, target: edge.target, kind: edge.kind, label: edge.label ?? edge.kind }
}

/** Bounded-expansion filter: starts from nodes matching `seedKinds`, then follows only `expandEdgeKinds` edges one hop to pull in connected exact source classes/screens/deep-link matches (Batch 5 relationships), without inventing new edges. Every included edge is an actual `code-graph.json` edge - never a visual-only relationship. */
function filterByRelationship(
  graph: CodeGraph,
  seedKinds: Set<string>,
  expandEdgeKinds: Set<string>
): { nodes: CodeGraphNode[]; edges: CodeGraph['edges'] } {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  const includedIds = new Set(graph.nodes.filter((node) => seedKinds.has(node.kind)).map((node) => node.id))

  for (const edge of graph.edges) {
    if (!expandEdgeKinds.has(edge.kind)) continue
    if (includedIds.has(edge.source)) includedIds.add(edge.target)
    if (includedIds.has(edge.target)) includedIds.add(edge.source)
  }

  const nodes = [...includedIds]
    .map((id) => nodesById.get(id))
    .filter((node): node is CodeGraphNode => node !== undefined)
    .sort((a, b) => a.id.localeCompare(b.id))
  const edges = graph.edges
    .filter((edge) => expandEdgeKinds.has(edge.kind) && includedIds.has(edge.source) && includedIds.has(edge.target))
    .sort((a, b) => a.id.localeCompare(b.id))

  return { nodes, edges }
}

const ANDROID_MODULE_EDGE_KINDS = new Set([
  'module-contains-source-set',
  'manifest-declares-component',
  'manifest-component-resolves-to-source',
  'component-has-intent-filter',
  'component-uses-permission',
  'manifest-uses-permission',
  'resource-defined-in-file',
  'source-references-resource',
  'navigation-graph-contains-destination',
  'navigation-destination-has-action',
  'navigation-action-targets-destination',
  'navigation-action-pop-up-to-destination',
  'navigation-graph-includes-graph',
  'navigation-destination-has-deep-link',
  'manifest-deep-link-matches-navigation-deep-link',
  'navigation-destination-resolves-to-screen',
  'compose-route-resolves-to-screen',
])

/** `view --graph android-module` (v1.10.0 Batch 6): a module-centered graph of `android-module`/`android-source-set` nodes plus every node with a matching `androidModuleId`, expanded one hop across actual Batch 5 relationship edges to pull in connected exact source classes/screens. */
export function adaptAndroidModuleGraph(graph: CodeGraph): RenderableGraph {
  validateCodeGraph(graph)
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  const includedIds = new Set(
    graph.nodes
      .filter((node) => node.kind === 'android-module' || node.kind === 'android-source-set' || node.androidModuleId !== undefined)
      .map((node) => node.id)
  )
  for (const edge of graph.edges) {
    if (!ANDROID_MODULE_EDGE_KINDS.has(edge.kind)) continue
    const sourceIncluded = includedIds.has(edge.source)
    const targetIncluded = includedIds.has(edge.target)
    if (sourceIncluded && !targetIncluded) {
      const targetNode = nodesById.get(edge.target)
      if (targetNode && (targetNode.kind === 'file' || targetNode.kind === 'symbol')) includedIds.add(edge.target)
    }
    if (targetIncluded && !sourceIncluded) {
      const sourceNode = nodesById.get(edge.source)
      if (sourceNode && (sourceNode.kind === 'file' || sourceNode.kind === 'symbol')) includedIds.add(edge.source)
    }
  }

  const nodes = [...includedIds]
    .map((id) => nodesById.get(id))
    .filter((node): node is CodeGraphNode => node !== undefined)
    .sort((a, b) => a.id.localeCompare(b.id))
  const edges = graph.edges
    .filter((edge) => includedIds.has(edge.source) && includedIds.has(edge.target))
    .sort((a, b) => a.id.localeCompare(b.id))

  return {
    id: 'android-module',
    label: 'AndroidModuleGraph',
    nodes: nodes.map(toRenderableNode),
    edges: edges.map(toRenderableEdge),
  }
}

const ANDROID_MANIFEST_SEED_KINDS = new Set(['android-manifest-file', 'android-manifest-component', 'android-intent-filter', 'android-permission'])
const ANDROID_MANIFEST_EDGE_KINDS = new Set([
  'manifest-declares-component',
  'manifest-component-resolves-to-source',
  'component-has-intent-filter',
  'component-uses-permission',
  'manifest-uses-permission',
  'manifest-deep-link-matches-navigation-deep-link',
])

/** `view --graph android-manifest` (v1.10.0 Batch 6): manifest files/components/intent-filters/permissions plus exact source classes and matched navigation deep links, connected only by actual `manifest-*`/`component-*` relationship edges - never every manifest XML attribute, never a runtime-exported claim. */
export function adaptAndroidManifestGraph(graph: CodeGraph): RenderableGraph {
  validateCodeGraph(graph)
  const { nodes, edges } = filterByRelationship(graph, ANDROID_MANIFEST_SEED_KINDS, ANDROID_MANIFEST_EDGE_KINDS)
  return {
    id: 'android-manifest',
    label: 'AndroidManifestGraph',
    nodes: nodes.map(toRenderableNode),
    edges: edges.map(toRenderableEdge),
  }
}

const ANDROID_NAVIGATION_SEED_KINDS = new Set([
  'android-navigation-graph',
  'android-navigation-destination',
  'android-navigation-action',
  'android-navigation-deep-link',
  'android-compose-route',
])
const ANDROID_NAVIGATION_EDGE_KINDS = new Set([
  'navigation-graph-contains-destination',
  'navigation-destination-has-action',
  'navigation-action-targets-destination',
  'navigation-action-pop-up-to-destination',
  'navigation-graph-includes-graph',
  'navigation-destination-has-deep-link',
  'manifest-deep-link-matches-navigation-deep-link',
  'navigation-destination-resolves-to-screen',
  'compose-route-resolves-to-screen',
])

/** `view --graph android-navigation` (v1.10.0 Batch 6): XML navigation graphs/destinations/actions/deep-links and static Compose routes, plus exact screen symbols and matched manifest components, connected only by actual `navigation-*`/`compose-route-*`/`manifest-deep-link-*` relationship edges - never a simulated runtime navigation merge, never a selected target. */
export function adaptAndroidNavigationGraph(graph: CodeGraph): RenderableGraph {
  validateCodeGraph(graph)
  const { nodes, edges } = filterByRelationship(graph, ANDROID_NAVIGATION_SEED_KINDS, ANDROID_NAVIGATION_EDGE_KINDS)
  return {
    id: 'android-navigation',
    label: 'AndroidNavigationGraph',
    nodes: nodes.map(toRenderableNode),
    edges: edges.map(toRenderableEdge),
  }
}

export function adaptDataModelGraph(graph: DataModelGraphArtifact): RenderableGraph {
  if (!graph || typeof graph !== 'object') throw new Error('Invalid data-model-graph.json: expected an object.')
  if (graph.artifactKind !== DATA_MODEL_GRAPH_ARTIFACT_KIND) {
    throw new Error(`Invalid data-model-graph.json: artifactKind must be ${DATA_MODEL_GRAPH_ARTIFACT_KIND}.`)
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error('Invalid data-model-graph.json: nodes and edges must be arrays.')
  }
  return {
    id: 'data-model',
    label: 'DataModelGraph',
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: dataModelNodeLabel(node),
      shape: node.kind === 'entity' ? 'box' : 'ellipse',
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      label: edge.kind,
    })),
  }
}

export function adaptModelViewLineageGraph(graph: ModelViewLineageArtifact): RenderableGraph {
  if (!graph || typeof graph !== 'object') throw new Error('Invalid model-view-lineage.json: expected an object.')
  if (graph.artifactKind !== MODEL_VIEW_LINEAGE_ARTIFACT_KIND) {
    throw new Error(`Invalid model-view-lineage.json: artifactKind must be ${MODEL_VIEW_LINEAGE_ARTIFACT_KIND}.`)
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error('Invalid model-view-lineage.json: nodes and edges must be arrays.')
  }
  return {
    id: 'model-view-lineage',
    label: 'ModelViewLineage',
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: lineageNodeLabel(node),
      shape: lineageNodeShape(node.kind),
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      label: edge.kind,
    })),
  }
}

function codeNodeLabel(node: CodeGraphNode): string {
  if (node.kind === 'file') return node.path ?? node.label
  if (node.kind === 'symbol') {
    const base = node.symbolName ?? node.label
    const roles = compactSemanticRoles(node)
    return roles ? `${base}\n[${roles}]` : base
  }
  return node.label
}

function compactSemanticRoles(node: CodeGraphNode): string | null {
  const roles = [...new Set((node.semanticRoles ?? []).map((role) => role.subtype ?? role.role))]
    .filter(Boolean)
    .slice(0, 2)
  return roles.length > 0 ? roles.join(', ') : null
}

function codeNodeShape(node: CodeGraphNode): string {
  if (node.kind === 'file') return 'box'
  if (node.kind === 'symbol') return 'ellipse'
  return 'oval'
}

function dataModelNodeLabel(node: DataModelGraphNode): string {
  if (node.kind === 'field' && node.parentEntityId && !node.label.includes('.')) {
    const entityName = node.parentEntityId.replace(/^entity:/, '')
    return `${entityName}.${node.label}`
  }
  return node.label
}

function lineageNodeLabel(node: ModelViewLineageNode): string {
  return `${node.label}\n[${node.kind}]`
}

function lineageNodeShape(kind: string): string {
  if (kind === 'data-entity' || kind === 'component') return 'box'
  if (kind === 'transformation') return 'diamond'
  if (kind === 'view-model') return 'ellipse'
  if (kind === 'rendered-field' || kind === 'component-prop' || kind === 'data-field') return 'oval'
  return 'oval'
}
