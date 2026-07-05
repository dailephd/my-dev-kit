import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveFixture } from '../../src/retrievalRegression/fixtureResolver.js'
import type { RetrievalRegressionTask } from '../../src/retrievalRegression/types.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-fixture-resolver-'))
  tempDirs.push(dir)
  return dir
}

function makeFixture(root: string, extraDirs: string[] = ['src']): string {
  const fixtureDir = join(root, 'fixture')
  for (const dir of extraDirs) mkdirSync(join(fixtureDir, dir), { recursive: true })
  return fixtureDir
}

function makeConfigFile(root: string): string {
  const configPath = join(root, 'config', 'core.json')
  mkdirSync(join(root, 'config'), { recursive: true })
  writeFileSync(configPath, '{}', 'utf8')
  return configPath
}

function baseTask(overrides: Partial<RetrievalRegressionTask> = {}): RetrievalRegressionTask {
  return { id: 'sample-task', title: 'Sample task', ...overrides }
}

describe('resolveFixture', () => {
  it('resolves a relative fixtureRoot relative to the config file directory', () => {
    const root = tmpRoot()
    const fixtureDir = makeFixture(root)
    const configPath = makeConfigFile(root)

    const resolved = resolveFixture({
      configPath,
      outputDir: join(root, 'out'),
      task: baseTask({ fixtureRoot: '../fixture' }),
    })

    expect(resolved.fixtureRoot.toLowerCase()).toBe(fixtureDir.replace(/\\/g, '/').toLowerCase())
  })

  it('resolves an absolute fixtureRoot correctly', () => {
    const root = tmpRoot()
    const fixtureDir = makeFixture(root)
    const configPath = makeConfigFile(root)

    const resolved = resolveFixture({
      configPath,
      outputDir: join(root, 'out'),
      task: baseTask({ fixtureRoot: fixtureDir }),
    })

    expect(resolved.fixtureRoot.toLowerCase()).toBe(fixtureDir.replace(/\\/g, '/').toLowerCase())
  })

  it('fails clearly when fixtureRoot does not exist', () => {
    const root = tmpRoot()
    const configPath = makeConfigFile(root)

    expect(() =>
      resolveFixture({ configPath, outputDir: join(root, 'out'), task: baseTask({ fixtureRoot: '../does-not-exist' }) })
    ).toThrow(/Fixture root not found/)
  })

  it('fails clearly when fixtureRoot is a file, not a directory', () => {
    const root = tmpRoot()
    const configPath = makeConfigFile(root)
    const filePath = join(root, 'not-a-dir.txt')
    writeFileSync(filePath, 'x', 'utf8')

    expect(() =>
      resolveFixture({ configPath, outputDir: join(root, 'out'), task: baseTask({ fixtureRoot: filePath }) })
    ).toThrow(/is not a directory/)
  })

  it('resolves sourceRoots relative to fixtureRoot', () => {
    const root = tmpRoot()
    const fixtureDir = makeFixture(root, ['src', 'lib'])
    const configPath = makeConfigFile(root)

    const resolved = resolveFixture({
      configPath,
      outputDir: join(root, 'out'),
      task: baseTask({ fixtureRoot: fixtureDir, sourceRoots: ['lib'] }),
    })

    expect(resolved.sourceRoots[0].toLowerCase()).toBe(join(fixtureDir, 'lib').replace(/\\/g, '/').toLowerCase())
  })

  it('fails clearly when a configured source root is missing', () => {
    const root = tmpRoot()
    const fixtureDir = makeFixture(root)
    const configPath = makeConfigFile(root)

    expect(() =>
      resolveFixture({
        configPath,
        outputDir: join(root, 'out'),
        task: baseTask({ fixtureRoot: fixtureDir, sourceRoots: ['does-not-exist'] }),
      })
    ).toThrow(/Source root not found/)
  })

  it('defaults sourceRoots to ["src"] when the task omits them', () => {
    const root = tmpRoot()
    const fixtureDir = makeFixture(root)
    const configPath = makeConfigFile(root)

    const resolved = resolveFixture({ configPath, outputDir: join(root, 'out'), task: baseTask({ fixtureRoot: fixtureDir }) })

    expect(resolved.sourceRootNames).toEqual(['src'])
  })

  it('fails on an unsafe task id', () => {
    const root = tmpRoot()
    const fixtureDir = makeFixture(root)
    const configPath = makeConfigFile(root)

    expect(() =>
      resolveFixture({ configPath, outputDir: join(root, 'out'), task: baseTask({ id: 'a b', fixtureRoot: fixtureDir }) })
    ).toThrow(/Unsafe task id/)
  })

  it('fails on a path-traversal task id', () => {
    const root = tmpRoot()
    const fixtureDir = makeFixture(root)
    const configPath = makeConfigFile(root)

    expect(() =>
      resolveFixture({ configPath, outputDir: join(root, 'out'), task: baseTask({ id: '../evil', fixtureRoot: fixtureDir }) })
    ).toThrow()
  })

  it('produces a deterministic per-task output directory', () => {
    const root = tmpRoot()
    const fixtureDir = makeFixture(root)
    const configPath = makeConfigFile(root)
    const outputDir = join(root, 'out')

    const first = resolveFixture({ configPath, outputDir, task: baseTask({ fixtureRoot: fixtureDir }) })
    const second = resolveFixture({ configPath, outputDir, task: baseTask({ fixtureRoot: fixtureDir }) })

    expect(first.taskOutputDir).toBe(second.taskOutputDir)
    expect(first.taskOutputDir.toLowerCase()).toContain('/out/tasks/sample-task')
  })
})
