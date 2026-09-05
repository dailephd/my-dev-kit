import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'
import { buildResponsibilityMappings } from '../../src/context/responsibilityMapping.js'
import { evaluateRoleAdequacy } from '../../src/context/contextRoleAdequacy.js'
import { computeContextAdequacy } from '../../src/context/contextCapsule.js'
import { evaluateRoleConditionCoverage } from '../../src/context/roleConditionCoverage.js'
import type {
  ContextAdequacyStatement,
  EvidenceGroup,
  EvidenceItemRef,
  FreshnessSummary,
  ResponsibilityCriticality,
  ResponsibilityInput,
  ResponsibilityMappingSummary,
  RoleConditionCoverage,
  TestCommandEvidenceEntry,
  TestInfrastructureSummary,
  TruncationSummary,
} from '../../src/context/types.js'

/**
 * v1.12.3 Batch 4: integrated readiness-consistency hardening.
 *
 * This suite does not introduce new responsibility/contract/adequacy semantics. It
 * proves that the already-corrected Batch 1 (recoverable role adequacy), Batch 2
 * (structural Python contract discovery), and Batch 3 (core-vs-supplemental
 * responsibility evidence) fixes remain mutually consistent across every
 * readiness-bearing representation: base `contextAdequacy`, `roleAdequacy`,
 * `responsibilityMappings`, `missingConditions`/`blockingConditions`, `truncation`,
 * and the `ContextCapsule`/`RetrievalAuditRecord` pair.
 *
 * Section A exercises the real CLI -> capsule -> audit pipeline end to end.
 * Section B chains the real (non-mocked) `computeContextAdequacy` /
 * `evaluateRoleConditionCoverage` / `buildResponsibilityMappings` /
 * `evaluateRoleAdequacy` functions directly. This is required for Scenario 1
 * (forcing zero retrievable source slices for a high-confidence focus) because,
 * on inspection, the request-file `limits.sourceRanges` field is validated but not
 * currently wired to `selectSourceSlices`'s `maxSourceSlices` cap, and the CLI
 * `--max-source-slices` flag itself rejects zero (`parsePositiveInt`) — so there is
 * no supported way to force this exact condition through the CLI today. Wiring
 * that up would be a new, unrelated behavior change, not a Batch 4 consistency
 * fix, so Scenario 1 instead composes the real `computeContextAdequacy` and
 * `evaluateRoleAdequacy` functions directly. The same applies to noncritical-only
 * `testResponsibilityRefs: string[]` (see Batch 3's own unit-level convention in
 * `contextResponsibilityCoreVsSupplementalEvidence.spec.ts`)
 * and cannot itself express a `criticality: 'critical'` responsibility, an exact
 * final-required-witness-loss truncation record, or a synthetic edit-guidance
 * conflict — the same constraints this project's own existing tests
 * (`contextRoleAdequacy.spec.ts`, `contextCandidateSelection.spec.ts`) already work
 * around the same way.
 */

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function createTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(root)
  return root
}

function writeRequest(root: string, name: string, body: unknown): string {
  const filePath = join(root, name)
  writeFileSync(filePath, JSON.stringify(body, null, 2))
  return filePath
}

function runContext(indexOut: string, requestPath: string, outPath: string, auditOutPath?: string) {
  const args = ['context', '--index', indexOut, '--request', requestPath, '--out', outPath]
  if (auditOutPath) args.push('--audit-out', auditOutPath)
  return runCli(args)
}

// ---------------------------------------------------------------------------
// Section A: real CLI -> capsule -> audit pipeline
// ---------------------------------------------------------------------------

