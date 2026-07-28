/**
 * v1.10.1 Batch 4: deterministic test-responsibility mapping (sections 9-19).
 *
 * Operationalizes `ContextRequest.testResponsibilityRefs` (currently `string[]`,
 * see `types.ts`) and the `responsibility-mappings` requested-evidence kind.
 * Uses only explicit static evidence already produced by Batch 2/3: changed-surface
 * symbols/files, resolved focus symbols, evidence-group membership (owners,
 * contracts, validators/constants, errors/side-effects), and bounded
 * test-infrastructure discovery (related tests, fixtures/factories/mocks/setup
 * files, test commands). No LLM reasoning, no embedding similarity, no fuzzy
 * filename matching, no runtime execution.
 */
import { CONSTANT_PATTERN, ERROR_PATTERN, SIDE_EFFECT_PATTERN, VALIDATOR_PATTERN } from './evidencePatterns.js'
import type {
  ContextRole,
  EvidenceGroup,
  EvidenceItemRef,
  ProvenanceRecord,
  ResponsibilityCriticality,
  ResponsibilityInput,
  ResponsibilityMapping,
  ResponsibilityMappingStatus,
  ResponsibilityMappingSummary,
  TestCommandEvidenceEntry,
  TestInfrastructureSummary,
} from './types.js'
import { buildProvenanceRecords } from './contextProvenance.js'

const DEFAULT_RESPONSIBILITY_MAPPING_LIMIT = 25

/** Normalizes `ContextRequest.testResponsibilityRefs` (`string[]`, section 9.1) into
 * `ResponsibilityInput[]` with the documented safe default: `criticality: 'noncritical'`
 * unless the caller uses the richer `ResponsibilityInput[]` form directly (unit tests /
 * a future structured contract). Criticality is never inferred from string content. */
export function normalizeResponsibilityRefs(refs: string[]): ResponsibilityInput[] {
  return refs.map((id) => ({ id, criticality: 'noncritical' as const }))
}

interface ResolvedResponsibilityInputs {
  inputs: ResponsibilityInput[]
  duplicateResponsibilityIds: string[]
  warnings: string[]
}

/** Rejects duplicate responsibility IDs deterministically: the first occurrence wins,
 * later duplicates are dropped and reported (TST-B4-005). `contextRequestNormalization.ts`
 * no longer sorts/dedupes `testResponsibilityRefs` (v1.10.3 Batch 3, F-004), so this is
 * now the sole point where duplicates are both detected and resolved for the public
 * request-file path, not just a defensive second boundary for direct callers.
 * `duplicateResponsibilityIds` preserves first-*duplicate*-occurrence order (the order in
 * which each ID was seen for the second time), deliberately not alphabetically sorted, so
 * it stays meaningful relative to the caller's original sequence (section 17.3). An ID
 * repeated more than twice is still reported only once (the `Set` below). */
function dedupeResponsibilityInputs(inputs: ResponsibilityInput[]): ResolvedResponsibilityInputs {
  const seen = new Map<string, ResponsibilityInput>()
  const duplicateResponsibilityIds: string[] = []
  const warnings: string[] = []
  for (const input of inputs) {
    if (seen.has(input.id)) {
      duplicateResponsibilityIds.push(input.id)
      warnings.push(`Duplicate responsibility ID "${input.id}" was rejected; only the first occurrence is mapped.`)
      continue
    }
    seen.set(input.id, input)
  }
  return { inputs: [...seen.values()], duplicateResponsibilityIds: [...new Set(duplicateResponsibilityIds)], warnings }
}

function findGroup(groups: EvidenceGroup[], kind: EvidenceGroup['kind']): EvidenceGroup | undefined {
  return groups.find((g) => g.kind === kind)
}

function itemsMatching(items: EvidenceItemRef[], pattern: RegExp): EvidenceItemRef[] {
  return items.filter((i) => pattern.test(i.path ?? i.id))
}

export interface BuildResponsibilityMappingsOptions {
  role: ContextRole | null
  responsibilityInputs: ResponsibilityInput[]
  /** True only when the caller supplied at least one `testResponsibilityRefs` entry. */
  hasSuppliedResponsibilities: boolean
  requestedResponsibilityMappings: boolean
  evidenceGroups: EvidenceGroup[]
  selectedOwners: EvidenceItemRef[]
  selectedContracts: EvidenceItemRef[]
  selectedTests: EvidenceItemRef[]
  testInfrastructure: TestInfrastructureSummary
  changedSymbolItems: EvidenceItemRef[]
  focusSymbolItems: EvidenceItemRef[]
  limit: number | null
}

