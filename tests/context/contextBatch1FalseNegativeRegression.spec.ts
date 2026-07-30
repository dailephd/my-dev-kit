import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTruncation } from '../../src/context/contextBudget.js'
import { evaluateRoleAdequacy } from '../../src/context/contextRoleAdequacy.js'
import {
  classifyRoleConditionOmissions,
} from '../../src/context/roleConditionCoverage.js'
import {
  assertRawEvidenceParity,
  findRawEvidenceParityIssues,
} from '../../src/context/rawEvidenceParity.js'
import type {
  ContextAdequacyStatement,
  ContextCapsule,
  EvidenceGroup,
  EvidenceItemRef,
  FreshnessSummary,
  GroupTruncationEntry,
  ResponsibilityMappingSummary,
  RetrievalAuditRecord,
  RoleAdequacyStatement,
  RoleConditionCoverage,
  TruncationSummary,
} from '../../src/context/types.js'

interface FrozenGroup {
  groupId: string
  required: boolean
  reservation: number
  availableCount: number
  usedCount: number
  truncated: boolean
  droppedCount: number
  initiallySelectedCount: number
  unusedReservationContributed: number
  borrowedCapacity: number
  requiredOmittedCount: number
  optionalOmittedCount: number
  adequacyAffected: boolean
}

interface FrozenOutcome {
  groupOmissions: Array<{
    groupId: string
    requiredOmittedCount: number
    optionalOmittedCount: number
    requiredEvidenceLost: boolean
  }>
  truncated: boolean
  requiredEvidenceLost: boolean
  missingConditions: string[]
  blockingConditions: string[]
  roleAdequacyStatus: RoleAdequacyStatement['status']
}

interface FrozenFixture {
  fixtureSchemaVersion: string
  fixtureId: string
  provenance: {
    sourceInvestigationReport: string
    originalProducerVersion: string
    sourceRepositoryIdentity: string
    originalActiveIndexIdentity: string
    indexedRepositoryCommit: string
    productionCommitAfterIndexing: string
    captureDate: string
    originalArtifacts: Record<string, { source: string; sha256: string }>
    normalization: {
      performed: boolean
      fields: string[]
      decisionRelevantFieldsChanged: boolean
    }
  }
  request: {
    schemaVersion: string
    role: string
    query: string
    index: string
    mode: string
    focusFiles: string[]
    beforeIndex: string
    afterIndex: string
    requestedEvidenceKinds: string[]
    output: string
    auditOutput: string
  }
  allocation: {
    governingHardBound: number
    aggregateCapacityUsed: number
    aggregateCapacityRemaining: number
    groups: FrozenGroup[]
  }
  roleConditionCoverage: RoleConditionCoverage[]
  historicalV1103Outcome: FrozenOutcome & {
    requiredConditions: string[]
    satisfiedConditions: string[]
  }
  correctedOutcome: FrozenOutcome
}

const fixtureDirectory = join(
  process.cwd(),
  'tests',
  'fixtures',
  'context',
  'batch1-false-negative'
)
const fixturePath = join(fixtureDirectory, 'frozen-case.json')
const fixtureBytes = readFileSync(fixturePath)
const fixture = JSON.parse(fixtureBytes.toString('utf8')) as FrozenFixture

const baseAdequacy: ContextAdequacyStatement = {
  status: 'context sufficient with listed assumptions',
  summary: 'A best-effort focus node was selected; some ambiguity or thin graph/source/metadata evidence remains.',
  assumptions: [],
  gaps: ['Graph neighborhood evidence is thin (0-1 nodes).'],
}

