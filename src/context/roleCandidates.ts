import type { CodeGraph, CodeGraphNode } from '../graph/codeGraphTypes.js'
import { getRoleDefinition } from './contextRoles.js'
import type { AndroidIntent } from './androidContextIntent.js'
import {
  androidIntentRankingBoost,
  candidateFileToPolicyInput,
  candidateNodeToPolicyInput,
  findAndroidOwnerSupportNodeIds,
  hasAndroidProvenance,
} from './androidContextOwnerPolicy.js'
import type {
  CandidateFile,
  CandidateNode,
  ChangedSurface,
  ChangedSurfaceStatus,
  ContextFocusIntake,
  ContextRole,
  RequestedEvidenceKind,
} from './types.js'

/** `requestedEvidenceKinds` entries owned by a later v1.10.1 batch. Accepted and
 * structurally validated (Batch 1), but must not influence Batch 2 candidate selection.
 *
 * v1.10.1 Batch 3 operationalized `test-infrastructure` and `test-commands` (see
 * `evidenceGroups.ts`/`testInfrastructureDiscovery.ts`). v1.10.1 Batch 4 operationalizes
 * the last one, `responsibility-mappings` (see `responsibilityMapping.ts`); none remain. */
const LATER_BATCH_EVIDENCE_KINDS: readonly RequestedEvidenceKind[] = []

export const OWNER_LIKE_PATTERN = /(command|registry|dispatcher|adapter|analyzer|builder|producer|manager)/i
export const CONTRACT_LIKE_PATTERN = /(types?|schema|valid|constant|error)/i
export const TEST_LIKE_PATTERN = /(^|[\\/])(__tests__[\\/].*|.*\.(spec|test))\.[jt]sx?$/i
const REQUESTED_KIND_BOOST = 8

/** Shared basename helper: single owner reused by `evidenceClassification.ts` (Batch 3). */
export function basename(filePath: string | undefined): string {
  if (!filePath) return ''
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] ?? filePath
}

export function stripExt(name: string): string {
  return name.replace(/\.[jt]sx?$/i, '')
}

interface AdjustmentResult {
  adjustment: number
  reasons: string[]
  focusMatch: boolean
  changedSurfaceMatch: boolean
  changedStatus?: ChangedSurfaceStatus
}

export interface ApplyRoleAwareCandidatesOptions {
  role: ContextRole | null
  candidateFiles: CandidateFile[]
  candidateNodes: CandidateNode[]
  focusIntake: ContextFocusIntake
  changedSurface: ChangedSurface
  requestedEvidenceKinds: RequestedEvidenceKind[]
  codeGraph: CodeGraph
  maxCandidateFiles: number | null
  /** v1.12.0 Batch 6: detected Android task intents for this request's normalized
   * query. Empty set for a non-Android or intent-free query - the Android
   * ranking boost is then always 0, so non-Android/legacy ranking is unchanged. */
  androidIntents?: ReadonlySet<AndroidIntent>
}

export interface ApplyRoleAwareCandidatesResult {
  candidateFiles: CandidateFile[]
  candidateNodes: CandidateNode[]
  unsupportedRequestedEvidenceKinds: RequestedEvidenceKind[]
  warnings: string[]
}

/**
 * Applies role-aware ranking adjustments and bounded candidate injection on
 * top of the existing `rankCandidateFiles`/`rankCandidateNodes` output.
 * Additive layer only: never re-implements search or base ranking, never
 * changes the existing `--max-candidate-files` retained/dropped boundary
 * (role adjustments are applied within the already-retained set only).
 */
