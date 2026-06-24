/**
 * Shared consumer logic for the frontend-reachability artifact (v1.3.0).
 *
 * Provides the mode resolution, filtering, edge-neighbor traversal, and result
 * builders used by the search, lookup, slice, and source command consumers.
 * Keeping this logic here keeps the command files thin and lets the unit tests
 * exercise the consumer behavior with inline artifact data (no CLI needed).
 */

import type {
  FrontendReachabilityArtifact,
  ReachabilityEdge,
  ReachabilityEvidenceRef,
  RouteFact,
  StorageKeyFact,
  UiReachabilityFact,
} from './types.js'

/** The three reachability retrieval modes shared by the consumer commands. */
export type ReachabilityMode = 'route' | 'storage-key' | 'ui'

/** The standard warning emitted when the artifact is missing. */
export const MISSING_ARTIFACT_WARNING =
  'frontend-reachability artifact not found; run index first'

export interface ReachabilityModeFlags {
  route?: string
  storageKey?: string
  ui?: string
}

/**
 * Resolves which reachability mode (if any) the flags request.
 * Throws if more than one of --route / --storage-key / --ui is supplied.
 * Returns null when none of the reachability flags are present.
 */
export function resolveReachabilityMode(
  flags: ReachabilityModeFlags
): { mode: ReachabilityMode; query: string } | null {
  const supplied: Array<{ mode: ReachabilityMode; query: string; flag: string }> = []
  if (flags.route !== undefined) supplied.push({ mode: 'route', query: flags.route, flag: '--route' })
  if (flags.storageKey !== undefined) {
    supplied.push({ mode: 'storage-key', query: flags.storageKey, flag: '--storage-key' })
  }
  if (flags.ui !== undefined) supplied.push({ mode: 'ui', query: flags.ui, flag: '--ui' })

  if (supplied.length === 0) return null
  if (supplied.length > 1) {
    const flagList = supplied.map((s) => s.flag).join(', ')
    throw new Error(
      `The reachability flags ${flagList} are mutually exclusive. Provide only one of --route, --storage-key, or --ui.`
    )
  }
  return { mode: supplied[0].mode, query: supplied[0].query }
}

// ---------------------------------------------------------------------------
// Fact filtering
// ---------------------------------------------------------------------------

/** Substring/id match for routes. */
export function filterRouteFacts(artifact: FrontendReachabilityArtifact, query: string): RouteFact[] {
  return artifact.routes.filter((r) => r.path.includes(query) || r.id === `route:${query}`)
}

/** Exact-or-substring match for storage keys. */
export function filterStorageKeyFacts(
  artifact: FrontendReachabilityArtifact,
  query: string
): StorageKeyFact[] {
  return artifact.storageKeys.filter((s) => s.key === query || s.key.includes(query))
}

/** Value/markerKind match for UI markers. */
export function filterUiFacts(
  artifact: FrontendReachabilityArtifact,
  query: string
): UiReachabilityFact[] {
  return artifact.uiReachability.filter(
    (u) => u.value === query || u.value.includes(query) || u.markerKind === query
  )
}

/** Exact match for a single route fact (lookup/source). */
export function findRouteFact(
  artifact: FrontendReachabilityArtifact,
  query: string
): RouteFact | undefined {
  return artifact.routes.find((r) => r.path === query || r.id === `route:${query}`)
}

/** Exact match for storage facts (lookup/source). */
export function findStorageKeyFacts(
  artifact: FrontendReachabilityArtifact,
  query: string
): StorageKeyFact[] {
  return artifact.storageKeys.filter((s) => s.key === query || s.id === query)
}

/** Value/substring match for UI facts (lookup/source). */
export function findUiFacts(
  artifact: FrontendReachabilityArtifact,
  query: string
): UiReachabilityFact[] {
  return artifact.uiReachability.filter(
    (u) => u.value === query || u.value.includes(query) || u.id === query
  )
}

// ---------------------------------------------------------------------------
// Edge traversal
// ---------------------------------------------------------------------------

/** Returns all edges incident on any of the given node ids. */
export function relatedEdges(
  artifact: FrontendReachabilityArtifact,
  nodeIds: Iterable<string>
): ReachabilityEdge[] {
  const ids = new Set(nodeIds)
  return artifact.edges.filter((e) => ids.has(e.source) || ids.has(e.target))
}

/** Returns the neighbor node id on the far side of an edge from the given anchor. */
export function edgeNeighborId(edge: ReachabilityEdge, anchorId: string): string {
  return edge.source === anchorId ? edge.target : edge.source
}

/**
 * Depth-bounded traversal across reachability edges from a set of root ids.
 * Returns the set of reached node ids and the edges traversed.
 */
export function traverseReachability(
  artifact: FrontendReachabilityArtifact,
  rootIds: string[],
  depth: number
): { nodeIds: Set<string>; edges: ReachabilityEdge[] } {
  const reached = new Set<string>(rootIds)
  const edgeIds = new Set<string>()
  const edges: ReachabilityEdge[] = []
  let frontier = new Set<string>(rootIds)

  for (let level = 0; level < depth; level++) {
    const next = new Set<string>()
    for (const edge of artifact.edges) {
      const sourceIn = frontier.has(edge.source)
      const targetIn = frontier.has(edge.target)
      if (!sourceIn && !targetIn) continue
      if (!edgeIds.has(edge.id)) {
        edgeIds.add(edge.id)
        edges.push(edge)
      }
      for (const id of [edge.source, edge.target]) {
        if (!reached.has(id)) {
          reached.add(id)
          next.add(id)
        }
      }
    }
    if (next.size === 0) break
    frontier = next
  }

  return { nodeIds: reached, edges }
}

// ---------------------------------------------------------------------------
// Index helpers for resolving fact ids to facts
// ---------------------------------------------------------------------------

export interface ReachabilityFactIndex {
  routes: Map<string, RouteFact>
  storageKeys: Map<string, StorageKeyFact>
  uiReachability: Map<string, UiReachabilityFact>
}

export function buildFactIndex(artifact: FrontendReachabilityArtifact): ReachabilityFactIndex {
  return {
    routes: new Map(artifact.routes.map((r) => [r.id, r])),
    storageKeys: new Map(artifact.storageKeys.map((s) => [s.id, s])),
    uiReachability: new Map(artifact.uiReachability.map((u) => [u.id, u])),
  }
}

/** Collects facts whose ids appear in the given id set, partitioned by kind. */
export function collectFactsByIds(
  index: ReachabilityFactIndex,
  ids: Iterable<string>
): { routes: RouteFact[]; storageKeys: StorageKeyFact[]; uiReachability: UiReachabilityFact[] } {
  const routes: RouteFact[] = []
  const storageKeys: StorageKeyFact[] = []
  const uiReachability: UiReachabilityFact[] = []
  for (const id of ids) {
    const route = index.routes.get(id)
    if (route) routes.push(route)
    const sk = index.storageKeys.get(id)
    if (sk) storageKeys.push(sk)
    const ui = index.uiReachability.get(id)
    if (ui) uiReachability.push(ui)
  }
  routes.sort((a, b) => a.id.localeCompare(b.id))
  storageKeys.sort((a, b) => a.id.localeCompare(b.id))
  uiReachability.sort((a, b) => a.id.localeCompare(b.id))
  return { routes, storageKeys, uiReachability }
}

/** First usable source ref for a fact (or null). */
export function firstSourceRef(refs: ReachabilityEvidenceRef[]): ReachabilityEvidenceRef | null {
  return refs.length > 0 ? refs[0] : null
}
