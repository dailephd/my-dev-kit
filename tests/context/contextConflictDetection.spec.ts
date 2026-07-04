import { describe, expect, it } from 'vitest'
import { detectContextConflicts } from '../../src/context/conflictDetection.js'
import type { CandidateNode, ContextFocus } from '../../src/context/types.js'
import type { EditGuidance } from '../../src/classification/classificationTypes.js'

const focus: ContextFocus = {
  focusNodeId: 'symbol:src/generated.ts#User',
  focusFilePath: 'src/generated.ts',
  selectionMode: 'best-effort-ambiguous',
  confidence: 'low',
  reasons: [],
  ambiguityNotes: ['near tie'],
  warnings: [],
}

function candidate(nodeId: string, score: number, editGuidance: EditGuidance): CandidateNode {
  return {
    nodeId,
    kind: 'symbol',
    label: nodeId,
    filePath: nodeId.includes('generated') ? 'src/generated.ts' : 'src/models.ts',
    score,
    reasons: [],
    matchedTerms: ['user'],
    classificationRoles: [{
      role: 'canonical-type',
      editGuidance,
      readiness: 'ready',
      uncertainty: 'certain',
    }],
    retained: true,
  }
}

describe('detectContextConflicts', () => {
  it('reports a complete conflict for incompatible near-tied edit guidance', () => {
    const result = detectContextConflicts({
      focus,
      candidateNodes: [
        candidate(focus.focusNodeId!, 20, 'generated-do-not-edit'),
        candidate('symbol:src/models.ts#User', 18, 'safe-primary-edit-target'),
      ],
    })
    expect(result.status).toBe('conflict')
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({
      status: 'conflict',
      affectedNodes: expect.arrayContaining([focus.focusNodeId, 'symbol:src/models.ts#User']),
      recommendedNextAction: expect.stringContaining('canonical implementation owner'),
    })
  })

  it('does not turn ordinary ambiguity into a conflict', () => {
    const result = detectContextConflicts({
      focus,
      candidateNodes: [
        candidate(focus.focusNodeId!, 20, 'inspect-before-edit'),
        candidate('symbol:src/models.ts#User', 19, 'safe-primary-edit-target'),
      ],
    })
    expect(result).toMatchObject({ status: 'none', conflicts: [] })
  })

  it('does not report a conflict when the alternative is not near-tied', () => {
    const result = detectContextConflicts({
      focus,
      candidateNodes: [
        candidate(focus.focusNodeId!, 30, 'avoid-primary-edit-target'),
        candidate('symbol:src/models.ts#User', 10, 'safe-primary-edit-target'),
      ],
    })
    expect(result.conflicts).toEqual([])
  })
})
