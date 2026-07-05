import * as fs from 'node:fs'
import * as path from 'node:path'
import { toForwardSlash } from '../io/pathUtils.js'
import { evaluateTaskAssertions, loadAssertionEvidence, summarizeAssertions } from './assertions.js'
import { resolveFixture } from './fixtureResolver.js'
import { prepareTaskIndex } from './indexPreparation.js'
import { runContextForTask } from './contextExecutionAdapter.js'
import { computeTaskVerdict } from './verdict.js'
import type { RetrievalRegressionSuiteConfig, RetrievalRegressionTask, RetrievalRegressionTaskResult } from './types.js'

export async function executeTask(options: {
  repoRoot: string
  configPath: string
  outputDir: string
  task: RetrievalRegressionTask
  config: RetrievalRegressionSuiteConfig
}): Promise<RetrievalRegressionTaskResult> {
  const { repoRoot, configPath, outputDir, task, config } = options

  if (task.skip) {
    return {
      id: task.id,
      title: task.title,
      status: 'skipped',
      verdict: 'PASS',
      skip: true,
      skipReason: task.skipReason,
      tags: task.tags ?? [],
      warnings: [],
      errors: [],
    }
  }

  const startedAt = Date.now()

  let fixture
  try {
    fixture = resolveFixture({ configPath, outputDir, task })
  } catch (error) {
    return blockedResult(task, Date.now() - startedAt, [(error as Error).message])
  }

  let indexResult
  try {
    indexResult = await prepareTaskIndex(fixture)
  } catch (error) {
    return blockedResult(task, Date.now() - startedAt, [(error as Error).message], fixture.fixtureRoot, fixture.sourceRoots)
  }

  const contextResult = runContextForTask({
    repoRoot,
    indexDir: indexResult.indexDir,
    task,
    config,
    taskOutputDir: fixture.taskOutputDir,
  })

  const durationMs = Date.now() - startedAt
  const taskExecutionPath = path.join(fixture.taskOutputDir, 'task-execution.json')
  const taskExecutionRecord = {
    taskId: task.id,
    fixtureRoot: fixture.fixtureRoot,
    sourceRoots: fixture.sourceRoots,
    indexDir: indexResult.indexDir,
    contextExecution: {
      status: contextResult.status,
      exitCode: contextResult.exitCode,
      durationMs: contextResult.durationMs,
      args: contextResult.args,
    },
    durationMs,
  }
  fs.mkdirSync(fixture.taskOutputDir, { recursive: true })
  fs.writeFileSync(taskExecutionPath, `${JSON.stringify(taskExecutionRecord, null, 2)}\n`, 'utf8')

  const executionBlocked = contextResult.status === 'blocked'
  const status = executionBlocked ? 'blocked' : 'executed'

  const evidence = loadAssertionEvidence({
    capsulePath: contextResult.capsulePath ?? undefined,
    auditPath: contextResult.auditPath ?? undefined,
  })
  const assertionResults = executionBlocked ? [] : evaluateTaskAssertions(task.id, task.expectations, evidence)
  const assertionSummary = summarizeAssertions(assertionResults)
  const verdict = computeTaskVerdict({ executionBlocked, assertionResults })

  return {
    id: task.id,
    title: task.title,
    status,
    verdict,
    skip: false,
    tags: task.tags ?? [],
    fixtureRoot: fixture.fixtureRoot,
    sourceRoots: fixture.sourceRoots,
    indexDir: indexResult.indexDir,
    mode: task.mode ?? config.defaultMode ?? 'general',
    noSource: task.noSource ?? false,
    query: task.query,
    caps: task.caps,
    durationMs,
    artifactPaths: {
      indexDir: indexResult.indexDir,
      capsulePath: contextResult.capsulePath ?? undefined,
      auditPath: contextResult.auditPath ?? undefined,
      stdoutPath: contextResult.stdoutPath,
      stderrPath: contextResult.stderrPath,
      taskExecutionPath: toForwardSlash(taskExecutionPath),
    },
    warnings: contextResult.warnings,
    errors: contextResult.errors,
    assertionResults,
    assertionSummary,
  }
}

function blockedResult(
  task: RetrievalRegressionTask,
  durationMs: number,
  errors: string[],
  fixtureRoot?: string,
  sourceRoots?: string[]
): RetrievalRegressionTaskResult {
  return {
    id: task.id,
    title: task.title,
    status: 'blocked',
    verdict: 'BLOCKED',
    skip: false,
    tags: task.tags ?? [],
    fixtureRoot,
    sourceRoots,
    durationMs,
    warnings: [],
    errors,
  }
}
