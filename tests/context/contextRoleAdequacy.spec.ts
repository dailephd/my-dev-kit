import { describe, expect, it } from 'vitest'
import { evaluateRoleAdequacy } from '../../src/context/contextRoleAdequacy.js'
import { evaluateRoleConditionCoverage } from '../../src/context/roleConditionCoverage.js'
import type {
  ContextAdequacyStatement,
  EvidenceItemRef,
  FreshnessSummary,
  ResponsibilityMapping,
  ResponsibilityMappingSummary,
  RoleConditionCoverage,
  TruncationSummary,
} from '../../src/context/types.js'

function evidence(id: string): EvidenceItemRef {
  return {
    id,
    itemKind: 'symbol',
    path: 'src/fixture.ts',
    nodeId: id,
    relationship: 'qualified-condition-witness',
    basis: 'role adequacy test',
    provenance: 'test-fixture',
  }
}

function conditionCoverage(options: {
  ownersAvailable?: string[]
  ownersRetained?: string[]
  contractsAvailable?: string[]
  contractsRetained?: string[]
} = {}): RoleConditionCoverage[] {
  const {
    ownersAvailable = ['owner-a'],
    ownersRetained = ['owner-a'],
    contractsAvailable = ['contract-a'],
    contractsRetained = ['contract-a'],
  } = options
  return evaluateRoleConditionCoverage({
    role: 'implementation',
    evidenceGroups: [
      {
        groupId: 'implementation-owners',
        availableItems: ownersAvailable.map(evidence),
        retainedItems: ownersRetained.map(evidence),
      },
      {
        groupId: 'implementation-contracts',
        availableItems: contractsAvailable.map(evidence),
        retainedItems: contractsRetained.map(evidence),
      },
    ],
  })
}

const baseAdequacy: ContextAdequacyStatement = {
  status: 'context sufficient for implementation',
  summary: 'test fixture',
  assumptions: [],
  gaps: [],
}

const fresh: FreshnessSummary = {
  state: 'fresh',
  role: 'implementation',
  evidenceUsed: ['test-fixture'],
  evidenceUnavailable: [],
  comparedIdentities: [],
  reason: 'test fixture is fresh',
  relevantChangedPaths: [],
  warnings: [],
}

const noTruncation: TruncationSummary = {
  truncated: false,
  requiredEvidenceLost: false,
  records: [],
  warnings: [],
}

function emptyMappings(): ResponsibilityMappingSummary {
  return {
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
}

function criticalMapping(status: ResponsibilityMapping['mappingStatus']): ResponsibilityMapping {
  return {
    responsibilityId: 'critical-responsibility',
    behavior: null,
    invariant: null,
    criticality: 'critical',
    productionSymbols: [],
    contracts: [],
    validators: [],
    constants: [],
    errors: [],
    sideEffectEvidence: [],
    proposedOrExistingTestFiles: [],
    reusableHelpers: [],
    oracleEvidence: [],
    testCommands: [],
    mappingStatus: status,
    unresolvedReasons: ['test fixture gap'],
    provenance: [],
    warnings: [],
  }
}

function evaluate(options: {
  coverage?: RoleConditionCoverage[]
  coverageProvided?: boolean
  truncation?: TruncationSummary
  freshness?: FreshnessSummary
  responsibilityMappings?: ResponsibilityMappingSummary
  selectedOwners?: EvidenceItemRef[]
  selectedContracts?: EvidenceItemRef[]
} = {}) {
  const roleConditionCoverage = options.coverage ?? conditionCoverage()
  return evaluateRoleAdequacy({
    role: 'implementation',
    baseAdequacy,
    evidenceGroups: [],
    selectedOwners: options.selectedOwners ?? [evidence('owner-a')],
    selectedContracts: options.selectedContracts ?? [evidence('contract-a')],
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
      diffRequested: false,
      files: [],
      symbols: [],
      conflicts: [],
      warnings: [],
    },
    requestedEvidenceKindsRequireTestInfra: false,
    requestedEvidenceKindsRequireTestCommands: false,
    responsibilityMappings: options.responsibilityMappings ?? emptyMappings(),
    freshness: options.freshness ?? fresh,
    truncation: options.truncation ?? noTruncation,
    roleConditionCoverage: options.coverageProvided === false
      ? undefined
      : roleConditionCoverage,
  })
}

