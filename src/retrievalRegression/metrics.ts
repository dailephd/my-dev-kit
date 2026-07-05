import type { AssertionKind, AssertionResult, RetrievalRegressionMetrics, RetrievalRegressionTaskResult } from './types.js'

export interface ObservedCounts {
  candidateFileCount?: number
  candidateNodeCount?: number
  selectedGraphNodeCount?: number
  selectedGraphEdgeCount?: number
  selectedSourceSliceCount?: number
  auditStepCount?: number
}

const CATEGORY_KINDS: Record<keyof Pick<
  RetrievalRegressionMetrics,
  | 'candidateFileAssertionPassRate'
  | 'candidateNodeAssertionPassRate'
  | 'focusAssertionPassRate'
  | 'graphEvidenceAssertionPassRate'
  | 'sourceEvidenceAssertionPassRate'
  | 'semanticSummaryAssertionPassRate'
  | 'classificationSummaryAssertionPassRate'
  | 'artifactReferenceAssertionPassRate'
  | 'conflictAssertionPassRate'
  | 'modeEffectAssertionPassRate'
  | 'auditAssertionPassRate'
  | 'noRawContentAssertionPassRate'
  | 'capComplianceAssertionPassRate'
  | 'adequacyAssertionPassRate'
>, AssertionKind[]> = {
  candidateFileAssertionPassRate: ['candidateFile'],
  candidateNodeAssertionPassRate: ['candidateNode'],
  focusAssertionPassRate: ['focus'],
  graphEvidenceAssertionPassRate: ['selectedGraph'],
  sourceEvidenceAssertionPassRate: ['sourceEvidence'],
  semanticSummaryAssertionPassRate: ['semanticSummary'],
  classificationSummaryAssertionPassRate: ['classificationSummary'],
  artifactReferenceAssertionPassRate: ['artifactReferences'],
  conflictAssertionPassRate: ['conflicts'],
  modeEffectAssertionPassRate: ['modeEffects'],
  auditAssertionPassRate: ['auditSteps', 'auditStepUniqueness'],
  noRawContentAssertionPassRate: ['noRawContent'],
  capComplianceAssertionPassRate: ['capCompliance'],
  adequacyAssertionPassRate: ['adequacy'],
}

function passRateFor(results: AssertionResult[], kinds: AssertionKind[]): number | null {
  const relevant = results.filter((r) => kinds.includes(r.kind) && (r.status === 'pass' || r.status === 'fail'))
  if (relevant.length === 0) return null
  const passed = relevant.filter((r) => r.status === 'pass').length
  return passed / relevant.length
}

function sumObserved(
  observedCountsByTaskId: Record<string, ObservedCounts>,
  key: keyof ObservedCounts
): number | null {
  const values = Object.values(observedCountsByTaskId)
    .map((counts) => counts[key])
    .filter((value): value is number => typeof value === 'number')
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0)
}

export function computeMetrics(
  taskResults: RetrievalRegressionTaskResult[],
  observedCountsByTaskId: Record<string, ObservedCounts> = {}
): RetrievalRegressionMetrics {
  const allAssertions: AssertionResult[] = taskResults.flatMap((t) => t.assertionResults ?? [])

  const base: Omit<RetrievalRegressionMetrics, keyof typeof CATEGORY_KINDS> & Partial<RetrievalRegressionMetrics> = {
    taskCount: taskResults.length,
    executableTaskCount: taskResults.filter((t) => !t.skip).length,
    skippedTaskCount: taskResults.filter((t) => t.skip).length,
    executedTaskCount: taskResults.filter((t) => t.status === 'executed').length,
    blockedTaskCount: taskResults.filter((t) => t.status === 'blocked').length,
    passedTaskCount: taskResults.filter((t) => t.verdict === 'PASS').length,
    regressionTaskCount: taskResults.filter((t) => t.verdict === 'REGRESSION').length,
    assertionCount: allAssertions.length,
    assertionPassCount: allAssertions.filter((r) => r.status === 'pass').length,
    assertionFailCount: allAssertions.filter((r) => r.status === 'fail').length,
    assertionBlockedCount: allAssertions.filter((r) => r.status === 'blocked').length,
    assertionSkippedCount: allAssertions.filter((r) => r.status === 'skipped').length,
    warningCount: taskResults.reduce((sum, t) => sum + t.warnings.length, 0),
    errorCount: taskResults.reduce((sum, t) => sum + t.errors.length, 0),
    candidateFileCount: sumObserved(observedCountsByTaskId, 'candidateFileCount'),
    candidateNodeCount: sumObserved(observedCountsByTaskId, 'candidateNodeCount'),
    selectedGraphNodeCount: sumObserved(observedCountsByTaskId, 'selectedGraphNodeCount'),
    selectedGraphEdgeCount: sumObserved(observedCountsByTaskId, 'selectedGraphEdgeCount'),
    selectedSourceSliceCount: sumObserved(observedCountsByTaskId, 'selectedSourceSliceCount'),
    auditStepCount: sumObserved(observedCountsByTaskId, 'auditStepCount'),
  }

  const categoryRates = Object.fromEntries(
    Object.entries(CATEGORY_KINDS).map(([metricKey, kinds]) => [metricKey, passRateFor(allAssertions, kinds)])
  ) as Pick<RetrievalRegressionMetrics, keyof typeof CATEGORY_KINDS>

  return {
    ...base,
    ...categoryRates,
  } as RetrievalRegressionMetrics
}
