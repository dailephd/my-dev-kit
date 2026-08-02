import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { detectAndroidProject } from '../../src/android/detectAndroidProject.js'
import { buildAndroidComposeSemanticProject } from '../../src/android/buildAndroidComposeSemanticProject.js'
import type { AndroidComposeSemanticArtifact } from '../../src/android/androidComposeTypes.js'

const tempDirs: string[] = []
function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-compose-facts-'))
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

function buildArtifact(root: string, kotlinFileText: string, fileName = 'Screens.kt'): AndroidComposeSemanticArtifact {
  writeFileSync(join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', fileName), kotlinFileText)
  const buildResult = buildIndex({ repoRoot: root, sourceRoots: ['app/src/main/kotlin'], buildCallGraph: false })
  const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
  return buildAndroidComposeSemanticProject({ projectRoot: root, symbolIndex: buildResult.index, androidProject }).artifact
}

function fromScratch(root: string, text: string): AndroidComposeSemanticArtifact {
  writeAppScaffold(root)
  return buildArtifact(root, text)
}

describe('buildAndroidComposeSemanticProject -- Batch 2 state facts', () => {
  // TST-101
  it('extracts remember, rememberSaveable, collectAsState, collectAsStateWithLifecycle in assignment form', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(flowA: Any, flowB: Any) {
    val a = remember { mutableStateOf(0) }
    val b = rememberSaveable { mutableStateOf(0) }
    val c = flowA.collectAsState()
    val d = flowB.collectAsStateWithLifecycle()
}
`
    )
    const kinds = artifact.stateFacts.map((f) => f.kind).sort()
    expect(kinds).toEqual(['collectAsState', 'collectAsStateWithLifecycle', 'remember', 'rememberSaveable'])
    for (const fact of artifact.stateFacts) {
      expect(fact.bindingForm).toBe('assignment')
      expect(fact.status).toBe('resolved')
    }
    expect(artifact.stateFacts.map((f) => f.variableName).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  // TST-102
  it('extracts a delegated-property state fact (val name by remember { ... })', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    val counter by remember { mutableStateOf(0) }
}
`
    )
    expect(artifact.stateFacts).toHaveLength(1)
    expect(artifact.stateFacts[0]).toMatchObject({ variableName: 'counter', bindingForm: 'delegated', kind: 'remember' })
  })

  // TST-103
  it('records multiple state facts in one composable with stable distinct ids', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    val a = remember { 1 }
    val b = remember { 2 }
}
`
    )
    expect(artifact.stateFacts).toHaveLength(2)
    const ids = artifact.stateFacts.map((f) => f.id)
    expect(new Set(ids).size).toBe(2)
  })

  // TST-104
  it('does not collide identical local variable names declared in different composables', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun ScreenA() {
    val state = remember { 1 }
}

@Composable
fun ScreenB() {
    val state = remember { 2 }
}
`
    )
    expect(artifact.stateFacts).toHaveLength(2)
    const ids = artifact.stateFacts.map((f) => f.id)
    expect(new Set(ids).size).toBe(2)
    const composableIds = new Set(artifact.stateFacts.map((f) => f.composableId))
    expect(composableIds.size).toBe(2)
  })

  // TST-105
  it('does not emit a Compose state fact for a state-like call outside any composable', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
fun plainFunction() {
    val a = remember { 1 }
}
`
    )
    expect(artifact.stateFacts).toEqual([])
  })

  // TST-106
  it('attaches a state fact only to its innermost enclosing (function-local) composable, not the outer one', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Outer() {
    @Composable
    fun Inner() {
        val x = remember { 1 }
    }
    Inner()
}
`
    )
    expect(artifact.stateFacts).toHaveLength(1)
    const inner = artifact.declarations.find((d) => d.name === 'Inner')!
    expect(artifact.stateFacts[0]!.composableId).toBe(inner.id)
  })
})

