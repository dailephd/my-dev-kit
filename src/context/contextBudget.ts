/**
 * v1.10.1 Batch 4: budget, character budgeting, and truncation reporting (sections 23-25).
 *
 * Reads existing operational limits (`ContextCapsuleLimits`, Batch 1) and the
 * structured `ContextRequestLimits` (Batch 1, deferred until now) together with
 * the counts Batch 2/3 already computed (`RetentionSummary`, `GroupTruncationEntry[]`,
 * `SelectedSource`/`SelectedSourceBundles` omissions, `ResponsibilityMappingSummary`
 * truncation) and turns them into one deterministic, auditable rollup. Adds no new
 * limit source and does not silently override the CLI/`ContextCapsuleLimits` conflict
 * rules already enforced by `contextRequestNormalization.ts`.
 */
import type {
  BudgetLimitUsage,
  BudgetSummary,
  ContextCapsuleLimits,
  ContextRequestLimits,
  EvidenceGroup,
  GroupTruncationEntry,
  ResponsibilityMappingSummary,
  RoleConditionCoverage,
  RetentionSummary,
  SelectedSource,
  SelectedSourceBundles,
  TruncationRecord,
  TruncationSummary,
} from './types.js'

export interface BuildBudgetOptions {
  legacyLimits: ContextCapsuleLimits
  requestLimits: ContextRequestLimits | null
  retention: RetentionSummary
  selectedSource: SelectedSource
  selectedSourceBundles: SelectedSourceBundles
  evidenceGroups: EvidenceGroup[]
  groupTruncation: GroupTruncationEntry[]
  responsibilityMappings: ResponsibilityMappingSummary
}

function measureCharacters(evidenceGroups: EvidenceGroup[], selectedSource: SelectedSource): number {
  // Deterministic, serialization-based measurement (section 24): the same bounded
  // JSON shape emitted in the capsule, not raw source text, and not an approximation
  // of an LLM token budget.
  return JSON.stringify(evidenceGroups).length + JSON.stringify(selectedSource.slices).length
}

export function buildBudget(options: BuildBudgetOptions): BudgetSummary {
  const { legacyLimits, requestLimits, retention, selectedSource, selectedSourceBundles, evidenceGroups, groupTruncation, responsibilityMappings } = options
  const warnings: string[] = []
  const limits: BudgetLimitUsage[] = []

  limits.push({
    name: 'candidates',
    declaredValue: requestLimits?.candidates ?? legacyLimits.maxCandidateFiles ?? null,
    usedValue: retention.retainedCandidateCount,
    availableCount: retention.retainedCandidateCount + retention.droppedCandidateCount,
    droppedCount: retention.droppedCandidateCount,
    truncated: retention.droppedCandidateCount > 0,
    requiredEvidenceAffected: false,
    adequacyImpact: null,
  })

  limits.push({
    name: 'graphDepth/graphNodes',
    declaredValue: requestLimits?.graphDepth ?? legacyLimits.maxGraphNodes ?? null,
    usedValue: retention.retainedGraphNodeCount,
    availableCount: retention.retainedGraphNodeCount + retention.droppedGraphNodeCount,
    droppedCount: retention.droppedGraphNodeCount,
    truncated: retention.droppedGraphNodeCount > 0,
    requiredEvidenceAffected: false,
    adequacyImpact: null,
  })

  limits.push({
    name: 'sourceRanges',
    declaredValue: requestLimits?.sourceRanges ?? legacyLimits.maxSourceSlices ?? null,
    usedValue: selectedSource.slices.length,
    availableCount: selectedSource.slices.length + selectedSource.omittedSliceCount,
    droppedCount: selectedSource.omittedSliceCount,
    truncated: selectedSource.omittedSliceCount > 0,
    requiredEvidenceAffected: false,
    adequacyImpact: null,
  })

  if (requestLimits?.sourceLinesPerRange !== undefined) {
    limits.push({
      name: 'sourceLinesPerRange',
      declaredValue: requestLimits.sourceLinesPerRange,
      usedValue: selectedSource.slices.reduce((max, s) => Math.max(max, s.endLine - s.startLine + 1), 0),
      availableCount: null,
      droppedCount: null,
      truncated: false,
      requiredEvidenceAffected: false,
      adequacyImpact: null,
    })
  }

  const evidenceGroupEntriesDeclared = requestLimits?.evidenceGroupEntries ?? null
  const evidenceGroupUsed = evidenceGroups.reduce((sum, g) => sum + g.usedCount, 0)
  const evidenceGroupAvailable = evidenceGroups.reduce((sum, g) => sum + g.availableCount, 0)
  const evidenceGroupDropped = evidenceGroups.reduce((sum, g) => sum + g.droppedCount, 0)
  const requiredEvidenceGroupsTruncated = groupTruncation.some((g) => g.adequacyAffected === true)
  limits.push({
    name: 'evidenceGroupEntries',
    declaredValue: evidenceGroupEntriesDeclared,
    usedValue: evidenceGroupUsed,
    availableCount: evidenceGroupAvailable,
    droppedCount: evidenceGroupDropped,
    truncated: evidenceGroupDropped > 0,
    requiredEvidenceAffected: requiredEvidenceGroupsTruncated,
    adequacyImpact: requiredEvidenceGroupsTruncated ? 'Required evidence-group truncation may reduce role adequacy.' : null,
    requestedValue: evidenceGroupEntriesDeclared,
    appliedLimits: evidenceGroups
      .filter((group) => group.limit !== null)
      .map((group) => ({ groupId: group.id, limit: group.limit }))
      .sort((left, right) => left.groupId.localeCompare(right.groupId)),
  })

  limits.push({
    name: 'responsibilityMappings',
    declaredValue: requestLimits?.responsibilityMappings ?? responsibilityMappings.limit,
    usedValue: responsibilityMappings.usedCount,
    availableCount: responsibilityMappings.availableCount,
    droppedCount: responsibilityMappings.droppedCount,
    truncated: responsibilityMappings.truncated,
    requiredEvidenceAffected: responsibilityMappings.truncated,
    adequacyImpact: responsibilityMappings.truncated ? 'Truncated responsibility mappings may reduce role adequacy for the dropped IDs.' : null,
  })

  if (selectedSourceBundles.omittedBundleCount > 0) {
    limits.push({
      name: 'sourceBundles',
      declaredValue: null,
      usedValue: selectedSourceBundles.bundles.length,
      availableCount: selectedSourceBundles.bundles.length + selectedSourceBundles.omittedBundleCount,
      droppedCount: selectedSourceBundles.omittedBundleCount,
      truncated: true,
      requiredEvidenceAffected: false,
      adequacyImpact: null,
    })
  }

  const characterLimit = requestLimits?.characters ?? null
  const measured = measureCharacters(evidenceGroups, selectedSource)
  const characters = characterLimit !== null ? { measured, limit: characterLimit, truncated: measured > characterLimit } : { measured, limit: null, truncated: false }
  if (characters.truncated) {
    warnings.push(`Measured serialized evidence characters (${measured}) exceed the declared characters limit (${characterLimit}); evidence was already bounded upstream by per-group limits (no exact-token budgeting is claimed).`)
  }

  return { limits, characters, warnings }
}

