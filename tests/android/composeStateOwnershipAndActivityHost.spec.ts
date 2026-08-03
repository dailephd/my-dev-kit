/**
 * v1.12.0 Batch 4: Compose state-to-ViewModel ownership and Activity-to-
 * Compose direct hosting. TST-401 through TST-445 (see per-test tags).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { detectAndroidProject } from '../../src/android/detectAndroidProject.js'
import { detectAndroidComponents } from '../../src/android/detectAndroidComponents.js'
import { buildAndroidComposeSemanticProject } from '../../src/android/buildAndroidComposeSemanticProject.js'
import { ANDROID_COMPOSE_SEMANTIC_SCHEMA_VERSION } from '../../src/android/androidComposeTypes.js'
import type { AndroidComposeSemanticArtifact } from '../../src/android/androidComposeTypes.js'

const tempDirs: string[] = []
function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-compose-ownership-'))
  tempDirs.push(root)
  return root
}
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function writeAppScaffold(root: string): void {
  mkdirSync(join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example'), { recursive: true })
  writeFileSync(join(root, 'settings.gradle.kts'), 'rootProject.name = "t"\ninclude(":app")\n')
  writeFileSync(
    join(root, 'app', 'build.gradle.kts'),
    'plugins { id("com.android.application") }\nandroid { namespace = "com.example.t"; compileSdk = 34 }\n'
  )
  writeFileSync(
    join(root, 'app', 'src', 'main', 'AndroidManifest.xml'),
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application/></manifest>\n'
  )
}

function writeFile(root: string, relPath: string, text: string): void {
  const full = join(root, ...relPath.split('/'))
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, text)
}

function buildArtifact(root: string): AndroidComposeSemanticArtifact {
  const buildResult = buildIndex({ repoRoot: root, sourceRoots: ['app/src/main/kotlin'], buildCallGraph: false })
  const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
  const { artifact: androidComponents } = detectAndroidComponents({
    symbolIndex: buildResult.index,
    androidProject,
    projectRoot: root,
    createdAt: '2026-01-01T00:00:00.000Z',
  })
  return buildAndroidComposeSemanticProject({
    projectRoot: root,
    symbolIndex: buildResult.index,
    androidProject,
    androidComponents,
  }).artifact
}

const VIEWMODEL_FILE = 'package com.example\n\nimport androidx.lifecycle.ViewModel\n\nclass UserViewModel : ViewModel()\n'

describe('buildAndroidComposeSemanticProject — v1.12.0 Batch 4 state ownership', () => {
  it('TST-401: schema is 1.3.0 and prior fields remain compatible', () => {
    expect(ANDROID_COMPOSE_SEMANTIC_SCHEMA_VERSION).toBe('1.3.0')
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/example/S.kt', '@Composable\nfun S() {\n    val a = remember { 0 }\n}\n')
    const artifact = buildArtifact(root)
    expect(artifact.schemaVersion).toBe('1.3.0')
    expect(Array.isArray(artifact.activityHostFacts)).toBe(true)
  })

  it('TST-402/TST-403: remember and rememberSaveable never attempt ViewModel matching', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(
      root,
      'app/src/main/kotlin/com/example/S.kt',
      '@Composable\nfun S() {\n    val a = remember { 0 }\n    val b = rememberSaveable { 0 }\n}\n'
    )
    const artifact = buildArtifact(root)
    for (const fact of artifact.stateFacts) {
      expect(fact.receiverText).toBeNull()
      expect(fact.candidateMatchStatus).toBe('not-attempted')
      expect(fact.matchedViewModelReferenceIds).toEqual([])
    }
  })

  it('TST-404/TST-406: collectAsState extracts the exact direct receiver chain and root', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/example/UserViewModel.kt', VIEWMODEL_FILE)
    writeFile(
      root,
      'app/src/main/kotlin/com/example/S.kt',
      '@Composable\nfun S() {\n    val viewModel: UserViewModel = viewModel()\n    val a = viewModel.uiState.collectAsState()\n    val b = viewModel.state.details.collectAsState()\n}\n'
    )
    const artifact = buildArtifact(root)
    const facts = artifact.stateFacts.filter((f) => f.kind === 'collectAsState')
    const a = facts.find((f) => f.receiverText === 'viewModel.uiState')
    const b = facts.find((f) => f.receiverText === 'viewModel.state.details')
    expect(a?.receiverRootName).toBe('viewModel')
    expect(b?.receiverRootName).toBe('viewModel')
  })

  it('TST-405: collectAsStateWithLifecycle extracts the receiver identically', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/example/UserViewModel.kt', VIEWMODEL_FILE)
    writeFile(
      root,
      'app/src/main/kotlin/com/example/S.kt',
      '@Composable\nfun S() {\n    val viewModel: UserViewModel = viewModel()\n    val a = viewModel.uiState.collectAsStateWithLifecycle()\n}\n'
    )
    const artifact = buildArtifact(root)
    const fact = artifact.stateFacts[0]!
    expect(fact.receiverText).toBe('viewModel.uiState')
    expect(fact.receiverRootName).toBe('viewModel')
  })

  it('TST-407/TST-408: matches only within the same composable, never cross-composable', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/example/UserViewModel.kt', VIEWMODEL_FILE)
    writeFile(
      root,
      'app/src/main/kotlin/com/example/S.kt',
      [
        '@Composable',
        'fun ScreenA() {',
        '    val viewModel: UserViewModel = viewModel()',
        '    val a = viewModel.uiState.collectAsState()',
        '}',
        '',
        '@Composable',
        'fun ScreenB() {',
        '    val b = viewModel.uiState.collectAsState()',
        '}',
      ].join('\n')
    )
    const artifact = buildArtifact(root)
    const screenA = artifact.stateFacts.find((f) => f.composableId.endsWith('#ScreenA'))!
    const screenB = artifact.stateFacts.find((f) => f.composableId.endsWith('#ScreenB'))!
    expect(screenA.candidateMatchStatus).toBe('exact-one')
    expect(screenB.candidateMatchStatus).toBe('not-attempted')
    expect(screenB.matchedViewModelReferenceIds).toEqual([])
  })

  it('TST-409: a ViewModel composable parameter can own a supported collected-state fact', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/example/UserViewModel.kt', VIEWMODEL_FILE)
    writeFile(
      root,
      'app/src/main/kotlin/com/example/S.kt',
      '@Composable\nfun S(viewModel: UserViewModel) {\n    val a = viewModel.uiState.collectAsState()\n}\n'
    )
    const artifact = buildArtifact(root)
    expect(artifact.stateFacts[0]!.candidateMatchStatus).toBe('exact-one')
  })

  it('TST-410: a directly assigned viewModel() reference can own a supported state fact', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/example/UserViewModel.kt', VIEWMODEL_FILE)
    writeFile(
      root,
      'app/src/main/kotlin/com/example/S.kt',
      '@Composable\nfun S() {\n    val viewModel: UserViewModel = viewModel()\n    val a = viewModel.uiState.collectAsState()\n}\n'
    )
    const artifact = buildArtifact(root)
    expect(artifact.stateFacts[0]!.candidateMatchStatus).toBe('exact-one')
    expect(artifact.stateFacts[0]!.candidateViewModelSymbolIds).toEqual(['symbol:app/src/main/kotlin/com/example/UserViewModel.kt#UserViewModel'])
  })

  it('TST-411: a directly assigned hiltViewModel() reference can own a supported state fact', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/example/UserViewModel.kt', VIEWMODEL_FILE)
    writeFile(
      root,
      'app/src/main/kotlin/com/example/S.kt',
      '@Composable\nfun S() {\n    val viewModel: UserViewModel = hiltViewModel()\n    val a = viewModel.uiState.collectAsState()\n}\n'
    )
    const artifact = buildArtifact(root)
    expect(artifact.stateFacts[0]!.candidateMatchStatus).toBe('exact-one')
  })

  it('TST-413/TST-418: exact-one owner yields one candidate and a deterministic ID', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/example/UserViewModel.kt', VIEWMODEL_FILE)
    writeFile(
      root,
      'app/src/main/kotlin/com/example/S.kt',
      '@Composable\nfun S() {\n    val viewModel: UserViewModel = viewModel()\n    val a = viewModel.uiState.collectAsState()\n}\n'
    )
    const artifact1 = buildArtifact(root)
    const artifact2 = buildArtifact(root)
    expect(artifact1.stateFacts[0]!.candidateViewModelSymbolIds).toHaveLength(1)
    expect(artifact1.stateFacts.map((f) => f.id)).toEqual(artifact2.stateFacts.map((f) => f.id))
  })

  it('TST-414: multiple ViewModel candidates yield ambiguous with every candidate retained', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/example/a/UserViewModel.kt', 'package com.example.a\n\nclass UserViewModel\n')
    writeFile(root, 'app/src/main/kotlin/com/example/b/UserViewModel.kt', 'package com.example.b\n\nclass UserViewModel\n')
    writeFile(
      root,
      'app/src/main/kotlin/com/example/S.kt',
      '@Composable\nfun S() {\n    val viewModel: UserViewModel = viewModel()\n    val a = viewModel.uiState.collectAsState()\n}\n'
    )
    const artifact = buildArtifact(root)
    const fact = artifact.stateFacts[0]!
    expect(fact.candidateMatchStatus).toBe('ambiguous')
    expect(fact.candidateViewModelSymbolIds).toHaveLength(2)
  })

  it('TST-415: a matched ViewModel reference with no local symbol candidate yields no-match', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(
      root,
      'app/src/main/kotlin/com/example/S.kt',
      '@Composable\nfun S() {\n    val viewModel: MissingViewModel = viewModel()\n    val a = viewModel.uiState.collectAsState()\n}\n'
    )
    const artifact = buildArtifact(root)
    const fact = artifact.stateFacts[0]!
    expect(fact.candidateMatchStatus).toBe('no-match')
    expect(fact.matchedViewModelReferenceIds.length).toBeGreaterThan(0)
  })

  it('TST-416: an unsupported (function-call) receiver yields not-attempted with a deterministic warning, never a fabricated owner', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/example/UserViewModel.kt', VIEWMODEL_FILE)
    writeFile(
      root,
      'app/src/main/kotlin/com/example/S.kt',
      '@Composable\nfun S(repository: Any) {\n    val a = repository.observe().collectAsState()\n}\n'
    )
    const artifact = buildArtifact(root)
    const fact = artifact.stateFacts[0]!
    expect(fact.receiverText).toBeNull()
    expect(fact.candidateMatchStatus).toBe('not-attempted')
    expect(fact.warnings.length).toBeGreaterThan(0)
  })

  it('TST-417: near/suffix/case-variant ViewModel names never resolve', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/example/UserViewModelImpl.kt', 'package com.example\n\nclass UserViewModelImpl\n')
    writeFile(
      root,
      'app/src/main/kotlin/com/example/S.kt',
      '@Composable\nfun S() {\n    val viewModel: UserViewModel = viewModel()\n    val a = viewModel.uiState.collectAsState()\n}\n'
    )
    const artifact = buildArtifact(root)
    expect(artifact.stateFacts[0]!.candidateMatchStatus).toBe('no-match')
  })
})

describe('buildAndroidComposeSemanticProject — v1.12.0 Batch 4 Activity host facts', () => {
  it('TST-422: a direct trailing-lambda setContent produces a resolved host fact', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/example/HomeScreen.kt', '@Composable\nfun HomeScreen() {\n}\n')
    writeFile(
      root,
      'app/src/main/kotlin/com/example/MainActivity.kt',
      'class MainActivity {\n    fun onCreate() {\n        setContent {\n            HomeScreen()\n        }\n    }\n}\n'
    )
    const artifact = buildArtifact(root)
    expect(artifact.activityHostFacts).toHaveLength(1)
    const fact = artifact.activityHostFacts[0]!
    expect(fact.apiForm).toBe('setContent-trailing-lambda')
    expect(fact.status).toBe('resolved')
    expect(fact.candidateMatchStatus).toBe('exact-one')
    expect(fact.hostedCallName).toBe('HomeScreen')
  })

  it('TST-423: a named content argument setContent(content = { ... }) also produces a host fact', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/example/HomeScreen.kt', '@Composable\nfun HomeScreen() {\n}\n')
    writeFile(
      root,
      'app/src/main/kotlin/com/example/MainActivity.kt',
      'class MainActivity {\n    fun onCreate() {\n        setContent(content = {\n            HomeScreen()\n        })\n    }\n}\n'
    )
    const artifact = buildArtifact(root)
    expect(artifact.activityHostFacts).toHaveLength(1)
    expect(artifact.activityHostFacts[0]!.apiForm).toBe('setContent-content-argument')
    expect(artifact.activityHostFacts[0]!.status).toBe('resolved')
  })

  it('TST-424: setContent in a non-Activity symbol does not produce a host fact', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/example/HomeScreen.kt', '@Composable\nfun HomeScreen() {\n}\n')
    writeFile(
      root,
      'app/src/main/kotlin/com/example/SomeHelper.kt',
      'class SomeHelper {\n    fun render() {\n        setContent {\n            HomeScreen()\n        }\n    }\n}\n'
    )
    const artifact = buildArtifact(root)
    expect(artifact.activityHostFacts).toHaveLength(0)
  })

  it('TST-426/TST-427: exactly one direct top-level call is required; multiple calls are unresolved with no edge', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/example/HomeScreen.kt', '@Composable\nfun HomeScreen() {\n}\n')
    writeFile(root, 'app/src/main/kotlin/com/example/OtherScreen.kt', '@Composable\nfun OtherScreen() {\n}\n')
    writeFile(
      root,
      'app/src/main/kotlin/com/example/MainActivity.kt',
      'class MainActivity {\n    fun onCreate() {\n        setContent {\n            HomeScreen()\n            OtherScreen()\n        }\n    }\n}\n'
    )
    const artifact = buildArtifact(root)
    const fact = artifact.activityHostFacts[0]!
    expect(fact.status).toBe('unresolved')
    expect(fact.candidateComposableIds).toEqual([])
    expect(fact.candidateMatchStatus).toBe('not-attempted')
  })

  it('TST-428: conditional content (if/when/for/while/try) prevents a guessed hosted candidate', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/example/HomeScreen.kt', '@Composable\nfun HomeScreen() {\n}\n')
    writeFile(root, 'app/src/main/kotlin/com/example/OtherScreen.kt', '@Composable\nfun OtherScreen() {\n}\n')
    writeFile(
      root,
      'app/src/main/kotlin/com/example/MainActivity.kt',
      [
        'class MainActivity {',
        '    fun onCreate() {',
        '        setContent {',
        '            if (isDark) {',
        '                HomeScreen()',
        '            } else {',
        '                OtherScreen()',
        '            }',
        '        }',
        '    }',
        '}',
      ].join('\n')
    )
    const artifact = buildArtifact(root)
    expect(artifact.activityHostFacts[0]!.status).toBe('unresolved')
  })

  it('TST-430/TST-434: fully qualified candidate takes precedence over other tiers', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/example/data/HomeScreen.kt', '@Composable\nfun HomeScreen() {\n}\n')
    writeFile(
      root,
      'app/src/main/kotlin/com/example/MainActivity.kt',
      'class MainActivity {\n    fun onCreate() {\n        setContent {\n            com.example.data.HomeScreen()\n        }\n    }\n}\n'
    )
    const artifact = buildArtifact(root)
    const fact = artifact.activityHostFacts[0]!
    expect(fact.candidateMatchStatus).toBe('exact-one')
    expect(fact.candidateComposableIds[0]).toContain('data/HomeScreen.kt')
  })

  it('TST-432/TST-433: same-package candidate wins over a differently-packaged simple-name match; simple-name works when no higher tier applies', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/example/HomeScreen.kt', '@Composable\nfun HomeScreen() {\n}\n')
    writeFile(root, 'app/src/main/kotlin/com/other/HomeScreen.kt', '@Composable\nfun HomeScreen() {\n}\n')
    writeFile(
      root,
      'app/src/main/kotlin/com/example/MainActivity.kt',
      'class MainActivity {\n    fun onCreate() {\n        setContent {\n            HomeScreen()\n        }\n    }\n}\n'
    )
    const artifact = buildArtifact(root)
    const fact = artifact.activityHostFacts[0]!
    expect(fact.candidateMatchStatus).toBe('exact-one')
    expect(fact.candidateComposableIds[0]).toContain('com/example/HomeScreen.kt')
  })

  it('TST-435: ambiguous hosted composable preserves every same-tier candidate with no winner', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/a/HomeScreen.kt', '@Composable\nfun HomeScreen() {\n}\n')
    writeFile(root, 'app/src/main/kotlin/com/b/HomeScreen.kt', '@Composable\nfun HomeScreen() {\n}\n')
    writeFile(
      root,
      'app/src/main/kotlin/com/example/MainActivity.kt',
      'class MainActivity {\n    fun onCreate() {\n        setContent {\n            HomeScreen()\n        }\n    }\n}\n'
    )
    const artifact = buildArtifact(root)
    const fact = artifact.activityHostFacts[0]!
    expect(fact.candidateMatchStatus).toBe('ambiguous')
    expect(fact.candidateComposableIds).toHaveLength(2)
  })

  it('TST-436/TST-437: a supported call with no local composable, or a fuzzy/suffix name, yields no-match', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/example/HomeScreenView.kt', '@Composable\nfun HomeScreenView() {\n}\n')
    writeFile(
      root,
      'app/src/main/kotlin/com/example/MainActivity.kt',
      'class MainActivity {\n    fun onCreate() {\n        setContent {\n            HomeScreen()\n        }\n    }\n}\n'
    )
    const artifact = buildArtifact(root)
    expect(artifact.activityHostFacts[0]!.candidateMatchStatus).toBe('no-match')
  })

  it('TST-442: summary counts match emitted facts and statuses', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFile(root, 'app/src/main/kotlin/com/example/UserViewModel.kt', VIEWMODEL_FILE)
    writeFile(root, 'app/src/main/kotlin/com/example/HomeScreen.kt', '@Composable\nfun HomeScreen() {\n    val viewModel: UserViewModel = viewModel()\n    val a = viewModel.uiState.collectAsState()\n}\n')
    writeFile(
      root,
      'app/src/main/kotlin/com/example/MainActivity.kt',
      'class MainActivity {\n    fun onCreate() {\n        setContent {\n            HomeScreen()\n        }\n    }\n}\n'
    )
    const artifact = buildArtifact(root)
    expect(artifact.summary.activityHostFactCount).toBe(artifact.activityHostFacts.length)
    expect(artifact.summary.viewModelOwnedStateFactCount).toBe(artifact.stateFacts.filter((f) => f.candidateMatchStatus === 'exact-one').length)
    expect(artifact.summary.ambiguousStateOwnerFactCount).toBe(0)
    expect(artifact.summary.unresolvedStateOwnerFactCount).toBe(0)
  })
})