describe('buildAndroidComposeSemanticProject -- Batch 2 effect facts', () => {
  // TST-107
  it('extracts LaunchedEffect with a single literal key', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    LaunchedEffect("load") {
        doWork()
    }
}
`
    )
    expect(artifact.effectFacts).toHaveLength(1)
    const fact = artifact.effectFacts[0]!
    expect(fact.kind).toBe('LaunchedEffect')
    expect(fact.status).toBe('resolved')
    expect(fact.keys).toEqual([{ raw: '"load"', kind: 'literal' }])
  })

  // TST-108
  it('extracts LaunchedEffect with multiple keys', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(userId: String) {
    LaunchedEffect(userId, Unit) {
        doWork()
    }
}
`
    )
    expect(artifact.effectFacts).toHaveLength(1)
    expect(artifact.effectFacts[0]!.keys).toEqual([
      { raw: 'userId', kind: 'identifier' },
      { raw: 'Unit', kind: 'identifier' },
    ])
  })

  // TST-109
  it('preserves a dynamic LaunchedEffect key as unresolved raw evidence, never guessing', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(state: Any) {
    LaunchedEffect(state.value + 1) {
        doWork()
    }
}
`
    )
    expect(artifact.effectFacts).toHaveLength(1)
    const fact = artifact.effectFacts[0]!
    expect(fact.status).toBe('unresolved')
    expect(fact.keys).toEqual([])
    expect(fact.rawKeyExpression).toContain('state.value')
  })

  // TST-110
  it('extracts DisposableEffect and detects a direct onDispose block', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    DisposableEffect(Unit) {
        val listener = register()
        onDispose {
            unregister(listener)
        }
    }
}
`
    )
    expect(artifact.effectFacts).toHaveLength(1)
    const fact = artifact.effectFacts[0]!
    expect(fact.kind).toBe('DisposableEffect')
    expect(fact.hasOnDispose).toBe(true)
  })

  // TST-111
  it('records DisposableEffect without onDispose as hasOnDispose: false', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    DisposableEffect(Unit) {
        doSomething()
    }
}
`
    )
    expect(artifact.effectFacts[0]!.hasOnDispose).toBe(false)
  })

  // TST-112
  it('excludes an effect-like call outside a recognized composable', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
fun plainFunction() {
    LaunchedEffect(Unit) { doWork() }
}
`
    )
    expect(artifact.effectFacts).toEqual([])
  })
})

describe('buildAndroidComposeSemanticProject -- Batch 2 ViewModel references', () => {
  // TST-113
  it('extracts a direct viewModel() call assigned to a local variable', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    val vm = viewModel()
}
`
    )
    expect(artifact.viewModelReferences).toHaveLength(1)
    expect(artifact.viewModelReferences[0]).toMatchObject({ kind: 'viewModel-call', variableOrParameterName: 'vm' })
  })

  // TST-114
  it('extracts a direct hiltViewModel() call', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    val vm: MyViewModel = hiltViewModel()
}
`
    )
    expect(artifact.viewModelReferences).toHaveLength(1)
    expect(artifact.viewModelReferences[0]).toMatchObject({
      kind: 'hiltViewModel-call',
      variableOrParameterName: 'vm',
      typeText: 'MyViewModel',
    })
  })

  // TST-115
  it('extracts a composable parameter with a statically visible ViewModel type', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(vm: MyViewModel) {
}
`
    )
    expect(artifact.viewModelReferences).toHaveLength(1)
    expect(artifact.viewModelReferences[0]).toMatchObject({
      kind: 'parameter-type',
      variableOrParameterName: 'vm',
      typeText: 'MyViewModel',
    })
  })

  // TST-116
  it('does not classify an unrelated class merely containing similar text as a ViewModel reference', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(helper: ViewModelHelperUtils) {
    val notAViewModel = somethingElse()
}
`
    )
    expect(artifact.viewModelReferences).toEqual([])
  })
})

describe('buildAndroidComposeSemanticProject -- Batch 2 UI-marker facts', () => {
  // TST-117
  it('resolves a literal Modifier.testTag value', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    Box(modifier = Modifier.testTag("login_button")) {}
}
`
    )
    expect(artifact.testTagFacts).toHaveLength(1)
    expect(artifact.testTagFacts[0]).toMatchObject({ resolvedValue: 'login_button', status: 'resolved' })
  })

  // TST-118
  it('resolves a testTag referencing a same-file top-level string constant', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
const val LOGIN_BUTTON_TAG = "login_button"

@Composable
fun Screen() {
    Box(modifier = Modifier.testTag(LOGIN_BUTTON_TAG)) {}
}
`
    )
    expect(artifact.testTagFacts).toHaveLength(1)
    expect(artifact.testTagFacts[0]).toMatchObject({ resolvedValue: 'login_button', status: 'resolved' })
  })

  // TST-119
  it('leaves a dynamic testTag unresolved rather than guessing', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(tag: String) {
    Box(modifier = Modifier.testTag(tag)) {}
}
`
    )
    expect(artifact.testTagFacts).toHaveLength(1)
    expect(artifact.testTagFacts[0]).toMatchObject({ resolvedValue: null, status: 'unresolved' })
    expect(artifact.testTagFacts[0]!.rawExpression).toBe('tag')
  })

  // TST-120
  it('extracts direct visible text from a Text(...) call', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    Text("Welcome back")
}
`
    )
    expect(artifact.visibleTextFacts).toHaveLength(1)
    expect(artifact.visibleTextFacts[0]).toMatchObject({ callName: 'Text', text: 'Welcome back' })
  })

  // TST-121
  it('does not classify an internal string literal not passed to a supported UI call as visible text', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    val routeKey = "internal_route_key"
    log("navigating")
}
`
    )
    expect(artifact.visibleTextFacts).toEqual([])
  })

  // TST-122
  it('extracts a direct stringResource(R.string.name) reference', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    Text(stringResource(R.string.welcome_message))
}
`
    )
    expect(artifact.stringResourceFacts).toHaveLength(1)
    expect(artifact.stringResourceFacts[0]).toMatchObject({
      resourceName: 'welcome_message',
      resourceIdentifierText: 'R.string.welcome_message',
    })
  })

  // TST-123
  it('records bounded raw formatting arguments without fabricating rendered text', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(name: String) {
    Text(stringResource(R.string.greeting, name))
}
`
    )
    expect(artifact.stringResourceFacts).toHaveLength(1)
    expect(artifact.stringResourceFacts[0]!.rawFormatArguments).toEqual(['name'])
  })

  // TST-124
  it('does not resolve the underlying resource value for stringResource', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    Text(stringResource(R.string.welcome_message))
}
`
    )
    expect(artifact.stringResourceFacts[0]).not.toHaveProperty('resolvedValue')
  })
})

