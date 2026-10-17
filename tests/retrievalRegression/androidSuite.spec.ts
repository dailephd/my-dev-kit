/**
 * v1.13.0 Batch 3: validation of the twelve-scenario Android retrieval benchmark suite
 * (benchmarks/retrieval/v1.13/android.json). Structural tests use the real configuration loader and fixture
 * resolver; adequacy tests drive the real assertion evaluator with graphs synthesized from each task's own
 * expectations; one end-to-end test runs the real suite through the existing runner.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { evaluateTaskAssertions, loadAssertionEvidence } from '../../src/retrievalRegression/assertions.js'
import { loadRetrievalRegressionConfig, validateRetrievalRegressionConfig } from '../../src/retrievalRegression/configLoader.js'
import { resolveFixture } from '../../src/retrievalRegression/fixtureResolver.js'
import { runRetrievalRegression } from '../../src/retrievalRegression/runRetrievalRegression.js'
import type { RetrievalRegressionTask, SliceResultExpectation } from '../../src/retrievalRegression/types.js'

const repoRoot = resolve('.')
const configPath = resolve('benchmarks/retrieval/v1.13/android.json')
const config = loadRetrievalRegressionConfig(configPath)
const byId = new Map(config.tasks.map((task) => [task.id, task]))
const REQUIRED_IDS = Array.from({ length: 12 }, (_, i) => `android-v113-a${String(i + 1).padStart(2, '0')}`)

const tempDirs: string[] = []
afterAll(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})
function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function task(id: string): RetrievalRegressionTask {
  const found = byId.get(id)
  if (!found) throw new Error(`missing task ${id}`)
  return found
}
const executionKind = (t: RetrievalRegressionTask) => t.execution?.kind ?? 'context'

const EXPECTED_KINDS: Record<string, string> = {
  'android-v113-a01': 'context',
  'android-v113-a02': 'source',
  'android-v113-a03': 'slice',
  'android-v113-a04': 'slice',
  'android-v113-a05': 'slice',
  'android-v113-a06': 'slice',
  'android-v113-a07': 'slice',
  'android-v113-a08': 'slice',
  'android-v113-a09': 'slice',
  'android-v113-a10': 'context',
  'android-v113-a11': 'context',
  'android-v113-a12': 'slice',
}
const sliceTasks = REQUIRED_IDS.filter((id) => EXPECTED_KINDS[id] === 'slice')
const contextTasks = REQUIRED_IDS.filter((id) => EXPECTED_KINDS[id] === 'context')

describe('Android suite configuration', () => {
  it('loads through the existing configuration loader with the required identity', () => {
    expect(config.schemaVersion).toBe('1.0.0')
    expect(config.suiteId).toBe('android-v1.13')
    expect(config.name).toBe('Android Retrieval Benchmarks')
    expect(config.target).toBe('my-dev-kit')
    expect(() => validateRetrievalRegressionConfig(JSON.parse(readFileSync(configPath, 'utf8')), configPath)).not.toThrow()
  })

  it('contains exactly the twelve required, unique, unskipped task ids', () => {
    expect(config.tasks.map((t) => t.id)).toEqual(REQUIRED_IDS)
    expect(new Set(config.tasks.map((t) => t.id)).size).toBe(12)
    for (const t of config.tasks) {
      expect(t.skip, t.id).not.toBe(true)
      expect(t.skipReason, t.id).toBeUndefined()
      expect(t.title, t.id).toBeTruthy()
      expect(t.description, t.id).toBeTruthy()
      expect(t.tags?.length, t.id).toBeGreaterThan(0)
    }
  })

  it('maps every scenario to its planned supported execution kind', () => {
    for (const id of REQUIRED_IDS) expect({ id, kind: executionKind(task(id)) }).toEqual({ id, kind: EXPECTED_KINDS[id] })
  })

  it('resolves every fixture root and source root through the existing fixture resolver', () => {
    const outputDir = join(tmp('my-dev-kit-v1-android-suite-'), 'out')
    for (const t of config.tasks) {
      const resolved = resolveFixture({ configPath, outputDir, task: t })
      expect(existsSync(resolved.fixtureRoot), `${t.id} fixtureRoot`).toBe(true)
      expect(resolved.sourceRoots.length, t.id).toBeGreaterThan(0)
      for (const root of resolved.sourceRoots) expect(existsSync(root), `${t.id} ${root}`).toBe(true)
    }
  })

  it('uses the three approved fixtures with the approved explicit source roots', () => {
    const combinedRoots = ['app/src/main', 'app/src/debug', 'app/src/test', 'app/src/androidTest', 'core/src/main']
    for (const id of REQUIRED_IDS.filter((x) => x !== 'android-v113-a11' && x !== 'android-v113-a12')) {
      expect(task(id).fixtureRoot).toBe('../../../tests/fixtures/android-retrieval/combined-app')
      expect(task(id).sourceRoots).toEqual(combinedRoots)
    }
    expect(task('android-v113-a12').fixtureRoot).toBe('../../../tests/fixtures/android-test-semantic/basic-app')
    expect(task('android-v113-a12').sourceRoots).toEqual(['app/src/main', 'app/src/test', 'app/src/androidTest'])
    expect(task('android-v113-a11').fixtureRoot).toBe('../../../tests/fixtures/android/generated-build-output')
    expect(task('android-v113-a11').sourceRoots).toEqual(['app'])
  })

  it('keeps all fixture-relative paths inside the project and free of host-specific absolute paths', () => {
    const raw = readFileSync(configPath, 'utf8')
    expect(raw).not.toMatch(/[A-Za-z]:[\\/]/)
    for (const t of config.tasks) {
      expect(isAbsolute(t.fixtureRoot!), t.id).toBe(false)
      const fixture = resolve(dirname(configPath), t.fixtureRoot!)
      expect(relative(repoRoot, fixture).startsWith('..'), `${t.id} fixture escapes the project`).toBe(false)
      for (const root of t.sourceRoots ?? []) {
        expect(isAbsolute(root), `${t.id} ${root}`).toBe(false)
        expect(relative(fixture, resolve(fixture, root)).startsWith('..'), `${t.id} ${root}`).toBe(false)
      }
    }
  })

  it('rejects an invalid mutation of a real task through the loader (selectors are enforced, not just declared)', () => {
    const mutate = (id: string, edit: (t: Record<string, any>) => void) => {
      const clone = JSON.parse(readFileSync(configPath, 'utf8'))
      edit(clone.tasks.find((t: { id: string }) => t.id === id))
      return () => validateRetrievalRegressionConfig(clone, configPath)
    }
    expect(mutate('android-v113-a04', (t) => (t.execution.node = 'file:x'))).toThrow(/exactly one selector/)
    expect(mutate('android-v113-a03', (t) => (t.execution.depth = 4))).toThrow(/depth must be an integer from 0 through 3/)
    expect(mutate('android-v113-a07', (t) => (t.execution.includeDataFlow = false))).toThrow(/requires execution.includeDataFlow true/)
    expect(mutate('android-v113-a12', (t) => (t.execution.includeTests = false))).toThrow(/requires execution.includeTests true/)
    expect(mutate('android-v113-a09', (t) => (t.expectations.commandResult.slice.connectedPaths[0].edgeKinds = ['manifest-declares-component']))).toThrow(
      /edgeKinds length must equal nodeIds length minus one/
    )
  })
})

describe('Android suite scenario substance', () => {
  it('gives every task at least one required expectation', () => {
    for (const id of REQUIRED_IDS) {
      const t = task(id)
      const expectations = t.expectations as Record<string, any>
      expect(expectations, id).toBeTruthy()
      if (executionKind(t) === 'context') {
        const requiredKinds = ['candidateFiles', 'candidateNodes', 'focus', 'selectedGraph', 'sourceEvidence', 'classificationSummary']
        for (const key of requiredKinds) expect(expectations[key], `${id} ${key}`).toBeTruthy()
      } else {
        expect(expectations.commandResult, id).toBeTruthy()
        expect(expectations.commandResult.required, id).not.toBe(false)
      }
    }
  })

  it('makes every slice task assert substantive positive evidence beyond a generic status', () => {
    for (const id of sliceTasks) {
      const slice = task(id).expectations!.commandResult!.slice as SliceResultExpectation
      expect(slice.expectedStatus, id).toBe('ok')
      expect((slice.requiredNodeIds ?? []).length, `${id} requiredNodeIds`).toBeGreaterThanOrEqual(2)
      const edgeEvidence = (slice.requiredEdges?.length ?? 0) + (slice.connectedPaths?.length ?? 0) + (slice.requiredEdgeKinds?.length ?? 0)
      expect(edgeEvidence, `${id} edge evidence`).toBeGreaterThanOrEqual(1)
      expect(slice.maxNodes, id).toBeGreaterThan(0)
      expect(slice.maxEdges, id).toBeGreaterThan(0)
    }
  })

  it('includes negative evidence for every slice task and the source task', () => {
    for (const id of sliceTasks) {
      const slice = task(id).expectations!.commandResult!.slice as SliceResultExpectation
      expect((slice.forbiddenNodeIds?.length ?? 0) + (slice.forbiddenEdges?.length ?? 0), `${id} negative evidence`).toBeGreaterThanOrEqual(1)
    }
    const source = task('android-v113-a02').expectations!.commandResult!
    expect(source.forbiddenContent?.length).toBeGreaterThanOrEqual(1)
    for (const id of contextTasks) {
      const e = task(id).expectations!
      expect(e.sourceEvidence?.forbiddenFileContains?.length, id).toBeGreaterThanOrEqual(1)
      expect(e.conflicts?.expectedStatus, id).toBe('none')
    }
  })

  it('keeps the context tasks in feature-add mode with the original strict metadata contract', () => {
    for (const id of contextTasks) {
      const t = task(id)
      expect(t.mode, id).toBe('feature-add')
      expect(t.query, id).toBeTruthy()
      expect(t.caps, id).toBeTruthy()
      expect(t.expectations?.noRawContent?.enabled, id).toBe(true)
      expect(t.expectations?.auditSteps, id).toBeTruthy()
      expect(t.expectations?.caps, id).toBeTruthy()
      expect(t.expectations?.adequacy, id).toBeTruthy()
      expect(t.expectations?.focus?.allowNoFocus, id).toBe(false)
      expect(t.expectations?.focus?.nodeId, id).toBeTruthy()
    }
    // The D1 connector words stay in the A01 benchmark query.
    expect(task('android-v113-a01').query).toBe('add a new Compose screen next to UserHomeScreen')
    expect(task('android-v113-a01').query).toMatch(/\ba\b.*\bto\b|\bnext to\b/)
  })

  it('assesses generated-output avoidance explicitly without forbidding intentional source reads', () => {
    const a11 = task('android-v113-a11')
    expect(a11.expectations?.selectedGraph?.forbiddenFileContains).toContain('/build/')
    expect(a11.expectations?.sourceEvidence?.forbiddenFileContains).toContain('/build/')
    expect(a11.expectations?.classificationSummary?.requiredEditGuidance).toContain('generated-do-not-edit')
    expect(a11.expectations?.classificationSummary?.requiredRiskLabels).toContain('generated-build-file-risk')
    expect(a11.expectations?.focus?.path).toBe('app/src/main/kotlin/com/example/MainActivity.kt')
    // The fixture really contains generated files under the indexed root, so this is a meaningful assessment.
    const fixture = resolve(dirname(configPath), a11.fixtureRoot!)
    expect(existsSync(join(fixture, 'app/build/generated/source/Generated.java'))).toBe(true)
    // Intentional bounded source reads are not prohibited: no task forbids the source execution kind.
    expect(executionKind(task('android-v113-a02'))).toBe('source')
  })

  it('does not represent known static-analysis gaps as required edges or nodes', () => {
    const slices = Object.fromEntries(sliceTasks.map((id) => [id, task(id).expectations!.commandResult!.slice as SliceResultExpectation]))
    const requiredEdges = (id: string) => slices[id]!.requiredEdges ?? []
    const everyNodeId = (id: string) => [
      ...(slices[id]!.requiredNodeIds ?? []),
      ...(slices[id]!.connectedPaths ?? []).flatMap((p) => p.nodeIds),
      ...requiredEdges(id).flatMap((e) => [e.source, e.target]),
    ]
    // A03: no click-handler-to-ViewModel/state edge.
    expect(requiredEdges('android-v113-a03').some((e) => e.source.includes('::click#') && e.kind !== 'composable-has-fact')).toBe(false)
    expect((slices['android-v113-a03']!.connectedPaths ?? []).some((p) => p.nodeIds.some((n) => n.includes('::click#')))).toBe(false)
    // A05: no direct resource-to-test edge and no pinned positional resource ordinal.
    for (const id of ['android-v113-a05', 'android-v113-a06', 'android-v113-a07', 'android-v113-a08']) {
      expect(everyNodeId(id).some((n) => /#value:\d+/.test(n)), `${id} positional resource id`).toBe(false)
    }
    expect(requiredEdges('android-v113-a05').some((e) => /test/.test(e.source) && /resource/.test(e.target))).toBe(false)
    // A06: no invented uiState node.
    expect(everyNodeId('android-v113-a06').some((n) => /uiState/.test(n))).toBe(false)
    // A08: no test-double edge into the DAO or the Retrofit service.
    for (const edge of requiredEdges('android-v113-a08')) {
      if (edge.kind.startsWith('android-test-references')) expect(edge.target).not.toMatch(/UserDao|UserApiService/)
    }
    // A09: exported metadata is documented as uncovered, not asserted.
    expect(JSON.stringify(task('android-v113-a09').expectations)).not.toMatch(/exported/i)
    // A12: no invented source-set classification.
    expect(JSON.stringify(task('android-v113-a12').expectations)).not.toMatch(/instrumentedSourceSet|unitSourceSet|sourceSetKind/)
  })

  it('uses only well-formed connected paths whose adjacent nodes differ', () => {
    for (const id of sliceTasks) {
      for (const path of (task(id).expectations!.commandResult!.slice as SliceResultExpectation).connectedPaths ?? []) {
        expect(path.nodeIds.length, id).toBeGreaterThanOrEqual(2)
        expect(path.edgeKinds.length, id).toBe(path.nodeIds.length - 1)
        for (let i = 0; i + 1 < path.nodeIds.length; i++) expect(path.nodeIds[i], id).not.toBe(path.nodeIds[i + 1])
      }
    }
  })
})

/** Builds a minimal graph slice that satisfies a slice expectation exactly, for evaluator-driven adequacy checks. */
function synthesizeSlice(slice: SliceResultExpectation): Record<string, any> {
  const nodes = new Map<string, string>()
  const edges = new Map<string, { id: string; source: string; kind: string; target: string }>()
  const addNode = (id: string, kind = 'symbol') => {
    if (!nodes.has(id)) nodes.set(id, kind)
  }
  const addEdge = (source: string, kind: string, target: string) => {
    addNode(source)
    addNode(target)
    const id = `${source}|${kind}|${target}`
    edges.set(id, { id, source, kind, target })
  }
  for (const id of slice.requiredNodeIds ?? []) addNode(id)
  for (const edge of slice.requiredEdges ?? []) addEdge(edge.source, edge.kind, edge.target)
  for (const path of slice.connectedPaths ?? []) path.edgeKinds.forEach((kind, i) => addEdge(path.nodeIds[i]!, kind, path.nodeIds[i + 1]!))
  // Reuse existing nodes for kind coverage so the synthesized slice stays minimal and within the task's bounds.
  const ids = [...nodes.keys()]
  ;(slice.requiredNodeKinds ?? []).forEach((kind, i) => nodes.set(ids[i % ids.length]!, kind))
  for (const kind of slice.requiredEdgeKinds ?? []) {
    if (![...edges.values()].some((edge) => edge.kind === kind)) addEdge(ids[0]!, kind, ids[1]!)
  }
  const result: Record<string, any> = {
    artifactKind: 'my-dev-kit-v1-graph-slice',
    nodes: [...nodes].map(([id, kind]) => ({ id, kind, label: id })),
    edges: [...edges.values()],
  }
  if (slice.expectedDataFlowTruncated !== undefined) {
    result.androidDataFlow = { requested: true, seedNodeCount: 1, maxDepth: 1, allowedEdgeKinds: [], addedNodeCount: 0, addedEdgeCount: 0, truncated: slice.expectedDataFlowTruncated }
  }
  if (slice.requireAndroidTests) {
    result.androidTests = { requested: true, productionSeedCount: 1, relatedTestMethodCount: 1, addedNodeCount: 0, addedEdgeCount: 0, truncated: false }
  }
  return result
}