export function applyRoleAwareCandidates(options: ApplyRoleAwareCandidatesOptions): ApplyRoleAwareCandidatesResult {
  const { role, focusIntake, changedSurface, requestedEvidenceKinds, codeGraph } = options
  const definition = getRoleDefinition(role)
  const warnings: string[] = []

  if (role === 'test-implementation' && definition.missingChangedSurfaceWarning && !changedSurface.available) {
    warnings.push(definition.missingChangedSurfaceWarning)
  }

  const focusFilePaths = new Set(
    focusIntake.focusFiles.filter((entry) => entry.resolved).flatMap((entry) => entry.matchedFilePaths)
  )
  const focusContainedSymbolIds = new Set(
    focusIntake.focusFiles.filter((entry) => entry.resolved).flatMap((entry) => entry.containedSymbolIds)
  )
  const focusSymbolNodeIds = new Set(
    focusIntake.focusSymbols.filter((entry) => entry.resolved && !entry.ambiguous).flatMap((entry) => entry.matchedNodeIds)
  )

  const changedFileStatus = new Map(changedSurface.files.map((entry) => [entry.path, entry.status] as const))
  const changedSymbolStatus = new Map(changedSurface.symbols.map((entry) => [entry.symbolId, entry.status] as const))

  // Seed with the focus/changed symbol node IDs *and* their containing file node
  // IDs: most indexes (without --call-graph) only carry file-level import/depends-on
  // edges, not symbol-to-symbol call edges, so file-level seeding is required for
  // "direct dependency" adjacency to find anything.
  const symbolNodeById = new Map(codeGraph.nodes.map((node) => [node.id, node]))
  const seedNodeIds = new Set<string>([...focusSymbolNodeIds, ...changedSurface.symbols.map((entry) => entry.symbolId)])
  for (const id of [...seedNodeIds]) {
    const path = symbolNodeById.get(id)?.path
    if (path) seedNodeIds.add(`file:${path}`)
  }
  for (const path of focusFilePaths) seedNodeIds.add(`file:${path}`)
  const adjacentNodeIds = computeAdjacency(codeGraph, seedNodeIds)
  const adjacentFilePaths = filePathsForNodeIds(codeGraph, adjacentNodeIds)

  const requestedSet = new Set(requestedEvidenceKinds)
  const unsupportedRequestedEvidenceKinds = requestedEvidenceKinds.filter((kind) =>
    LATER_BATCH_EVIDENCE_KINDS.includes(kind)
  )
  for (const kind of unsupportedRequestedEvidenceKinds) {
    warnings.push(`Requested evidence kind "${kind}" is owned by a later v1.10.1 batch and remains deferred; it did not affect candidate selection.`)
  }

  // --- nodes ---
  const nodeById = new Map(options.candidateNodes.map((node) => [node.nodeId, node]))
  const injectedNodes = injectFocusAndChangedNodeCandidates({
    codeGraph,
    existingIds: nodeById,
    focusSymbolNodeIds,
    changedSurface,
  })
  const androidIntents = options.androidIntents ?? new Set<AndroidIntent>()
  const androidOwnerSupportNodes = injectAndroidOwnerSupportCandidates({
    codeGraph,
    existingIds: nodeById,
    candidateNodes: options.candidateNodes,
    androidIntents,
  })
  const allNodes = [...options.candidateNodes, ...injectedNodes, ...androidOwnerSupportNodes]
  const rankedNodes = allNodes.map((node) => {
    const result = scoreNodeAdjustment({
      node,
      definition,
      focusFilePaths,
      focusContainedSymbolIds,
      focusSymbolNodeIds,
      changedFileStatus,
      changedSymbolStatus,
      adjacentNodeIds,
      requestedSet,
      androidIntents,
    })
    return applyNodeAdjustment(node, result, role)
  })
  rankedNodes.sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId))

  // --- files ---
  const retained = options.candidateFiles.filter((file) => file.retained)
  const dropped = options.candidateFiles.filter((file) => !file.retained)
  const existingFilePaths = new Set(options.candidateFiles.map((file) => file.path))
  const injectedFiles = injectFocusAndChangedFileCandidates({
    existingPaths: existingFilePaths,
    focusIntake,
    changedSurface,
    adjacentFilePaths,
  })

  const rankedRetainedCandidates = [...retained, ...injectedFiles].map((file) => {
    const result = scoreFileAdjustment({ file, definition, focusFilePaths, changedFileStatus, adjacentFilePaths, requestedSet, androidIntents })
    return applyFileAdjustment(file, result, role)
  })
  rankedRetainedCandidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))

  // Re-apply --max-candidate-files after injection: injected focus/changed-surface
  // candidates must never bypass the existing candidate cap (TST-B2-022).
  const maxCandidateFiles = options.maxCandidateFiles
  const finalRetained =
    maxCandidateFiles != null ? rankedRetainedCandidates.slice(0, maxCandidateFiles) : rankedRetainedCandidates
  const overflow = maxCandidateFiles != null ? rankedRetainedCandidates.slice(maxCandidateFiles) : []
  const overflowAsDropped = overflow.map((file) => ({
    ...file,
    retained: false,
    droppedReason: file.droppedReason ?? 'cap exceeded (--max-candidate-files)',
  }))

  return {
    candidateFiles: [...finalRetained, ...overflowAsDropped, ...dropped],
    candidateNodes: rankedNodes,
    unsupportedRequestedEvidenceKinds: [...unsupportedRequestedEvidenceKinds].sort(),
    warnings,
  }
}

