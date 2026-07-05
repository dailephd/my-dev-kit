import { describe, expect, it } from 'vitest'
import { computeSuiteVerdict, computeTaskVerdict, summarizeAssertionsForVerdict } from '../../src/retrievalRegression/verdict.js'
import type { AssertionResult } from '../../src/retrievalRegression/types.js'

function assertion(overrides: Partial<AssertionResult>): AssertionResult {
  return {
    assertionId: 'a1',
    kind: 'focus',
    status: 'pass',
    severity: 'required',
    taskId: 'task-a',
    message: 'm',
    expectedSummary: 'e',
    actualSummary: 'a',
    ...overrides,
  }
}

describe('computeTaskVerdict', () => {
  it('returns PASS when execution succeeded and no required assertion failed', () => {
    const verdict = computeTaskVerdict({ executionBlocked: false, assertionResults: [assertion({ status: 'pass' })] })
    expect(verdict).toBe('PASS')
  })

  it('returns REGRESSION when a required assertion fails', () => {
    const verdict = computeTaskVerdict({ executionBlocked: false, assertionResults: [assertion({ status: 'fail', severity: 'required' })] })
    expect(verdict).toBe('REGRESSION')
  })

  it('returns PASS when only a warning-severity assertion fails', () => {
    const verdict = computeTaskVerdict({ executionBlocked: false, assertionResults: [assertion({ status: 'fail', severity: 'warning' })] })
    expect(verdict).toBe('PASS')
  })

  it('returns BLOCKED when execution itself was blocked', () => {
    const verdict = computeTaskVerdict({ executionBlocked: true, assertionResults: [] })
    expect(verdict).toBe('BLOCKED')
  })

  it('returns BLOCKED when a required assertion could not be evaluated', () => {
    const verdict = computeTaskVerdict({ executionBlocked: false, assertionResults: [assertion({ status: 'blocked', severity: 'required' })] })
    expect(verdict).toBe('BLOCKED')
  })
})

describe('computeSuiteVerdict', () => {
  it('returns PASS when all task verdicts are PASS', () => {
    expect(computeSuiteVerdict(['PASS', 'PASS'])).toBe('PASS')
  })

  it('returns REGRESSION when any task regressed and none are blocked', () => {
    expect(computeSuiteVerdict(['PASS', 'REGRESSION'])).toBe('REGRESSION')
  })

  it('returns BLOCKED when any task is blocked, even if another regressed', () => {
    expect(computeSuiteVerdict(['REGRESSION', 'BLOCKED'])).toBe('BLOCKED')
  })
})

describe('summarizeAssertionsForVerdict', () => {
  it('separates required and warning failures', () => {
    const summary = summarizeAssertionsForVerdict([
      assertion({ status: 'fail', severity: 'required' }),
      assertion({ status: 'fail', severity: 'warning' }),
      assertion({ status: 'pass' }),
    ])
    expect(summary.total).toBe(3)
    expect(summary.requiredFailed).toBe(1)
    expect(summary.warningFailed).toBe(1)
    expect(summary.passed).toBe(1)
  })
})
