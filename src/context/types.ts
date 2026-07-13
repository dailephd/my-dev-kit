import type {
  ClassificationRole,
  ClassificationRoleRef,
  EditGuidance,
  Readiness,
  RiskLabel,
  UncertaintyTier,
} from '../classification/classificationTypes.js'
import type { SourceRef } from '../classification/classificationTypes.js'
import type { SemanticArtifactRef, SemanticEvidenceRef, SemanticRole } from '../semantics/index.js'

export type ContextCapsuleMode = 'general' | 'feature-add' | 'subsystem'

export interface ContextCapsuleRequest {
  originalQuery: string
  normalizedQuery: string
  mode: ContextCapsuleMode
  requestedOutputPath: string
}

export interface ContextCapsuleArtifactRef {
  name: string
  path: string
}

export interface ContextCapsuleIndex {
  indexPath: string
  manifestPath: string
  manifestSchemaVersion?: string
  projectRoot?: string
  artifactRefs: ContextCapsuleArtifactRef[]
}

export interface ContextCapsuleLimits {
  maxCandidateFiles: number | null
  maxSourceSlices: number | null
  maxGraphNodes: number | null
  maxGraphEdges: number | null
}

export type ContextEntryKind =
  | 'request-summary'
  | 'index-summary'
  | 'artifact-summary'
  | 'placeholder'
  | 'focus-summary'
  | 'selected-graph-summary'
  | 'selected-source-summary'
  | 'semantic-summary'
  | 'classification-summary'
  | 'conflict-summary'

export interface ContextEntryEvidenceRef {
  path: string
}

export interface ContextEntry {
  id: string
  kind: ContextEntryKind
  title: string
  reason: string
  evidenceRefs: ContextEntryEvidenceRef[]
  classificationRefs?: SourceRef[]
  classificationRoles?: ClassificationRole[]
  warnings: string[]
}

export interface DroppedContextEntry {
  id: string
  kind: ContextEntryKind
  title: string
  reason: string
}

export type ContextAdequacyStatus =
  | 'context sufficient for implementation'
  | 'context sufficient with listed assumptions'
  | 'context insufficient and more retrieval required'
  | 'context conflict found and user or upstream stage decision required'

export interface ContextAdequacyStatement {
  status: ContextAdequacyStatus
  summary: string
  assumptions: string[]
  gaps: string[]
}

export interface ContextCapsuleTool {
  name: string
  version: string
}

export interface ContextCapsule {
  schemaVersion: '1.0.0'
  generatedAt: string
  tool: ContextCapsuleTool
  request: ContextCapsuleRequest
  index: ContextCapsuleIndex
  limits: ContextCapsuleLimits
  requiredContext: ContextEntry[]
  optionalSupportContext: ContextEntry[]
  droppedContext: DroppedContextEntry[]
  warnings: string[]
  contextAdequacy: ContextAdequacyStatement
  queryPlan: QueryPlan
  candidateFiles: CandidateFile[]
  candidateNodes: CandidateNode[]
  focus: ContextFocus
  selectedGraph: SelectedGraph
  retention: RetentionSummary
  selectedSource: SelectedSource
  selectedSourceBundles: SelectedSourceBundles
  semanticSummary: SemanticSummary
  classificationSummary: ClassificationSummary
  artifactReferenceSummary: ArtifactReferenceSummaryEntry[]
  pruning: PruningSummary
  conflicts: ContextConflictSummary
  modeEffects: ModeEffects
  sourceControl: SourceControl
}

export type AuditStepKind =
  | 'validate-inputs'
  | 'load-manifest'
  | 'inspect-artifacts'
  | 'write-context-capsule'
  | 'write-retrieval-audit-record'
  | 'normalize-query'
  | 'extract-query-terms'
  | 'run-search'
  | 'rank-candidate-files'
  | 'rank-candidate-nodes'
  | 'select-primary-focus'
  | 'inspect-primary-focus'
  | 'select-graph-neighborhood'
  | 'apply-caps'
  | 'record-retained-and-dropped-context'
  | 'derive-source-targets'
  | 'select-source-slices'
  | 'select-source-bundles'
  | 'apply-source-caps'
  | 'use-source-continuation'
  | 'use-local-source-expansion'
  | 'inspect-semantic-metadata'
  | 'inspect-classification-metadata'
  | 'inspect-artifact-references'
  | 'assemble-required-context'
  | 'assemble-optional-support-context'
  | 'assemble-dropped-context'
  | 'apply-pruning-policy'
  | 'update-context-adequacy'
  | 'apply-mode-ranking-adjustment'
  | 'detect-context-conflicts'
  | 'skip-source-evidence'

