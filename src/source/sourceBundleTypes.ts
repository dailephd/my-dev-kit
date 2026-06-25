export type ExpansionBlockKind =
  | 'primary-target'
  | 'continuation'
  | 'import-site'
  | 'imported-symbol'
  | 'local-type'
  | 'prop-type'
  | 'local-component'
  | 'local-helper'
  | 'local-constant'
  | 'rendered-child'
  | 'called-helper'
  | 'callback-handler'
  | 'route-owner'
  | 'storage-owner'
  | 'ui-marker-owner'

export type ExpansionReason =
  | 'primary-target'
  | 'continuation'
  | 'import-dependency'
  | 'local-type'
  | 'prop-type'
  | 'local-component'
  | 'local-helper'
  | 'local-constant'
  | 'rendered-child'
  | 'called-helper'
  | 'callback-handler'

export type SkippedBlockReasonCode =
  | 'max-lines-reached'
  | 'max-blocks-reached'
  | 'no-source-range'
  | 'dynamic-import'
  | 'dynamic-dispatch'
  | 'external-package'
  | 'artifact-unavailable'
  | 'path-outside-root'
  | 'ambiguous-symbol'
  | 'unsupported-pattern'
  | 'inside-primary-window'

export interface SourceExpansionBlock {
  id: string
  filePath: string
  absolutePath: string
  startLine: number
  endLine: number
  lineCount: number
  content: string
  kind: ExpansionBlockKind
  targetRelationship: string
  expansionReasons: ExpansionReason[]
  confidence: 'high' | 'medium' | 'low'
  fallbackReason?: string
  warnings: string[]
  dedupeKey: string
}

export interface SkippedBlock {
  id: string
  kind: ExpansionBlockKind
  filePath?: string
  sourceStart?: number
  sourceEnd?: number
  owner?: string
  reason: string
  reasonCode: SkippedBlockReasonCode
}

export interface BundleLimits {
  maxLinesPerBundle: number
  maxLinesPerBlock: number
  maxBlocks: number
  maxLinesHit: boolean
  maxBlocksHit: boolean
}

export interface BundleStats {
  primaryLineCount: number
  expansionBlockCount: number
  skippedBlockCount: number
  totalLineCount: number
}

export interface BundleContinuationCursor {
  filePath: string
  nextStartLine: number
  previousEndLine: number
  targetId: string
  targetKind: string
  reason: string
  exhausted: boolean
  warnings: string[]
}

export interface BundleTarget {
  kind: string
  filePath?: string
  symbolName?: string | null
  nodeId?: string
  startLine?: number
  endLine?: number
}

export interface SourceBundle {
  status: 'ok'
  mode: 'source-bundle'
  indexDir: string
  target: BundleTarget
  primaryBlock: SourceExpansionBlock
  expansionBlocks: SourceExpansionBlock[]
  skippedBlocks: SkippedBlock[]
  warnings: string[]
  limits: BundleLimits
  continuationCursors: BundleContinuationCursor[]
  stats: BundleStats
}
