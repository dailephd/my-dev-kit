import type { SemanticArtifactRef, SemanticEvidenceRef, SemanticRole } from '../semantics/index.js'
import type { ClassificationRoleRef } from '../classification/classificationTypes.js'
import type { ClassificationCommandSummary } from '../classification/resolveClassificationForCommands.js'
import type { AndroidComponentRoleRef } from '../android/androidComponentTypes.js'

export type SourceSliceMode = 'line-range' | 'symbol' | 'node'

/**
 * Metadata describing where to continue source retrieval from this window.
 * Emitted whenever the output is bounded and may be incomplete.
 */
export interface ContinuationCursor {
  filePath: string
  nextStartLine: number
  previousEndLine: number
  targetKind: string
  targetId?: string
  symbolName?: string | null
  maxLines: number
  eof: boolean
  symbolBoundaryKnown: boolean
  reason: 'symbol-end-unknown' | 'max-lines-reached' | 'window-capped' | 'eof'
  warnings: string[]
  fallbackReason?: string
}

export interface SourceSlice {
  status: 'ok'
  mode: SourceSliceMode
  indexDir: string
  filePath: string
  absolutePath: string
  symbolName: string | null
  startLine: number
  endLine: number
  lineCount: number
  content: string
  semanticRoles?: SemanticRole[]
  artifactRefs?: SemanticArtifactRef[]
  evidenceRefs?: SemanticEvidenceRef[]
  classificationRoles?: ClassificationRoleRef[]
  classificationRefs?: SemanticArtifactRef[]
  /** Compact risk/warning/edit-guidance summary resolved from classification.json, when present. */
  classificationSummary?: ClassificationCommandSummary | null
  androidComponentRoles?: AndroidComponentRoleRef[]
  androidComponentRefs?: SemanticArtifactRef[]
  warnings: string[]
  continuationCursor?: ContinuationCursor
}

export interface SourceTarget {
  mode: SourceSliceMode
  filePath: string
  symbolName?: string
  startLine?: number
  endLine?: number
  semanticRoles?: SemanticRole[]
  artifactRefs?: SemanticArtifactRef[]
  evidenceRefs?: SemanticEvidenceRef[]
  classificationRoles?: ClassificationRoleRef[]
  classificationRefs?: SemanticArtifactRef[]
  androidComponentRoles?: AndroidComponentRoleRef[]
  androidComponentRefs?: SemanticArtifactRef[]
  warnings: string[]
}