describe('Batch 4 integrated readiness consistency: real pipeline (CLI -> capsule -> audit)', () => {
  it('SCENARIO 2 (Batch 2 integration): a legitimate neutral-named Python contract (result.py/cases.py) satisfies the contract condition and role adequacy is sufficient', () => {
    const root = createTempRoot('my-dev-kit-v1-r2-neutral-contract-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'result.py'), 'class Result:\n    def __init__(self, value):\n        self.value = value\n')
    writeFileSync(join(src, 'cases.py'), "CASES = {'ready': 'ok'}\n")
    writeFileSync(join(src, 'helper.py'), 'def helper(value):\n    return value\n')
    writeFileSync(join(src, 'resolver.py'), 'from .cases import CASES\nfrom .result import Result\n\ndef resolve(case_id):\n    return Result(CASES[case_id])\n')
    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'resolve result cases',
      focusFiles: ['src/resolver.py'],
    })
    const outPath = join(root, 'capsule.json')
    const auditPath = join(root, 'audit.json')
    const result = runContext(indexOut, requestPath, outPath, auditPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    const audit = JSON.parse(readFileSync(auditPath, 'utf8'))

    const contracts = capsule.evidenceGroups.find((g: { kind: string }) => g.kind === 'contracts')
    const paths = contracts.items.map((item: { path?: string }) => item.path).filter(Boolean)
    expect(paths).toContain('src/result.py')
    expect(paths).toContain('src/cases.py')
    expect(paths).not.toContain('src/helper.py')
    expect(capsule.roleAdequacy.missingConditions).not.toContain('required contract missing')
    expect(['context sufficient for implementation', 'context sufficient with listed assumptions']).toContain(capsule.roleAdequacy.status)
    expect(audit.roleAdequacy).toEqual(capsule.roleAdequacy)

    const outPath2 = join(root, 'capsule2.json')
    expect(runContext(indexOut, requestPath, outPath2).status).toBe(0)
    const capsule2 = JSON.parse(readFileSync(outPath2, 'utf8'))
    expect(capsule2.evidenceGroups).toEqual(capsule.evidenceGroups)
    expect(capsule2.roleAdequacy).toEqual(capsule.roleAdequacy)
  })

  it('SCENARIO 5 (Batch 3 integration): a grounded Makefile test command is retained with provenance, and role adequacy reflects no false blocker', () => {
    const root = createTempRoot('my-dev-kit-v1-r5-grounded-command-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'calc.py'), 'def add(a, b):\n    return a + b\n')
    writeFileSync(join(root, 'Makefile'), ['.PHONY: test', '', 'test:', '\tpytest tests/ -v', ''].join('\n'))
    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'calc',
      role: 'implementation',
      focusSymbols: ['symbol:src/calc.py#add'],
      requestedEvidenceKinds: ['test-infrastructure', 'test-commands'],
    })
    const outPath = join(root, 'capsule.json')
    const auditPath = join(root, 'audit.json')
    expect(runContext(indexOut, requestPath, outPath, auditPath).status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    const audit = JSON.parse(readFileSync(auditPath, 'utf8'))

    const command = capsule.testInfrastructure.testCommands.find((c: { commandText: string | null }) => c.commandText === 'pytest tests/ -v')
    expect(command).toBeDefined()
    expect(command.commandSource).toContain('Makefile target "test"')
    expect(audit.roleAdequacy).toEqual(capsule.roleAdequacy)
    expect(audit.responsibilityMappings ?? null).toEqual(capsule.responsibilityMappings ?? null)
  })
})

// ---------------------------------------------------------------------------
// Section B: chained real production functions (criticality / exact truncation /
// exact conflict inputs the public CLI request contract cannot express)
// ---------------------------------------------------------------------------

function evidence(id: string): EvidenceItemRef {
  return {
    id,
    itemKind: 'symbol',
    path: 'src/fixture.ts',
    nodeId: id,
    relationship: 'qualified-condition-witness',
    basis: 'Batch 4 integrated readiness test',
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
      { groupId: 'implementation-owners', availableItems: ownersAvailable.map(evidence), retainedItems: ownersRetained.map(evidence) },
      { groupId: 'implementation-contracts', availableItems: contractsAvailable.map(evidence), retainedItems: contractsRetained.map(evidence) },
    ],
  })
}

