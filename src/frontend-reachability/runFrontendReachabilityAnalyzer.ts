import type { FrontendSemanticArtifact } from '../frontend/index.js'
import { extractRouteFacts } from './routeFactExtractor.js'
import { extractStorageKeyFacts } from './storageKeyExtractor.js'
import { extractUiReachabilityFacts } from './uiReachabilityExtractor.js'
import { buildReachabilityEdges } from './reachabilityEdgeBuilder.js'
import {
  buildEmptyFrontendReachabilityArtifact,
  type FrontendReachabilityArtifact,
  type ReachabilityWarning,
} from './types.js'

export interface RunFrontendReachabilityAnalyzerOptions {
  frontendArtifact: FrontendSemanticArtifact
  repoRoot: string
  createdAt: string
}

export interface RunFrontendReachabilityAnalyzerResult {
  artifact: FrontendReachabilityArtifact
  warningCount: number
  errorCount: number
}

/**
 * Main entry point for the frontend-reachability analyzer.
 *
 * Reads the frontend-semantic artifact, runs the route/storage/UI extractors,
 * builds cross-domain edges, and assembles the FrontendReachabilityArtifact.
 */
export function runFrontendReachabilityAnalyzer(
  options: RunFrontendReachabilityAnalyzerOptions
): RunFrontendReachabilityAnalyzerResult {
  const { frontendArtifact, repoRoot, createdAt } = options

  const routes = extractRouteFacts({ frontendArtifact, repoRoot })
  const storageKeys = extractStorageKeyFacts({ frontendArtifact, repoRoot })
  const uiReachability = extractUiReachabilityFacts({ frontendArtifact, storageKeys })
  const edges = buildReachabilityEdges({ routes, storageKeys, uiReachability })

  const warnings: ReachabilityWarning[] = [
    ...routes.flatMap((r) => r.warnings),
    ...storageKeys.flatMap((s) => s.warnings),
    ...uiReachability.flatMap((u) => u.warnings),
  ]

  const artifact = buildEmptyFrontendReachabilityArtifact(createdAt, repoRoot)
  artifact.routes = routes
  artifact.storageKeys = storageKeys
  artifact.uiReachability = uiReachability
  artifact.edges = edges
  artifact.warnings = warnings
  artifact.stats = {
    routeCount: routes.length,
    storageKeyCount: storageKeys.length,
    uiReachabilityCount: uiReachability.length,
    edgeCount: edges.length,
    warningCount: warnings.length,
  }

  return { artifact, warningCount: warnings.length, errorCount: 0 }
}
