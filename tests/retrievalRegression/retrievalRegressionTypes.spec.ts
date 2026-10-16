import { describe, expect, it } from 'vitest'
import { sampleReport } from './reportFixtures.js'
import { RETRIEVAL_REGRESSION_SCHEMA_VERSION } from '../../src/retrievalRegression/types.js'
import type {
  RetrievalRegressionCaps,
  RetrievalRegressionMode,
  RetrievalRegressionReport,
  RetrievalRegressionSuiteConfig,
  RetrievalRegressionTask,
  RetrievalRegressionTaskResult,
  RetrievalRegressionVerdict,
} from '../../src/retrievalRegression/types.js'

describe('retrieval regression types', () => {
  it('accepts only the three defined modes', () => {
    const modes: RetrievalRegressionMode[] = ['general', 'feature-add', 'subsystem']
    expect(modes).toHaveLength(3)
  })

  it('accepts only the three defined verdicts', () => {
    const verdicts: RetrievalRegressionVerdict[] = ['PASS', 'REGRESSION', 'BLOCKED']
    expect(verdicts).toHaveLength(3)
  })

  it('constructs a minimal valid task', () => {
    const task: RetrievalRegressionTask = {
      id: 'sample-task',
      title: 'Sample task',
      skip: true,
      skipReason: 'Not executed yet.',
    }
    expect(task.id).toBe('sample-task')
  })

  it('constructs a minimal valid caps object', () => {
    const caps: RetrievalRegressionCaps = { maxCandidateFiles: 8, maxGraphNodes: 30 }
    expect(caps.maxCandidateFiles).toBe(8)
  })

  it('constructs a minimal valid suite config', () => {
    const config: RetrievalRegressionSuiteConfig = {
      schemaVersion: '1.0.0',
      suiteId: 'sample-suite',
      tasks: [],
    }
    expect(config.tasks).toEqual([])
  })

  it('constructs a minimal valid task result', () => {
    const result: RetrievalRegressionTaskResult = {
      id: 'sample-task',
      title: 'Sample task',
      status: 'skipped',
      verdict: 'PASS',
      skip: true,
      skipReason: 'Not executed yet.',
      tags: [],
      warnings: [],
      errors: [],
    }
    expect(result.status).toBe('skipped')
  })

  it('constructs a minimal valid report using the exported schema version constant', () => {
    const report: RetrievalRegressionReport = {
      ...sampleReport(),
      schemaVersion: RETRIEVAL_REGRESSION_SCHEMA_VERSION as '1.0.0',
      tasks: [],
      summary: {
        taskCount: 0,
        executableTaskCount: 0,
        skippedTaskCount: 0,
        executedTaskCount: 0,
        notEvaluatedTaskCount: 0,
        blockedTaskCount: 0,
        passedTaskCount: 0,
        regressionTaskCount: 0,
        warningCount: 0,
        errorCount: 0,
        generatedArtifactCount: 0,
      },
    }
    expect(report.schemaVersion).toBe('1.0.0')
  })
})

describe('additive execution contract', () => {
  it('keeps execution optional so legacy context tasks are unchanged', () => {
    const legacy: RetrievalRegressionTask = { id: 'legacy', title: 'Legacy', query: 'q', mode: 'general' }
    expect(legacy.execution).toBeUndefined()
  })

  it('constructs search and source execution tasks with commandResult expectations', () => {
    const search: RetrievalRegressionTask = {
      id: 'search',
      title: 'Search',
      query: 'q',
      execution: { kind: 'search', intent: 'ownership', limit: 10 },
      expectations: { commandResult: { requiredResultIds: ['file:a.ts'], topK: 3 } },
    }
    const source: RetrievalRegressionTask = {
      id: 'source',
      title: 'Source',
      execution: { kind: 'source', file: 'a.ts', symbol: 's', maxLines: 8, continueFrom: 17 },
      expectations: { commandResult: { expectedStartLine: 17, continuation: 'absent' } },
    }
    expect(search.execution?.kind).toBe('search')
    expect(source.execution?.kind).toBe('source')
  })
})
