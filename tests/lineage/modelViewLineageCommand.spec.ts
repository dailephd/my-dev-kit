import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import {
  assertTestProcessExitCode,
  reportTestProcessTiming,
  reportTestStageTiming,
  runTestProcess,
} from '../helpers/cliProcessDiagnostics.js'
import { runCli, tsxCliPath } from '../lookup/testCli.js'

const tempDirs: string[] = []
const FAILURE_CASES_TEST_NAME =
  'fails clearly for missing entities, missing fields, malformed field selectors, and conflicting trace flags'

afterEach(() => {
  const startedAt = new Date()
  const startTime = performance.now()
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
  const testName = expect.getState().currentTestName
  if (testName?.endsWith(FAILURE_CASES_TEST_NAME)) {
    reportTestStageTiming({
      testName,
      stage: 'cleanup',
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Math.round((performance.now() - startTime) * 100) / 100,
    })
  }
})

function makeTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'mdk-lineage-command-'))
  tempDirs.push(root)
  mkdirSync(join(root, 'src'), { recursive: true })
  return root
}

function write(root: string, relativePath: string, contents: string): void {
  const fullPath = join(root, relativePath)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, contents, 'utf8')
}

async function buildIndexFixture(root: string): Promise<string> {
  await runIndexCommand({
    root,
    src: ['src'],
    out: '.my-dev-kit-v1',
  })
  return join(root, '.my-dev-kit-v1')
}

function runDiagnosedFailure(
  stage: string,
  args: string[],
  fixturePath: string,
  indexPath: string
) {
  const result = runTestProcess({
    executable: process.execPath,
    args: [tsxCliPath(), 'src/cli.ts', ...args],
    cwd: process.cwd(),
    context: {
      testName: FAILURE_CASES_TEST_NAME,
      stage,
      fixturePath,
      outputPath: indexPath,
      indexPaths: [indexPath],
      expectedPaths: [join(indexPath, 'manifest.json'), join(indexPath, 'code-graph.json')],
    },
  })
  reportTestProcessTiming(result)
  assertTestProcessExitCode(result, 2)
  return result
}

describe('data-model trace-view command behavior', () => {
  it('returns compact entity trace JSON and writes model-view-lineage.json', async () => {
    const root = makeTempRepo()
    write(root, 'src/supported.tsx', readFixture('supported.tsx'))
    const indexDir = await buildIndexFixture(root)
    const outDir = join(root, 'trace-out')

    const result = runCli(['data-model', '--index', indexDir, '--out', outDir, '--trace-view', 'User', '--json'])
    expect(result.status).toBe(0)

    const parsed = JSON.parse(result.stdout)
    expect(parsed).toMatchObject({
      status: 'ok',
      mode: 'trace-entity',
      entity: { name: 'User' },
    })
    expect(parsed.lineageNodeCount).toBeGreaterThan(0)
    expect(parsed.lineageEdgeCount).toBeGreaterThan(0)
    expect(existsSync(join(outDir, 'model-view-lineage.json'))).toBe(true)
    expect(existsSync(join(outDir, 'code-graph.json'))).toBe(false)
  })

  it('returns compact field trace JSON for supported cases', async () => {
    const root = makeTempRepo()
    write(root, 'src/supported.tsx', readFixture('supported.tsx'))
    const indexDir = await buildIndexFixture(root)
    const outDir = join(root, 'trace-out')

    const result = runCli(['data-model', '--index', indexDir, '--out', outDir, '--field', 'User.email', '--trace-view', '--json'])
    expect(result.status).toBe(0)

    const parsed = JSON.parse(result.stdout)
    expect(parsed).toMatchObject({
      status: 'ok',
      mode: 'trace-field',
      entity: { name: 'User' },
      field: { name: 'email' },
    })
    expect(parsed.lineageNodeCount).toBeGreaterThan(0)
    expect(parsed.lineageEdgeCount).toBeGreaterThan(0)
  })

  it('returns warnings for unsupported lineage instead of guessed edges', async () => {
    const root = makeTempRepo()
    write(root, 'src/dynamic.tsx', readFixture('dynamic.tsx'))
    const indexDir = await buildIndexFixture(root)
    const outDir = join(root, 'trace-out')

    const result = runCli(['data-model', '--index', indexDir, '--out', outDir, '--trace-view', 'User', '--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.status).toBe(0)
    expect(parsed.warningCount).toBeGreaterThan(0)
    expect(parsed.warnings.some((warning: { kind: string }) => warning.kind === 'skipped-dynamic-pattern')).toBe(true)
  })

  // The canonical four-worker suite measured 21.557s versus 5.35s isolated
  // and about 5.55s in the two-file run. Keep measured contention headroom
  // local to this intentionally four-process integration case.
  it(FAILURE_CASES_TEST_NAME, async () => {
    const fixtureStartedAt = new Date()
    const fixtureStartTime = performance.now()
    const root = makeTempRepo()
    write(root, 'src/supported.tsx', readFixture('supported.tsx'))
    reportTestStageTiming({
      testName: FAILURE_CASES_TEST_NAME,
      stage: 'fixture creation',
      startedAt: fixtureStartedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Math.round((performance.now() - fixtureStartTime) * 100) / 100,
    })

    const indexStartedAt = new Date()
    const indexStartTime = performance.now()
    const indexDir = await buildIndexFixture(root)
    reportTestStageTiming({
      testName: FAILURE_CASES_TEST_NAME,
      stage: 'initial indexing',
      startedAt: indexStartedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Math.round((performance.now() - indexStartTime) * 100) / 100,
    })

    const missingEntity = runDiagnosedFailure(
      'missing entity',
      ['data-model', '--index', indexDir, '--trace-view', 'Missing', '--json'],
      root,
      indexDir
    )
    const missingField = runDiagnosedFailure(
      'missing field',
      ['data-model', '--index', indexDir, '--field', 'User.missing', '--trace-view', '--json'],
      root,
      indexDir
    )
    const malformedField = runDiagnosedFailure(
      'malformed field selector',
      ['data-model', '--index', indexDir, '--field', 'User', '--trace-view', '--json'],
      root,
      indexDir
    )
    const conflicting = runDiagnosedFailure(
      'conflicting trace flags',
      ['data-model', '--index', indexDir, '--entity', 'User', '--trace-view', 'User', '--json'],
      root,
      indexDir
    )

    expect(missingEntity.exitCode).toBe(2)
    expect(missingEntity.stderr).toContain('Entity not found: Missing')
    expect(missingField.exitCode).toBe(2)
    expect(missingField.stderr).toContain('Field not found: User.missing')
    expect(malformedField.exitCode).toBe(2)
    expect(malformedField.stderr).toContain('Field selector must use exact format Entity.field.')
    expect(conflicting.exitCode).toBe(2)
    expect(conflicting.stderr).toContain('cannot combine --entity with --trace-view')
  }, 30_000)

  it('does not require Graphviz and existing generation and lookup behavior still work', async () => {
    const root = makeTempRepo()
    write(root, 'src/supported.tsx', readFixture('supported.tsx'))
    const indexDir = await buildIndexFixture(root)

    const generate = runCli(['data-model', '--index', indexDir, '--json'])
    const entityLookup = runCli(['data-model', '--index', indexDir, '--entity', 'User', '--json'])
    const fieldLookup = runCli(['data-model', '--index', indexDir, '--field', 'User.email', '--json'])

    expect(generate.status).toBe(0)
    expect(entityLookup.status).toBe(0)
    expect(fieldLookup.status).toBe(0)
  })
})

function readFixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests', 'fixtures', 'lineage', 'model-view-basic', name), 'utf8')
}
