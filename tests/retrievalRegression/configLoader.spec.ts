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

describe('execution and commandResult validation', () => {
  function configWith(task: Record<string, unknown>): string {
    return writeConfig(
      JSON.stringify({
        schemaVersion: '1.0.0',
        suiteId: 'exec-suite',
        tasks: [{ id: 'exec-task', title: 'Exec', fixtureRoot: '.', query: 'q', ...task }],
      })
    )
  }

  it('accepts search and source execution tasks and treats omitted execution as context', () => {
    expect(() =>
      loadRetrievalRegressionConfig(
        configWith({ execution: { kind: 'search', intent: 'ownership', limit: 10 }, expectations: { commandResult: { requiredResultIds: ['file:a.ts'], topK: 3 } } })
      )
    ).not.toThrow()
    const sourceOnly = writeConfig(
      JSON.stringify({
        schemaVersion: '1.0.0',
        suiteId: 'exec-suite',
        tasks: [
          {
            id: 'src-task',
            title: 'Src',
            fixtureRoot: '.',
            execution: { kind: 'source', file: 'src/a.ts', symbol: 'a', maxLines: 8, continueFrom: 17 },
            expectations: { commandResult: { expectedStartLine: 17, continuation: 'absent' } },
          },
        ],
      })
    )
    expect(() => loadRetrievalRegressionConfig(sourceOnly)).not.toThrow()
    expect(() => loadRetrievalRegressionConfig(configWith({ expectations: { candidateFiles: [{ pathContains: 'a' }] } }))).not.toThrow()
  })

  it.each([
    ['unknown kind', { execution: { kind: 'lookup' } }, /execution.kind must be one of/],
    ['bad intent', { execution: { kind: 'search', intent: 'fuzzy' } }, /intent must be one of/],
    ['limit out of range', { execution: { kind: 'search', limit: 101 } }, /limit must be an integer from 1 through 100/],
    ['source without selector', { execution: { kind: 'source' } }, /exactly one selector/],
    ['source file without symbol', { execution: { kind: 'source', file: 'a.ts' } }, /exactly one selector/],
    ['source node and file', { execution: { kind: 'source', node: 'n', file: 'a.ts', symbol: 's' } }, /exactly one selector/],
    ['continueFrom with node', { execution: { kind: 'source', node: 'n', continueFrom: 3 } }, /only valid with file plus symbol/],
    ['continue plus continueFrom', { execution: { kind: 'source', file: 'a.ts', symbol: 's', continue: true, continueFrom: 3 } }, /mutually exclusive/],
    ['non-positive maxLines', { execution: { kind: 'source', node: 'n', maxLines: 0 } }, /maxLines must be a positive integer/],
    ['mode on search task', { mode: 'general', execution: { kind: 'search' } }, /mode is only valid for context execution/],
    ['context expectation on source task', { execution: { kind: 'source', node: 'n' }, expectations: { adequacy: {} } }, /adequacy is only valid for context execution/],
    ['commandResult on context task', { expectations: { commandResult: { requiredResultIds: ['a'] } } }, /only valid for search or source execution/],
    ['source field on search task', { execution: { kind: 'search' }, expectations: { commandResult: { expectedStartLine: 1 } } }, /expectedStartLine is not valid for search execution/],
    ['search field on source task', { execution: { kind: 'source', node: 'n' }, expectations: { commandResult: { requiredResultIds: ['a'] } } }, /requiredResultIds is not valid for source execution/],
    ['bad continuation', { execution: { kind: 'source', node: 'n' }, expectations: { commandResult: { continuation: 'maybe' } } }, /continuation must be "present" or "absent"/],
    ['bad reason', { execution: { kind: 'source', node: 'n' }, expectations: { commandResult: { continuationReason: 'because' } } }, /continuationReason must be one of/],
    ['topK without ids', { execution: { kind: 'search' }, expectations: { commandResult: { topK: 3 } } }, /topK requires requiredResultIds/],
  ])('rejects %s', (_label, task, pattern) => {
    expect(() => loadRetrievalRegressionConfig(configWith(task))).toThrow(pattern)
  })

  it('does not require a query for source execution tasks', () => {
    const configPath = writeConfig(
      JSON.stringify({
        schemaVersion: '1.0.0',
        suiteId: 'exec-suite',
        tasks: [{ id: 'no-query', title: 'No query', execution: { kind: 'source', node: 'n' } }],
      })
    )
    expect(() => loadRetrievalRegressionConfig(configPath)).not.toThrow()
  })
})
