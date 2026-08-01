import { describe, expect, it } from 'vitest'
import { buildTruncation } from '../../src/context/contextBudget.js'
import {
  classifyRoleConditionOmissions,
  evaluateRoleConditionCoverage,
  type RoleConditionCoverageEvidenceGroup,
} from '../../src/context/roleConditionCoverage.js'
import type {
  EvidenceGroup,
  EvidenceItemRef,
  GroupTruncationEntry,
  ResponsibilityMappingSummary,
  RoleConditionCoverage,
} from '../../src/context/types.js'

function evidence(id: string): EvidenceItemRef {
  return {
    id,
    itemKind: 'symbol',
    path: 'src/fixture.ts',
    nodeId: id,
    relationship: 'qualified-condition-witness',
    basis: 'condition-aware truncation test',
    provenance: 'test-fixture',
  }
}

function coverageGroup(
  groupId: string,
  availableIds: readonly string[],
  retainedIds: readonly string[]
): RoleConditionCoverageEvidenceGroup {
  return {
    groupId,
    availableItems: availableIds.map(evidence),
    retainedItems: retainedIds.map(evidence),
  }
}

function coverage(
  groups: readonly RoleConditionCoverageEvidenceGroup[]
): RoleConditionCoverage[] {
  return evaluateRoleConditionCoverage({ role: 'implementation', evidenceGroups: groups })
}

function truncationEntry(
  groupId: string,
  availableCount: number,
  usedCount: number,
  required = true
): GroupTruncationEntry {
  const droppedCount = Math.max(0, availableCount - usedCount)
  return {
    groupId,
    limit: usedCount,
    availableCount,
    usedCount,
    truncated: droppedCount > 0,
    droppedCount,
    required,
  }
}

function evidenceGroup(entry: GroupTruncationEntry): EvidenceGroup {
  return {
    id: entry.groupId,
    kind: 'owners',
    role: 'implementation',
    title: entry.groupId,
    required: entry.required ?? false,
    items: [],
    unresolved: [],
    warnings: [],
    limit: entry.limit,
    availableCount: entry.availableCount,
    usedCount: entry.usedCount,
    truncated: entry.truncated,
    droppedCount: entry.droppedCount,
    provenance: 'test-fixture',
  }
}

const emptyResponsibilityMappings: ResponsibilityMappingSummary = {
  requested: false,
  operational: false,
  mappings: [],
  unknownResponsibilityIds: [],
  duplicateResponsibilityIds: [],
  limit: null,
  availableCount: 0,
  usedCount: 0,
  truncated: false,
  droppedCount: 0,
  criticalDropped: false,
  warnings: [],
}

function classify(
  entries: readonly GroupTruncationEntry[],
  roleConditionCoverage?: readonly RoleConditionCoverage[]
): GroupTruncationEntry[] {
  return classifyRoleConditionOmissions({
    groupTruncation: entries,
    roleConditionCoverage,
  })
}

function report(
  entries: readonly GroupTruncationEntry[],
  roleConditionCoverage?: readonly RoleConditionCoverage[]
) {
  return buildTruncation({
    evidenceGroups: entries.map(evidenceGroup),
    groupTruncation: [...entries],
    responsibilityMappings: emptyResponsibilityMappings,
    roleConditionCoverage: roleConditionCoverage ? [...roleConditionCoverage] : undefined,
  })
}

