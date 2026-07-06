import type { DataModelArtifact } from '../data-model/types.js'
import type { FrontendSemanticArtifact } from '../frontend/frontendTypes.js'
import type { FrontendReachabilityArtifact } from '../frontend-reachability/types.js'
import { diffFlatRecord } from './diffUtils.js'
import type { ArtifactAvailability, SemanticSummaryDiffSection } from './types.js'

/**
 * Compact summary-only diff for an optional semantic artifact. Deliberately
 * does not attempt a deep entry-level diff (unlike classification, whose
 * entries have a stable `id`) — these artifacts' schemas are not designed
 * around a single stable per-entry identity, so a fragile custom deep diff
 * would risk noisy or misleading output. Presence and summary-count drift
 * are the safe, useful signal.
 */
function buildSummaryDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  fields: readonly string[]
): SemanticSummaryDiffSection {
  const available: ArtifactAvailability = before && after ? 'both' : before ? 'before-only' : after ? 'after-only' : 'neither'
  if (available !== 'both') return { available, changedFields: [] }
  return { available, changedFields: diffFlatRecord(before, after, fields) }
}

const DATA_MODEL_SUMMARY_FIELDS = ['entityCount', 'fieldCount', 'relationshipCount', 'warningCount'] as const

export function buildDataModelDiff(before: DataModelArtifact | null, after: DataModelArtifact | null): SemanticSummaryDiffSection {
  return buildSummaryDiff(
    before?.summary as unknown as Record<string, unknown> | null,
    after?.summary as unknown as Record<string, unknown> | null,
    DATA_MODEL_SUMMARY_FIELDS
  )
}

const FRONTEND_SEMANTIC_SUMMARY_FIELDS = [
  'fileCount',
  'jsxFileCount',
  'testFileCount',
  'componentCount',
  'hookCount',
  'testBlockCount',
  'uiStringCount',
  'relationshipCount',
  'locatorCount',
  'warningCount',
  'errorCount',
] as const

export function buildFrontendSemanticDiff(
  before: FrontendSemanticArtifact | null,
  after: FrontendSemanticArtifact | null
): SemanticSummaryDiffSection {
  return buildSummaryDiff(
    before?.summary as unknown as Record<string, unknown> | null,
    after?.summary as unknown as Record<string, unknown> | null,
    FRONTEND_SEMANTIC_SUMMARY_FIELDS
  )
}

const FRONTEND_REACHABILITY_STATS_FIELDS = ['routeCount', 'storageKeyCount', 'uiReachabilityCount', 'edgeCount', 'warningCount'] as const

export function buildFrontendReachabilityDiff(
  before: FrontendReachabilityArtifact | null,
  after: FrontendReachabilityArtifact | null
): SemanticSummaryDiffSection {
  return buildSummaryDiff(
    before?.stats as unknown as Record<string, unknown> | null,
    after?.stats as unknown as Record<string, unknown> | null,
    FRONTEND_REACHABILITY_STATS_FIELDS
  )
}
