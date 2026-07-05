import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadAssertionEvidence } from './assertions.js'
import { toForwardSlash } from '../io/pathUtils.js'
import { loadRetrievalRegressionConfig } from './configLoader.js'
import { computeMetrics } from './metrics.js'
import type { ObservedCounts } from './metrics.js'
import { writeRetrievalRegressionReport } from './reportWriter.js'
import { executeTask } from './taskExecutor.js'
import { computeSuiteVerdict, summarizeAssertionsForVerdict } from './verdict.js'
import { RETRIEVAL_REGRESSION_SCHEMA_VERSION } from './types.js'
import type { RetrievalRegressionReport, RetrievalRegressionTaskResult } from './types.js'

export const DEFAULT_CONFIG_PATH = 'benchmarks/retrieval/v1.7/core.json'
export const DEFAULT_OUTPUT_DIR = '.my-dev-kit/retrieval-regression'

export interface RunRetrievalRegressionOptions {
  configPath: string
  outputDir: string
  failOnRegression?: boolean
  maxFailures?: number | null
}

export type RunRetrievalRegressionResult =
  | { blocked: true; message: string }
  | { blocked: false; report: RetrievalRegressionReport; paths: { jsonReportPath: string; txtReportPath: string } }

function observedCountsFor(task: RetrievalRegressionTaskResult): ObservedCounts {
  if (task.status !== 'executed') return {}
  const evidence = loadAssertionEvidence({
    capsulePath: task.artifactPaths?.capsulePath,
    auditPath: task.artifactPaths?.auditPath,
  })
  return {
    candidateFileCount: evidence.capsule?.candidateFiles.length,
    candidateNodeCount: evidence.capsule?.candidateNodes.length,
    selectedGraphNodeCount: evidence.capsule?.selectedGraph.nodes.length,
    selectedGraphEdgeCount: evidence.capsule?.selectedGraph.edges.length,
    selectedSourceSliceCount: evidence.capsule?.selectedSource.slices.length,
    auditStepCount: evidence.audit?.steps.length,
  }
}

export async function runRetrievalRegression(options: RunRetrievalRegressionOptions): Promise<RunRetrievalRegressionResult> {
  const startedAt = new Date()
  const failOnRegression = options.failOnRegression ?? false
  const maxFailures = options.maxFailures ?? null

  let config
  try {
    config = loadRetrievalRegressionConfig(options.configPath)
  } catch (error) {
    return { blocked: true, message: (error as Error).message }
  }

  const taskResults: RetrievalRegressionTaskResult[] = []
  let failureCount = 0
  let maxFailuresReached = false

  for (const task of config.tasks) {
    if (maxFailuresReached) {
      taskResults.push({
        id: task.id,
        title: task.title,
        status: 'planned',
        verdict: 'BLOCKED',
        skip: false,
        tags: task.tags ?? [],
        warnings: [],
        errors: [`Not run: max-failures limit (${maxFailures}) was reached by an earlier task.`],
      })
      continue
    }

    const result = await executeTask({
      repoRoot: process.cwd(),
      configPath: options.configPath,
      outputDir: options.outputDir,
      task,
      config,
    })
    taskResults.push(result)

    if (!result.skip && (result.verdict === 'BLOCKED' || result.verdict === 'REGRESSION')) {
      failureCount += 1
      if (maxFailures !== null && failureCount >= maxFailures) {
        maxFailuresReached = true
      }
    }
  }

  const observedCountsByTaskId: Record<string, ObservedCounts> = {}
  for (const task of taskResults) {
    observedCountsByTaskId[task.id] = observedCountsFor(task)
  }

  const summary = {
    taskCount: taskResults.length,
    executableTaskCount: taskResults.filter((t) => !t.skip).length,
    skippedTaskCount: taskResults.filter((t) => t.skip).length,
    executedTaskCount: taskResults.filter((t) => t.status === 'executed').length,
    notEvaluatedTaskCount: taskResults.filter((t) => t.status === 'not-evaluated').length,
    blockedTaskCount: taskResults.filter((t) => t.status === 'blocked' || t.status === 'planned').length,
    passedTaskCount: taskResults.filter((t) => t.verdict === 'PASS').length,
    regressionTaskCount: taskResults.filter((t) => t.verdict === 'REGRESSION').length,
    warningCount: taskResults.reduce((sum, t) => sum + t.warnings.length, 0),
    errorCount: taskResults.reduce((sum, t) => sum + t.errors.length, 0),
    generatedArtifactCount: taskResults.reduce(
      (sum, t) => sum + (t.artifactPaths ? Object.values(t.artifactPaths).filter(Boolean).length : 0),
      0
    ),
  }

  const verdict = computeSuiteVerdict(taskResults.map((t) => t.verdict))
  const assertionSummary = summarizeAssertionsForVerdict(taskResults.flatMap((t) => t.assertionResults ?? []))
  const metrics = computeMetrics(taskResults, observedCountsByTaskId)

  const completedAt = new Date()
  const report: RetrievalRegressionReport = {
    schemaVersion: RETRIEVAL_REGRESSION_SCHEMA_VERSION as '1.0.0',
    suiteId: config.suiteId,
    suiteName: config.name ?? config.suiteId,
    target: config.target ?? 'my-dev-kit',
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    configPath: toForwardSlash(path.resolve(options.configPath)),
    outputDir: toForwardSlash(path.resolve(options.outputDir)),
    options: {
      failOnRegression,
      maxFailures,
      maxFailuresReached,
    },
    summary,
    assertionSummary,
    metrics,
    tasks: taskResults,
    warnings: [],
    errors: [],
    verdict,
  }

  try {
    const paths = writeRetrievalRegressionReport(options.outputDir, report)
    return { blocked: false, report, paths }
  } catch (error) {
    return { blocked: true, message: (error as Error).message }
  }
}

interface ParsedArgv {
  config?: string
  out?: string
  failOnRegression: boolean
  maxFailures: number | null
}

function parseArgv(argv: string[]): ParsedArgv {
  const parsed: ParsedArgv = { failOnRegression: false, maxFailures: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--config') {
      parsed.config = argv[++i]
    } else if (arg === '--out') {
      parsed.out = argv[++i]
    } else if (arg === '--fail-on-regression') {
      parsed.failOnRegression = true
    } else if (arg === '--max-failures') {
      const value = Number(argv[++i])
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`--max-failures must be a positive integer, received "${argv[i]}"`)
      }
      parsed.maxFailures = value
    }
  }
  return parsed
}

async function main(): Promise<void> {
  let options: ParsedArgv
  try {
    options = parseArgv(process.argv.slice(2))
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 2
    return
  }

  const configPath = options.config ?? DEFAULT_CONFIG_PATH
  const outputDir = options.out ?? DEFAULT_OUTPUT_DIR

  const result = await runRetrievalRegression({
    configPath,
    outputDir,
    failOnRegression: options.failOnRegression,
    maxFailures: options.maxFailures,
  })

  if (result.blocked) {
    console.error(result.message)
    process.exitCode = 2
    return
  }

  console.log(
    `Retrieval regression suite: ${result.report.summary.taskCount} task(s) ` +
      `(${result.report.summary.skippedTaskCount} skipped, ${result.report.summary.executedTaskCount} executed), ` +
      `verdict ${result.report.verdict}.`
  )
  console.log(`Wrote ${result.paths.jsonReportPath}`)
  console.log(`Wrote ${result.paths.txtReportPath}`)

  if (result.report.verdict === 'PASS') {
    process.exitCode = 0
  } else {
    process.exitCode = options.failOnRegression ? 2 : 0
  }
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  main()
}
