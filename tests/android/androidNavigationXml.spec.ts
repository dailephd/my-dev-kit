import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectAndroidProject } from '../../src/android/detectAndroidProject.js'
import { buildAndroidGradleProject } from '../../src/android/buildAndroidGradleProject.js'
import { buildAndroidResourceProject } from '../../src/android/buildAndroidResourceProject.js'
import { buildAndroidNavigationXmlModel } from '../../src/android/buildAndroidNavigationXmlModel.js'

const tempDirs: string[] = []
function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-nav-'))
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
  mkdirSync(join(root, 'app', 'src', 'main'), { recursive: true })
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

function buildModel(root: string) {
  const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
  const { artifact: androidGradle } = buildAndroidGradleProject({ projectRoot: root, androidProject })
  const { artifact: androidResources } = buildAndroidResourceProject({ projectRoot: root, androidProject, androidGradle })
  return buildAndroidNavigationXmlModel({ projectRoot: root, androidResources }).model
}

const NS = 'xmlns:android="http://schemas.android.com/apk/res/android" xmlns:app="http://schemas.android.com/apk/res-auto" xmlns:tools="http://schemas.android.com/tools"'

describe('buildAndroidNavigationXmlModel', () => {
  it('parses a basic root graph with a fragment destination, start destination, and label', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    mkdirSync(join(root, 'app', 'src', 'main', 'res', 'navigation'), { recursive: true })
    writeFileSync(
      join(root, 'app', 'src', 'main', 'res', 'navigation', 'nav_graph.xml'),
      `<navigation ${NS} android:id="@+id/nav_graph" app:startDestination="@id/homeFragment">
        <fragment android:id="@+id/homeFragment" android:name="com.example.t.HomeFragment" android:label="Home" tools:layout="@layout/fragment_home" />
      </navigation>`
    )
    const model = buildModel(root)
    expect(model.navigationFiles).toHaveLength(1)
    expect(model.navigationFiles[0]!.parsingStatus).toBe('parsed')
    expect(model.graphs).toHaveLength(1)
    expect(model.graphs[0]!.kind).toBe('root')
    expect(model.graphs[0]!.startDestination.candidateDestinationIds).toHaveLength(1)
    expect(model.destinations).toHaveLength(1)
    expect(model.destinations[0]!).toMatchObject({ kind: 'fragment', androidName: 'com.example.t.HomeFragment' })
    expect(model.destinations[0]!.label).toEqual({ kind: 'literal', value: 'Home' })
    expect(model.destinations[0]!.toolsLayout).toMatchObject({ resourceType: 'layout', resourceName: 'fragment_home' })
  })

  it('classifies fragment, activity, dialog, and preserves unknown destination kinds conservatively', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    mkdirSync(join(root, 'app', 'src', 'main', 'res', 'navigation'), { recursive: true })
    writeFileSync(
      join(root, 'app', 'src', 'main', 'res', 'navigation', 'nav_graph.xml'),
      `<navigation ${NS} android:id="@+id/g">
        <fragment android:id="@+id/f" />
        <activity android:id="@+id/a" />
        <dialog android:id="@+id/d" />
        <customDestination android:id="@+id/c" />
      </navigation>`
    )
    const model = buildModel(root)
    const kinds = Object.fromEntries(model.destinations.map((d) => [d.rawId, d.kind]))
    expect(kinds).toEqual({ '@+id/f': 'fragment', '@+id/a': 'activity', '@+id/d': 'dialog', '@+id/c': 'custom' })
    const custom = model.destinations.find((d) => d.kind === 'custom')!
    expect(custom.warnings.some((w) => w.includes('not a recognized destination element'))).toBe(true)
  })

  it('parses actions with destination/popUpTo candidates and flags/animations, without back-stack simulation', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    mkdirSync(join(root, 'app', 'src', 'main', 'res', 'navigation'), { recursive: true })
    writeFileSync(
      join(root, 'app', 'src', 'main', 'res', 'navigation', 'nav_graph.xml'),
      `<navigation ${NS} android:id="@+id/g">
        <fragment android:id="@+id/home">
          <action android:id="@+id/act" app:destination="@id/details" app:popUpTo="@id/home"
            app:popUpToInclusive="true" app:popUpToSaveState="false" app:launchSingleTop="true" app:restoreState="false"
            app:enterAnim="@anim/slide_in" app:exitAnim="@anim/slide_out" />
        </fragment>
        <fragment android:id="@+id/details" />
      </navigation>`
    )
    const model = buildModel(root)
    expect(model.actions).toHaveLength(1)
    const action = model.actions[0]!
    expect(action.candidateDestinationIds).toHaveLength(1)
    expect(action.candidatePopUpToIds).toHaveLength(1)
    expect(action).toMatchObject({ popUpToInclusive: true, popUpToSaveState: false, launchSingleTop: true, restoreState: false })
    expect(action.anim.enterAnim).toMatchObject({ resourceType: 'anim', resourceName: 'slide_in' })
  })

  it('preserves multiple action candidates when duplicate IDs exist across nested graphs, without selecting a winner', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    mkdirSync(join(root, 'app', 'src', 'main', 'res', 'navigation'), { recursive: true })
    writeFileSync(
      join(root, 'app', 'src', 'main', 'res', 'navigation', 'nav_graph.xml'),
      `<navigation ${NS} android:id="@+id/g">
        <navigation android:id="@+id/nested1">
          <fragment android:id="@+id/shared" />
        </navigation>
        <navigation android:id="@+id/nested2">
          <fragment android:id="@+id/shared" />
        </navigation>
        <fragment android:id="@+id/home">
          <action android:id="@+id/act" app:destination="@id/shared" />
        </fragment>
      </navigation>`
    )
    const model = buildModel(root)
    expect(model.actions[0]!.candidateDestinationIds).toHaveLength(2)
  })

  it('parses arguments with types, nullability, literal defaults, and resource-reference defaults', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    mkdirSync(join(root, 'app', 'src', 'main', 'res', 'navigation'), { recursive: true })
    writeFileSync(
      join(root, 'app', 'src', 'main', 'res', 'navigation', 'nav_graph.xml'),
      `<navigation ${NS} android:id="@+id/g">
        <fragment android:id="@+id/home">
          <argument android:name="userId" app:argType="string" app:nullable="false" android:defaultValue="guest" />
          <argument android:name="theme" app:argType="reference" android:defaultValue="@color/primary" />
          <argument android:name="optional" app:argType="string" app:nullable="true" android:defaultValue="@null" />
        </fragment>
      </navigation>`
    )
    const model = buildModel(root)
    expect(model.arguments).toHaveLength(3)
    const userId = model.arguments.find((a) => a.name === 'userId')!
    expect(userId).toMatchObject({ argType: 'string', nullable: false })
    expect(userId.defaultValue).toMatchObject({ raw: 'guest', classification: 'literal' })
    const theme = model.arguments.find((a) => a.name === 'theme')!
    expect(theme.defaultValue?.classification).toBe('resource-reference')
    expect(theme.defaultValue?.reference).toMatchObject({ resourceType: 'color', resourceName: 'primary' })
    const optional = model.arguments.find((a) => a.name === 'optional')!
    expect(optional.defaultValue?.classification).toBe('null')
  })

  it('parses deep links with URI pattern, scheme/host, placeholders, action, and MIME type', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    mkdirSync(join(root, 'app', 'src', 'main', 'res', 'navigation'), { recursive: true })
    writeFileSync(
      join(root, 'app', 'src', 'main', 'res', 'navigation', 'nav_graph.xml'),
      `<navigation ${NS} android:id="@+id/g">
        <fragment android:id="@+id/home">
          <deepLink app:uri="https://example.com/items/{id}" app:mimeType="text/plain" app:autoVerify="true" />
        </fragment>
        <fragment android:id="@+id/incomplete">
          <deepLink app:action="android.intent.action.SEND" />
        </fragment>
      </navigation>`
    )
    const model = buildModel(root)
    expect(model.xmlDeepLinks).toHaveLength(2)
    const full = model.xmlDeepLinks.find((d) => d.uriPattern !== null)!
    expect(full).toMatchObject({ scheme: 'https', host: 'example.com', mimeType: 'text/plain', autoVerify: true, hasPlaceholder: true })
    const incomplete = model.xmlDeepLinks.find((d) => d.uriPattern === null)!
    expect(incomplete.warnings.some((w) => w.includes('no app:uri'))).toBe(true)
  })

  it('parses includes with candidate target resolution, missing targets, and multiple qualifier candidates', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    mkdirSync(join(root, 'app', 'src', 'main', 'res', 'navigation'), { recursive: true })
    mkdirSync(join(root, 'app', 'src', 'main', 'res', 'navigation-land'), { recursive: true })
    writeFileSync(
      join(root, 'app', 'src', 'main', 'res', 'navigation', 'nav_graph.xml'),
      `<navigation ${NS} android:id="@+id/g">
        <include app:graph="@navigation/sub_graph" />
        <include app:graph="@navigation/missing_graph" />
      </navigation>`
    )
    writeFileSync(
      join(root, 'app', 'src', 'main', 'res', 'navigation', 'sub_graph.xml'),
      `<navigation ${NS} android:id="@+id/sub" />`
    )
    writeFileSync(
      join(root, 'app', 'src', 'main', 'res', 'navigation-land', 'sub_graph.xml'),
      `<navigation ${NS} android:id="@+id/sub_land" />`
    )
    const model = buildModel(root)
    const goodInclude = model.includes.find((i) => i.rawGraphRef === '@navigation/sub_graph')!
    // Two qualifier variants of sub_graph.xml both exist as candidates — neither is selected as a winner.
    expect(goodInclude.candidateTargetGraphIds).toHaveLength(2)
    const missingInclude = model.includes.find((i) => i.rawGraphRef === '@navigation/missing_graph')!
    expect(missingInclude.candidateTargetGraphIds).toEqual([])
  })

  it('represents nested graphs with parent-child identity and their own start destination', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    mkdirSync(join(root, 'app', 'src', 'main', 'res', 'navigation'), { recursive: true })
    writeFileSync(
      join(root, 'app', 'src', 'main', 'res', 'navigation', 'nav_graph.xml'),
      `<navigation ${NS} android:id="@+id/root" app:startDestination="@id/entry">
        <navigation android:id="@+id/entry" app:startDestination="@id/inner">
          <fragment android:id="@+id/inner" />
        </navigation>
      </navigation>`
    )
    const model = buildModel(root)
    const rootGraph = model.graphs.find((g) => g.kind === 'root')!
    const nestedGraph = model.graphs.find((g) => g.kind === 'nested')!
    expect(nestedGraph.parentGraphId).toBe(rootGraph.id)
    expect(rootGraph.startDestination.candidateGraphIds).toContain(nestedGraph.id)
    expect(nestedGraph.startDestination.candidateDestinationIds).toHaveLength(1)
  })

  it('keeps multi-source-set and qualified navigation graphs with the same logical key separate', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    mkdirSync(join(root, 'app', 'src', 'main', 'res', 'navigation'), { recursive: true })
    mkdirSync(join(root, 'app', 'src', 'debug', 'res', 'navigation'), { recursive: true })
    writeFileSync(join(root, 'app', 'src', 'main', 'res', 'navigation', 'nav_graph.xml'), `<navigation ${NS} android:id="@+id/main_g" />`)
    writeFileSync(join(root, 'app', 'src', 'debug', 'res', 'navigation', 'nav_graph.xml'), `<navigation ${NS} android:id="@+id/debug_g" />`)
    const model = buildModel(root)
    expect(model.navigationFiles).toHaveLength(2)
    expect(model.navigationFiles.map((f) => f.sourceSet).sort()).toEqual(['debug', 'main'])
    expect(model.graphs.map((g) => g.rawId).sort()).toEqual(['@+id/debug_g', '@+id/main_g'])
  })

  it('does not crash on malformed navigation XML and reports a bounded parsing failure', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    mkdirSync(join(root, 'app', 'src', 'main', 'res', 'navigation'), { recursive: true })
    writeFileSync(
      join(root, 'app', 'src', 'main', 'res', 'navigation', 'nav_graph.xml'),
      `<navigation ${NS} android:id="@+id/g"><fragment android:id="@+id/f"></navigation>`
    )
    const model = buildModel(root)
    expect(model.navigationFiles[0]!.parsingStatus).toBe('malformed')
    expect(model.graphs).toEqual([])
    expect(model.warnings.length).toBeGreaterThan(0)
  })

  it('produces deterministic, byte-identical output across repeated runs against the same fixture', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    mkdirSync(join(root, 'app', 'src', 'main', 'res', 'navigation'), { recursive: true })
    writeFileSync(
      join(root, 'app', 'src', 'main', 'res', 'navigation', 'nav_graph.xml'),
      `<navigation ${NS} android:id="@+id/g" app:startDestination="@id/home"><fragment android:id="@+id/home" /></navigation>`
    )
    const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
    const { artifact: androidGradle } = buildAndroidGradleProject({ projectRoot: root, androidProject })
    const { artifact: androidResources } = buildAndroidResourceProject({ projectRoot: root, androidProject, androidGradle })
    const first = buildAndroidNavigationXmlModel({ projectRoot: root, androidResources })
    const second = buildAndroidNavigationXmlModel({ projectRoot: root, androidResources })
    expect(first.model).toEqual(second.model)
    expect(first.evidenceFingerprint).toBe(second.evidenceFingerprint)
  })
})
