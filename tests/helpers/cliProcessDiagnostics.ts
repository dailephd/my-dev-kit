import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
} from 'node:child_process'
import { existsSync, lstatSync, readdirSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

const MAX_FIXTURE_ENTRIES = 50
const MAX_FIXTURE_DEPTH = 4

type SpawnImplementation = (
  executable: string,
  args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding
) => SpawnSyncReturns<string>

export interface TestProcessContext {
  testName: string
  stage?: string
  fixturePath?: string
  outputPath?: string
  cachePath?: string
  indexPaths?: string[]
  expectedPaths?: string[]
}

export interface RunTestProcessOptions {
  executable: string
  args: string[]
  cwd: string
  context: TestProcessContext
}

export interface SerializedSpawnError {
  name: string
  message: string
  code: string | number | null
}

export interface TestProcessResult {
  testName: string
  stage: string | null
  executable: string
  arguments: string[]
  readableCommand: string
  cwd: string
  fixturePath: string | null
  outputPath: string | null
  cachePath: string | null
  indexPaths: string[]
  expectedPaths: string[]
  exitCode: number | null
  signal: NodeJS.Signals | null
  spawnError: SerializedSpawnError | null
  stdout: string
  stderr: string
  startedAt: string
  finishedAt: string
  durationMs: number
}

export interface TestStageTiming {
  testName: string
  stage: string
  startedAt: string
  finishedAt: string
  durationMs: number
}

export interface PathDiagnostic {
  path: string
  exists: boolean
}

export interface FixtureEntryDiagnostic {
  path: string
  kind: 'directory' | 'file' | 'symbolic-link' | 'other' | 'unavailable'
  diagnosticError?: string
}

export interface FixtureDiagnostic {
  root: string
  exists: boolean
  entries: FixtureEntryDiagnostic[]
  truncated: boolean
}

interface DiagnosticDependencies {
  spawn?: SpawnImplementation
  inspectFixture?: (root: string) => FixtureDiagnostic
  inspectPath?: (path: string) => PathDiagnostic
}

function serializeSpawnError(error: Error & { code?: string | number }): SerializedSpawnError {
  return {
    name: error.name,
    message: error.message,
    code: error.code ?? null,
  }
}

function quoteCommandPart(value: string): string {
  if (value.length > 0 && /^[A-Za-z0-9_./:\\-]+$/.test(value)) return value
  return JSON.stringify(value)
}

function readableCommand(executable: string, args: readonly string[]): string {
  return [executable, ...args].map(quoteCommandPart).join(' ')
}

export function runTestProcess(
  options: RunTestProcessOptions,
  dependencies: Pick<DiagnosticDependencies, 'spawn'> = {}
): TestProcessResult {
  const spawn = dependencies.spawn ?? spawnSync
  const startedAt = new Date()
  const startTime = performance.now()
  const result = spawn(options.executable, options.args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  })
  const finishedAt = new Date()

  return {
    testName: options.context.testName,
    stage: options.context.stage ?? null,
    executable: options.executable,
    arguments: [...options.args],
    readableCommand: readableCommand(options.executable, options.args),
    cwd: resolve(options.cwd),
    fixturePath: options.context.fixturePath ? resolve(options.context.fixturePath) : null,
    outputPath: options.context.outputPath ? resolve(options.context.outputPath) : null,
    cachePath: options.context.cachePath ? resolve(options.context.cachePath) : null,
    indexPaths: (options.context.indexPaths ?? []).map((path) => resolve(path)),
    expectedPaths: (options.context.expectedPaths ?? []).map((path) => resolve(path)),
    exitCode: result.status,
    signal: result.signal,
    spawnError: result.error
      ? serializeSpawnError(result.error as Error & { code?: string | number })
      : null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.round((performance.now() - startTime) * 100) / 100,
  }
}

function timingDiagnosticsEnabled(): boolean {
  return process.env.MDK_TEST_TIMING_DIAGNOSTICS === '1'
}

export function reportTestProcessTiming(result: TestProcessResult): void {
  if (!timingDiagnosticsEnabled()) return

  process.stderr.write(
    `[test-process-timing] ${JSON.stringify({
      testName: result.testName,
      stage: result.stage,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      signal: result.signal,
      spawnError: result.spawnError,
      stdoutLength: result.stdout.length,
      stderrLength: result.stderr.length,
    })}\n`
  )
}