describe('buildAndroidComposeSemanticProject -- Batch 2 artifact and compatibility', () => {
  // TST-125
  it('preserves Batch 1 composable declaration identities alongside new facts', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    val a = remember { 1 }
    Text("hi")
}
`
    )
    expect(artifact.declarations).toHaveLength(1)
    expect(artifact.declarations[0]!.name).toBe('Screen')
    expect(artifact.stateFacts).toHaveLength(1)
    expect(artifact.visibleTextFacts).toHaveLength(1)
  })

  // TST-126
  it('summary counts equal emitted fact counts', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(vm: MyViewModel) {
    val a = remember { 1 }
    LaunchedEffect(Unit) { doWork() }
    Text("hi")
    Text(stringResource(R.string.x))
    Box(modifier = Modifier.testTag("t")) {}
}
`
    )
    expect(artifact.summary.stateFactCount).toBe(artifact.stateFacts.length)
    expect(artifact.summary.effectFactCount).toBe(artifact.effectFacts.length)
    expect(artifact.summary.viewModelReferenceCount).toBe(artifact.viewModelReferences.length)
    expect(artifact.summary.testTagFactCount).toBe(artifact.testTagFacts.length)
    expect(artifact.summary.visibleTextFactCount).toBe(artifact.visibleTextFacts.length)
    expect(artifact.summary.stringResourceFactCount).toBe(artifact.stringResourceFacts.length)
    expect(artifact.summary.warningCount).toBe(artifact.warnings.length)
  })

  // TST-127
  it('produces deterministic repeated output across two runs of byte-identical input', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const text = `package com.example
@Composable
fun Screen(vm: MyViewModel) {
    val a = remember { 1 }
    LaunchedEffect(Unit) { doWork() }
    Text("hi")
    Box(modifier = Modifier.testTag("t")) {}
}
`
    writeFileSync(join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'Screens.kt'), text)
    const buildResult = buildIndex({ repoRoot: root, sourceRoots: ['app/src/main/kotlin'], buildCallGraph: false })
    const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
    const run1 = buildAndroidComposeSemanticProject({ projectRoot: root, symbolIndex: buildResult.index, androidProject }).artifact
    const run2 = buildAndroidComposeSemanticProject({ projectRoot: root, symbolIndex: buildResult.index, androidProject }).artifact
    expect(run1.stateFacts).toEqual(run2.stateFacts)
    expect(run1.effectFacts).toEqual(run2.effectFacts)
    expect(run1.viewModelReferences).toEqual(run2.viewModelReferences)
    expect(run1.testTagFacts).toEqual(run2.testTagFacts)
    expect(run1.visibleTextFacts).toEqual(run2.visibleTextFacts)
  })

  // TST-128
  it('warning ordering is deterministic (sorted)', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(tagB: String, tagA: String) {
    Box(modifier = Modifier.testTag(tagB)) {}
    Box(modifier = Modifier.testTag(tagA)) {}
}
`
    )
    expect(artifact.warnings).toEqual([...artifact.warnings].sort())
  })

  // TST-129
  it('a non-Android project remains unaffected (no facts, not detected)', () => {
    const root = createTempRoot()
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'Foo.kt'), '@Composable\nfun Screen() { val a = remember { 1 } }\n')
    const buildResult = buildIndex({ repoRoot: root, sourceRoots: ['src'], buildCallGraph: false })
    const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
    const result = buildAndroidComposeSemanticProject({ projectRoot: root, symbolIndex: buildResult.index, androidProject })
    expect(result.artifact.detected).toBe(false)
    expect(result.artifact.stateFacts).toEqual([])
  })
})
