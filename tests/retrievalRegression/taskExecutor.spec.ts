import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { executeTask } from '../../src/retrievalRegression/taskExecutor.js'
import type { RetrievalRegressionSuiteConfig, RetrievalRegressionTask } from '../../src/retrievalRegression/types.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-task-executor-'))
  tempDirs.push(dir)
  return dir
}

function makeTinyFixture(root: string): string {
  const fixtureDir = join(root, 'fixture')
  mkdirSync(join(fixtureDir, 'src'), { recursive: true })
  writeFileSync(join(fixtureDir, 'src', 'a.ts'), 'export function add(a: number, b: number): number {\n  return a + b\n}\n', 'utf8')
  return fixtureDir
}

const sampleConfig: RetrievalRegressionSuiteConfig = {
  schemaVersion: '1.0.0',
  suiteId: 'sample-suite',
  defaultMode: 'general',
  tasks: [],
}

describe('executeTask', () => {
  it('performs no fixture/index/context work for a skipped task', async () => {
    const root = tmpRoot()
    const configPath = join(root, 'core.json')
    writeFileSync(configPath, '{}', 'utf8')
    const outputDir = join(root, 'out')

    const task: RetrievalRegressionTask = { id: 'skipped-task', title: 'Skipped', skip: true, skipReason: 'not ready' }
    const result = await executeTask({ repoRoot: process.cwd(), configPath, outputDir, task, config: sampleConfig })

    expect(result.status).toBe('skipped')
    expect(result.skipReason).toBe('not ready')
    expect(existsSync(join(outputDir, 'tasks', 'skipped-task'))).toBe(false)
  })

  it('runs an executable task end to end against a real fixture', async () => {
    const root = tmpRoot()
    const fixtureDir = makeTinyFixture(root)
    const configPath = join(root, 'core.json')
    writeFileSync(configPath, '{}', 'utf8')
    const outputDir = join(root, 'out')

    const task: RetrievalRegressionTask = {
      id: 'executable-task',
      title: 'Executable task',
      fixtureRoot: fixtureDir,
      sourceRoots: ['src'],
      query: 'add two numbers',
      mode: 'general',
      skip: false,
    }
    const result = await executeTask({ repoRoot: process.cwd(), configPath, outputDir, task, config: sampleConfig })

    expect(result.status).toBe('executed')
    expect(result.verdict).toBe('PASS')
    expect(result.artifactPaths?.capsulePath).toBeTruthy()
    expect(result.artifactPaths?.auditPath).toBeTruthy()
    expect(existsSync(result.artifactPaths!.capsulePath!)).toBe(true)
    expect(existsSync(result.artifactPaths!.auditPath!)).toBe(true)
    expect(existsSync(result.artifactPaths!.taskExecutionPath!)).toBe(true)
  }, 30000)

  it('writes a well-formed task-execution.json with no raw capsule/audit content', async () => {
    const root = tmpRoot()
    const fixtureDir = makeTinyFixture(root)
    const configPath = join(root, 'core.json')
    writeFileSync(configPath, '{}', 'utf8')
    const outputDir = join(root, 'out')

    const task: RetrievalRegressionTask = {
      id: 'executable-task-2',
      title: 'Executable task 2',
      fixtureRoot: fixtureDir,
      sourceRoots: ['src'],
      query: 'add two numbers',
      skip: false,
    }
    const result = await executeTask({ repoRoot: process.cwd(), configPath, outputDir, task, config: sampleConfig })

    const taskExecutionRaw = readFileSync(result.artifactPaths!.taskExecutionPath!, 'utf8')
    const taskExecution = JSON.parse(taskExecutionRaw)
    expect(taskExecution.taskId).toBe('executable-task-2')
    expect(taskExecution.indexDir).toBeTruthy()
    expect(taskExecution.contextExecution.status).toBe('executed')
    expect(taskExecutionRaw).not.toContain('"schemaVersion"')
  }, 30000)
})

describe('executeTask search/source execution', () => {
  function fixtureWithLongSymbol(root: string): string {
    const fixtureDir = join(root, 'fixture')
    mkdirSync(join(fixtureDir, 'src'), { recursive: true })
    const lines = ['export function longOne(): number {']
    for (let i = 2; i <= 11; i++) lines.push(`  const v${i} = ${i}`)
    lines.push('  return v2', '}', 'export const after = 1')
    writeFileSync(join(fixtureDir, 'src', 'long.ts'), lines.join('\n') + '\n', 'utf8')
    return fixtureDir
  }

  async function run(task: RetrievalRegressionTask) {
    const root = tmpRoot()
    const fixtureDir = fixtureWithLongSymbol(root)
    const configPath = join(root, 'core.json')
    writeFileSync(configPath, '{}', 'utf8')
    const outputDir = join(root, 'out')
    const result = await executeTask({
      repoRoot: process.cwd(),
      configPath,
      outputDir,
      task: { ...task, fixtureRoot: fixtureDir, sourceRoots: ['src'] },
      config: sampleConfig,
    })
    return result
  }

  it('executes a search task and asserts on the machine-readable result', async () => {
    const result = await run({
      id: 'search-task',
      title: 'Search',
      query: 'longOne',
      execution: { kind: 'search', intent: 'relevance', limit: 5 },
      expectations: { commandResult: { requiredResultIds: ['symbol:src/long.ts#longOne'], topK: 3 } },
    })
    expect(result.status).toBe('executed')
    expect(result.verdict).toBe('PASS')
    expect(result.assertionResults?.[0].kind).toBe('commandResult')
    expect(result.artifactPaths?.capsulePath).toBeUndefined()
    const record = JSON.parse(readFileSync(result.artifactPaths!.taskExecutionPath!, 'utf8'))
    expect(record.commandExecution).toMatchObject({ kind: 'search', status: 'executed', exitCode: 0 })
    expect(record.contextExecution).toBeUndefined()
  }, 60000)

  it('executes a source task through the known-boundary contract', async () => {
    const result = await run({
      id: 'source-task',
      title: 'Source',
      execution: { kind: 'source', file: 'src/long.ts', symbol: 'longOne', maxLines: 5 },
      expectations: {
        commandResult: { expectedStartLine: 1, expectedEndLine: 5, continuation: 'present', symbolBoundaryKnown: true, nextStartLine: 6 },
      },
    })
    expect(result.verdict).toBe('PASS')
  }, 60000)

  it('marks a failed expectation REGRESSION', async () => {
    const result = await run({
      id: 'source-regress',
      title: 'Source regress',
      execution: { kind: 'source', file: 'src/long.ts', symbol: 'longOne', maxLines: 5 },
      expectations: { commandResult: { expectedEndLine: 99 } },
    })
    expect(result.status).toBe('executed')
    expect(result.verdict).toBe('REGRESSION')
  }, 60000)

  it('treats a nonzero command exit as BLOCKED execution evidence', async () => {
    const result = await run({
      id: 'source-blocked',
      title: 'Source blocked',
      execution: { kind: 'source', file: 'src/long.ts', symbol: 'doesNotExist' },
      expectations: { commandResult: { continuation: 'absent' } },
    })
    expect(result.status).toBe('blocked')
    expect(result.verdict).toBe('BLOCKED')
    expect(result.errors[0]).toContain('exited with code')
  }, 60000)
})
