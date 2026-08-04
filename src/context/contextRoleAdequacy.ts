/**
 * v1.10.1 Batch 4: role-specific adequacy (section 20).
 *
 * Extends, rather than replaces, the existing (Batch 1) `ContextAdequacyStatement`
 * computed by `computeContextAdequacy` in `contextCapsule.ts`: `RoleAdequacyStatement.status`
 * starts from that verdict and can only ever be *downgraded* (never silently
 * upgraded) by role-specific missing/blocking conditions, freshness, or truncation.
 * For legacy (no-role) requests this returns a `null`-role, `unknown` statement and
 * never claims a role-specific verdict it cannot evaluate (section 20.5).
 */
import {
  criticalPartiallyMappedResponsibilityIds,
  criticalUnmappedResponsibilityIds,
  noncriticalIssueResponsibilityIds,
} from './responsibilityMapping.js'
import { getRoleConditionDefinitions } from './roleConditionCoverage.js'
import type {
  ChangedSurface,
  ContextAdequacyStatement,
  ContextAdequacyStatus,
  ContextRole,
  EvidenceGroup,
  EvidenceItemRef,
  FreshnessSummary,
  ResponsibilityMappingSummary,
  RoleAdequacyStatement,
  TestInfrastructureSummary,
  TruncationSummary,
  RoleConditionId,
  RoleConditionCoverage,
} from './types.js'

function roleConditionLabel(role: ContextRole, conditionId: RoleConditionId): string {
  const definition = getRoleConditionDefinitions(role).find(
    (candidate) => candidate.conditionId === conditionId
  )
  if (!definition) throw new Error(`Missing canonical ${role} role condition "${conditionId}"`)
  return definition.conditionLabel
}

const IMPLEMENTATION_OWNER_CONDITION = roleConditionLabel('implementation', 'implementation.selected-owner')
const IMPLEMENTATION_CONTRACT_CONDITION = roleConditionLabel('implementation', 'implementation.required-contract')

export interface EvaluateRoleAdequacyOptions {
  role: ContextRole | null
  baseAdequacy: ContextAdequacyStatement
  evidenceGroups: EvidenceGroup[]
  selectedOwners: EvidenceItemRef[]
  selectedContracts: EvidenceItemRef[]
  selectedTests: EvidenceItemRef[]
  testInfrastructure: TestInfrastructureSummary
  changedSurface: ChangedSurface
  requestedEvidenceKindsRequireTestInfra: boolean
  requestedEvidenceKindsRequireTestCommands: boolean
  responsibilityMappings: ResponsibilityMappingSummary
  freshness: FreshnessSummary
  truncation: TruncationSummary
  /** Current implementation-role pipeline supplies this. Optional only for
   * conservative legacy-compatible callers. */
  roleConditionCoverage?: RoleConditionCoverage[]
}

const STATUS_ORDER: readonly ContextAdequacyStatus[] = [
  'context sufficient for implementation',
  'context sufficient with listed assumptions',
  'context insufficient and more retrieval required',
  'context conflict found and user or upstream stage decision required',
]

/** Never upgrades: returns whichever status is "worse" (later in `STATUS_ORDER`). */
function downgrade(current: ContextAdequacyStatus, candidate: ContextAdequacyStatus): ContextAdequacyStatus {
  return STATUS_ORDER.indexOf(candidate) > STATUS_ORDER.indexOf(current) ? candidate : current
}

