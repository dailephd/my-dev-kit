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
import { DEFAULT_TEST_INFRA_LIMITS, discoverTestInfrastructure, type BoundedList } from './testInfrastructureDiscovery.js'
import { CONSTANT_PATTERN, ERROR_PATTERN, SCHEMA_PATTERN, SIDE_EFFECT_PATTERN, VALIDATOR_PATTERN } from './evidencePatterns.js'
import { isFixtureLike, isGeneratedLike, isMockLike, isTestScoped } from './evidenceClassification.js'
import { classifyRoleConditionOmissions, evaluateRoleConditionCoverage } from './roleConditionCoverage.js'
import type { AndroidIntent } from './androidContextIntent.js'
import {
  androidOwnerEligible,
  candidateFileToPolicyInput,
  candidateNodeToPolicyInput,
  findAndroidUsageNodeIdsWithStrongerOwner,
  hasAndroidProvenance,
} from './androidContextOwnerPolicy.js'
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
  RoleConditionCoverage,
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
 * An explicit `requestLimits.evidenceGroupEntries` replaces each participating
 * group's reservation and is also its hard per-group limit. Without an explicit
 * value, the historical reservations and spillover behavior remain unchanged.
 */
export interface RequiredGroupAllocationInput {
  kind: EvidenceGroupKind
  items: EvidenceItemRef[]
  reservation: number
  hardLimit?: number
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
  omittedCount: number
}

function allocateRequiredGroups(inputs: RequiredGroupAllocationInput[]): RequiredGroupAllocationResult[] {
  const prepared = inputs.map((input) => {
    const dedupedItems = dedupeById(input.items)
    const initialLimit = Math.min(input.reservation, input.hardLimit ?? input.reservation)
    const initiallySelected = dedupedItems.slice(0, initialLimit)
    const remaining = dedupedItems.slice(initialLimit)
    const unusedReservationContributed = Math.max(0, input.reservation - dedupedItems.length)
    return { kind: input.kind, reservation: input.reservation, hardLimit: input.hardLimit, dedupedItems, initiallySelected, remaining, unusedReservationContributed }
  })

  let pool = prepared.reduce((sum, g) => sum + g.unusedReservationContributed, 0)

  return prepared.map((g): RequiredGroupAllocationResult => {
    let borrowedCapacity = 0
    let selectedItems = g.initiallySelected
    if (pool > 0 && g.remaining.length > 0) {
      const remainingHardCapacity = g.hardLimit === undefined
        ? g.remaining.length
        : Math.max(0, g.hardLimit - g.initiallySelected.length)
      const take = Math.min(pool, g.remaining.length, remainingHardCapacity)
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
      omittedCount: g.dedupedItems.length - selectedItems.length,
    }
  })
}

const TEST_IMPLEMENTATION_REQUIRED_RESERVATIONS: ReadonlyArray<{
  kind: EvidenceGroupKind
  reservation: number
}> = [
  { kind: 'contracts', reservation: 10 },
  { kind: 'validators-and-boundaries', reservation: 10 },
  { kind: 'errors-and-side-effects', reservation: 10 },
  { kind: 'related-tests', reservation: DEFAULT_TEST_INFRA_LIMITS.relatedTests },
  { kind: 'fixtures', reservation: DEFAULT_TEST_INFRA_LIMITS.fixtures },
  { kind: 'factories', reservation: DEFAULT_TEST_INFRA_LIMITS.factories },
  { kind: 'mocks', reservation: DEFAULT_TEST_INFRA_LIMITS.mocks },
  { kind: 'setup-and-configuration', reservation: DEFAULT_TEST_INFRA_LIMITS.setupFiles },
  { kind: 'test-commands', reservation: DEFAULT_TEST_INFRA_LIMITS.testCommands },
]

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
  return hasReasonMatching(
    candidate.reasons,
    /explicit focus (file|symbol)|direct graph neighbor|exact query-name match|changed-surface|android-intent-category-match/
  )
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

