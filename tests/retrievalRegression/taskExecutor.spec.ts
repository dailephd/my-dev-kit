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