const fresh: FreshnessSummary = {
  state: 'fresh',
  role: 'implementation',
  evidenceUsed: ['active index equals after index'],
  evidenceUnavailable: [],
  comparedIdentities: [
    { label: 'activeIndexPath', value: fixture.request.afterIndex },
    { label: 'beforeIndexPath', value: fixture.request.beforeIndex },
    { label: 'afterIndexPath', value: fixture.request.afterIndex },
  ],
  reason: 'Frozen active index equals the supplied after index.',
  relevantChangedPaths: [],
  warnings: [],
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

function evidence(id: string): EvidenceItemRef {
  const withoutKind = id.startsWith('file:') ? id.slice('file:'.length) : id
  const path = withoutKind.startsWith('symbol:')
    ? withoutKind.slice('symbol:'.length).split('#')[0]
    : withoutKind
  return {
    id,
    itemKind: id.startsWith('symbol:') ? 'symbol' : 'file',
    path,
    nodeId: id.startsWith('symbol:') ? id : undefined,
    relationship: 'frozen-condition-witness',
    basis: fixture.fixtureId,
    provenance: 'frozen-batch-1-regression',
  }
}

function rawGroupTruncation(groups = fixture.allocation.groups): GroupTruncationEntry[] {
  return groups.map((group) => ({
    groupId: group.groupId,
    limit: group.usedCount,
    availableCount: group.availableCount,
    usedCount: group.usedCount,
    truncated: group.truncated,
    droppedCount: group.droppedCount,
    required: group.required,
    reservation: group.reservation,
    initiallySelectedCount: group.initiallySelectedCount,
    unusedReservationContributed: group.unusedReservationContributed,
    borrowedCapacity: group.borrowedCapacity,
    governingHardBound: fixture.allocation.governingHardBound,
    aggregateCapacityUsed: fixture.allocation.aggregateCapacityUsed,
    aggregateCapacityRemaining: fixture.allocation.aggregateCapacityRemaining,
  }))
}

function evidenceGroups(groups: readonly GroupTruncationEntry[]): EvidenceGroup[] {
  return groups.map((group) => ({
    id: group.groupId,
    kind: group.groupId.replace('implementation-', '') as EvidenceGroup['kind'],
    role: 'implementation',
    title: group.groupId,
    required: group.required ?? false,
    items: [],
    unresolved: [],
    warnings: [],
    limit: group.limit,
    availableCount: group.availableCount,
    usedCount: group.usedCount,
    truncated: group.truncated,
    droppedCount: group.droppedCount,
    provenance: 'frozen-batch-1-regression',
  }))
}

function derive(
  coverage: RoleConditionCoverage[],
  groups = rawGroupTruncation()
): {
  groupTruncation: GroupTruncationEntry[]
  truncation: TruncationSummary
  adequacy: RoleAdequacyStatement
} {
  const groupTruncation = classifyRoleConditionOmissions({
    groupTruncation: groups,
    roleConditionCoverage: coverage,
  })
  const truncation = buildTruncation({
    evidenceGroups: evidenceGroups(groupTruncation),
    groupTruncation,
    responsibilityMappings: emptyResponsibilityMappings,
    roleConditionCoverage: coverage,
  })
  const ownerCoverage = coverage.find(
    (condition) => condition.conditionId === 'implementation.selected-owner'
  )
  const contractCoverage = coverage.find(
    (condition) => condition.conditionId === 'implementation.required-contract'
  )
  const adequacy = evaluateRoleAdequacy({
    role: 'implementation',
    baseAdequacy,
    evidenceGroups: evidenceGroups(groupTruncation),
    selectedOwners: (ownerCoverage?.retainedWitnessIds ?? []).map(evidence),
    selectedContracts: (contractCoverage?.retainedWitnessIds ?? []).map(evidence),
    selectedTests: [],
    testInfrastructure: {
      relatedTests: [],
      fixtures: [],
      factories: [],
      mocks: [],
      setupFiles: [],
      testConfigurations: [],
      packageScripts: [],
      testCommands: [],
      unresolved: [],
      warnings: [],
    },
    changedSurface: {
      available: true,
      diffRequested: true,
      files: [],
      symbols: [],
      conflicts: [],
      warnings: [],
    },
    requestedEvidenceKindsRequireTestInfra: false,
    requestedEvidenceKindsRequireTestCommands: false,
    responsibilityMappings: emptyResponsibilityMappings,
    freshness: fresh,
    truncation,
    roleConditionCoverage: coverage,
  })
  return { groupTruncation, truncation, adequacy }
}

function currentPair(
  coverage: RoleConditionCoverage[],
  truncation: TruncationSummary,
  adequacy: RoleAdequacyStatement
): { capsule: ContextCapsule; audit: RetrievalAuditRecord } {
  const shared = {
    schemaVersion: '1.0.0',
    tool: { name: 'my-dev-kit', version: '1.10.3' },
    request: {
      originalQuery: fixture.request.query,
      normalizedQuery: fixture.request.query,
      mode: fixture.request.mode,
      requestedOutputPath: fixture.request.output,
      role: fixture.request.role,
      requestFilePath: '<REQUEST_PATH>',
    },
    contextAdequacy: baseAdequacy,
    roleContext: { role: 'implementation' },
    responsibilityMappings: emptyResponsibilityMappings,
    roleAdequacy: adequacy,
    freshness: fresh,
    budget: {
      limits: [{
        name: 'implementationEvidenceAggregate',
        declaredValue: fixture.allocation.governingHardBound,
        usedValue: fixture.allocation.aggregateCapacityUsed,
      }],
    },
    truncation,
    fullFileFallback: { used: 0 },
    provenance: [{ id: fixture.fixtureId }],
    roleConditionCoverage: coverage,
  }
  const index = {
    indexPath: fixture.request.index,
    manifestPath: `${fixture.request.index}/manifest.json`,
    manifestSchemaVersion: '1.0.0',
    projectRoot: fixture.provenance.sourceRepositoryIdentity,
  }
  return {
    capsule: {
      ...structuredClone(shared),
      index: { ...index, artifactRefs: [] },
    } as unknown as ContextCapsule,
    audit: {
      ...structuredClone(shared),
      index: { ...index },
    } as unknown as RetrievalAuditRecord,
  }
}

function group(
  entries: readonly GroupTruncationEntry[],
  groupId: string
): GroupTruncationEntry {
  const entry = entries.find((candidate) => candidate.groupId === groupId)
  if (!entry) throw new Error(`Frozen group "${groupId}" is missing.`)
  return entry
}

function condition(
  coverage: readonly RoleConditionCoverage[],
  conditionId: RoleConditionCoverage['conditionId']
): RoleConditionCoverage {
  const entry = coverage.find((candidate) => candidate.conditionId === conditionId)
  if (!entry) throw new Error(`Frozen condition "${conditionId}" is missing.`)
  return entry
}

describe('frozen Batch 1 condition-aware adequacy regression', () => {
  it('preserves source hashes, portable normalization, and normalized fixture integrity', () => {
    const hashManifest = JSON.parse(
      readFileSync(join(fixtureDirectory, 'hash-manifest.json'), 'utf8')
    ) as {
      algorithm: string
      files: Record<string, string>
    }
    const fixtureName = 'frozen-case.json'
    const expectedHash = hashManifest.files[fixtureName]
    const actualHash = createHash('sha256').update(fixtureBytes).digest('hex').toUpperCase()
    const rawFixture = fixtureBytes.toString('utf8')

    expect(hashManifest.algorithm).toBe('SHA-256')
    expect(fixtureName).toBe('frozen-case.json')
    expect(actualHash).toBe(expectedHash)
    expect(fixture.provenance.originalArtifacts).toMatchObject({
      request: {
        sha256: 'D2E5CFFD1DA4DCFD6E8DE396657E0BFD509CE81CFCD6AF18B53854D8D5864085',
      },
      capsule: {
        sha256: 'FD37E981FEEA6E8CF605295DDC367754CE56E932DA327807D65261A05636F2A9',
      },
      audit: {
        sha256: 'CABF607CC4D1827E0B0E35D86138034DDEB254F014AF18CCD78DBF91A19F5DD7',
      },
    })
    expect(fixture.provenance.normalization).toMatchObject({
      performed: true,
      decisionRelevantFieldsChanged: false,
    })
    expect(fixture.provenance.sourceInvestigationReport).toContain('<INVESTIGATION_ROOT>')
    expect(rawFixture).not.toMatch(/[A-Za-z]:[\\/]+Users[\\/]+/)
    expect(rawFixture).not.toMatch(/\/Users\/[^/]+\/Projects\//)
  })

  it('keeps the exact 84-item allocation while correcting only decision semantics', () => {
    const first = derive(structuredClone(fixture.roleConditionCoverage))
    const second = derive(structuredClone(fixture.roleConditionCoverage))
    const contracts = group(first.groupTruncation, 'implementation-contracts')
    const compatibility = group(
      first.groupTruncation,
      'implementation-compatibility-surfaces'
    )
    const owners = condition(
      fixture.roleConditionCoverage,
      'implementation.selected-owner'
    )
    const contractCoverage = condition(
      fixture.roleConditionCoverage,
      'implementation.required-contract'
    )

    expect(fixture.allocation.groups.reduce((sum, entry) => sum + entry.reservation, 0)).toBe(84)
    expect(fixture.allocation.groups.reduce((sum, entry) => sum + entry.usedCount, 0)).toBe(84)
    expect(fixture.allocation).toMatchObject({
      governingHardBound: 84,
      aggregateCapacityUsed: 84,
      aggregateCapacityRemaining: 0,
    })
    expect(contracts).toMatchObject({
      reservation: 10,
      availableCount: 47,
      usedCount: 39,
      droppedCount: 8,
      borrowedCapacity: 29,
      requiredOmittedCount: 0,
      optionalOmittedCount: 8,
      adequacyAffected: false,
    })
    expect(compatibility).toMatchObject({
      reservation: 8,
      availableCount: 29,
      usedCount: 8,
      droppedCount: 21,
      requiredOmittedCount: 0,
      optionalOmittedCount: 21,
      adequacyAffected: false,
    })
    expect(owners).toMatchObject({
      availableWitnessCount: 15,
      retainedWitnessCount: 15,
      conditionSatisfied: true,
      lostRequiredCondition: false,
    })
    expect(contractCoverage).toMatchObject({
      availableWitnessCount: 47,
      retainedWitnessCount: 39,
      conditionSatisfied: true,
      lostRequiredCondition: false,
    })
    expect(first.truncation).toMatchObject({
      truncated: true,
      requiredEvidenceLost: false,
    })
    expect(first.truncation.records.every((record) => !record.requiredEvidenceLost)).toBe(true)
    expect(first.adequacy).toMatchObject({
      status: fixture.correctedOutcome.roleAdequacyStatus,
      missingConditions: [],
      blockingConditions: [],
      truncationImpact: false,
    })

    const pair = currentPair(
      fixture.roleConditionCoverage,
      first.truncation,
      first.adequacy
    )
    expect(pair.capsule.roleConditionCoverage).toEqual(pair.audit.roleConditionCoverage)
    expect(pair.capsule.truncation).toEqual(pair.audit.truncation)
    expect(pair.capsule.roleAdequacy).toEqual(pair.audit.roleAdequacy)
    expect(findRawEvidenceParityIssues(pair.capsule, pair.audit)).toEqual([])
    expect(second).toEqual(first)
  })

  it('retains the immutable v1.10.3 failure as a bounded historical comparison', () => {
    const corrected = derive(structuredClone(fixture.roleConditionCoverage))
    const historical = fixture.historicalV1103Outcome

    expect(historical).toMatchObject({
      truncated: true,
      requiredEvidenceLost: true,
      missingConditions: ['required evidence truncated'],
      blockingConditions: [],
      roleAdequacyStatus: 'context insufficient and more retrieval required',
    })
    expect(historical.requiredConditions).toEqual(historical.satisfiedConditions)
    expect(historical.groupOmissions).toEqual([
      {
        groupId: 'implementation-contracts',
        requiredOmittedCount: 8,
        optionalOmittedCount: 0,
        requiredEvidenceLost: true,
      },
      {
        groupId: 'implementation-compatibility-surfaces',
        requiredOmittedCount: 21,
        optionalOmittedCount: 0,
        requiredEvidenceLost: true,
      },
    ])
    expect(corrected.adequacy.status).toBe(
      'context sufficient with listed assumptions'
    )
    expect(corrected.truncation.requiredEvidenceLost).toBe(false)
    expect(fixture.allocation.aggregateCapacityUsed).toBe(84)
    expect(fixture.allocation.governingHardBound).toBe(84)
  })

  it('fails closed when allocation loses the last adequate contract witness', () => {
    const coverage = structuredClone(fixture.roleConditionCoverage)
    const contract = condition(coverage, 'implementation.required-contract')
    contract.availableWitnessCount = 1
    contract.retainedWitnessCount = 0
    contract.retainedWitnessIds = []
    contract.conditionSatisfied = false
    contract.lostRequiredCondition = true
    contract.lossReason = 'bounded-allocation-omitted-required-witnesses'
    const contractGroup = fixture.allocation.groups.find(
      (entry) => entry.groupId === 'implementation-contracts'
    )
    if (!contractGroup) throw new Error('Frozen contract group is missing.')
    const groups = rawGroupTruncation([
      {
        ...contractGroup,
        availableCount: 1,
        usedCount: 0,
        truncated: true,
        droppedCount: 1,
        initiallySelectedCount: 0,
        borrowedCapacity: 0,
      },
    ])
    const result = derive(coverage, groups)

    expect(group(result.groupTruncation, 'implementation-contracts')).toMatchObject({
      requiredOmittedCount: 1,
      optionalOmittedCount: 0,
      adequacyAffected: true,
    })
    expect(result.truncation.requiredEvidenceLost).toBe(true)
    expect(result.adequacy.status).toBe('context insufficient and more retrieval required')
    expect(result.adequacy.missingConditions).toContain('required contract missing')
  })

  it('distinguishes no-candidate absence from truncation-caused required loss', () => {
    const coverage = structuredClone(fixture.roleConditionCoverage)
    const contract = condition(coverage, 'implementation.required-contract')
    contract.availableWitnessCount = 0
    contract.retainedWitnessCount = 0
    contract.retainedWitnessIds = []
    contract.conditionSatisfied = false
    contract.lostRequiredCondition = false
    contract.lossReason = null
    const contractGroup = fixture.allocation.groups.find(
      (entry) => entry.groupId === 'implementation-contracts'
    )
    if (!contractGroup) throw new Error('Frozen contract group is missing.')
    const groups = rawGroupTruncation([
      {
        ...contractGroup,
        availableCount: 0,
        usedCount: 0,
        truncated: false,
        droppedCount: 0,
        initiallySelectedCount: 0,
        borrowedCapacity: 0,
      },
    ])
    const result = derive(coverage, groups)

    expect(group(result.groupTruncation, 'implementation-contracts')).toMatchObject({
      requiredOmittedCount: 0,
      optionalOmittedCount: 0,
      adequacyAffected: false,
    })
    expect(result.truncation.requiredEvidenceLost).toBe(false)
    expect(result.adequacy.status).toBe('context insufficient and more retrieval required')
    expect(result.adequacy.missingConditions).toContain('required contract missing')
    expect(result.adequacy.missingConditions).not.toContain('required evidence truncated')
  })

  it('keeps compatibility-only overflow visible, optional, and non-blocking', () => {
    const compatibility = fixture.allocation.groups.find(
      (entry) => entry.groupId === 'implementation-compatibility-surfaces'
    )
    if (!compatibility) throw new Error('Frozen compatibility group is missing.')
    const result = derive(
      structuredClone(fixture.roleConditionCoverage),
      rawGroupTruncation([compatibility])
    )

    expect(group(
      result.groupTruncation,
      'implementation-compatibility-surfaces'
    )).toMatchObject({
      truncated: true,
      requiredOmittedCount: 0,
      optionalOmittedCount: 21,
      adequacyAffected: false,
    })
    expect(result.truncation).toMatchObject({
      truncated: true,
      requiredEvidenceLost: false,
    })
    expect(result.adequacy.status).toBe('context sufficient with listed assumptions')
  })

  it('hardens current, legacy, one-sided, disagreement, and additive-summary compatibility', () => {
    const current = derive(structuredClone(fixture.roleConditionCoverage))
    const currentArtifacts = currentPair(
      structuredClone(fixture.roleConditionCoverage),
      current.truncation,
      current.adequacy
    )
    expect(currentArtifacts.capsule.roleConditionCoverage).toBeDefined()
    expect(currentArtifacts.audit.roleConditionCoverage).toBeDefined()
    expect(currentArtifacts.capsule.roleConditionCoverage).toEqual(
      currentArtifacts.audit.roleConditionCoverage
    )
    expect(currentArtifacts.capsule.truncation.requiredEvidenceLost).toBe(false)
    expect(
      currentArtifacts.capsule.truncation.records.some(
        (record) => record.requiredEvidenceLost
      )
    ).toBe(false)

    const legacy = currentPair(
      structuredClone(fixture.roleConditionCoverage),
      structuredClone(current.truncation),
      current.adequacy
    )
    delete legacy.capsule.roleConditionCoverage
    delete legacy.audit.roleConditionCoverage
    delete legacy.capsule.truncation.requiredEvidenceLost
    delete legacy.audit.truncation.requiredEvidenceLost
    expect(findRawEvidenceParityIssues(legacy.capsule, legacy.audit)).toEqual([])

    const conservativeGroup = rawGroupTruncation([
      fixture.allocation.groups.find(
        (entry) => entry.groupId === 'implementation-contracts'
      )!,
    ])
    const conservativeClassification = classifyRoleConditionOmissions({
      groupTruncation: conservativeGroup,
    })
    expect(conservativeClassification[0]).toMatchObject({
      requiredOmittedCount: 8,
      optionalOmittedCount: 0,
      adequacyAffected: true,
    })
    const conservativeAdequacy = evaluateRoleAdequacy({
      role: 'implementation',
      baseAdequacy,
      evidenceGroups: evidenceGroups(conservativeClassification),
      selectedOwners: condition(
        fixture.roleConditionCoverage,
        'implementation.selected-owner'
      ).retainedWitnessIds.map(evidence),
      selectedContracts: condition(
        fixture.roleConditionCoverage,
        'implementation.required-contract'
      ).retainedWitnessIds.map(evidence),
      selectedTests: [],
      testInfrastructure: {
        relatedTests: [],
        fixtures: [],
        factories: [],
        mocks: [],
        setupFiles: [],
        testConfigurations: [],
        packageScripts: [],
        testCommands: [],
        unresolved: [],
        warnings: [],
      },
      changedSurface: {
        available: true,
        diffRequested: true,
        files: [],
        symbols: [],
        conflicts: [],
        warnings: [],
      },
      requestedEvidenceKindsRequireTestInfra: false,
      requestedEvidenceKindsRequireTestCommands: false,
      responsibilityMappings: emptyResponsibilityMappings,
      freshness: fresh,
      truncation: buildTruncation({
        evidenceGroups: evidenceGroups(conservativeClassification),
        groupTruncation: conservativeClassification,
        responsibilityMappings: emptyResponsibilityMappings,
      }),
    })
    expect(conservativeAdequacy.status).toBe(
      'context insufficient and more retrieval required'
    )
    expect(conservativeAdequacy.blockingConditions).toContain(
      'role condition coverage unavailable'
    )

    const emptyCoverageAdequacy = derive([]).adequacy
    expect(emptyCoverageAdequacy.status).toBe(
      'context insufficient and more retrieval required'
    )
    expect(emptyCoverageAdequacy.blockingConditions).toContain(
      'role condition coverage unavailable'
    )

    const oneSided = currentPair(
      structuredClone(fixture.roleConditionCoverage),
      current.truncation,
      current.adequacy
    )
    delete oneSided.audit.roleConditionCoverage
    expect(findRawEvidenceParityIssues(
      oneSided.capsule,
      oneSided.audit
    ).map((issue) => issue.field)).toEqual(['roleConditionCoverage'])
    expect(() => assertRawEvidenceParity(oneSided.capsule, oneSided.audit)).toThrow(
      /roleConditionCoverage/
    )

    const mutations: Array<(coverage: RoleConditionCoverage[]) => void> = [
      (coverage) => {
        coverage[0].conditionId = 'implementation.required-contract'
      },
      (coverage) => {
        coverage[0].retainedWitnessIds = coverage[0].retainedWitnessIds.slice(1)
      },
      (coverage) => {
        coverage[0].retainedWitnessCount -= 1
      },
      (coverage) => {
        coverage[0].conditionSatisfied = false
      },
      (coverage) => {
        coverage[0].lostRequiredCondition = true
      },
    ]
    for (const mutate of mutations) {
      const disagreement = currentPair(
        structuredClone(fixture.roleConditionCoverage),
        current.truncation,
        current.adequacy
      )
      const auditCoverage = structuredClone(disagreement.audit.roleConditionCoverage ?? [])
      mutate(auditCoverage)
      disagreement.audit.roleConditionCoverage = auditCoverage
      expect(findRawEvidenceParityIssues(
        disagreement.capsule,
        disagreement.audit
      ).map((issue) => issue.field)).toEqual(['roleConditionCoverage'])
    }

    const oneSidedSummary = currentPair(
      structuredClone(fixture.roleConditionCoverage),
      structuredClone(current.truncation),
      current.adequacy
    )
    delete oneSidedSummary.audit.truncation.requiredEvidenceLost
    expect(findRawEvidenceParityIssues(
      oneSidedSummary.capsule,
      oneSidedSummary.audit
    ).map((issue) => issue.field)).toEqual(['truncation'])
  })
})
