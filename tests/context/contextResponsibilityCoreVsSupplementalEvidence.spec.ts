import { describe, expect, it } from 'vitest'
import { buildResponsibilityMappings } from '../../src/context/responsibilityMapping.js'
import { evaluateRoleAdequacy } from '../../src/context/contextRoleAdequacy.js'
import type {
  ContextAdequacyStatement,
  EvidenceGroup,
  EvidenceItemRef,
  FreshnessSummary,
  ResponsibilityCriticality,
  ResponsibilityInput,
  ResponsibilityMappingSummary,
  TestCommandEvidenceEntry,
  TestInfrastructureSummary,
  TruncationSummary,
} from '../../src/context/types.js'

/**
 * v1.12.3 Batch 3: core responsibility evidence (production, contract/validator/error,
 * related test, oracle) vs. supplemental execution metadata (test commands).
 *
 * Regression for the pre-Batch-3 false blocker: `determineStatus` in
 * `responsibilityMapping.ts` used to treat `testCommands` as a fifth unconditional
 * required category alongside the four core ones, so a responsibility with complete
 * core evidence and no discoverable command reported `partially-mapped` even when the
 * caller never requested `test-commands` evidence — which in turn downgraded
 * `test-implementation` role adequacy to insufficient/blocking (see
 * `contextRoleAdequacy.ts`'s `criticalPartial.length > 0` branch) purely because a
 * command was not statically discoverable. This file freezes the corrected matrix.
 */

function prodSymbol(): EvidenceItemRef {
  return {
    id: 'symbol:src/orderProcessor.ts#processOrder',
    itemKind: 'symbol',
    symbolId: 'symbol:src/orderProcessor.ts#processOrder',
    path: 'src/orderProcessor.ts',
    relationship: 'modified',
    basis: 'changed-surface (caller)',
    provenance: 'caller',
  }
}

function contractItem(): EvidenceItemRef {
  return {
    id: 'src/orderValidator.ts',
    itemKind: 'file',
    path: 'src/orderValidator.ts',
    relationship: 'contract-like candidate',
    basis: 'candidate-ranking',
    provenance: 'candidate-ranking',
  }
}

function errorItem(): EvidenceItemRef {
  return {
    id: 'src/orderError.ts',
    itemKind: 'file',
    path: 'src/orderError.ts',
    relationship: 'error-like candidate',
    basis: 'candidate-ranking',
    provenance: 'candidate-ranking',
  }
}

function testItem(): EvidenceItemRef {
  return {
    id: 'src/orderProcessor.spec.ts',
    itemKind: 'test-file',
    path: 'src/orderProcessor.spec.ts',
    relationship: 'imports-production-symbol',
    basis: 'import-specifier-scan',
    provenance: 'import-specifier-scan:named-import',
  }
}

function commandEntry(): TestCommandEvidenceEntry {
  return {
    commandText: 'vitest run src/orderProcessor.spec.ts',
    commandSource: 'package.json script "test" + discovered related test file(s)',
    testFiles: ['src/orderProcessor.spec.ts'],
    framework: 'vitest',
    scope: 'file',
    basis: 'Related test file(s) discovered via graph import/call edges.',
  }
}

function emptyTestInfra(overrides: Partial<TestInfrastructureSummary> = {}): TestInfrastructureSummary {
  return {
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
    ...overrides,
  }
}

interface Scenario {
  hasProduction?: boolean
  hasContract?: boolean
  hasError?: boolean
  hasTest?: boolean
  hasCommand?: boolean
  requireTestCommandEvidence?: boolean
  criticality?: ResponsibilityCriticality
}

