import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { detectAndroidProject } from '../../src/android/detectAndroidProject.js'
import { buildAndroidComposeSemanticProject } from '../../src/android/buildAndroidComposeSemanticProject.js'
import type { AndroidComposeSemanticArtifact } from '../../src/android/androidComposeTypes.js'
import {
  ANDROID_NAVIGATION_ARTIFACT_KIND,
  ANDROID_NAVIGATION_SCHEMA_VERSION,
  type AndroidComposeRoute,
  type AndroidNavigationArtifact,
  type AndroidNavigationDestination,
} from '../../src/android/androidNavigationTypes.js'

const tempDirs: string[] = []
function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-compose-click-nav-'))
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

function fakeComposeRoute(overrides: Partial<AndroidComposeRoute>): AndroidComposeRoute {
  return {
    id: 'android-navigation-compose-route:fake#0',
    evidenceKind: 'string-route',
    builder: 'composable',
    rawRouteExpression: null,
    resolvedRoute: null,
    typeRouteName: null,
    moduleId: null,
    sourceSet: null,
    file: 'app/src/main/kotlin/com/example/Nav.kt',
    enclosingSymbol: null,
    source: { file: 'app/src/main/kotlin/com/example/Nav.kt', line: 1, column: 1 },
    screenCandidateIds: [],
    warnings: [],
    ...overrides,
  }
}

function fakeDestination(overrides: Partial<AndroidNavigationDestination>): AndroidNavigationDestination {
  return {
    id: 'android-navigation-destination:fake#0',
    kind: 'fragment',
    rawElementName: 'fragment',
    rawId: null,
    logicalKey: null,
    androidName: null,
    resolvedClassName: null,
    route: null,
    label: null,
    toolsLayout: null,
    parentGraphId: 'android-navigation-graph:fake#0',
    argumentIds: [],
    actionIds: [],
    deepLinkIds: [],
    nestedGraphId: null,
    moduleId: 'android-module:app',
    sourceSet: 'main',
    qualifiers: {
      raw: [],
      locale: null,
      nightMode: null,
      apiLevel: null,
      density: null,
      orientation: null,
      smallestWidthDp: null,
      widthDp: null,
      heightDp: null,
      unrecognized: [],
    },
    file: 'app/src/main/res/navigation/nav.xml',
    source: { file: 'app/src/main/res/navigation/nav.xml', line: 1, column: 1 },
    warnings: [],
    ...overrides,
  }
}

function fakeNavigationArtifact(routes: AndroidComposeRoute[], destinations: AndroidNavigationDestination[] = []): AndroidNavigationArtifact {
  return {
    artifactKind: ANDROID_NAVIGATION_ARTIFACT_KIND,
    schemaVersion: ANDROID_NAVIGATION_SCHEMA_VERSION,
    createdAt: '2026-01-01T00:00:00.000Z',
    projectRoot: '/fake',
    detected: true,
    filesExamined: [],
    navigationFiles: [],
    graphs: [],
    destinations,
    actions: [],
    arguments: [],
    xmlDeepLinks: [],
    includes: [],
    composeRoutes: routes,
    screenCandidates: [],
    warnings: [],
    summary: {
      moduleCount: 0,
      sourceSetCount: 0,
      xmlGraphCount: 0,
      nestedGraphCount: 0,
      destinationCount: destinations.length,
      actionCount: 0,
      argumentCount: 0,
      xmlDeepLinkCount: 0,
      includeCount: 0,
      composeRouteCount: routes.length,
      screenCandidateCount: 0,
      warningCount: 0,
    },
  }
}

