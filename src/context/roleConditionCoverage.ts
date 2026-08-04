import type {
  ContextRole,
  EvidenceItemRef,
  GroupTruncationEntry,
  RoleConditionCoverage,
  RoleConditionDefinition,
} from './types.js'

/**
 * Canonical evidence-backed role-condition definitions.
 *
 * Group requiredness is intentionally not used here: a required group can retain
 * surplus candidates beyond the bounded witness minimum for a role condition.
 */
export const ROLE_CONDITION_DEFINITIONS: readonly RoleConditionDefinition[] = [
  {
    conditionId: 'architecture-owner',
    role: 'architecture',
    required: true,
    witnessPolicy: 'at-least-one',
    requiredWitnessCount: 1,
    evidenceGroupIds: ['architecture-owners'],
    conditionLabel: 'at least one plausible owner is present',
    description: 'At least one adequate architecture owner remains selected.',
    evaluationOrder: 10,
  },
  {
    conditionId: 'architecture-extension-point',
    role: 'architecture',
    required: true,
    witnessPolicy: 'at-least-one',
    requiredWitnessCount: 1,
    evidenceGroupIds: ['architecture-extension-points'],
    conditionLabel: 'an extension point or grounded no-extension-point conclusion is present',
    description: 'An architecture extension point remains selected, or bounded discovery grounds that none exists.',
    evaluationOrder: 20,
    emptyEvidenceSatisfies: true,
  },
  {
    conditionId: 'architecture-contract',
    role: 'architecture',
    required: true,
    witnessPolicy: 'at-least-one',
    requiredWitnessCount: 1,
    evidenceGroupIds: ['architecture-contracts'],
    conditionLabel: 'at least one relevant contract is present',
    description: 'At least one adequate architecture contract remains selected.',
    evaluationOrder: 30,
  },
  {
    conditionId: 'architecture-test-or-explicit-gap',
    role: 'architecture',
    required: true,
    witnessPolicy: 'at-least-one',
    requiredWitnessCount: 1,
    evidenceGroupIds: ['architecture-architecture-tests'],
    conditionLabel: 'architecture test evidence or a grounded test gap is present',
    description: 'Architecture test evidence remains selected, or bounded discovery grounds an explicit test gap.',
    evaluationOrder: 40,
    emptyEvidenceSatisfies: true,
  },
  {
    conditionId: 'implementation.selected-owner',
    role: 'implementation',
    required: true,
    witnessPolicy: 'at-least-one',
    requiredWitnessCount: 1,
    evidenceGroupIds: ['implementation-owners'],
    conditionLabel: 'selected owner evidence exists',
    description: 'At least one adequate implementation owner remains selected.',
    evaluationOrder: 10,
  },
  {
    conditionId: 'implementation.required-contract',
    role: 'implementation',
    required: true,
    witnessPolicy: 'at-least-one',
    requiredWitnessCount: 1,
    evidenceGroupIds: ['implementation-contracts'],
    conditionLabel: 'required contract evidence exists',
    description: 'At least one adequate implementation contract remains selected.',
    evaluationOrder: 20,
  },
]

export interface RoleConditionCoverageEvidenceGroup {
  groupId: string
  /** Adequate candidates before bounded allocation. */
  availableItems: readonly EvidenceItemRef[]
  /** Adequate witnesses retained by bounded allocation. */
  retainedItems: readonly EvidenceItemRef[]
}

export interface EvaluateRoleConditionCoverageOptions {
  role: ContextRole | null
  evidenceGroups: readonly RoleConditionCoverageEvidenceGroup[]
}

export interface ClassifyRoleConditionOmissionsOptions {
  groupTruncation: readonly GroupTruncationEntry[]
  /** undefined means the caller predates condition coverage and must retain the
   * conservative group-required classification. */
  roleConditionCoverage?: readonly RoleConditionCoverage[]
}

function compareStableIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function stableUniqueIds(items: readonly EvidenceItemRef[]): string[] {
  return [...new Set(items.map((item) => item.id))].sort(compareStableIds)
}

export function getRoleConditionDefinitions(role: ContextRole | null): readonly RoleConditionDefinition[] {
  if (role === null) return []
  return ROLE_CONDITION_DEFINITIONS
    .filter((definition) => definition.role === role)
    .slice()
    .sort((left, right) => left.evaluationOrder - right.evaluationOrder || compareStableIds(left.conditionId, right.conditionId))
}