/** v1.12.0 Batch 6: Android owner-eligibility context, threaded from
 * `BuildEvidenceGroupsOptions` down to `isStructuralOwnerNode`/`File` so an
 * Android candidate (e.g. a Kotlin ViewModel classified `view-model`, which
 * `NON_OWNER_CLASSIFICATION_ROLES` below excludes for the *generic* frontend
 * meaning of that category) can be evaluated by the dedicated Android policy
 * instead. Never widens eligibility for a non-Android candidate. */
interface AndroidOwnerContext {
  androidIntents: ReadonlySet<AndroidIntent>
  isTestImplementationRole: boolean
  /** v1.12.0 Batch 6 correction: node IDs that are the "usage" side of a fixed
   * usage -> owner relationship (section 18/26) whose exact stronger owner is
   * also present among the candidate pool - these are suppressed from owner
   * eligibility (section 16/31.5) even though their own classification role
   * would otherwise pass `androidOwnerEligible` (e.g. a ViewModel-owned
   * `ui-only-state` fact once its linked ViewModel is also a candidate). */
  usageNodeIdsWithStrongerOwner: ReadonlySet<string>
}

function isStructuralOwnerNode(
  node: CandidateNode,
  ctx: { exportedNodeIds: Set<string>; producerIds: Set<string>; callerOnlyFilePaths: Set<string> },
  android: AndroidOwnerContext
): boolean {
  if (!hasRequestRelevance(node)) return false
  if (isForbiddenOwnerPath(node.filePath)) return false
  if (hasAndroidProvenance(candidateNodeToPolicyInput(node))) {
    if (android.usageNodeIdsWithStrongerOwner.has(node.nodeId)) return false
    return androidOwnerEligible(candidateNodeToPolicyInput(node), android.androidIntents, android.isTestImplementationRole)
  }
  if (hasNonOwnerClassification(node.classificationRoles)) return false
  if (isContractLike(node)) return true
  if (hasOwnerQualifyingClassification(node.classificationRoles)) return true
  if (ctx.producerIds.has(node.nodeId)) return true
  if (ctx.exportedNodeIds.has(node.nodeId) && !(node.filePath && ctx.callerOnlyFilePaths.has(node.filePath))) return true
  return false
}

function isStructuralOwnerFile(
  file: CandidateFile,
  ctx: { exportedFilePaths: Set<string>; producerIds: Set<string>; callerOnlyFilePaths: Set<string> },
  android: AndroidOwnerContext
): boolean {
  if (!hasRequestRelevance(file)) return false
  if (isForbiddenOwnerPath(file.path)) return false
  if (hasAndroidProvenance(candidateFileToPolicyInput(file))) {
    return androidOwnerEligible(candidateFileToPolicyInput(file), android.androidIntents, android.isTestImplementationRole)
  }
  if (hasNonOwnerClassification(file.classificationRoles)) return false
  if (isContractLike({ filePath: file.path, label: file.path })) return true
  if (hasOwnerQualifyingClassification(file.classificationRoles)) return true
  if (ctx.producerIds.has(`file:${file.path}`)) return true
  if (ctx.exportedFilePaths.has(file.path) && !ctx.callerOnlyFilePaths.has(file.path)) return true
  return false
}

/** Contract evidence may be neutral-named when the graph shows that the
 * implementation seed directly depends on it. Declaration kinds that can
 * describe a contract surface are intentionally narrower than "exported":
 * exported helper functions alone are not contract evidence. */
function isStructuralContractNode(
  node: CandidateNode,
  structuralContractIds: Set<string>
): boolean {
  if (isContractLike(node)) return true
  if (!hasRequestRelevance(node) || isForbiddenOwnerPath(node.filePath)) return false
  if (!(node.filePath ?? '').toLowerCase().endsWith('.py')) return false
  return structuralContractIds.has(node.nodeId)
}

