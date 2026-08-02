import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { detectAndroidProject } from '../../src/android/detectAndroidProject.js'
import { buildAndroidGradleProject } from '../../src/android/buildAndroidGradleProject.js'
import { buildAndroidManifestProject } from '../../src/android/buildAndroidManifestProject.js'
import { buildAndroidResourceProject } from '../../src/android/buildAndroidResourceProject.js'
import { buildAndroidNavigationProject } from '../../src/android/buildAndroidNavigationProject.js'
import { buildAndroidComposeSemanticProject } from '../../src/android/buildAndroidComposeSemanticProject.js'
import { buildAndroidArtifactRelationships } from '../../src/android/buildAndroidArtifactRelationships.js'
import type { CodeGraphNode } from '../../src/graph/codeGraphTypes.js'

const tempDirs: string[] = []
function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-compose-graph-'))
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

function buildRelationships(root: string, kotlinFiles: Record<string, string>) {
  for (const [name, text] of Object.entries(kotlinFiles)) {
    writeFileSync(join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', name), text)
  }
  const buildResult = buildIndex({ repoRoot: root, sourceRoots: ['app/src/main/kotlin'], buildCallGraph: false })
  const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
  const androidGradle = buildAndroidGradleProject({ projectRoot: root, androidProject }).artifact
  const androidManifest = buildAndroidManifestProject({ projectRoot: root, androidProject, androidGradle }).artifact
  const androidResources = buildAndroidResourceProject({ projectRoot: root, androidProject, androidGradle }).artifact
  const androidNavigation = buildAndroidNavigationProject({
    projectRoot: root,
    androidProject,
    androidGradle,
    androidResources,
    symbolIndex: buildResult.index,
  }).artifact
  const androidComposeSemantic = buildAndroidComposeSemanticProject({
    projectRoot: root,
    symbolIndex: buildResult.index,
    androidProject,
    androidNavigation,
  }).artifact
  return buildAndroidArtifactRelationships({
    projectRoot: root,
    androidProject,
    androidGradle,
    androidManifest,
    androidResources,
    androidNavigation,
    androidComposeSemantic,
    symbolIndex: buildResult.index,
  })
}

function findNode(nodes: CodeGraphNode[], predicate: (n: CodeGraphNode) => boolean): CodeGraphNode {
  const found = nodes.find(predicate)
  if (!found) throw new Error('Node not found')
  return found
}

describe('buildAndroidArtifactRelationships -- Batch 4 Compose projection', () => {
  // TST-301
  it('reuses the composable declaration id as the graph node id', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const { nodes } = buildRelationships(root, {
      'Screens.kt': `package com.example
@Composable
fun Screen() { Text("hi") }
`,
    })
    const composable = findNode(nodes, (n) => n.kind === 'android-composable')
    expect(composable.id).toBe('android-compose-declaration:app/src/main/kotlin/com/example/Screens.kt#Screen')
  })

  // TST-302
  it('reuses fact ids as fact node ids and never duplicates a Kotlin symbol node', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const { nodes, edges } = buildRelationships(root, {
      'Screens.kt': `package com.example
@Composable
fun Screen() {
    val a = remember { 1 }
    Text("hi")
}
`,
    })
    const factNodes = nodes.filter((n) => n.kind === 'android-compose-fact')
    expect(factNodes.length).toBeGreaterThan(0)
    for (const fact of factNodes) {
      expect(fact.androidEntityId).toBe(fact.id)
    }
    const symbolNodeIds = nodes.filter((n) => n.kind === 'symbol').map((n) => n.id)
    expect(new Set(symbolNodeIds).size).toBe(symbolNodeIds.length)
    // composable-has-fact edges reuse existing composable/fact ids, never invent new ones
    for (const edge of edges.filter((e) => e.kind === 'composable-has-fact')) {
      expect(nodes.some((n) => n.id === edge.source)).toBe(true)
      expect(nodes.some((n) => n.id === edge.target)).toBe(true)
    }
  })

  // TST-303
  it('links a top-level composable to its exact Kotlin function symbol via defines-composable', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const { nodes, edges } = buildRelationships(root, {
      'Screens.kt': `package com.example
@Composable
fun Screen() {}
`,
    })
    const composable = findNode(nodes, (n) => n.kind === 'android-composable')
    const edge = edges.find((e) => e.kind === 'defines-composable' && e.target === composable.id)!
    expect(edge.source).toBe('symbol:app/src/main/kotlin/com/example/Screens.kt#Screen')
    expect(edge.metadata?.matchBasis).toBe('exact-symbol')
  })

  // TST-304
  it('connects a function-local composable to the file node, never inventing a symbol', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const { nodes, edges } = buildRelationships(root, {
      'Screens.kt': `package com.example
fun Outer() {
    @Composable
    fun Inner() {}
    Inner()
}
`,
    })
    const composable = findNode(nodes, (n) => n.kind === 'android-composable' && n.label === 'Inner')
    const edge = edges.find((e) => e.kind === 'defines-composable' && e.target === composable.id)!
    expect(edge.source).toBe('file:app/src/main/kotlin/com/example/Screens.kt')
    expect(edge.metadata?.matchBasis).toBe('file')
  })

  // TST-305
  it('records a parent-to-child composable-calls-composable relationship', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const { nodes, edges } = buildRelationships(root, {
      'Screens.kt': `package com.example
@Composable
fun Parent() { Child() }

@Composable
fun Child() {}
`,
    })
    const parent = findNode(nodes, (n) => n.kind === 'android-composable' && n.label === 'Parent')
    const child = findNode(nodes, (n) => n.kind === 'android-composable' && n.label === 'Child')
    const edge = edges.find((e) => e.kind === 'composable-calls-composable')!
    expect(edge.source).toBe(parent.id)
    expect(edge.target).toBe(child.id)
  })

  // TST-306
  it('creates a composable-has-fact edge for every Batch 2/3 fact family plus UI regions', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const { nodes, edges } = buildRelationships(root, {
      'Screens.kt': `package com.example
@Composable
fun Screen(vm: SomeViewModel) {
    val a = remember { 1 }
    LaunchedEffect(Unit) { doWork() }
    Text("hi")
    Text(stringResource(R.string.x))
    Box(modifier = Modifier.testTag("t")) {}
    Button(onClick = { doThing() }) {}
    Row {}
}
`,
    })
    const factKinds = new Set(
      nodes.filter((n) => n.kind === 'android-compose-fact').map((n) => n.androidMetadata?.factKind)
    )
    expect(factKinds).toEqual(
      new Set(['state', 'effect', 'viewmodel', 'visible-text', 'string-resource', 'test-tag', 'click-handler', 'ui-region'])
    )
    const composable = findNode(nodes, (n) => n.kind === 'android-composable')
    const hasFactEdges = edges.filter((e) => e.kind === 'composable-has-fact' && e.source === composable.id)
    expect(hasFactEdges.length).toBe(nodes.filter((n) => n.kind === 'android-compose-fact').length)
  })

  // TST-307
  it('emits an exact composable-references-viewmodel edge for one resolved candidate', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const { nodes, edges } = buildRelationships(root, {
      'Screens.kt': `package com.example
@Composable
fun Screen(vm: MyViewModel) {}
`,
      'MyViewModel.kt': `package com.example
class MyViewModel
`,
    })
    const composable = findNode(nodes, (n) => n.kind === 'android-composable')
    const vmEdges = edges.filter((e) => e.kind === 'composable-references-viewmodel' && e.source === composable.id)
    expect(vmEdges).toHaveLength(1)
    expect(vmEdges[0]!.target).toBe('symbol:app/src/main/kotlin/com/example/MyViewModel.kt#MyViewModel')
    expect(vmEdges[0]!.metadata?.candidate).toBe(false)
  })

  // TST-308
  it('preserves every ambiguous ViewModel candidate rather than choosing one', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    mkdirSync(join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'other'), { recursive: true })
    writeFileSync(
      join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'other', 'DupViewModel.kt'),
      'package com.example.other\nclass DupViewModel\n'
    )
    const { nodes, edges } = buildRelationships(root, {
      'Screens.kt': `package com.example
@Composable
fun Screen(vm: DupViewModel) {}
`,
      'DupViewModel.kt': `package com.example
class DupViewModel
`,
    })
    const composable = findNode(nodes, (n) => n.kind === 'android-composable')
    const vmEdges = edges.filter((e) => e.kind === 'composable-references-viewmodel' && e.source === composable.id)
    expect(vmEdges).toHaveLength(2)
    expect(vmEdges.every((e) => e.metadata?.candidate === true)).toBe(true)
  })

  // TST-309
  it('does not emit a ViewModel edge when the reference is unresolved (no typeText)', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const { nodes, edges } = buildRelationships(root, {
      'Screens.kt': `package com.example
@Composable
fun Screen() {
    val vm = viewModel()
}
`,
    })
    const composable = findNode(nodes, (n) => n.kind === 'android-composable')
    const vmEdges = edges.filter((e) => e.kind === 'composable-references-viewmodel' && e.source === composable.id)
    expect(vmEdges).toEqual([])
  })

  // TST-310
  it('links a navigation-call fact to every exact route candidate and preserves click-to-navigation linkage', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const { nodes, edges } = buildRelationships(root, {
      'Screens.kt': `package com.example
@Composable
fun Screen(nav: Any) {
    Button(onClick = { nav.navigate("details") }) {}
}
`,
      'Nav.kt': `package com.example
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable

@Composable
fun AppNav(navController: Any) {
    NavHost(navController = navController, startDestination = "home") {
        composable("home") { Home() }
        composable("details") { Details() }
    }
}

@Composable
fun Home() {}

@Composable
fun Details() {}
`,
    })
    const clickFact = findNode(nodes, (n) => n.androidMetadata?.factKind === 'click-handler')
    const navFact = findNode(nodes, (n) => n.androidMetadata?.factKind === 'navigation-call')
    const linkEdge = edges.find((e) => e.kind === 'click-handler-contains-navigation-call')!
    expect(linkEdge.source).toBe(clickFact.id)
    expect(linkEdge.target).toBe(navFact.id)

    const targetEdges = edges.filter((e) => e.kind === 'compose-navigation-targets-route' && e.source === navFact.id)
    expect(targetEdges).toHaveLength(1)
    expect(targetEdges[0]!.metadata?.candidate).toBe(false)
  })

  // TST-311
  it('never invents a navigation target edge for an unresolved dynamic route', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const { nodes, edges } = buildRelationships(root, {
      'Screens.kt': `package com.example
@Composable
fun Screen(nav: Any, id: String) {
    Button(onClick = { nav.navigate("detail/" + id) }) {}
}
`,
    })
    const navFact = findNode(nodes, (n) => n.androidMetadata?.factKind === 'navigation-call')
    const targetEdges = edges.filter((e) => e.kind === 'compose-navigation-targets-route' && e.source === navFact.id)
    expect(targetEdges).toEqual([])
  })

  // TST-312
  it('links a string-resource fact only to exact resource-definition candidates', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    mkdirSync(join(root, 'app', 'src', 'main', 'res', 'values'), { recursive: true })
    writeFileSync(join(root, 'app', 'src', 'main', 'res', 'values', 'strings.xml'), '<resources><string name="greeting">Hi</string></resources>\n')
    const { nodes, edges } = buildRelationships(root, {
      'Screens.kt': `package com.example
@Composable
fun Screen() {
    Text(stringResource(R.string.greeting))
}
`,
    })
    const resFact = findNode(nodes, (n) => n.androidMetadata?.factKind === 'string-resource')
    const resDef = findNode(nodes, (n) => n.kind === 'android-resource-definition')
    const edge = edges.find((e) => e.kind === 'compose-string-references-resource')!
    expect(edge.source).toBe(resFact.id)
    expect(edge.target).toBe(resDef.id)
  })

  // TST-313
  it('produces deterministic node and edge ordering across two identical runs', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const kotlinFiles = {
      'Screens.kt': `package com.example
@Composable
fun Parent() { Child() }

@Composable
fun Child() {
    val a = remember { 1 }
    Text("hi")
}
`,
    }
    const run1 = buildRelationships(root, kotlinFiles)
    const run2 = buildRelationships(createTempRootReusing(root), kotlinFiles)
    expect(run1.nodes.map((n) => n.id)).toEqual(run2.nodes.map((n) => n.id))
    expect(run1.edges.map((e) => e.id)).toEqual(run2.edges.map((e) => e.id))
    expect(run1.nodes.map((n) => n.id)).toEqual([...run1.nodes.map((n) => n.id)].sort())
    expect(run1.edges.map((e) => e.id)).toEqual([...run1.edges.map((e) => e.id)].sort())
  })

  // TST-314
  it('produces no Compose graph changes for a non-Android project', () => {
    const root = createTempRoot()
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'Foo.kt'), '@Composable\nfun Screen() {}\n')
    const buildResult = buildIndex({ repoRoot: root, sourceRoots: ['src'], buildCallGraph: false })
    const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
    const androidGradle = buildAndroidGradleProject({ projectRoot: root, androidProject }).artifact
    const androidManifest = buildAndroidManifestProject({ projectRoot: root, androidProject, androidGradle }).artifact
    const androidResources = buildAndroidResourceProject({ projectRoot: root, androidProject, androidGradle }).artifact
    const androidNavigation = buildAndroidNavigationProject({
      projectRoot: root,
      androidProject,
      androidGradle,
      androidResources,
      symbolIndex: buildResult.index,
    }).artifact
    const androidComposeSemantic = buildAndroidComposeSemanticProject({
      projectRoot: root,
      symbolIndex: buildResult.index,
      androidProject,
      androidNavigation,
    }).artifact
    const result = buildAndroidArtifactRelationships({
      projectRoot: root,
      androidProject,
      androidGradle,
      androidManifest,
      androidResources,
      androidNavigation,
      androidComposeSemantic,
      symbolIndex: buildResult.index,
    })
    expect(result.nodes).toEqual([])
    expect(result.edges).toEqual([])
  })
})

function createTempRootReusing(_originalRoot: string): string {
  // Build a second identical root so buildIndex/detectAndroidProject re-read from disk independently,
  // proving determinism is a property of the input, not of in-memory object reuse.
  const root = createTempRoot()
  writeAppScaffold(root)
  return root
}
