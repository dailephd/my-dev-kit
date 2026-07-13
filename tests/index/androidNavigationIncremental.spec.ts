import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, cpSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const FIXTURES_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android-navigation')
const tempDirs: string[] = []

function runCli(args: string[]) {
  return spawnSync(process.execPath, [tsxCliPath(), 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
  })
}

function tsxCliPath(): string {
  return join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
}

function copyFixture(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-android-nav-incr-${name}-`))
  tempDirs.push(root)
  cpSync(join(FIXTURES_ROOT, name), root, { recursive: true })
  return root
}

function runIndex(root: string, out: string, extra: string[] = []) {
  const result = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', out, '--json', ...extra])
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout)
}

function runIncremental(root: string, out: string) {
  return runIndex(root, out, ['--incremental'])
}

function readArtifact(root: string, out: string, filename: string) {
  return JSON.parse(readFileSync(join(root, out, filename), 'utf8'))
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('android-navigation.json manifest registration and stale cleanup', () => {
  it('a full index run generates android-navigation.json and registers it in manifest.json', () => {
    const root = copyFixture('basic-app')
    const result = runIndex(root, 'out')

    expect(result.androidNavigationPath).toBeTruthy()
    expect(existsSync(join(root, 'out', 'android-navigation.json'))).toBe(true)

    const manifest = readArtifact(root, 'out', 'manifest.json')
    const analyzer = manifest.analyzers.find((a: { id: string }) => a.id === 'android-navigation')
    expect(analyzer).toBeTruthy()
    expect(analyzer.artifacts[0].path).toBe('android-navigation.json')

    const androidNavigation = readArtifact(root, 'out', 'android-navigation.json')
    expect(androidNavigation.detected).toBe(true)
    expect(androidNavigation.destinations.length).toBeGreaterThan(0)
    expect(androidNavigation.composeRoutes.length).toBeGreaterThan(0)

    // Upstream artifacts remain correct alongside the new one.
    expect(existsSync(join(root, 'out', 'android-project.json'))).toBe(true)
    expect(existsSync(join(root, 'out', 'android-gradle.json'))).toBe(true)
    expect(existsSync(join(root, 'out', 'android-manifest.json'))).toBe(true)
    expect(existsSync(join(root, 'out', 'android-resources.json'))).toBe(true)
  })

  it('an Android module without any navigation evidence does not register a misleading artifact', () => {
    const root = copyFixture('no-navigation-app')
    const r = runCli(['index', '--root', root, '--src', 'app', '--out', 'out', '--json'])
    expect(r.status).toBe(0)
    const parsed = JSON.parse(r.stdout)

    expect(parsed.androidNavigationPath).toBeNull()
    expect(existsSync(join(root, 'out', 'android-navigation.json'))).toBe(false)
    const manifest = readArtifact(root, 'out', 'manifest.json')
    const analyzer = manifest.analyzers.find((a: { id: string }) => a.id === 'android-navigation')
    expect(analyzer?.status).toBe('skipped')
    expect(analyzer?.artifacts).toEqual([])
  })

  it('removing the only navigation XML and Compose route source removes the stale artifact', () => {
    const root = copyFixture('basic-app')
    runIndex(root, 'out')
    expect(existsSync(join(root, 'out', 'android-navigation.json'))).toBe(true)

    unlinkSync(join(root, 'app', 'src', 'main', 'res', 'navigation', 'nav_graph.xml'))
    unlinkSync(join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'navapp', 'AppNav.kt'))

    const result = runIndex(root, 'out')
    expect(result.androidNavigationPath).toBeNull()
    expect(existsSync(join(root, 'out', 'android-navigation.json'))).toBe(false)
    const manifest = readArtifact(root, 'out', 'manifest.json')
    expect(manifest.analyzers.find((a: { id: string }) => a.id === 'android-navigation')?.status).toBe('skipped')
  })

  it('a malformed navigation XML file does not crash indexing and produces a bounded analyzer warning', () => {
    const root = copyFixture('malformed-nav-app')
    const result = runIndex(root, 'out')

    expect(result.androidNavigationPath).toBeTruthy()
    const manifest = readArtifact(root, 'out', 'manifest.json')
    const analyzer = manifest.analyzers.find((a: { id: string }) => a.id === 'android-navigation')
    expect(analyzer?.status).toBe('partial')
    expect(analyzer?.warningCount).toBeGreaterThan(0)

    const androidNavigation = readArtifact(root, 'out', 'android-navigation.json')
    expect(androidNavigation.navigationFiles[0].parsingStatus).toBe('malformed')

    expect(existsSync(join(root, 'out', 'android-project.json'))).toBe(true)
    expect(existsSync(join(root, 'out', 'symbol-index.json'))).toBe(true)
  })
})

describe('android-navigation.json incremental indexing integration', () => {
  it('initial --incremental run produces android-navigation.json', () => {
    const root = copyFixture('basic-app')
    const result = runIncremental(root, 'out')

    expect(result.cache.mode).toBe('incremental-full-initial')
    expect(result.androidNavigationPath).toBeTruthy()
  })

  it('second --incremental run with no changes reuses output and keeps android-navigation.json correct', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-no-change')
    const androidNavigation = readArtifact(root, 'out', 'android-navigation.json')
    expect(androidNavigation.detected).toBe(true)
  })

  it('modifying a destination invalidates the cache and refreshes android-navigation.json', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    writeFileSync(
      join(root, 'app', 'src', 'main', 'res', 'navigation', 'nav_graph.xml'),
      `<navigation xmlns:android="http://schemas.android.com/apk/res/android" xmlns:app="http://schemas.android.com/apk/res-auto" android:id="@+id/nav_graph" app:startDestination="@id/homeFragment">
    <fragment android:id="@+id/homeFragment" android:name="com.example.navapp.HomeFragmentRenamed" />
</navigation>
`
    )

    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-full-config-changed')
    const androidNavigation = readArtifact(root, 'out', 'android-navigation.json')
    expect(androidNavigation.destinations.some((d: { androidName: string }) => d.androidName === 'com.example.navapp.HomeFragmentRenamed')).toBe(true)
  })

  it('adding a Compose route invalidates via the normal Kotlin changed-file path and refreshes the artifact', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')
    const before = readArtifact(root, 'out', 'android-navigation.json')
    const beforeCount = before.composeRoutes.length

    writeFileSync(
      join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'navapp', 'AppNav.kt'),
      `package com.example.navapp

private const val HOME_ROUTE = "home"

fun AppNavHost(navController: NavHostController) {
    NavHost(
        navController = navController,
        startDestination = HOME_ROUTE
    ) {
        composable(HOME_ROUTE) {
            HomeScreen()
        }
        composable(route = "details/{id}") {
            DetailsScreen()
        }
        composable("settings") {
            SettingsScreen()
        }
    }
}
`
    )

    const second = runIncremental(root, 'out')
    const after = readArtifact(root, 'out', 'android-navigation.json')
    expect(after.composeRoutes.length).toBeGreaterThan(beforeCount)
    void second
  })

  it('deleting the navigation XML file refreshes android-navigation.json to no longer describe it', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    unlinkSync(join(root, 'app', 'src', 'main', 'res', 'navigation', 'nav_graph.xml'))
    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-full-config-changed')
    const androidNavigation = readArtifact(root, 'out', 'android-navigation.json')
    expect(androidNavigation.navigationFiles).toEqual([])
  })

  it('--reset-cache forces a fresh full rebuild that still produces a correct android-navigation.json', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    const result = runIndex(root, 'out', ['--incremental', '--reset-cache'])

    expect(result.cache.mode).toBe('incremental-full-initial')
    const androidNavigation = readArtifact(root, 'out', 'android-navigation.json')
    expect(androidNavigation.detected).toBe(true)
  })

  it('produces equivalent android-navigation.json content between a full run and an incremental run', () => {
    const rootFull = copyFixture('basic-app')
    const rootIncremental = copyFixture('basic-app')

    runIndex(rootFull, 'out')
    runIncremental(rootIncremental, 'out')

    const normalize = (artifact: Record<string, unknown>) => ({ ...artifact, createdAt: 'NORMALIZED', projectRoot: 'NORMALIZED' })
    const fullArtifact = normalize(readArtifact(rootFull, 'out', 'android-navigation.json'))
    const incrementalArtifact = normalize(readArtifact(rootIncremental, 'out', 'android-navigation.json'))

    expect(fullArtifact).toEqual(incrementalArtifact)
  })
})