function isStructuralContractFile(
  file: CandidateFile,
  structuralContractFilePaths: Set<string>
): boolean {
  if (isContractLike({ filePath: file.path, label: file.path })) return true
  if (!hasRequestRelevance(file) || isForbiddenOwnerPath(file.path)) return false
  return file.path.toLowerCase().endsWith('.py') && structuralContractFilePaths.has(file.path)
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
  /** v1.12.0 Batch 6: detected Android task intents for this request. Empty
   * set for a non-Android or intent-free query. */
  androidIntents?: ReadonlySet<AndroidIntent>
  /** Explicit per-group evidence limit from the normalized ContextRequest. */
  evidenceGroupEntries?: number
}

export interface BuildEvidenceGroupsResult {
  groups: EvidenceGroup[]
  selectedOwners: EvidenceItemRef[]
  selectedContracts: EvidenceItemRef[]
  selectedTests: EvidenceItemRef[]
  roleConditionCoverage: RoleConditionCoverage[]
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
  const retainedCandidateIds = new Set([...retainedNodes.map((n) => n.nodeId)])
  const androidOwnerContext: AndroidOwnerContext = {
    androidIntents: options.androidIntents ?? new Set<AndroidIntent>(),
    isTestImplementationRole: role === 'test-implementation',
    usageNodeIdsWithStrongerOwner: findAndroidUsageNodeIdsWithStrongerOwner(codeGraph, retainedCandidateIds),
  }
  const warnings: string[] = []
  let roleConditionCoverage: RoleConditionCoverage[] = []

  const nodeGraphById = new Map<string, CodeGraphNode>(codeGraph.nodes.map((n) => [n.id, n]))

  const seedNodeIds = computeSeedNodeIds({ codeGraph, focusIntake, changedSurface })
  const structuralContractIds = new Set<string>()
  const structuralContractFilePaths = new Set<string>()
  const contractDeclarationKinds = new Set(['class', 'interface', 'type', 'enum', 'const', 'variable'])
  const pathByNodeId = new Map(codeGraph.nodes.map((n) => [n.id, n.path]))
  for (const edge of codeGraph.edges) {
    if (!seedNodeIds.has(edge.source) || (edge.kind !== 'imports' && edge.kind !== 'depends-on' && edge.kind !== 'calls')) continue
    const target = nodeGraphById.get(edge.target)
    const targetPath = target?.path ?? pathByNodeId.get(edge.target) ?? (edge.target.startsWith('file:') ? edge.target.slice('file:'.length) : undefined)
    if (!targetPath || isForbiddenOwnerPath(targetPath)) continue
    if (target && target.kind === 'symbol' && target.symbolKind && contractDeclarationKinds.has(target.symbolKind)) {
      structuralContractIds.add(target.id)
      structuralContractFilePaths.add(targetPath)
    } else {
      const targetSymbols = codeGraph.nodes.filter((n) => n.path === targetPath && n.kind === 'symbol' && n.symbolKind && contractDeclarationKinds.has(n.symbolKind))
      if (targetSymbols.length > 0) {
        structuralContractFilePaths.add(targetPath)
        for (const symbol of targetSymbols) structuralContractIds.add(symbol.id)
      }
    }
  }