export type AuditStepStatus = 'ok' | 'skipped' | 'failed'

export interface AuditStep {
  id: string
  kind: AuditStepKind
  description: string
  inputs: Record<string, string | number | boolean | null>
  outputs: Record<string, string | number | boolean | null>
  status: AuditStepStatus
  warnings: string[]
}

export interface FullFileReadRecommendation {
  filePath: string
  reason: string
  missingContext: string
  continuationOrExpansionAttempted: boolean | 'unavailable'
}

export interface RetrievalAuditRecordIndex {
  indexPath: string
  manifestPath: string
}

export interface RetrievalAuditRecord {
  schemaVersion: '1.0.0'
  generatedAt: string
  tool: ContextCapsuleTool
  request: ContextCapsuleRequest
  index: RetrievalAuditRecordIndex
  steps: AuditStep[]
  fallbacks: string[]
  fullFileReadRecommendations: FullFileReadRecommendation[]
  warnings: string[]
  contextAdequacy: ContextAdequacyStatement
}

// --- Batch 2: query planning, candidate ranking, focus, and graph selection ---

export interface QueryTerms {
  raw: string[]
  quotedPhrases: string[]
  pathLike: string[]
  symbolLike: string[]
  routeLike: string[]
  commandLike: string[]
  artifactLike: string[]
  classificationLike: string[]
}

export interface QueryPlan {
  originalQuery: string
  normalizedQuery: string
  mode: ContextCapsuleMode
  searchQueries: string[]
  terms: QueryTerms
}

export interface CandidateFile {
  path: string
  score: number
  baseScore?: number
  modeAdjustment?: number
  reasons: string[]
  matchedTerms: string[]
  semanticRoles?: SemanticRole[]
  artifactRefs?: SemanticArtifactRef[]
  classificationRoles?: ClassificationRoleRef[]
  classificationRefs?: SemanticArtifactRef[]
  retained: boolean
  droppedReason?: string
}

export interface CandidateNode {
  nodeId: string
  /** `file`/`symbol` for source-backed candidates; a compact `android-*` kind (v1.10.0 Batch 6) for Batch 5 artifact-backed graph nodes made eligible for the same generic ranking. */
  kind: 'file' | 'symbol' | string
  label: string
  filePath?: string
  score: number
  baseScore?: number
  modeAdjustment?: number
  reasons: string[]
  matchedTerms: string[]
  semanticRoles?: SemanticRole[]
  artifactRefs?: SemanticArtifactRef[]
  classificationRoles?: ClassificationRoleRef[]
  classificationRefs?: SemanticArtifactRef[]
  /** Compact Batch 5 evidence for `android-*` candidates only - never a full artifact record. */
  androidArtifactId?: string
  androidMetadata?: Record<string, string | number | boolean | null>
  retained: boolean
  droppedReason?: string
}

export type FocusSelectionMode = 'none' | 'single-best' | 'best-effort-ambiguous'
export type FocusConfidence = 'high' | 'medium' | 'low' | 'none'

export interface ContextFocus {
  focusNodeId: string | null
  focusFilePath: string | null
  selectionMode: FocusSelectionMode
  confidence: FocusConfidence
  reasons: string[]
  ambiguityNotes: string[]
  warnings: string[]
}

export interface SelectedGraphNode {
  nodeId: string
  kind: string
  label: string
  filePath?: string
  reasons: string[]
}

export interface SelectedGraphEdge {
  from: string
  to: string
  kind: string
  reasons: string[]
}

export interface SelectedGraph {
  nodes: SelectedGraphNode[]
  edges: SelectedGraphEdge[]
  omittedNodeCount: number
  omittedEdgeCount: number
  warnings: string[]
}

export interface RetentionCapSettings {
  maxCandidateFiles: number | null
  maxGraphNodes: number | null
  maxGraphEdges: number | null
}

export interface RetentionSummary {
  retainedCandidateCount: number
  droppedCandidateCount: number
  retainedGraphNodeCount: number
  droppedGraphNodeCount: number
  retainedGraphEdgeCount: number
  droppedGraphEdgeCount: number
  capSettings: RetentionCapSettings
}

// --- Batch 3: bounded source evidence and semantic/classification-enriched capsule ---

export type SourceRetrievalMethod =
  | 'node'
  | 'symbol'
  | 'line-range'
  | 'contains'
  | 'react-region'
  | 'local-component-tree'
  | 'local-dependency-expansion'
  | 'continuation'

export type SourceIncludedBy = 'primary-focus' | 'selected-graph'

