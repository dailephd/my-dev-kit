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
import { isFixtureLike, isGeneratedLike, isMockLike, isTestScoped } from './evidenceClassification.js'
import type { ClassificationRoleRef } from '../classification/classificationTypes.js'
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

/**
 * v1.10.3 Batch 2: required-first evidence allocation (F-003).
 *
 * Before this, each implementation-role required group applied its fixed cap in
 * isolation: a group with more qualified evidence than its cap always dropped the
 * excess, even while other required groups had unused reservation. This treats
 * every group's existing cap as an *initial reservation* out of one shared pool
 * scoped to the required groups passed in (their fixed declaration order below is
 * the "fixed required-group priority" — unchanged from before this batch), and
 * reassigns unused reservation to earlier-unmet groups before later ones, using
 * each group's own pre-existing candidate rank (never re-ranked here) and, where
 * ranks tie, the existing path/nodeId ordering already baked into that rank.
 *
 * The real governing bound for this pass is the sum of the participating groups'
 * reservations — the same total capacity that already existed (as isolated caps)
 * before this batch. Nothing is invented: reassignment only ever moves capacity
 * that another required group in this pass left unused, so total selected
 * evidence across the pass can never exceed that pre-existing sum. This is
 * deliberately independent of `requestLimits.evidenceGroupEntries`, which remains
 * a diagnostic/reporting-only value (contextBudget.ts) and is never treated as an
 * enforced allocation bound.
 */
export interface RequiredGroupAllocationInput {
  kind: EvidenceGroupKind
  items: EvidenceItemRef[]
  reservation: number
}

export interface RequiredGroupAllocationResult {
  kind: EvidenceGroupKind
  dedupedItems: EvidenceItemRef[]
  selectedItems: EvidenceItemRef[]
  reservation: number
  initiallySelectedCount: number
  unusedReservationContributed: number
  borrowedCapacity: number
  effectiveLimit: number
  requiredOmittedCount: number
}

