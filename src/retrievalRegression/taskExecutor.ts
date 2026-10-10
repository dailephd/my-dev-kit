import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { toForwardSlash } from '../io/pathUtils.js'
import { evaluateTaskAssertions, loadAssertionEvidence, summarizeAssertions } from './assertions.js'
import { resolveFixture } from './fixtureResolver.js'
import { prepareTaskIndex } from './indexPreparation.js'
import { runContextForTask } from './contextExecutionAdapter.js'
import { computeTaskVerdict } from './verdict.js'
import type {
  RetrievalRegressionSearchExecution,
  RetrievalRegressionSourceExecution,
  RetrievalRegressionSuiteConfig,
  RetrievalRegressionTask,
  RetrievalRegressionTaskResult,
} from './types.js'

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

  const execution = task.execution
  if (execution && execution.kind !== 'context') {
    return executeCommandTask({
      repoRoot,
      task,
      execution,
      indexDir: indexResult.indexDir,
      fixtureRoot: fixture.fixtureRoot,
      sourceRoots: fixture.sourceRoots,
      taskOutputDir: fixture.taskOutputDir,
      startedAt,
    })
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

/** Builds the existing `search`/`source` CLI arguments for a non-context execution task. */
export function buildCommandArgs(options: {
  indexDir: string
  task: RetrievalRegressionTask
  execution: RetrievalRegressionSearchExecution | RetrievalRegressionSourceExecution
}): string[] {
  const { indexDir, task, execution } = options
  if (execution.kind === 'search') {
    const args = ['src/cli.ts', 'search', '--index', indexDir, '--query', task.query ?? '']
    if (execution.intent !== undefined) args.push('--intent', execution.intent)
    if (execution.limit !== undefined) args.push('--limit', String(execution.limit))
    args.push('--json')
    return args
  }
  const args = ['src/cli.ts', 'source', '--index', indexDir]
  if (execution.node !== undefined) {
    args.push('--node', execution.node)
  } else {
    args.push('--file', execution.file ?? '', '--symbol', execution.symbol ?? '')
  }
  if (execution.maxLines !== undefined) args.push('--max-lines', String(execution.maxLines))
  if (execution.continue === true) args.push('--continue')
  if (execution.continueFrom !== undefined) args.push('--continue-from', String(execution.continueFrom))
  args.push('--json')
  return args
}

function executeCommandTask(options: {
  repoRoot: string
  task: RetrievalRegressionTask
  execution: RetrievalRegressionSearchExecution | RetrievalRegressionSourceExecution
  indexDir: string
  fixtureRoot: string
  sourceRoots: string[]
  taskOutputDir: string
  startedAt: number
}): RetrievalRegressionTaskResult {
  const { repoRoot, task, execution, indexDir, fixtureRoot, sourceRoots, taskOutputDir, startedAt } = options

  const stdoutPath = path.join(taskOutputDir, `${execution.kind}-stdout.json`)
  const stderrPath = path.join(taskOutputDir, `${execution.kind}-stderr.txt`)
  const taskExecutionPath = path.join(taskOutputDir, 'task-execution.json')
  fs.mkdirSync(taskOutputDir, { recursive: true })

  const cliArgs = buildCommandArgs({ indexDir, task, execution })
  const commandStartedAt = Date.now()
  const spawned = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), ...cliArgs],
    { cwd: repoRoot, encoding: 'utf8', shell: false }
  )
  const commandDurationMs = Date.now() - commandStartedAt

  fs.writeFileSync(stdoutPath, spawned.stdout ?? '', 'utf8')
  const hasStderr = Boolean(spawned.stderr && spawned.stderr.trim().length > 0)
  if (hasStderr) fs.writeFileSync(stderrPath, spawned.stderr, 'utf8')

  const errors: string[] = []
  if (spawned.status !== 0) {
    errors.push(`${execution.kind} command exited with code ${spawned.status}: ${(spawned.stderr ?? '').trim().slice(0, 500)}`)
  } else {
    try {
      const parsed = JSON.parse(spawned.stdout) as Record<string, unknown>
      const requiredKey = execution.kind === 'search' ? 'results' : 'content'
      if (parsed === null || typeof parsed !== 'object' || parsed[requiredKey] === undefined) {
        errors.push(`${execution.kind} command JSON result is missing required "${requiredKey}" output.`)
      }
    } catch (error) {
      errors.push(`${execution.kind} command stdout was not valid JSON: ${(error as Error).message}`)
    }
  }
  const executionBlocked = errors.length > 0

  const durationMs = Date.now() - startedAt
  fs.writeFileSync(
    taskExecutionPath,
    `${JSON.stringify(
      {
        taskId: task.id,
        fixtureRoot,
        sourceRoots,
        indexDir,
        commandExecution: {
          kind: execution.kind,
          status: executionBlocked ? 'blocked' : 'executed',
          exitCode: spawned.status,
          durationMs: commandDurationMs,
          args: cliArgs,
        },
        durationMs,
      },
      null,
      2
    )}
`,
    'utf8'
  )

  const evidence = loadAssertionEvidence({ commandResultPath: executionBlocked ? undefined : toForwardSlash(stdoutPath) })
  const assertionResults = executionBlocked ? [] : evaluateTaskAssertions(task.id, task.expectations, evidence)
  const assertionSummary = summarizeAssertions(assertionResults)
  const verdict = computeTaskVerdict({ executionBlocked, assertionResults })

  return {
    id: task.id,
    title: task.title,
    status: executionBlocked ? 'blocked' : 'executed',
    verdict,
    skip: false,
    tags: task.tags ?? [],
    fixtureRoot,
    sourceRoots,
    indexDir,
    query: task.query,
    durationMs,
    artifactPaths: {
      indexDir,
      stdoutPath: toForwardSlash(stdoutPath),
      stderrPath: hasStderr ? toForwardSlash(stderrPath) : undefined,
      taskExecutionPath: toForwardSlash(taskExecutionPath),
    },
    warnings: [],
    errors,
    assertionResults,
    assertionSummary,
  }
}
