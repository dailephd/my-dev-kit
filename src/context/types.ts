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

export const CONTEXT_CAPSULE_MODES: readonly ContextCapsuleMode[] = ['general', 'feature-add', 'subsystem']

// --- v1.10.1 Batch 1: context-role and structured ContextRequest contracts ---
//
// This is the single owner of the ContextRole and ContextRequest literal/type
// definitions. The CLI (contextCommand.ts), the request normalizer
// (contextRequestNormalization.ts), and the capsule/audit serializers must
// import these types rather than redeclaring them.

/** Stage-specific retrieval role. Orthogonal to `ContextCapsuleMode`; role must
 * never overwrite mode and mode must never overwrite role. Role-specific
 * retrieval behavior is not implemented until later v1.10.1 batches. */
export type ContextRole = 'architecture' | 'implementation' | 'test-implementation'

export const CONTEXT_ROLES: readonly ContextRole[] = ['architecture', 'implementation', 'test-implementation']

/** Bounded conceptual evidence kinds a `ContextRequest` may name. Batch 1 only
 * validates membership in this set; requesting a kind has no operational
 * effect on retrieval until the batch that implements it. */
export type RequestedEvidenceKind =
  | 'owner'
  | 'dependencies'
  | 'contracts'
  | 'validators'
  | 'constants'
  | 'errors'
  | 'schemas'
  | 'callers'
  | 'callees'
  | 'closest-tests'
  | 'test-infrastructure'
  | 'test-commands'
  | 'changed-surface'
  | 'responsibility-mappings'

export const REQUESTED_EVIDENCE_KINDS: readonly RequestedEvidenceKind[] = [
  'owner',
  'dependencies',
  'contracts',
  'validators',
  'constants',
  'errors',
  'schemas',
  'callers',
  'callees',
  'closest-tests',
  'test-infrastructure',
  'test-commands',
  'changed-surface',
  'responsibility-mappings',
]

/** Structured limits for later-batch role-aware retrieval. Distinct from the
 * existing operational `ContextCapsuleLimits` (--max-candidate-files etc.):
 * these fields are validated and preserved in Batch 1 but are not yet
 * consulted by retrieval. */
export interface ContextRequestLimits {
  candidates?: number
  graphDepth?: number
  files?: number
  symbols?: number
  sourceRanges?: number
  sourceLinesPerRange?: number
  characters?: number
  evidenceGroupEntries?: number
  fullFileFallbacks?: number
  responsibilityMappings?: number
}

/** The only supported `schemaVersion` major for `ContextRequest` documents in
 * v1.10.1. A supplied schemaVersion with a different major is rejected. */
export const CONTEXT_REQUEST_SCHEMA_SUPPORTED_MAJOR = 1
export const CONTEXT_REQUEST_SCHEMA_VERSION = '1.0.0'

/** Structured `--request <path>` JSON contract. Additive to the existing
 * flag-based context command; every field here also has (or, for
 * later-batch-only fields, will have) a CLI or normalization equivalent. */
export interface ContextRequest {
  schemaVersion: string
  role?: ContextRole
  query: string
  index?: string
  root?: string
  mode?: ContextCapsuleMode
  focusFiles?: string[]
  focusSymbols?: string[]
  changedFiles?: string[]
  changedSymbols?: string[]
  beforeIndex?: string
  afterIndex?: string
  upstreamArtifactRefs?: string[]
  testResponsibilityRefs?: string[]
  requestedEvidenceKinds?: RequestedEvidenceKind[]
  limits?: ContextRequestLimits
  output?: string
  auditOutput?: string
}

