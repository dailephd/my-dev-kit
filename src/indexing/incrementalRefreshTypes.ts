/**
 * Public incremental refresh-scope contract (v1.12.5).
 *
 * `IncrementalRefreshSummary` truthfully reports, for every `index --incremental`
 * invocation, which refresh scope was requested, which was actually applied, and
 * how much per-file extraction was fresh versus reused. It is carried on the
 * command result (`incrementalRefresh`) and, when an invocation actually writes
 * an index, additively on `manifest.json`.
 */

export const INCREMENTAL_REFRESH_SCOPES = ['changed-files', 'affected-neighborhood'] as const

export type IncrementalRefreshScope = (typeof INCREMENTAL_REFRESH_SCOPES)[number]

export type AppliedIncrementalRefreshScope = 'none' | 'changed-files' | 'affected-neighborhood' | 'full'

export type IncrementalRefreshSelectionStatus = 'not-needed' | 'applied' | 'fallback-full'

/** Bounded public sample size, matching the changed-file summary convention. */
export const FORCED_NEIGHBOR_SAMPLE_LIMIT = 20

export interface IncrementalRefreshSummary {
  requestedScope: IncrementalRefreshScope
  appliedScope: AppliedIncrementalRefreshScope
  selectionStatus: IncrementalRefreshSelectionStatus

  /** Deterministic machine-readable reason when `selectionStatus` is `fallback-full`; otherwise `null`. */
  fallbackReason: string | null

  /** Neighborhood evidence; `null` unless a trusted neighborhood was established and applied. */
  seedFileCount: number | null
  seedSymbolCount: number | null
  affectedNodeCount: number | null
  affectedEdgeCount: number | null

  forcedNeighborReanalysisFileCount: number
  /** Code-unit-sorted, capped at `FORCED_NEIGHBOR_SAMPLE_LIMIT`. */
  forcedNeighborSample: string[]

  freshExtractionFileCount: number
  reusedFileCount: number
}

const NO_NEIGHBORHOOD = {
  seedFileCount: null,
  seedSymbolCount: null,
  affectedNodeCount: null,
  affectedEdgeCount: null,
  forcedNeighborReanalysisFileCount: 0,
  forcedNeighborSample: [] as string[],
}

/** A full rebuild ran: every indexed file was freshly extracted, none reused. */
export function buildFullFallbackRefreshSummary(
  requestedScope: IncrementalRefreshScope,
  fallbackReason: string,
  indexedFileCount: number
): IncrementalRefreshSummary {
  return {
    requestedScope,
    appliedScope: 'full',
    selectionStatus: 'fallback-full',
    fallbackReason,
    ...NO_NEIGHBORHOOD,
    forcedNeighborSample: [],
    freshExtractionFileCount: indexedFileCount,
    reusedFileCount: 0,
  }
}

/** No add/change/remove was detected: nothing was refreshed. */
export function buildNoChangeRefreshSummary(
  requestedScope: IncrementalRefreshScope,
  indexedFileCount: number
): IncrementalRefreshSummary {
  return {
    requestedScope,
    appliedScope: 'none',
    selectionStatus: 'not-needed',
    fallbackReason: null,
    ...NO_NEIGHBORHOOD,
    forcedNeighborSample: [],
    freshExtractionFileCount: 0,
    reusedFileCount: indexedFileCount,
  }
}

/** A partial rebuild ran under `changed-files` (the v1.12.4 behavior). */
export function buildChangedFilesRefreshSummary(evidence: {
  freshExtractionFileCount: number
  reusedFileCount: number
}): IncrementalRefreshSummary {
  return {
    requestedScope: 'changed-files',
    appliedScope: 'changed-files',
    selectionStatus: 'applied',
    fallbackReason: null,
    ...NO_NEIGHBORHOOD,
    forcedNeighborSample: [],
    ...evidence,
  }
}

/** A partial rebuild ran under `affected-neighborhood` with a trusted selection. */
export function buildAffectedNeighborhoodRefreshSummary(evidence: {
  seedFileCount: number
  seedSymbolCount: number
  affectedNodeCount: number
  affectedEdgeCount: number
  forcedNeighborPaths: readonly string[]
  freshExtractionFileCount: number
  reusedFileCount: number
}): IncrementalRefreshSummary {
  const forced = [...evidence.forcedNeighborPaths].sort()
  return {
    requestedScope: 'affected-neighborhood',
    appliedScope: 'affected-neighborhood',
    selectionStatus: 'applied',
    fallbackReason: null,
    seedFileCount: evidence.seedFileCount,
    seedSymbolCount: evidence.seedSymbolCount,
    affectedNodeCount: evidence.affectedNodeCount,
    affectedEdgeCount: evidence.affectedEdgeCount,
    forcedNeighborReanalysisFileCount: forced.length,
    forcedNeighborSample: forced.slice(0, FORCED_NEIGHBOR_SAMPLE_LIMIT),
    freshExtractionFileCount: evidence.freshExtractionFileCount,
    reusedFileCount: evidence.reusedFileCount,
  }
}
