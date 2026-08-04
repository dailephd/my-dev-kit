import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildTruncation } from '../../src/context/contextBudget.js'
import { evaluateRoleAdequacy } from '../../src/context/contextRoleAdequacy.js'
import { classifyRoleConditionOmissions, evaluateRoleConditionCoverage } from '../../src/context/roleConditionCoverage.js'
import { findRawEvidenceParityIssues } from '../../src/context/rawEvidenceParity.js'
import type {
  ContextAdequacyStatement,
  ContextCapsule,
  EvidenceGroup,
  EvidenceItemRef,
  FreshnessSummary,
  GroupTruncationEntry,
  ResponsibilityMappingSummary,
  RetrievalAuditRecord,
  RoleConditionCoverage,
  TruncationSummary,
} from '../../src/context/types.js'
import { runCli } from '../lookup/testCli.js'

const fixtureRoot = resolve('tests/fixtures/context/architecture-evidence-limits')
let tempRoot: string
let indexOut: string

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function runArchitecture(name: string, evidenceGroupEntries?: number) {
  const capsulePath = join(tempRoot, `${name}.capsule.json`)
  const auditPath = join(tempRoot, `${name}.audit.json`)
  const requestPath = join(tempRoot, `${name}.request.json`)
  writeFileSync(requestPath, JSON.stringify({
    schemaVersion: '1.0.0',
    role: 'architecture',
    mode: 'subsystem',
    index: indexOut,
    query: 'architecture registry types contracts extension points owners and tests',
    focusFiles: ['src/architectureRegistry.ts', 'src/architectureTypes.ts'],
    focusSymbols: ['symbol:src/architectureRegistry.ts#resolveArchitectureContract'],
    requestedEvidenceKinds: ['owner', 'contracts', 'closest-tests'],
    ...(evidenceGroupEntries === undefined ? {} : { limits: { evidenceGroupEntries } }),
    output: capsulePath,
    auditOutput: auditPath,
  }))
  const result = runCli(['context', '--request', requestPath])
  return {
    result,
    capsule: result.status === 0 ? readJson<ContextCapsule>(capsulePath) : null,
    audit: result.status === 0 ? readJson<RetrievalAuditRecord>(auditPath) : null,
  }
}

function architectureGroups(capsule: ContextCapsule): EvidenceGroup[] {
  return capsule.evidenceGroups.filter((group) => [
    'architecture-owners',
    'architecture-extension-points',
    'architecture-contracts',
    'architecture-architecture-tests',
  ].includes(group.id))
}

function evidence(id: string): EvidenceItemRef {
  return {
    id,
    itemKind: 'symbol',
    path: 'src/architectureFixture.ts',
    nodeId: id,
    relationship: 'required architecture witness',
    basis: 'architecture evidence-limit regression',
    provenance: 'test-fixture',
  }
}

const emptyMappings: ResponsibilityMappingSummary = {
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

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'my-dev-kit-architecture-evidence-limits-'))
  indexOut = join(tempRoot, 'index')
  expect(runCli(['index', '--root', fixtureRoot, '--src', 'src', '--out', indexOut, '--call-graph']).status).toBe(0)
})

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true })
})

