/**
 * v1.10.1 Batch 3: deterministic, bounded, role-scoped evidence-group construction.
 *
 * Reuses Batch 2 role-aware ranked candidates (`roleCandidates.ts`), the
 * existing selected graph neighborhood (`graphSelection.ts`), the existing
 * changed-surface model (`changedSurface.ts`), and bounded test-infrastructure
 * discovery (`testInfrastructureDiscovery.ts`). Adds no second ranking system,
 * no second graph, no new artifact: this module only organizes evidence that
 * already exists into named, capped, auditable groups.
 */
import { isContractLike, isOwnerLike, isTestLike } from './roleCandidates.js'
import { discoverTestInfrastructure, type BoundedList } from './testInfrastructureDiscovery.js'
import { CONSTANT_PATTERN, ERROR_PATTERN, SCHEMA_PATTERN, SIDE_EFFECT_PATTERN, VALIDATOR_PATTERN } from './evidencePatterns.js'
import type { CodeGraph, CodeGraphNode } from '../graph/codeGraphTypes.js'
import type { SymbolIndex } from '../symbol-index/types.js'
import type {
  CandidateFile,
  CandidateNode,
  ChangedSurface,
  ContextFocusIntake,
  ContextRole,
  EvidenceGroup,
  EvidenceGroupKind,
  EvidenceItemRef,
  GroupTruncationEntry,
  PackageScriptEvidenceEntry,
  RequestedEvidenceKind,
  SelectedGraph,
  TestCommandEvidenceEntry,
  TestConfigurationEvidenceEntry,
  TestInfrastructureSummary,
  UnresolvedEvidenceItem,
} from './types.js'

const GROUP_TITLES: Record<EvidenceGroupKind, string> = {
  owners: 'Selected owner(s)',
  'extension-points': 'Extension points',
  contracts: 'Public/shared contracts',
  'graph-neighborhood': 'Relevant graph neighborhood',
  'architecture-tests': 'Architecture/integration tests',
  dependencies: 'Direct dependencies',
  'callers-and-callees': 'Callers and callees',
  'validators-and-constants': 'Validators and constants',
  errors: 'Errors',
  'schemas-and-serializers': 'Schemas and serializers',
  'compatibility-surfaces': 'Compatibility surfaces',
  'closest-tests': 'Closest tests',
  'changed-surface': 'Changed files',
  'production-symbols': 'Changed production symbols',
  'validators-and-boundaries': 'Validators and boundaries',
  'errors-and-side-effects': 'Errors and side effects',
  'related-tests': 'Related tests',
  fixtures: 'Fixtures',
  factories: 'Factories',
  mocks: 'Mocks',
  'setup-and-configuration': 'Setup and test configuration',
  'test-commands': 'Test commands',
  'unresolved-evidence': 'Unresolved evidence',
}

interface MakeGroupOptions {
  limit: number | null
  required: boolean
  provenance: string
  unresolved?: UnresolvedEvidenceItem[]
  warnings?: string[]
  availableCountOverride?: number
}

function dedupeById(items: EvidenceItemRef[]): EvidenceItemRef[] {
  const seen = new Map<string, EvidenceItemRef>()
  for (const item of items) {
    if (!seen.has(item.id)) seen.set(item.id, item)
  }
  return [...seen.values()]
}

function makeGroup(kind: EvidenceGroupKind, role: ContextRole | null, items: EvidenceItemRef[], options: MakeGroupOptions): EvidenceGroup {
  const { limit, required, provenance, unresolved = [], warnings = [], availableCountOverride } = options
  const deduped = dedupeById(items)
  const boundedItems = limit != null ? deduped.slice(0, limit) : deduped
  const availableCount = availableCountOverride ?? deduped.length
  return {
    id: `${role ?? 'no-role'}-${kind}`,
    kind,
    role,
    title: GROUP_TITLES[kind],
    required,
    items: boundedItems,
    unresolved,
    warnings,
    limit,
    availableCount,
    usedCount: boundedItems.length,
    truncated: availableCount > boundedItems.length,
    droppedCount: Math.max(0, availableCount - boundedItems.length),
    provenance,
  }
}

function fileToItem(file: CandidateFile, relationship: string, basis: string): EvidenceItemRef {
  return {
    id: file.path,
    itemKind: 'file',
    path: file.path,
    sourceLocation: { filePath: file.path },
    relationship,
    basis,
    provenance: 'candidate-ranking',
    metadata: { score: file.score },
  }
}

