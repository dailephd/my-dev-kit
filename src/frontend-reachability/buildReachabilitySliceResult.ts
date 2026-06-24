/**
 * Builds the reachability slice result for `slice --route|--storage-key|--ui`.
 *
 * Performs a depth-bounded traversal of reachability edges from the matched
 * root fact, then partitions the reached facts by kind. The --include-storage,
 * --include-ui, and --include-tests modifiers control which neighbor facts and
 * test evidence are surfaced.
 */

import type {
  FrontendReachabilityArtifact,
  ReachabilityEdge,
  RouteFact,
  StorageKeyFact,
  TestEvidenceRef,
  UiReachabilityFact,
} from './types.js'
import {
  findRouteFact,
  findStorageKeyFacts,
  findUiFacts,
  traverseReachability,
  buildFactIndex,
  collectFactsByIds,
  MISSING_ARTIFACT_WARNING,
  type ReachabilityMode,
} from './reachabilityConsumers.js'

export interface ReachabilitySliceModifiers {
  includeTests?: boolean
  includeStorage?: boolean
  includeUi?: boolean
}

export interface ReachabilitySliceResult {
  artifactKind: 'my-dev-kit-v1-reachability-slice-result'
  version: '1.0.0'
  mode: ReachabilityMode
  query: string
  status: 'ok' | 'not-found' | 'missing-artifact'
  facts: {
    routes: RouteFact[]
    storageKeys: StorageKeyFact[]
    uiReachability: UiReachabilityFact[]
  }
  edges: ReachabilityEdge[]
  testEvidence: TestEvidenceRef[]
  warnings: string[]
  summary: {
    routeCount: number
    storageKeyCount: number
    uiCount: number
    edgeCount: number
  }
}

const ROUTE_SLICE_DEPTH = 1
const STORAGE_SLICE_DEPTH = 2
const UI_SLICE_DEPTH = 2

function emptyResult(
  mode: ReachabilityMode,
  query: string,
  status: 'not-found' | 'missing-artifact',
  warning: string
): ReachabilitySliceResult {
  return {
    artifactKind: 'my-dev-kit-v1-reachability-slice-result',
    version: '1.0.0',
    mode,
    query,
    status,
    facts: { routes: [], storageKeys: [], uiReachability: [] },
    edges: [],
    testEvidence: [],
    warnings: [warning],
    summary: { routeCount: 0, storageKeyCount: 0, uiCount: 0, edgeCount: 0 },
  }
}

export function buildReachabilitySliceResult(
  artifact: FrontendReachabilityArtifact | null,
  mode: ReachabilityMode,
  query: string,
  modifiers: ReachabilitySliceModifiers
): ReachabilitySliceResult {
  if (!artifact) return emptyResult(mode, query, 'missing-artifact', MISSING_ARTIFACT_WARNING)

  let rootId: string | undefined
  let depth: number
  if (mode === 'route') {
    rootId = findRouteFact(artifact, query)?.id
    // Depth 1 reaches the owning component; depth 2 reaches the storage/UI facts
    // linked through that component, which the include modifiers surface.
    depth =
      modifiers.includeStorage || modifiers.includeUi || modifiers.includeTests
        ? ROUTE_SLICE_DEPTH + 1
        : ROUTE_SLICE_DEPTH
  } else if (mode === 'storage-key') {
    rootId = findStorageKeyFacts(artifact, query)[0]?.id
    depth = STORAGE_SLICE_DEPTH
  } else {
    rootId = findUiFacts(artifact, query)[0]?.id
    depth = UI_SLICE_DEPTH
  }

  if (!rootId) {
    return emptyResult(
      mode,
      query,
      'not-found',
      `No ${mode} fact found matching "${query}" in frontend-reachability artifact.`
    )
  }

  const traversal = traverseReachability(artifact, [rootId], depth)
  const index = buildFactIndex(artifact)
  const collected = collectFactsByIds(index, traversal.nodeIds)

  // Apply include modifiers. The root fact's own kind is always retained.
  let storageKeys = collected.storageKeys
  let uiReachability = collected.uiReachability

  if (mode === 'route') {
    if (!modifiers.includeStorage) storageKeys = []
    if (!modifiers.includeUi) uiReachability = []
  }
  // For storage-key and ui modes the cross-domain neighbors are intrinsic to the
  // slice, so they are kept regardless of modifiers.

  const testEvidence: TestEvidenceRef[] = []
  if (modifiers.includeTests) {
    for (const ui of uiReachability) {
      testEvidence.push(...ui.testEvidenceRefs)
    }
  }

  return {
    artifactKind: 'my-dev-kit-v1-reachability-slice-result',
    version: '1.0.0',
    mode,
    query,
    status: 'ok',
    facts: {
      routes: collected.routes,
      storageKeys,
      uiReachability,
    },
    edges: traversal.edges,
    testEvidence,
    warnings: [],
    summary: {
      routeCount: collected.routes.length,
      storageKeyCount: storageKeys.length,
      uiCount: uiReachability.length,
      edgeCount: traversal.edges.length,
    },
  }
}
