import type {
  CandidateNode,
  ClassificationSummary,
  ContextConflict,
  ContextConflictSummary,
  ContextFocus,
  ContextRole,
} from './types.js'
import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { AndroidIntent } from './androidContextIntent.js'
import { androidOwnerEligible, candidateNodeToPolicyInput, hasAndroidProvenance, isAndroidGeneratedCandidate, isAndroidTestOnlyCandidate } from './androidContextOwnerPolicy.js'
import type { EditGuidance } from '../classification/classificationTypes.js'

const NEAR_TIE_SCORE_MARGIN = 8
const RESTRICTIVE = new Set<EditGuidance>([
  'avoid-primary-edit-target',
  'read-only-reference',
  'generated-do-not-edit',
])
const PREFERRED = new Set<EditGuidance>(['safe-primary-edit-target', 'inspect-before-edit'])

/** v1.12.0 Batch 6: stable Android wrong-layer conflict kinds (section 23).
 * `ContextConflict.kind` is additive/optional - a pre-existing (non-Android)
 * conflict record uses `'edit-guidance-near-tie'`; older readers that only
 * know `id`/`reason`/`candidates` are unaffected. */
export type ContextConflictKind =
  | 'edit-guidance-near-tie'
  | 'android-generated-primary-target'
  | 'android-test-primary-target'
  | 'android-usage-selected-over-owner'
  | 'android-ambiguous-owner'
  | 'android-unresolved-owner'
  | 'android-classification-graph-disagreement'

function guidance(candidate: CandidateNode): EditGuidance[] {
  return [...new Set(candidate.classificationRoles?.map((role) => role.editGuidance) ?? [])].sort()
}

function hasAny(values: EditGuidance[], expected: Set<EditGuidance>): boolean {
  return values.some((value) => expected.has(value))
}

function toConflictCandidate(candidate: CandidateNode) {
  return {
    nodeId: candidate.nodeId,
    filePath: candidate.filePath ?? null,
    score: candidate.score,
    editGuidance: guidance(candidate),
  }
}

/** Fixed usage -> owner edge kinds recognized for `android-usage-selected-over-owner`
 * (section 18/26). `reverse: true` means the owner is the edge source and the
 * usage/projection is the edge target (e.g. a composable "has" a fact). */
const USAGE_TO_OWNER_EDGE_KINDS: ReadonlyArray<{ kind: string; reverse: boolean }> = [
  { kind: 'compose-state-reads-viewmodel', reverse: false },
  { kind: 'source-references-resource', reverse: false },
  { kind: 'compose-navigation-targets-route', reverse: false },
  { kind: 'composable-has-fact', reverse: true },
]

interface UsageOwnerPair {
  usageId: string
  ownerId: string
}

function findUsageOwnerPairs(codeGraph: CodeGraph, candidateIds: ReadonlySet<string>): UsageOwnerPair[] {
  const pairs: UsageOwnerPair[] = []
  for (const edge of codeGraph.edges) {
    const rule = USAGE_TO_OWNER_EDGE_KINDS.find((r) => r.kind === edge.kind)
    if (!rule) continue
    if (!candidateIds.has(edge.source) || !candidateIds.has(edge.target)) continue
    pairs.push(rule.reverse ? { usageId: edge.target, ownerId: edge.source } : { usageId: edge.source, ownerId: edge.target })
  }
  return pairs
}

