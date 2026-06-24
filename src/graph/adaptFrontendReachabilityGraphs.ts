/**
 * Graph adapters for the frontend-reachability artifact (v1.3.0).
 *
 * Each adapter turns the route / browser-storage / ui-reachability domain of
 * the artifact into a RenderableGraph that the shared DOT/SVG/PNG pipeline can
 * render. Node ids are always quoted by the DOT builder, so the raw fact ids
 * (which contain colons and slashes) are passed through unchanged.
 */

import type {
  FrontendReachabilityArtifact,
  ReachabilityEdge,
  ReachabilityEdgeKind,
} from '../frontend-reachability/types.js'
import { FRONTEND_REACHABILITY_ARTIFACT_KIND } from '../frontend-reachability/types.js'
import type { RenderableGraph, RenderableGraphEdge, RenderableGraphNode } from './renderableGraphTypes.js'

/** Max characters in a DOT node label. */
const MAX_LABEL = 80

export function validateReachabilityArtifact(
  artifact: unknown
): asserts artifact is FrontendReachabilityArtifact {
  if (!artifact || typeof artifact !== 'object') {
    throw new Error('Invalid frontend-reachability.json: expected an object.')
  }
  const a = artifact as Record<string, unknown>
  if (a.artifactKind !== FRONTEND_REACHABILITY_ARTIFACT_KIND) {
    throw new Error(
      `Invalid frontend-reachability.json: artifactKind must be ${FRONTEND_REACHABILITY_ARTIFACT_KIND}, got "${String(
        a.artifactKind
      )}".`
    )
  }
  if (
    !Array.isArray(a.routes) ||
    !Array.isArray(a.storageKeys) ||
    !Array.isArray(a.uiReachability) ||
    !Array.isArray(a.edges)
  ) {
    throw new Error('Invalid frontend-reachability.json: routes, storageKeys, uiReachability, and edges must be arrays.')
  }
}

/** Escapes/truncates a label for safe DOT rendering. */
function safeLabel(value: string): string {
  const collapsed = value.replace(/[\n\r]+/g, ' ').replace(/"/g, '\\"')
  if (collapsed.length <= MAX_LABEL) return collapsed
  return `${collapsed.slice(0, MAX_LABEL - 1)}…`
}

/** Last path segment of a component id, for compact component labels. */
function shortComponentName(componentId: string): string {
  const parts = componentId.split(/[:/]/).filter(Boolean)
  return parts.at(-1) ?? componentId
}

function uniqueComponentIds(facts: Array<{ componentIds: string[] }>): string[] {
  const seen = new Set<string>()
  for (const fact of facts) {
    for (const id of fact.componentIds) seen.add(id)
  }
  return [...seen].sort()
}

const EDGE_LABELS: Record<ReachabilityEdgeKind, string> = {
  'route-serves-component': 'serves',
  'component-uses-storage': 'uses',
  'component-renders-ui': 'renders',
  'storage-gates-ui': 'gates',
  'route-reaches-ui': 'reaches',
  'test-covers-ui': 'covers',
  'ui-in-gated-region': 'in-region',
}

function edgeLabelFor(kind: ReachabilityEdgeKind): string {
  return EDGE_LABELS[kind] ?? kind
}

function toRenderableEdge(edge: ReachabilityEdge): RenderableGraphEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    kind: edge.kind,
    label: edgeLabelFor(edge.kind),
  }
}

/** Filters node list down to those referenced by at least one of the given edges. */
function keepConnectedNodes(
  nodes: RenderableGraphNode[],
  edges: RenderableGraphEdge[]
): RenderableGraphNode[] {
  if (edges.length === 0) return nodes
  const referenced = new Set<string>()
  for (const edge of edges) {
    referenced.add(edge.source)
    referenced.add(edge.target)
  }
  return nodes.filter((n) => referenced.has(n.id))
}

