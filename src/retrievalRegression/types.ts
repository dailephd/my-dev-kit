export const RETRIEVAL_REGRESSION_SCHEMA_VERSION = '1.0.0'

export type RetrievalRegressionMode = 'general' | 'feature-add' | 'subsystem'

export type RetrievalRegressionVerdict = 'PASS' | 'REGRESSION' | 'BLOCKED'

export type RetrievalRegressionTaskStatus =
  | 'skipped'
  | 'planned'
  | 'executed'
  | 'not-evaluated'
  | 'passed'
  | 'regressed'
  | 'blocked'

export interface RetrievalRegressionCaps {
  maxCandidateFiles?: number
  maxSourceSlices?: number
  maxGraphNodes?: number
  maxGraphEdges?: number
}

export interface CandidateFileExpectation {
  path?: string
  pathContains?: string
  topK?: number
  required?: boolean
}

export interface CandidateNodeExpectation {
  nodeId?: string
  nodeIdContains?: string
  symbol?: string
  path?: string
  pathContains?: string
  topK?: number
  required?: boolean
}

export interface FocusExpectation {
  nodeId?: string
  nodeIdContains?: string
  symbol?: string
  path?: string
  pathContains?: string
  allowNoFocus?: boolean
  required?: boolean
}

export interface SelectedGraphExpectation {
  requiredNodeIds?: string[]
  requiredNodeIdContains?: string[]
  requiredFiles?: string[]
  requiredFileContains?: string[]
  requiredEdgeKinds?: string[]
  forbiddenFiles?: string[]
  forbiddenFileContains?: string[]
  maxNodes?: number
  maxEdges?: number
  required?: boolean
}

export interface SourceEvidenceExpectation {
  requiredFiles?: string[]
  requiredFileContains?: string[]
  forbiddenFiles?: string[]
  forbiddenFileContains?: string[]
  minSlices?: number
  maxSlices?: number
  noSourceExpected?: boolean
  required?: boolean
}

export interface SemanticSummaryExpectation {
  required?: boolean
  requiredRoles?: string[]
  requiredArtifactKinds?: string[]
  requiredArtifactPathContains?: string[]
  allowUnavailable?: boolean
}

export interface ClassificationSummaryExpectation {
  required?: boolean
  requiredCategories?: string[]
  requiredEditGuidance?: string[]
  requiredRiskLabels?: string[]
  allowUnavailable?: boolean
}

export interface ArtifactReferenceExpectation {
  requiredKinds?: string[]
  requiredPathContains?: string[]
  allowUnavailable?: boolean
  required?: boolean
}

export interface ConflictExpectation {
  expectedStatus?: 'none' | 'conflict'
  expectedCount?: number
  requiredTypes?: string[]
  allowNone?: boolean
  required?: boolean
}

export interface ModeEffectExpectation {
  expectedMode?: RetrievalRegressionMode
  requireModeEffect?: boolean
  requiredEffectKinds?: string[]
  required?: boolean
}

export interface AuditStepExpectation {
  requiredStepIds?: string[]
  requiredOrderedStepIds?: string[]
  requireUniqueStepIds?: boolean
  expectedStepCount?: number
  minStepCount?: number
  maxStepCount?: number
  forbiddenStepIds?: string[]
  required?: boolean
}

export interface NoRawContentExpectation {
  enabled?: boolean
  forbiddenKeys?: string[]
  forbiddenPatterns?: string[]
}

export interface CapComplianceExpectation {
  maxCandidateFiles?: number
  maxCandidateNodes?: number
  maxSourceSlices?: number
  maxGraphNodes?: number
  maxGraphEdges?: number
  maxReportBytes?: number
}

export interface AdequacyExpectation {
  expectedStatus?: string
  allowedStatuses?: string[]
  allowAssumptions?: boolean
  allowConflict?: boolean
  allowInsufficient?: boolean
  required?: boolean
}

export interface RetrievalRegressionExpectation {
  candidateFiles?: CandidateFileExpectation[]
  candidateNodes?: CandidateNodeExpectation[]
  focus?: FocusExpectation
  selectedGraph?: SelectedGraphExpectation
  sourceEvidence?: SourceEvidenceExpectation
  semanticSummary?: SemanticSummaryExpectation
  classificationSummary?: ClassificationSummaryExpectation
  artifactReferences?: ArtifactReferenceExpectation
  conflicts?: ConflictExpectation
  modeEffects?: ModeEffectExpectation
  auditSteps?: AuditStepExpectation
  noRawContent?: NoRawContentExpectation
  caps?: CapComplianceExpectation
  adequacy?: AdequacyExpectation
}

export interface RetrievalRegressionTask {
  id: string
  title: string
  description?: string
  fixtureRoot?: string
  sourceRoots?: string[]
  query?: string
  mode?: RetrievalRegressionMode
  caps?: RetrievalRegressionCaps
  noSource?: boolean
  expectations?: RetrievalRegressionExpectation
  tags?: string[]
  skip?: boolean
  skipReason?: string
}