  const contractNodes = sortByScoreThenPath(retainedNodes.filter((n) => isStructuralContractNode(n, structuralContractIds)))
  const contractFiles = sortByScoreThenPath(retainedFiles.filter((f) => isStructuralContractFile(f, structuralContractFilePaths)))
  const contractItems = [
    ...contractNodes.map((n) => nodeToItem(n, 'contract-like candidate', isContractLike(n) ? 'contract/validator/schema/error naming heuristic' : 'direct implementation dependency with contract-bearing declaration kind')),
    ...contractFiles.map((f) => fileToItem(f, 'contract-like candidate', isContractLike({ filePath: f.path, label: f.path }) ? 'contract/validator/schema/error naming heuristic' : 'direct implementation dependency with contract-bearing declaration kind')),
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

  const ownerNodes = sortByScoreThenPath(retainedNodes.filter((n) => isStructuralOwnerNode(n, { exportedNodeIds, producerIds, callerOnlyFilePaths }, androidOwnerContext)))
  const ownerFiles = sortByScoreThenPath(retainedFiles.filter((f) => isStructuralOwnerFile(f, { exportedFilePaths, producerIds, callerOnlyFilePaths }, androidOwnerContext)))
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
    const extensionPoints = ownerItems.filter((item) => adjacentItems.some((a) => a.id === item.id))
    const architectureInputs: RequiredGroupAllocationInput[] = [
      { kind: 'owners', items: ownerItems, reservation: options.evidenceGroupEntries ?? 5, hardLimit: options.evidenceGroupEntries ?? 5 },
      { kind: 'extension-points', items: extensionPoints, reservation: options.evidenceGroupEntries ?? 8, hardLimit: options.evidenceGroupEntries ?? 8 },
      { kind: 'contracts', items: contractItems, reservation: options.evidenceGroupEntries ?? 10, hardLimit: options.evidenceGroupEntries ?? 10 },
      { kind: 'architecture-tests', items: closestTestItems, reservation: options.evidenceGroupEntries ?? 8, hardLimit: options.evidenceGroupEntries ?? 8 },
    ]
    const allocations = allocateRequiredGroups(architectureInputs)
    roleConditionCoverage = evaluateRoleConditionCoverage({
      role,
      evidenceGroups: allocations.map((allocation) => ({
        groupId: `${role}-${allocation.kind}`,
        availableItems: allocation.dedupedItems,
        retainedItems: allocation.selectedItems,
      })),
    })
    const allocationByKind = new Map(allocations.map((allocation) => [allocation.kind, allocation]))
    function pushArchitectureGroup(kind: EvidenceGroupKind, provenance: string): EvidenceGroup {
      const allocation = allocationByKind.get(kind)
      if (!allocation) throw new Error(`Missing architecture allocation for evidence group "${kind}"`)
      return pushGroup(kind, allocation.selectedItems, {
        limit: allocation.effectiveLimit,
        required: true,
        provenance,
        availableCountOverride: allocation.dedupedItems.length,
      }, {
        required: true,
        reservation: allocation.reservation,
        initiallySelectedCount: allocation.initiallySelectedCount,
        unusedReservationContributed: allocation.unusedReservationContributed,
        borrowedCapacity: allocation.borrowedCapacity,
      })
    }
    const ownersGroup = pushArchitectureGroup('owners', 'structural ownership evidence (exported symbol, contract/canonical-type naming, classification, or graph producer relationship) over role-ranked candidates')
    pushArchitectureGroup('extension-points', 'structural owners that are also graph-adjacent to the focus/seed')
    const contractsGroup = pushArchitectureGroup('contracts', 'contract-like classification over role-ranked candidates')
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
    pushArchitectureGroup('architecture-tests', 'test-file naming convention over role-ranked candidates')
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
    const explicitLimit = options.evidenceGroupEntries
    const allocationInput = (kind: EvidenceGroupKind, items: EvidenceItemRef[], defaultReservation: number): RequiredGroupAllocationInput => ({
      kind,
      items,
      reservation: explicitLimit ?? defaultReservation,
      ...(explicitLimit === undefined ? {} : { hardLimit: explicitLimit }),
    })
    const allocations = allocateRequiredGroups([
      allocationInput('owners', ownerItems, 3),
      allocationInput('dependencies', dependencyGroupItems, 10),
      allocationInput('callers-and-callees', callersGroupItems, 15),
      allocationInput('contracts', contractItems, 10),
      allocationInput('validators-and-constants', validators, 10),
      allocationInput('errors', errors, 10),
      allocationInput('schemas-and-serializers', schemas, 10),
      allocationInput('compatibility-surfaces', exportedSymbolItems, 8),
      allocationInput('closest-tests', closestTestItems, 8),
    ])
    roleConditionCoverage = evaluateRoleConditionCoverage({
      role,
      evidenceGroups: allocations.map((allocation) => ({
        groupId: `${role}-${allocation.kind}`,
        availableItems: allocation.dedupedItems,
        retainedItems: allocation.selectedItems,
      })),
    })
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
    const validators = contractItems.filter((i) => VALIDATOR_PATTERN.test(i.path ?? i.id) || CONSTANT_PATTERN.test(i.path ?? i.id))
    const errorsAndSideEffects = contractItems
      .filter((i) => ERROR_PATTERN.test(i.path ?? i.id))
      .concat(adjacentItems.filter((i) => SIDE_EFFECT_PATTERN.test(i.path ?? i.id)))

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

    const testConfigurationItems: EvidenceItemRef[] = infra.testConfigurations.candidates.map((configuration) => ({
      id: `test-config:${configuration.path}`,
      itemKind: 'file',
      path: configuration.path,
      sourceLocation: { filePath: configuration.path },
      relationship: configuration.supported ? 'supported-test-configuration' : 'detected-unsupported-test-configuration',
      basis: `static ${configuration.framework} configuration discovery`,
      provenance: `test-configuration:${configuration.path}`,
      metadata: { framework: configuration.framework, supported: configuration.supported },
    }))
    const setupAndConfigItems = [...infra.setupFiles.candidates, ...testConfigurationItems]
    const testCommandItems: EvidenceItemRef[] = infra.testCommands.candidates.map((c) => ({
      id: c.commandText ?? `unresolved:${c.commandSource}`,
      itemKind: 'command',
      relationship: c.scope,
      basis: c.basis,
      provenance: c.commandSource,
      metadata: { commandText: c.commandText, framework: c.framework, scope: c.scope },
    }))

    const candidatesByKind = new Map<EvidenceGroupKind, EvidenceItemRef[]>([
      ['contracts', contractItems],
      ['validators-and-boundaries', validators],
      ['errors-and-side-effects', errorsAndSideEffects],
      ['related-tests', infra.relatedTests.candidates],
      ['fixtures', infra.fixtures.candidates],
      ['factories', infra.factories.candidates],
      ['mocks', infra.mocks.candidates],
      ['setup-and-configuration', setupAndConfigItems],
      ['test-commands', testCommandItems],
    ])
    const explicitLimit = options.evidenceGroupEntries
    const allocations = allocateRequiredGroups(
      TEST_IMPLEMENTATION_REQUIRED_RESERVATIONS.map(({ kind, reservation }) => ({
        kind,
        items: candidatesByKind.get(kind) ?? [],
        reservation: explicitLimit ?? reservation,
        ...(explicitLimit === undefined ? {} : { hardLimit: explicitLimit }),
      }))
    )
    const allocationByKind = new Map(allocations.map((allocation) => [allocation.kind, allocation]))
    const governingHardBound = allocations.reduce((sum, allocation) => sum + allocation.reservation, 0)
    const aggregateCapacityUsed = allocations.reduce((sum, allocation) => sum + allocation.selectedItems.length, 0)
    const provenanceByKind: Partial<Record<EvidenceGroupKind, string>> = {
      contracts: 'contract-like classification over role-ranked candidates',
      'validators-and-boundaries': 'validator/constant naming subset of contract-like candidates',
      'errors-and-side-effects': 'error-naming candidates plus conservative side-effect-boundary naming over graph-adjacent candidates',
      'related-tests': 'coverage-aware compact references from import scans over selected/changed production evidence',
      fixtures: 'graph import edges from related tests',
      factories: 'graph import edges from related tests',
      mocks: 'graph import edges from related tests',
      'setup-and-configuration': 'test configuration and setup-file discovery',
      'test-commands': 'derived from package.json test script + discovered related tests',
    }

    function pushAllocatedTestGroup(kind: EvidenceGroupKind): EvidenceGroup {
      const allocation = allocationByKind.get(kind)
      if (!allocation) throw new Error(`Missing test-role required-first allocation for evidence group "${kind}"`)
      const selectedIds = new Set(allocation.selectedItems.map((item) => item.id))
      const droppedEvidenceIds = allocation.dedupedItems
        .filter((item) => !selectedIds.has(item.id))
        .map((item) => item.id)
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
          governingHardBound,
          aggregateCapacityUsed,
          aggregateCapacityRemaining: governingHardBound - aggregateCapacityUsed,
          droppedEvidenceIds,
        }
      )
    }

    const contractsGroup = pushAllocatedTestGroup('contracts')
    pushAllocatedTestGroup('validators-and-boundaries')
    pushAllocatedTestGroup('errors-and-side-effects')
    const relatedTestsGroup = pushAllocatedTestGroup('related-tests')
    const fixturesGroup = pushAllocatedTestGroup('fixtures')
    const factoriesGroup = pushAllocatedTestGroup('factories')
    const mocksGroup = pushAllocatedTestGroup('mocks')
    const setupAndConfigurationGroup = pushAllocatedTestGroup('setup-and-configuration')
    const testCommandsGroup = pushAllocatedTestGroup('test-commands')

    unresolvedItems.push(...infra.unresolved)
    selectedTests = relatedTestsGroup.items
    selectedContracts = contractsGroup.items

    const selectedSetupAndConfigurationIds = new Set(setupAndConfigurationGroup.items.map((item) => item.id))
    const selectedTestCommandIds = new Set(testCommandsGroup.items.map((item) => item.id))

    return finalizeResult({
      groups,
      selectedOwners,
      selectedContracts,
      selectedTests,
      roleConditionCoverage,
      testInfrastructure: {
        relatedTests: relatedTestsGroup.items,
        fixtures: fixturesGroup.items,
        factories: factoriesGroup.items,
        mocks: mocksGroup.items,
        setupFiles: infra.setupFiles.candidates.filter((item) => selectedSetupAndConfigurationIds.has(item.id)),
        testConfigurations: infra.testConfigurations.candidates.filter((item) => selectedSetupAndConfigurationIds.has(`test-config:${item.path}`)),
        packageScripts: infra.packageScripts.items,
        testCommands: infra.testCommands.candidates.filter((command) =>
          selectedTestCommandIds.has(command.commandText ?? `unresolved:${command.commandSource}`)
        ),
        unresolved: infra.unresolved,
        warnings: infra.warnings,
      },
      unresolvedItems,
      warnings,
    }, allocationDiagnostics)
  } else {
    // Legacy (no-role) requests: evidence groups remain empty (TST-B3-029). No grouping,
    // no test-infrastructure discovery is run — this preserves the pre-Batch-3 capsule shape.
    return finalizeResult({
      groups: [],
      selectedOwners: [],
      selectedContracts: [],
      selectedTests: [],
      roleConditionCoverage: [],
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

  return finalizeResult({ groups, selectedOwners, selectedContracts, selectedTests, roleConditionCoverage, testInfrastructure, unresolvedItems, warnings }, allocationDiagnostics)
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
  const rawGroupTruncation: GroupTruncationEntry[] = result.groups.map((g) => ({
    groupId: g.id,
    limit: g.limit,
    availableCount: g.availableCount,
    usedCount: g.usedCount,
    truncated: g.truncated,
    droppedCount: g.droppedCount,
    required: g.required,
    ...(allocationDiagnostics?.get(g.id) ?? {}),
  }))
  const groupTruncation = classifyRoleConditionOmissions({
    groupTruncation: rawGroupTruncation,
    roleConditionCoverage: result.roleConditionCoverage.length > 0
      ? result.roleConditionCoverage
      : undefined,
  })
  return { ...result, groupTruncation }
}

// Re-exported for tests/audit wiring convenience.
export type { PackageScriptEvidenceEntry, TestCommandEvidenceEntry, TestConfigurationEvidenceEntry }