function dedupeNodes(nodes: RenderableGraphNode[]): RenderableGraphNode[] {
  const seen = new Set<string>()
  const out: RenderableGraphNode[] = []
  for (const node of nodes) {
    if (seen.has(node.id)) continue
    seen.add(node.id)
    out.push(node)
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

// ---------------------------------------------------------------------------
// route graph
// ---------------------------------------------------------------------------

export function adaptRouteGraph(artifact: FrontendReachabilityArtifact): RenderableGraph {
  validateReachabilityArtifact(artifact)

  const nodes: RenderableGraphNode[] = [
    ...artifact.routes.map<RenderableGraphNode>((r) => ({
      id: r.id,
      kind: 'route',
      label: safeLabel(r.path),
      shape: 'box',
    })),
    ...uniqueComponentIds(artifact.routes).map<RenderableGraphNode>((cid) => ({
      id: cid,
      kind: 'component',
      label: safeLabel(shortComponentName(cid)),
      shape: 'ellipse',
    })),
  ]

  const edges = artifact.edges
    .filter((e) => e.kind === 'route-serves-component' || e.kind === 'route-reaches-ui')
    .map(toRenderableEdge)

  // route-reaches-ui targets are UI markers; add them as nodes when present.
  const uiTargets = new Set(
    artifact.edges.filter((e) => e.kind === 'route-reaches-ui').map((e) => e.target)
  )
  for (const ui of artifact.uiReachability) {
    if (uiTargets.has(ui.id)) {
      nodes.push({ id: ui.id, kind: 'ui-marker', label: safeLabel(`${ui.markerKind}:${ui.value}`), shape: 'note' })
    }
  }

  return {
    id: 'route',
    label: 'RouteGraph',
    nodes: dedupeNodes(nodes),
    edges,
  }
}

// ---------------------------------------------------------------------------
// browser-storage graph
// ---------------------------------------------------------------------------

export function adaptBrowserStorageGraph(artifact: FrontendReachabilityArtifact): RenderableGraph {
  validateReachabilityArtifact(artifact)

  const nodes: RenderableGraphNode[] = [
    ...artifact.storageKeys.map<RenderableGraphNode>((s) => ({
      id: s.id,
      kind: 'storage-key',
      label: safeLabel(`${s.storageKind}:${s.key}`),
      shape: 'cylinder',
    })),
    ...uniqueComponentIds(artifact.storageKeys).map<RenderableGraphNode>((cid) => ({
      id: cid,
      kind: 'component',
      label: safeLabel(shortComponentName(cid)),
      shape: 'ellipse',
    })),
  ]

  const edges = artifact.edges
    .filter((e) => e.kind === 'component-uses-storage' || e.kind === 'storage-gates-ui')
    .map(toRenderableEdge)

  // storage-gates-ui targets are UI markers; add them when present.
  const uiTargets = new Set(
    artifact.edges.filter((e) => e.kind === 'storage-gates-ui').map((e) => e.target)
  )
  for (const ui of artifact.uiReachability) {
    if (uiTargets.has(ui.id)) {
      nodes.push({ id: ui.id, kind: 'ui-marker', label: safeLabel(`${ui.markerKind}:${ui.value}`), shape: 'note' })
    }
  }

  return {
    id: 'browser-storage',
    label: 'BrowserStorageGraph',
    nodes: dedupeNodes(nodes),
    edges,
  }
}

// ---------------------------------------------------------------------------
// ui-reachability graph
// ---------------------------------------------------------------------------

const UI_GRAPH_EDGE_KINDS: ReadonlySet<ReachabilityEdgeKind> = new Set<ReachabilityEdgeKind>([
  'route-reaches-ui',
  'storage-gates-ui',
  'component-renders-ui',
  'test-covers-ui',
])

export function adaptUiReachabilityGraph(artifact: FrontendReachabilityArtifact): RenderableGraph {
  validateReachabilityArtifact(artifact)

  const allNodes: RenderableGraphNode[] = [
    ...artifact.uiReachability.map<RenderableGraphNode>((u) => ({
      id: u.id,
      kind: 'ui-marker',
      label: safeLabel(`${u.markerKind}:${u.value}`),
      shape: 'note',
    })),
    ...artifact.routes.map<RenderableGraphNode>((r) => ({
      id: r.id,
      kind: 'route',
      label: safeLabel(r.path),
      shape: 'box',
    })),
    ...artifact.storageKeys.map<RenderableGraphNode>((s) => ({
      id: s.id,
      kind: 'storage-key',
      label: safeLabel(s.key),
      shape: 'cylinder',
    })),
  ]

  const edges = artifact.edges.filter((e) => UI_GRAPH_EDGE_KINDS.has(e.kind)).map(toRenderableEdge)

  // Add any component / test-block endpoints referenced by edges but not yet a node.
  const knownIds = new Set(allNodes.map((n) => n.id))
  for (const edge of edges) {
    for (const id of [edge.source, edge.target]) {
      if (!knownIds.has(id)) {
        knownIds.add(id)
        allNodes.push({ id, kind: 'component', label: safeLabel(shortComponentName(id)), shape: 'ellipse' })
      }
    }
  }

  const connected = keepConnectedNodes(allNodes, edges)

  return {
    id: 'ui-reachability',
    label: 'UiReachabilityGraph',
    nodes: dedupeNodes(connected.length > 0 ? connected : allNodes),
    edges,
  }
}
