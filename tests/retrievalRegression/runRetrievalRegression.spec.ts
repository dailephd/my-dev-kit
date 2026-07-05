import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function tsxCliPath(): string {
  return join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
}

function runRegressionCli(args: string[]) {
  return spawnSync(
    process.execPath,
    [tsxCliPath(), 'src/retrievalRegression/runRetrievalRegression.ts', ...args],
    { cwd: process.cwd(), encoding: 'utf8', shell: false }
  )
}

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-retrieval-regression-run-'))
  tempDirs.push(dir)
  return dir
}

describe('runRetrievalRegression CLI', () => {
  it('runs the real core suite and returns PASS for every representative task', () => {
    const outDir = join(tmpDir(), 'out')
    const result = runRegressionCli(['--config', 'benchmarks/retrieval/v1.7/core.json', '--out', outDir])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('verdict PASS')

    const jsonPath = join(outDir, 'retrieval-regression-report.json')
    const txtPath = join(outDir, 'retrieval-regression-report.txt')
    expect(existsSync(jsonPath)).toBe(true)
    expect(existsSync(txtPath)).toBe(true)

    const report = JSON.parse(readFileSync(jsonPath, 'utf8'))
    expect(report.verdict).toBe('PASS')
    expect(report.summary.taskCount).toBe(6)
    expect(report.summary.executedTaskCount).toBe(6)
    expect(report.summary.notEvaluatedTaskCount).toBe(0)
    expect(report.summary.skippedTaskCount).toBe(0)

    for (const task of report.tasks) {
      expect(task.status).toBe('executed')
      expect(task.verdict).toBe('PASS')
      expect(task.assertionResults.length).toBeGreaterThan(0)
      expect(task.assertionResults.some((result: { kind: string }) => result.kind === 'noRawContent')).toBe(true)
      expect(task.assertionResults.some((result: { kind: string }) => result.kind === 'auditSteps')).toBe(true)
      expect(existsSync(task.artifactPaths.capsulePath)).toBe(true)
      expect(existsSync(task.artifactPaths.auditPath)).toBe(true)
      expect(existsSync(task.artifactPaths.taskExecutionPath)).toBe(true)
    }
    expect(report.tasks.find((task: { id: string }) => task.id === 'data-model-user-feature-add').assertionSummary.total).toBe(14)
  }, 60000)

  it('reports execution details in the suite report without any raw capsule/audit/graph content', () => {
    const outDir = join(tmpDir(), 'out')
    const result = runRegressionCli(['--config', 'benchmarks/retrieval/v1.7/core.json', '--out', outDir])
    expect(result.status).toBe(0)

    const jsonReport = readFileSync(join(outDir, 'retrieval-regression-report.json'), 'utf8')
    const txtReport = readFileSync(join(outDir, 'retrieval-regression-report.txt'), 'utf8')

    // The report may legitimately name capsule sections as assertion "kind"
    // labels (e.g. "kind": "selectedGraph"), but must never embed the raw
    // nested evidence structures themselves (ranked candidate arrays, full
    // query-term breakdowns, or reason lists from the capsule/audit).
    expect(jsonReport).not.toContain('"matchedTerms"')
    expect(jsonReport).not.toContain('"quotedPhrases"')
    expect(jsonReport).not.toContain('"symbolLike"')
    expect(jsonReport).not.toContain('"baseScore"')
    expect(txtReport).not.toContain('"content":')

    const report = JSON.parse(jsonReport)
    expect(report.tasks[0].fixtureRoot).toBeTruthy()
    expect(report.tasks[0].indexDir).toBeTruthy()
    expect(txtReport).toContain('artifact.capsulePath')
  }, 60000)

  it('returns a nonzero exit code and writes no report for an invalid config', () => {
    const dir = tmpDir()
    const configPath = join(dir, 'invalid-config.json')
    writeFileSync(configPath, JSON.stringify({ schemaVersion: '1.0.0', tasks: [] }), 'utf8')
    const outDir = join(dir, 'out')

    const result = runRegressionCli(['--config', configPath, '--out', outDir])

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('suiteId is required')
    expect(existsSync(join(outDir, 'retrieval-regression-report.json'))).toBe(false)
  })

  it('exposes benchmark:retrieval as an npm script', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    expect(typeof pkg.scripts['benchmark:retrieval']).toBe('string')
    expect(pkg.scripts['benchmark:retrieval'].length).toBeGreaterThan(0)
  })

  it('reports assertion results and metrics for the executable core task', () => {
    const outDir = join(tmpDir(), 'out')
    const result = runRegressionCli(['--config', 'benchmarks/retrieval/v1.7/core.json', '--out', outDir])
    expect(result.status).toBe(0)

    const report = JSON.parse(readFileSync(join(outDir, 'retrieval-regression-report.json'), 'utf8'))
    expect(report.assertionSummary.total).toBeGreaterThan(0)
    expect(report.assertionSummary.failed).toBe(0)
    expect(report.tasks[0].assertionResults.length).toBeGreaterThan(0)
    expect(report.metrics.candidateFileCount).toBeGreaterThan(0)

    const txtReport = readFileSync(join(outDir, 'retrieval-regression-report.txt'), 'utf8')
    expect(txtReport).toContain('Assertions:')
    expect(txtReport).toContain('Metrics:')
  }, 60000)

  function writeFailingConfig(dir: string): string {
    const configPath = join(dir, 'regression-config.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        schemaVersion: '1.0.0',
        suiteId: 'controlled-regression-suite',
        target: 'my-dev-kit',
        tasks: [
          {
            id: 'controlled-regression-task',
            title: 'Controlled regression task',
            fixtureRoot: join(process.cwd(), 'examples', 'basic-data-model-ts'),
            sourceRoots: ['src'],
            query: 'add a sibling data model field to User',
            mode: 'feature-add',
            expectations: {
              candidateFiles: [{ path: 'src/this-file-does-not-exist.ts', required: true }],
            },
          },
        ],
      }),
      'utf8'
    )
    return configPath
  }

  it('produces REGRESSION when a required assertion fails', () => {
    const dir = tmpDir()
    const configPath = writeFailingConfig(dir)
    const outDir = join(dir, 'out')

    const result = runRegressionCli(['--config', configPath, '--out', outDir])
    expect(result.stdout).toContain('verdict REGRESSION')

    const report = JSON.parse(readFileSync(join(outDir, 'retrieval-regression-report.json'), 'utf8'))
    expect(report.verdict).toBe('REGRESSION')
    expect(report.tasks[0].verdict).toBe('REGRESSION')
    expect(report.assertionSummary.requiredFailed).toBeGreaterThan(0)

    const txtReport = readFileSync(join(outDir, 'retrieval-regression-report.txt'), 'utf8')
    expect(txtReport).toContain('failed assertions:')
  }, 30000)

  it('exits nonzero on REGRESSION when --fail-on-regression is set', () => {
    const dir = tmpDir()
    const configPath = writeFailingConfig(dir)
    const outDir = join(dir, 'out')

    const result = runRegressionCli(['--config', configPath, '--out', outDir, '--fail-on-regression'])
    expect(result.status).not.toBe(0)
  }, 30000)

  it('exits 0 on REGRESSION when --fail-on-regression is not set', () => {
    const dir = tmpDir()
    const configPath = writeFailingConfig(dir)
    const outDir = join(dir, 'out')

    const result = runRegressionCli(['--config', configPath, '--out', outDir])
    expect(result.status).toBe(0)
  }, 30000)

  it('rejects an invalid --max-failures value with a clear error', () => {
    const outDir = join(tmpDir(), 'out')
    const result = runRegressionCli(['--config', 'benchmarks/retrieval/v1.7/core.json', '--out', outDir, '--max-failures', 'not-a-number'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('--max-failures')
  })

  it('stops running remaining tasks once --max-failures is reached', () => {
    const dir = tmpDir()
    const configPath = join(dir, 'multi-task-config.json')
    const fixtureRoot = join(process.cwd(), 'examples', 'basic-data-model-ts')
    writeFileSync(
      configPath,
      JSON.stringify({
        schemaVersion: '1.0.0',
        suiteId: 'max-failures-suite',
        target: 'my-dev-kit',
        tasks: [
          {
            id: 'failing-task-one',
            title: 'Failing task one',
            fixtureRoot,
            sourceRoots: ['src'],
            query: 'add a sibling data model field to User',
            mode: 'feature-add',
            expectations: { candidateFiles: [{ path: 'src/does-not-exist.ts', required: true }] },
          },
          {
            id: 'not-run-task',
            title: 'Not run task',
            fixtureRoot,
            sourceRoots: ['src'],
            query: 'add a sibling data model field to User',
            mode: 'feature-add',
          },
        ],
      }),
      'utf8'
    )
    const outDir = join(dir, 'out')

    const result = runRegressionCli(['--config', configPath, '--out', outDir, '--max-failures', '1'])
    const report = JSON.parse(readFileSync(join(outDir, 'retrieval-regression-report.json'), 'utf8'))

    expect(report.options.maxFailuresReached).toBe(true)
    const notRunTask = report.tasks.find((t: { id: string }) => t.id === 'not-run-task')
    expect(notRunTask.status).toBe('planned')
    expect(notRunTask.errors[0]).toContain('max-failures')

    const txtReport = readFileSync(join(outDir, 'retrieval-regression-report.txt'), 'utf8')
    expect(txtReport).toContain('Not-run tasks (max-failures reached):')
  }, 30000)
})
