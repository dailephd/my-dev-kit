import type {
  RetrievalRegressionMetrics,
  RetrievalRegressionReport,
  RetrievalRegressionRunnerOptions,
  TaskAssertionSummary,
} from '../../src/retrievalRegression/types.js'

export function emptyAssertionSummary(): TaskAssertionSummary {
  return { total: 0, passed: 0, failed: 0, blocked: 0, skipped: 0, requiredFailed: 0, warningFailed: 0 }
}

export function emptyRunnerOptions(): RetrievalRegressionRunnerOptions {
  return { failOnRegression: false, maxFailures: null, maxFailuresReached: false }
}

export function emptyMetrics(): RetrievalRegressionMetrics {
  return {
    taskCount: 0,
    executableTaskCount: 0,
    skippedTaskCount: 0,
    executedTaskCount: 0,
    blockedTaskCount: 0,
    passedTaskCount: 0,
    regressionTaskCount: 0,
    assertionCount: 0,
    assertionPassCount: 0,
    assertionFailCount: 0,
    assertionBlockedCount: 0,
    assertionSkippedCount: 0,
    warningCount: 0,
    errorCount: 0,
    candidateFileAssertionPassRate: null,
    candidateNodeAssertionPassRate: null,
    focusAssertionPassRate: null,
    graphEvidenceAssertionPassRate: null,
    sourceEvidenceAssertionPassRate: null,
    semanticSummaryAssertionPassRate: null,
    classificationSummaryAssertionPassRate: null,
    artifactReferenceAssertionPassRate: null,
    conflictAssertionPassRate: null,
    modeEffectAssertionPassRate: null,
    auditAssertionPassRate: null,
    noRawContentAssertionPassRate: null,
    capComplianceAssertionPassRate: null,
    adequacyAssertionPassRate: null,
    candidateFileCount: null,
    candidateNodeCount: null,
    selectedGraphNodeCount: null,
    selectedGraphEdgeCount: null,
    selectedSourceSliceCount: null,
    auditStepCount: null,
  }
}

export function sampleReport(overrides: Partial<RetrievalRegressionReport> = {}): RetrievalRegressionReport {
  return {
    schemaVersion: '1.0.0',
    suiteId: 'sample-suite',
    suiteName: 'Sample suite',
    target: 'my-dev-kit',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    configPath: 'benchmarks/retrieval/v1.7/core.json',
    outputDir: '.my-dev-kit/retrieval-regression',
    options: emptyRunnerOptions(),
    summary: {
      taskCount: 1,
      executableTaskCount: 0,
      skippedTaskCount: 1,
      executedTaskCount: 0,
      notEvaluatedTaskCount: 0,
      blockedTaskCount: 0,
      passedTaskCount: 1,
      regressionTaskCount: 0,
      warningCount: 0,
      errorCount: 0,
      generatedArtifactCount: 0,
    },
    assertionSummary: emptyAssertionSummary(),
    metrics: emptyMetrics(),
    tasks: [
      {
        id: 'sample-task',
        title: 'Sample task',
        status: 'skipped',
        verdict: 'PASS',
        skip: true,
        skipReason: 'Not executed yet.',
        tags: ['data-model'],
        warnings: [],
        errors: [],
      },
    ],
    warnings: [],
    errors: [],
    verdict: 'PASS',
    ...overrides,
  }
}
