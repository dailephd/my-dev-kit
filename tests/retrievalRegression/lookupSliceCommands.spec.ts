/**
 * v1.13.0 Batch 2: real lookup/slice command tasks run through the existing retrieval-regression runner against
 * the enriched combined Android fixture and the Android test-semantic fixture. Each task indexes its fixture,
 * runs one real CLI operation and evaluates typed expectations; synthetic evidence cases live in assertions.spec.ts.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evaluateTaskAssertions, loadAssertionEvidence } from '../../src/retrievalRegression/assertions.js'
import { runRetrievalRegression } from '../../src/retrievalRegression/runRetrievalRegression.js'
import type { RetrievalRegressionReport, RetrievalRegressionTaskResult } from '../../src/retrievalRegression/types.js'

const COMBINED = join(process.cwd(), 'tests', 'fixtures', 'android-retrieval', 'combined-app')
const COMBINED_ROOTS = ['app/src/main', 'app/src/debug', 'app/src/test', 'app/src/androidTest', 'core/src/main']
const TEST_SEMANTIC = join(process.cwd(), 'tests', 'fixtures', 'android-test-semantic', 'basic-app')
const TEST_SEMANTIC_ROOTS = ['app/src/main', 'app/src/test', 'app/src/androidTest']

const CP = 'app/src/main/kotlin/com/example/combined/'
const MAIN = 'android-manifest-component:app/src/main/AndroidManifest.xml#activity:.MainActivity:0'
const OTHER_MAIN = 'android-manifest-component:app/src/main/AndroidManifest.xml#activity:com.example.other.MainActivity:1'
const VM = `symbol:${CP}UserViewModel.kt#UserViewModel`
const REPO = `symbol:${CP}data/UserRepository.kt#UserRepository`
const DAO = `symbol:${CP}data/UserDao.kt#UserDao`
const ENTITY = `symbol:${CP}data/UserEntity.kt#UserEntity`
const SETTINGS_ROUTE = `android-navigation-compose-route:${CP}AppNav.kt#2`
const SETTINGS_SCREEN = `symbol:${CP}AppNav.kt#ComposeSettingsScreen`
const HOME_ROUTE_A = `android-navigation-compose-route:${CP}AppNav.kt#0`
const HOME_ROUTE_B = `android-navigation-compose-route:${CP}AppNav.kt#8`

const combined = { fixtureRoot: COMBINED, sourceRoots: COMBINED_ROOTS }

const tasks = [
  {
    id: 'lookup-exact-component',
    title: 'Exact Android component lookup',
    ...combined,
    execution: { kind: 'lookup', androidComponent: 'com.example.combined.MainActivity' },
    expectations: { commandResult: { lookup: { expectedStatus: 'found', expectedNodeId: MAIN } } },
  },
  {
    id: 'lookup-ambiguous-component',
    title: 'Ambiguous Android component lookup preserves both candidates',
    ...combined,
    execution: { kind: 'lookup', androidComponent: 'MainActivity' },
    expectations: {
      commandResult: { lookup: { expectedStatus: 'ambiguous', requiredCandidateIds: [MAIN, OTHER_MAIN], expectedCandidateCount: 2 } },
    },
  },
  {
    id: 'lookup-ambiguity-expected-unique',
    title: 'Expecting a unique winner for an ambiguous component regresses',
    ...combined,
    execution: { kind: 'lookup', androidComponent: 'MainActivity' },
    expectations: { commandResult: { lookup: { expectedStatus: 'found', expectedNodeId: MAIN } } },
  },
  {
    id: 'lookup-generic-node',
    title: 'Generic node lookup',
    ...combined,
    execution: { kind: 'lookup', node: VM, depth: 0 },
    expectations: { commandResult: { lookup: { expectedStatus: 'found', expectedNodeId: VM, expectedNodeKind: 'symbol' } } },
  },
  {
    id: 'lookup-unknown-node',
    title: 'Unknown generic node is a command failure, not a successful not-found',
    ...combined,
    execution: { kind: 'lookup', node: 'symbol:does/not/exist.kt#Nope' },
    expectations: { commandResult: { lookup: { expectedNodeId: 'symbol:does/not/exist.kt#Nope' } } },
  },
  {
    id: 'slice-route-resolves-screen',
    title: 'Settings route slice contains the exact route-to-screen edge',
    ...combined,
    execution: { kind: 'slice', androidRoute: 'settings', depth: 1 },
    expectations: {
      commandResult: {
        slice: {
          expectedStatus: 'ok',
          requiredNodeIds: [SETTINGS_ROUTE, SETTINGS_SCREEN],
          requiredEdges: [{ source: SETTINGS_ROUTE, kind: 'compose-route-resolves-to-screen', target: SETTINGS_SCREEN }],
          forbiddenEdges: [{ source: SETTINGS_SCREEN, kind: 'compose-route-resolves-to-screen', target: SETTINGS_ROUTE }],
          connectedPaths: [{ nodeIds: [SETTINGS_ROUTE, SETTINGS_SCREEN], edgeKinds: ['compose-route-resolves-to-screen'] }],
          maxNodes: 10,
          maxEdges: 10,
        },
      },
    },
  },
  {
    id: 'slice-route-ambiguous',
    title: 'Ambiguous Android route is a valid structured result when ambiguity is expected',
    ...combined,
    execution: { kind: 'slice', androidRoute: 'compose_home' },
    expectations: {
      commandResult: { slice: { expectedStatus: 'ambiguous', requiredCandidateIds: [HOME_ROUTE_A, HOME_ROUTE_B], expectedCandidateCount: 2 } },
    },
  },
  {
    id: 'slice-route-ambiguous-graph-expected',
    title: 'Graph evidence expected for an ambiguous route regresses',
    ...combined,
    execution: { kind: 'slice', androidRoute: 'compose_home' },
    expectations: { commandResult: { slice: { requiredNodeIds: [HOME_ROUTE_A] } } },
  },
  {
    id: 'slice-route-not-found',
    title: 'Unknown Android route is a valid not-found result',
    ...combined,
    execution: { kind: 'slice', androidRoute: 'nonexistent_route' },
    expectations: { commandResult: { slice: { expectedStatus: 'not-found' } } },
  },
  {
    id: 'slice-dataflow-chain',
    title: 'Grounded ViewModel to Repository to DAO to Entity chain is one connected path',
    ...combined,
    execution: { kind: 'slice', node: VM, depth: 3, direction: 'outgoing', includeDataFlow: true },
    expectations: {
      commandResult: {
        slice: {
          expectedStatus: 'ok',
          requiredEdgeKinds: ['viewmodel-uses-repository', 'repository-uses-dao', 'dao-uses-entity'],
          connectedPaths: [
            {
              nodeIds: [VM, REPO, DAO, ENTITY],
              edgeKinds: ['viewmodel-uses-repository', 'repository-uses-dao', 'dao-uses-entity'],
            },
          ],
          forbiddenEdges: [{ source: DAO, kind: 'repository-uses-dao', target: REPO }],
          expectedDataFlowTruncated: false,
          maxNodes: 60,
          maxEdges: 80,
        },
      },
    },
  },
  {
    id: 'slice-broken-path',
    title: 'A path that skips the Repository hop is broken and regresses',
    ...combined,
    execution: { kind: 'slice', node: VM, depth: 3, direction: 'outgoing', includeDataFlow: true },
    expectations: {
      commandResult: { slice: { connectedPaths: [{ nodeIds: [VM, DAO, ENTITY], edgeKinds: ['repository-uses-dao', 'dao-uses-entity'] }] } },
    },
  },
  {
    id: 'slice-related-tests',
    title: 'Android test-semantic fixture contributes related test evidence',
    fixtureRoot: TEST_SEMANTIC,
    sourceRoots: TEST_SEMANTIC_ROOTS,
    execution: {
      kind: 'slice',
      node: 'symbol:app/src/main/kotlin/com/example/LoginViewModel.kt#LoginViewModel',
      depth: 1,
      includeTests: true,
    },
    expectations: { commandResult: { slice: { requiredNodeKinds: ['android-test-method'], requireAndroidTests: true } } },
  },
]

const expectedVerdicts: Record<string, 'PASS' | 'REGRESSION' | 'BLOCKED'> = {
  'lookup-exact-component': 'PASS',
  'lookup-ambiguous-component': 'PASS',
  'lookup-ambiguity-expected-unique': 'REGRESSION',
  'lookup-generic-node': 'PASS',
  'lookup-unknown-node': 'BLOCKED',
  'slice-route-resolves-screen': 'PASS',
  'slice-route-ambiguous': 'PASS',
  'slice-route-ambiguous-graph-expected': 'REGRESSION',
  'slice-route-not-found': 'PASS',
  'slice-dataflow-chain': 'PASS',
  'slice-broken-path': 'REGRESSION',
  'slice-related-tests': 'PASS',
}

let workDir: string
let outputDir: string
let report: RetrievalRegressionReport

function taskResult(id: string): RetrievalRegressionTaskResult {
  const result = report.tasks.find((task) => task.id === id)
  if (!result) throw new Error(`task ${id} missing from report`)
  return result
}

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-lookup-slice-'))
  outputDir = join(workDir, 'out')
  const configPath = join(workDir, 'lookup-slice.json')
  writeFileSync(configPath, JSON.stringify({ schemaVersion: '1.0.0', suiteId: 'lookup-slice-integration', tasks }), 'utf8')
  const run = await runRetrievalRegression({ configPath, outputDir })
  if (run.blocked) throw new Error(run.message)
  report = run.report
}, 600000)

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

describe('lookup/slice tasks through the existing retrieval-regression runner (real fixtures)', () => {
  it('produces the expected task verdicts in config order', () => {
    expect(report.tasks.map((task) => task.id)).toEqual(tasks.map((task) => task.id))
    for (const [id, verdict] of Object.entries(expectedVerdicts)) {
      expect({ id, verdict: taskResult(id).verdict }).toEqual({ id, verdict })
    }
    // Existing suite rule: any BLOCKED task outranks REGRESSION.
    expect(report.verdict).toBe('BLOCKED')
    expect(report.summary.taskCount).toBe(tasks.length)
    expect(report.summary.blockedTaskCount).toBe(1)
    expect(report.summary.regressionTaskCount).toBe(3)
  })

  it('records lookup/slice command evidence in the existing task-execution record and stdout artifact', () => {
    const exact = taskResult('lookup-exact-component')
    expect(exact.status).toBe('executed')
    const record = JSON.parse(readFileSync(exact.artifactPaths!.taskExecutionPath!, 'utf8'))
    expect(record.commandExecution).toMatchObject({ kind: 'lookup', status: 'executed', exitCode: 0 })
    expect(record.commandExecution.args).toEqual(expect.arrayContaining(['lookup', '--android-component', 'com.example.combined.MainActivity', '--json']))
    expect(existsSync(exact.artifactPaths!.stdoutPath!)).toBe(true)
    expect(exact.artifactPaths!.capsulePath).toBeUndefined()
    expect(exact.assertionResults![0]).toMatchObject({ kind: 'commandResult', status: 'pass', severity: 'required' })
  })

  it('preserves both candidates of an ambiguous Android component and never selects a winner', () => {
    const ambiguous = taskResult('lookup-ambiguous-component')
    const stdout = JSON.parse(readFileSync(ambiguous.artifactPaths!.stdoutPath!, 'utf8'))
    expect(stdout.status).toBe('ambiguous')
    expect(stdout.detail).toBeNull()
    expect(stdout.candidates.map((c: { graphNodeId: string }) => c.graphNodeId).sort()).toEqual([MAIN, OTHER_MAIN].sort())

    const regressed = taskResult('lookup-ambiguity-expected-unique')
    expect(regressed.assertionResults![0]!.message).toContain('expected status "found" but observed "ambiguous"')
  })

  it('treats an unknown generic node as command failure (BLOCKED), not a successful not-found', () => {
    const unknown = taskResult('lookup-unknown-node')
    expect(unknown.status).toBe('blocked')
    expect(unknown.verdict).toBe('BLOCKED')
    expect(unknown.errors[0]).toContain('lookup command exited with code')
    expect(unknown.assertionResults ?? []).toEqual([])
    const record = JSON.parse(readFileSync(unknown.artifactPaths!.taskExecutionPath!, 'utf8'))
    expect(record.commandExecution.status).toBe('blocked')
    expect(record.commandExecution.exitCode).not.toBe(0)
  })

  it('verifies the exact Android route-to-screen relationship', () => {
    const route = taskResult('slice-route-resolves-screen')
    expect(route.verdict).toBe('PASS')
    expect(route.assertionResults![0]!.actualSummary).toContain('status="ok"')
  })

  it('accepts valid Android selector ambiguity/not-found only when explicitly expected', () => {
    expect(taskResult('slice-route-ambiguous').verdict).toBe('PASS')
    expect(taskResult('slice-route-not-found').verdict).toBe('PASS')
    const graphExpected = taskResult('slice-route-ambiguous-graph-expected')
    expect(graphExpected.verdict).toBe('REGRESSION')
    expect(graphExpected.assertionResults![0]!.message).toContain('no graph')
  })

  it('verifies a grounded ownership/data-flow chain as one connected path with a non-truncated data-flow summary', () => {
    const chain = taskResult('slice-dataflow-chain')
    expect(chain.verdict).toBe('PASS')
    expect(chain.assertionResults![0]!.actualSummary).toContain('dataFlowTruncated=false')
  })

  it('fails a deliberately broken connected-path expectation', () => {
    const broken = taskResult('slice-broken-path')
    expect(broken.verdict).toBe('REGRESSION')
    expect(broken.assertionResults![0]!.message).toContain('connected path #1 is broken')
  })

  it('verifies related Android test evidence from the test-semantic fixture without claiming execution', () => {
    const tests = taskResult('slice-related-tests')
    expect(tests.verdict).toBe('PASS')
    expect(tests.assertionResults![0]!.actualSummary).toMatch(/relatedTestMethodCount=[1-9]/)
  })

  it('counts lookup/slice assertions in the existing command-result metric without a new report schema', () => {
    expect(report.schemaVersion).toBe('1.0.0')
    expect(report.metrics.commandResultAssertionPassRate).toBeGreaterThan(0)
    expect(report.metrics.commandResultAssertionPassRate).toBeLessThan(1)
    expect(report.metrics.assertionBlockedCount).toBe(0)
    const reportText = readFileSync(join(outputDir, 'retrieval-regression-report.json'), 'utf8')
    expect(reportText).not.toContain('"edges"')
    expect(reportText).not.toContain('"detail"')
  })

  it('cannot silently PASS when the recorded command output is malformed or unsupported', () => {
    const stdoutPath = taskResult('slice-dataflow-chain').artifactPaths!.stdoutPath!
    const expectations = tasks.find((task) => task.id === 'slice-dataflow-chain')!.expectations
    const original = readFileSync(stdoutPath, 'utf8')
    const cases: Record<string, string> = {
      truncated: original.slice(0, Math.floor(original.length / 2)),
      emptyObject: '{}',
      wrongShape: JSON.stringify({ status: 'found', node: { id: VM, kind: 'symbol' } }),
      nodesOnly: JSON.stringify({ nodes: [] }),
    }
    const dir = mkdtempSync(join(workDir, 'malformed-'))
    for (const [name, content] of Object.entries(cases)) {
      const path = join(dir, `${name}.json`)
      writeFileSync(path, content, 'utf8')
      const results = evaluateTaskAssertions('malformed', expectations as never, loadAssertionEvidence({ commandResultPath: path }))
      expect({ name, status: results[0]!.status }).toEqual({ name, status: 'blocked' })
    }
  })
})
