import type { AssertionResult, RetrievalRegressionVerdict, TaskAssertionSummary } from './types.js'

export function summarizeAssertionsForVerdict(results: AssertionResult[]): TaskAssertionSummary {
  return {
    total: results.length,
    passed: results.filter((r) => r.status === 'pass').length,
    failed: results.filter((r) => r.status === 'fail').length,
    blocked: results.filter((r) => r.status === 'blocked').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    requiredFailed: results.filter((r) => r.status === 'fail' && r.severity === 'required').length,
    warningFailed: results.filter((r) => r.status === 'fail' && r.severity === 'warning').length,
  }
}

/**
 * A blocked required assertion (missing/unreadable evidence) takes priority
 * over a plain assertion failure: it means judgment could not be attempted,
 * which is a different failure mode than an evaluated expectation failing.
 */
export function computeTaskVerdict(options: {
  executionBlocked: boolean
  assertionResults: AssertionResult[]
}): RetrievalRegressionVerdict {
  if (options.executionBlocked) return 'BLOCKED'

  const requiredBlocked = options.assertionResults.some((r) => r.status === 'blocked' && r.severity === 'required')
  if (requiredBlocked) return 'BLOCKED'

  const requiredFailed = options.assertionResults.some((r) => r.status === 'fail' && r.severity === 'required')
  if (requiredFailed) return 'REGRESSION'

  return 'PASS'
}

export function computeSuiteVerdict(taskVerdicts: RetrievalRegressionVerdict[]): RetrievalRegressionVerdict {
  if (taskVerdicts.some((v) => v === 'BLOCKED')) return 'BLOCKED'
  if (taskVerdicts.some((v) => v === 'REGRESSION')) return 'REGRESSION'
  return 'PASS'
}