export interface RetrievalRegressionSuiteConfig {
  schemaVersion: string
  suiteId: string
  name?: string
  description?: string
  target?: string
  defaultMode?: RetrievalRegressionMode
  defaultCaps?: RetrievalRegressionCaps
  tasks: RetrievalRegressionTask[]
}

export interface RetrievalRegressionWarning {
  taskId?: string
  message: string
}

export interface RetrievalRegressionError {
  taskId?: string
  message: string
}

/**
 * Per-task generated artifact paths (Batch 2). All fields are plain path
 * strings, pointing at real v1.6 artifacts (context-capsule.json,
 * retrieval-audit-record.json) generated fresh per task run - never the
 * artifact content itself.
 */
export interface RetrievalRegressionTaskArtifactPaths {
  indexDir?: string
  capsulePath?: string
  auditPath?: string
  stdoutPath?: string
  stderrPath?: string
  taskExecutionPath?: string
}

export type AssertionStatus = 'pass' | 'fail' | 'blocked' | 'skipped'
export type AssertionSeverity = 'required' | 'warning' | 'informational'

export type AssertionKind =
  | 'candidateFile'
  | 'candidateNode'
  | 'focus'
  | 'selectedGraph'
  | 'sourceEvidence'
  | 'semanticSummary'
  | 'classificationSummary'
  | 'artifactReferences'
  | 'conflicts'
  | 'modeEffects'
  | 'auditSteps'
  | 'auditStepUniqueness'
  | 'noRawContent'
  | 'capCompliance'
  | 'adequacy'

export interface AssertionResult {
  assertionId: string
  kind: AssertionKind
  status: AssertionStatus
  severity: AssertionSeverity
  taskId: string
  message: string
  expectedSummary: string
  actualSummary: string
  evidencePath?: string
  details?: Record<string, unknown>
}

export interface TaskAssertionSummary {
  total: number
  passed: number
  failed: number
  blocked: number
  skipped: number
  requiredFailed: number
  warningFailed: number
}

export interface RetrievalRegressionTaskResult {
  id: string
  title: string
  status: RetrievalRegressionTaskStatus
  verdict: RetrievalRegressionVerdict
  skip: boolean
  skipReason?: string
  tags: string[]
  warnings: string[]
  errors: string[]
  fixtureRoot?: string
  sourceRoots?: string[]
  indexDir?: string
  mode?: RetrievalRegressionMode
  noSource?: boolean
  query?: string
  caps?: RetrievalRegressionCaps
  durationMs?: number
  artifactPaths?: RetrievalRegressionTaskArtifactPaths
  assertionResults?: AssertionResult[]
  assertionSummary?: TaskAssertionSummary
}

export interface RetrievalRegressionSummary {
  taskCount: number
  executableTaskCount: number
  skippedTaskCount: number
  executedTaskCount: number
  notEvaluatedTaskCount: number
  blockedTaskCount: number
  passedTaskCount: number
  regressionTaskCount: number
  warningCount: number
  errorCount: number
  generatedArtifactCount: number
}

export interface RetrievalRegressionArtifactPaths {
  configPath: string
  jsonReportPath: string
  txtReportPath: string
}

export interface RetrievalRegressionMetrics {
  taskCount: number
  executableTaskCount: number
  skippedTaskCount: number
  executedTaskCount: number
  blockedTaskCount: number
  passedTaskCount: number
  regressionTaskCount: number
  assertionCount: number
  assertionPassCount: number
  assertionFailCount: number
  assertionBlockedCount: number
  assertionSkippedCount: number
  warningCount: number
  errorCount: number
  candidateFileAssertionPassRate: number | null
  candidateNodeAssertionPassRate: number | null
  focusAssertionPassRate: number | null
  graphEvidenceAssertionPassRate: number | null
  sourceEvidenceAssertionPassRate: number | null
  semanticSummaryAssertionPassRate: number | null
  classificationSummaryAssertionPassRate: number | null
  artifactReferenceAssertionPassRate: number | null
  conflictAssertionPassRate: number | null
  modeEffectAssertionPassRate: number | null
  auditAssertionPassRate: number | null
  noRawContentAssertionPassRate: number | null
  capComplianceAssertionPassRate: number | null
  adequacyAssertionPassRate: number | null
  candidateFileCount: number | null
  candidateNodeCount: number | null
  selectedGraphNodeCount: number | null
  selectedGraphEdgeCount: number | null
  selectedSourceSliceCount: number | null
  auditStepCount: number | null
}

export interface RetrievalRegressionRunnerOptions {
  failOnRegression: boolean
  maxFailures: number | null
  maxFailuresReached: boolean
}

export interface RetrievalRegressionReport {
  schemaVersion: '1.0.0'
  suiteId: string
  suiteName: string
  target: string
  startedAt: string
  completedAt: string
  durationMs: number
  configPath: string
  outputDir: string
  options: RetrievalRegressionRunnerOptions
  summary: RetrievalRegressionSummary
  assertionSummary: TaskAssertionSummary
  metrics: RetrievalRegressionMetrics
  tasks: RetrievalRegressionTaskResult[]
  warnings: RetrievalRegressionWarning[]
  errors: RetrievalRegressionError[]
  verdict: RetrievalRegressionVerdict
}
