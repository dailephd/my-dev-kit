import * as fs from 'node:fs'
import * as path from 'node:path'
import { toForwardSlash } from '../io/pathUtils.js'
import type { RetrievalRegressionReport } from './types.js'

export interface WriteRetrievalRegressionReportResult {
  jsonReportPath: string
  txtReportPath: string
}

export function writeRetrievalRegressionReport(
  outputDir: string,
  report: RetrievalRegressionReport
): WriteRetrievalRegressionReportResult {
  const resolved = path.resolve(outputDir)
  try {
    fs.mkdirSync(resolved, { recursive: true })
  } catch (error) {
    throw new Error(`Failed to create retrieval regression output directory ${outputDir}: ${(error as Error).message}`)
  }

  const jsonReportPath = path.join(resolved, 'retrieval-regression-report.json')
  const txtReportPath = path.join(resolved, 'retrieval-regression-report.txt')

  try {
    fs.writeFileSync(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    fs.writeFileSync(txtReportPath, renderTxtReport(report), 'utf8')
  } catch (error) {
    throw new Error(`Failed to write retrieval regression report to ${outputDir}: ${(error as Error).message}`)
  }

  return {
    jsonReportPath: toForwardSlash(jsonReportPath),
    txtReportPath: toForwardSlash(txtReportPath),
  }
}

/**
 * Deliberately contains only IDs/titles/status/counts - no source, graph,
 * capsule, audit, semantic, or classification content of any kind.
 */
export function renderTxtReport(report: RetrievalRegressionReport): string {
  const lines: string[] = [
    'RETRIEVAL REGRESSION REPORT',
    `Suite: ${report.suiteName} (${report.suiteId})`,
    `Target: ${report.target}`,
    `Started: ${report.startedAt}`,
    `Completed: ${report.completedAt}`,
    `Duration: ${report.durationMs}ms`,
    '',
    'Summary:',
    `  Tasks: ${report.summary.taskCount} (executable ${report.summary.executableTaskCount}, skipped ${report.summary.skippedTaskCount}, executed ${report.summary.executedTaskCount})`,
    `  Passed: ${report.summary.passedTaskCount}  Regressed: ${report.summary.regressionTaskCount}  Blocked: ${report.summary.blockedTaskCount}`,
    `  Warnings: ${report.summary.warningCount}  Errors: ${report.summary.errorCount}  Generated artifacts: ${report.summary.generatedArtifactCount}`,
    '',
    'Assertions:',
    `  Total: ${report.assertionSummary.total}  Passed: ${report.assertionSummary.passed}  Failed: ${report.assertionSummary.failed}  Blocked: ${report.assertionSummary.blocked}  Skipped: ${report.assertionSummary.skipped}`,
    `  Required failures: ${report.assertionSummary.requiredFailed}  Warning failures: ${report.assertionSummary.warningFailed}`,
    '',
    'Options:',
    `  failOnRegression: ${report.options.failOnRegression}  maxFailures: ${report.options.maxFailures ?? 'none'}  maxFailuresReached: ${report.options.maxFailuresReached}`,
    '',
    `Verdict: ${report.verdict}`,
    '',
    'Tasks:',
  ]

  for (const task of report.tasks) {
    const reasonSuffix = task.skipReason ? ` (${task.skipReason})` : ''
    lines.push(`  [${task.status}] ${task.id} - ${task.title}${reasonSuffix} - verdict ${task.verdict}`)
    if (task.fixtureRoot) lines.push(`      fixtureRoot: ${task.fixtureRoot}`)
    if (task.indexDir) lines.push(`      indexDir: ${task.indexDir}`)
    if (task.durationMs !== undefined) lines.push(`      durationMs: ${task.durationMs}`)
    if (task.artifactPaths) {
      for (const [key, value] of Object.entries(task.artifactPaths)) {
        if (value) lines.push(`      artifact.${key}: ${value}`)
      }
    }
    if (task.assertionSummary) {
      lines.push(
        `      assertions: ${task.assertionSummary.total} total, ${task.assertionSummary.passed} passed, ${task.assertionSummary.failed} failed, ${task.assertionSummary.blocked} blocked`
      )
    }
    const failedAssertions = (task.assertionResults ?? []).filter((a) => a.status === 'fail' || a.status === 'blocked')
    if (failedAssertions.length > 0) {
      lines.push('      failed assertions:')
      for (const assertion of failedAssertions) {
        lines.push(`        - [${assertion.severity}] ${assertion.assertionId} (${assertion.kind}): ${assertion.message}`)
        lines.push(`            expected: ${assertion.expectedSummary}`)
        lines.push(`            actual:   ${assertion.actualSummary}`)
      }
    }
    for (const warning of task.warnings) lines.push(`      warning: ${warning}`)
    for (const error of task.errors) lines.push(`      error: ${error}`)
  }

  lines.push(
    '',
    'Metrics:',
    `  candidateFileCount: ${formatMetric(report.metrics.candidateFileCount)}  candidateNodeCount: ${formatMetric(report.metrics.candidateNodeCount)}`,
    `  selectedGraphNodeCount: ${formatMetric(report.metrics.selectedGraphNodeCount)}  selectedGraphEdgeCount: ${formatMetric(report.metrics.selectedGraphEdgeCount)}`,
    `  selectedSourceSliceCount: ${formatMetric(report.metrics.selectedSourceSliceCount)}  auditStepCount: ${formatMetric(report.metrics.auditStepCount)}`,
    `  candidateFilePassRate: ${formatRate(report.metrics.candidateFileAssertionPassRate)}  candidateNodePassRate: ${formatRate(report.metrics.candidateNodeAssertionPassRate)}  focusPassRate: ${formatRate(report.metrics.focusAssertionPassRate)}`,
    `  graphEvidencePassRate: ${formatRate(report.metrics.graphEvidenceAssertionPassRate)}  sourceEvidencePassRate: ${formatRate(report.metrics.sourceEvidenceAssertionPassRate)}`,
    `  semanticSummaryPassRate: ${formatRate(report.metrics.semanticSummaryAssertionPassRate)}  classificationSummaryPassRate: ${formatRate(report.metrics.classificationSummaryAssertionPassRate)}`,
    `  artifactReferencePassRate: ${formatRate(report.metrics.artifactReferenceAssertionPassRate)}  conflictPassRate: ${formatRate(report.metrics.conflictAssertionPassRate)}  modeEffectPassRate: ${formatRate(report.metrics.modeEffectAssertionPassRate)}`,
    `  auditPassRate: ${formatRate(report.metrics.auditAssertionPassRate)}  noRawContentPassRate: ${formatRate(report.metrics.noRawContentAssertionPassRate)}`,
    `  capCompliancePassRate: ${formatRate(report.metrics.capComplianceAssertionPassRate)}  adequacyPassRate: ${formatRate(report.metrics.adequacyAssertionPassRate)}`
  )

  const blockedTasks = report.tasks.filter((t) => t.status === 'blocked')
  if (blockedTasks.length > 0) {
    lines.push('', 'Blocked tasks:')
    for (const task of blockedTasks) lines.push(`  - ${task.id}: ${task.errors.join('; ') || 'blocked'}`)
  }

  const notRunTasks = report.tasks.filter((t) => t.status === 'planned')
  if (notRunTasks.length > 0) {
    lines.push('', 'Not-run tasks (max-failures reached):')
    for (const task of notRunTasks) lines.push(`  - ${task.id}: ${task.errors.join('; ')}`)
  }

  const skippedTasks = report.tasks.filter((t) => t.skip)
  if (skippedTasks.length > 0) {
    lines.push('', 'Skipped tasks:')
    for (const task of skippedTasks) lines.push(`  - ${task.id}${task.skipReason ? `: ${task.skipReason}` : ''}`)
  }

  if (report.warnings.length > 0) {
    lines.push('', 'Suite warnings:')
    for (const warning of report.warnings) lines.push(`  - ${warning.taskId ? `[${warning.taskId}] ` : ''}${warning.message}`)
  }

  if (report.errors.length > 0) {
    lines.push('', 'Suite errors:')
    for (const error of report.errors) lines.push(`  - ${error.taskId ? `[${error.taskId}] ` : ''}${error.message}`)
  }

  if (report.verdict !== 'PASS') {
    lines.push(
      '',
      'Next recommended corrective area:',
      `  ${nextCorrectiveArea(report)}`
    )
  }

  return `${lines.join('\n')}\n`
}

function formatMetric(value: number | null): string {
  return value === null ? 'n/a' : String(value)
}

function formatRate(value: number | null): string {
  return value === null ? 'n/a' : `${Math.round(value * 100)}%`
}

function nextCorrectiveArea(report: RetrievalRegressionReport): string {
  if (report.summary.blockedTaskCount > 0) {
    return 'Investigate blocked tasks: missing/unreadable fixture, index, or generated evidence.'
  }
  const firstRegressed = report.tasks.find((t) => t.verdict === 'REGRESSION')
  if (firstRegressed) {
    return `Review failed required assertions on task "${firstRegressed.id}".`
  }
  return 'Review suite warnings and errors above.'
}