describe('architecture evidence-group limit correction', () => {
  it('keeps default optional truncation adequate and deterministic with capsule/audit parity', () => {
    const first = runArchitecture('default-first')
    const second = runArchitecture('default-second')
    expect(first.result.status).toBe(0)
    expect(second.result.status).toBe(0)
    const capsule = first.capsule!
    const audit = first.audit!
    const groups = architectureGroups(capsule)

    expect(Object.fromEntries(groups.map((group) => [group.id, group.limit]))).toMatchObject({
      'architecture-owners': 5,
      'architecture-extension-points': 8,
      'architecture-contracts': 10,
      'architecture-architecture-tests': 8,
    })
    expect(groups.some((group) => group.truncated)).toBe(true)
    expect(capsule.truncation.truncated).toBe(true)
    expect(capsule.truncation.requiredEvidenceLost).toBe(false)
    expect(capsule.roleAdequacy.status).not.toBe('context insufficient and more retrieval required')
    expect(capsule.roleConditionCoverage?.every((condition) => condition.conditionSatisfied)).toBe(true)
    expect(findRawEvidenceParityIssues(capsule, audit)).toEqual([])
    expect(capsule.roleConditionCoverage).toEqual(second.capsule!.roleConditionCoverage)
    expect(capsule.evidenceGroups).toEqual(second.capsule!.evidenceGroups)
    expect(capsule.truncation).toEqual(second.capsule!.truncation)
  })

  it('applies smaller and larger explicit limits per architecture evidence group', () => {
    const smaller = runArchitecture('explicit-two', 2).capsule!
    const larger = runArchitecture('explicit-forty', 40).capsule!
    const smallerGroups = architectureGroups(smaller)
    const largerGroups = architectureGroups(larger)

    expect(smallerGroups.every((group) => group.limit === 2)).toBe(true)
    expect(smallerGroups.every((group) => group.usedCount <= 2)).toBe(true)
    expect(smaller.truncation.truncated).toBe(true)
    expect(smaller.truncation.requiredEvidenceLost).toBe(false)
    expect(smaller.roleAdequacy.status).not.toBe('context insufficient and more retrieval required')
    expect(largerGroups.every((group) => group.limit === 40)).toBe(true)
    expect(largerGroups.every((group) => group.droppedCount === 0)).toBe(true)
    const limitEntry = larger.budget.limits.find((entry) => entry.name === 'evidenceGroupEntries')
    expect(limitEntry?.requestedValue).toBe(40)
    expect(limitEntry?.appliedLimits).toEqual(
      [...limitEntry!.appliedLimits!].sort((left, right) => left.groupId.localeCompare(right.groupId))
    )
    expect(limitEntry?.appliedLimits?.filter((entry) => entry.groupId.startsWith('architecture-')).every((entry) => entry.limit === 40)).toBe(true)
  })

  it('rejects zero rather than silently accepting an invalid explicit limit', () => {
    const invalid = runArchitecture('invalid-zero', 0)
    expect(invalid.result.status).toBe(2)
    expect(invalid.result.stderr).toContain('Invalid limits.evidenceGroupEntries')
    expect(invalid.result.stderr).toContain('positive integer')
  })

  it('distinguishes final owner/contract witness loss from missing evidence', () => {
    const owner = evidence('owner-final')
    const contract = evidence('contract-final')
    const coverage = evaluateRoleConditionCoverage({
      role: 'architecture',
      evidenceGroups: [
        { groupId: 'architecture-owners', availableItems: [owner], retainedItems: [] },
        { groupId: 'architecture-extension-points', availableItems: [], retainedItems: [] },
        { groupId: 'architecture-contracts', availableItems: [contract], retainedItems: [] },
        { groupId: 'architecture-architecture-tests', availableItems: [], retainedItems: [] },
      ],
    })
    const ownerCondition = coverage.find((entry) => entry.conditionId === 'architecture-owner')!
    const contractCondition = coverage.find((entry) => entry.conditionId === 'architecture-contract')!
    expect(ownerCondition.lostRequiredCondition).toBe(true)
    expect(contractCondition.lostRequiredCondition).toBe(true)

    const entries: GroupTruncationEntry[] = classifyRoleConditionOmissions({
      groupTruncation: [
        { groupId: 'architecture-owners', limit: 0, availableCount: 1, usedCount: 0, truncated: true, droppedCount: 1, required: true },
        { groupId: 'architecture-contracts', limit: 0, availableCount: 1, usedCount: 0, truncated: true, droppedCount: 1, required: true },
      ],
      roleConditionCoverage: coverage,
    })
    const evidenceGroups: EvidenceGroup[] = entries.map((entry) => ({
      id: entry.groupId,
      kind: entry.groupId.endsWith('owners') ? 'owners' : 'contracts',
      role: 'architecture',
      title: entry.groupId,
      required: true,
      items: [],
      unresolved: [],
      warnings: [],
      limit: entry.limit,
      availableCount: entry.availableCount,
      usedCount: entry.usedCount,
      truncated: entry.truncated,
      droppedCount: entry.droppedCount,
      provenance: 'test-fixture',
    }))
    const truncation = buildTruncation({ evidenceGroups, groupTruncation: entries, responsibilityMappings: emptyMappings, roleConditionCoverage: coverage })
    expect(truncation.requiredEvidenceLost).toBe(true)
    expect(truncation.records.every((record) => record.requiredEvidenceLost)).toBe(true)

    const adequacy = evaluateArchitectureAdequacy(coverage, evidenceGroups, truncation)
    expect(adequacy.status).toBe('context insufficient and more retrieval required')
    expect(adequacy.missingConditions).toContain('no plausible owner exists')
    expect(adequacy.missingConditions).toContain('no relevant contract evidence')

    const missingCoverage = evaluateRoleConditionCoverage({
      role: 'architecture',
      evidenceGroups: [
        { groupId: 'architecture-owners', availableItems: [], retainedItems: [] },
        { groupId: 'architecture-extension-points', availableItems: [], retainedItems: [] },
        { groupId: 'architecture-contracts', availableItems: [], retainedItems: [] },
        { groupId: 'architecture-architecture-tests', availableItems: [], retainedItems: [] },
      ],
    })
    expect(missingCoverage.find((entry) => entry.conditionId === 'architecture-owner')?.conditionSatisfied).toBe(false)
    expect(missingCoverage.find((entry) => entry.conditionId === 'architecture-owner')?.lostRequiredCondition).toBe(false)
    expect(missingCoverage.find((entry) => entry.conditionId === 'architecture-contract')?.lostRequiredCondition).toBe(false)
  })

  it('preserves schema-major-1 additive compatibility', () => {
    const capsule = runArchitecture('schema-major-one', 3).capsule!
    expect(capsule.schemaVersion).toBe('1.0.0')
    expect(capsule.roleConditionCoverage?.map((entry) => entry.conditionId)).toEqual([
      'architecture-owner',
      'architecture-extension-point',
      'architecture-contract',
      'architecture-test-or-explicit-gap',
    ])
  })
})