function nodeToItem(node: CandidateNode, relationship: string, basis: string): EvidenceItemRef {
  return {
    id: node.nodeId,
    itemKind: node.kind === 'symbol' ? 'symbol' : 'file',
    ...(node.filePath ? { path: node.filePath, sourceLocation: { filePath: node.filePath } } : {}),
    ...(node.kind === 'symbol' ? { symbolId: node.nodeId } : {}),
    nodeId: node.nodeId,
    relationship,
    basis,
    provenance: 'candidate-ranking',
    metadata: { score: node.score },
  }
}

function sortByScoreThenPath<T extends { score: number; path?: string; nodeId?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.score - a.score || (a.path ?? a.nodeId ?? '').localeCompare(b.path ?? b.nodeId ?? ''))
}

function hasReasonMatching(reasons: string[], pattern: RegExp): boolean {
  return reasons.some((r) => pattern.test(r))
}

/** True for candidates the Batch 2 role-adjustment layer already marked as one-hop
 * graph-adjacent to a focus/changed-surface seed. Reuses that computation rather
 * than re-deriving adjacency here (no second graph traversal). */
function isAdjacentCandidate(reasons: string[]): boolean {
  return hasReasonMatching(reasons, /direct graph neighbor/)
}

/** Reconstructs the same focus/changed-surface seed node/file IDs Batch 2's
 * `roleCandidates.ts` used for adjacency, so direction can be derived here without
 * a second graph traversal (only the existing edges are inspected). */
function computeSeedNodeIds(options: { codeGraph: CodeGraph; focusIntake: ContextFocusIntake; changedSurface: ChangedSurface }): Set<string> {
  const { codeGraph, focusIntake, changedSurface } = options
  const symbolNodeById = new Map(codeGraph.nodes.map((n) => [n.id, n]))
  const focusSymbolNodeIds = focusIntake.focusSymbols.filter((e) => e.resolved && !e.ambiguous).flatMap((e) => e.matchedNodeIds)
  const focusContainedSymbolIds = focusIntake.focusFiles.filter((e) => e.resolved).flatMap((e) => e.containedSymbolIds)
  const changedSymbolIds = changedSurface.symbols.map((e) => e.symbolId)
  const seed = new Set<string>([...focusSymbolNodeIds, ...focusContainedSymbolIds, ...changedSymbolIds])
  for (const id of [...seed]) {
    const p = symbolNodeById.get(id)?.path
    if (p) seed.add(`file:${p}`)
  }
  for (const p of focusIntake.focusFiles.filter((e) => e.resolved).flatMap((e) => e.matchedFilePaths)) seed.add(`file:${p}`)
  for (const p of changedSurface.files.filter((f) => f.status !== 'removed').map((f) => f.path)) seed.add(`file:${p}`)
  return seed
}

/** Splits undirected one-hop adjacency evidence into "seed depends on this" (dependencies)
 * vs "this depends on/calls the seed" (callers), using the existing `imports`/`depends-on`/
 * `calls` edges directly. An item with edges in both directions appears in both lists
 * (materially different relationships — see section 9.4), never duplicated within one list. */
function splitDependenciesAndCallers(options: {
  codeGraph: CodeGraph
  adjacentItems: EvidenceItemRef[]
  seedNodeIds: Set<string>
}): { dependencyItems: EvidenceItemRef[]; callerItems: EvidenceItemRef[] } {
  const { codeGraph, adjacentItems, seedNodeIds } = options
  const itemById = new Map(adjacentItems.map((i) => [i.id, i]))
  const dependencyIds = new Set<string>()
  const callerIds = new Set<string>()
  for (const edge of codeGraph.edges) {
    if (edge.kind !== 'imports' && edge.kind !== 'depends-on' && edge.kind !== 'calls') continue
    if (seedNodeIds.has(edge.source) && itemById.has(edge.target)) dependencyIds.add(edge.target)
    if (seedNodeIds.has(edge.target) && itemById.has(edge.source)) callerIds.add(edge.source)
  }
  return {
    dependencyItems: adjacentItems.filter((i) => dependencyIds.has(i.id)),
    callerItems: adjacentItems.filter((i) => callerIds.has(i.id)),
  }
}

