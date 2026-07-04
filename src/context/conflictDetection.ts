import type {
  CandidateNode,
  ContextConflict,
  ContextConflictSummary,
  ContextFocus,
} from './types.js'
import type { EditGuidance } from '../classification/classificationTypes.js'

const NEAR_TIE_SCORE_MARGIN = 8
const RESTRICTIVE = new Set<EditGuidance>([
  'avoid-primary-edit-target',
  'read-only-reference',
  'generated-do-not-edit',
])
const PREFERRED = new Set<EditGuidance>(['safe-primary-edit-target', 'inspect-before-edit'])

function guidance(candidate: CandidateNode): EditGuidance[] {
  return [...new Set(candidate.classificationRoles?.map((role) => role.editGuidance) ?? [])].sort()
}

function hasAny(values: EditGuidance[], expected: Set<EditGuidance>): boolean {
  return values.some((value) => expected.has(value))
}

export function detectContextConflicts(options: {
  focus: ContextFocus
  candidateNodes: CandidateNode[]
}): ContextConflictSummary {
  const focusCandidate = options.candidateNodes.find((candidate) => candidate.nodeId === options.focus.focusNodeId)
  if (!focusCandidate) return { status: 'none', conflicts: [], warnings: [] }
  const focusGuidance = guidance(focusCandidate)
  if (!hasAny(focusGuidance, RESTRICTIVE)) return { status: 'none', conflicts: [], warnings: [] }

  const conflicts: ContextConflict[] = []
  for (const alternative of options.candidateNodes) {
    if (alternative.nodeId === focusCandidate.nodeId || !alternative.retained) continue
    if (Math.abs(focusCandidate.score - alternative.score) > NEAR_TIE_SCORE_MARGIN) continue
    const alternativeGuidance = guidance(alternative)
    if (!hasAny(alternativeGuidance, PREFERRED)) continue
    const affectedFiles = [...new Set([focusCandidate.filePath, alternative.filePath].filter((value): value is string => Boolean(value)))].sort()
    conflicts.push({
      id: `conflict-edit-guidance-${conflicts.length + 1}`,
      status: 'conflict',
      reason: 'The selected focus has restrictive static edit guidance while a near-tied retained candidate has safe or inspect-first guidance.',
      evidenceRefs: [...new Set([
        ...(focusCandidate.classificationRefs?.map((ref) => ref.id) ?? []),
        ...(alternative.classificationRefs?.map((ref) => ref.id) ?? []),
      ])].sort(),
      affectedFiles,
      affectedNodes: [focusCandidate.nodeId, alternative.nodeId].sort(),
      candidates: [focusCandidate, alternative].map((candidate) => ({
        nodeId: candidate.nodeId,
        filePath: candidate.filePath ?? null,
        score: candidate.score,
        editGuidance: guidance(candidate),
      })),
      recommendedNextAction: 'Inspect both candidates and choose the canonical implementation owner before editing.',
    })
  }
  return { status: conflicts.length > 0 ? 'conflict' : 'none', conflicts, warnings: [] }
}
