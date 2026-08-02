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
  | 'compose-ui'
  | 'compose-navigation'
  | 'android-test'

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

/** Bounded-expansion filter: starts from nodes matching `seedKinds`, then follows only `expandEdgeKinds` edges one hop to pull in connected exact source classes/screens/deep-link matches, without inventing new edges. Every included edge is an actual `code-graph.json` edge - never a visual-only relationship. */
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

const COMPOSE_UI_SEED_KINDS = new Set(['android-composable', 'android-compose-fact'])
const COMPOSE_UI_EDGE_KINDS = new Set([
  'defines-composable',
  'composable-calls-composable',
  'composable-has-fact',
  'composable-references-viewmodel',
  'compose-string-references-resource',
])

/** `view --graph compose-ui` (v1.11.0 Batch 6): every `android-composable`/`android-compose-fact` node (state, effect, ViewModel reference, test tag, visible text, string resource, click handler, navigation call, and UI-region facts alike - distinguished by node label/`androidMetadata.factKind`, not by a dedicated node kind per fact), plus the defining Kotlin file/symbol, exact ViewModel symbol, and exact resource-definition nodes an existing edge already connects to them. Never the whole `code-graph.json`, never Android test evidence, never an invented relationship. */
export function adaptComposeUiGraph(graph: CodeGraph): RenderableGraph {
  validateCodeGraph(graph)
  const { nodes, edges } = filterByRelationship(graph, COMPOSE_UI_SEED_KINDS, COMPOSE_UI_EDGE_KINDS)
  return {
    id: 'compose-ui',
    label: 'ComposeUiGraph',
    nodes: nodes.map(toRenderableNode),
    edges: edges.map(toRenderableEdge),
  }
}

function isComposeNavigationSeed(node: CodeGraphNode): boolean {
  if (node.kind === 'android-composable') return true
  if (node.kind === 'android-compose-route' || node.kind === 'android-navigation-destination' || node.kind === 'android-navigation-graph') return true
  if (node.kind === 'android-compose-fact') {
    const factKind = node.androidMetadata?.factKind
    return factKind === 'click-handler' || factKind === 'navigation-call'
  }
  return false
}
/** Edge kinds allowed to appear in the rendered compose-navigation graph, once both endpoints are already included. */
const COMPOSE_NAVIGATION_DISPLAY_EDGE_KINDS = new Set([
  'defines-composable',
  'composable-has-fact',
  'click-handler-contains-navigation-call',
  'compose-navigation-targets-route',
  'navigation-graph-contains-destination',
  'navigation-destination-resolves-to-screen',
  'compose-route-resolves-to-screen',
])
/**
 * Edge kinds allowed to pull in a genuinely new (non-seeded) node - only the
 * composable's defining file/symbol and an exact screen-symbol target.
 * Deliberately narrower than the display set above: `composable-has-fact`
 * connects every composable to *all* of its facts (state/effect/test-tag/
 * visible-text/string-resource included), and if it were allowed to expand
 * the seed set here it would silently pull every unrelated fact into a
 * "navigation" view. Both endpoints of a `composable-has-fact` edge relevant
 * to navigation are already seeded directly by `isComposeNavigationSeed`
 * (the composable, and the click-handler/navigation-call fact), so the edge
 * still renders via the display set - it just never expands who gets seeded.
 */
const COMPOSE_NAVIGATION_EXPANSION_EDGE_KINDS = new Set([
  'defines-composable',
  'navigation-destination-resolves-to-screen',
  'compose-route-resolves-to-screen',
])

/**
 * `view --graph compose-navigation` (v1.11.0 Batch 6): the static chain
 * `composable -> click-handler fact -> navigation-call fact -> route/destination
 * candidate -> screen candidate`, seeded from `android-composable` nodes and only
 * the click-handler/navigation-call `android-compose-fact` nodes (never the
 * unrelated state/effect/test-tag/visible-text/string-resource facts on the
 * same composable), plus existing `android-compose-route`/
 * `android-navigation-destination`/`android-navigation-graph` nodes and their
 * already-projected screen/deep-link relationships. Every ambiguous
 * candidate is preserved (Batch 3/4 never picked a winner when building
 * these edges, and this view does not either); an unresolved navigation call
 * simply has no outgoing `compose-navigation-targets-route` edge - it is
 * still rendered, never given a fabricated target.
 */
export function adaptComposeNavigationGraph(graph: CodeGraph): RenderableGraph {
  validateCodeGraph(graph)
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  const includedIds = new Set(graph.nodes.filter(isComposeNavigationSeed).map((node) => node.id))

  for (const edge of graph.edges) {
    if (!COMPOSE_NAVIGATION_EXPANSION_EDGE_KINDS.has(edge.kind)) continue
    if (includedIds.has(edge.source)) includedIds.add(edge.target)
    if (includedIds.has(edge.target)) includedIds.add(edge.source)
  }

  const nodes = [...includedIds]
    .map((id) => nodesById.get(id))
    .filter((node): node is CodeGraphNode => node !== undefined)
    .sort((a, b) => a.id.localeCompare(b.id))
  const edges = graph.edges
    .filter((edge) => COMPOSE_NAVIGATION_DISPLAY_EDGE_KINDS.has(edge.kind) && includedIds.has(edge.source) && includedIds.has(edge.target))
    .sort((a, b) => a.id.localeCompare(b.id))

  return {
    id: 'compose-navigation',
    label: 'ComposeNavigationGraph',
    nodes: nodes.map(toRenderableNode),
    edges: edges.map(toRenderableEdge),
  }
}

const ANDROID_TEST_SEED_KINDS = new Set(['android-test-file', 'android-test-class', 'android-test-method', 'android-test-fact'])
const ANDROID_TEST_EDGE_KINDS = new Set([
  'defines-test-class',
  'test-class-defines-method',
  'test-class-uses-rule',
  'test-method-has-fact',
  'android-test-uses-double',
  'android-test-references-composable',
  'android-test-references-route',
  'android-test-references-viewmodel',
])

/** `view --graph android-test` (v1.11.0 Batch 6): the full test file/class/method/fact hierarchy plus exact production composable/route/ViewModel-symbol nodes an existing `android-test-references-*`/`android-test-uses-double` edge already connects to a test fact - never every production Compose/navigation/resource node, never a runtime coverage or pass/fail claim. */
export function adaptAndroidTestGraph(graph: CodeGraph): RenderableGraph {
  validateCodeGraph(graph)
  const { nodes, edges } = filterByRelationship(graph, ANDROID_TEST_SEED_KINDS, ANDROID_TEST_EDGE_KINDS)
  return {
    id: 'android-test',
    label: 'AndroidTestGraph',
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
  if (node.kind === 'android-compose-fact' || node.kind === 'android-test-fact') {
    const factKind = node.androidMetadata?.factKind
    return factKind ? `${node.label}\n[${factKind}]` : node.label
  }
  if (node.kind === 'android-test-file') {
    const category = node.androidMetadata?.category
    return category ? `${node.label}\n[${category}]` : node.label
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
  if (node.kind === 'android-composable') return 'component'
  if (node.kind === 'android-compose-fact') return 'note'
  if (node.kind === 'android-test-file') return 'folder'
  if (node.kind === 'android-test-class') return 'box3d'
  if (node.kind === 'android-test-method') return 'cds'
  if (node.kind === 'android-test-fact') return 'note'
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
