import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadRetrievalRegressionConfig } from '../../src/retrievalRegression/configLoader.js'

const configPath = resolve('benchmarks/retrieval/v1.7/core.json')
const config = loadRetrievalRegressionConfig(configPath)
const executableTasks = config.tasks.filter((task) => !task.skip)

describe('v1.7 representative retrieval regression suite', () => {
  it('defines a compact representative suite with unique safe task IDs', () => {
    expect(executableTasks.length).toBeGreaterThanOrEqual(4)
    expect(executableTasks.length).toBeLessThanOrEqual(10)
    expect(new Set(config.tasks.map((task) => task.id)).size).toBe(config.tasks.length)
    expect(config.tasks.every((task) => /^[a-zA-Z0-9_-]+$/.test(task.id))).toBe(true)
  })

  it('gives every executable task required metadata and safety expectations', () => {
    for (const task of executableTasks) {
      expect(task.title).toBeTruthy()
      expect(task.description).toBeTruthy()
      expect(task.fixtureRoot).toBeTruthy()
      expect(task.sourceRoots?.length).toBeGreaterThan(0)
      expect(task.query).toBeTruthy()
      expect(task.mode).toBeTruthy()
      expect(task.caps).toBeTruthy()
      expect(task.tags?.length).toBeGreaterThan(0)
      expect(task.expectations?.noRawContent?.enabled).toBe(true)
      expect(task.expectations?.auditSteps).toBeTruthy()
      expect(task.expectations?.caps).toBeTruthy()
      expect(task.expectations?.adequacy).toBeTruthy()
    }
  })

  it('resolves every fixture root and source root', () => {
    for (const task of executableTasks) {
      const fixtureRoot = resolve(dirname(configPath), task.fixtureRoot!)
      expect(existsSync(fixtureRoot), `${task.id} fixtureRoot`).toBe(true)
      for (const sourceRoot of task.sourceRoots ?? []) {
        expect(existsSync(resolve(fixtureRoot, sourceRoot)), `${task.id} sourceRoot ${sourceRoot}`).toBe(true)
      }
    }
  })

  it('covers the required representative task categories', () => {
    const ids = executableTasks.map((task) => task.id)
    expect(ids).toContain('data-model-user-feature-add')
    expect(ids).toContain('data-model-user-subsystem')
    expect(ids).toContain('data-model-user-no-source')
    expect(ids).toContain('react-component-feature-add')
    expect(ids).toContain('no-false-conflict-clean-data-model')
    expect(ids).toContain('ambiguous-user-service-query')
  })

  it('keeps the maintainer script internal and explicit', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
    expect(pkg.scripts['benchmark:retrieval']).toContain('src/retrievalRegression/runRetrievalRegression.ts')
    expect(pkg.scripts['benchmark:retrieval']).toContain('benchmarks/retrieval/v1.7/core.json')
    expect(pkg.scripts['benchmark:retrieval']).toContain('--fail-on-regression')
    expect(pkg.scripts.verify).not.toContain('benchmark:retrieval')
  })
})