function allocateRequiredGroups(inputs: RequiredGroupAllocationInput[]): RequiredGroupAllocationResult[] {
  const prepared = inputs.map((input) => {
    const dedupedItems = dedupeById(input.items)
    const initiallySelected = dedupedItems.slice(0, input.reservation)
    const remaining = dedupedItems.slice(input.reservation)
    const unusedReservationContributed = Math.max(0, input.reservation - dedupedItems.length)
    return { kind: input.kind, reservation: input.reservation, dedupedItems, initiallySelected, remaining, unusedReservationContributed }
  })

  let pool = prepared.reduce((sum, g) => sum + g.unusedReservationContributed, 0)

  return prepared.map((g): RequiredGroupAllocationResult => {
    let borrowedCapacity = 0
    let selectedItems = g.initiallySelected
    if (pool > 0 && g.remaining.length > 0) {
      const take = Math.min(pool, g.remaining.length)
      selectedItems = [...g.initiallySelected, ...g.remaining.slice(0, take)]
      borrowedCapacity = take
      pool -= take
    }
    return {
      kind: g.kind,
      dedupedItems: g.dedupedItems,
      selectedItems,
      reservation: g.reservation,
      initiallySelectedCount: g.initiallySelected.length,
      unusedReservationContributed: g.unusedReservationContributed,
      borrowedCapacity,
      effectiveLimit: g.reservation + borrowedCapacity,
      requiredOmittedCount: g.dedupedItems.length - selectedItems.length,
    }
  })
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

/**
 * v1.10.3 Batch 1: structural implementation-owner eligibility (F-001/F-002).
 *
 * Filename keywords (`isOwnerLike`) and focus (`focusMatch`) are ranking/relevance
 * signals only (applied earlier, in `roleCandidates.ts`, via score adjustments) and
 * are deliberately absent from this predicate: neither may gate owner eligibility on
 * its own (CASE-002 — a focused, owner-named test/fixture/generated file must never
 * qualify). A candidate qualifies only via independent structural evidence: exported
 * production-symbol status, contract/canonical-type naming, a classification role
 * that is not itself a non-owner category, or a real incoming import/depends-on/calls
 * edge from another non-test-scoped file (resolver/registry/definition/producer
 * ownership). Test/fixture/mock/generated paths and non-owner classification roles
 * are hard-excluded regardless of any other signal.
 */
const NON_OWNER_CLASSIFICATION_ROLES = new Set(['projection-type', 'view-model', 'ui-only-state', 'test-fixture', 'generated-file'])
const NON_OWNER_EDIT_GUIDANCE = new Set(['generated-do-not-edit', 'test-only', 'docs-only', 'avoid-primary-edit-target'])
const OWNER_QUALIFYING_EDIT_GUIDANCE = new Set(['safe-primary-edit-target', 'inspect-before-edit'])

function isForbiddenOwnerPath(filePath: string | undefined): boolean {
  return isTestScoped(filePath) || isFixtureLike(filePath) || isMockLike(filePath) || isGeneratedLike(filePath)
}

/** A candidate must have *request relevance* in addition to structural evidence
 * (section 16): otherwise every contract-shaped file anywhere in the repository
 * (e.g. an unrelated `types.ts`) would qualify merely by existing, since
 * `contractLikeBoost` is applied regardless of relevance. Deliberately does not
 * treat a bare base-search `matchedTerms` hit as relevance here: free-text search
 * can match incidental metadata (e.g. a query word coincidentally equal to a
 * classification `editGuidance` string) with no bearing on ownership. Relevance
 * for ownership means the candidate is an explicit focus file/symbol, is
 * one-hop graph-adjacent to a focus/changed-surface seed, is itself
 * changed-surface evidence, or is an exact query-name match. */
function hasRequestRelevance(candidate: { reasons: string[] }): boolean {
  return hasReasonMatching(candidate.reasons, /explicit focus (file|symbol)|direct graph neighbor|exact query-name match|changed-surface/)
}

function hasNonOwnerClassification(roles: ClassificationRoleRef[] | undefined): boolean {
  if (!roles || roles.length === 0) return false
  return roles.some((r) => NON_OWNER_CLASSIFICATION_ROLES.has(r.role) || NON_OWNER_EDIT_GUIDANCE.has(r.editGuidance))
}

function hasOwnerQualifyingClassification(roles: ClassificationRoleRef[] | undefined): boolean {
  if (!roles || roles.length === 0) return false
  return roles.some((r) => !NON_OWNER_CLASSIFICATION_ROLES.has(r.role) && !NON_OWNER_EDIT_GUIDANCE.has(r.editGuidance) && OWNER_QUALIFYING_EDIT_GUIDANCE.has(r.editGuidance))
}

/** Node/file IDs with at least one incoming `imports`/`depends-on`/`calls` edge from
 * another, non-test-scoped node: i.e. something else in the codebase structurally
 * depends on it (resolver/registry/definition/producer ownership), independent of
 * filename or focus. */
function computeStructuralProducerIds(codeGraph: CodeGraph): Set<string> {
  const pathById = new Map(codeGraph.nodes.map((n) => [n.id, n.path]))
  const producers = new Set<string>()
  for (const edge of codeGraph.edges) {
    if (edge.kind !== 'imports' && edge.kind !== 'depends-on' && edge.kind !== 'calls') continue
    if (edge.source === edge.target) continue
    if (isForbiddenOwnerPath(pathById.get(edge.source))) continue
    producers.add(edge.target)
  }
  return producers
}

/** File paths that are one-hop adjacent to a focus/changed-surface seed only as a
 * *caller* of that seed (they import/call into it), and never as something the seed
 * (or anything else) depends on. Computed directly from graph edges using the same
 * `file:<path>` node-ID convention as `computeSeedNodeIds`/`roleCandidates.ts`'s own
 * adjacency pass — deliberately not derived from `splitDependenciesAndCallers`'s
 * `callerItems`, which only ever matches symbol-level candidates (its `itemById` is
 * keyed by bare `EvidenceItemRef.id`, which for file items is the bare path, not the
 * `file:`-prefixed graph node id `callerIds`/`dependencyIds` are populated with). */
function computeCallerOnlyFilePaths(codeGraph: CodeGraph, seedNodeIds: Set<string>): Set<string> {
  const pathById = new Map(codeGraph.nodes.map((n) => [n.id, n.path]))
  const dependedOnIds = new Set<string>()
  const callerIds = new Set<string>()
  for (const edge of codeGraph.edges) {
    if (edge.kind !== 'imports' && edge.kind !== 'depends-on' && edge.kind !== 'calls') continue
    if (seedNodeIds.has(edge.source) && !seedNodeIds.has(edge.target)) dependedOnIds.add(edge.target)
    if (seedNodeIds.has(edge.target) && !seedNodeIds.has(edge.source)) callerIds.add(edge.source)
  }
  const callerOnlyFilePaths = new Set<string>()
  for (const id of callerIds) {
    if (dependedOnIds.has(id)) continue
    const path = id.startsWith('file:') ? id.slice('file:'.length) : pathById.get(id)
    if (path) callerOnlyFilePaths.add(path)
  }
  return callerOnlyFilePaths
}

function isStructuralOwnerNode(node: CandidateNode, ctx: { exportedNodeIds: Set<string>; producerIds: Set<string>; callerOnlyFilePaths: Set<string> }): boolean {
  if (!hasRequestRelevance(node)) return false
  if (isForbiddenOwnerPath(node.filePath)) return false
  if (hasNonOwnerClassification(node.classificationRoles)) return false
  if (isContractLike(node)) return true
  if (hasOwnerQualifyingClassification(node.classificationRoles)) return true
  if (ctx.producerIds.has(node.nodeId)) return true
  if (ctx.exportedNodeIds.has(node.nodeId) && !(node.filePath && ctx.callerOnlyFilePaths.has(node.filePath))) return true
  return false
}

function isStructuralOwnerFile(file: CandidateFile, ctx: { exportedFilePaths: Set<string>; producerIds: Set<string>; callerOnlyFilePaths: Set<string> }): boolean {
  if (!hasRequestRelevance(file)) return false
  if (isForbiddenOwnerPath(file.path)) return false
  if (hasNonOwnerClassification(file.classificationRoles)) return false
  if (isContractLike({ filePath: file.path, label: file.path })) return true
  if (hasOwnerQualifyingClassification(file.classificationRoles)) return true
  if (ctx.producerIds.has(`file:${file.path}`)) return true
  if (ctx.exportedFilePaths.has(file.path) && !ctx.callerOnlyFilePaths.has(file.path)) return true
  return false
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

/**
 * v1.10.3 Batch 4: canonical graph-node identity for an `EvidenceItemRef` (confirmed
 * Batch 3 finding — the file-node ID mismatch).
 *
 * `code-graph.json` file nodes use a `file:<repository-relative-path>` ID; symbol
 * nodes use their own `symbol:<path>#<name>` ID. A symbol-sourced `EvidenceItemRef`
 * already carries that exact graph ID as `.nodeId` (`nodeToItem` sets `id: node.nodeId`),
 * so it always matched. A plain file-sourced item (`fileToItem`) sets `id: file.path`
 * (the bare path, no `file:` prefix) and no `.nodeId` at all — so it could never match
 * a `file:`-prefixed edge endpoint. This is the single conversion boundary: prefer the
 * item's own graph node ID when it has one (already correct for both symbol and
 * node-sourced-file items), otherwise derive the canonical file node ID from its path.
 */
function canonicalGraphId(item: EvidenceItemRef): string {
  if (item.nodeId) return item.nodeId
  if (item.path) return `file:${item.path}`
  return item.id
}

/** Splits undirected one-hop adjacency evidence into "seed depends on this" (dependencies)
 * vs "this depends on/calls the seed" (callers), using the existing `imports`/`depends-on`/
 * `calls` edges directly. An item with edges in both directions appears in both lists
 * (materially different relationships — see section 9.4), never duplicated within one list.
 * Matching is keyed by `canonicalGraphId` (v1.10.3 Batch 4), not the bare `EvidenceItemRef.id`,
 * so plain file-level evidence resolves correctly against `file:`-prefixed graph edges instead
 * of silently failing to match and forcing every caller onto the undirected adjacency fallback. */
function splitDependenciesAndCallers(options: {
  codeGraph: CodeGraph
  adjacentItems: EvidenceItemRef[]
  seedNodeIds: Set<string>
}): { dependencyItems: EvidenceItemRef[]; callerItems: EvidenceItemRef[] } {
  const { codeGraph, adjacentItems, seedNodeIds } = options
  const itemByGraphId = new Map(adjacentItems.map((i) => [canonicalGraphId(i), i]))
  const dependencyIds = new Set<string>()
  const callerIds = new Set<string>()
  for (const edge of codeGraph.edges) {
    if (edge.kind !== 'imports' && edge.kind !== 'depends-on' && edge.kind !== 'calls') continue
    if (seedNodeIds.has(edge.source) && itemByGraphId.has(edge.target)) dependencyIds.add(edge.target)
    if (seedNodeIds.has(edge.target) && itemByGraphId.has(edge.source)) callerIds.add(edge.source)
  }
  return {
    dependencyItems: dedupeByCanonicalGraphId(adjacentItems.filter((i) => dependencyIds.has(canonicalGraphId(i)))),
    callerItems: dedupeByCanonicalGraphId(adjacentItems.filter((i) => callerIds.has(canonicalGraphId(i)))),
  }
}

/** The same underlying file can appear twice in `adjacentItems` — once as a plain file
 * candidate (`id: <path>`) and once as a synthesized/ranked file-kind node candidate
 * (`id: file:<path>`) — since candidate files and candidate nodes are independent lists
 * (v1.10.1 Batch 2). Both now resolve to the same `canonicalGraphId`, so collapse them
 * to one entry (first occurrence, preserving the existing deterministic order) rather
 * than reporting the same relationship twice. */
function dedupeByCanonicalGraphId(items: EvidenceItemRef[]): EvidenceItemRef[] {
  const seen = new Set<string>()
  const result: EvidenceItemRef[] = []
  for (const item of items) {
    const key = canonicalGraphId(item)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
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

  // v1.10.3 Batch 1: eligibility is structural (see isStructuralOwnerNode/File above);
  // isOwnerLike remains a ranking signal only (applied in roleCandidates.ts scoring).
  // v1.10.3 Batch 2 narrow compatibility correction (F-003 regression found while
  // testing required-first spillover): a bare exported binding is not independent
  // ownership evidence when the file's only relevance to the request is that it
  // *calls into* the focus/seed (a downstream consumer), and nothing else in the
  // codebase depends on it either. Recovering unused reservation from other groups
  // could otherwise promote such leaf consumers (e.g. `export const a = seedFn()`)
  // into "owners" once capacity allowed it — exactly the false-owner shape Batch 1
  // already excludes for fixtures/tests/generated files. Contract-like naming,
  // classification, and real producer relationships are unaffected.
  const callerOnlyFilePaths = computeCallerOnlyFilePaths(codeGraph, seedNodeIds)
  const exportedNodeIds = new Set(codeGraph.nodes.filter((n) => n.kind === 'symbol' && n.exported === true).map((n) => n.id))
  const exportedFilePaths = new Set(codeGraph.nodes.filter((n) => n.kind === 'symbol' && n.exported === true && n.path).map((n) => n.path as string))
  const producerIds = computeStructuralProducerIds(codeGraph)

  const ownerNodes = sortByScoreThenPath(retainedNodes.filter((n) => isStructuralOwnerNode(n, { exportedNodeIds, producerIds, callerOnlyFilePaths })))
  const ownerFiles = sortByScoreThenPath(retainedFiles.filter((f) => isStructuralOwnerFile(f, { exportedFilePaths, producerIds, callerOnlyFilePaths })))
  const ownerItems = [
    ...ownerNodes.map((n) =>
      nodeToItem(n, 'structural owner candidate', isOwnerLike(n) ? 'structural ownership evidence (owner-like filename is a supporting ranking signal only)' : 'structural ownership evidence')
    ),
    ...ownerFiles.map((f) =>
      fileToItem(
        f,
        'structural owner candidate',
        isOwnerLike({ filePath: f.path, label: f.path }) ? 'structural ownership evidence (owner-like filename is a supporting ranking signal only)' : 'structural ownership evidence'
      )
    ),
  ]

  const groups: EvidenceGroup[] = []
  const unresolvedItems: UnresolvedEvidenceItem[] = []
  const allocationDiagnostics = new Map<string, Partial<GroupTruncationEntry>>()

  function pushGroup(kind: EvidenceGroupKind, items: EvidenceItemRef[], opts: MakeGroupOptions, diagnostics?: Partial<GroupTruncationEntry>): EvidenceGroup {
    const g = makeGroup(kind, role, items, opts)
    groups.push(g)
    unresolvedItems.push(...g.unresolved)
    if (diagnostics) allocationDiagnostics.set(g.id, diagnostics)
    return g
  }

  let selectedOwners: EvidenceItemRef[] = []
  let selectedContracts: EvidenceItemRef[] = []
  let selectedTests: EvidenceItemRef[] = []

  if (role === 'architecture') {
    const ownersGroup = pushGroup('owners', ownerItems, { limit: 5, required: true, provenance: 'structural ownership evidence (exported symbol, contract/canonical-type naming, classification, or graph producer relationship) over role-ranked candidates' })
    const extensionPoints = ownerItems.filter((item) => adjacentItems.some((a) => a.id === item.id))
    pushGroup('extension-points', extensionPoints, { limit: 8, required: true, provenance: 'structural owners that are also graph-adjacent to the focus/seed' })
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
    // Directed when edge evidence distinguishes them (see splitDependenciesAndCallers);
    // falls back to the full undirected neighbor set when no directed edge exists (e.g.
    // no --call-graph and adjacency came only from a shared file-level import edge).
    const dependencyGroupItems = dependencyItems.length > 0 ? dependencyItems : adjacentItems
    const callersGroupItems = [...callerItems, ...dependencyItems].length > 0 ? [...callerItems, ...dependencyItems] : adjacentItems
    const validators = contractItems.filter((i) => VALIDATOR_PATTERN.test(i.path ?? '') || CONSTANT_PATTERN.test(i.path ?? ''))
    const errors = contractItems.filter((i) => ERROR_PATTERN.test(i.path ?? ''))
    const schemas = contractItems.filter((i) => SCHEMA_PATTERN.test(i.path ?? ''))

    // v1.10.3 Batch 2 (F-003): the fixed per-group caps below are now treated as
    // initial reservations out of one shared required-first allocation pass, in this
    // same fixed priority order, rather than as isolated final caps (see
    // allocateRequiredGroups above). Group identities, candidate content, and
    // candidate rank/order are unchanged from Batch 1/pre-Batch-2.
    const allocations = allocateRequiredGroups([
      { kind: 'owners', items: ownerItems, reservation: 3 },
      { kind: 'dependencies', items: dependencyGroupItems, reservation: 10 },
      { kind: 'callers-and-callees', items: callersGroupItems, reservation: 15 },
      { kind: 'contracts', items: contractItems, reservation: 10 },
      { kind: 'validators-and-constants', items: validators, reservation: 10 },
      { kind: 'errors', items: errors, reservation: 10 },
      { kind: 'schemas-and-serializers', items: schemas, reservation: 10 },
      { kind: 'compatibility-surfaces', items: exportedSymbolItems, reservation: 8 },
      { kind: 'closest-tests', items: closestTestItems, reservation: 8 },
    ])
    const allocationByKind = new Map(allocations.map((a) => [a.kind, a]))
    const governingHardBound = allocations.reduce((sum, a) => sum + a.reservation, 0)
    const aggregateCapacityUsed = allocations.reduce((sum, a) => sum + a.selectedItems.length, 0)

    const provenanceByKind: Partial<Record<EvidenceGroupKind, string>> = {
      owners: 'structural ownership evidence (exported symbol, contract/canonical-type naming, classification, or graph producer relationship) over role-ranked candidates',
      dependencies: 'directed graph edges (seed -> neighbor) over one-hop adjacency reused from Batch 2 role ranking',
      'callers-and-callees': 'directed graph edges (both directions) over one-hop adjacency reused from Batch 2 role ranking',
      contracts: 'contract-like classification over role-ranked candidates',
      'validators-and-constants': 'validator/constant naming subset of contract-like candidates',
      errors: 'error naming subset of contract-like candidates',
      'schemas-and-serializers': 'schema naming subset of contract-like candidates',
      'compatibility-surfaces': 'exported symbol candidates (graph exported=true)',
      'closest-tests': 'test-file naming convention over role-ranked candidates',
    }

    function pushAllocatedGroup(kind: EvidenceGroupKind): EvidenceGroup {
      const allocation = allocationByKind.get(kind)
      if (!allocation) throw new Error(`Missing required-first allocation for evidence group "${kind}"`)
      return pushGroup(
        kind,
        allocation.selectedItems,
        {
          limit: allocation.effectiveLimit,
          required: true,
          provenance: `${provenanceByKind[kind]} (required-first allocation: reservation ${allocation.reservation}, borrowed ${allocation.borrowedCapacity})`,
          availableCountOverride: allocation.dedupedItems.length,
        },
        {
          required: true,
          reservation: allocation.reservation,
          initiallySelectedCount: allocation.initiallySelectedCount,
          unusedReservationContributed: allocation.unusedReservationContributed,
          borrowedCapacity: allocation.borrowedCapacity,
          requiredOmittedCount: allocation.requiredOmittedCount,
          optionalOmittedCount: 0,
          adequacyAffected: allocation.requiredOmittedCount > 0,
          governingHardBound,
          aggregateCapacityUsed,
          aggregateCapacityRemaining: governingHardBound - aggregateCapacityUsed,
        }
      )
    }

    const ownersGroup = pushAllocatedGroup('owners')
    pushAllocatedGroup('dependencies')
    pushAllocatedGroup('callers-and-callees')
    const contractsGroup = pushAllocatedGroup('contracts')
    pushAllocatedGroup('validators-and-constants')
    pushAllocatedGroup('errors')
    pushAllocatedGroup('schemas-and-serializers')
    pushAllocatedGroup('compatibility-surfaces')
    pushAllocatedGroup('closest-tests')
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

  return finalizeResult({ groups, selectedOwners, selectedContracts, selectedTests, testInfrastructure, unresolvedItems, warnings }, allocationDiagnostics)
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

function finalizeResult(result: Omit<BuildEvidenceGroupsResult, 'groupTruncation'>, allocationDiagnostics?: Map<string, Partial<GroupTruncationEntry>>): BuildEvidenceGroupsResult {
  const groupTruncation: GroupTruncationEntry[] = result.groups.map((g) => ({
    groupId: g.id,
    limit: g.limit,
    availableCount: g.availableCount,
    usedCount: g.usedCount,
    truncated: g.truncated,
    droppedCount: g.droppedCount,
    ...(allocationDiagnostics?.get(g.id) ?? {}),
  }))
  return { ...result, groupTruncation }
}

// Re-exported for tests/audit wiring convenience.
export type { PackageScriptEvidenceEntry, TestCommandEvidenceEntry, TestConfigurationEvidenceEntry }