describe('condition-aware truncation classification', () => {
  it('classifies retained contract surplus as optional and non-blocking', () => {
    const conditionCoverage = coverage([
      coverageGroup('implementation-contracts', ['contract-a', 'contract-b'], ['contract-a']),
    ])
    const [entry] = classify(
      [truncationEntry('implementation-contracts', 2, 1)],
      conditionCoverage
    )
    const truncation = report([entry], conditionCoverage)

    expect(entry).toMatchObject({
      requiredOmittedCount: 0,
      optionalOmittedCount: 1,
      adequacyAffected: false,
    })
    expect(truncation.records[0]?.requiredEvidenceLost).toBe(false)
    expect(truncation.requiredEvidenceLost).toBe(false)
  })

  it('classifies retained owner surplus as optional and non-blocking', () => {
    const conditionCoverage = coverage([
      coverageGroup('implementation-owners', ['owner-a', 'owner-b'], ['owner-b']),
    ])
    const [entry] = classify(
      [truncationEntry('implementation-owners', 2, 1)],
      conditionCoverage
    )

    expect(entry).toMatchObject({
      requiredOmittedCount: 0,
      optionalOmittedCount: 1,
      adequacyAffected: false,
    })
    expect(report([entry], conditionCoverage).records[0]?.requiredEvidenceLost).toBe(false)
  })

  it('attributes only the minimum required deficit when the last contract witness is lost', () => {
    const conditionCoverage = coverage([
      coverageGroup('implementation-contracts', ['contract-a', 'contract-b'], []),
    ])
    const [entry] = classify(
      [truncationEntry('implementation-contracts', 2, 0)],
      conditionCoverage
    )

    expect(entry).toMatchObject({
      requiredOmittedCount: 1,
      optionalOmittedCount: 1,
      adequacyAffected: true,
    })
    expect(report([entry], conditionCoverage).records[0]?.requiredEvidenceLost).toBe(true)
  })

  it('attributes required loss when the last owner witness is lost', () => {
    const conditionCoverage = coverage([
      coverageGroup('implementation-owners', ['owner-a'], []),
    ])
    const [entry] = classify(
      [truncationEntry('implementation-owners', 1, 0)],
      conditionCoverage
    )

    expect(entry).toMatchObject({
      requiredOmittedCount: 1,
      optionalOmittedCount: 0,
      adequacyAffected: true,
    })
    expect(report([entry], conditionCoverage).requiredEvidenceLost).toBe(true)
  })

  it('does not classify no-owner-candidate absence as truncation-caused loss', () => {
    const conditionCoverage = coverage([
      coverageGroup('implementation-owners', [], []),
    ])
    const [entry] = classify(
      [truncationEntry('implementation-owners', 0, 0)],
      conditionCoverage
    )

    expect(entry).toMatchObject({
      requiredOmittedCount: 0,
      optionalOmittedCount: 0,
      adequacyAffected: false,
    })
    expect(report([entry], conditionCoverage).requiredEvidenceLost).toBe(false)
  })

  it('does not classify no-contract-candidate absence as truncation-caused loss', () => {
    const conditionCoverage = coverage([
      coverageGroup('implementation-contracts', [], []),
    ])
    const [entry] = classify(
      [truncationEntry('implementation-contracts', 0, 0)],
      conditionCoverage
    )

    expect(entry.requiredOmittedCount).toBe(0)
    expect(entry.optionalOmittedCount).toBe(0)
    expect(report([entry], conditionCoverage).requiredEvidenceLost).toBe(false)
  })

  it('keeps compatibility overflow optional when no compatibility condition exists', () => {
    const conditionCoverage = coverage([
      coverageGroup('implementation-owners', ['owner-a'], ['owner-a']),
      coverageGroup('implementation-contracts', ['contract-a'], ['contract-a']),
      coverageGroup('implementation-compatibility-surfaces', ['surface-a', 'surface-b'], []),
    ])
    const [entry] = classify(
      [truncationEntry('implementation-compatibility-surfaces', 2, 0)],
      conditionCoverage
    )

    expect(entry).toMatchObject({
      requiredOmittedCount: 0,
      optionalOmittedCount: 2,
      adequacyAffected: false,
    })
    expect(report([entry], conditionCoverage).requiredEvidenceLost).toBe(false)
  })

  it('reports required loss only for the affected group in a mixed truncation', () => {
    const conditionCoverage = coverage([
      coverageGroup('implementation-contracts', ['contract-a'], []),
      coverageGroup('implementation-compatibility-surfaces', ['surface-a', 'surface-b'], []),
    ])
    const entries = classify(
      [
        truncationEntry('implementation-compatibility-surfaces', 2, 0),
        truncationEntry('implementation-contracts', 1, 0),
      ],
      conditionCoverage
    )
    const truncation = report(entries, conditionCoverage)

    expect(truncation.truncated).toBe(true)
    expect(truncation.requiredEvidenceLost).toBe(true)
    expect(
      truncation.records.find(
        (entry) => entry.affectedGroup === 'implementation-compatibility-surfaces'
      )?.requiredEvidenceLost
    ).toBe(false)
    expect(
      truncation.records.find(
        (entry) => entry.affectedGroup === 'implementation-contracts'
      )?.requiredEvidenceLost
    ).toBe(true)
  })

  it('preserves the required-plus-optional count invariant for every group', () => {
    const conditionCoverage = coverage([
      coverageGroup('implementation-owners', ['owner-a', 'owner-b'], ['owner-a']),
      coverageGroup('implementation-contracts', ['contract-a', 'contract-b'], []),
    ])
    const entries = classify(
      [
        truncationEntry('implementation-owners', 2, 1),
        truncationEntry('implementation-contracts', 2, 0),
        truncationEntry('implementation-compatibility-surfaces', 3, 1),
      ],
      conditionCoverage
    )

    for (const entry of entries) {
      expect((entry.requiredOmittedCount ?? 0) + (entry.optionalOmittedCount ?? 0)).toBe(
        entry.droppedCount
      )
    }
  })

  it('reports zero omission and no required loss when no group is truncated', () => {
    const conditionCoverage = coverage([
      coverageGroup('implementation-owners', ['owner-a'], ['owner-a']),
    ])
    const [entry] = classify(
      [truncationEntry('implementation-owners', 1, 1)],
      conditionCoverage
    )

    expect(entry.requiredOmittedCount).toBe(0)
    expect(entry.optionalOmittedCount).toBe(0)
    expect(report([entry], conditionCoverage)).toMatchObject({
      truncated: false,
      requiredEvidenceLost: false,
      records: [],
    })
  })

  it('preserves conservative required-group classification when coverage is absent', () => {
    const [entry] = classify([
      truncationEntry('implementation-contracts', 3, 1),
    ])

    expect(entry).toMatchObject({
      requiredOmittedCount: 2,
      optionalOmittedCount: 0,
      adequacyAffected: true,
    })
    expect(report([entry]).requiredEvidenceLost).toBe(true)
  })

  it('produces equivalent keyed diagnostics for logically equivalent incidental input order', () => {
    const conditionCoverage = coverage([
      coverageGroup('implementation-contracts', ['contract-b', 'contract-a'], ['contract-a']),
      coverageGroup('implementation-owners', ['owner-b', 'owner-a'], ['owner-b']),
    ])
    const forward = classify(
      [
        truncationEntry('implementation-owners', 2, 1),
        truncationEntry('implementation-contracts', 2, 1),
      ],
      conditionCoverage
    )
    const reversed = classify(
      [
        truncationEntry('implementation-contracts', 2, 1),
        truncationEntry('implementation-owners', 2, 1),
      ],
      [...conditionCoverage].reverse()
    )
    const canonical = (entries: readonly GroupTruncationEntry[]) =>
      [...entries].sort((a, b) => a.groupId.localeCompare(b.groupId))

    expect(canonical(reversed)).toEqual(canonical(forward))
  })
})
