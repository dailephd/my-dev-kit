import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { detectAndroidProject } from '../../src/android/detectAndroidProject.js'
import { buildComposeNavigationRoutes } from '../../src/android/buildComposeNavigationRoutes.js'

const tempDirs: string[] = []
function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-compose-nav-'))
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

function buildRoutes(root: string) {
  const buildResult = buildIndex({ repoRoot: root, sourceRoots: ['app/src/main/kotlin'], buildCallGraph: false })
  const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
  return buildComposeNavigationRoutes({ projectRoot: root, symbolIndex: buildResult.index, androidProject })
}

describe('buildComposeNavigationRoutes', () => {
  it('extracts static string routes from composable/dialog calls and a NavHost start destination', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFileSync(
      join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'Nav.kt'),
      `package com.example
fun AppNav(navController: NavHostController) {
    NavHost(navController = navController, startDestination = "home") {
        composable("home") { HomeScreen() }
        dialog("confirm") { ConfirmDialog() }
    }
}
`
    )
    const result = buildRoutes(root)
    expect(result.routes).toHaveLength(3)
    const home = result.routes.find((r) => r.builder === 'composable')!
    expect(home).toMatchObject({ evidenceKind: 'string-route', resolvedRoute: 'home' })
    const dialogRoute = result.routes.find((r) => r.builder === 'dialog')!
    expect(dialogRoute).toMatchObject({ evidenceKind: 'string-route', resolvedRoute: 'confirm' })
    const navHost = result.routes.find((r) => r.builder === 'nav-host-start-destination')!
    expect(navHost).toMatchObject({ evidenceKind: 'string-route', resolvedRoute: 'home' })
  })

  it('extracts a route from a named route= argument', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFileSync(
      join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'Nav.kt'),
      `package com.example
fun AppNav() {
    NavHost(navController = nc, startDestination = "home") {
        composable(route = "details/{id}") { DetailsScreen() }
    }
}
`
    )
    const result = buildRoutes(root)
    const details = result.routes.find((r) => r.rawRouteExpression?.includes('details'))!
    expect(details).toMatchObject({ evidenceKind: 'string-route', resolvedRoute: 'details/{id}' })
  })

  it('resolves a same-file local const val string route', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFileSync(
      join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'Nav.kt'),
      `package com.example
private const val HOME_ROUTE = "home"
fun AppNav() {
    NavHost(navController = nc, startDestination = "home") {
        composable(HOME_ROUTE) { HomeScreen() }
    }
}
`
    )
    const result = buildRoutes(root)
    const route = result.routes.find((r) => r.rawRouteExpression === 'HOME_ROUTE')!
    expect(route).toMatchObject({ evidenceKind: 'resolved-local-constant-route', resolvedRoute: 'home' })
  })

  it('leaves a dynamic route expression unresolved rather than inventing a value', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFileSync(
      join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'Nav.kt'),
      `package com.example
fun AppNav() {
    NavHost(navController = nc, startDestination = "home") {
        val route = buildRoute()
        composable(route) { HomeScreen() }
    }
}
`
    )
    const result = buildRoutes(root)
    const route = result.routes.find((r) => r.rawRouteExpression === 'route')!
    expect(route.evidenceKind).toBe('unresolved-recognized-call')
    expect(route.resolvedRoute).toBeNull()
    expect(route.warnings.length).toBeGreaterThan(0)
  })

  it('records a direct screen candidate only for an unambiguous single top-level call', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFileSync(
      join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'Nav.kt'),
      `package com.example
fun AppNav() {
    NavHost(navController = nc, startDestination = "home") {
        composable("home") { HomeScreen() }
        composable("chooser") {
            if (condition) {
                FirstScreen()
            } else {
                SecondScreen()
            }
        }
    }
}
`
    )
    const result = buildRoutes(root)
    const home = result.routes.find((r) => r.resolvedRoute === 'home')!
    expect(home.screenCandidateIds).toHaveLength(1)
    expect(result.screenCandidates.find((c) => c.id === home.screenCandidateIds[0])).toMatchObject({ calledScreenName: 'HomeScreen' })

    const chooser = result.routes.find((r) => r.resolvedRoute === 'chooser')!
    expect(chooser.screenCandidateIds).toEqual([])
  })

  it('extracts a navigation(...) builder route with a nested startDestination', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFileSync(
      join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'Nav.kt'),
      `package com.example
fun AppNav() {
    NavHost(navController = nc, startDestination = "main") {
        navigation(startDestination = "home", route = "main") {
            composable("home") { HomeScreen() }
        }
    }
}
`
    )
    const result = buildRoutes(root)
    const navRoute = result.routes.find((r) => r.builder === 'navigation')!
    expect(navRoute).toMatchObject({ evidenceKind: 'string-route', resolvedRoute: 'main' })
  })

  it('produces no route evidence for a Kotlin file with no navigation-related calls', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFileSync(
      join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'Util.kt'),
      `package com.example
fun helper(): Int = 1
`
    )
    const result = buildRoutes(root)
    expect(result.routes).toEqual([])
  })

  it('produces deterministic output across repeated runs', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeFileSync(
      join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'Nav.kt'),
      `package com.example
fun AppNav() {
    NavHost(navController = nc, startDestination = "home") {
        composable("home") { HomeScreen() }
    }
}
`
    )
    const buildResult = buildIndex({ repoRoot: root, sourceRoots: ['app/src/main/kotlin'], buildCallGraph: false })
    const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
    const first = buildComposeNavigationRoutes({ projectRoot: root, symbolIndex: buildResult.index, androidProject })
    const second = buildComposeNavigationRoutes({ projectRoot: root, symbolIndex: buildResult.index, androidProject })
    expect(first).toEqual(second)
  })
})