/**
 * Evaluate coverage from the actual pre/post-allocation evidence sets. A missing
 * candidate makes a condition unsatisfied, but only allocation-caused loss of a
 * previously satisfiable minimum is reported as lostRequiredCondition.
 */
export function evaluateRoleConditionCoverage(options: EvaluateRoleConditionCoverageOptions): RoleConditionCoverage[] {
  const groupById = new Map(options.evidenceGroups.map((group) => [group.groupId, group]))

  return getRoleConditionDefinitions(options.role).map((definition) => {
    const availableWitnessIds = stableUniqueIds(
      definition.evidenceGroupIds.flatMap((groupId) => groupById.get(groupId)?.availableItems ?? [])
    )
    const availableWitnessIdSet = new Set(availableWitnessIds)
    const retainedWitnessIds = stableUniqueIds(
      definition.evidenceGroupIds
        .flatMap((groupId) => groupById.get(groupId)?.retainedItems ?? [])
        .filter((item) => availableWitnessIdSet.has(item.id))
    )
    const conditionSatisfied =
      retainedWitnessIds.length >= definition.requiredWitnessCount ||
      (definition.emptyEvidenceSatisfies === true && availableWitnessIds.length === 0)
    const lostRequiredCondition =
      definition.required &&
      availableWitnessIds.length >= definition.requiredWitnessCount &&
      !conditionSatisfied

    return {
      conditionId: definition.conditionId,
      role: definition.role,
      required: definition.required,
      evidenceGroupIds: [...definition.evidenceGroupIds],
      witnessPolicy: definition.witnessPolicy,
      requiredWitnessCount: definition.requiredWitnessCount,
      availableWitnessCount: availableWitnessIds.length,
      retainedWitnessCount: retainedWitnessIds.length,
      retainedWitnessIds,
      conditionSatisfied,
      lostRequiredCondition,
      lossReason: lostRequiredCondition ? 'bounded-allocation-omitted-required-witnesses' : null,
      evaluationOrder: definition.evaluationOrder,
    }
  })
}

/**
 * Attribute bounded omissions once, after condition coverage and allocation are
 * both known. Current definitions intentionally map one condition to one group;
 * anything broader is rejected rather than double-counting a witness deficit.
 */
export function classifyRoleConditionOmissions(
  options: ClassifyRoleConditionOmissionsOptions
): GroupTruncationEntry[] {
  const coverage = options.roleConditionCoverage
  const conditionAwareRoles = new Set(coverage?.map((condition) => condition.role) ?? [])
  const conditionByGroupId = new Map<string, RoleConditionCoverage>()

  for (const condition of coverage ?? []) {
    if (condition.evidenceGroupIds.length !== 1) {
      throw new Error(
        `Condition-to-group attribution is ambiguous for "${condition.conditionId}": expected exactly one evidence group.`
      )
    }
    const groupId = condition.evidenceGroupIds[0]
    if (conditionByGroupId.has(groupId)) {
      throw new Error(
        `Condition-to-group attribution is ambiguous for "${groupId}": multiple conditions share one evidence group.`
      )
    }
    conditionByGroupId.set(groupId, condition)
  }

  return options.groupTruncation.map((entry) => {
    const omittedCount = Math.max(0, entry.availableCount - entry.usedCount)
    const conditionAwareRole = [...conditionAwareRoles].find((role) =>
      entry.groupId.startsWith(`${role}-`)
    )

    if (!conditionAwareRole) {
      const requiredOmittedCount = entry.required === true ? omittedCount : 0
      return {
        ...entry,
        droppedCount: omittedCount,
        requiredOmittedCount,
        optionalOmittedCount: omittedCount - requiredOmittedCount,
        adequacyAffected: requiredOmittedCount > 0,
      }
    }

    const condition = conditionByGroupId.get(entry.groupId)
    const requiredWitnessDeficit =
      condition?.required === true && condition.lostRequiredCondition
        ? Math.max(0, condition.requiredWitnessCount - condition.retainedWitnessCount)
        : 0
    const requiredOmittedCount = Math.min(omittedCount, requiredWitnessDeficit)

    return {
      ...entry,
      droppedCount: omittedCount,
      requiredOmittedCount,
      optionalOmittedCount: omittedCount - requiredOmittedCount,
      adequacyAffected: requiredOmittedCount > 0,
    }
  })
}
