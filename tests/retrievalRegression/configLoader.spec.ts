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
    ['unknown kind', { execution: { kind: 'bogus' } }, /execution.kind must be one of/],
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
    ['commandResult on context task', { expectations: { commandResult: { requiredResultIds: ['a'] } } }, /only valid for search, source, lookup or slice execution/],
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

describe('lookup and slice execution validation', () => {
  function configWith(task: Record<string, unknown>): string {
    return writeConfig(
      JSON.stringify({
        schemaVersion: '1.0.0',
        suiteId: 'lookup-slice-suite',
        tasks: [{ id: 'ls-task', title: 'Lookup/slice', fixtureRoot: '.', ...task }],
      })
    )
  }
  const lookup = (execution: Record<string, unknown>, nested: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    execution: { kind: 'lookup', ...execution },
    expectations: { commandResult: { lookup: nested, ...extra } },
  })
  const slice = (execution: Record<string, unknown>, nested: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    execution: { kind: 'slice', ...execution },
    expectations: { commandResult: { slice: nested, ...extra } },
  })

  it('accepts valid lookup and slice tasks without a query', () => {
    const valid = [
      lookup({ node: 'file:a.ts', depth: 0, resolveClassification: true }, { expectedStatus: 'found', expectedNodeId: 'file:a.ts', expectedNodeKind: 'file' }),
      lookup({ androidComponent: 'MainActivity' }, { expectedStatus: 'found', expectedNodeId: 'n' }),
      lookup({ androidComponent: 'MainActivity' }, { expectedStatus: 'ambiguous', requiredCandidateIds: ['a', 'b'], forbiddenCandidateIds: ['c'], expectedCandidateCount: 2 }),
      lookup({ androidComponent: 'Nope' }, { expectedStatus: 'not-found' }, { required: false }),
      slice({ node: 'n', depth: 3, direction: 'incoming' }, { requiredNodeIds: ['n'], maxNodes: 10, maxEdges: 10 }),
      slice({ androidRoute: 'home' }, { expectedStatus: 'ok', requiredEdges: [{ source: 'a', kind: 'k', target: 'b' }], forbiddenEdges: [{ source: 'b', kind: 'k', target: 'a' }] }),
      slice({ androidComponent: 'X', includeDataFlow: true, includeTests: true }, { expectedDataFlowTruncated: false, requireAndroidTests: true }),
      slice(
        { composable: 'Home', includeViewmodel: true, includeNavigation: true, direction: 'outgoing' },
        { connectedPaths: [{ nodeIds: ['a', 'b', 'c'], edgeKinds: ['x', 'y'] }], requiredNodeKinds: ['k'], requiredEdgeKinds: ['x'] }
      ),
      slice({ androidComponent: 'Dup' }, { expectedStatus: 'ambiguous', requiredCandidateIds: ['a'], expectedCandidateCount: 2 }),
      slice({ androidRoute: 'none' }, { expectedStatus: 'not-found' }),
    ]
    for (const task of valid) expect(() => loadRetrievalRegressionConfig(configWith(task))).not.toThrow()
  })

  it.each([
    ['lookup without selector', lookup({}, { expectedStatus: 'found' }), /exactly one selector: node, androidComponent/],
    ['lookup with two selectors', lookup({ node: 'n', androidComponent: 'a' }, { expectedStatus: 'found' }), /exactly one selector/],
    ['lookup empty selector', lookup({ node: '' }, { expectedStatus: 'found' }), /execution.node must be a non-empty string/],
    ['lookup depth too large', lookup({ node: 'n', depth: 4 }, { expectedNodeId: 'n' }), /depth must be an integer from 0 through 3/],
    ['lookup fractional depth', lookup({ node: 'n', depth: 1.5 }, { expectedNodeId: 'n' }), /depth must be an integer from 0 through 3/],
    ['lookup negative depth', lookup({ node: 'n', depth: -1 }, { expectedNodeId: 'n' }), /depth must be an integer from 0 through 3/],
    ['resolveClassification with androidComponent', lookup({ androidComponent: 'a', resolveClassification: true }, { expectedStatus: 'found' }), /resolveClassification is only valid with node/],
    ['lookup unknown execution key', lookup({ node: 'n', direction: 'both' }, { expectedNodeId: 'n' }), /direction is not valid for kind "lookup"/],
    ['lookup candidate fields on node lookup', lookup({ node: 'n' }, { requiredCandidateIds: ['a'] }), /requiredCandidateIds is only valid with androidComponent lookup/],
    ['node lookup not-found status', lookup({ node: 'n' }, { expectedStatus: 'not-found' }), /must be "found" for node lookup/],
    ['expectedNodeKind on android lookup', lookup({ androidComponent: 'a' }, { expectedNodeKind: 'k' }), /expectedNodeKind is only valid with node lookup/],
    ['expectedNodeId with ambiguous', lookup({ androidComponent: 'a' }, { expectedStatus: 'ambiguous', expectedNodeId: 'n' }), /expectedNodeId is only valid with expectedStatus "found"/],
    ['candidates without ambiguous status', lookup({ androidComponent: 'a' }, { requiredCandidateIds: ['a'] }), /requiredCandidateIds requires expectedStatus "ambiguous"/],
    ['lookup bad status', lookup({ androidComponent: 'a' }, { expectedStatus: 'ok' }), /expectedStatus must be one of: found, ambiguous, not-found/],
    ['lookup empty expectation', lookup({ node: 'n' }, {}), /commandResult.lookup must not be empty/],
    ['lookup unknown key', lookup({ node: 'n' }, { expectedNodeId: 'n', surprise: 1 }), /surprise is not valid for lookup expectations/],
    ['lookup wrong type', lookup({ node: 'n' }, { expectedNodeId: 5 }), /expectedNodeId must be a non-empty string/],
    ['lookup bad count type', lookup({ androidComponent: 'a' }, { expectedStatus: 'ambiguous', expectedCandidateCount: '2' }), /expectedCandidateCount must be a non-negative integer/],
    ['lookup empty candidate list', lookup({ androidComponent: 'a' }, { expectedStatus: 'ambiguous', requiredCandidateIds: [] }), /requiredCandidateIds must be a non-empty array/],
    ['lookup missing nested object', { execution: { kind: 'lookup', node: 'n' }, expectations: { commandResult: { required: true } } }, /commandResult.lookup is required for lookup execution/],
    ['slice nested object on lookup task', { execution: { kind: 'lookup', node: 'n' }, expectations: { commandResult: { lookup: { expectedNodeId: 'n' }, slice: { maxNodes: 1 } } } }, /slice is only valid for slice execution/],
    ['lookup nested object on slice task', { execution: { kind: 'slice', node: 'n' }, expectations: { commandResult: { slice: { maxNodes: 1 }, lookup: { expectedNodeId: 'n' } } } }, /lookup is only valid for lookup execution/],
    ['lookup nested object on search task', { query: 'q', execution: { kind: 'search' }, expectations: { commandResult: { lookup: { expectedNodeId: 'n' } } } }, /lookup is not valid for search execution/],
    ['slice nested object on source task', { execution: { kind: 'source', node: 'n' }, expectations: { commandResult: { slice: { maxNodes: 1 } } } }, /slice is not valid for source execution/],
    ['lookup nested object on context task', { query: 'q', expectations: { commandResult: { lookup: { expectedNodeId: 'n' } } } }, /only valid for search, source, lookup or slice execution/],
    ['search field on lookup task', { execution: { kind: 'lookup', node: 'n' }, expectations: { commandResult: { requiredResultIds: ['a'], lookup: { expectedNodeId: 'n' } } } }, /requiredResultIds is not valid for lookup execution/],
    ['slice without selector', slice({}, { maxNodes: 5 }), /exactly one selector: node, androidRoute, androidComponent, composable/],
    ['slice with two selectors', slice({ node: 'n', composable: 'c' }, { maxNodes: 5 }), /exactly one selector/],
    ['slice depth too large', slice({ node: 'n', depth: 4 }, { maxNodes: 5 }), /depth must be an integer from 0 through 3/],
    ['slice bad direction', slice({ node: 'n', direction: 'sideways' }, { maxNodes: 5 }), /direction must be one of: both, incoming, outgoing/],
    ['includeViewmodel without composable', slice({ node: 'n', includeViewmodel: true }, { maxNodes: 5 }), /includeViewmodel is only valid with composable/],
    ['includeNavigation with route', slice({ androidRoute: 'r', includeNavigation: true }, { maxNodes: 5 }), /includeNavigation is only valid with composable/],
    ['non-boolean include flag', slice({ node: 'n', includeTests: 'yes' }, { maxNodes: 5 }), /includeTests must be a boolean/],
    ['slice unknown execution key', slice({ node: 'n', route: '/x' }, { maxNodes: 5 }), /route is not valid for kind "slice"/],
    ['slice empty expectation', slice({ node: 'n' }, {}), /commandResult.slice must not be empty/],
    ['slice unknown key', slice({ node: 'n' }, { maxNodes: 5, extra: true }), /extra is not valid for slice expectations/],
    ['slice bad maxNodes', slice({ node: 'n' }, { maxNodes: 0 }), /maxNodes must be a positive integer/],
    ['slice bad status', slice({ androidRoute: 'r' }, { expectedStatus: 'found' }), /expectedStatus must be one of: ok, ambiguous, not-found/],
    ['node slice ambiguous', slice({ node: 'n' }, { expectedStatus: 'ambiguous' }), /not possible with a node slice/],
    ['graph evidence with ambiguous', slice({ androidRoute: 'r' }, { expectedStatus: 'ambiguous', requiredNodeIds: ['a'] }), /requiredNodeIds requires graph evidence/],
    ['candidates without ambiguous', slice({ androidRoute: 'r' }, { requiredCandidateIds: ['a'] }), /requiredCandidateIds requires expectedStatus "ambiguous"/],
    ['dataFlow expectation without request', slice({ node: 'n' }, { expectedDataFlowTruncated: false }), /requires execution.includeDataFlow true/],
    ['tests expectation without request', slice({ node: 'n' }, { requireAndroidTests: true }), /requires execution.includeTests true/],
    ['requireAndroidTests false', slice({ node: 'n', includeTests: true }, { requireAndroidTests: false }), /requireAndroidTests must be true when present/],
    ['edge with extra key', slice({ node: 'n' }, { requiredEdges: [{ source: 'a', kind: 'k', target: 'b', id: 'x' }] }), /requiredEdges\[0\].id is not valid/],
    ['edge missing target', slice({ node: 'n' }, { forbiddenEdges: [{ source: 'a', kind: 'k' }] }), /forbiddenEdges\[0\].target must be a non-empty string/],
    ['empty edge list', slice({ node: 'n' }, { requiredEdges: [] }), /requiredEdges must be a non-empty array/],
    ['path with one node', slice({ node: 'n' }, { connectedPaths: [{ nodeIds: ['a'], edgeKinds: [] }] }), /nodeIds must be an array of at least two/],
    ['path edge count mismatch', slice({ node: 'n' }, { connectedPaths: [{ nodeIds: ['a', 'b', 'c'], edgeKinds: ['x'] }] }), /edgeKinds length must equal nodeIds length minus one/],
    ['path unknown key', slice({ node: 'n' }, { connectedPaths: [{ nodeIds: ['a', 'b'], edgeKinds: ['x'], loose: true }] }), /loose is not valid/],
    ['path not array', slice({ node: 'n' }, { connectedPaths: 'a>b' }), /connectedPaths must be a non-empty array/],
    ['slice nested object not an object', { execution: { kind: 'slice', node: 'n' }, expectations: { commandResult: { slice: [] } } }, /commandResult.slice must be an object/],
    ['context expectation on lookup task', { execution: { kind: 'lookup', node: 'n' }, expectations: { focus: {} } }, /focus is only valid for context execution/],
    ['mode on slice task', { mode: 'general', ...slice({ node: 'n' }, { maxNodes: 5 }) }, /mode is only valid for context execution/],
  ])('rejects %s', (_label, task, pattern) => {
    expect(() => loadRetrievalRegressionConfig(configWith(task as Record<string, unknown>))).toThrow(pattern)
  })

  it('reports every problem at load time, before any indexing could occur', () => {
    const configPath = configWith(slice({ node: 'n', composable: 'c', depth: 9 }, {}))
    expect(() => loadRetrievalRegressionConfig(configPath)).toThrow(/exactly one selector[\s\S]*depth must be[\s\S]*must not be empty/)
  })

  it('still requires a query for search execution tasks', () => {
    const noQuery = writeConfig(JSON.stringify({ schemaVersion: '1.0.0', suiteId: 's', tasks: [{ id: 't', title: 'T', execution: { kind: 'search' } }] }))
    expect(() => loadRetrievalRegressionConfig(noQuery)).toThrow(/requires "query"/)
  })
})