function commandsToEvidence(commands: TestCommandEvidenceEntry[]): EvidenceItemRef[] {
  return commands
    .filter((c) => c.commandText !== null)
    .map((c) => ({
      id: c.commandText as string,
      itemKind: 'command' as const,
      relationship: c.scope,
      basis: c.basis,
      provenance: c.commandSource,
      metadata: { framework: c.framework, scope: c.scope },
    }))
}

/** Section 13: production-symbol resolution order. Caller-supplied exact symbol
 * references are not distinguishable per-responsibility in the current string-ID-only
 * `testResponsibilityRefs` contract, so this shared, request-scoped evidence set applies
 * to every responsibility (never fabricated per-ID linkage). */
function resolveProductionSymbols(options: {
  changedSymbolItems: EvidenceItemRef[]
  focusSymbolItems: EvidenceItemRef[]
  selectedOwners: EvidenceItemRef[]
  selectedContracts: EvidenceItemRef[]
}): EvidenceItemRef[] {
  if (options.changedSymbolItems.length > 0) return options.changedSymbolItems
  if (options.focusSymbolItems.length > 0) return options.focusSymbolItems
  return [...options.selectedOwners, ...options.selectedContracts]
}

function buildOracleEvidence(options: {
  errors: EvidenceItemRef[]
  schemas: EvidenceItemRef[]
  testCommands: EvidenceItemRef[]
  existingTests: EvidenceItemRef[]
}): EvidenceItemRef[] {
  const oracle: EvidenceItemRef[] = []
  for (const item of options.errors) {
    oracle.push({ ...item, relationship: `oracle:error-type (${item.relationship})`, metadata: { ...item.metadata, oracleKind: 'error-type' } })
  }
  for (const item of options.schemas) {
    oracle.push({ ...item, relationship: `oracle:emitted-artifact-shape (${item.relationship})`, metadata: { ...item.metadata, oracleKind: 'emitted-artifact-shape' } })
  }
  for (const item of options.testCommands) {
    oracle.push({ ...item, relationship: `oracle:exit-code (${item.relationship})`, metadata: { ...item.metadata, oracleKind: 'exit-code' } })
  }
  for (const item of options.existingTests) {
    oracle.push({
      id: `oracle:${item.id}`,
      itemKind: 'test-file',
      path: item.path,
      relationship: 'oracle:existing-test-assertions (static reference only; no assertion generated)',
      basis: item.basis,
      provenance: item.provenance,
      metadata: { oracleKind: 'existing-test-assertions' },
    })
  }
  return oracle
}

const REQUIRED_CATEGORIES = ['productionSymbols', 'contractOrValidatorOrErrorEvidence', 'proposedOrExistingTestFiles', 'oracleEvidence', 'testCommands'] as const

function determineStatus(mapping: {
  productionSymbols: EvidenceItemRef[]
  contracts: EvidenceItemRef[]
  validators: EvidenceItemRef[]
  constants: EvidenceItemRef[]
  errors: EvidenceItemRef[]
  proposedOrExistingTestFiles: EvidenceItemRef[]
  oracleEvidence: EvidenceItemRef[]
  testCommands: EvidenceItemRef[]
}): { status: ResponsibilityMappingStatus; unresolvedReasons: string[] } {
  const contractLike = mapping.contracts.length + mapping.validators.length + mapping.constants.length + mapping.errors.length > 0
  const satisfied = {
    productionSymbols: mapping.productionSymbols.length > 0,
    contractOrValidatorOrErrorEvidence: contractLike,
    proposedOrExistingTestFiles: mapping.proposedOrExistingTestFiles.length > 0,
    oracleEvidence: mapping.oracleEvidence.length > 0,
    testCommands: mapping.testCommands.length > 0,
  }
  const satisfiedCount = Object.values(satisfied).filter(Boolean).length
  const unresolvedReasons: string[] = []
  if (!satisfied.productionSymbols) unresolvedReasons.push('no production symbol')
  if (!satisfied.contractOrValidatorOrErrorEvidence) unresolvedReasons.push('no contract, validator, or error evidence')
  if (!satisfied.proposedOrExistingTestFiles) unresolvedReasons.push('no related test')
  if (!satisfied.oracleEvidence) unresolvedReasons.push('no oracle evidence')
  if (!satisfied.testCommands) unresolvedReasons.push('no test command')

  if (satisfiedCount === REQUIRED_CATEGORIES.length) return { status: 'mapped', unresolvedReasons: [] }
  if (satisfiedCount === 0) return { status: 'unmapped', unresolvedReasons }
  return { status: 'partially-mapped', unresolvedReasons }
}