function buildArtifact(
  root: string,
  kotlinFileText: string,
  androidNavigation?: AndroidNavigationArtifact,
  fileName = 'Screens.kt'
): AndroidComposeSemanticArtifact {
  writeFileSync(join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', fileName), kotlinFileText)
  const buildResult = buildIndex({ repoRoot: root, sourceRoots: ['app/src/main/kotlin'], buildCallGraph: false })
  const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
  return buildAndroidComposeSemanticProject({
    projectRoot: root,
    symbolIndex: buildResult.index,
    androidProject,
    androidNavigation,
  }).artifact
}

function fromScratch(root: string, text: string, androidNavigation?: AndroidNavigationArtifact): AndroidComposeSemanticArtifact {
  writeAppScaffold(root)
  return buildArtifact(root, text, androidNavigation)
}

describe('buildAndroidComposeSemanticProject -- Batch 3 click-handler facts', () => {
  // TST-201
  it('extracts Modifier.clickable { ... } as a trailing-lambda click handler', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    Box(modifier = Modifier.clickable { doSomething() }) {}
}
`
    )
    expect(artifact.clickHandlerFacts).toHaveLength(1)
    expect(artifact.clickHandlerFacts[0]).toMatchObject({ apiForm: 'clickable-trailing-lambda', callbackForm: 'lambda', status: 'resolved' })
  })

  // TST-202
  it('extracts Modifier.clickable(onClick = { ... })', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    Box(modifier = Modifier.clickable(onClick = { doSomething() })) {}
}
`
    )
    expect(artifact.clickHandlerFacts).toHaveLength(1)
    expect(artifact.clickHandlerFacts[0]).toMatchObject({ apiForm: 'clickable-onClick-arg', callbackForm: 'lambda' })
  })

  // TST-203
  it('extracts a direct call argument onClick = { ... }', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    Button(onClick = { submit() }) {
        Text("Go")
    }
}
`
    )
    expect(artifact.clickHandlerFacts).toHaveLength(1)
    expect(artifact.clickHandlerFacts[0]).toMatchObject({ apiForm: 'onClick-arg', callbackForm: 'lambda' })
  })

  // TST-204
  it('extracts a function-reference callback onClick = ::submit', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    Button(onClick = ::submit) {
        Text("Go")
    }
}
`
    )
    expect(artifact.clickHandlerFacts).toHaveLength(1)
    expect(artifact.clickHandlerFacts[0]).toMatchObject({ callbackForm: 'function-reference', handlerName: 'submit', status: 'resolved' })
  })

  // TST-205
  it('extracts a callback identifier onClick = submit', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    Button(onClick = submit) {
        Text("Go")
    }
}
`
    )
    expect(artifact.clickHandlerFacts).toHaveLength(1)
    expect(artifact.clickHandlerFacts[0]).toMatchObject({ callbackForm: 'identifier', handlerName: 'submit', status: 'resolved' })
  })

  // TST-206
  it('leaves an unsupported/dynamic callback expression unresolved rather than guessing', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    Button(onClick = handlers.get(index)) {
        Text("Go")
    }
}
`
    )
    expect(artifact.clickHandlerFacts).toHaveLength(1)
    expect(artifact.clickHandlerFacts[0]).toMatchObject({ callbackForm: 'unresolved', status: 'unresolved' })
  })

  // TST-207
  it('does not emit a click-handler fact for an unrelated local variable named onClick', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    val onClick = "not a callback"
    Text(onClick)
}
`
    )
    expect(artifact.clickHandlerFacts).toEqual([])
  })

  // TST-208
  it('does not emit a click-handler fact for a lambda outside any recognized composable', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
fun plainFunction() {
    Button(onClick = { doSomething() }) {}
}
`
    )
    expect(artifact.clickHandlerFacts).toEqual([])
  })

  // TST-209
  it('attaches a nested composable click handler only to the nested composable', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Outer() {
    @Composable
    fun Inner() {
        Button(onClick = { doSomething() }) {}
    }
    Inner()
}
`
    )
    expect(artifact.clickHandlerFacts).toHaveLength(1)
    const inner = artifact.declarations.find((d) => d.name === 'Inner')!
    expect(artifact.clickHandlerFacts[0]!.composableId).toBe(inner.id)
  })

  // TST-210
  it('gives multiple click handlers in one composable stable distinct IDs', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen() {
    Button(onClick = { a() }) {}
    Button(onClick = { b() }) {}
}
`
    )
    expect(artifact.clickHandlerFacts).toHaveLength(2)
    const ids = artifact.clickHandlerFacts.map((f) => f.id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('buildAndroidComposeSemanticProject -- Batch 3 navigation-call facts', () => {
  // TST-211
  it('extracts a direct literal route navigate("home")', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(nav: Any) {
    Button(onClick = { nav.navigate("home") }) {}
}
`
    )
    expect(artifact.navigationCallFacts).toHaveLength(1)
    expect(artifact.navigationCallFacts[0]).toMatchObject({
      routeClassification: 'string-route',
      resolvedRoute: 'home',
      status: 'resolved',
      receiverText: 'nav',
    })
  })

  // TST-212
  it('resolves navigate(SOME_CONST) via a same-file static route constant', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
const val HOME_ROUTE = "home"

@Composable
fun Screen(nav: Any) {
    Button(onClick = { nav.navigate(HOME_ROUTE) }) {}
}
`
    )
    expect(artifact.navigationCallFacts).toHaveLength(1)
    expect(artifact.navigationCallFacts[0]).toMatchObject({
      routeClassification: 'resolved-local-constant-route',
      resolvedRoute: 'home',
      status: 'resolved',
    })
  })

  // TST-213
  it('classifies a supported type-route form when it matches a known typeRouteName', () => {
    const root = createTempRoot()
    const nav = fakeNavigationArtifact([fakeComposeRoute({ id: 'android-navigation-compose-route:x#0', evidenceKind: 'type-safe-route', typeRouteName: 'HomeRoute', resolvedRoute: null })])
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(nav: Any) {
    Button(onClick = { nav.navigate(HomeRoute) }) {}
}
`,
      nav
    )
    expect(artifact.navigationCallFacts).toHaveLength(1)
    expect(artifact.navigationCallFacts[0]).toMatchObject({
      routeClassification: 'type-safe-route',
      typeRouteName: 'HomeRoute',
      candidateMatchStatus: 'exact-one',
      candidateIds: ['android-navigation-compose-route:x#0'],
    })
  })

  // TST-214
  it('leaves a dynamic route expression unresolved rather than guessing', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(nav: Any, id: String) {
    Button(onClick = { nav.navigate("detail/" + id) }) {}
}
`
    )
    expect(artifact.navigationCallFacts).toHaveLength(1)
    expect(artifact.navigationCallFacts[0]).toMatchObject({ routeClassification: 'unresolved-recognized-call', status: 'unresolved', candidateMatchStatus: 'not-attempted' })
  })

  // TST-215
  it('does not guess a cross-file unresolved route constant', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(nav: Any) {
    Button(onClick = { nav.navigate(SomeOtherFile.ROUTE) }) {}
}
`
    )
    expect(artifact.navigationCallFacts).toHaveLength(1)
    expect(artifact.navigationCallFacts[0]!.status).toBe('unresolved')
    expect(artifact.navigationCallFacts[0]!.resolvedRoute).toBeNull()
  })

  // TST-216
  it('reports no-match when zero exact navigation candidates exist', () => {
    const root = createTempRoot()
    const nav = fakeNavigationArtifact([fakeComposeRoute({ id: 'r1', resolvedRoute: 'settings' })])
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(nav: Any) {
    Button(onClick = { nav.navigate("home") }) {}
}
`,
      nav
    )
    expect(artifact.navigationCallFacts[0]).toMatchObject({ candidateMatchStatus: 'no-match', candidateIds: [] })
  })

  // TST-217
  it('records exactly one candidate when exactly one route matches', () => {
    const root = createTempRoot()
    const nav = fakeNavigationArtifact([fakeComposeRoute({ id: 'r1', resolvedRoute: 'home' })])
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(nav: Any) {
    Button(onClick = { nav.navigate("home") }) {}
}
`,
      nav
    )
    expect(artifact.navigationCallFacts[0]).toMatchObject({ candidateMatchStatus: 'exact-one', candidateIds: ['r1'] })
  })

  // TST-218
  it('preserves every candidate and marks ambiguous when multiple exact candidates match', () => {
    const root = createTempRoot()
    const nav = fakeNavigationArtifact([
      fakeComposeRoute({ id: 'r1', resolvedRoute: 'home' }),
      fakeComposeRoute({ id: 'r2', resolvedRoute: 'home' }),
    ])
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(nav: Any) {
    Button(onClick = { nav.navigate("home") }) {}
}
`,
      nav
    )
    expect(artifact.navigationCallFacts[0]).toMatchObject({ candidateMatchStatus: 'ambiguous', candidateIds: ['r1', 'r2'] })
  })

  // TST-219
  it('excludes a navigate(...) call outside any recognized composable', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
fun plainFunction(nav: Any) {
    nav.navigate("home")
}
`
    )
    expect(artifact.navigationCallFacts).toEqual([])
  })

  // TST-220
  it('preserves deterministic order across multiple navigation calls', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(nav: Any) {
    Button(onClick = { nav.navigate("a") }) {}
    Button(onClick = { nav.navigate("b") }) {}
}
`
    )
    expect(artifact.navigationCallFacts.map((f) => f.resolvedRoute)).toEqual(['a', 'b'])
    expect(artifact.navigationCallFacts.map((f) => f.id)).toEqual([...artifact.navigationCallFacts.map((f) => f.id)].sort())
  })
})