export function detectContextConflicts(options: {
  focus: ContextFocus
  candidateNodes: CandidateNode[]
  codeGraph?: CodeGraph
  androidIntents?: ReadonlySet<AndroidIntent>
  role?: ContextRole | null
  classificationSummary?: ClassificationSummary
}): ContextConflictSummary {
  const conflicts: ContextConflict[] = []
  const focusCandidate = options.candidateNodes.find((candidate) => candidate.nodeId === options.focus.focusNodeId)

  if (focusCandidate) {
    const focusGuidance = guidance(focusCandidate)
    if (hasAny(focusGuidance, RESTRICTIVE)) {
      for (const alternative of options.candidateNodes) {
        if (alternative.nodeId === focusCandidate.nodeId || !alternative.retained) continue
        if (Math.abs(focusCandidate.score - alternative.score) > NEAR_TIE_SCORE_MARGIN) continue
        const alternativeGuidance = guidance(alternative)
        if (!hasAny(alternativeGuidance, PREFERRED)) continue
        const affectedFiles = [...new Set([focusCandidate.filePath, alternative.filePath].filter((value): value is string => Boolean(value)))].sort()
        conflicts.push({
          id: `conflict-edit-guidance-${conflicts.length + 1}`,
          kind: 'edit-guidance-near-tie',
          status: 'conflict',
          reason: 'The selected focus has restrictive static edit guidance while a near-tied retained candidate has safe or inspect-first guidance.',
          evidenceRefs: [...new Set([
            ...(focusCandidate.classificationRefs?.map((ref) => ref.id) ?? []),
            ...(alternative.classificationRefs?.map((ref) => ref.id) ?? []),
          ])].sort(),
          affectedFiles,
          affectedNodes: [focusCandidate.nodeId, alternative.nodeId].sort(),
          candidates: [focusCandidate, alternative].map(toConflictCandidate),
          recommendedNextAction: 'Inspect both candidates and choose the canonical implementation owner before editing.',
        })
      }
    }
  }

  conflicts.push(...detectAndroidWrongLayerConflicts(options, focusCandidate))
  conflicts.sort(conflictOrder)

  return { status: conflicts.length > 0 ? 'conflict' : 'none', conflicts, warnings: [] }
}

/** Deterministic ordering (section 30): conflict kind, then primary candidate
 * ID, then related owner candidate ID, then stable evidence ID. Never
 * filesystem order. */
function conflictOrder(a: ContextConflict, b: ContextConflict): number {
  const kindOrder = (a.kind ?? '').localeCompare(b.kind ?? '')
  if (kindOrder !== 0) return kindOrder
  const primaryOrder = (a.affectedNodes[0] ?? '').localeCompare(b.affectedNodes[0] ?? '')
  if (primaryOrder !== 0) return primaryOrder
  const relatedOrder = (a.affectedNodes[1] ?? '').localeCompare(b.affectedNodes[1] ?? '')
  if (relatedOrder !== 0) return relatedOrder
  return a.id.localeCompare(b.id)
}

