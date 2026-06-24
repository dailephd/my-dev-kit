/**
 * Builds the reachability lookup result for `lookup --route|--storage-key|--ui`.
 *
 * Returns the matching fact(s) plus all edges incident on those facts (depth-1
 * cross-domain neighbors).
 */

import type {
  FrontendReachabilityArtifact,
  ReachabilityEdge,
  RouteFact,
  StorageKeyFact,
  UiReachabilityFact,
} from './types.js'
import {
  findRouteFact,
  findStorageKeyFacts,
  findUiFacts,
  relatedEdges,
  MISSING_ARTIFACT_WARNING,
  type ReachabilityMode,
} from './reachabilityConsumers.js'

export type ReachabilityFact = RouteFact | StorageKeyFact | UiReachabilityFact

export interface ReachabilityLookupResult {
  artifactKind: 'my-dev-kit-v1-reachability-lookup-result'
  version: '1.0.0'
  mode: ReachabilityMode
  query: string
  status: 'found' | 'not-found' | 'missing-artifact'
  facts: ReachabilityFact[]
  relatedEdges: ReachabilityEdge[]
  warnings: string[]
  summary: { factCount: number; edgeCount: number }
}

export function buildReachabilityLookupResult(
  artifact: FrontendReachabilityArtifact | null,
  mode: ReachabilityMode,
  query: string
): ReachabilityLookupResult {
  if (!artifact) {
    return {
      artifactKind: 'my-dev-kit-v1-reachability-lookup-result',
      version: '1.0.0',
      mode,
      query,
      status: 'missing-artifact',
      facts: [],
      relatedEdges: [],
      warnings: [MISSING_ARTIFACT_WARNING],
      summary: { factCount: 0, edgeCount: 0 },
    }
  }

  const facts: ReachabilityFact[] = []
  if (mode === 'route') {
    const fact = findRouteFact(artifact, query)
    if (fact) facts.push(fact)
  } else if (mode === 'storage-key') {
    facts.push(...findStorageKeyFacts(artifact, query))
  } else {
    facts.push(...findUiFacts(artifact, query))
  }

  if (facts.length === 0) {
    return {
      artifactKind: 'my-dev-kit-v1-reachability-lookup-result',
      version: '1.0.0',
      mode,
      query,
      status: 'not-found',
      facts: [],
      relatedEdges: [],
      warnings: [`No ${mode} fact found matching "${query}" in frontend-reachability artifact.`],
      summary: { factCount: 0, edgeCount: 0 },
    }
  }

  const edges = relatedEdges(artifact, facts.map((f) => f.id))

  return {
    artifactKind: 'my-dev-kit-v1-reachability-lookup-result',
    version: '1.0.0',
    mode,
    query,
    status: 'found',
    facts,
    relatedEdges: edges,
    warnings: [],
    summary: { factCount: facts.length, edgeCount: edges.length },
  }
}
