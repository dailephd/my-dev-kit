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
import { buildAndroidArtifactRelationships } from '../../src/android/buildAndroidArtifactRelationships.js'
import type { CodeGraphEdge, CodeGraphEdgeKind } from '../../src/graph/codeGraphTypes.js'

const tempDirs: string[] = []
function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-rel-'))
  tempDirs.push(root)
  return root
}
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function write(root: string, relPath: string, content: string): void {
  const full = join(root, ...relPath.split('/'))
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

function buildRelationships(root: string, sourceRoots: string[] = ['app/src/main/kotlin']) {
  const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
  const { artifact: androidGradle } = buildAndroidGradleProject({ projectRoot: root, androidProject })
  const { artifact: androidManifest } = buildAndroidManifestProject({ projectRoot: root, androidProject, androidGradle })
  const { artifact: androidResources } = buildAndroidResourceProject({ projectRoot: root, androidProject, androidGradle })
  const buildResult = buildIndex({ repoRoot: root, sourceRoots, buildCallGraph: false })
  const { artifact: androidNavigation } = buildAndroidNavigationProject({
    projectRoot: root,
    androidProject,
    androidGradle,
    androidResources,
    symbolIndex: buildResult.index,
  })
  return buildAndroidArtifactRelationships({
    projectRoot: root,
    androidProject,
    androidGradle,
    androidManifest,
    androidResources,
    androidNavigation,
    symbolIndex: buildResult.index,
  })
}

function edgesOfKind(edges: CodeGraphEdge[], kind: CodeGraphEdgeKind): CodeGraphEdge[] {
  return edges.filter((e) => e.kind === kind)
}

function scaffold(root: string, namespace = 'com.example'): void {
  write(root, 'settings.gradle.kts', 'rootProject.name = "t"\ninclude(":app")\n')
  write(
    root,
    'app/build.gradle.kts',
    `plugins {\n    id("com.android.application")\n}\n\nandroid {\n    namespace = "${namespace}"\n    compileSdk = 34\n}\n`
  )
}

describe('buildAndroidArtifactRelationships — module/source-set', () => {
  it('creates module-contains-source-set edges for every detected source set', () => {
    const root = createTempRoot()
    scaffold(root)
    write(root, 'app/src/main/AndroidManifest.xml', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application/></manifest>\n')
    write(root, 'app/src/debug/AndroidManifest.xml', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:debuggable="true" /></manifest>\n')
    write(root, 'app/src/main/kotlin/com/example/X.kt', 'package com.example\nclass X\n')
    write(root, 'app/src/debug/kotlin/com/example/Dbg.kt', 'package com.example\nclass Dbg\n')

    const result = buildRelationships(root, ['app/src/main/kotlin', 'app/src/debug/kotlin'])
    const edges = edgesOfKind(result.edges, 'module-contains-source-set')
    const sourceSets = edges.map((e) => e.target).sort()
    expect(sourceSets).toContain('android-source-set:android-module:app#main')
    expect(sourceSets).toContain('android-source-set:android-module:app#debug')
    expect(result.nodes.some((n) => n.kind === 'android-module' && n.id === 'android-module:app')).toBe(true)
  })
})

describe('buildAndroidArtifactRelationships — manifest components', () => {
  it('creates manifest-declares-component and exact manifest-component-resolves-to-source edges', () => {
    const root = createTempRoot()
    scaffold(root)
    write(
      root,
      'app/src/main/AndroidManifest.xml',
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
        <application>
          <activity android:name="com.example.MainActivity" />
          <service android:name=".SyncService" />
          <receiver android:name="MissingReceiver" />
        </application>
      </manifest>`
    )
    write(root, 'app/src/main/kotlin/com/example/MainActivity.kt', 'package com.example\nclass MainActivity\n')
    write(root, 'app/src/main/kotlin/com/example/SyncService.kt', 'package com.example\nclass SyncService\n')

    const result = buildRelationships(root)
    const declares = edgesOfKind(result.edges, 'manifest-declares-component')
    expect(declares).toHaveLength(3)

    const resolves = edgesOfKind(result.edges, 'manifest-component-resolves-to-source')
    expect(resolves).toHaveLength(2)
    expect(resolves.some((e) => e.target === 'symbol:app/src/main/kotlin/com/example/MainActivity.kt#MainActivity')).toBe(true)
    expect(resolves.some((e) => e.target === 'symbol:app/src/main/kotlin/com/example/SyncService.kt#SyncService')).toBe(true)
    // "MissingReceiver" has no source class anywhere — no invented relationship.
    expect(resolves.some((e) => e.source.includes('MissingReceiver'))).toBe(false)
  })

  it('resolves an activity-alias through its exact targetActivity', () => {
    const root = createTempRoot()
    scaffold(root)
    write(
      root,
      'app/src/main/AndroidManifest.xml',
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
        <application>
          <activity android:name="com.example.MainActivity" />
          <activity-alias android:name=".AliasActivity" android:targetActivity="com.example.MainActivity" />
        </application>
      </manifest>`
    )
    write(root, 'app/src/main/kotlin/com/example/MainActivity.kt', 'package com.example\nclass MainActivity\n')

    const result = buildRelationships(root)
    const aliasComponent = result.nodes.find((n) => n.androidMetadata?.componentKind === 'activity-alias')!
    const resolves = edgesOfKind(result.edges, 'manifest-component-resolves-to-source').filter((e) => e.source === aliasComponent.id)
    expect(resolves).toHaveLength(1)
    expect(resolves[0]!.metadata?.viaTargetActivity).toBe(true)
  })

  it('preserves all exact candidates when duplicate classes exist, and never fuzzy-matches by simple name', () => {
    const root = createTempRoot()
    scaffold(root)
    write(
      root,
      'app/src/main/AndroidManifest.xml',
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
        <application><activity android:name="com.example.MainActivity" /></application>
      </manifest>`
    )
    // Two files declaring the same fully-qualified class name is unusual but must still preserve both candidates.
    write(root, 'app/src/main/kotlin/com/example/MainActivity.kt', 'package com.example\nclass MainActivity\n')
    write(root, 'app/src/main/kotlin/com/example/MainActivityDup.kt', 'package com.example\nclass MainActivity\n')
    // A same-named class in a different package must never match.
    write(root, 'app/src/main/kotlin/com/other/MainActivity.kt', 'package com.other\nclass MainActivity\n')

    const result = buildRelationships(root)
    const resolves = edgesOfKind(result.edges, 'manifest-component-resolves-to-source')
    expect(resolves).toHaveLength(2)
    expect(resolves.every((e) => e.target.startsWith('symbol:app/src/main/kotlin/com/example/'))).toBe(true)
    expect(resolves.some((e) => e.target.includes('com/other'))).toBe(false)
  })
})

describe('buildAndroidArtifactRelationships — intent filters and permissions', () => {
  it('creates component-has-intent-filter edges, one per filter, independently', () => {
    const root = createTempRoot()
    scaffold(root)
    write(
      root,
      'app/src/main/AndroidManifest.xml',
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
        <application>
          <activity android:name=".MainActivity">
            <intent-filter>
              <action android:name="android.intent.action.MAIN" />
              <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
            <intent-filter>
              <action android:name="android.intent.action.VIEW" />
              <category android:name="android.intent.category.BROWSABLE" />
              <data android:scheme="https" android:host="example.com" />
            </intent-filter>
          </activity>
        </application>
      </manifest>`
    )
    const result = buildRelationships(root)
    expect(edgesOfKind(result.edges, 'component-has-intent-filter')).toHaveLength(2)
  })

  it('creates component-uses-permission edges for local declared permissions and external permission references', () => {
    const root = createTempRoot()
    scaffold(root)
    write(
      root,
      'app/src/main/AndroidManifest.xml',
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
        <application>
          <provider android:name=".AppProvider" android:authorities="x" android:readPermission="com.example.LOCAL_PERM" android:writePermission="android.permission.INTERNET" />
        </application>
        <permission android:name="com.example.LOCAL_PERM" android:protectionLevel="signature" />
      </manifest>`
    )
    const result = buildRelationships(root)
    const edges = edgesOfKind(result.edges, 'component-uses-permission')
    expect(edges).toHaveLength(2)
    const local = edges.find((e) => e.metadata?.permission === 'com.example.LOCAL_PERM')!
    expect(local.metadata?.local).toBe(true)
    expect(local.target).toContain('android-manifest-declared-permission')
    const external = edges.find((e) => e.metadata?.permission === 'android.permission.INTERNET')!
    expect(external.metadata?.local).toBe(false)
    expect(external.target).toBe('android-permission-ref:android.permission.INTERNET')
    // No security/grant claim is encoded anywhere in the edge metadata.
    expect(JSON.stringify(edges)).not.toMatch(/granted|enforced|secure|vulnerable/i)
  })
})

describe('buildAndroidArtifactRelationships — resources', () => {
  it('creates resource-defined-in-file edges and exact source-references-resource edges, ignoring comments and strings', () => {
    const root = createTempRoot()
    scaffold(root)
    write(root, 'app/src/main/AndroidManifest.xml', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application/></manifest>\n')
    write(root, 'app/src/main/res/values/strings.xml', '<resources><string name="app_name">Test</string></resources>\n')
    write(root, 'app/src/main/res/layout/activity_main.xml', '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" />\n')
    write(
      root,
      'app/src/main/kotlin/com/example/MainActivity.kt',
      `package com.example

class MainActivity {
    // R.string.fake_comment_ref is not real
    fun setup() {
        val label = "R.string.fake_in_string_ref"
        val real = R.string.app_name
        val layout = R.layout.activity_main
        val missing = R.string.does_not_exist
    }
}
`
    )
    const result = buildRelationships(root)
    const defEdges = edgesOfKind(result.edges, 'resource-defined-in-file')
    expect(defEdges.length).toBeGreaterThanOrEqual(2)

    const refEdges = edgesOfKind(result.edges, 'source-references-resource')
    expect(refEdges).toHaveLength(2)
    expect(refEdges.every((e) => e.source === 'symbol:app/src/main/kotlin/com/example/MainActivity.kt#MainActivity')).toBe(true)
    expect(refEdges.some((e) => e.metadata?.resourceName === 'app_name')).toBe(true)
    expect(refEdges.some((e) => e.metadata?.resourceName === 'activity_main')).toBe(true)
    // "fake_comment_ref" and "fake_in_string_ref" and "does_not_exist" never produce edges.
    expect(refEdges.some((e) => e.metadata?.resourceName === 'fake_comment_ref')).toBe(false)
    expect(refEdges.some((e) => e.metadata?.resourceName === 'fake_in_string_ref')).toBe(false)
    expect(refEdges.some((e) => e.metadata?.resourceName === 'does_not_exist')).toBe(false)
  })

  it('skips android.R.* framework references without inventing a local target', () => {
    const root = createTempRoot()
    scaffold(root)
    write(root, 'app/src/main/AndroidManifest.xml', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application/></manifest>\n')
    write(
      root,
      'app/src/main/kotlin/com/example/X.kt',
      'package com.example\nclass X {\n    fun f() { val v = android.R.id.content }\n}\n'
    )
    const result = buildRelationships(root)
    expect(edgesOfKind(result.edges, 'source-references-resource')).toEqual([])
  })

  it('preserves duplicate local resource candidates across qualifiers rather than selecting a winner', () => {
    const root = createTempRoot()
    scaffold(root)
    write(root, 'app/src/main/AndroidManifest.xml', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application/></manifest>\n')
    write(root, 'app/src/main/res/values/strings.xml', '<resources><string name="app_name">Default</string></resources>\n')
    write(root, 'app/src/main/res/values-es/strings.xml', '<resources><string name="app_name">Localizado</string></resources>\n')
    write(root, 'app/src/main/kotlin/com/example/X.kt', 'package com.example\nclass X {\n    fun f() { val v = R.string.app_name }\n}\n')

    const result = buildRelationships(root)
    const refEdges = edgesOfKind(result.edges, 'source-references-resource')
    expect(refEdges).toHaveLength(2)
    expect(refEdges.every((e) => e.metadata?.candidate === true)).toBe(true)
  })
})

describe('buildAndroidArtifactRelationships — navigation graphs', () => {
  it('creates graph/destination/action relationships with candidate target enumeration', () => {
    const root = createTempRoot()
    scaffold(root)
    write(root, 'app/src/main/AndroidManifest.xml', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application/></manifest>\n')
    write(
      root,
      'app/src/main/res/navigation/nav_graph.xml',
      `<navigation xmlns:android="http://schemas.android.com/apk/res/android" xmlns:app="http://schemas.android.com/apk/res-auto" android:id="@+id/g" app:startDestination="@id/home">
        <fragment android:id="@+id/home" android:name="com.example.HomeFragment">
          <action android:id="@+id/act" app:destination="@id/details" app:popUpTo="@id/home" />
        </fragment>
        <fragment android:id="@+id/details" android:name="com.example.DetailsFragment" />
      </navigation>`
    )
    write(root, 'app/src/main/kotlin/com/example/HomeFragment.kt', 'package com.example\nclass HomeFragment\n')
    write(root, 'app/src/main/kotlin/com/example/DetailsFragment.kt', 'package com.example\nclass DetailsFragment\n')

    const result = buildRelationships(root)
    expect(edgesOfKind(result.edges, 'navigation-graph-contains-destination')).toHaveLength(2)
    expect(edgesOfKind(result.edges, 'navigation-destination-has-action')).toHaveLength(1)
    expect(edgesOfKind(result.edges, 'navigation-action-targets-destination')).toHaveLength(1)
    expect(edgesOfKind(result.edges, 'navigation-action-pop-up-to-destination')).toHaveLength(1)

    const resolves = edgesOfKind(result.edges, 'navigation-destination-resolves-to-screen')
    expect(resolves).toHaveLength(2)
  })

  it('creates navigation-graph-includes-graph edges with all candidates preserved', () => {
    const root = createTempRoot()
    scaffold(root)
    write(root, 'app/src/main/AndroidManifest.xml', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application/></manifest>\n')
    write(
      root,
      'app/src/main/res/navigation/nav_graph.xml',
      `<navigation xmlns:android="http://schemas.android.com/apk/res/android" xmlns:app="http://schemas.android.com/apk/res-auto" android:id="@+id/g">
        <include app:graph="@navigation/sub" />
      </navigation>`
    )
    write(root, 'app/src/main/res/navigation/sub.xml', `<navigation xmlns:android="http://schemas.android.com/apk/res/android" android:id="@+id/sub" />`)

    const result = buildRelationships(root)
    expect(edgesOfKind(result.edges, 'navigation-graph-includes-graph')).toHaveLength(1)
  })
})

describe('buildAndroidArtifactRelationships — Compose routes', () => {
  it('creates compose-route-resolves-to-screen only for an unambiguous direct screen candidate whose symbol exists', () => {
    const root = createTempRoot()
    scaffold(root)
    write(root, 'app/src/main/AndroidManifest.xml', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application/></manifest>\n')
    write(
      root,
      'app/src/main/kotlin/com/example/Nav.kt',
      `package com.example

fun AppNav() {
    NavHost(navController = nc, startDestination = "home") {
        composable("home") { HomeScreen() }
        composable("chooser") {
            if (cond) { FirstScreen() } else { SecondScreen() }
        }
    }
}

fun HomeScreen() {}
`
    )
    const result = buildRelationships(root)
    const routeEdges = edgesOfKind(result.edges, 'compose-route-resolves-to-screen')
    expect(routeEdges).toHaveLength(1)
    expect(routeEdges[0]!.target).toBe('symbol:app/src/main/kotlin/com/example/Nav.kt#HomeScreen')
    // The ambiguous "chooser" route must not produce an invented screen relationship.
    const chooserRoute = result.nodes.find((n) => n.androidMetadata?.resolvedRoute === 'chooser')!
    expect(routeEdges.some((e) => e.source === chooserRoute.id)).toBe(false)
  })
})

describe('buildAndroidArtifactRelationships — deep-link matching', () => {
  it('matches an exact manifest/navigation deep link and rejects a placeholder-based one', () => {
    const root = createTempRoot()
    scaffold(root)
    write(
      root,
      'app/src/main/AndroidManifest.xml',
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
        <application>
          <activity android:name=".MainActivity">
            <intent-filter android:autoVerify="true">
              <action android:name="android.intent.action.VIEW" />
              <category android:name="android.intent.category.BROWSABLE" />
              <data android:scheme="https" android:host="example.com" android:path="/articles" />
            </intent-filter>
          </activity>
        </application>
      </manifest>`
    )
    write(
      root,
      'app/src/main/res/navigation/nav_graph.xml',
      `<navigation xmlns:android="http://schemas.android.com/apk/res/android" xmlns:app="http://schemas.android.com/apk/res-auto" android:id="@+id/g">
        <fragment android:id="@+id/exact">
          <deepLink app:uri="https://example.com/articles" />
        </fragment>
        <fragment android:id="@+id/placeholder">
          <deepLink app:uri="https://example.com/{id}" />
        </fragment>
      </navigation>`
    )
    const result = buildRelationships(root)
    const matches = edgesOfKind(result.edges, 'manifest-deep-link-matches-navigation-deep-link')
    expect(matches).toHaveLength(1)
    expect(matches[0]!.target).toContain('exact')
  })
})

describe('buildAndroidArtifactRelationships — determinism and compactness', () => {
  it('produces deterministic, byte-identical output across repeated runs against the same fixture', () => {
    const root = createTempRoot()
    scaffold(root)
    write(
      root,
      'app/src/main/AndroidManifest.xml',
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><activity android:name=".MainActivity" /></application></manifest>\n'
    )
    write(root, 'app/src/main/kotlin/com/example/MainActivity.kt', 'package com.example\nclass MainActivity\n')

    const first = buildRelationships(root)
    const second = buildRelationships(root)
    expect(first).toEqual(second)
  })

  it('produces no Android nodes or edges for a non-Android project', () => {
    const root = createTempRoot()
    write(root, 'settings.gradle.kts', 'rootProject.name = "t"\ninclude(":lib")\n')
    write(root, 'lib/build.gradle.kts', 'plugins { id("java-library") }\n')
    write(root, 'lib/src/main/kotlin/Foo.kt', 'class Foo\n')

    const result = buildRelationships(root, ['lib/src/main/kotlin'])
    expect(result.nodes).toEqual([])
    expect(result.edges).toEqual([])
  })

  it('does not duplicate full manifest/resource/navigation records into the relationship nodes (compact metadata only)', () => {
    const root = createTempRoot()
    scaffold(root)
    write(
      root,
      'app/src/main/AndroidManifest.xml',
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><activity android:name=".MainActivity" android:label="Home" android:theme="@style/AppTheme" /></application></manifest>\n'
    )
    write(root, 'app/src/main/kotlin/com/example/MainActivity.kt', 'package com.example\nclass MainActivity\n')

    const result = buildRelationships(root)
    const componentNode = result.nodes.find((n) => n.kind === 'android-manifest-component')!
    // Compact metadata only — no full attribute dump (theme/label full values aren't copied in).
    expect(Object.keys(componentNode.androidMetadata ?? {}).sort()).toEqual(
      ['componentKind', 'exported', 'exportedExplicit', 'rawName', 'resolvedName'].sort()
    )
  })
})