function detectAndroidWrongLayerConflicts(
  options: {
    focus: ContextFocus
    candidateNodes: CandidateNode[]
    codeGraph?: CodeGraph
    androidIntents?: ReadonlySet<AndroidIntent>
    role?: ContextRole | null
    classificationSummary?: ClassificationSummary
  },
  focusCandidate: CandidateNode | undefined
): ContextConflict[] {
  const { candidateNodes, codeGraph, role } = options
  const androidIntents = options.androidIntents ?? new Set<AndroidIntent>()
  const isTestImplementationRole = role === 'test-implementation'
  const explicitTestIntent = androidIntents.has('test') || isTestImplementationRole
  const requiresProductionOwner = role === 'architecture' || role === 'implementation'
  const conflicts: ContextConflict[] = []
  let sequence = 0
  const nextId = (kind: string) => `conflict-${kind}-${++sequence}`

  // --- android-generated-primary-target (section 24) ---
  if (focusCandidate && requiresProductionOwner && isAndroidGeneratedCandidate(candidateNodeToPolicyInput(focusCandidate))) {
    conflicts.push({
      id: nextId('android-generated-primary-target'),
      kind: 'android-generated-primary-target',
      status: 'conflict',
      reason: 'The focused candidate is a generated Android artifact and cannot be a production edit owner.',
      evidenceRefs: [...new Set(focusCandidate.classificationRefs?.map((ref) => ref.id) ?? [])].sort(),
      affectedFiles: focusCandidate.filePath ? [focusCandidate.filePath] : [],
      affectedNodes: [focusCandidate.nodeId],
      candidates: [toConflictCandidate(focusCandidate)],
      recommendedNextAction: 'Locate the non-generated production owner responsible for this generated output instead of editing it directly.',
    })
  }

  // --- android-test-primary-target (section 25) ---
  if (focusCandidate && requiresProductionOwner && !explicitTestIntent && isAndroidTestOnlyCandidate(candidateNodeToPolicyInput(focusCandidate))) {
    conflicts.push({
      id: nextId('android-test-primary-target'),
      kind: 'android-test-primary-target',
      status: 'conflict',
      reason: 'The focused candidate is a test-only Android node and cannot satisfy production ownership for this request.',
      evidenceRefs: [...new Set(focusCandidate.classificationRefs?.map((ref) => ref.id) ?? [])].sort(),
      affectedFiles: focusCandidate.filePath ? [focusCandidate.filePath] : [],
      affectedNodes: [focusCandidate.nodeId],
      candidates: [toConflictCandidate(focusCandidate)],
      recommendedNextAction: 'Use this test as supporting/test-location evidence and locate the related production owner separately.',
    })
  }

  // --- android-usage-selected-over-owner and android-classification-graph-disagreement (sections 26, 29) ---
  if (codeGraph) {
    const retainedIds = new Set(candidateNodes.filter((n) => n.retained).map((n) => n.nodeId))
    const pairs = findUsageOwnerPairs(codeGraph, retainedIds)
    const byId = new Map(candidateNodes.map((n) => [n.nodeId, n]))
    const likelySelectedIds = new Set<string>([...(focusCandidate ? [focusCandidate.nodeId] : []), ...topScoredAndroidCandidateIds(candidateNodes)])

    for (const pair of pairs) {
      if (!likelySelectedIds.has(pair.usageId)) continue
      const usage = byId.get(pair.usageId)
      const owner = byId.get(pair.ownerId)
      if (!usage || !owner) continue
      conflicts.push({
        id: nextId('android-usage-selected-over-owner'),
        kind: 'android-usage-selected-over-owner',
        status: 'conflict',
        reason: 'A usage/projection candidate is likely to be selected while an exact stronger Android owner is connected through approved graph evidence.',
        evidenceRefs: [...new Set([...(usage.classificationRefs?.map((ref) => ref.id) ?? []), ...(owner.classificationRefs?.map((ref) => ref.id) ?? [])])].sort(),
        affectedFiles: [...new Set([usage.filePath, owner.filePath].filter((v): v is string => Boolean(v)))].sort(),
        affectedNodes: [usage.nodeId, owner.nodeId].sort(),
        candidates: [usage, owner].map(toConflictCandidate),
        recommendedNextAction: 'Prefer the exact owner over its usage/projection for this task intent.',
      })

      const usageGuidance = guidance(usage)
      if (hasAny(usageGuidance, PREFERRED) && !androidOwnerEligible(candidateNodeToPolicyInput(usage), androidIntents, isTestImplementationRole)) {
        conflicts.push({
          id: nextId('android-classification-graph-disagreement'),
          kind: 'android-classification-graph-disagreement',
          status: 'conflict',
          reason: 'Classification guidance marks this candidate as a safe/inspect-first edit target, but exact graph ownership evidence shows it is only a usage site.',
          evidenceRefs: [...new Set(usage.classificationRefs?.map((ref) => ref.id) ?? [])].sort(),
          affectedFiles: usage.filePath ? [usage.filePath] : [],
          affectedNodes: [usage.nodeId, owner.nodeId].sort(),
          candidates: [usage, owner].map(toConflictCandidate),
          recommendedNextAction: 'Treat the classification guidance as supporting evidence only; the graph-connected owner remains the edit target.',
        })
      }
    }
  }

  // --- android-ambiguous-owner (section 27) ---
  if (androidIntents.size > 0) {
    const eligible = candidateNodes.filter(
      (n) => n.retained && hasAndroidProvenance(candidateNodeToPolicyInput(n)) && androidOwnerEligible(candidateNodeToPolicyInput(n), androidIntents, isTestImplementationRole)
    )
    const byRole = new Map<string, CandidateNode[]>()
    for (const candidate of eligible) {
      for (const roleRef of candidate.classificationRoles ?? []) {
        const list = byRole.get(roleRef.role) ?? []
        list.push(candidate)
        byRole.set(roleRef.role, list)
      }
    }
    for (const [roleName, group] of byRole) {
      if (group.length < 2) continue
      const sorted = [...group].sort((a, b) => b.score - a.score)
      const topScore = sorted[0]!.score
      const tied = sorted.filter((c) => Math.abs(c.score - topScore) <= NEAR_TIE_SCORE_MARGIN)
      if (tied.length < 2) continue
      conflicts.push({
        id: nextId('android-ambiguous-owner'),
        kind: 'android-ambiguous-owner',
        status: 'conflict',
        reason: `Multiple materially plausible Android "${roleName}" owner candidates remain at the best eligible tier; no deterministic structural rule distinguishes them.`,
        evidenceRefs: [...new Set(tied.flatMap((c) => c.classificationRefs?.map((ref) => ref.id) ?? []))].sort(),
        affectedFiles: [...new Set(tied.map((c) => c.filePath).filter((v): v is string => Boolean(v)))].sort(),
        affectedNodes: tied.map((c) => c.nodeId).sort(),
        candidates: tied.map(toConflictCandidate),
        recommendedNextAction: 'Preserve every candidate; do not guess a single owner without additional disambiguating evidence.',
      })
    }
  }

  // --- android-unresolved-owner (section 28) ---
  if (focusCandidate && requiresProductionOwner && hasAndroidProvenance(candidateNodeToPolicyInput(focusCandidate))) {
    const risks = options.classificationSummary?.summariesByNode[focusCandidate.nodeId]?.risks ?? []
    const hasEligibleOwner = candidateNodes.some(
      (n) => n.retained && hasAndroidProvenance(candidateNodeToPolicyInput(n)) && androidOwnerEligible(candidateNodeToPolicyInput(n), androidIntents, isTestImplementationRole)
    )
    if (risks.includes('wrong-layer-risk') && !hasEligibleOwner) {
      conflicts.push({
        id: nextId('android-unresolved-owner'),
        kind: 'android-unresolved-owner',
        status: 'conflict',
        reason: 'Supported Android ownership evidence exists but the relevant owner relationship is explicitly unresolved or ambiguous, and no eligible production owner is established.',
        evidenceRefs: [...new Set(focusCandidate.classificationRefs?.map((ref) => ref.id) ?? [])].sort(),
        affectedFiles: focusCandidate.filePath ? [focusCandidate.filePath] : [],
        affectedNodes: [focusCandidate.nodeId],
        candidates: [toConflictCandidate(focusCandidate)],
        recommendedNextAction: 'Do not guess an owner; more retrieval or upstream disambiguation is required.',
      })
    }
  }

  return conflicts
}

/** Retained Android candidates within the near-tie margin of the top score,
 * used (alongside the resolved focus) as the "likely to be selected" set for
 * `android-usage-selected-over-owner` (section 26: "focused or otherwise
 * likely to be selected"). */
function topScoredAndroidCandidateIds(candidateNodes: CandidateNode[]): string[] {
  const androidRetained = candidateNodes.filter((n) => n.retained && hasAndroidProvenance(candidateNodeToPolicyInput(n)))
  if (androidRetained.length === 0) return []
  const topScore = Math.max(...androidRetained.map((n) => n.score))
  return androidRetained.filter((n) => Math.abs(n.score - topScore) <= NEAR_TIE_SCORE_MARGIN).map((n) => n.nodeId)
}
