import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveFixture } from '../../src/retrievalRegression/fixtureResolver.js'
import { prepareTaskIndex } from '../../src/retrievalRegression/indexPreparation.js'
import type { RetrievalRegressionTask } from '../../src/retrievalRegression/types.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-index-prep-'))
  tempDirs.push(dir)
  return dir
}

function makeTinyFixture(root: string): string {
  const fixtureDir = join(root, 'fixture')
  mkdirSync(join(fixtureDir, 'src'), { recursive: true })
  writeFileSync(join(fixtureDir, 'src', 'a.ts'), 'export function add(a: number, b: number): number {\n  return a + b\n}\n', 'utf8')
  return fixtureDir
}

function baseTask(overrides: Partial<RetrievalRegressionTask> = {}): RetrievalRegressionTask {
  return { id: 'sample-task', title: 'Sample task', ...overrides }
}

describe('prepareTaskIndex', () => {
  it('writes the index under the per-task output directory, not the fixture', async () => {
    const root = tmpRoot()
    const fixtureDir = makeTinyFixture(root)
    const configPath = join(root, 'core.json')
    writeFileSync(configPath, '{}', 'utf8')
    const outputDir = join(root, 'out')

    const fixture = resolveFixture({ configPath, outputDir, task: baseTask({ fixtureRoot: fixtureDir }) })
    const result = await prepareTaskIndex(fixture)

    expect(result.indexDir.toLowerCase()).toContain('/out/tasks/sample-task/index')
    expect(existsSync(join(result.indexDir, 'manifest.json'))).toBe(true)
    expect(existsSync(join(fixtureDir, 'manifest.json'))).toBe(false)
  }, 30000)

  it('does not modify fixture source files', async () => {
    const root = tmpRoot()
    const fixtureDir = makeTinyFixture(root)
    const configPath = join(root, 'core.json')
    writeFileSync(configPath, '{}', 'utf8')
    const outputDir = join(root, 'out')
    const sourceFile = join(fixtureDir, 'src', 'a.ts')
    const before = statSync(sourceFile).mtimeMs

    const fixture = resolveFixture({ configPath, outputDir, task: baseTask({ fixtureRoot: fixtureDir }) })
    await prepareTaskIndex(fixture)

    const after = statSync(sourceFile).mtimeMs
    expect(after).toBe(before)
  }, 30000)

  it('blocks clearly when the default source root is missing', () => {
    const root = tmpRoot()
    const fixtureDir = join(root, 'fixture-no-src')
    mkdirSync(fixtureDir, { recursive: true })
    const configPath = join(root, 'core.json')
    writeFileSync(configPath, '{}', 'utf8')
    const outputDir = join(root, 'out')

    expect(() =>
      resolveFixture({ configPath, outputDir, task: baseTask({ fixtureRoot: fixtureDir }) })
    ).toThrow(/Source root not found/)
  })
})
