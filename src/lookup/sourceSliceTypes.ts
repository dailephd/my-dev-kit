import type { SemanticArtifactRef, SemanticEvidenceRef, SemanticRole } from '../semantics/index.js'

export type SourceSliceMode = 'line-range' | 'symbol' | 'node'

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
  warnings: string[]
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
  warnings: string[]
}