export function evaluateRoleAdequacy(options: EvaluateRoleAdequacyOptions): RoleAdequacyStatement {
  const {
    role,
    baseAdequacy,
    evidenceGroups,
    selectedOwners,
    selectedContracts,
    selectedTests,
    testInfrastructure,
    changedSurface,
    requestedEvidenceKindsRequireTestInfra,
    requestedEvidenceKindsRequireTestCommands,
    responsibilityMappings,
    freshness,
    truncation,
    roleConditionCoverage,
  } = options

  if (role === null) {
    // Legacy (no-role) requests: role-specific adequacy cannot be evaluated (section
    // 20.5/31). Carries the existing `contextAdequacy.status` forward unchanged rather
    // than fabricating a role verdict, and never treats nonempty output as automatically
    // adequate.
    return {
      role: null,
      status: baseAdequacy.status,
      requiredConditions: [],
      satisfiedConditions: [],
      missingConditions: [],
      blockingConditions: [],
      warnings: ['Role-specific adequacy is not applicable: no role was supplied for this request.'],
      supportingEvidence: [],
      affectedResponsibilityIds: [],
      truncationImpact: false,
      freshnessImpact: false,
    }
  }

  const requiredConditions: string[] = []
  const satisfiedConditions: string[] = []
  const missingConditions: string[] = []
  const blockingConditions: string[] = []
  const warnings: string[] = []
  const supportingEvidence: string[] = []

  let status = baseAdequacy.status

  const criticalUnmapped = criticalUnmappedResponsibilityIds(responsibilityMappings)
  const criticalPartial = criticalPartiallyMappedResponsibilityIds(responsibilityMappings)
  const noncriticalIssues = noncriticalIssueResponsibilityIds(responsibilityMappings)
  const affectedResponsibilityIds = [...new Set([...criticalUnmapped, ...criticalPartial, ...noncriticalIssues])].sort()

  if (role === 'architecture') {
    const definitions = getRoleConditionDefinitions(role)
    requiredConditions.push(...definitions.filter((definition) => definition.required).map((definition) => definition.conditionLabel))
    const architectureCoverage = roleConditionCoverage?.filter((condition) => condition.role === role) ?? []
    if (architectureCoverage.length !== definitions.length) {
      missingConditions.push('role condition coverage unavailable')
      blockingConditions.push('role condition coverage unavailable')
      status = downgrade(status, 'context insufficient and more retrieval required')
    } else {
      const groupItems = new Map(evidenceGroups.map((group) => [group.id, group.items]))
      for (const condition of architectureCoverage) {
        const definition = definitions.find((candidate) => candidate.conditionId === condition.conditionId)
        if (!definition) continue
        if (condition.conditionSatisfied) {
          satisfiedConditions.push(definition.conditionLabel)
          supportingEvidence.push(...condition.retainedWitnessIds.slice(0, 3))
        } else {
          const diagnostic = condition.conditionId === 'architecture-owner'
            ? 'no plausible owner exists'
            : condition.conditionId === 'architecture-contract'
              ? 'no relevant contract evidence'
              : `required architecture condition unsatisfied: ${condition.conditionId}`
          missingConditions.push(diagnostic)
          if (condition.conditionId === 'architecture-owner') blockingConditions.push(diagnostic)
          status = downgrade(status, 'context insufficient and more retrieval required')
        }
        const retainedItems = condition.evidenceGroupIds.flatMap((groupId) => groupItems.get(groupId) ?? [])
        const retainedById = new Map(retainedItems.map((item) => [item.id, item]))
        if (condition.retainedWitnessIds.some((id) => !retainedById.get(id)?.provenance)) {
          missingConditions.push(`required provenance missing: ${condition.conditionId}`)
          blockingConditions.push(`required provenance missing: ${condition.conditionId}`)
          status = downgrade(status, 'context insufficient and more retrieval required')
        }
      }
    }
  } else if (role === 'implementation') {
    requiredConditions.push(IMPLEMENTATION_OWNER_CONDITION, IMPLEMENTATION_CONTRACT_CONDITION, 'no critical unresolved implementation requirement remains', 'context is not stale')
    if (selectedOwners.length > 0) {
      satisfiedConditions.push(IMPLEMENTATION_OWNER_CONDITION)
    } else {
      missingConditions.push('owner missing')
      blockingConditions.push('owner missing')
      status = downgrade(status, 'context insufficient and more retrieval required')
    }
    if (selectedContracts.length > 0) {
      satisfiedConditions.push(IMPLEMENTATION_CONTRACT_CONDITION)
    } else {
      missingConditions.push('required contract missing')
      status = downgrade(status, 'context insufficient and more retrieval required')
    }
    if (criticalUnmapped.length > 0) {
      missingConditions.push('critical unresolved implementation requirement remains')
      blockingConditions.push(...criticalUnmapped)
      status = downgrade(status, 'context insufficient and more retrieval required')
    } else {
      satisfiedConditions.push('no critical unresolved implementation requirement remains')
    }
    if (
      roleConditionCoverage === undefined ||
      !roleConditionCoverage.some((condition) => condition.role === 'implementation')
    ) {
      missingConditions.push('role condition coverage unavailable')
      blockingConditions.push('role condition coverage unavailable')
      status = downgrade(status, 'context insufficient and more retrieval required')
    }
  } else {
    // test-implementation
    requiredConditions.push(
      'changed-surface evidence exists or an explicitly accepted fallback basis exists',
      'relevant production symbols exist',
      'related test location or explicit missing-test state exists',
      'every critical responsibility is mapped',
      'context is not stale'
    )
    if (changedSurface.available) {
      satisfiedConditions.push('changed-surface evidence exists or an explicitly accepted fallback basis exists')
    } else {
      missingConditions.push('changed surface required but missing')
      status = downgrade(status, 'context insufficient and more retrieval required')
    }
    const productionSymbolsGroup = evidenceGroups.find((g) => g.kind === 'production-symbols')
    if ((productionSymbolsGroup?.items.length ?? 0) > 0) {
      satisfiedConditions.push('relevant production symbols exist')
    } else {
      missingConditions.push('relevant production symbols missing')
    }
    if (selectedTests.length > 0 || testInfrastructure.relatedTests.length > 0) {
      satisfiedConditions.push('related test location or explicit missing-test state exists')
    } else {
      satisfiedConditions.push('related test location or explicit missing-test state exists (explicit missing-test state recorded)')
    }
    if (requestedEvidenceKindsRequireTestInfra && testInfrastructure.relatedTests.length === 0 && testInfrastructure.fixtures.length === 0) {
      missingConditions.push('required test infrastructure missing')
    }
    if (requestedEvidenceKindsRequireTestCommands && testInfrastructure.testCommands.length === 0) {
      missingConditions.push('test command required but unavailable')
      status = downgrade(status, 'context insufficient and more retrieval required')
    }
    if (criticalUnmapped.length > 0) {
      missingConditions.push('critical responsibility unmapped')
      blockingConditions.push(...criticalUnmapped)
      status = downgrade(status, 'context insufficient and more retrieval required')
    } else if (criticalPartial.length > 0) {
      missingConditions.push('critical responsibility partially mapped')
      status = downgrade(status, 'context insufficient and more retrieval required')
    } else {
      satisfiedConditions.push('every critical responsibility is mapped')
    }
  }

  if (noncriticalIssues.length > 0) {
    warnings.push(`Noncritical responsibility mapping gap(s) for: ${noncriticalIssues.join(', ')}.`)
  }

  const truncationImpact = truncation.records.some((r) => r.requiredEvidenceLost)
  if (truncationImpact) {
    const conditionAwareCoverage =
      roleConditionCoverage?.filter((condition) => condition.role === role) ?? []
    if (conditionAwareCoverage.length === 0) {
      missingConditions.push('required evidence truncated')
    } else {
      const lostConditions = conditionAwareCoverage.filter((entry) => entry.lostRequiredCondition)
      for (const condition of lostConditions) {
        const existingDiagnostic =
          condition.conditionId === 'implementation.selected-owner'
            ? 'owner missing'
            : condition.conditionId === 'implementation.required-contract'
              ? 'required contract missing'
              : `required condition witness lost during bounded selection: ${condition.conditionId}`
        if (!missingConditions.includes(existingDiagnostic)) {
          missingConditions.push(existingDiagnostic)
        }
      }
      if (
        lostConditions.length === 0 &&
        truncation.records.some(
          (record) =>
            record.requiredEvidenceLost &&
            record.affectedGroup === 'responsibility-mappings'
        )
      ) {
        missingConditions.push('critical responsibility mapping truncated')
      }
    }
    status = downgrade(status, 'context insufficient and more retrieval required')
  }

  const freshnessImpact = freshness.state !== 'fresh'
  if (freshness.state === 'stale') {
    missingConditions.push('context stale')
    status = downgrade(status, 'context insufficient and more retrieval required')
  } else if (freshness.state === 'unknown') {
    warnings.push('Freshness could not be established (unknown); adequacy is not automatically reduced, but this is not the same as "fresh".')
  } else {
    satisfiedConditions.push('context is not stale')
  }

  return {
    role,
    status,
    requiredConditions,
    satisfiedConditions,
    missingConditions,
    blockingConditions: [...new Set(blockingConditions)].sort(),
    warnings,
    supportingEvidence,
    affectedResponsibilityIds,
    truncationImpact,
    freshnessImpact,
  }
}