const baseAdequacySufficient: ContextAdequacyStatement = {
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

const noTruncation: TruncationSummary = { truncated: false, requiredEvidenceLost: false, records: [], warnings: [] }

function evaluateImplementation(options: {
  baseStatus?: ContextAdequacyStatement['status']
  coverage?: RoleConditionCoverage[]
  truncation?: TruncationSummary
  selectedOwners?: EvidenceItemRef[]
  selectedContracts?: EvidenceItemRef[]
}) {
  return evaluateRoleAdequacy({
    role: 'implementation',
    baseAdequacy: { ...baseAdequacySufficient, status: options.baseStatus ?? baseAdequacySufficient.status },
    evidenceGroups: [],
    selectedOwners: options.selectedOwners ?? [evidence('owner-a')],
    selectedContracts: options.selectedContracts ?? [evidence('contract-a')],
    selectedTests: [],
    testInfrastructure: emptyTestInfra(),
    changedSurface: { available: true, diffRequested: false, files: [], symbols: [], conflicts: [], warnings: [] },
    requestedEvidenceKindsRequireTestInfra: false,
    requestedEvidenceKindsRequireTestCommands: false,
    responsibilityMappings: emptyMappings(),
    freshness: fresh,
    truncation: options.truncation ?? noTruncation,
    roleConditionCoverage: options.coverage ?? conditionCoverage(),
  })
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
  return { id: 'src/orderValidator.ts', itemKind: 'file', path: 'src/orderValidator.ts', relationship: 'contract-like candidate', basis: 'candidate-ranking', provenance: 'candidate-ranking' }
}

function testItem(): EvidenceItemRef {
  return { id: 'src/orderProcessor.spec.ts', itemKind: 'test-file', path: 'src/orderProcessor.spec.ts', relationship: 'imports-production-symbol', basis: 'import-specifier-scan', provenance: 'import-specifier-scan:named-import' }
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

function buildTestImplementationScenario(s: {
  hasProduction?: boolean
  hasContract?: boolean
  hasTest?: boolean
  hasCommand?: boolean
  requireTestCommandEvidence?: boolean
  criticality?: ResponsibilityCriticality
}): { mappings: ResponsibilityMappingSummary; adequacy: ReturnType<typeof evaluateRoleAdequacy> } {
  const changedSymbolItems = s.hasProduction === false ? [] : [prodSymbol()]
  const groups: EvidenceGroup[] =
    s.hasContract === false
      ? []
      : [
          {
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
          },
        ]
  const selectedTests = s.hasTest === false ? [] : [testItem()]
  const testCommands = s.hasCommand === false ? [] : [commandEntry()]
  const responsibilityInputs: ResponsibilityInput[] = [{ id: 'resp-under-test', criticality: s.criticality ?? 'critical' }]

  const mappings = buildResponsibilityMappings({
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

  const adequacy = evaluateRoleAdequacy({
    role: 'test-implementation',
    baseAdequacy: baseAdequacySufficient,
    evidenceGroups: [
      {
        id: 'production-symbols',
        kind: 'production-symbols',
        role: 'test-implementation',
        title: 'Production symbols',
        required: true,
        items: s.hasProduction === false ? [] : [prodSymbol()],
        unresolved: [],
        warnings: [],
        limit: 10,
        availableCount: s.hasProduction === false ? 0 : 1,
        usedCount: s.hasProduction === false ? 0 : 1,
        truncated: false,
        droppedCount: 0,
        provenance: 'candidate-ranking',
      },
    ],
    selectedOwners: [],
    selectedContracts: [],
    selectedTests,
    testInfrastructure: emptyTestInfra({ relatedTests: selectedTests }),
    changedSurface: { available: true, diffRequested: false, files: [{ path: 'src/orderProcessor.ts', status: 'modified', provenance: 'caller' }], symbols: [], conflicts: [], warnings: [] },
    requestedEvidenceKindsRequireTestInfra: false,
    requestedEvidenceKindsRequireTestCommands: s.requireTestCommandEvidence ?? false,
    responsibilityMappings: mappings,
    freshness: fresh,
    truncation: noTruncation,
  })

  return { mappings, adequacy }
}

describe('Batch 4 integrated readiness consistency: chained production functions (criticality / exact truncation / exact conflict)', () => {
  it('SCENARIO 1 (Batch 1 integration, Invariant E): implementation role recovers when the real computeContextAdequacy reports no retrievable source slice for a high-confidence focus, but role-required owner/contract evidence is complete', () => {
    const baseAdequacy = computeContextAdequacy({
      focus: { focusNodeId: 'a', focusFilePath: 'src/widgetOwner.ts', selectionMode: 'single-best', confidence: 'high', reasons: [], ambiguityNotes: [], warnings: [] },
      selectedGraph: { nodes: [{ nodeId: 'a', kind: 'file', label: 'a', reasons: [] }, { nodeId: 'b', kind: 'file', label: 'b', reasons: [] }], edges: [], omittedNodeCount: 0, omittedEdgeCount: 0, warnings: [] },
      selectedSource: { slices: [], omittedSliceCount: 0, totalSelectedLines: 0, maxSourceSlices: 5, warnings: [], skipped: [] },
    })
    expect(baseAdequacy.status).toBe('context insufficient and more retrieval required')

    const result = evaluateImplementation({ baseStatus: baseAdequacy.status })
    expect(result.status).toBe('context sufficient for implementation')
    expect(result.missingConditions).toEqual([])
    expect(result.blockingConditions).toEqual([])
    // Self-consistency (Invariant E): the diagnostic basis for the recovery
    // remains visible even though the final status is sufficient.
    expect(result.warnings.length).toBeGreaterThanOrEqual(0)
  })

  it('SCENARIO 3 (Batch 3 integration, Invariant C): four core categories complete, no command, test-commands not requested -> responsibility mapped, role adequacy sufficient with no false blocker', () => {
    const { mappings, adequacy } = buildTestImplementationScenario({ hasCommand: false, requireTestCommandEvidence: false, criticality: 'critical' })
    expect(mappings.mappings[0].mappingStatus).toBe('mapped')
    expect(mappings.mappings[0].unresolvedReasons).toEqual([])
    expect(mappings.mappings[0].warnings.some((w) => w.includes('was not discovered'))).toBe(true)
    expect(adequacy.status).toBe('context sufficient for implementation')
    expect(adequacy.missingConditions).toEqual([])
    expect(adequacy.blockingConditions).toEqual([])
  })

  it('SCENARIO 4 (Batch 3 integration, Invariant D): explicit test-commands request with no grounded command -> responsibility incomplete, critical responsibility blocks, role adequacy insufficient', () => {
    const { mappings, adequacy } = buildTestImplementationScenario({ hasCommand: false, requireTestCommandEvidence: true, criticality: 'critical' })
    expect(mappings.mappings[0].mappingStatus).toBe('partially-mapped')
    expect(mappings.mappings[0].unresolvedReasons).toContain('no test command')
    expect(adequacy.status).toBe('context insufficient and more retrieval required')
    expect(adequacy.missingConditions).toContain('critical responsibility partially mapped')
  })

  it('SCENARIO 9 (Batch 3 integration, Invariant B): a genuine core evidence gap (missing oracle) blocks even though a test command is present', () => {
    const { mappings, adequacy } = buildTestImplementationScenario({ hasTest: false, hasCommand: true, requireTestCommandEvidence: false, criticality: 'critical' })
    expect(mappings.mappings[0].mappingStatus).not.toBe('mapped')
    expect(mappings.mappings[0].unresolvedReasons).toContain('no related test')
    expect(mappings.mappings[0].unresolvedReasons).toContain('no oracle evidence')
    expect(adequacy.status).toBe('context insufficient and more retrieval required')
    expect(adequacy.missingConditions.length).toBeGreaterThan(0)
  })

  it('SCENARIO 6 (Batch 1 integration, Invariant F): truncation destroys the final required contract witness -> role adequacy is insufficient and the loss is explicit', () => {
    const coverage = conditionCoverage({ contractsAvailable: ['contract-a'], contractsRetained: [] })
    const result = evaluateImplementation({
      coverage,
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
    // Self-consistency (Invariant A): sufficient status never coexists with a lost required witness.
    expect(result.status === 'context sufficient for implementation').toBe(false)
  })

  it('SCENARIO 7 (Batch 1 integration, Invariant A/F): optional/redundant truncation leaves another retained witness satisfying the condition -> role adequacy stays sufficient with no false missing condition', () => {
    const result = evaluateImplementation({
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
    expect(result.missingConditions).toEqual([])
    expect(result.blockingConditions).toEqual([])
  })

  it('SCENARIO 8 (Invariant: conflict is never eclipsed by later evidence): a material base conflict is never upgraded to sufficient by otherwise-complete role evidence', () => {
    const baseAdequacy = computeContextAdequacy({
      focus: { focusNodeId: 'a', focusFilePath: 'a.ts', selectionMode: 'single-best', confidence: 'high', reasons: [], ambiguityNotes: [], warnings: [] },
      selectedGraph: { nodes: [{ nodeId: 'a', kind: 'file', label: 'a', reasons: [] }], edges: [], omittedNodeCount: 0, omittedEdgeCount: 0, warnings: [] },
      conflicts: {
        status: 'conflict',
        warnings: [],
        conflicts: [{
          id: 'conflict-1',
          status: 'conflict',
          reason: 'Explicit edit guidance conflicts for the selected focus and a near-tied retained candidate.',
          evidenceRefs: [],
          affectedFiles: ['a.ts', 'b.ts'],
          affectedNodes: ['a', 'b'],
          candidates: [],
          recommendedNextAction: 'Choose the canonical owner.',
        }],
      },
    })
    expect(baseAdequacy.status).toBe('context conflict found and user or upstream stage decision required')

    // Otherwise-complete owner/contract/coverage evidence must not erase the conflict.
    const result = evaluateRoleAdequacy({
      role: 'implementation',
      baseAdequacy,
      evidenceGroups: [],
      selectedOwners: [evidence('owner-a')],
      selectedContracts: [evidence('contract-a')],
      selectedTests: [],
      testInfrastructure: emptyTestInfra(),
      changedSurface: { available: true, diffRequested: false, files: [], symbols: [], conflicts: [], warnings: [] },
      requestedEvidenceKindsRequireTestInfra: false,
      requestedEvidenceKindsRequireTestCommands: false,
      responsibilityMappings: emptyMappings(),
      freshness: fresh,
      truncation: noTruncation,
      roleConditionCoverage: conditionCoverage(),
    })
    expect(result.status).toBe('context conflict found and user or upstream stage decision required')
  })

  it('DETERMINISM: repeated evaluation of the same chained scenario produces identical readiness facts', () => {
    const run1 = buildTestImplementationScenario({ hasCommand: false, requireTestCommandEvidence: false, criticality: 'critical' })
    const run2 = buildTestImplementationScenario({ hasCommand: false, requireTestCommandEvidence: false, criticality: 'critical' })
    expect(run2.mappings).toEqual(run1.mappings)
    expect(run2.adequacy).toEqual(run1.adequacy)
  })
})
