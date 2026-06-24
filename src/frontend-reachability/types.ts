/**
 * Type definitions for the frontend-reachability artifact (v1.3.0).
 *
 * The artifact links route paths, browser storage keys, and UI markers
 * together through component membership and explicit reachability edges.
 * It is produced once during the index pass from the frontend-semantic
 * artifact and consumed by search, lookup, slice, source, and view commands.
 */

export const FRONTEND_REACHABILITY_SCHEMA_VERSION = '1.0.0'
export const FRONTEND_REACHABILITY_ARTIFACT_KIND = 'my-dev-kit-v1-frontend-reachability'

/** Static confidence level for an extracted fact or edge. */
export type ReachabilityConfidence = 'high' | 'medium' | 'low'

/** UI marker kinds, mirroring the relevant UiStringCandidate kinds. */
export type UiMarkerKind =
  | 'data-testid'
  | 'aria-label'
  | 'visible-text'
  | 'placeholder'
  | 'aria-labelledby'

/** JSX region kinds, mirroring JsxRegionCandidate kinds. */
export type JsxRegionKind =
  | 'return'
  | 'ternary-branch'
  | 'logical-branch'
  | 'early-return'
  | 'fragment'
  | 'helper'
  | 'unknown'

export type StorageKind = 'localStorage' | 'sessionStorage' | 'cookie'

export type ReachabilityWarningKind =
  | 'dynamic-route'
  | 'dynamic-storage-key'
  | 'dynamic-condition'
  | 'missing-test-evidence'
  | 'ambiguous-component-ownership'
  | 'missing-frontend-semantic'
  | 'truncated-value'
  | 'partial-extraction'
  | 'unsupported-pattern'

export type ReachabilityEdgeKind =
  | 'route-serves-component'
  | 'component-uses-storage'
  | 'component-renders-ui'
  | 'storage-gates-ui'
  | 'route-reaches-ui'
  | 'test-covers-ui'
  | 'ui-in-gated-region'

/** Evidence ref pointing to a source location. File paths are relative to the project root. */
export interface ReachabilityEvidenceRef {
  filePath: string
  symbolId?: string | null
  line?: number | null
  column?: number | null
  nodeId?: string | null
}

/** Test evidence ref linking a UI marker to a Playwright/test locator. */
export interface TestEvidenceRef {
  filePath: string
  line: number
  locatorKind: string
  locatorValue: string
  testBlockId?: string | null
  testBlockTitle?: string | null
  testFramework?: 'vitest' | 'playwright' | 'generic' | null
}

export interface ReachabilityWarning {
  kind: ReachabilityWarningKind
  message: string
  factId?: string | null
  sourceRef?: ReachabilityEvidenceRef | null
}

/** A statically-detected route path and its owning components. */
export interface RouteFact {
  /** Stable id: `route:<normalizedPath>`. */
  id: string
  /** The static route path value (e.g. '/dashboard'), preserving case. */
  path: string
  /** Kind of route evidence. */
  kind: RouteFactKind
  /** ReactComponentCandidate.id values for components owning this route. */
  componentIds: string[]
  sourceRefs: ReachabilityEvidenceRef[]
  confidence: ReachabilityConfidence
  warnings: ReachabilityWarning[]
}

export type RouteFactKind =
  | 'link-target'
  | 'navigation-target'
  | 'page'
  | 'test-mentioned-route'
  | 'route-definition'

/** A statically-detected browser storage key and its owning components. */
export interface StorageKeyFact {
  /** Stable id: `storage:<kind>:<key>`. */
  id: string
  key: string
  storageKind: StorageKind
  componentIds: string[]
  /** Linked useState variable names (if detectable in same component scope). */
  stateVarNames: string[]
  sourceRefs: ReachabilityEvidenceRef[]
  confidence: ReachabilityConfidence
  warnings: ReachabilityWarning[]
}

/** A statically-detected UI marker with its reachability context. */
export interface UiReachabilityFact {
  /** Stable id: `ui:<markerKind>:<normalizedValue>`. */
  id: string
  markerKind: UiMarkerKind
  value: string
  componentId: string | null
  jsxRegionKind: JsxRegionKind | null
  conditionText: string | null
  /** StorageKeyFact.id values linked to the gate condition. Populated during edge building. */
  gateStorageKeyIds: string[]
  /** RouteFact.id values for routes that reach this component. Populated during edge building. */
  gateRouteIds: string[]
  testEvidenceRefs: TestEvidenceRef[]
  sourceRef: ReachabilityEvidenceRef
  confidence: ReachabilityConfidence
  warnings: ReachabilityWarning[]
}

/** A cross-domain reachability edge. */
export interface ReachabilityEdge {
  /** Stable id: `<source>--<kind>--><target>`. */
  id: string
  kind: ReachabilityEdgeKind
  source: string
  target: string
  confidence: ReachabilityConfidence
  evidenceRefs: ReachabilityEvidenceRef[]
}

export interface FrontendReachabilityStats {
  routeCount: number
  storageKeyCount: number
  uiReachabilityCount: number
  edgeCount: number
  warningCount: number
}

/** The full frontend-reachability artifact written to frontend-reachability.json. */
export interface FrontendReachabilityArtifact {
  artifactKind: typeof FRONTEND_REACHABILITY_ARTIFACT_KIND
  schemaVersion: typeof FRONTEND_REACHABILITY_SCHEMA_VERSION
  generatedAt: string
  sourceRoot: string
  routes: RouteFact[]
  storageKeys: StorageKeyFact[]
  uiReachability: UiReachabilityFact[]
  edges: ReachabilityEdge[]
  warnings: ReachabilityWarning[]
  stats: FrontendReachabilityStats
}

/** Builds an empty (valid) artifact with all arrays empty and stats zeroed. */
export function buildEmptyFrontendReachabilityArtifact(
  createdAt: string,
  sourceRoot: string
): FrontendReachabilityArtifact {
  return {
    artifactKind: FRONTEND_REACHABILITY_ARTIFACT_KIND,
    schemaVersion: FRONTEND_REACHABILITY_SCHEMA_VERSION,
    generatedAt: createdAt,
    sourceRoot,
    routes: [],
    storageKeys: [],
    uiReachability: [],
    edges: [],
    warnings: [],
    stats: {
      routeCount: 0,
      storageKeyCount: 0,
      uiReachabilityCount: 0,
      edgeCount: 0,
      warningCount: 0,
    },
  }
}

/** Normalizes a route path for use in a deterministic id (lowercased, forward slashes). */
export function normalizeRoutePath(routePath: string): string {
  return routePath.replace(/\\/g, '/').toLowerCase()
}

/** Normalizes a UI marker value for use in a deterministic id. */
export function normalizeUiValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '-')
    .slice(0, 64)
}

/** Takes the lower (more conservative) of two confidence levels. */
export function mergeConfidence(a: ReachabilityConfidence, b: ReachabilityConfidence): ReachabilityConfidence {
  const order: Record<ReachabilityConfidence, number> = { high: 0, medium: 1, low: 2 }
  return order[a] >= order[b] ? a : b
}