function evaluateSlice(id: string, payload: Record<string, any>) {
  const dir = tmp('my-dev-kit-v1-android-suite-eval-')
  const path = join(dir, 'slice-stdout.json')
  writeFileSync(path, JSON.stringify(payload), 'utf8')
  return evaluateTaskAssertions(id, task(id).expectations, loadAssertionEvidence({ commandResultPath: path }))[0]!
}

describe('Android suite assertion adequacy (real evaluator)', () => {
  it.each(sliceTasks)('%s: a graph containing exactly the required evidence satisfies the task', (id) => {
    const slice = task(id).expectations!.commandResult!.slice as SliceResultExpectation
    const result = evaluateSlice(id, synthesizeSlice(slice))
    expect({ id, status: result.status, message: result.message }).toEqual({ id, status: 'pass', message: 'Command result satisfied expectations.' })
  })

  it.each(sliceTasks)('%s: removing any required edge, node or path link regresses', (id) => {
    const slice = task(id).expectations!.commandResult!.slice as SliceResultExpectation
    const base = synthesizeSlice(slice)
    const required = [
      ...(slice.requiredEdges ?? []).map((e) => `${e.source}|${e.kind}|${e.target}`),
      ...(slice.connectedPaths ?? []).flatMap((p) => p.edgeKinds.map((kind, i) => `${p.nodeIds[i]}|${kind}|${p.nodeIds[i + 1]}`)),
    ]
    for (const edgeId of new Set(required)) {
      const mutated = { ...base, edges: base.edges.filter((e: { id: string }) => e.id !== edgeId) }
      expect(evaluateSlice(id, mutated).status, `${id} without ${edgeId}`).toBe('fail')
    }
    for (const nodeId of slice.requiredNodeIds ?? []) {
      const mutated = {
        nodes: base.nodes.filter((n: { id: string }) => n.id !== nodeId),
        edges: base.edges.filter((e: { source: string; target: string }) => e.source !== nodeId && e.target !== nodeId),
        androidDataFlow: base.androidDataFlow,
        androidTests: base.androidTests,
      }
      expect(evaluateSlice(id, mutated).status, `${id} without node ${nodeId}`).toBe('fail')
    }
  })

  it.each(sliceTasks)('%s: any forbidden node or edge regresses', (id) => {
    const slice = task(id).expectations!.commandResult!.slice as SliceResultExpectation
    const base = synthesizeSlice(slice)
    for (const nodeId of slice.forbiddenNodeIds ?? []) {
      const mutated = { ...base, nodes: [...base.nodes, { id: nodeId, kind: 'symbol', label: nodeId }] }
      expect(evaluateSlice(id, mutated).status, `${id} with forbidden node ${nodeId}`).toBe('fail')
    }
    for (const edge of slice.forbiddenEdges ?? []) {
      const extraNodes = [edge.source, edge.target].filter((n) => !base.nodes.some((b: { id: string }) => b.id === n)).map((n) => ({ id: n, kind: 'symbol', label: n }))
      const mutated = {
        ...base,
        nodes: [...base.nodes, ...extraNodes],
        edges: [...base.edges, { id: `forbidden|${edge.source}|${edge.kind}|${edge.target}`, ...edge }],
      }
      expect(evaluateSlice(id, mutated).status, `${id} with forbidden edge`).toBe('fail')
    }
  })

  it.each(sliceTasks)('%s: bounds regress when the slice grows beyond them', (id) => {
    const slice = task(id).expectations!.commandResult!.slice as SliceResultExpectation
    const base = synthesizeSlice(slice)
    const extra = Array.from({ length: slice.maxNodes! + 1 }, (_, i) => ({ id: `extra-${i}`, kind: 'symbol', label: 'x' }))
    expect(evaluateSlice(id, { ...base, nodes: [...base.nodes, ...extra] }).status).toBe('fail')
  })

  it('A02: the source expectation passes on the observed source shape and fails when the window moves', () => {
    const e = task('android-v113-a02').expectations!.commandResult!
    const content = [
      'fun UserHomeScreen() {',
      '    Text(stringResource(R.string.user_screen_title))',
      '    Button(onClick = { viewModel.refreshUsers() }, modifier = Modifier.testTag("refresh_users_button")) {',
      '}',
    ].join('\n')
    const observed = {
      status: 'ok',
      mode: 'node',
      startLine: e.expectedStartLine,
      endLine: e.expectedEndLine,
      lineCount: e.expectedLineCount,
      content,
      continuationCursor: { nextStartLine: e.nextStartLine, symbolBoundaryKnown: false, reason: 'eof', eof: true },
    }
    const run = (payload: unknown) => {
      const dir = tmp('my-dev-kit-v1-android-suite-source-')
      writeFileSync(join(dir, 'source.json'), JSON.stringify(payload), 'utf8')
      return evaluateTaskAssertions('android-v113-a02', task('android-v113-a02').expectations, loadAssertionEvidence({ commandResultPath: join(dir, 'source.json') }))[0]!
    }
    expect(run(observed).status).toBe('pass')
    expect(run({ ...observed, startLine: 5 }).status).toBe('fail')
    expect(run({ ...observed, content: `${content}\nfun UserSettingsScreen() {}` }).status).toBe('fail')
    expect(run({ ...observed, content: content.replace('R.string.user_screen_title', 'R.string.other') }).status).toBe('fail')
    expect(run({ ...observed, continuationCursor: { ...observed.continuationCursor, symbolBoundaryKnown: true } }).status).toBe('fail')
  })
})

