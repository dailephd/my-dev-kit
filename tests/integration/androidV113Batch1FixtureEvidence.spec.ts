/**
 * v1.13.0 Batch 1B fixture-evidence gate over the enriched canonical combined
 * Android fixture (UserSettingsScreen, UserRepositoryTest, UserHomeScreenTest,
 * user_screen_title, UserViewModel.uiState/refreshUsers). Every assertion
 * records a relationship the current static analyzers actually produce, or an
 * explicit static boundary (a relationship they intentionally do not produce).
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

const FIXTURE_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android-retrieval', 'combined-app')
const CP = 'app/src/main/kotlin/com/example/combined/'
const HOME = `android-compose-declaration:${CP}UserHomeScreen.kt#UserHomeScreen`
const SETTINGS = `android-compose-declaration:${CP}UserSettingsScreen.kt#UserSettingsScreen`
const VM = `symbol:${CP}UserViewModel.kt#UserViewModel`
const REPO = `symbol:${CP}data/UserRepository.kt#UserRepository`
const DAO = `symbol:${CP}data/UserDao.kt#UserDao`
const ENTITY = `symbol:${CP}data/UserEntity.kt#UserEntity`

const tempDirs: string[] = []
afterAll(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

let outDir: string
let graph: { nodes: any[]; edges: any[] }

function json(result: ReturnType<typeof runCli>): any {
  return JSON.parse(result.stdout)
}
function readJson(relPath: string): any {
  return JSON.parse(readFileSync(join(outDir, relPath), 'utf8'))
}
function hasEdge(source: string, kind: string, target: string): boolean {
  return graph.edges.some((e) => e.source === source && e.kind === kind && e.target === target)
}
function search(...args: string[]): any {
  const result = runCli(['search', '--index', outDir, ...args, '--json'])
  expect(result.status).toBe(0)
  return json(result)
}

beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-v113-b1-'))
  tempDirs.push(root)
  outDir = join(root, 'out')
  const result = runCli([
    'index', '--root', FIXTURE_ROOT,
    '--src', 'app/src/main', '--src', 'app/src/debug', '--src', 'app/src/test',
    '--src', 'app/src/androidTest', '--src', 'core/src/main',
    '--out', outDir, '--json',
  ])
  expect(result.status).toBe(0)
  graph = readJson('code-graph.json')
})

describe('v1.13.0 Batch 1B: enriched combined fixture index', () => {
  it('records the five source roots and runs the Compose, resource, and test-semantic analyzers', () => {
    const manifest = readJson('manifest.json')
    expect(manifest.sourceRoots).toEqual(['app/src/main', 'app/src/debug', 'app/src/test', 'app/src/androidTest', 'core/src/main'])
    const status = (id: string) => manifest.analyzers.find((a: any) => a.id === id)?.status
    expect(status('android-compose-semantic')).toBe('complete')
    expect(status('android-resources')).toBe('complete')
    expect(status('android-test-semantic')).toBe('complete')
    expect(manifest.analyzers.every((a: any) => a.errorCount === 0)).toBe(true)
  })

  it('indexes no build-output path as a file or symbol', () => {
    const symbolIndex = readJson('symbol-index.json')
    expect(symbolIndex.files.some((f: any) => /(^|\/)build\//.test(f.path))).toBe(false)
  })
})

describe('v1.13.0 Batch 1B A01/A02: sibling Compose screens', () => {
  it('retrieves UserHomeScreen and UserSettingsScreen independently from different source paths', () => {
    const home = search('--composable', 'UserHomeScreen')
    const settings = search('--composable', 'UserSettingsScreen')
    expect(home.results.map((r: any) => r.graphNodeId)).toEqual([HOME])
    expect(settings.results.map((r: any) => r.graphNodeId)).toEqual([SETTINGS])
    expect(home.results[0].path).toBe(`${CP}UserHomeScreen.kt`)
    expect(settings.results[0].path).toBe(`${CP}UserSettingsScreen.kt`)
    expect(home.results[0].moduleId).toBe(settings.results[0].moduleId)
  })

  it('--android-role compose-ui-component returns exactly both composables', () => {
    const parsed = search('--android-role', 'compose-ui-component')
    expect(parsed.results.map((r: any) => r.id).sort()).toEqual([HOME, SETTINGS].sort())
  })

  it('source --composable returns the complete declaration', () => {
    const result = runCli(['source', '--index', outDir, '--composable', 'UserHomeScreen', '--format', 'numbered'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('fun UserHomeScreen()')
    expect(result.stdout).toContain('refresh_users_button')
  })
})

describe('v1.13.0 Batch 1B A03: test tag, click handler, ViewModel', () => {
  it('resolves the refresh_users_button tag to a fact owned by UserHomeScreen', () => {
    const parsed = search('--test-tag', 'refresh_users_button')
    expect(parsed.results).toHaveLength(1)
    expect(parsed.results[0].androidMetadata.composableId).toBe(HOME)
  })

  it('records a resolved onClick lambda fact and a tag assertion that references the composable', () => {
    const compose = readJson('android-compose-semantic.json')
    expect(compose.clickHandlerFacts).toHaveLength(1)
    expect(compose.clickHandlerFacts[0]).toMatchObject({ composableId: HOME, apiForm: 'onClick-arg', callbackForm: 'lambda', status: 'resolved' })
    expect(compose.clickHandlerFacts[0].rawCallbackSummary).toContain('viewModel.refreshUsers()')
    const tests = readJson('android-test-semantic.json')
    const tagAssertion = tests.assertionFacts.find((a: any) => a.kind === 'test-tag')
    expect(tagAssertion).toMatchObject({ resolvedValue: 'refresh_users_button', status: 'resolved' })
    expect(tagAssertion.candidateComposableIds).toEqual([HOME])
    expect(hasEdge(tagAssertion.id, 'android-test-references-composable', HOME)).toBe(true)
  })

  it('static boundary: the click-handler fact has no graph edge to a ViewModel member or state', () => {
    const clickNode = graph.nodes.find((n) => n.androidMetadata?.factKind === 'click-handler')
    expect(clickNode).toBeDefined()
    const outgoing = graph.edges.filter((e) => e.source === clickNode.id)
    expect(outgoing).toEqual([])
  })
})

describe('v1.13.0 Batch 1B A05: string resource, composable usage, test evidence', () => {
  it('finds the unique user_screen_title definition and keeps app_name qualifier ambiguity', () => {
    const unique = search('--resource', 'string/user_screen_title')
    expect(unique.results).toHaveLength(1)
    expect(unique.results[0].path).toBe('app/src/main/res/values/strings.xml')
    const qualified = search('--resource', 'string/app_name')
    expect(qualified.results).toHaveLength(2)
  })

  it('links the stringResource fact to the definition and the composable to that fact', () => {
    const fact = graph.nodes.find((n) => n.androidMetadata?.factKind === 'string-resource')
    expect(fact.androidMetadata.resourceName).toBe('user_screen_title')
    expect(hasEdge(HOME, 'composable-has-fact', fact.id)).toBe(true)
    const targetEdge = graph.edges.find((e) => e.source === fact.id && e.kind === 'compose-string-references-resource')
    expect(targetEdge).toBeDefined()
    const definition = graph.nodes.find((n) => n.id === targetEdge.target)
    expect(definition.androidMetadata).toMatchObject({ type: 'string', name: 'user_screen_title' })
    expect(hasEdge(`symbol:${CP}UserHomeScreen.kt#UserHomeScreen`, 'source-references-resource', targetEdge.target)).toBe(true)
  })

  it('static boundary: no direct resource-to-test edge; the visible-text test assertion matches no composable fact', () => {
    const tests = readJson('android-test-semantic.json')
    const textAssertion = tests.assertionFacts.find((a: any) => a.kind === 'visible-text')
    expect(textAssertion.resolvedValue).toBe('Users')
    expect(textAssertion.candidateComposableIds).toEqual([])
    const resourceEdges = graph.edges.filter((e) => e.kind.startsWith('android-test-') && /strings\.xml/.test(e.target))
    expect(resourceEdges).toEqual([])
  })
})

describe('v1.13.0 Batch 1B A06/A10: ViewModel state versus screen-local state', () => {
  it('links the collected-state fact to UserViewModel and leaves the remember fact unowned', () => {
    const compose = readJson('android-compose-semantic.json')
    const collected = compose.stateFacts.find((s: any) => s.composableId === HOME)
    expect(collected).toMatchObject({ kind: 'collectAsState', variableName: 'uiState', receiverText: 'viewModel.uiState', candidateMatchStatus: 'exact-one' })
    expect(collected.candidateViewModelSymbolIds).toEqual([VM])
    expect(hasEdge(collected.id, 'compose-state-reads-viewmodel', VM)).toBe(true)
    const local = compose.stateFacts.find((s: any) => s.composableId === SETTINGS)
    expect(local).toMatchObject({ kind: 'remember', variableName: 'notificationsEnabled', candidateMatchStatus: 'not-attempted' })
    expect(graph.edges.some((e) => e.source === local.id && e.kind === 'compose-state-reads-viewmodel')).toBe(false)
  })

  it('static boundary: ViewModel members are not symbols, so uiState is reachable only through the class source', () => {
    const symbolNames = readJson('symbol-index.json').files
      .filter((f: any) => f.path === `${CP}UserViewModel.kt`)
      .flatMap((f: any) => f.symbols.map((s: any) => s.name))
    expect(symbolNames).not.toContain('uiState')
    expect(symbolNames).not.toContain('refreshUsers')
    const result = runCli(['source', '--index', outDir, '--node', VM, '--format', 'numbered'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('val uiState: StateFlow<String>')
  })
})

describe('v1.13.0 Batch 1B A08/A12: Room chain, repository test, test source sets', () => {
  it('preserves Repository -> DAO -> Entity', () => {
    expect(hasEdge(REPO, 'repository-uses-dao', DAO)).toBe(true)
    expect(hasEdge(DAO, 'dao-uses-entity', ENTITY)).toBe(true)
  })

  it('links the repository test to UserRepository (class) but not to the DAO or Retrofit interfaces', () => {
    const doubles = readJson('android-test-semantic.json').testDoubleFacts
    const byType = Object.fromEntries(doubles.map((d: any) => [d.referencedType, d.candidateSymbolIds]))
    expect(byType.UserRepository).toEqual([REPO])
    expect(byType.UserDao).toEqual([])
    expect(byType.UserApiService).toEqual([])
    const double = doubles.find((d: any) => d.referencedType === 'UserRepository')
    expect(hasEdge(double.id, 'android-test-references-viewmodel', REPO)).toBe(true)
  })

  it('distinguishes unit and instrumented test evidence by source set', () => {
    const unit = search('--android-role', 'android-unit-test')
    const instrumented = search('--android-role', 'instrumented-test')
    expect(unit.results.length).toBeGreaterThan(0)
    expect(instrumented.results.length).toBeGreaterThan(0)
    for (const r of unit.results) expect(r.path).toContain('app/src/test/')
    for (const r of instrumented.results) expect(r.path).toContain('app/src/androidTest/')
  })
})

describe('v1.13.0 Batch 1B: previously verified evidence is preserved', () => {
  it('keeps route, ambiguity, manifest, and permission evidence', () => {
    const route = search('--android-route', 'settings')
    expect(route.results).toHaveLength(1)
    expect(search('--android-route', 'nonexistent_route').results).toEqual([])
    const ambiguous = json(runCli(['slice', '--index', outDir, '--android-route', 'compose_home', '--depth', '1', '--json']))
    expect(ambiguous.status).toBe('ambiguous')
    expect(ambiguous.candidates).toHaveLength(2)
    const component = json(runCli(['lookup', '--index', outDir, '--android-component', 'MainActivity', '--json']))
    expect(component.status).toBe('ambiguous')
    expect(search('--permission', 'com.example.combined.permission.CUSTOM_ACCESS').results).toHaveLength(1)
  })
})

describe('v1.13.0 Batch 1B: context ownership for well-specified requests', () => {
  function context(name: string, query: string): any {
    const out = join(tempDirs[0]!, `${name}.json`)
    const result = runCli(['context', '--index', outDir, '--query', query, '--out', out, '--audit-out', join(tempDirs[0]!, `${name}.audit.json`), '--json'])
    expect(result.status).toBe(0)
    return JSON.parse(readFileSync(out, 'utf8'))
  }

  it('selects the composable for a UI change and the ViewModel for a state change, without conflicts', () => {
    const ui = context('ui', 'modify UserHomeScreen composable layout')
    expect(ui.focus.focusNodeId).toBe(HOME)
    expect(ui.conflicts.status).toBe('none')
    const state = context('state', 'change UserViewModel uiState state')
    expect(state.focus.focusNodeId).toBe(VM)
    expect(state.conflicts.status).toBe('none')
  })

  it('selects the sibling screen for a screen-local change and for an add-screen request without stop words', () => {
    const local = context('local', 'change notificationsEnabled toggle UserSettingsScreen screen')
    expect(local.focus.focusNodeId).toBe(SETTINGS)
    expect(local.conflicts.status).toBe('none')
    const add = context('add', 'add new Compose screen UserProfileScreen beside UserSettingsScreen')
    expect(add.focus.focusNodeId).toBe(SETTINGS)
    expect(add.conflicts.status).toBe('none')
  })
})