describe('condition-aware implementation role adequacy', () => {
  it('remains sufficient when every condition is covered and truncation is optional', () => {
    const result = evaluate({
      truncation: {
        truncated: true,
        requiredEvidenceLost: false,
        records: [{
          id: 'group:implementation-contracts',
          affectedGroup: 'implementation-contracts',
          limit: 1,
          used: 1,
          available: 3,
          droppedCount: 2,
          droppedEvidenceIds: [],
          requiredEvidenceLost: false,
          adequacyImpact: null,
          reason: 'Optional surplus candidates were omitted.',
        }],
        warnings: [],
      },
    })

    expect(result.status).toBe('context sufficient for implementation')
    expect(result.truncationImpact).toBe(false)
    expect(result.missingConditions).not.toContain('required evidence truncated')
  })

  it('remains insufficient when allocation loses the last required contract witness', () => {
    const roleConditionCoverage = conditionCoverage({
      contractsAvailable: ['contract-a'],
      contractsRetained: [],
    })
    const result = evaluate({
      coverage: roleConditionCoverage,
      selectedContracts: [],
      truncation: {
        truncated: true,
        requiredEvidenceLost: true,
        records: [{
          id: 'group:implementation-contracts',
          affectedGroup: 'implementation-contracts',
          limit: 0,
          used: 0,
          available: 1,
          droppedCount: 1,
          droppedEvidenceIds: ['contract-a'],
          requiredEvidenceLost: true,
          adequacyImpact: 'Required condition witness lost.',
          reason: 'Bounded selection omitted the last contract witness.',
        }],
        warnings: [],
      },
    })

    expect(result.status).toBe('context insufficient and more retrieval required')
    expect(result.truncationImpact).toBe(true)
    expect(result.missingConditions).toContain('required contract missing')
    expect(result.missingConditions).not.toContain('required evidence truncated')
  })

  it('reports an unavailable owner without claiming truncation-caused loss', () => {
    const result = evaluate({
      coverage: conditionCoverage({ ownersAvailable: [], ownersRetained: [] }),
      selectedOwners: [],
    })

    expect(result.status).toBe('context insufficient and more retrieval required')
    expect(result.missingConditions).toContain('owner missing')
    expect(result.missingConditions).not.toContain('required evidence truncated')
    expect(result.truncationImpact).toBe(false)
  })

  it('does not let compatibility-only truncation force insufficiency', () => {
    const result = evaluate({
      truncation: {
        truncated: true,
        requiredEvidenceLost: false,
        records: [{
          id: 'group:implementation-compatibility-surfaces',
          affectedGroup: 'implementation-compatibility-surfaces',
          limit: 4,
          used: 4,
          available: 10,
          droppedCount: 6,
          droppedEvidenceIds: [],
          requiredEvidenceLost: false,
          adequacyImpact: null,
          reason: 'Compatibility overflow is optional.',
        }],
        warnings: [],
      },
    })

    expect(result.status).toBe('context sufficient for implementation')
    expect(result.truncationImpact).toBe(false)
  })

  it('keeps a critical unresolved responsibility blocking', () => {
    const responsibilityMappings = emptyMappings()
    responsibilityMappings.mappings = [criticalMapping('unmapped')]

    const result = evaluate({ responsibilityMappings })

    expect(result.status).toBe('context insufficient and more retrieval required')
    expect(result.blockingConditions).toContain('critical-responsibility')
  })

  it('keeps stale context insufficient', () => {
    const result = evaluate({
      freshness: {
        ...fresh,
        state: 'stale',
        reason: 'active index matches the before index',
      },
    })

    expect(result.status).toBe('context insufficient and more retrieval required')
    expect(result.missingConditions).toContain('context stale')
    expect(result.freshnessImpact).toBe(true)
  })

  it('keeps critical responsibility-mapping truncation insufficient', () => {
    const result = evaluate({
      truncation: {
        truncated: true,
        requiredEvidenceLost: true,
        records: [{
          id: 'responsibility-mappings',
          affectedGroup: 'responsibility-mappings',
          limit: 1,
          used: 1,
          available: 2,
          droppedCount: 1,
          droppedEvidenceIds: ['critical-responsibility'],
          requiredEvidenceLost: true,
          adequacyImpact: 'Critical responsibility mapping evidence was dropped.',
          reason: 'Responsibility mapping limit reached.',
        }],
        warnings: [],
      },
    })

    expect(result.status).toBe('context insufficient and more retrieval required')
    expect(result.truncationImpact).toBe(true)
    expect(result.missingConditions).toContain('critical responsibility mapping truncated')
  })

  it('fails closed when a current implementation caller omits or empties condition coverage', () => {
    const absent = evaluate({ coverageProvided: false })
    const empty = evaluate({ coverage: [] })

    for (const result of [absent, empty]) {
      expect(result.status).toBe('context insufficient and more retrieval required')
      expect(result.missingConditions).toContain('role condition coverage unavailable')
      expect(result.blockingConditions).toContain('role condition coverage unavailable')
    }
  })
})