export interface SelectedSourceSlice {
  id: string
  kind: string
  filePath: string
  startLine: number
  endLine: number
  nodeId?: string
  symbolName?: string | null
  reason: string
  sourceRetrievalMethod: SourceRetrievalMethod
  includedBy: SourceIncludedBy
  truncated: boolean
  continuationAvailable?: boolean
  continuationUsed: boolean
  localExpansionUsed: boolean
  classificationRefs?: SemanticArtifactRef[]
  semanticRefs?: SemanticArtifactRef[]
  warnings: string[]
}

export interface SkippedSourceEntry {
  id: string
  kind: string
  filePath?: string
  reason: string
  capType?: string
  candidateScore?: number
}

export interface SelectedSource {
  slices: SelectedSourceSlice[]
  omittedSliceCount: number
  totalSelectedLines: number
  maxSourceSlices: number
  warnings: string[]
  skipped: SkippedSourceEntry[]
}

export interface SelectedSourceBundleBlock {
  id: string
  kind: string
  filePath: string
  startLine: number
  endLine: number
  symbolName?: string | null
  reason: string
  includedBy: string
  truncated: boolean
  warnings: string[]
}

export interface SelectedSourceBundleSkippedBlock {
  id: string
  kind: string
  filePath?: string
  reason: string
  capType?: string
  candidateScore?: number
}

export interface SelectedSourceBundle {
  id: string
  title: string
  focusNodeId?: string
  focusFilePath: string | null
  reason: string
  blocks: SelectedSourceBundleBlock[]
  totalLines: number
  maxLines: number
  skippedBlocks: SelectedSourceBundleSkippedBlock[]
  warnings: string[]
}

export interface SelectedSourceBundles {
  bundles: SelectedSourceBundle[]
  omittedBundleCount: number
  totalSelectedLines: number
  warnings: string[]
}

export interface SemanticSummaryEntry {
  roles: SemanticRole[]
  artifactRefs: SemanticArtifactRef[]
  evidenceRefs: SemanticEvidenceRef[]
}

export interface SemanticSummary {
  available: boolean
  roles: SemanticRole[]
  artifactRefs: SemanticArtifactRef[]
  evidenceRefs: SemanticEvidenceRef[]
  summariesByNode: Record<string, SemanticSummaryEntry>
  summariesByFile: Record<string, SemanticSummaryEntry>
  warnings: string[]
}

export interface ClassificationSummaryEntry {
  classifications: ClassificationRole[]
  editGuidance: EditGuidance
  readiness: Readiness
  risks: RiskLabel[]
  uncertainty: UncertaintyTier
  warnings: string[]
}

export interface ClassificationSummary {
  available: boolean
  classificationArtifactPath: string | null
  roles: ClassificationRole[]
  refs: SourceRef[]
  editGuidance: EditGuidance[]
  readiness: Readiness[]
  riskLabels: RiskLabel[]
  uncertainty: UncertaintyTier[]
  summariesByNode: Record<string, ClassificationSummaryEntry>
  summariesByFile: Record<string, ClassificationSummaryEntry>
  warnings: string[]
}

export interface ArtifactReferenceSummaryEntry {
  artifactKind: string
  artifactPath: string | null
  available: boolean
  reason: string
  warnings: string[]
}

export interface PruningCounts {
  candidateFiles: number
  candidateNodes: number
  graphNodes: number
  graphEdges: number
  sourceSlices: number
  sourceBundles: number
}

export interface PruningCapSettings {
  maxCandidateFiles: number | null
  maxGraphNodes: number | null
  maxGraphEdges: number | null
  maxSourceSlices: number
}

export interface PruningSummary {
  policyVersion: '1.0.0'
  retainedCounts: PruningCounts
  droppedCounts: PruningCounts
  capSettings: PruningCapSettings
  retainedReasons: string[]
  droppedReasons: string[]
  warnings: string[]
}

// --- Batch 4: finalized mode, conflict, and source-control evidence ---

export interface ModeEffect {
  candidateId: string
  adjustment: number
  reasons: string[]
}

export interface ModeEffects {
  mode: ContextCapsuleMode
  applied: boolean
  effects: ModeEffect[]
  warnings: string[]
}

export interface SourceControl {
  enabled: boolean
  reason: string
}

export interface ContextConflictCandidate {
  nodeId: string
  filePath: string | null
  score: number
  editGuidance: EditGuidance[]
}

export interface ContextConflict {
  id: string
  status: 'conflict'
  reason: string
  evidenceRefs: string[]
  affectedFiles: string[]
  affectedNodes: string[]
  candidates: ContextConflictCandidate[]
  recommendedNextAction: string
}

export interface ContextConflictSummary {
  status: 'none' | 'conflict'
  conflicts: ContextConflict[]
  warnings: string[]
}
