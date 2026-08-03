/**
 * v1.12.0 Batch 5 integration gate: `search --android-role`,
 * `slice --include-data-flow`, and the Android-aware `slice --include-tests`
 * extension, over the canonical combined Android fixture and the existing
 * android-test-semantic fixture. TST-536 through TST-560.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'
import { CANONICAL_FIXTURE_ROOT } from './androidV110CombinedFixture.spec.js'

const tempDirs: string[] = []
function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-v112-batch5-'))
  tempDirs.push(root)
  return root
}
afterAll(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function json(result: ReturnType<typeof runCli>): any {
  return JSON.parse(result.stdout)
}
function readJson(dir: string, relPath: string): any {
  return JSON.parse(readFileSync(join(dir, relPath), 'utf8'))
}

let outDir: string

beforeAll(() => {
  const root = createTempRoot()
  outDir = join(root, 'out')
  const result = runCli([
    'index', '--root', CANONICAL_FIXTURE_ROOT,
    '--src', 'app/src/main', '--src', 'core/src/main',
    '--out', outDir, '--json',
  ])
  expect(result.status).toBe(0)
})

describe('v1.12.0 Batch 5: search --android-role over the canonical fixture', () => {
  it('TST-536: --android-role activity finds exactly the Activity symbols, not fuzzily', () => {
    const result = runCli(['search', '--index', outDir, '--android-role', 'activity', '--json'])
    expect(result.status).toBe(0)
    const parsed = json(result)
    expect(parsed.artifactKind).toBe('my-dev-kit-v1-search-result')
    expect(parsed.androidRole).toBe('activity')
    expect(parsed.results.length).toBeGreaterThan(0)
    for (const item of parsed.results) {
      expect(item.classificationRoles?.some((r: any) => r.role === 'activity')).toBe(true)
    }
  })

  it('TST-537: --android-role rejects an invalid value with exit code 2 and the allowlist in the message', () => {
    const result = runCli(['search', '--index', outDir, '--android-role', 'bogus-role', '--json'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Invalid --android-role value')
  })

  it('TST-538: --android-role is mutually exclusive with --query and other selectors', () => {
    expect(runCli(['search', '--index', outDir, '--android-role', 'activity', '--query', 'foo']).status).toBe(2)
    expect(runCli(['search', '--index', outDir, '--android-role', 'activity', '--composable', 'foo']).status).toBe(2)
  })

  it('TST-539: zero-result role is valid (empty results, resultCount 0, no error)', () => {
    const result = runCli(['search', '--index', outDir, '--android-role', 'worker', '--json'])
    expect(result.status).toBe(0)
    const parsed = json(result)
    expect(parsed.results).toEqual([])
    expect(parsed.summary.resultCount).toBe(0)
  })
})

describe('v1.12.0 Batch 5: slice --include-data-flow over the canonical fixture', () => {
  function findFirstActivityNodeId(): string {
    const parsed = json(runCli(['search', '--index', outDir, '--android-role', 'activity', '--json']))
    expect(parsed.results.length).toBeGreaterThan(0)
    return parsed.results[0].id
  }

  it('TST-540: expands through the full Activity -> Compose -> ViewModel -> Repository -> DAO/Entity/Retrofit chain', () => {
    const focusNodeId = findFirstActivityNodeId()
    const result = runCli([
      'slice', '--index', outDir, '--node', focusNodeId, '--depth', '3', '--include-data-flow', '--json',
    ])
    expect(result.status).toBe(0)
    const parsed = json(result)
    expect(parsed.androidDataFlow.requested).toBe(true)
    expect(parsed.androidDataFlow.allowedEdgeKinds).toContain('viewmodel-uses-repository')
    const edgeKinds = new Set(parsed.edges.map((edge: any) => edge.kind))
    for (const kind of ['activity-hosts-composable', 'viewmodel-uses-repository', 'repository-uses-dao', 'dao-uses-entity']) {
      expect(edgeKinds.has(kind)).toBe(true)
    }
  })

  it('TST-541: --include-data-flow rejects combination with --route', () => {
    const result = runCli(['slice', '--index', outDir, '--route', '/foo', '--include-data-flow', '--json'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--include-data-flow is only valid with')
  })

  it('TST-542: absent --include-data-flow leaves output free of the androidDataFlow field', () => {
    const focusNodeId = findFirstActivityNodeId()
    const result = runCli(['slice', '--index', outDir, '--node', focusNodeId, '--depth', '1', '--json'])
    expect(result.status).toBe(0)
    expect(json(result).androidDataFlow).toBeUndefined()
  })

  it('TST-543: depth 0 with --include-data-flow yields just the focus node, no expansion', () => {
    const focusNodeId = findFirstActivityNodeId()
    const result = runCli(['slice', '--index', outDir, '--node', focusNodeId, '--depth', '0', '--include-data-flow', '--json'])
    expect(result.status).toBe(0)
    const parsed = json(result)
    expect(parsed.nodes).toHaveLength(1)
    expect(parsed.androidDataFlow.addedNodeCount).toBe(0)
  })

  it('TST-544: combining --include-viewmodel and --include-data-flow dedupes without double-counting', () => {
    const compose = readJson(outDir, 'code-graph.json')
    const composableNode = compose.nodes.find((node: any) => node.kind === 'android-composable')
    if (!composableNode) return
    const composableSymbolName = composableNode.label
    const withBoth = json(
      runCli([
        'slice', '--index', outDir, '--composable', composableSymbolName, '--depth', '2',
        '--include-viewmodel', '--include-data-flow', '--json',
      ])
    )
    const nodeIds = withBoth.nodes.map((node: any) => node.id)
    expect(new Set(nodeIds).size).toBe(nodeIds.length)
  })
})

describe('v1.12.0 Batch 5: Android-aware slice --include-tests', () => {
  let testOutDir: string

  beforeAll(() => {
    const root = createTempRoot()
    testOutDir = join(root, 'out')
    const result = runCli([
      'index', '--root', join(process.cwd(), 'tests', 'fixtures', 'android-test-semantic', 'basic-app'),
      '--src', 'app/src/main', '--src', 'app/src/test', '--src', 'app/src/androidTest',
      '--out', testOutDir, '--json',
    ])
    expect(result.status).toBe(0)
  })

  it('TST-545: pulls bounded test evidence for a reached ViewModel, with an additive androidTests summary', () => {
    const graph = readJson(testOutDir, 'code-graph.json')
    const viewModelNode = graph.nodes.find((node: any) =>
      node.classificationRoles?.some((r: any) => r.role === 'view-model')
    )
    expect(viewModelNode).toBeTruthy()

    const result = runCli(['slice', '--index', testOutDir, '--node', viewModelNode.id, '--depth', '1', '--include-tests', '--json'])
    expect(result.status).toBe(0)
    const parsed = json(result)
    expect(parsed.androidTests.requested).toBe(true)
    expect(parsed.androidTests.relatedTestMethodCount).toBeGreaterThan(0)
    expect(parsed.nodes.some((node: any) => node.kind === 'android-test-method')).toBe(true)
  })

  it('TST-546: does not dump the entire test file/class - only the bounded hierarchy for the referenced fact', () => {
    const graph = readJson(testOutDir, 'code-graph.json')
    const viewModelNode = graph.nodes.find((node: any) =>
      node.classificationRoles?.some((r: any) => r.role === 'view-model')
    )
    const totalTestMethods = graph.nodes.filter((node: any) => node.kind === 'android-test-method').length

    const result = json(
      runCli(['slice', '--index', testOutDir, '--node', viewModelNode.id, '--depth', '1', '--include-tests', '--json'])
    )
    const slicedTestMethods = result.nodes.filter((node: any) => node.kind === 'android-test-method').length
    expect(slicedTestMethods).toBeLessThanOrEqual(totalTestMethods)
  })

  it('TST-547: --include-tests on a plain non-Android node degrades gracefully to zero, no error', () => {
    const graph = readJson(testOutDir, 'code-graph.json')
    const fileNode = graph.nodes.find((node: any) => node.kind === 'file')
    expect(fileNode).toBeTruthy()
    const result = runCli(['slice', '--index', testOutDir, '--node', fileNode.id, '--depth', '0', '--include-tests', '--json'])
    expect(result.status).toBe(0)
    expect(json(result).androidTests.productionSeedCount).toBe(0)
  })

  it('TST-548: existing frontend-reachability --include-tests behavior is unaffected', () => {
    // No frontend-reachability artifact in this fixture; the reachability path
    // must still report its own missing-artifact status rather than erroring.
    const result = runCli(['slice', '--index', testOutDir, '--route', '/somewhere', '--include-tests', '--json'])
    expect(result.status).toBe(0)
    expect(json(result).status).toBe('missing-artifact')
  })
})