function computeAdjacency(codeGraph: CodeGraph, seedNodeIds: Set<string>): Set<string> {
  const adjacent = new Set<string>()
  if (seedNodeIds.size === 0) return adjacent
  for (const edge of codeGraph.edges) {
    if (seedNodeIds.has(edge.source) && !seedNodeIds.has(edge.target)) adjacent.add(edge.target)
    if (seedNodeIds.has(edge.target) && !seedNodeIds.has(edge.source)) adjacent.add(edge.source)
  }
  return adjacent
}

function filePathsForNodeIds(codeGraph: CodeGraph, nodeIds: Set<string>): Set<string> {
  const paths = new Set<string>()
  if (nodeIds.size === 0) return paths
  for (const node of codeGraph.nodes) {
    if (nodeIds.has(node.id) && node.path) paths.add(node.path)
  }
  return paths
}

export function isOwnerLike(node: { filePath?: string; label: string }): boolean {
  return OWNER_LIKE_PATTERN.test(basename(node.filePath) || node.label)
}

export function isContractLike(node: { filePath?: string; label: string }): boolean {
  return CONTRACT_LIKE_PATTERN.test(basename(node.filePath) || node.label)
}

export function isTestLike(filePath: string | undefined): boolean {
  return filePath !== undefined && TEST_LIKE_PATTERN.test(filePath)
}

function hasExactQueryMatch(matchedTerms: string[], filePath: string | undefined, label: string): boolean {
  const candidates = new Set([stripExt(basename(filePath)).toLowerCase(), label.toLowerCase()])
  return matchedTerms.some((term) => candidates.has(term.toLowerCase()))
}

