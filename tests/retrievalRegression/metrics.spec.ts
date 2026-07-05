import { describe, expect, it } from 'vitest'
import { computeMetrics } from '../../src/retrievalRegression/metrics.js'
import type { AssertionResult, RetrievalRegressionTaskResult } from '../../src/retrievalRegression/types.js'

function assertion(overrides: Partial<AssertionResult>): AssertionResult {
  return {
    assertionId: 'a1',
    kind: 'candidateFile',
    status: 'pass',
    severity: 'required',
    taskId: 'task-a',
    message: 'm',
    expectedSummary: 'e',
    actualSummary: 'a',
    ...overrides,
  }
}

function taskResult(overrides: Partial<RetrievalRegressionTaskResult>): RetrievalRegressionTaskResult {
  return {
    id: 'task-a',
    title: 'Task A',
    status: 'executed',
    verdict: 'PASS',
    skip: false,
    tags: [],
    warnings: [],
    errors: [],
    ...overrides,
  }
}

describe('computeMetrics', () => {
  it('aggregates assertion pass/fail/blocked/skipped counts', () => {
    const tasks = [
      taskResult({
        assertionResults: [
          assertion({ status: 'pass' }),
          assertion({ status: 'fail', kind: 'focus' }),
          assertion({ status: 'blocked', kind: 'adequacy' }),
          assertion({ status: 'skipped', kind: 'conflicts' }),
        ],
      }),
    ]
    const metrics = computeMetrics(tasks)
    expect(metrics.assertionCount).toBe(4)
    expect(metrics.assertionPassCount).toBe(1)
    expect(metrics.assertionFailCount).toBe(1)
    expect(metrics.assertionBlockedCount).toBe(1)
    expect(metrics.assertionSkippedCount).toBe(1)
  })

  it('computes category pass rates', () => {
    const tasks = [
      taskResult({
        assertionResults: [
          assertion({ status: 'pass', kind: 'candidateFile' }),
          assertion({ status: 'fail', kind: 'candidateFile' }),
        ],
      }),
    ]
    const metrics = computeMetrics(tasks)
    expect(metrics.candidateFileAssertionPassRate).toBe(0.5)
  })

  it('handles zero denominators deterministically by returning null', () => {
    const tasks = [taskResult({ assertionResults: [] })]
    const metrics = computeMetrics(tasks)
    expect(metrics.candidateFileAssertionPassRate).toBeNull()
    expect(metrics.focusAssertionPassRate).toBeNull()
  })

  it('sums provided observed counts across tasks', () => {
    const tasks = [taskResult({ id: 't1' }), taskResult({ id: 't2' })]
    const metrics = computeMetrics(tasks, {
      t1: { candidateFileCount: 2, auditStepCount: 10 },
      t2: { candidateFileCount: 3, auditStepCount: 15 },
    })
    expect(metrics.candidateFileCount).toBe(5)
    expect(metrics.auditStepCount).toBe(25)
  })

  it('returns null for observed counts when none are provided', () => {
    const metrics = computeMetrics([taskResult({})])
    expect(metrics.candidateFileCount).toBeNull()
  })
})
