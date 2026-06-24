/**
 * Builds the reachability search result for `search --route|--storage-key|--ui`.
 */

import type { FrontendReachabilityArtifact, ReachabilityConfidence, ReachabilityEdge } from './types.js'
import {
  filterRouteFacts,
  filterStorageKeyFacts,
  filterUiFacts,
  relatedEdges,
  MISSING_ARTIFACT_WARNING,
  type ReachabilityMode,
} from './reachabilityConsumers.js'

export interface ReachabilitySearchResultItem {
  factKind: 'route' | 'storage-key' | 'ui'
  id: string
  label: string
  confidence: ReachabilityConfidence
  warningCount: number
}

export interface ReachabilitySearchResult {
  artifactKind: 'my-dev-kit-v1-reachability-search-result'
  version: '1.0.0'
  mode: ReachabilityMode
  query: string
  status: 'ok' | 'missing-artifact'
  results: ReachabilitySearchResultItem[]
  relatedEdges: ReachabilityEdge[]
  warnings: string[]
  summary: { resultCount: number; edgeCount: number }
}

export function buildReachabilitySearchResult(
  artifact: FrontendReachabilityArtifact | null,
  mode: ReachabilityMode,
  query: string
): ReachabilitySearchResult {
  if (!artifact) {
    return {
      artifactKind: 'my-dev-kit-v1-reachability-search-result',
      version: '1.0.0',
      mode,
      query,
      status: 'missing-artifact',
      results: [],
      relatedEdges: [],
      warnings: [MISSING_ARTIFACT_WARNING],
      summary: { resultCount: 0, edgeCount: 0 },
    }
  }

  const results: ReachabilitySearchResultItem[] = []
  const ids = new Set<string>()

  if (mode === 'route') {
    for (const fact of filterRouteFacts(artifact, query)) {
      results.push({
        factKind: 'route',
        id: fact.id,
        label: fact.path,
        confidence: fact.confidence,
        warningCount: fact.warnings.length,
      })
      ids.add(fact.id)
    }
  } else if (mode === 'storage-key') {
    for (const fact of filterStorageKeyFacts(artifact, query)) {
      results.push({
        factKind: 'storage-key',
        id: fact.id,
        label: `${fact.storageKind}:${fact.key}`,
        confidence: fact.confidence,
        warningCount: fact.warnings.length,
      })
      ids.add(fact.id)
    }
  } else {
    for (const fact of filterUiFacts(artifact, query)) {
      results.push({
        factKind: 'ui',
        id: fact.id,
        label: `${fact.markerKind}:${fact.value}`,
        confidence: fact.confidence,
        warningCount: fact.warnings.length,
      })
      ids.add(fact.id)
    }
  }

  const edges = relatedEdges(artifact, ids)

  return {
    artifactKind: 'my-dev-kit-v1-reachability-search-result',
    version: '1.0.0',
    mode,
    query,
    status: 'ok',
    results,
    relatedEdges: edges,
    warnings: [],
    summary: { resultCount: results.length, edgeCount: edges.length },
  }
}
