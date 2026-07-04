import type { CandidateNode, ContextFocus } from './types.js'

const AMBIGUITY_ABSOLUTE_MARGIN = 8
const AMBIGUITY_RELATIVE_MARGIN = 0.25

export function selectPrimaryFocus(candidateNodes: CandidateNode[]): ContextFocus {
  if (candidateNodes.length === 0) {
    return {
      focusNodeId: null,
      focusFilePath: null,
      selectionMode: 'none',
      confidence: 'none',
      reasons: ['No ranked candidates were available.'],
      ambiguityNotes: [],
      warnings: [],
    }
  }

  const top = candidateNodes[0]
  const runnerUp = candidateNodes[1]
  const gap = runnerUp ? top.score - runnerUp.score : Infinity
  const relativeGap = runnerUp && runnerUp.score > 0 ? gap / runnerUp.score : Infinity

  let confidence: ContextFocus['confidence']
  let selectionMode: ContextFocus['selectionMode']
  const ambiguityNotes: string[] = []

  if (!runnerUp || (gap >= AMBIGUITY_ABSOLUTE_MARGIN && relativeGap >= AMBIGUITY_RELATIVE_MARGIN)) {
    confidence = 'high'
    selectionMode = 'single-best'
  } else if (gap >= AMBIGUITY_ABSOLUTE_MARGIN / 2) {
    confidence = 'medium'
    selectionMode = 'single-best'
  } else {
    confidence = 'low'
    selectionMode = 'best-effort-ambiguous'
    ambiguityNotes.push(`Runner-up candidate ${runnerUp.nodeId} scored ${runnerUp.score} vs. selected ${top.score}.`)
  }

  const focusFilePath = top.kind === 'file' ? top.filePath ?? top.nodeId : top.filePath ?? null

  return {
    focusNodeId: top.nodeId,
    focusFilePath: focusFilePath ?? null,
    selectionMode,
    confidence,
    reasons: top.reasons,
    ambiguityNotes,
    warnings: [],
  }
}