function evaluateArchitectureAdequacy(
  coverage: RoleConditionCoverage[],
  evidenceGroups: EvidenceGroup[],
  truncation: TruncationSummary
) {
  const baseAdequacy: ContextAdequacyStatement = {
    status: 'context sufficient for implementation',
    summary: 'architecture evidence-limit regression',
    assumptions: [],
    gaps: [],
  }
  const freshness: FreshnessSummary = {
    state: 'fresh',
    role: 'architecture',
    evidenceUsed: ['test-fixture'],
    evidenceUnavailable: [],
    comparedIdentities: [],
    reason: 'test fixture is fresh',
    relevantChangedPaths: [],
    warnings: [],
  }
  return evaluateRoleAdequacy({
    role: 'architecture',
    baseAdequacy,
    evidenceGroups,
    selectedOwners: [],
    selectedContracts: [],
    selectedTests: [],
    testInfrastructure: {
      relatedTests: [], fixtures: [], factories: [], mocks: [], setupFiles: [],
      testConfigurations: [], packageScripts: [], testCommands: [], unresolved: [], warnings: [],
    },
    changedSurface: { available: false, diffRequested: false, files: [], symbols: [], conflicts: [], warnings: [] },
    requestedEvidenceKindsRequireTestInfra: false,
    requestedEvidenceKindsRequireTestCommands: false,
    responsibilityMappings: emptyMappings,
    freshness,
    truncation,
    roleConditionCoverage: coverage,
  })
}