function scoreNodeAdjustment(input: {
  node: CandidateNode
  definition: ReturnType<typeof getRoleDefinition>
  focusFilePaths: Set<string>
  focusContainedSymbolIds: Set<string>
  focusSymbolNodeIds: Set<string>
  changedFileStatus: Map<string, ChangedSurfaceStatus>
  changedSymbolStatus: Map<string, ChangedSurfaceStatus>
  adjacentNodeIds: Set<string>
  requestedSet: Set<RequestedEvidenceKind>
  androidIntents: ReadonlySet<AndroidIntent>
}): AdjustmentResult {
  const { node, definition, focusFilePaths, focusContainedSymbolIds, focusSymbolNodeIds, changedFileStatus, changedSymbolStatus, adjacentNodeIds, requestedSet, androidIntents } = input
  let adjustment = 0
  const reasons: string[] = []
  let focusMatch = false
  let changedSurfaceMatch = false
  let changedStatus: ChangedSurfaceStatus | undefined

  if (focusSymbolNodeIds.has(node.nodeId)) {
    adjustment += definition.focusSymbolExactBoost
    reasons.push(`role adjustment: explicit focus symbol (exact match) (+${definition.focusSymbolExactBoost})`)
    focusMatch = true
  } else if ((node.filePath && focusFilePaths.has(node.filePath)) || focusContainedSymbolIds.has(node.nodeId)) {
    adjustment += definition.focusFileBoost
    reasons.push(`role adjustment: explicit focus file (+${definition.focusFileBoost})`)
    focusMatch = true
  }

  const nodeChangedStatus = changedSymbolStatus.get(node.nodeId) ?? (node.filePath ? changedFileStatus.get(node.filePath) : undefined)
  if (changedSymbolStatus.has(node.nodeId)) {
    changedStatus = changedSymbolStatus.get(node.nodeId)
    adjustment += definition.changedSymbolBoost
    reasons.push(`role adjustment: changed-surface symbol match (${changedStatus}) (+${definition.changedSymbolBoost})`)
    changedSurfaceMatch = true
    if (requestedSet.has('changed-surface')) {
      adjustment += REQUESTED_KIND_BOOST
      reasons.push(`role adjustment: requested evidence kind "changed-surface" matched (+${REQUESTED_KIND_BOOST})`)
    }
  } else if (node.filePath && changedFileStatus.has(node.filePath)) {
    changedStatus = changedFileStatus.get(node.filePath)
    adjustment += definition.changedFileBoost
    reasons.push(`role adjustment: changed-surface file match (${changedStatus}) (+${definition.changedFileBoost})`)
    changedSurfaceMatch = true
    if (requestedSet.has('changed-surface')) {
      adjustment += REQUESTED_KIND_BOOST
      reasons.push(`role adjustment: requested evidence kind "changed-surface" matched (+${REQUESTED_KIND_BOOST})`)
    }
  }
  void nodeChangedStatus

  if (isOwnerLike(node) && definition.ownerLikeBoost > 0) {
    adjustment += definition.ownerLikeBoost
    reasons.push(`role adjustment: owner-like candidate (+${definition.ownerLikeBoost})`)
    if (requestedSet.has('owner')) {
      adjustment += REQUESTED_KIND_BOOST
      reasons.push(`role adjustment: requested evidence kind "owner" matched (+${REQUESTED_KIND_BOOST})`)
    }
  }
  if (isContractLike(node) && definition.contractLikeBoost > 0) {
    adjustment += definition.contractLikeBoost
    reasons.push(`role adjustment: contract/validator-like candidate (+${definition.contractLikeBoost})`)
    const matchedContractKind = (['contracts', 'validators', 'constants', 'errors', 'schemas'] as const).find((kind) => requestedSet.has(kind))
    if (matchedContractKind) {
      adjustment += REQUESTED_KIND_BOOST
      reasons.push(`role adjustment: requested evidence kind "${matchedContractKind}" matched (+${REQUESTED_KIND_BOOST})`)
    }
  }
  if (adjacentNodeIds.has(node.nodeId) && definition.adjacentBoost > 0) {
    adjustment += definition.adjacentBoost
    reasons.push(`role adjustment: direct graph neighbor of a focus/changed-surface symbol (+${definition.adjacentBoost})`)
    const matchedDependencyKind = (['dependencies', 'callers', 'callees'] as const).find((kind) => requestedSet.has(kind))
    if (matchedDependencyKind) {
      adjustment += REQUESTED_KIND_BOOST
      reasons.push(`role adjustment: requested evidence kind "${matchedDependencyKind}" matched (+${REQUESTED_KIND_BOOST})`)
    }
  }
  if (hasExactQueryMatch(node.matchedTerms, node.filePath, node.label) && definition.exactQueryMatchBoost > 0) {
    adjustment += definition.exactQueryMatchBoost
    reasons.push(`role adjustment: exact query-name match (+${definition.exactQueryMatchBoost})`)
  }
  if (isTestLike(node.filePath) && definition.closestTestBoost > 0) {
    adjustment += definition.closestTestBoost
    reasons.push(`role adjustment: closest-test candidate (+${definition.closestTestBoost})`)
    if (requestedSet.has('closest-tests')) {
      adjustment += REQUESTED_KIND_BOOST
      reasons.push(`role adjustment: requested evidence kind "closest-tests" matched (+${REQUESTED_KIND_BOOST})`)
    }
  }

  const androidBoost = androidIntentRankingBoost(candidateNodeToPolicyInput(node), androidIntents)
  if (androidBoost.boost > 0 && androidBoost.reason) {
    adjustment += androidBoost.boost
    reasons.push(`${androidBoost.reason} (+${androidBoost.boost})`)
  }

  return { adjustment, reasons, focusMatch, changedSurfaceMatch, changedStatus }
}

