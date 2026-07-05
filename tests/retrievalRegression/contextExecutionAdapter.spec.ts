import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildContextArgs, runContextForTask } from '../../src/retrievalRegression/contextExecutionAdapter.js'
import { resolveFixture } from '../../src/retrievalRegression/fixtureResolver.js'
import { prepareTaskIndex } from '../../src/retrievalRegression/indexPreparation.js'
import type { RetrievalRegressionSuiteConfig, RetrievalRegressionTask } from '../../src/retrievalRegression/types.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-context-adapter-'))
  tempDirs.push(dir)
  return dir
}

const sampleConfig: RetrievalRegressionSuiteConfig = {
  schemaVersion: '1.0.0',
  suiteId: 'sample-suite',
  defaultMode: 'general',
  tasks: [],
}

function sampleTask(overrides: Partial<RetrievalRegressionTask> = {}): RetrievalRegressionTask {
  return { id: 'sample-task', title: 'Sample task', query: 'sample query', ...overrides }
}

describe('buildContextArgs', () => {
  it('builds a safe argument array with mode, caps, and no-source flags', () => {
    const args = buildContextArgs({
      indexDir: '/tmp/index',
      task: sampleTask({ mode: 'subsystem', noSource: true, caps: { maxCandidateFiles: 5, maxGraphNodes: 10 } }),
      config: sampleConfig,
      capsulePath: '/tmp/out/context-capsule.json',
      auditPath: '/tmp/out/retrieval-audit-record.json',
    })

    expect(Array.isArray(args)).toBe(true)
    expect(args).toContain('--mode')
    expect(args[args.indexOf('--mode') + 1]).toBe('subsystem')
    expect(args).toContain('--max-candidate-files')
    expect(args[args.indexOf('--max-candidate-files') + 1]).toBe('5')
    expect(args).toContain('--max-graph-nodes')
    expect(args).toContain('--no-source')
    expect(args).toContain('--json')
  })

  it('falls back to config.defaultMode when the task has no mode', () => {
    const args = buildContextArgs({
      indexDir: '/tmp/index',
      task: sampleTask(),
      config: { ...sampleConfig, defaultMode: 'feature-add' },
      capsulePath: '/tmp/out/context-capsule.json',
      auditPath: '/tmp/out/retrieval-audit-record.json',
    })
    expect(args[args.indexOf('--mode') + 1]).toBe('feature-add')
  })

  it('does not include --no-source when noSource is false', () => {
    const args = buildContextArgs({
      indexDir: '/tmp/index',
      task: sampleTask({ noSource: false }),
      config: sampleConfig,
      capsulePath: '/tmp/out/context-capsule.json',
      auditPath: '/tmp/out/retrieval-audit-record.json',
    })
    expect(args).not.toContain('--no-source')
  })
})

describe('runContextForTask (real subprocess against a real small index)', () => {
  it('writes capsule and audit paths and separates stdout from stderr', async () => {
    const root = tmpRoot()
    const fixtureDir = join(root, 'fixture')
    const outputDir = join(root, 'out')
    const configPath = join(root, 'core.json')

    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(fixtureDir, 'src'), { recursive: true })
    writeFileSync(join(fixtureDir, 'src', 'a.ts'), 'export function add(a: number, b: number): number {\n  return a + b\n}\n', 'utf8')
    writeFileSync(configPath, '{}', 'utf8')

    const fixture = resolveFixture({ configPath, outputDir, task: sampleTask({ fixtureRoot: fixtureDir }) })
    const indexResult = await prepareTaskIndex(fixture)

    const result = runContextForTask({
      repoRoot: process.cwd(),
      indexDir: indexResult.indexDir,
      task: sampleTask({ query: 'add two numbers' }),
      config: sampleConfig,
      taskOutputDir: fixture.taskOutputDir,
    })

    expect(result.status).toBe('executed')
    expect(result.capsulePath).toBeTruthy()
    expect(result.auditPath).toBeTruthy()
    expect(existsSync(result.capsulePath!)).toBe(true)
    expect(existsSync(result.auditPath!)).toBe(true)
    expect(existsSync(result.stdoutPath)).toBe(true)

    const stdoutContent = readFileSync(result.stdoutPath, 'utf8')
    expect(() => JSON.parse(stdoutContent)).not.toThrow()

    const capsule = JSON.parse(readFileSync(result.capsulePath!, 'utf8'))
    expect(capsule.schemaVersion).toBe('1.0.0')
  }, 30000)

  it('converts a nonzero context exit code into a blocked result', () => {
    const root = tmpRoot()
    const outputDir = join(root, 'out')
    const taskOutputDir = join(outputDir, 'tasks', 'broken-task')

    const result = runContextForTask({
      repoRoot: process.cwd(),
      indexDir: join(root, 'does-not-exist-index'),
      task: sampleTask({ id: 'broken-task', query: 'anything' }),
      config: sampleConfig,
      taskOutputDir,
    })

    expect(result.status).toBe('blocked')
    expect(result.exitCode).not.toBe(0)
    expect(result.capsulePath).toBeNull()
    expect(result.auditPath).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
  }, 30000)

  it('does not inline raw capsule/audit content into the returned result', async () => {
    const root = tmpRoot()
    const fixtureDir = join(root, 'fixture')
    const outputDir = join(root, 'out')
    const configPath = join(root, 'core.json')

    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(fixtureDir, 'src'), { recursive: true })
    writeFileSync(join(fixtureDir, 'src', 'a.ts'), 'export function add(a: number, b: number): number {\n  return a + b\n}\n', 'utf8')
    writeFileSync(configPath, '{}', 'utf8')

    const fixture = resolveFixture({ configPath, outputDir, task: sampleTask({ fixtureRoot: fixtureDir }) })
    const indexResult = await prepareTaskIndex(fixture)

    const result = runContextForTask({
      repoRoot: process.cwd(),
      indexDir: indexResult.indexDir,
      task: sampleTask({ query: 'add two numbers' }),
      config: sampleConfig,
      taskOutputDir: fixture.taskOutputDir,
    })

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('"schemaVersion"')
    expect(serialized.length).toBeLessThan(5000)
  }, 30000)
})