describe('buildAndroidComposeSemanticProject -- Batch 3 click-to-navigation linkage', () => {
  // TST-221
  it('links a direct navigate(...) inside a click lambda to the click-handler fact', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(nav: Any) {
    Button(onClick = { nav.navigate("home") }) {}
}
`
    )
    expect(artifact.clickHandlerFacts).toHaveLength(1)
    expect(artifact.navigationCallFacts).toHaveLength(1)
    expect(artifact.navigationCallFacts[0]!.clickHandlerId).toBe(artifact.clickHandlerFacts[0]!.id)
    expect(artifact.clickHandlerFacts[0]!.navigationCallIds).toEqual([artifact.navigationCallFacts[0]!.id])
  })

  // TST-222
  it('does not link a navigation call elsewhere in the same composable to an unrelated click handler', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(nav: Any) {
    Button(onClick = { doSomethingElse() }) {}
    nav.navigate("home")
}
`
    )
    expect(artifact.clickHandlerFacts).toHaveLength(1)
    expect(artifact.navigationCallFacts).toHaveLength(1)
    expect(artifact.navigationCallFacts[0]!.clickHandlerId).toBeNull()
    expect(artifact.clickHandlerFacts[0]!.navigationCallIds).toEqual([])
  })

  // TST-223
  it('preserves every link when one click callback contains multiple navigation calls', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(nav: Any) {
    Button(onClick = {
        log("clicked")
        nav.navigate("a")
        nav.navigate("b")
    }) {}
}
`
    )
    expect(artifact.navigationCallFacts).toHaveLength(2)
    expect(artifact.clickHandlerFacts).toHaveLength(1)
    expect(artifact.clickHandlerFacts[0]!.navigationCallIds).toEqual(artifact.navigationCallFacts.map((f) => f.id).sort())
    for (const navFact of artifact.navigationCallFacts) {
      expect(navFact.clickHandlerId).toBe(artifact.clickHandlerFacts[0]!.id)
    }
  })
})

describe('buildAndroidComposeSemanticProject -- Batch 3 existing-behavior preservation', () => {
  // TST-224
  it('preserves Batch 1/2 facts alongside the new Batch 3 collections', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(nav: Any) {
    val a = remember { 1 }
    Text("hi")
    Button(onClick = { nav.navigate("home") }) {}
}
`
    )
    expect(artifact.declarations).toHaveLength(1)
    expect(artifact.stateFacts).toHaveLength(1)
    expect(artifact.visibleTextFacts).toHaveLength(1)
    expect(artifact.clickHandlerFacts).toHaveLength(1)
    expect(artifact.navigationCallFacts).toHaveLength(1)
  })

  // TST-225
  it('summary counts equal emitted fact counts for the new categories', () => {
    const root = createTempRoot()
    const artifact = fromScratch(
      root,
      `package com.example
@Composable
fun Screen(nav: Any) {
    Button(onClick = { nav.navigate("home") }) {}
    Box(modifier = Modifier.clickable { other() }) {}
}
`
    )
    expect(artifact.summary.clickHandlerFactCount).toBe(artifact.clickHandlerFacts.length)
    expect(artifact.summary.navigationCallFactCount).toBe(artifact.navigationCallFacts.length)
    expect(artifact.summary.warningCount).toBe(artifact.warnings.length)
  })

  // TST-226
  it('produces deterministic repeated output across two runs of byte-identical input', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const nav = fakeNavigationArtifact([fakeComposeRoute({ id: 'r1', resolvedRoute: 'home' })])
    const text = `package com.example
@Composable
fun Screen(nav: Any) {
    Button(onClick = { nav.navigate("home") }) {}
}
`
    writeFileSync(join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'Screens.kt'), text)
    const buildResult = buildIndex({ repoRoot: root, sourceRoots: ['app/src/main/kotlin'], buildCallGraph: false })
    const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
    const run1 = buildAndroidComposeSemanticProject({ projectRoot: root, symbolIndex: buildResult.index, androidProject, androidNavigation: nav }).artifact
    const run2 = buildAndroidComposeSemanticProject({ projectRoot: root, symbolIndex: buildResult.index, androidProject, androidNavigation: nav }).artifact
    expect(run1.clickHandlerFacts).toEqual(run2.clickHandlerFacts)
    expect(run1.navigationCallFacts).toEqual(run2.navigationCallFacts)
  })

  // TST-227
  it('does not affect a non-Android project', () => {
    const root = createTempRoot()
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'Foo.kt'), '@Composable\nfun Screen() { Button(onClick = { nav.navigate("home") }) {} }\n')
    const buildResult = buildIndex({ repoRoot: root, sourceRoots: ['src'], buildCallGraph: false })
    const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
    const result = buildAndroidComposeSemanticProject({ projectRoot: root, symbolIndex: buildResult.index, androidProject })
    expect(result.artifact.detected).toBe(false)
    expect(result.artifact.clickHandlerFacts).toEqual([])
    expect(result.artifact.navigationCallFacts).toEqual([])
  })
})