function scoreFileAdjustment(input: {
  file: CandidateFile
  definition: ReturnType<typeof getRoleDefinition>
  focusFilePaths: Set<string>
  changedFileStatus: Map<string, ChangedSurfaceStatus>
  adjacentFilePaths: Set<string>
  requestedSet: Set<RequestedEvidenceKind>
  androidIntents: ReadonlySet<AndroidIntent>
}): AdjustmentResult {
  const { file, definition, focusFilePaths, changedFileStatus, adjacentFilePaths, requestedSet, androidIntents } = input
  let adjustment = 0
  const reasons: string[] = []
  let focusMatch = false
  let changedSurfaceMatch = false
  let changedStatus: ChangedSurfaceStatus | undefined

  if (focusFilePaths.has(file.path)) {
    adjustment += definition.focusFileBoost
    reasons.push(`role adjustment: explicit focus file (+${definition.focusFileBoost})`)
    focusMatch = true
  }
  if (changedFileStatus.has(file.path)) {
    changedStatus = changedFileStatus.get(file.path)
    adjustment += definition.changedFileBoost
    reasons.push(`role adjustment: changed-surface file match (${changedStatus}) (+${definition.changedFileBoost})`)
    changedSurfaceMatch = true
    if (requestedSet.has('changed-surface')) {
      adjustment += REQUESTED_KIND_BOOST
      reasons.push(`role adjustment: requested evidence kind "changed-surface" matched (+${REQUESTED_KIND_BOOST})`)
    }
  }
  if (isOwnerLike({ filePath: file.path, label: file.path }) && definition.ownerLikeBoost > 0) {
    adjustment += definition.ownerLikeBoost
    reasons.push(`role adjustment: owner-like candidate (+${definition.ownerLikeBoost})`)
    if (requestedSet.has('owner')) {
      adjustment += REQUESTED_KIND_BOOST
      reasons.push(`role adjustment: requested evidence kind "owner" matched (+${REQUESTED_KIND_BOOST})`)
    }
  }
  if (isContractLike({ filePath: file.path, label: file.path }) && definition.contractLikeBoost > 0) {
    adjustment += definition.contractLikeBoost
    reasons.push(`role adjustment: contract/validator-like candidate (+${definition.contractLikeBoost})`)
    const matchedContractKind = (['contracts', 'validators', 'constants', 'errors', 'schemas'] as const).find((kind) => requestedSet.has(kind))
    if (matchedContractKind) {
      adjustment += REQUESTED_KIND_BOOST
      reasons.push(`role adjustment: requested evidence kind "${matchedContractKind}" matched (+${REQUESTED_KIND_BOOST})`)
    }
  }
  if (adjacentFilePaths.has(file.path) && definition.adjacentBoost > 0) {
    adjustment += definition.adjacentBoost
    reasons.push(`role adjustment: contains a direct graph neighbor of a focus/changed-surface symbol (+${definition.adjacentBoost})`)
    const matchedDependencyKind = (['dependencies', 'callers', 'callees'] as const).find((kind) => requestedSet.has(kind))
    if (matchedDependencyKind) {
      adjustment += REQUESTED_KIND_BOOST
      reasons.push(`role adjustment: requested evidence kind "${matchedDependencyKind}" matched (+${REQUESTED_KIND_BOOST})`)
    }
  }
  if (isTestLike(file.path) && definition.closestTestBoost > 0) {
    adjustment += definition.closestTestBoost
    reasons.push(`role adjustment: closest-test candidate (+${definition.closestTestBoost})`)
    if (requestedSet.has('closest-tests')) {
      adjustment += REQUESTED_KIND_BOOST
      reasons.push(`role adjustment: requested evidence kind "closest-tests" matched (+${REQUESTED_KIND_BOOST})`)
    }
  }

  const androidBoost = androidIntentRankingBoost(candidateFileToPolicyInput(file), androidIntents)
  if (androidBoost.boost > 0 && androidBoost.reason) {
    adjustment += androidBoost.boost
    reasons.push(`${androidBoost.reason} (+${androidBoost.boost})`)
  }

  return { adjustment, reasons, focusMatch, changedSurfaceMatch, changedStatus }
}

