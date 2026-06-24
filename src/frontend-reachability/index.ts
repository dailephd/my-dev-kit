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

export {
  resolveReachabilityMode,
  MISSING_ARTIFACT_WARNING,
  type ReachabilityMode,
  type ReachabilityModeFlags,
} from './reachabilityConsumers.js'

export {
  buildReachabilitySearchResult,
  type ReachabilitySearchResult,
  type ReachabilitySearchResultItem,
} from './buildReachabilitySearchResult.js'

export {
  buildReachabilityLookupResult,
  type ReachabilityLookupResult,
  type ReachabilityFact,
} from './buildReachabilityLookupResult.js'

export {
  buildReachabilitySliceResult,
  type ReachabilitySliceResult,
  type ReachabilitySliceModifiers,
} from './buildReachabilitySliceResult.js'

export {
  buildReachabilitySourceResult,
  type ReachabilitySourceResult,
  type ReachabilitySourceBlock,
  type BuildReachabilitySourceOptions,
} from './buildReachabilitySourceResult.js'