export interface ContextCapsuleRequest {
  originalQuery: string
  normalizedQuery: string
  mode: ContextCapsuleMode
  requestedOutputPath: string
  /** null for legacy requests (no role supplied via --role or a request file). */
  role: ContextRole | null
  /** Forward-slash path to the --request file used, or null when none was supplied. */
  requestFilePath: string | null
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
  /** Names of ContextRequest fields that were supplied, structurally validated, and
   * normalized, but are not yet operational in v1.10.1 (deferred to a later
   * batch). Sorted deterministically. Empty for legacy requests. */
  deferredRequestFields: string[]
  /** v1.10.1 Batch 2: operational role, focus, and changed-surface summary. Present
   * (with role: null and empty focus/changed-surface) for legacy requests. */
  roleContext: RoleContextSummary
  /** v1.10.1 Batch 3: deterministic, bounded, role-scoped evidence groups. Empty for legacy (no-role) requests. */
  evidenceGroups: EvidenceGroup[]
  /** v1.10.1 Batch 3: compact owner-evidence references selected across `evidenceGroups`. */
  selectedOwners: EvidenceItemRef[]
  /** v1.10.1 Batch 3: compact contract/validator/schema/error evidence references selected across `evidenceGroups`. */
  selectedContracts: EvidenceItemRef[]
  /** v1.10.1 Batch 3: compact test-evidence references (closest/related/architecture tests) selected across `evidenceGroups`. */
  selectedTests: EvidenceItemRef[]
  /** v1.10.1 Batch 3: bounded, conservative discovery of existing test infrastructure. */
  testInfrastructure: TestInfrastructureSummary
  /** v1.10.1 Batch 3: rollup of every `EvidenceGroup.unresolved` entry plus `testInfrastructure.unresolved`. */
  unresolvedItems: UnresolvedEvidenceItem[]
  /** v1.10.1 Batch 3: per-group cap/truncation rollup, mirroring `evidenceGroups[].limit/usedCount/truncated/droppedCount`. */
  groupTruncation: GroupTruncationEntry[]
  /** v1.10.4 Phase 1: condition-level retained-witness coverage. Additive and
   * optional so schema-major-1 artifacts produced before v1.10.4 remain readable. */
  roleConditionCoverage?: RoleConditionCoverage[]
  /** v1.10.1 Batch 4: deterministic responsibility-to-evidence mapping. Empty/not-requested for legacy and non-responsibility requests. */
  responsibilityMappings: ResponsibilityMappingSummary
  /** v1.10.1 Batch 4: role-specific adequacy verdict, additive to (never replacing) `contextAdequacy`. */
  roleAdequacy: RoleAdequacyStatement
  /** v1.10.1 Batch 4: fresh/stale/unknown classification with evidence and provenance. */
  freshness: FreshnessSummary
  /** v1.10.1 Batch 4: declared-vs-used limit reporting for the structured `ContextRequestLimits`. */
  budget: BudgetSummary
  /** v1.10.1 Batch 4: explicit truncation/required-evidence-loss reporting, rolling up `groupTruncation` plus responsibility-mapping and budget truncation. */
  truncation: TruncationSummary
  /** v1.10.1 Batch 4: bounded, auditable full-file-fallback usage. */
  fullFileFallback: FullFileFallbackSummary
  /** v1.10.1 Batch 4: deterministic, deduplicated evidence provenance. */
  provenance: ProvenanceRecord[]
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
  | 'resolve-focus'
  | 'merge-changed-surface'
  | 'apply-role-ranking'
  | 'build-evidence-groups'
  | 'discover-test-infrastructure'
  | 'derive-test-commands'
  | 'map-responsibilities'
  | 'evaluate-adequacy'
  | 'classify-freshness'
  | 'apply-budget'
  | 'record-provenance'

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
  /** Additive in schema major 1. Absent in legacy audits. */
  manifestSchemaVersion?: string
  /** Additive in schema major 1. Absent in legacy audits; never inferred by readers. */
  projectRoot?: string
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
  /** v1.10.1 Batch 2: operational role, focus, and changed-surface summary. Present
   * (with role: null and empty focus/changed-surface) for legacy requests. */
  roleContext: RoleContextSummary
  /** v1.10.1 Batch 4: same responsibility-mapping summary written to the capsule. */
  responsibilityMappings: ResponsibilityMappingSummary
  /** v1.10.4 Phase 1: same condition-level coverage written to the capsule.
   * Absent in legacy schema-major-1 audits and never inferred by readers. */
  roleConditionCoverage?: RoleConditionCoverage[]
  /** v1.10.1 Batch 4: same role-specific adequacy verdict written to the capsule. */
  roleAdequacy: RoleAdequacyStatement
  /** v1.10.1 Batch 4: same freshness classification written to the capsule. */
  freshness: FreshnessSummary
  /** v1.10.1 Batch 4: same budget usage written to the capsule. */
  budget: BudgetSummary
  /** v1.10.1 Batch 4: same truncation reporting written to the capsule. */
  truncation: TruncationSummary
  /** v1.10.1 Batch 4: same full-file-fallback reporting written to the capsule. */
  fullFileFallback: FullFileFallbackSummary
  /** v1.10.1 Batch 4: same provenance records written to the capsule. */
  provenance: ProvenanceRecord[]
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
  /** v1.10.1 Batch 2: role-aware ranking adjustment applied on top of `modeAdjustment`, or 0/absent when no role was supplied. */
  roleScoreAdjustment?: number
  /** v1.10.1 Batch 2: which context role produced `roleScoreAdjustment`, or absent for legacy (no-role) requests. */
  contextRole?: ContextRole
  /** v1.10.1 Batch 2: true when this candidate matches an explicit `focusFiles`/`focusSymbols` entry. */
  focusMatch?: boolean
  /** v1.10.1 Batch 2: true when this candidate matches merged changed-surface evidence. */
  changedSurfaceMatch?: boolean
  changedStatus?: ChangedSurfaceStatus
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
  /** v1.12.0 Batch 6: grounded Android component-role provenance for a `symbol`-kind
   * candidate (e.g. a Kotlin ViewModel/Repository/DAO class) - the same signal
   * `search --android-role` (v1.12.0 Batch 5) uses to exclude a non-Android symbol
   * whose classification role name happens to overlap an Android category. */
  androidComponentRefs?: SemanticArtifactRef[]
  retained: boolean
  droppedReason?: string
  /** v1.10.1 Batch 2: role-aware ranking adjustment applied on top of `modeAdjustment`, or 0/absent when no role was supplied. */
  roleScoreAdjustment?: number
  /** v1.10.1 Batch 2: which context role produced `roleScoreAdjustment`, or absent for legacy (no-role) requests. */
  contextRole?: ContextRole
  /** v1.10.1 Batch 2: true when this candidate matches an explicit `focusFiles`/`focusSymbols` entry. */
  focusMatch?: boolean
  /** v1.10.1 Batch 2: true when this candidate matches merged changed-surface evidence. */
  changedSurfaceMatch?: boolean
  changedStatus?: ChangedSurfaceStatus
  /** v1.10.1 Batch 2: true when this candidate was synthesized from explicit focus/changed-surface evidence rather than found by search. */
  synthesized?: boolean
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
  /** v1.12.0 Batch 6 (additive/optional): stable conflict-kind discriminator.
   * Absent on capsules produced before this batch. */
  kind?: string
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

// --- v1.10.1 Batch 2: role-aware candidate generation and changed-surface ranking ---
//
// Operationalizes ContextRole/ContextRequest fields declared (but deferred) in
// Batch 1: focusFiles, focusSymbols, changedFiles, changedSymbols, beforeIndex,
// afterIndex, and the candidate-generation-relevant subset of
// requestedEvidenceKinds. Additive only: no new artifact, no second ranking
// pipeline, no second graph-diff implementation.

/** Resolution outcome for one `focusFiles` entry against the active index. */
export interface FocusFileResolution {
  /** Normalized, project-relative (or as-supplied) input path. */
  path: string
  resolved: boolean
  /** Matching symbol-index file paths (usually zero or one). */
  matchedFilePaths: string[]
  /** Stable symbol nodeIds (`symbol:<path>#<name>`) contained by the matched file. */
  containedSymbolIds: string[]
}

/** Resolution outcome for one `focusSymbols` entry. */
export interface FocusSymbolResolution {
  /** As-supplied stable ID or simple name. */
  symbol: string
  resolved: boolean
  /** True when a simple (non-stable-ID) name matched more than one candidate. */
  ambiguous: boolean
  /** Stable candidate nodeIds; exactly one when `resolved` is true. */
  matchedNodeIds: string[]
}

export interface ContextFocusIntake {
  focusFiles: FocusFileResolution[]
  focusSymbols: FocusSymbolResolution[]
  unresolvedFocusFiles: string[]
  unresolvedFocusSymbols: string[]
  ambiguousFocusSymbols: string[]
  warnings: string[]
}

/** Change status for a changed-surface file/symbol entry. `unknown` covers
 * caller-supplied entries with no graph-diff corroboration. */
export type ChangedSurfaceStatus = 'added' | 'modified' | 'removed' | 'unknown'

/** Where a changed-surface entry's evidence originated. */
export type ChangedSurfaceProvenance = 'caller' | 'graph-diff' | 'both'

export interface ChangedFileEntry {
  path: string
  status: ChangedSurfaceStatus
  provenance: ChangedSurfaceProvenance
}

export interface ChangedSymbolEntry {
  /** Stable symbol ID (`symbol:<path>#<name>`) when resolvable; otherwise the raw supplied value. */
  symbolId: string
  status: ChangedSurfaceStatus
  provenance: ChangedSurfaceProvenance
  filePath?: string
  name?: string
  kind?: string
}

export interface ChangedSurface {
  /** True when any changed-surface evidence (caller-supplied or graph-diff) was available. */
  available: boolean
  /** True when a before/after graph-diff comparison was actually requested (both indexes supplied). */
  diffRequested: boolean
  files: ChangedFileEntry[]
  symbols: ChangedSymbolEntry[]
  /** Human-readable notes describing merge conflicts between caller-supplied and graph-diff evidence. */
  conflicts: string[]
  warnings: string[]
}

export interface RoleContextSummary {
  role: ContextRole | null
  focus: ContextFocusIntake
  changedSurface: ChangedSurface
  requestedEvidenceKinds: RequestedEvidenceKind[]
  /** Requested evidence kinds owned by a later batch (only `responsibility-mappings`
   * as of Batch 3): accepted, but honestly reported as not yet influencing retrieval. */
  unsupportedRequestedEvidenceKinds: RequestedEvidenceKind[]
  warnings: string[]
}

// --- v1.10.1 Batch 3: evidence groups and bounded test-infrastructure discovery ---
//
// Transforms role-aware ranked candidates (Batch 2) into deterministic, bounded,
// stage-usable evidence groups, and adds conservative discovery of existing test
// infrastructure (related tests, fixtures, factories, mocks, setup files, test
// configuration, package scripts, exact test commands). Additive only: reuses
// candidate ranking, current file classifications, and the existing code graph;
// no second context engine, no second ranking system, no new index artifact.

/** Stable evidence-group kinds, independent of role. The same kind may be
 * produced by more than one role (e.g. `owners`), scoped by `EvidenceGroup.role`. */
export type EvidenceGroupKind =
  | 'owners'
  | 'extension-points'
  | 'contracts'
  | 'graph-neighborhood'
  | 'architecture-tests'
  | 'dependencies'
  | 'callers-and-callees'
  | 'validators-and-constants'
  | 'errors'
  | 'schemas-and-serializers'
  | 'compatibility-surfaces'
  | 'closest-tests'
  | 'changed-surface'
  | 'production-symbols'
  | 'validators-and-boundaries'
  | 'errors-and-side-effects'
  | 'related-tests'
  | 'fixtures'
  | 'factories'
  | 'mocks'
  | 'setup-and-configuration'
  | 'test-commands'
  | 'unresolved-evidence'

export const EVIDENCE_GROUP_KINDS: readonly EvidenceGroupKind[] = [
  'owners',
  'extension-points',
  'contracts',
  'graph-neighborhood',
  'architecture-tests',
  'dependencies',
  'callers-and-callees',
  'validators-and-constants',
  'errors',
  'schemas-and-serializers',
  'compatibility-surfaces',
  'closest-tests',
  'changed-surface',
  'production-symbols',
  'validators-and-boundaries',
  'errors-and-side-effects',
  'related-tests',
  'fixtures',
  'factories',
  'mocks',
  'setup-and-configuration',
  'test-commands',
  'unresolved-evidence',
]

export type EvidenceItemKind =
  | 'file'
  | 'symbol'
  | 'test-file'
  | 'fixture'
  | 'factory'
  | 'mock'
  | 'setup-file'
  | 'config-file'
  | 'package-script'
  | 'command'

export interface EvidenceItemSourceLocation {
  filePath: string
  line?: number
}

/** One deduplicated evidence-group member. Never carries full source text —
 * compact metadata and stable references only (see section 9.2). */
export interface EvidenceItemRef {
  /** Stable identity: a project-relative path, a `symbol:<path>#<name>` ID, or a graph nodeId. */
  id: string
  itemKind: EvidenceItemKind
  path?: string
  symbolId?: string
  nodeId?: string
  sourceLocation?: EvidenceItemSourceLocation
  /** Relationship to the focus/changed surface/selected test that justified inclusion. */
  relationship: string
  /** Ranking/selection basis (e.g. which classification/graph/import evidence matched). */
  basis: string
  /** Where this evidence was derived from (e.g. "candidate-ranking", "graph-edge:imports", "vitest-config"). */
  provenance: string
  metadata?: Record<string, string | number | boolean | null>
}

/** A requested/expected evidence item that could not be grounded. Distinct from
 * `unsupportedRequestedEvidenceKinds` (Batch 1/2): this covers evidence kinds that
 * ARE operational but found no grounded evidence for this particular request. */
export interface UnresolvedEvidenceItem {
  evidenceKind: string
  role: ContextRole | null
  basis: string
  reason: string
  /** True only when established conventions treat the gap as adequacy-blocking; final
   * role-specific adequacy impact remains Batch 4 scope, so this is informational in Batch 3. */
  blocking: boolean
}

export interface EvidenceGroup {
  /** Stable, deterministic ID: `${role ?? 'no-role'}-${kind}`. */
  id: string
  kind: EvidenceGroupKind
  role: ContextRole | null
  title: string
  required: boolean
  items: EvidenceItemRef[]
  unresolved: UnresolvedEvidenceItem[]
  warnings: string[]
  limit: number | null
  availableCount: number
  usedCount: number
  truncated: boolean
  droppedCount: number
  provenance: string
}

/** Stable identifiers for evidence-backed role conditions introduced in v1.10.4.
 * New conditions must be added through the canonical definition owner rather than
 * re-declared by allocation, adequacy, or serialization modules. */
export type RoleConditionId =
  | 'implementation.selected-owner'
  | 'implementation.required-contract'

/** Current witness-policy vocabulary is intentionally narrow. The required count
 * remains explicit so a bounded minimum can be represented when a real condition
 * needs one without changing the result shape. */
export type RoleConditionWitnessPolicy = 'at-least-one'

export interface RoleConditionDefinition {
  conditionId: RoleConditionId
  role: ContextRole
  required: boolean
  witnessPolicy: RoleConditionWitnessPolicy
  requiredWitnessCount: number
  evidenceGroupIds: string[]
  conditionLabel: string
  description: string
  evaluationOrder: number
}

export type RoleConditionCoverageLossReason = 'bounded-allocation-omitted-required-witnesses'

/** Additive diagnostic contract. This deliberately does not change the legacy
 * truncation or role-adequacy verdict in v1.10.4 Phase 1, Batch 1. */
export interface RoleConditionCoverage {
  conditionId: RoleConditionId
  role: ContextRole
  required: boolean
  evidenceGroupIds: string[]
  witnessPolicy: RoleConditionWitnessPolicy
  requiredWitnessCount: number
  availableWitnessCount: number
  retainedWitnessCount: number
  retainedWitnessIds: string[]
  conditionSatisfied: boolean
  lostRequiredCondition: boolean
  lossReason: RoleConditionCoverageLossReason | null
  evaluationOrder: number
}

export interface TestConfigurationEvidenceEntry {
  path: string
  framework: string
  /** True only when this batch actually parses the framework's config (Vitest); false for
   * a detected-but-unparsed framework (honestly reported, never silently treated as supported). */
  supported: boolean
  fields: Record<string, string | number | boolean | string[] | null>
  warnings: string[]
}

export interface PackageScriptEvidenceEntry {
  name: string
  command: string
  reason: string
  packageJsonPath: string
}

export type TestCommandScope = 'file' | 'directory' | 'suite' | 'full-project'

export interface TestCommandEvidenceEntry {
  commandText: string | null
  commandSource: string
  testFiles: string[]
  framework: string | null
  scope: TestCommandScope
  basis: string
  unresolvedReason?: string
}

export interface TestInfrastructureSummary {
  relatedTests: EvidenceItemRef[]
  fixtures: EvidenceItemRef[]
  factories: EvidenceItemRef[]
  mocks: EvidenceItemRef[]
  setupFiles: EvidenceItemRef[]
  testConfigurations: TestConfigurationEvidenceEntry[]
  packageScripts: PackageScriptEvidenceEntry[]
  testCommands: TestCommandEvidenceEntry[]
  unresolved: UnresolvedEvidenceItem[]
  warnings: string[]
}

export interface GroupTruncationEntry {
  groupId: string
  limit: number | null
  availableCount: number
  usedCount: number
  truncated: boolean
  droppedCount: number
  /** Additive schema-major-1 diagnostic: stable identities omitted by a genuine
   * bounded required-group overflow. Older consumers may ignore this field. */
  droppedEvidenceIds?: string[]
  /** v1.10.3 Batch 2 (additive, optional): required-first allocation diagnostics.
   * Populated only for groups produced by the required-first allocator (currently:
   * the implementation and test-implementation roles' required evidence groups).
   * Absent for groups the allocator does not govern (for example, architecture) —
   * older consumers can ignore all of these fields. */
  required?: boolean
  /** This group's initial bounded reservation, before any spillover. */
  reservation?: number
  /** How many items this group filled from its own reservation, before spillover. */
  initiallySelectedCount?: number
  /** Unused reservation this group contributed to the shared spillover pool. */
  unusedReservationContributed?: number
  /** Additional items this group received from the shared spillover pool. */
  borrowedCapacity?: number
  /** Minimum condition-required witness deficit attributable to bounded omission.
   * Additive schema-major-1 diagnostic; legacy paths may conservatively classify
   * every omission from a required group as required. */
  requiredOmittedCount?: number
  /** All remaining bounded omissions after condition-required loss is attributed. */
  optionalOmittedCount?: number
  /** True only when requiredOmittedCount is greater than zero. */
  adequacyAffected?: boolean
  /** The real finite bound governing this allocation pass (sum of all participating groups' reservations). */
  governingHardBound?: number
  /** Total items selected across all groups in this allocation pass. */
  aggregateCapacityUsed?: number
  /** governingHardBound minus aggregateCapacityUsed. */
  aggregateCapacityRemaining?: number
}

// --- v1.10.1 Batch 4: responsibility mapping, role adequacy, freshness, budget,
// truncation, full-file fallback, and provenance ---
//
// Completes the stage-specific bounded context contract additively: reuses
// Batch 2 changed-surface/focus evidence, Batch 3 evidence groups and bounded
// test-infrastructure discovery, and the existing (Batch 1) ContextAdequacyStatement.
// No second graph, no second index, no second capsule/audit artifact, no LLM mapper.

export type ResponsibilityCriticality = 'critical' | 'noncritical'

/** Deterministic responsibility-mapping status (section 11). `not-applicable` is only
 * ever set from an explicit caller-supplied flag, never inferred. */
export type ResponsibilityMappingStatus = 'mapped' | 'partially-mapped' | 'unmapped' | 'not-applicable'

/** Structured responsibility input. The current `ContextRequest.testResponsibilityRefs`
 * contract (Batch 1) is `string[]` (stable IDs only); each string is normalized into one
 * of these with `criticality: 'noncritical'` (the documented safe default, section 18) and
 * `notApplicable: false`. This richer shape exists so a future structured
 * `testResponsibilityRefs` contract change (out of Batch 4 scope) has a stable landing
 * type, and so mapping/adequacy logic can be unit-tested without a full request file. */
export interface ResponsibilityInput {
  id: string
  behavior?: string
  invariant?: string
  criticality?: ResponsibilityCriticality
  /** Explicit, caller-supplied "not applicable" marker. Never inferred from prose. */
  notApplicable?: boolean
}

export type ProvenanceCategory =
  | 'request'
  | 'cli'
  | 'request-file'
  | 'focus-file'
  | 'focus-symbol'
  | 'caller-changed-file'
  | 'caller-changed-symbol'
  | 'graph-diff'
  | 'active-index'
  | 'before-index'
  | 'after-index'
  | 'code-graph'
  | 'symbol-index'
  | 'source-scan'
  | 'test-directory-walk'
  | 'import-scan'
  | 'package-json'
  | 'test-configuration'
  | 'upstream-artifact-ref'

/** One deterministic provenance record (section 28). Never duplicates a full evidence
 * payload — only a stable pointer back to it plus where it came from. */
export interface ProvenanceRecord {
  /** Stable, deterministic ID: `${category}:${sourcePath ?? sourceId ?? 'unknown'}:${evidenceId}`. */
  id: string
  category: ProvenanceCategory
  sourcePath: string | null
  sourceId: string | null
  /** The evidence item ID (see `EvidenceItemRef.id`) this provenance record is about. */
  evidenceId: string
  relationshipBasis: string
  role: ContextRole | null
  requestField: string | null
  derivedByModule: string
}

export interface ResponsibilityMapping {
  responsibilityId: string
  behavior: string | null
  invariant: string | null
  criticality: ResponsibilityCriticality
  productionSymbols: EvidenceItemRef[]
  contracts: EvidenceItemRef[]
  validators: EvidenceItemRef[]
  constants: EvidenceItemRef[]
  errors: EvidenceItemRef[]
  sideEffectEvidence: EvidenceItemRef[]
  proposedOrExistingTestFiles: EvidenceItemRef[]
  reusableHelpers: EvidenceItemRef[]
  oracleEvidence: EvidenceItemRef[]
  testCommands: EvidenceItemRef[]
  mappingStatus: ResponsibilityMappingStatus
  unresolvedReasons: string[]
  provenance: ProvenanceRecord[]
  warnings: string[]
}

export interface ResponsibilityMappingSummary {
  /** True only when `responsibility-mappings` was actually requested AND at least one
   * responsibility was supplied AND at least one reference resolved (section 19). */
  requested: boolean
  operational: boolean
  mappings: ResponsibilityMapping[]
  unknownResponsibilityIds: string[]
  duplicateResponsibilityIds: string[]
  limit: number | null
  availableCount: number
  usedCount: number
  truncated: boolean
  droppedCount: number
  /** True only when a `criticality: 'critical'` responsibility was itself dropped by the
   * `responsibilityMappings` limit (section 25.2/25.3): critical responsibilities are always
   * sorted ahead of noncritical ones before truncation, so this can only become true once
   * every critical responsibility already exceeds the limit on its own. Distinct from a
   * critical responsibility that survived truncation but mapped as `unmapped`/`partially-mapped`
   * (see `criticalUnmappedResponsibilityIds`/`criticalPartiallyMappedResponsibilityIds`). */
  criticalDropped: boolean
  warnings: string[]
}

export type FreshnessState = 'fresh' | 'stale' | 'unknown'

export interface FreshnessComparedIdentity {
  label: string
  value: string | null
}

export interface FreshnessSummary {
  state: FreshnessState
  role: ContextRole | null
  evidenceUsed: string[]
  evidenceUnavailable: string[]
  comparedIdentities: FreshnessComparedIdentity[]
  reason: string
  relevantChangedPaths: string[]
  warnings: string[]
}

export interface BudgetLimitUsage {
  name: string
  declaredValue: number | null
  usedValue: number
  availableCount: number | null
  droppedCount: number | null
  truncated: boolean
  requiredEvidenceAffected: boolean
  adequacyImpact: string | null
}

export interface BudgetCharacterUsage {
  measured: number
  limit: number | null
  truncated: boolean
}

export interface BudgetSummary {
  limits: BudgetLimitUsage[]
  characters: BudgetCharacterUsage | null
  warnings: string[]
}

export interface TruncationRecord {
  id: string
  affectedGroup: string
  limit: number | null
  used: number
  available: number
  droppedCount: number
  droppedEvidenceIds: string[]
  requiredEvidenceLost: boolean
  adequacyImpact: string | null
  reason: string
}

export interface TruncationSummary {
  truncated: boolean
  /** Additive schema-major-1 rollup. Current output always supplies it; legacy
   * artifacts may omit it. */
  requiredEvidenceLost?: boolean
  records: TruncationRecord[]
  warnings: string[]
}

export interface FullFileFallbackRecord {
  id: string
  filePath: string
  reason: string
  requestedEvidenceKind: string | null
  boundedRetrievalAttempted: boolean
  sourceRangesAttempted: number
  includedLineCount: number
  includedCharacterCount: number
  role: ContextRole | null
  responsibilityIdsAffected: string[]
  allowed: boolean
  provenance: string
}

export interface FullFileFallbackSummary {
  enabled: boolean
  limit: number | null
  used: number
  fallbacks: FullFileFallbackRecord[]
  warnings: string[]
}

/** Role-specific adequacy verdict (section 20). Extends, rather than replaces, the
 * existing Batch 1 `ContextAdequacyStatement`: `status` reuses `ContextAdequacyStatus`. */
export interface RoleAdequacyStatement {
  role: ContextRole | null
  status: ContextAdequacyStatus
  requiredConditions: string[]
  satisfiedConditions: string[]
  missingConditions: string[]
  blockingConditions: string[]
  warnings: string[]
  supportingEvidence: string[]
  affectedResponsibilityIds: string[]
  truncationImpact: boolean
  freshnessImpact: boolean
}