function applyNodeAdjustment(node: CandidateNode, result: AdjustmentResult, role: ContextRole | null): CandidateNode {
  if (result.adjustment === 0 && !result.focusMatch && !result.changedSurfaceMatch) return node
  return {
    ...node,
    score: node.score + result.adjustment,
    reasons: [...node.reasons, ...result.reasons],
    roleScoreAdjustment: result.adjustment,
    ...(role ? { contextRole: role } : {}),
    ...(result.focusMatch ? { focusMatch: true } : {}),
    ...(result.changedSurfaceMatch ? { changedSurfaceMatch: true, changedStatus: result.changedStatus } : {}),
  }
}

function applyFileAdjustment(file: CandidateFile, result: AdjustmentResult, role: ContextRole | null): CandidateFile {
  if (result.adjustment === 0 && !result.focusMatch && !result.changedSurfaceMatch) return file
  return {
    ...file,
    score: file.score + result.adjustment,
    reasons: [...file.reasons, ...result.reasons],
    roleScoreAdjustment: result.adjustment,
    ...(role ? { contextRole: role } : {}),
    ...(result.focusMatch ? { focusMatch: true } : {}),
    ...(result.changedSurfaceMatch ? { changedSurfaceMatch: true, changedStatus: result.changedStatus } : {}),
  }
}

const MAX_SYNTHESIZED_NODES = 40
const MAX_SYNTHESIZED_FILES = 40

function injectFocusAndChangedNodeCandidates(input: {
  codeGraph: CodeGraph
  existingIds: Map<string, CandidateNode>
  focusSymbolNodeIds: Set<string>
  changedSurface: ChangedSurface
}): CandidateNode[] {
  const { codeGraph, existingIds, focusSymbolNodeIds, changedSurface } = input
  const nodeById = new Map(codeGraph.nodes.map((node) => [node.id, node]))
  const wantedIds = new Set<string>([...focusSymbolNodeIds, ...changedSurface.symbols.map((entry) => entry.symbolId)])

  const injected: CandidateNode[] = []
  for (const id of [...wantedIds].sort()) {
    if (existingIds.has(id)) continue
    if (injected.length >= MAX_SYNTHESIZED_NODES) break
    const graphNode = nodeById.get(id)
    if (!graphNode) continue // e.g. a removed symbol with no current graph node; preserved only in changedSurface, never fabricated here
    injected.push(toSyntheticCandidateNode(graphNode))
  }
  return injected
}

function toSyntheticCandidateNode(node: CodeGraphNode): CandidateNode {
  return {
    nodeId: node.id,
    kind: node.kind === 'symbol' ? 'symbol' : 'file',
    label: node.label,
    ...(node.path ? { filePath: node.path } : {}),
    score: 0,
    baseScore: 0,
    modeAdjustment: 0,
    reasons: ['synthesized: explicit focus symbol or changed-surface symbol not present in search results'],
    matchedTerms: [],
    retained: true,
    synthesized: true,
  }
}

const MAX_ANDROID_OWNER_SUPPORT_INJECTED_NODES = 40

