export {
  FRONTEND_REACHABILITY_ARTIFACT_KIND,
  FRONTEND_REACHABILITY_SCHEMA_VERSION,
  buildEmptyFrontendReachabilityArtifact,
  normalizeRoutePath,
  normalizeUiValue,
  mergeConfidence,
  type FrontendReachabilityArtifact,
  type FrontendReachabilityStats,
  type RouteFact,
  type RouteFactKind,
  type StorageKeyFact,
  type StorageKind,
  type UiReachabilityFact,
  type UiMarkerKind,
  type JsxRegionKind,
  type ReachabilityEdge,
  type ReachabilityEdgeKind,
  type ReachabilityEvidenceRef,
  type TestEvidenceRef,
  type ReachabilityWarning,
  type ReachabilityWarningKind,
  type ReachabilityConfidence,
} from './types.js'

export {
  runFrontendReachabilityAnalyzer,
  type RunFrontendReachabilityAnalyzerOptions,
  type RunFrontendReachabilityAnalyzerResult,
} from './runFrontendReachabilityAnalyzer.js'

export {
  extractRouteFacts,
  type ExtractRouteFactsOptions,
} from './routeFactExtractor.js'

export {
  extractStorageKeyFacts,
  type ExtractStorageKeyFactsOptions,
} from './storageKeyExtractor.js'

export {
  extractUiReachabilityFacts,
  type ExtractUiReachabilityFactsOptions,
} from './uiReachabilityExtractor.js'

export {
  buildReachabilityEdges,
  type BuildReachabilityEdgesOptions,
} from './reachabilityEdgeBuilder.js'

export {
  writeFrontendReachabilityArtifact,
  sortFrontendReachabilityArtifact,
  FRONTEND_REACHABILITY_FILENAME,
} from './writeFrontendReachabilityArtifact.js'

export { loadFrontendReachabilityArtifact } from './loadFrontendReachabilityArtifact.js'
