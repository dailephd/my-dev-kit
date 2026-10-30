import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCommandArgs, executeTask } from '../../src/retrievalRegression/taskExecutor.js'
import type { RetrievalRegressionSuiteConfig, RetrievalRegressionTask } from '../../src/retrievalRegression/types.js'
import { allocateV114OutputDir } from '../helpers/v114OutputRoot.js'

const tempDirs: string[] = []

describe('B14 actual role-aware context dispatch', () => {
  const method = 'symbolq:src%2Fimpls.rs#rust%3Aimpl%3Acrate%3A%3Aalpha%3A%3AWorker%3Atrait%3Acrate%3A%3Aalpha%3A%3ARunner%404%3A64#run#0'
  it.each(['architecture', 'implementation', 'test-implementation'] as const)('writes and dispatches a bounded task-owned %s request', async role => {
    const base = allocateV114OutputDir('task-executor-v114')
    mkdirSync(base, { recursive: true })
    let ordinal = 1
    while (existsSync(join(base, `035-role-${ordinal}`))) ordinal++
    const outputDir = join(base, `035-role-${ordinal}`)
    const task: RetrievalRegressionTask = { id: 'role', title: role, fixtureRoot: resolve('tests/fixtures/v114-language/rust/F13-retrieval'), sourceRoots: ['src', 'tests'], query: 'impl crate::alpha::Runner for crate::alpha::Worker run', mode: 'general', caps: { maxGraphNodes: 40, maxGraphEdges: 70, maxSourceSlices: 6 }, execution: { kind: 'context', role, focusSymbols: [method], changedSymbols: [method], requestedEvidenceKinds: ['owner', 'changed-surface'] } }
    const result = await executeTask({ repoRoot: process.cwd(), configPath: join(outputDir, 'config.json'), outputDir, task, config: sampleConfig })
    expect(result.status).toBe('executed')
    expect(result.errors).toEqual([])
    const requestPath = join(outputDir, 'tasks/role/context-request.json')
    expect(existsSync(requestPath)).toBe(true)
    const request = JSON.parse(readFileSync(requestPath, 'utf8'))
    expect(request).toEqual({ schemaVersion: '1.0.0', query: task.query, role, focusSymbols: [method], changedSymbols: [method], requestedEvidenceKinds: ['owner', 'changed-surface'] })
    expect(request.index).toBeUndefined()
    expect(request.output).toBeUndefined()
    expect(request.auditOutput).toBeUndefined()
    const execution = JSON.parse(readFileSync(result.artifactPaths!.taskExecutionPath!, 'utf8'))
    const args: string[] = execution.contextExecution.args
    expect(args.filter(a => a === '--request')).toHaveLength(1)
    expect(args).not.toContain('--query')
    for (const flag of ['--index', '--out', '--audit-out', '--mode', '--max-source-slices']) expect(args.filter(a => a === flag)).toHaveLength(1)
    expect(args[args.indexOf('--request') + 1]).toBe(requestPath.replaceAll('\\', '/'))
    const capsule = JSON.parse(readFileSync(result.artifactPaths!.capsulePath!, 'utf8'))
    expect(capsule.roleContext.role).toBe(role)
    expect(capsule.request.originalQuery).toBe(task.query)
    expect(capsule.roleContext.focus.focusSymbols).toContainEqual(expect.objectContaining({ symbol: method, resolved: true, matchedNodeIds: [method] }))
    expect(capsule.roleContext.changedSurface.symbols).toContainEqual(expect.objectContaining({ symbolId: method }))
    expect(capsule.selectedSource.slices).toContainEqual(expect.objectContaining({ filePath: 'src/impls.rs', startLine: 5, endLine: 7 }))
  })
})

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function tmpRoot(): string {
  const dir = allocateV114OutputDir('task-executor-fixture-v114')
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

describe('buildCommandArgs lookup/slice', () => {
  const task = { id: 't', title: 'T' } as RetrievalRegressionTask

  it('builds only supported lookup options and always requests JSON', () => {
    expect(buildCommandArgs({ indexDir: 'idx', task, execution: { kind: 'lookup', node: 'n' } })).toEqual(['src/cli.ts', 'lookup', '--index', 'idx', '--node', 'n', '--json'])
    expect(buildCommandArgs({ indexDir: 'idx', task, execution: { kind: 'lookup', node: 'n', depth: 0, resolveClassification: true } })).toEqual([
      'src/cli.ts', 'lookup', '--index', 'idx', '--node', 'n', '--depth', '0', '--resolve-classification', '--json',
    ])
    expect(buildCommandArgs({ indexDir: 'idx', task, execution: { kind: 'lookup', androidComponent: 'Main', depth: 2 } })).toEqual([
      'src/cli.ts', 'lookup', '--index', 'idx', '--android-component', 'Main', '--depth', '2', '--json',
    ])
  })

  it('builds slice selectors, depth, direction and include flags and omits unset or false options', () => {
    expect(buildCommandArgs({ indexDir: 'idx', task, execution: { kind: 'slice', node: 'n' } })).toEqual(['src/cli.ts', 'slice', '--index', 'idx', '--node', 'n', '--json'])
    expect(
      buildCommandArgs({
        indexDir: 'idx',
        task,
        execution: { kind: 'slice', composable: 'Home', depth: 3, direction: 'outgoing', includeViewmodel: true, includeNavigation: true, includeDataFlow: true, includeTests: true },
      })
    ).toEqual([
      'src/cli.ts', 'slice', '--index', 'idx', '--composable', 'Home', '--depth', '3', '--direction', 'outgoing',
      '--include-viewmodel', '--include-navigation', '--include-data-flow', '--include-tests', '--json',
    ])
    expect(buildCommandArgs({ indexDir: 'idx', task, execution: { kind: 'slice', androidRoute: 'r', includeTests: false } })).toEqual([
      'src/cli.ts', 'slice', '--index', 'idx', '--android-route', 'r', '--json',
    ])
    expect(buildCommandArgs({ indexDir: 'idx', task, execution: { kind: 'slice', androidComponent: 'c' } })).toContain('--android-component')
  })

  it('leaves the existing search and source argument construction unchanged', () => {
    expect(buildCommandArgs({ indexDir: 'idx', task: { ...task, query: 'q' }, execution: { kind: 'search', intent: 'ownership', limit: 5 } })).toEqual([
      'src/cli.ts', 'search', '--index', 'idx', '--query', 'q', '--intent', 'ownership', '--limit', '5', '--json',
    ])
    expect(buildCommandArgs({ indexDir: 'idx', task, execution: { kind: 'source', node: 'n', maxLines: 4, continue: true } })).toEqual([
      'src/cli.ts', 'source', '--index', 'idx', '--node', 'n', '--max-lines', '4', '--continue', '--json',
    ])
  })
})

describe('executeTask lookup/slice execution', () => {
  async function run(task: RetrievalRegressionTask) {
    const root = tmpRoot()
    const fixtureDir = makeTinyFixture(root)
    const configPath = join(root, 'core.json')
    writeFileSync(configPath, '{}', 'utf8')
    return executeTask({
      repoRoot: process.cwd(),
      configPath,
      outputDir: join(root, 'out'),
      task: { ...task, fixtureRoot: fixtureDir, sourceRoots: ['src'] },
      config: sampleConfig,
    })
  }

  it('executes a generic node lookup and a node slice with typed expectations', async () => {
    const lookup = await run({
      id: 'lookup-task',
      title: 'Lookup',
      execution: { kind: 'lookup', node: 'symbol:src/a.ts#add', depth: 1 },
      expectations: { commandResult: { lookup: { expectedStatus: 'found', expectedNodeId: 'symbol:src/a.ts#add', expectedNodeKind: 'symbol' } } },
    })
    expect(lookup.status).toBe('executed')
    expect(lookup.verdict).toBe('PASS')
    expect(lookup.query).toBeUndefined()
    const record = JSON.parse(readFileSync(lookup.artifactPaths!.taskExecutionPath!, 'utf8'))
    expect(record.commandExecution).toMatchObject({ kind: 'lookup', status: 'executed', exitCode: 0 })

    const slice = await run({
      id: 'slice-task',
      title: 'Slice',
      execution: { kind: 'slice', node: 'symbol:src/a.ts#add', depth: 1 },
      expectations: {
        commandResult: {
          slice: {
            requiredNodeIds: ['file:src/a.ts', 'symbol:src/a.ts#add'],
            requiredEdges: [{ source: 'file:src/a.ts', kind: 'defines', target: 'symbol:src/a.ts#add' }],
            connectedPaths: [{ nodeIds: ['file:src/a.ts', 'symbol:src/a.ts#add'], edgeKinds: ['defines'] }],
            forbiddenEdges: [{ source: 'symbol:src/a.ts#add', kind: 'defines', target: 'file:src/a.ts' }],
            maxNodes: 2,
          },
        },
      },
    })
    expect(slice.verdict).toBe('PASS')
    expect(slice.assertionResults![0]).toMatchObject({ kind: 'commandResult', status: 'pass' })
  }, 60000)

  it('marks a failed lookup/slice expectation REGRESSION and an unknown node BLOCKED', async () => {
    const wrongKind = await run({
      id: 'lookup-wrong-kind',
      title: 'Wrong kind',
      execution: { kind: 'lookup', node: 'symbol:src/a.ts#add' },
      expectations: { commandResult: { lookup: { expectedNodeKind: 'file' } } },
    })
    expect(wrongKind.verdict).toBe('REGRESSION')

    const forbidden = await run({
      id: 'slice-forbidden',
      title: 'Forbidden node',
      execution: { kind: 'slice', node: 'symbol:src/a.ts#add', depth: 1 },
      expectations: { commandResult: { slice: { forbiddenNodeIds: ['file:src/a.ts'] } } },
    })
    expect(forbidden.verdict).toBe('REGRESSION')

    const unknown = await run({
      id: 'slice-unknown',
      title: 'Unknown node',
      execution: { kind: 'slice', node: 'symbol:src/a.ts#missing' },
      expectations: { commandResult: { slice: { requiredNodeIds: ['symbol:src/a.ts#missing'] } } },
    })
    expect(unknown.status).toBe('blocked')
    expect(unknown.verdict).toBe('BLOCKED')
    expect(unknown.errors[0]).toContain('slice command exited with code')
  }, 90000)

  it('regresses when requested Android test evidence is empty', async () => {
    const result = await run({
      id: 'slice-empty-tests',
      title: 'Empty test evidence',
      execution: { kind: 'slice', node: 'symbol:src/a.ts#add', depth: 0, includeTests: true },
      expectations: { commandResult: { slice: { requireAndroidTests: true } } },
    })
    // includeTests is requested, so the Android summary is produced (zero related tests on a non-Android node): REGRESSION, not PASS.
    expect(result.verdict).toBe('REGRESSION')
    expect(result.assertionResults![0]!.message).toContain('no related test methods')
  }, 60000)
})