export function reportTestStageTiming(timing: TestStageTiming): void {
  if (!timingDiagnosticsEnabled()) return
  process.stderr.write(`[test-stage-timing] ${JSON.stringify(timing)}\n`)
}

function relativeFixturePath(root: string, path: string): string {
  const value = relative(root, path)
  return value === '' ? '.' : value.split(sep).join('/')
}

function inspectFixture(root: string): FixtureDiagnostic {
  const absoluteRoot = resolve(root)
  if (!existsSync(absoluteRoot)) {
    return { root: absoluteRoot, exists: false, entries: [], truncated: false }
  }

  const entries: FixtureEntryDiagnostic[] = []
  const pending: Array<{ path: string; depth: number }> = [{ path: absoluteRoot, depth: 0 }]
  let truncated = false

  while (pending.length > 0 && entries.length < MAX_FIXTURE_ENTRIES) {
    const current = pending.shift()
    if (!current) break

    let children: string[]
    try {
      children = readdirSync(current.path).sort()
    } catch (error) {
      entries.push({
        path: relativeFixturePath(absoluteRoot, current.path),
        kind: 'unavailable',
        diagnosticError: errorMessage(error),
      })
      continue
    }

    for (const child of children) {
      if (entries.length >= MAX_FIXTURE_ENTRIES) {
        truncated = true
        break
      }

      const childPath = resolve(current.path, child)
      try {
        const stat = lstatSync(childPath)
        const kind = stat.isSymbolicLink()
          ? 'symbolic-link'
          : stat.isDirectory()
            ? 'directory'
            : stat.isFile()
              ? 'file'
              : 'other'
        entries.push({ path: relativeFixturePath(absoluteRoot, childPath), kind })
        if (kind === 'directory') {
          if (current.depth < MAX_FIXTURE_DEPTH) {
            pending.push({ path: childPath, depth: current.depth + 1 })
          } else {
            truncated = true
          }
        }
      } catch (error) {
        entries.push({
          path: relativeFixturePath(absoluteRoot, childPath),
          kind: 'unavailable',
          diagnosticError: errorMessage(error),
        })
      }
    }
  }

  if (pending.length > 0) truncated = true
  return { root: absoluteRoot, exists: true, entries, truncated }
}

function inspectPath(path: string): PathDiagnostic {
  const absolutePath = resolve(path)
  return { path: absolutePath, exists: existsSync(absolutePath) }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

export function assertTestProcessSucceeded(
  result: TestProcessResult,
  dependencies: Omit<DiagnosticDependencies, 'spawn'> = {}
): void {
  assertTestProcessExitCode(result, 0, dependencies)
}

export function assertTestProcessExitCode(
  result: TestProcessResult,
  expectedExitCode: number,
  dependencies: Omit<DiagnosticDependencies, 'spawn'> = {}
): void {
  if (
    result.exitCode === expectedExitCode &&
    result.signal === null &&
    result.spawnError === null
  ) {
    return
  }

  const diagnosticCollectionErrors: string[] = []
  let fixture: FixtureDiagnostic | null = null
  const expectedArtifacts: PathDiagnostic[] = []

  if (result.fixturePath) {
    try {
      fixture = (dependencies.inspectFixture ?? inspectFixture)(result.fixturePath)
    } catch (error) {
      diagnosticCollectionErrors.push(`fixture inspection failed: ${errorMessage(error)}`)
    }
  }

  for (const path of result.expectedPaths) {
    try {
      expectedArtifacts.push((dependencies.inspectPath ?? inspectPath)(path))
    } catch (error) {
      diagnosticCollectionErrors.push(`artifact inspection failed for ${path}: ${errorMessage(error)}`)
    }
  }

  throw new Error(
    `CLI process exited unexpectedly with diagnostics:\n${JSON.stringify(
      {
        expectedExitCode,
        process: result,
        expectedArtifacts,
        fixture,
        diagnosticCollectionErrors,
      },
      null,
      2
    )}`
  )
}