export interface BuildTruncationOptions {
  evidenceGroups: EvidenceGroup[]
  groupTruncation: GroupTruncationEntry[]
  responsibilityMappings: ResponsibilityMappingSummary
  /** Current pipeline supplies shared condition coverage. Optional only for
   * conservative legacy-compatible callers. */
  roleConditionCoverage?: RoleConditionCoverage[]
}

export function buildTruncation(options: BuildTruncationOptions): TruncationSummary {
  const { evidenceGroups, groupTruncation, responsibilityMappings, roleConditionCoverage } = options
  const records: TruncationRecord[] = []
  const warnings: string[] = []

  for (const entry of groupTruncation) {
    if (!entry.truncated) continue
    const group = evidenceGroups.find((g) => g.id === entry.groupId)
    const droppedEvidenceIds = entry.droppedEvidenceIds ?? []
    const sharedClassificationAvailable =
      entry.requiredOmittedCount !== undefined &&
      entry.optionalOmittedCount !== undefined
    const requiredEvidenceLost = sharedClassificationAvailable
      ? entry.requiredOmittedCount! > 0
      : group?.required === true
    if (
      !sharedClassificationAvailable &&
      roleConditionCoverage !== undefined &&
      group?.role !== null
    ) {
      warnings.push(
        `Condition coverage was available but omission classification was absent for group "${entry.groupId}"; conservative required-group fallback was used.`
      )
    }
    records.push({
      id: `truncation-group:${entry.groupId}`,
      affectedGroup: entry.groupId,
      limit: entry.limit,
      used: entry.usedCount,
      available: entry.availableCount,
      droppedCount: entry.droppedCount,
      droppedEvidenceIds,
      requiredEvidenceLost,
      adequacyImpact: requiredEvidenceLost
        ? `Required role-condition witness evidence was lost from group "${entry.groupId}" during bounded selection.`
        : null,
      reason: `Group "${entry.groupId}" exceeded its bounded limit (${entry.limit}); ${entry.droppedCount} item(s) were dropped in deterministic (score/path) order.`,
    })
    if (requiredEvidenceLost) {
      warnings.push(`Required role-condition witness evidence was lost in group "${entry.groupId}" (${entry.requiredOmittedCount ?? entry.droppedCount} required item(s) dropped).`)
    }
  }

  if (responsibilityMappings.truncated) {
    records.push({
      id: 'truncation-responsibility-mappings',
      affectedGroup: 'responsibility-mappings',
      limit: responsibilityMappings.limit,
      used: responsibilityMappings.usedCount,
      available: responsibilityMappings.availableCount,
      droppedCount: responsibilityMappings.droppedCount,
      droppedEvidenceIds: [],
      // Only a *critical* dropped responsibility counts as required-evidence loss
      // (section 25.3); a noncritical responsibility being truncated is reported
      // honestly (droppedCount, warnings) but must not force adequacy down on its own
      // (section 25's optional-vs-required distinction / TST-B4-041).
      requiredEvidenceLost: responsibilityMappings.criticalDropped,
      adequacyImpact: responsibilityMappings.criticalDropped
        ? 'A critical responsibility mapping was dropped by truncation; role adequacy is reduced.'
        : 'Truncated (noncritical) responsibility mappings reduce coverage of the supplied testResponsibilityRefs but do not by themselves reduce adequacy.',
      reason: `Responsibility mappings exceeded the bounded limit (${responsibilityMappings.limit}); ${responsibilityMappings.droppedCount} mapping(s) were dropped in deterministic (responsibilityId) order.`,
    })
    warnings.push(`${responsibilityMappings.droppedCount} responsibility mapping(s) were truncated.`)
  }

  records.sort((a, b) => a.id.localeCompare(b.id))
  return {
    truncated: records.length > 0,
    requiredEvidenceLost: records.some((record) => record.requiredEvidenceLost),
    records,
    warnings,
  }
}
