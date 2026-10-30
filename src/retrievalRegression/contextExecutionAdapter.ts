import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { toForwardSlash } from '../io/pathUtils.js'
import { CONTEXT_REQUEST_SCHEMA_VERSION, type ContextRequest } from '../context/types.js'
import type { RetrievalRegressionCaps, RetrievalRegressionMode, RetrievalRegressionSuiteConfig, RetrievalRegressionTask } from './types.js'

export interface ContextExecutionResult {
  status: 'executed' | 'blocked'
  exitCode: number | null
  durationMs: number
  args: string[]
  capsulePath: string | null
  auditPath: string | null
  stdoutPath: string
  stderrPath?: string
  warnings: string[]
  errors: string[]
}

function tsxCliPath(repoRoot: string): string {
  return path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
}

function buildCapArgs(caps: RetrievalRegressionCaps): string[] {
  const args: string[] = []
  if (caps.maxCandidateFiles !== undefined) args.push('--max-candidate-files', String(caps.maxCandidateFiles))
  if (caps.maxSourceSlices !== undefined) args.push('--max-source-slices', String(caps.maxSourceSlices))
  if (caps.maxGraphNodes !== undefined) args.push('--max-graph-nodes', String(caps.maxGraphNodes))
  if (caps.maxGraphEdges !== undefined) args.push('--max-graph-edges', String(caps.maxGraphEdges))
  return args
}

export function buildContextArgs(options: {
  indexDir: string
  task: RetrievalRegressionTask
  config: RetrievalRegressionSuiteConfig
  capsulePath: string
  auditPath: string
  requestPath?: string
}): string[] {
  const { indexDir, task, config, capsulePath, auditPath } = options
  const mode: RetrievalRegressionMode = task.mode ?? config.defaultMode ?? 'general'
  const caps: RetrievalRegressionCaps = { ...config.defaultCaps, ...task.caps }

  const args = [
    'src/cli.ts',
    'context',
    '--index',
    indexDir,
    ...(options.requestPath ? ['--request', options.requestPath] : ['--query', task.query ?? '']),
    '--out',
    capsulePath,
    '--audit-out',
    auditPath,
    '--mode',
    mode,
    '--json',
    ...buildCapArgs(caps),
  ]

  if (task.noSource) args.push('--no-source')

  return args
}

export function runContextForTask(options: {
  repoRoot: string
  indexDir: string
  task: RetrievalRegressionTask
  config: RetrievalRegressionSuiteConfig
  taskOutputDir: string
}): ContextExecutionResult {
  const { repoRoot, indexDir, task, config, taskOutputDir } = options

  const capsulePath = toForwardSlash(path.join(taskOutputDir, 'context-capsule.json'))
  const auditPath = toForwardSlash(path.join(taskOutputDir, 'retrieval-audit-record.json'))
  const stdoutPath = path.join(taskOutputDir, 'context-stdout.json')
  const stderrPath = path.join(taskOutputDir, 'context-stderr.txt')

  fs.mkdirSync(taskOutputDir, { recursive: true })

  let requestPath: string | undefined
  const execution = task.execution
  if (execution?.kind === 'context' && Object.keys(execution).some(key => key !== 'kind')) {
    requestPath = toForwardSlash(path.join(taskOutputDir, 'context-request.json'))
    const request: ContextRequest = { schemaVersion: CONTEXT_REQUEST_SCHEMA_VERSION, query: task.query ?? '' }
    if (execution.role !== undefined) request.role = execution.role
    for (const key of ['focusFiles', 'focusSymbols', 'changedFiles', 'changedSymbols', 'requestedEvidenceKinds'] as const) {
      if (execution[key] !== undefined) Object.assign(request, { [key]: execution[key] })
    }
    fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  }
  const cliArgs = buildContextArgs({ indexDir, task, config, capsulePath, auditPath, requestPath })

  const startedAt = Date.now()
  const result = spawnSync(process.execPath, [tsxCliPath(repoRoot), ...cliArgs], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  })
  const durationMs = Date.now() - startedAt

  const warnings: string[] = []
  const errors: string[] = []

  fs.writeFileSync(stdoutPath, result.stdout ?? '', 'utf8')
  const hasStderr = Boolean(result.stderr && result.stderr.trim().length > 0)
  if (hasStderr) fs.writeFileSync(stderrPath, result.stderr, 'utf8')

  if (result.status !== 0) {
    errors.push(`context command exited with code ${result.status}: ${(result.stderr ?? '').trim().slice(0, 500)}`)
    return {
      status: 'blocked',
      exitCode: result.status,
      durationMs,
      args: cliArgs,
      capsulePath: null,
      auditPath: null,
      stdoutPath: toForwardSlash(stdoutPath),
      stderrPath: hasStderr ? toForwardSlash(stderrPath) : undefined,
      warnings,
      errors,
    }
  }

  try {
    JSON.parse(result.stdout)
  } catch (error) {
    warnings.push(`context stdout was not valid JSON: ${(error as Error).message}`)
  }

  if (!fs.existsSync(capsulePath)) errors.push(`Expected context-capsule.json was not written: ${capsulePath}`)
  if (!fs.existsSync(auditPath)) errors.push(`Expected retrieval-audit-record.json was not written: ${auditPath}`)

  const status = errors.length > 0 ? 'blocked' : 'executed'

  return {
    status,
    exitCode: result.status,
    durationMs,
    args: cliArgs,
    capsulePath: status === 'executed' ? toForwardSlash(capsulePath) : null,
    auditPath: status === 'executed' ? toForwardSlash(auditPath) : null,
    stdoutPath: toForwardSlash(stdoutPath),
    stderrPath: hasStderr ? toForwardSlash(stderrPath) : undefined,
    warnings,
    errors,
  }
}
