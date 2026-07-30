import type {
  ContextRole,
  EvidenceItemRef,
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
    const conditionSatisfied = retainedWitnessIds.length >= definition.requiredWitnessCount
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