/**
 * v1.12.0 Batch 6 correction: threads the existing (previously unused)
 * `findAndroidOwnerSupportNodeIds` bounded traversal into the actual candidate
 * pipeline. Without this, an Android owner reachable only through graph
 * relationships (e.g. a ViewModel reachable from an anchored Compose screen
 * candidate via `compose-state-reads-viewmodel`) could never become a
 * candidate at all when the query's vocabulary does not textually match it -
 * silently defeating the intent-to-category ranking boost for the exact
 * "named-screen state request" scenario the policy is meant to resolve.
 * Seeds only from already-retained Android-provenance candidates (never a
 * non-Android seed), and only when at least one Android intent was detected -
 * so non-Android/legacy candidate generation is completely unaffected.
 */
function injectAndroidOwnerSupportCandidates(input: {
  codeGraph: CodeGraph
  existingIds: Map<string, CandidateNode>
  candidateNodes: CandidateNode[]
  androidIntents: ReadonlySet<AndroidIntent>
}): CandidateNode[] {
  const { codeGraph, existingIds, candidateNodes, androidIntents } = input
  if (androidIntents.size === 0) return []
  const seedNodeIds = new Set(
    candidateNodes.filter((node) => node.retained && hasAndroidProvenance(candidateNodeToPolicyInput(node))).map((node) => node.nodeId)
  )
  if (seedNodeIds.size === 0) return []

  const reached = findAndroidOwnerSupportNodeIds({
    codeGraph,
    seedNodeIds,
    maxNodes: seedNodeIds.size + MAX_ANDROID_OWNER_SUPPORT_INJECTED_NODES,
  })
  const nodeById = new Map(codeGraph.nodes.map((node) => [node.id, node]))
  const injected: CandidateNode[] = []
  for (const id of [...reached].sort()) {
    if (seedNodeIds.has(id) || existingIds.has(id)) continue
    if (injected.length >= MAX_ANDROID_OWNER_SUPPORT_INJECTED_NODES) break
    const graphNode = nodeById.get(id)
    if (!graphNode) continue
    injected.push(toSyntheticAndroidOwnerSupportNode(graphNode))
  }
  return injected
}

function toSyntheticAndroidOwnerSupportNode(node: CodeGraphNode): CandidateNode {
  return {
    nodeId: node.id,
    kind: node.kind,
    label: node.label,
    ...(node.path ? { filePath: node.path } : {}),
    score: 0,
    baseScore: 0,
    modeAdjustment: 0,
    reasons: ['synthesized: reachable via bounded Android ownership/data-flow owner-support traversal from an anchored Android candidate'],
    matchedTerms: [],
    ...(node.classificationRoles ? { classificationRoles: node.classificationRoles } : {}),
    ...(node.classificationRefs ? { classificationRefs: node.classificationRefs } : {}),
    ...(node.androidComponentRefs ? { androidComponentRefs: node.androidComponentRefs } : {}),
    ...(node.androidArtifactId ? { androidArtifactId: node.androidArtifactId } : {}),
    retained: true,
    synthesized: true,
  }
}

function injectFocusAndChangedFileCandidates(input: {
  existingPaths: Set<string>
  focusIntake: ContextFocusIntake
  changedSurface: ChangedSurface
  adjacentFilePaths: Set<string>
}): CandidateFile[] {
  const { existingPaths, focusIntake, changedSurface, adjacentFilePaths } = input
  const wantedPaths = new Set<string>([
    ...focusIntake.focusFiles.filter((entry) => entry.resolved).flatMap((entry) => entry.matchedFilePaths),
    ...changedSurface.files.filter((entry) => entry.status !== 'removed').map((entry) => entry.path),
    ...adjacentFilePaths,
  ])

  const injected: CandidateFile[] = []
  for (const path of [...wantedPaths].sort()) {
    if (existingPaths.has(path)) continue
    if (injected.length >= MAX_SYNTHESIZED_FILES) break
    injected.push({
      path,
      score: 0,
      baseScore: 0,
      modeAdjustment: 0,
      reasons: ['synthesized: explicit focus file or changed-surface file not present in search results'],
      matchedTerms: [],
      retained: true,
    })
  }
  return injected
}