describe('compatibility and maintainer script', () => {
  it('leaves the original fourteen-task core suite unchanged and independent', () => {
    const core = loadRetrievalRegressionConfig(resolve('benchmarks/retrieval/v1.7/core.json'))
    expect(core.suiteId).toBe('retrieval-regression-core-v1.7')
    expect(core.tasks).toHaveLength(14)
    expect(core.tasks.every((t) => t.skip !== true)).toBe(true)
    expect(core.tasks.some((t) => t.id.startsWith('android-v113-'))).toBe(false)
    expect(readFileSync(resolve('benchmarks/retrieval/v1.7/core.json'), 'utf8')).not.toContain('v1.13')
  })

  it('wires the Android maintainer script to the right suite and runner and keeps the core script intact', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
    const script: string = pkg.scripts['benchmark:retrieval:android']
    expect(script).toContain('tsx src/retrievalRegression/runRetrievalRegression.ts')
    expect(script).toContain('--config benchmarks/retrieval/v1.13/android.json')
    expect(script).toContain('--out .my-dev-kit/retrieval-regression-android')
    expect(script).toContain('--fail-on-regression')
    expect(existsSync(resolve('benchmarks/retrieval/v1.13/android.json'))).toBe(true)
    expect(pkg.scripts['benchmark:retrieval']).toBe(
      'tsx src/retrievalRegression/runRetrievalRegression.ts --config benchmarks/retrieval/v1.7/core.json --out .my-dev-kit/retrieval-regression --fail-on-regression'
    )
    expect(pkg.scripts.verify).not.toContain('benchmark:retrieval')
  })

  it('keeps benchmark configuration out of the published package allowlist', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
    expect(pkg.files.some((entry: string) => entry.startsWith('benchmarks'))).toBe(false)
  })
})

describe('Android suite end to end through the existing runner', () => {
  it('executes all twelve tasks with every required assertion passing', async () => {
    const outputDir = join(tmp('my-dev-kit-v1-android-suite-run-'), 'out')
    const run = await runRetrievalRegression({ configPath, outputDir })
    if (run.blocked) throw new Error(run.message)
    const { report } = run
    expect(report.verdict).toBe('PASS')
    expect(report.summary).toMatchObject({ taskCount: 12, executedTaskCount: 12, skippedTaskCount: 0, blockedTaskCount: 0, passedTaskCount: 12, regressionTaskCount: 0 })
    expect(report.tasks.map((t) => t.id)).toEqual(REQUIRED_IDS)
    for (const t of report.tasks) {
      expect(t.verdict, t.id).toBe('PASS')
      expect(t.assertionSummary!.total, t.id).toBeGreaterThan(0)
      expect(t.assertionSummary!.failed + t.assertionSummary!.blocked, t.id).toBe(0)
    }
    expect(report.metrics.assertionBlockedCount).toBe(0)
    expect(report.metrics.assertionFailCount).toBe(0)
  }, 900000)
})