export function buildResponsibilityMappings(options: BuildResponsibilityMappingsOptions): ResponsibilityMappingSummary {
  const {
    role,
    responsibilityInputs,
    hasSuppliedResponsibilities,
    requestedResponsibilityMappings,
    evidenceGroups,
    selectedOwners,
    selectedContracts,
    selectedTests,
    testInfrastructure,
    changedSymbolItems,
    focusSymbolItems,
    limit,
  } = options

  const { inputs, duplicateResponsibilityIds, warnings } = dedupeResponsibilityInputs(responsibilityInputs)

  if (!hasSuppliedResponsibilities || inputs.length === 0) {
    return {
      requested: requestedResponsibilityMappings,
      operational: false,
      mappings: [],
      unknownResponsibilityIds: [],
      duplicateResponsibilityIds,
      limit: limit ?? DEFAULT_RESPONSIBILITY_MAPPING_LIMIT,
      availableCount: 0,
      usedCount: 0,
      truncated: false,
      droppedCount: 0,
      criticalDropped: false,
      warnings,
    }
  }

  const contractsGroup = findGroup(evidenceGroups, 'contracts')
  const validatorsGroup = findGroup(evidenceGroups, 'validators-and-constants') ?? findGroup(evidenceGroups, 'validators-and-boundaries')
  const errorsGroup = findGroup(evidenceGroups, 'errors') ?? findGroup(evidenceGroups, 'errors-and-side-effects')
  const schemasGroup = findGroup(evidenceGroups, 'schemas-and-serializers')

  const contractItems = contractsGroup?.items ?? selectedContracts
  const validatorAndConstantItems = validatorsGroup?.items ?? []
  const errorAndSideEffectItems = errorsGroup?.items ?? []
  const validators = itemsMatching(validatorAndConstantItems, VALIDATOR_PATTERN)
  const constants = itemsMatching(validatorAndConstantItems, CONSTANT_PATTERN)
  const errors = itemsMatching(errorAndSideEffectItems, ERROR_PATTERN)
  const sideEffectEvidence = itemsMatching(errorAndSideEffectItems, SIDE_EFFECT_PATTERN)
  const schemas = schemasGroup?.items ?? []

  const productionSymbols = resolveProductionSymbols({ changedSymbolItems, focusSymbolItems, selectedOwners, selectedContracts })

  const existingTests = selectedTests.length > 0 ? selectedTests : testInfrastructure.relatedTests
  const proposedOrExistingTestFiles = existingTests.map((t) => ({ ...t, relationship: selectedTests.length > 0 || testInfrastructure.relatedTests.length > 0 ? `existing: ${t.relationship}` : `proposed: ${t.relationship}` }))

  const reusableHelpers = [...testInfrastructure.fixtures, ...testInfrastructure.factories, ...testInfrastructure.mocks, ...testInfrastructure.setupFiles]
  const testCommandItems = commandsToEvidence(testInfrastructure.testCommands)
  const oracleEvidence = buildOracleEvidence({ errors, schemas, testCommands: testCommandItems, existingTests })

  const unknownResponsibilityIds: string[] = []
  const mappings: ResponsibilityMapping[] = []

  for (const input of inputs) {
    if (input.notApplicable) {
      mappings.push({
        responsibilityId: input.id,
        behavior: input.behavior ?? null,
        invariant: input.invariant ?? null,
        criticality: input.criticality ?? 'noncritical',
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
        mappingStatus: 'not-applicable',
        unresolvedReasons: [],
        provenance: [],
        warnings: [],
      })
      continue
    }

    const { status, unresolvedReasons } = determineStatus({
      productionSymbols,
      contracts: contractItems,
      validators,
      constants,
      errors,
      proposedOrExistingTestFiles,
      oracleEvidence,
      testCommands: testCommandItems,
    })
    if (status === 'unmapped') unknownResponsibilityIds.push(input.id)

    const provenance: ProvenanceRecord[] = buildProvenanceRecords([
      { items: productionSymbols, role, requestField: 'testResponsibilityRefs', derivedByModule: 'responsibilityMapping.ts' },
      { items: contractItems, role, requestField: 'testResponsibilityRefs', derivedByModule: 'responsibilityMapping.ts' },
      { items: proposedOrExistingTestFiles, role, requestField: 'testResponsibilityRefs', derivedByModule: 'responsibilityMapping.ts' },
      { items: oracleEvidence, role, requestField: 'testResponsibilityRefs', derivedByModule: 'responsibilityMapping.ts' },
      { items: testCommandItems, role, requestField: 'testResponsibilityRefs', derivedByModule: 'responsibilityMapping.ts' },
    ])

    mappings.push({
      responsibilityId: input.id,
      behavior: input.behavior ?? null,
      invariant: input.invariant ?? null,
      criticality: input.criticality ?? 'noncritical',
      productionSymbols,
      contracts: contractItems,
      validators,
      constants,
      errors,
      sideEffectEvidence,
      proposedOrExistingTestFiles,
      reusableHelpers,
      oracleEvidence,
      testCommands: testCommandItems,
      mappingStatus: status,
      unresolvedReasons,
      provenance,
      warnings: [],
    })
  }

  // Deterministic truncation order (section 25.2): critical responsibilities are
  // preserved ahead of noncritical ones; ties break on responsibilityId. This means
  // a bounded `responsibilityMappings` limit can only ever drop a critical
  // responsibility once every critical one is already retained. This ordering decides
  // *which* mappings survive truncation only; it is not the returned order.
  const truncationOrder = [...mappings].sort((a, b) => {
    if (a.criticality !== b.criticality) return a.criticality === 'critical' ? -1 : 1
    return a.responsibilityId.localeCompare(b.responsibilityId)
  })
  const effectiveLimit = limit ?? DEFAULT_RESPONSIBILITY_MAPPING_LIMIT
  const survivingIds = new Set(truncationOrder.slice(0, effectiveLimit).map((m) => m.responsibilityId))
  // v1.10.3 Batch 3 (F-004): the returned mapping order follows the caller's
  // first-occurrence input order (`inputs`, already first-occurrence-deduped by
  // `dedupeResponsibilityInputs`), not an alphabetical resort, so that e.g.
  // `[TST-002, TST-001, TST-002, TST-003, TST-001]` maps as `[TST-002, TST-001,
  // TST-003]` rather than being silently reordered alphabetically (section 17.2).
  const bounded = mappings.filter((m) => survivingIds.has(m.responsibilityId))
  const droppedMappings = truncationOrder.slice(effectiveLimit)
  const droppedCount = droppedMappings.length
  const criticalDropped = droppedMappings.some((m) => m.criticality === 'critical')
  if (droppedCount > 0) {
    warnings.push(`${droppedCount} responsibility mapping(s) were truncated by the responsibility-mapping limit (${effectiveLimit}).`)
  }
  if (criticalDropped) {
    warnings.push('A critical responsibility mapping was dropped by the responsibility-mapping limit; this is required-evidence loss (section 25.3).')
  }

  return {
    requested: requestedResponsibilityMappings,
    operational: true,
    mappings: bounded,
    unknownResponsibilityIds: [...new Set(unknownResponsibilityIds)].sort(),
    duplicateResponsibilityIds,
    limit: effectiveLimit,
    availableCount: mappings.length,
    usedCount: bounded.length,
    truncated: droppedCount > 0,
    droppedCount,
    criticalDropped,
    warnings,
  }
}

export function criticalUnmappedResponsibilityIds(summary: ResponsibilityMappingSummary): string[] {
  return summary.mappings.filter((m) => m.criticality === 'critical' && m.mappingStatus === 'unmapped').map((m) => m.responsibilityId).sort()
}

export function criticalPartiallyMappedResponsibilityIds(summary: ResponsibilityMappingSummary): string[] {
  return summary.mappings.filter((m) => m.criticality === 'critical' && m.mappingStatus === 'partially-mapped').map((m) => m.responsibilityId).sort()
}

export function noncriticalIssueResponsibilityIds(summary: ResponsibilityMappingSummary): string[] {
  return summary.mappings
    .filter((m) => m.criticality === 'noncritical' && (m.mappingStatus === 'unmapped' || m.mappingStatus === 'partially-mapped'))
    .map((m) => m.responsibilityId)
    .sort()
}
