import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadRetrievalRegressionConfig } from '../../src/retrievalRegression/configLoader.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function writeConfig(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-retrieval-regression-config-'))
  tempDirs.push(dir)
  const configPath = join(dir, 'config.json')
  writeFileSync(configPath, content, 'utf8')
  return configPath
}

const minimalValidConfig = {
  schemaVersion: '1.0.0',
  suiteId: 'sample-suite',
  tasks: [
    {
      id: 'sample-task',
      title: 'Sample task',
      skip: true,
      skipReason: 'Not executed yet.',
    },
  ],
}

describe('loadRetrievalRegressionConfig', () => {
  it('loads a valid minimal config unchanged', () => {
    const configPath = writeConfig(JSON.stringify(minimalValidConfig))
    const loaded = loadRetrievalRegressionConfig(configPath)
    expect(loaded.suiteId).toBe('sample-suite')
    expect(loaded.tasks).toHaveLength(1)
  })

  it('loads a valid config with zero tasks', () => {
    const configPath = writeConfig(JSON.stringify({ schemaVersion: '1.0.0', suiteId: 'empty-suite', tasks: [] }))
    const loaded = loadRetrievalRegressionConfig(configPath)
    expect(loaded.tasks).toEqual([])
  })

  it('fails clearly when the config file does not exist', () => {
    const missingPath = join(tmpdir(), 'my-dev-kit-v1-retrieval-regression-missing', 'nope.json')
    expect(() => loadRetrievalRegressionConfig(missingPath)).toThrow(/not found/)
  })

  it('fails clearly on malformed JSON', () => {
    const configPath = writeConfig('{ this is not valid json')
    expect(() => loadRetrievalRegressionConfig(configPath)).toThrow(/Invalid JSON/)
  })

  it('fails when suiteId is missing', () => {
    const configPath = writeConfig(JSON.stringify({ schemaVersion: '1.0.0', tasks: [] }))
    expect(() => loadRetrievalRegressionConfig(configPath)).toThrow(/suiteId is required/)
  })

  it('fails when tasks is not an array', () => {
    const configPath = writeConfig(JSON.stringify({ schemaVersion: '1.0.0', suiteId: 'x', tasks: {} }))
    expect(() => loadRetrievalRegressionConfig(configPath)).toThrow(/tasks must be an array/)
  })

  it('fails on duplicate task IDs', () => {
    const configPath = writeConfig(
      JSON.stringify({
        schemaVersion: '1.0.0',
        suiteId: 'x',
        tasks: [
          { id: 'a', title: 'A', skip: true, skipReason: 'x' },
          { id: 'a', title: 'A again', skip: true, skipReason: 'x' },
        ],
      })
    )
    expect(() => loadRetrievalRegressionConfig(configPath)).toThrow(/Duplicate task id/)
  })

  it('fails on unsafe task IDs', () => {
    const configPath = writeConfig(
      JSON.stringify({
        schemaVersion: '1.0.0',
        suiteId: 'x',
        tasks: [{ id: 'a/b', title: 'A', skip: true, skipReason: 'x' }],
      })
    )
    expect(() => loadRetrievalRegressionConfig(configPath)).toThrow(/safe for file paths/)
  })

  it('fails on invalid mode', () => {
    const configPath = writeConfig(
      JSON.stringify({
        schemaVersion: '1.0.0',
        suiteId: 'x',
        tasks: [{ id: 'a', title: 'A', query: 'q', mode: 'bogus' }],
      })
    )
    expect(() => loadRetrievalRegressionConfig(configPath)).toThrow(/mode "bogus" is invalid/)
  })

  it('fails on non-positive-integer caps', () => {
    const configPath = writeConfig(
      JSON.stringify({
        schemaVersion: '1.0.0',
        suiteId: 'x',
        tasks: [{ id: 'a', title: 'A', query: 'q', caps: { maxCandidateFiles: 0 } }],
      })
    )
    expect(() => loadRetrievalRegressionConfig(configPath)).toThrow(/positive integer/)
  })

  it('fails on non-integer caps', () => {
    const configPath = writeConfig(
      JSON.stringify({
        schemaVersion: '1.0.0',
        suiteId: 'x',
        tasks: [{ id: 'a', title: 'A', query: 'q', caps: { maxGraphNodes: 1.5 } }],
      })
    )
    expect(() => loadRetrievalRegressionConfig(configPath)).toThrow(/positive integer/)
  })

  it('accepts a skipped task with skipReason and no query', () => {
    const configPath = writeConfig(
      JSON.stringify({
        schemaVersion: '1.0.0',
        suiteId: 'x',
        tasks: [{ id: 'a', title: 'A', skip: true, skipReason: 'planned for later' }],
      })
    )
    expect(() => loadRetrievalRegressionConfig(configPath)).not.toThrow()
  })

  it('fails when a non-skipped task has no query', () => {
    const configPath = writeConfig(
      JSON.stringify({
        schemaVersion: '1.0.0',
        suiteId: 'x',
        tasks: [{ id: 'a', title: 'A' }],
      })
    )
    expect(() => loadRetrievalRegressionConfig(configPath)).toThrow(/requires "query"/)
  })

  it('fails when a skipped task has no skipReason', () => {
    const configPath = writeConfig(
      JSON.stringify({
        schemaVersion: '1.0.0',
        suiteId: 'x',
        tasks: [{ id: 'a', title: 'A', skip: true }],
      })
    )
    expect(() => loadRetrievalRegressionConfig(configPath)).toThrow(/requires skipReason/)
  })
})