export interface BuildEvidenceGroupsOptions {
  role: ContextRole | null
  candidateFiles: CandidateFile[]
  candidateNodes: CandidateNode[]
  focusIntake: ContextFocusIntake
  changedSurface: ChangedSurface
  requestedEvidenceKinds: RequestedEvidenceKind[]
  codeGraph: CodeGraph
  symbolIndex: SymbolIndex
  selectedGraph: SelectedGraph
  repoRoot: string
}

export interface BuildEvidenceGroupsResult {
  groups: EvidenceGroup[]
  selectedOwners: EvidenceItemRef[]
  selectedContracts: EvidenceItemRef[]
  selectedTests: EvidenceItemRef[]
  testInfrastructure: TestInfrastructureSummary
  unresolvedItems: UnresolvedEvidenceItem[]
  groupTruncation: GroupTruncationEntry[]
  warnings: string[]
}

export function buildEvidenceGroups(options: BuildEvidenceGroupsOptions): BuildEvidenceGroupsResult {
  const { role, focusIntake, changedSurface, requestedEvidenceKinds, codeGraph, symbolIndex, selectedGraph, repoRoot } = options
  const retainedFiles = options.candidateFiles.filter((f) => f.retained)
  const retainedNodes = options.candidateNodes.filter((n) => n.retained)
  const requestedSet = new Set(requestedEvidenceKinds)
  const warnings: string[] = []

  const nodeGraphById = new Map<string, CodeGraphNode>(codeGraph.nodes.map((n) => [n.id, n]))

  const ownerNodes = sortByScoreThenPath(retainedNodes.filter((n) => isOwnerLike(n)))
  const ownerFiles = sortByScoreThenPath(retainedFiles.filter((f) => isOwnerLike({ filePath: f.path, label: f.path })))
  const ownerItems = [
    ...ownerNodes.map((n) => nodeToItem(n, 'owner-like candidate', 'owner-like naming/graph-position heuristic')),
    ...ownerFiles.map((f) => fileToItem(f, 'owner-like candidate', 'owner-like naming/graph-position heuristic')),
  ]

  const contractNodes = sortByScoreThenPath(retainedNodes.filter((n) => isContractLike(n)))
  const contractFiles = sortByScoreThenPath(retainedFiles.filter((f) => isContractLike({ filePath: f.path, label: f.path })))
  const contractItems = [
    ...contractNodes.map((n) => nodeToItem(n, 'contract-like candidate', 'contract/validator/schema/error naming heuristic')),
    ...contractFiles.map((f) => fileToItem(f, 'contract-like candidate', 'contract/validator/schema/error naming heuristic')),
  ]

  const closestTestNodes = sortByScoreThenPath(retainedNodes.filter((n) => isTestLike(n.filePath)))
  const closestTestFiles = sortByScoreThenPath(retainedFiles.filter((f) => isTestLike(f.path)))
  const closestTestItems = [
    ...closestTestNodes.map((n) => nodeToItem(n, 'closest-test candidate', 'test-file naming convention + ranking')),
    ...closestTestFiles.map((f) => fileToItem(f, 'closest-test candidate', 'test-file naming convention + ranking')),
  ]

  const adjacentNodes = sortByScoreThenPath(retainedNodes.filter((n) => isAdjacentCandidate(n.reasons)))
  const adjacentFiles = sortByScoreThenPath(retainedFiles.filter((f) => isAdjacentCandidate(f.reasons)))
  const adjacentItems = [
    ...adjacentNodes.map((n) => nodeToItem(n, 'direct-graph-neighbor', 'one-hop graph adjacency to a focus/changed-surface seed')),
    ...adjacentFiles.map((f) => fileToItem(f, 'direct-graph-neighbor', 'one-hop graph adjacency to a focus/changed-surface seed')),
  ]

  // Split the undirected Batch 2 "direct graph neighbor" evidence into directed
  // dependency (seed -> neighbor) vs caller (neighbor -> seed) evidence using the
  // existing code-graph edges directly, so "dependencies" and "callers-and-callees"
  // are not simply the same list twice.
  const seedNodeIds = computeSeedNodeIds({ codeGraph, focusIntake, changedSurface })
  const { dependencyItems, callerItems } = splitDependenciesAndCallers({ codeGraph, adjacentItems, seedNodeIds })

  const exportedSymbolItems = sortByScoreThenPath(retainedNodes.filter((n) => n.kind === 'symbol' && nodeGraphById.get(n.nodeId)?.exported === true)).map((n) =>
    nodeToItem(n, 'exported-symbol', 'graph exported=true')
  )

  const groups: EvidenceGroup[] = []
  const unresolvedItems: UnresolvedEvidenceItem[] = []

  function pushGroup(kind: EvidenceGroupKind, items: EvidenceItemRef[], opts: MakeGroupOptions): EvidenceGroup {
    const g = makeGroup(kind, role, items, opts)
    groups.push(g)
    unresolvedItems.push(...g.unresolved)
    return g
  }

  let selectedOwners: EvidenceItemRef[] = []
  let selectedContracts: EvidenceItemRef[] = []
  let selectedTests: EvidenceItemRef[] = []

  if (role === 'architecture') {
    const ownersGroup = pushGroup('owners', ownerItems, { limit: 5, required: true, provenance: 'owner-like classification over role-ranked candidates' })
    const extensionPoints = ownerItems.filter((item) => adjacentItems.some((a) => a.id === item.id))
    pushGroup('extension-points', extensionPoints, { limit: 8, required: true, provenance: 'owner-like candidates that are also graph-adjacent to the focus/seed' })
    const contractsGroup = pushGroup('contracts', contractItems, { limit: 10, required: true, provenance: 'contract-like classification over role-ranked candidates' })
    const graphNeighborhoodItems: EvidenceItemRef[] = selectedGraph.nodes.map((n) => ({
      id: n.nodeId,
      itemKind: n.kind === 'symbol' ? 'symbol' : 'file',
      ...(n.filePath ? { path: n.filePath, sourceLocation: { filePath: n.filePath } } : {}),
      nodeId: n.nodeId,
      relationship: 'selected-graph-neighborhood',
      basis: n.reasons.join('; ') || 'selected graph neighborhood',
      provenance: 'selected-graph',
    }))
    pushGroup('graph-neighborhood', graphNeighborhoodItems, {
      limit: null,
      required: true,
      provenance: 'reused selectGraphNeighborhood output (Batch 2/3 selected graph)',
      availableCountOverride: graphNeighborhoodItems.length,
    })
    pushGroup('architecture-tests', closestTestItems, { limit: 8, required: true, provenance: 'test-file naming convention over role-ranked candidates' })
    selectedOwners = ownersGroup.items
    selectedContracts = contractsGroup.items
  } else if (role === 'implementation') {
    const ownersGroup = pushGroup('owners', ownerItems, { limit: 3, required: true, provenance: 'owner-like classification over role-ranked candidates' })
    // Directed when edge evidence distinguishes them (see splitDependenciesAndCallers);
    // falls back to the full undirected neighbor set when no directed edge exists (e.g.
    // no --call-graph and adjacency came only from a shared file-level import edge).
    pushGroup('dependencies', dependencyItems.length > 0 ? dependencyItems : adjacentItems, {
      limit: 10,
      required: true,
      provenance: 'directed graph edges (seed -> neighbor) over one-hop adjacency reused from Batch 2 role ranking',
    })
    pushGroup('callers-and-callees', [...callerItems, ...dependencyItems].length > 0 ? [...callerItems, ...dependencyItems] : adjacentItems, {
      limit: 15,
      required: true,
      provenance: 'directed graph edges (both directions) over one-hop adjacency reused from Batch 2 role ranking',
    })
    const contractsGroup = pushGroup('contracts', contractItems, { limit: 10, required: true, provenance: 'contract-like classification over role-ranked candidates' })
    const validators = contractItems.filter((i) => VALIDATOR_PATTERN.test(i.path ?? '') || CONSTANT_PATTERN.test(i.path ?? ''))
    pushGroup('validators-and-constants', validators, { limit: 10, required: true, provenance: 'validator/constant naming subset of contract-like candidates' })
    const errors = contractItems.filter((i) => ERROR_PATTERN.test(i.path ?? ''))
    pushGroup('errors', errors, { limit: 10, required: true, provenance: 'error naming subset of contract-like candidates' })
    const schemas = contractItems.filter((i) => SCHEMA_PATTERN.test(i.path ?? ''))
    pushGroup('schemas-and-serializers', schemas, { limit: 10, required: true, provenance: 'schema naming subset of contract-like candidates' })
    pushGroup('compatibility-surfaces', exportedSymbolItems, { limit: 8, required: true, provenance: 'exported symbol candidates (graph exported=true)' })
    pushGroup('closest-tests', closestTestItems, { limit: 8, required: true, provenance: 'test-file naming convention over role-ranked candidates' })
    selectedOwners = ownersGroup.items
    selectedContracts = contractsGroup.items
  } else if (role === 'test-implementation') {
    const changedFileItems: EvidenceItemRef[] = changedSurface.files.map((f) => ({
      id: f.path,
      itemKind: 'file',
      path: f.path,
      sourceLocation: { filePath: f.path },
      relationship: f.status,
      basis: `changed-surface (${f.provenance})`,
      provenance: f.provenance,
    }))
    pushGroup('changed-surface', changedFileItems, {
      limit: null,
      required: true,
      provenance: 'reused changedSurface.files (Batch 2)',
      availableCountOverride: changedFileItems.length,
      unresolved: changedFileItems.length === 0 ? [{ evidenceKind: 'changed-surface', role, basis: 'changedFiles/changedSymbols/beforeIndex/afterIndex', reason: 'No changed-surface evidence was supplied or derived; grounding remains query/focus-based only.', blocking: false }] : [],
    })
    const changedSymbolItems: EvidenceItemRef[] = changedSurface.symbols.map((s) => ({
      id: s.symbolId,
      itemKind: 'symbol',
      symbolId: s.symbolId,
      nodeId: s.symbolId,
      ...(s.filePath ? { path: s.filePath, sourceLocation: { filePath: s.filePath } } : {}),
      relationship: s.status,
      basis: `changed-surface (${s.provenance})`,
      provenance: s.provenance,
    }))
    pushGroup('production-symbols', changedSymbolItems, {
      limit: null,
      required: true,
      provenance: 'reused changedSurface.symbols (Batch 2)',
      availableCountOverride: changedSymbolItems.length,
    })
    const validators = contractItems.filter((i) => VALIDATOR_PATTERN.test(i.path ?? '') || CONSTANT_PATTERN.test(i.path ?? ''))
    pushGroup('validators-and-boundaries', validators, { limit: 10, required: true, provenance: 'validator/constant naming subset of contract-like candidates' })
    const errorsAndSideEffects = contractItems
      .filter((i) => ERROR_PATTERN.test(i.path ?? ''))
      .concat(adjacentItems.filter((i) => SIDE_EFFECT_PATTERN.test(i.path ?? '')))
    pushGroup('errors-and-side-effects', errorsAndSideEffects, { limit: 10, required: true, provenance: 'error-naming candidates plus conservative side-effect-boundary naming over graph-adjacent candidates' })

    const filesOfInterest = [
      ...new Set([...changedSurface.files.filter((f) => f.status !== 'removed').map((f) => f.path), ...focusIntake.focusFiles.filter((f) => f.resolved).flatMap((f) => f.matchedFilePaths)]),
    ].sort()
    const symbolsOfInterest = [
      ...new Set([...changedSurface.symbols.map((s) => s.symbolId), ...focusIntake.focusSymbols.filter((s) => s.resolved).flatMap((s) => s.matchedNodeIds)]),
    ].sort()

    const infra = discoverTestInfrastructure({
      role,
      symbolIndex,
      filesOfInterest,
      symbolsOfInterest,
      requestedEvidenceKinds,
      repoRoot,
    })
    warnings.push(...infra.warnings)

    const relatedTestsGroup = pushGroup('related-tests', infra.relatedTests.items, boundedGroupOptions(infra.relatedTests, true, 'graph import/call edges from selected/changed production evidence'))
    pushGroup('fixtures', infra.fixtures.items, boundedGroupOptions(infra.fixtures, true, 'graph import edges from related tests'))
    pushGroup('factories', infra.factories.items, boundedGroupOptions(infra.factories, true, 'graph import edges from related tests'))
    pushGroup('mocks', infra.mocks.items, boundedGroupOptions(infra.mocks, true, 'graph import edges from related tests'))
    const setupAndConfigItems = [...infra.setupFiles.items]
    pushGroup('setup-and-configuration', setupAndConfigItems, boundedGroupOptions(infra.setupFiles, true, 'test configuration setupFiles field'))
    const testCommandItems: EvidenceItemRef[] = infra.testCommands.items.map((c) => ({
      id: c.commandText ?? `unresolved:${c.commandSource}`,
      itemKind: 'command',
      relationship: c.scope,
      basis: c.basis,
      provenance: c.commandSource,
      metadata: { commandText: c.commandText, framework: c.framework, scope: c.scope },
    }))
    pushGroup('test-commands', testCommandItems, boundedGroupOptions(infra.testCommands, true, 'derived from package.json test script + discovered related tests'))

    unresolvedItems.push(...infra.unresolved)
    selectedTests = relatedTestsGroup.items

    return finalizeResult({
      groups,
      selectedOwners,
      selectedContracts,
      selectedTests,
      testInfrastructure: {
        relatedTests: infra.relatedTests.items,
        fixtures: infra.fixtures.items,
        factories: infra.factories.items,
        mocks: infra.mocks.items,
        setupFiles: infra.setupFiles.items,
        testConfigurations: infra.testConfigurations.items,
        packageScripts: infra.packageScripts.items,
        testCommands: infra.testCommands.items,
        unresolved: infra.unresolved,
        warnings: infra.warnings,
      },
      unresolvedItems,
      warnings,
    })
  } else {
    // Legacy (no-role) requests: evidence groups remain empty (TST-B3-029). No grouping,
    // no test-infrastructure discovery is run — this preserves the pre-Batch-3 capsule shape.
    return finalizeResult({
      groups: [],
      selectedOwners: [],
      selectedContracts: [],
      selectedTests: [],
      testInfrastructure: emptyTestInfrastructure(),
      unresolvedItems: [],
      warnings: [],
    })
  }

  // architecture/implementation: optionally run test-infrastructure discovery only when
  // explicitly requested (section 20), since it is not part of those roles' required groups.
  let testInfrastructure = emptyTestInfrastructure()
  if (requestedSet.has('test-infrastructure') || requestedSet.has('test-commands')) {
    const filesOfInterest = [
      ...new Set([...changedSurface.files.filter((f) => f.status !== 'removed').map((f) => f.path), ...focusIntake.focusFiles.filter((f) => f.resolved).flatMap((f) => f.matchedFilePaths), ...selectedOwners.map((o) => o.path).filter((p): p is string => !!p)]),
    ].sort()
    const symbolsOfInterest = [...new Set([...changedSurface.symbols.map((s) => s.symbolId), ...focusIntake.focusSymbols.filter((s) => s.resolved).flatMap((s) => s.matchedNodeIds)])].sort()
    const infra = discoverTestInfrastructure({ role, symbolIndex, filesOfInterest, symbolsOfInterest, requestedEvidenceKinds, repoRoot })
    warnings.push(...infra.warnings)
    unresolvedItems.push(...infra.unresolved)
    testInfrastructure = {
      relatedTests: infra.relatedTests.items,
      fixtures: infra.fixtures.items,
      factories: infra.factories.items,
      mocks: infra.mocks.items,
      setupFiles: infra.setupFiles.items,
      testConfigurations: infra.testConfigurations.items,
      packageScripts: infra.packageScripts.items,
      testCommands: infra.testCommands.items,
      unresolved: infra.unresolved,
      warnings: infra.warnings,
    }
  }

  return finalizeResult({ groups, selectedOwners, selectedContracts, selectedTests, testInfrastructure, unresolvedItems, warnings })
}

function boundedGroupOptions<T>(list: BoundedList<T>, required: boolean, provenance: string): MakeGroupOptions {
  return { limit: list.limit, required, provenance, availableCountOverride: list.availableCount }
}

function emptyTestInfrastructure(): TestInfrastructureSummary {
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
  }
}

function finalizeResult(result: Omit<BuildEvidenceGroupsResult, 'groupTruncation'>): BuildEvidenceGroupsResult {
  const groupTruncation: GroupTruncationEntry[] = result.groups.map((g) => ({
    groupId: g.id,
    limit: g.limit,
    availableCount: g.availableCount,
    usedCount: g.usedCount,
    truncated: g.truncated,
    droppedCount: g.droppedCount,
  }))
  return { ...result, groupTruncation }
}

// Re-exported for tests/audit wiring convenience.
export type { PackageScriptEvidenceEntry, TestCommandEvidenceEntry, TestConfigurationEvidenceEntry }