function buildScenario(s: Scenario): ResponsibilityMappingSummary {
  const changedSymbolItems = s.hasProduction === false ? [] : [prodSymbol()]
  const groups: EvidenceGroup[] = []
  if (s.hasContract !== false) {
    groups.push({
      id: 'implementation-contracts',
      kind: 'contracts',
      role: 'implementation',
      title: 'Contracts',
      required: true,
      items: [contractItem()],
      unresolved: [],
      warnings: [],
      limit: 10,
      availableCount: 1,
      usedCount: 1,
      truncated: false,
      droppedCount: 0,
      provenance: 'candidate-ranking',
    })
  }
  if (s.hasError) {
    groups.push({
      id: 'implementation-errors',
      kind: 'errors',
      role: 'implementation',
      title: 'Errors',
      required: false,
      items: [errorItem()],
      unresolved: [],
      warnings: [],
      limit: 10,
      availableCount: 1,
      usedCount: 1,
      truncated: false,
      droppedCount: 0,
      provenance: 'candidate-ranking',
    })
  }
  const selectedTests = s.hasTest === false ? [] : [testItem()]
  const testCommands = s.hasCommand === false ? [] : [commandEntry()]
  const responsibilityInputs: ResponsibilityInput[] = [{ id: 'resp-under-test', criticality: s.criticality ?? 'critical' }]

  return buildResponsibilityMappings({
    role: 'test-implementation',
    responsibilityInputs,
    hasSuppliedResponsibilities: true,
    requestedResponsibilityMappings: true,
    requireTestCommandEvidence: s.requireTestCommandEvidence ?? false,
    evidenceGroups: groups,
    selectedOwners: [],
    selectedContracts: [],
    selectedTests,
    testInfrastructure: emptyTestInfra({ testCommands }),
    changedSymbolItems,
    focusSymbolItems: [],
    limit: null,
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
  role: 'test-implementation',
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

function evaluate(responsibilityMappings: ResponsibilityMappingSummary, options: { requireTestCommands?: boolean } = {}) {
  return evaluateRoleAdequacy({
    role: 'test-implementation',
    baseAdequacy,
    evidenceGroups: [
      {
        id: 'production-symbols',
        kind: 'production-symbols',
        role: 'test-implementation',
        title: 'Production symbols',
        required: true,
        items: [prodSymbol()],
        unresolved: [],
        warnings: [],
        limit: 10,
        availableCount: 1,
        usedCount: 1,
        truncated: false,
        droppedCount: 0,
        provenance: 'candidate-ranking',
      },
    ],
    selectedOwners: [],
    selectedContracts: [],
    selectedTests: [testItem()],
    testInfrastructure: emptyTestInfra({ relatedTests: [testItem()] }),
    changedSurface: {
      available: true,
      diffRequested: false,
      files: [{ path: 'src/orderProcessor.ts', status: 'modified', provenance: 'caller' }],
      symbols: [],
      conflicts: [],
      warnings: [],
    },
    requestedEvidenceKindsRequireTestInfra: false,
    requestedEvidenceKindsRequireTestCommands: options.requireTestCommands ?? false,
    responsibilityMappings,
    freshness: fresh,
    truncation: noTruncation,
  })
}

describe('core responsibility evidence vs. supplemental test-command evidence (v1.12.3 Batch 3)', () => {
  it('CASE A: core complete, command absent, test-commands not requested -> mapped, with a supplemental (non-blocking) command-discovery warning', () => {
    const summary = buildScenario({ hasCommand: false, requireTestCommandEvidence: false })
    const mapping = summary.mappings[0]
    expect(mapping.mappingStatus).toBe('mapped')
    expect(mapping.unresolvedReasons).toEqual([])
    expect(mapping.warnings.some((w) => w.toLowerCase().includes('test execution command was not discovered'))).toBe(true)
  })

  it('CASE B: core complete, command absent, test-commands explicitly requested -> incomplete, command evidence required', () => {
    const summary = buildScenario({ hasCommand: false, requireTestCommandEvidence: true })
    const mapping = summary.mappings[0]
    expect(mapping.mappingStatus).toBe('partially-mapped')
    expect(mapping.unresolvedReasons).toContain('no test command')
  })

  it('CASE C: core complete, grounded command discovered -> mapped, command populated with provenance, regardless of whether test-commands was requested', () => {
    for (const requireTestCommandEvidence of [false, true]) {
      const summary = buildScenario({ hasCommand: true, requireTestCommandEvidence })
      const mapping = summary.mappings[0]
      expect(mapping.mappingStatus).toBe('mapped')
      expect(mapping.testCommands.length).toBeGreaterThan(0)
      expect(mapping.testCommands[0].provenance).toBe('package.json script "test" + discovered related test file(s)')
      expect(mapping.unresolvedReasons).toEqual([])
      expect(mapping.warnings).toEqual([])
    }
  })

  it('CASE D: core incomplete (no production symbol), command present -> remains incomplete; command does not substitute for missing production evidence', () => {
    const summary = buildScenario({ hasProduction: false, hasCommand: true, requireTestCommandEvidence: false })
    const mapping = summary.mappings[0]
    expect(mapping.mappingStatus).not.toBe('mapped')
    expect(mapping.unresolvedReasons).toContain('no production symbol')
  })

  it('CASE E: core incomplete (no production symbol), command absent -> remains incomplete, critical still blocking', () => {
    const summary = buildScenario({ hasProduction: false, hasCommand: false, requireTestCommandEvidence: false })
    const mapping = summary.mappings[0]
    expect(mapping.mappingStatus).not.toBe('mapped')
    expect(mapping.unresolvedReasons).toContain('no production symbol')
  })

  it('negative control: missing contract/validator/error evidence -> incomplete even with production, test, and command present', () => {
    const summary = buildScenario({ hasContract: false, hasCommand: true, requireTestCommandEvidence: false })
    const mapping = summary.mappings[0]
    expect(mapping.mappingStatus).not.toBe('mapped')
    expect(mapping.unresolvedReasons).toContain('no contract, validator, or error evidence')
  })

  it('negative control: missing related test evidence -> incomplete, isolated from independently-satisfied oracle evidence (errors group)', () => {
    // Oracle evidence is derived from *both* error-shaped evidence and existing-test
    // evidence (buildOracleEvidence). Supplying an independent error item here isolates
    // "test evidence missing" from "oracle evidence missing" (the two are otherwise
    // coupled: an existing test always also contributes oracle evidence).
    const summary = buildScenario({ hasTest: false, hasError: true, hasCommand: true, requireTestCommandEvidence: false })
    const mapping = summary.mappings[0]
    expect(mapping.mappingStatus).not.toBe('mapped')
    expect(mapping.unresolvedReasons).toContain('no related test')
    expect(mapping.unresolvedReasons).not.toContain('no oracle evidence')
  })

  it('negative control: command present but production AND test/oracle evidence missing -> command cannot substitute for either', () => {
    const summary = buildScenario({ hasProduction: false, hasTest: false, hasCommand: true, requireTestCommandEvidence: false })
    const mapping = summary.mappings[0]
    expect(mapping.mappingStatus).not.toBe('mapped')
    expect(mapping.unresolvedReasons).toContain('no production symbol')
    expect(mapping.unresolvedReasons).toContain('no related test')
    expect(mapping.unresolvedReasons).toContain('no oracle evidence')
  })

  it('noncritical responsibility: current noncritical semantics are preserved (no blocking either before or after this fix)', () => {
    const summary = buildScenario({ hasCommand: false, requireTestCommandEvidence: false, criticality: 'noncritical' })
    expect(summary.mappings[0].mappingStatus).toBe('mapped')
    const result = evaluate(summary)
    expect(result.status).toBe('context sufficient for implementation')
    expect(result.warnings.some((w) => w.includes('Noncritical responsibility mapping gap'))).toBe(false)
  })

  it('readiness consistency: critical responsibility, core complete, command absent, test-commands NOT requested -> role adequacy stays sufficient with no missing/blocking conditions (the false blocker is fixed end to end)', () => {
    const summary = buildScenario({ hasCommand: false, requireTestCommandEvidence: false, criticality: 'critical' })
    expect(summary.mappings[0].mappingStatus).toBe('mapped')
    const result = evaluate(summary, { requireTestCommands: false })
    expect(result.status).toBe('context sufficient for implementation')
    expect(result.missingConditions).toEqual([])
    expect(result.blockingConditions).toEqual([])
  })

  it('readiness consistency: critical responsibility, core complete, command absent, test-commands explicitly requested -> role adequacy is downgraded and the gap is reported', () => {
    const summary = buildScenario({ hasCommand: false, requireTestCommandEvidence: true, criticality: 'critical' })
    expect(summary.mappings[0].mappingStatus).toBe('partially-mapped')
    const result = evaluate(summary, { requireTestCommands: true })
    expect(result.status).toBe('context insufficient and more retrieval required')
    expect(result.missingConditions).toContain('critical responsibility partially mapped')
  })
})
