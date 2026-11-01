/**
 * v1.13.0 Batch 4 gate over the public examples/basic-android-kotlin project.
 * The example is a static retrieval sample: these tests verify that it is a
 * recognizable maintained source project, that the existing indexer and
 * retrieval commands produce the documented evidence, and that its README
 * commands and npm package allowlist match the implemented CLI and package.
 * Nothing here compiles or runs the Android project.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

const EXAMPLE_REL = 'examples/basic-android-kotlin'
// The one public Rust workspace example test file that the package intentionally ships (approved for v1.14.0).
// Only this exact path is exempt from the private-path policy; every other entry is checked unchanged.
const approvedRustExampleTest = 'examples/basic-rust-workspace/crates/core/tests/worker_tests.rs'
const forbiddenPackagePath = /tests|benchmarks|fixtures|\.my-dev-kit|reports/
const forbiddenPackageEntries = (files: string[]) => files.filter((f) => f !== approvedRustExampleTest && forbiddenPackagePath.test(f))
const EXAMPLE_ROOT = join(process.cwd(), 'examples', 'basic-android-kotlin')
const KP = 'app/src/main/kotlin/com/example/kitdemo/'

const REQUIRED_FILES = [
  'README.md',
  'settings.gradle.kts',
  'build.gradle.kts',
  'app/build.gradle.kts',
  'app/src/main/AndroidManifest.xml',
  `${KP}MainActivity.kt`,
  `${KP}AppNavigation.kt`,
  `${KP}UserHomeScreen.kt`,
  `${KP}UserSettingsScreen.kt`,
  `${KP}UserViewModel.kt`,
  `${KP}data/UserRepository.kt`,
  `${KP}data/UserEntity.kt`,
  `${KP}data/UserDao.kt`,
  `${KP}data/AppDatabase.kt`,
  `${KP}data/UserApiService.kt`,
  'app/src/main/res/values/strings.xml',
  'app/src/test/kotlin/com/example/kitdemo/UserViewModelTest.kt',
  'app/src/androidTest/kotlin/com/example/kitdemo/UserHomeScreenTest.kt',
]

const HOME = `android-compose-declaration:${KP}UserHomeScreen.kt#UserHomeScreen`
const SETTINGS = `android-compose-declaration:${KP}UserSettingsScreen.kt#UserSettingsScreen`
const VM = `symbol:${KP}UserViewModel.kt#UserViewModel`
const REPO = `symbol:${KP}data/UserRepository.kt#UserRepository`
const DAO = `symbol:${KP}data/UserDao.kt#UserDao`
const ENTITY = `symbol:${KP}data/UserEntity.kt#UserEntity`
const DB = `symbol:${KP}data/AppDatabase.kt#AppDatabase`
const SERVICE = `symbol:${KP}data/UserApiService.kt#UserApiService`

const tempDirs: string[] = []
afterAll(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

let outDir: string
let graph: { nodes: any[]; edges: any[] }

function readExample(rel: string): string {
  return readFileSync(join(EXAMPLE_ROOT, rel), 'utf8')
}
function readJson(rel: string): any {
  return JSON.parse(readFileSync(join(outDir, rel), 'utf8'))
}
function json(result: ReturnType<typeof runCli>): any {
  return JSON.parse(result.stdout)
}
function hasEdge(source: string, kind: string, target: string): boolean {
  return graph.edges.some((e) => e.source === source && e.kind === kind && e.target === target)
}
function search(...args: string[]): any {
  const result = runCli(['search', '--index', outDir, ...args, '--json'])
  expect(result.status).toBe(0)
  return json(result)
}
function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? listFiles(full) : [full]
  })
}

beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-v113-b4-'))
  tempDirs.push(root)
  outDir = join(root, 'out')
  const result = runCli([
    'index', '--root', EXAMPLE_ROOT,
    '--src', 'app/src/main', '--src', 'app/src/test', '--src', 'app/src/androidTest',
    '--out', outDir, '--json',
  ])
  expect(result.status).toBe(0)
  graph = readJson('code-graph.json')
}, 120_000)

describe('v1.13.0 Batch 4: example source project', () => {
  it('contains every authorized example file', () => {
    for (const rel of REQUIRED_FILES) {
      expect(existsSync(join(EXAMPLE_ROOT, rel)), rel).toBe(true)
    }
  })

  it('contains only authorized files and no build output, wrapper, or local config', () => {
    const files = listFiles(EXAMPLE_ROOT).map((f) => relative(EXAMPLE_ROOT, f).split('\\').join('/')).sort()
    expect(files).toEqual([...REQUIRED_FILES].sort())
  })

  it('has recognizable Gradle, module, and manifest structure', () => {
    expect(readExample('settings.gradle.kts')).toContain('include(":app")')
    const app = readExample('app/build.gradle.kts')
    expect(app).toContain('id("com.android.application")')
    expect(app).toContain('namespace = "com.example.kitdemo"')
    expect(app).toContain('androidx.room:room-runtime')
    expect(app).toContain('com.squareup.retrofit2:retrofit')
    const manifest = readExample('app/src/main/AndroidManifest.xml')
    expect(manifest).toContain('android:name=".MainActivity"')
    expect(manifest).toContain('android:exported="true"')
    expect(manifest).toContain('android:scheme="https"')
    expect(manifest).toContain('android:host="example.com"')
    expect(manifest).toContain('android:path="/users"')
  })

  it('declares both Compose screens, the ViewModel, the repository, and the test tag', () => {
    expect(readExample(`${KP}UserHomeScreen.kt`)).toContain('fun UserHomeScreen(')
    expect(readExample(`${KP}UserHomeScreen.kt`)).toContain('Modifier.testTag("refresh_users_button")')
    expect(readExample(`${KP}UserHomeScreen.kt`)).toContain('collectAsState()')
    expect(readExample(`${KP}UserSettingsScreen.kt`)).toContain('fun UserSettingsScreen(')
    expect(readExample(`${KP}UserViewModel.kt`)).toContain('val uiState')
    expect(readExample(`${KP}UserViewModel.kt`)).toContain('fun refreshUsers()')
    expect(readExample(`${KP}data/UserRepository.kt`)).toContain('class UserRepository')
  })

  it('represents the Room entity, DAO, database, and Retrofit service', () => {
    expect(readExample(`${KP}data/UserEntity.kt`)).toContain('@Entity')
    expect(readExample(`${KP}data/UserDao.kt`)).toContain('@Dao')
    expect(readExample(`${KP}data/AppDatabase.kt`)).toContain('entities = [UserEntity::class]')
    expect(readExample(`${KP}data/AppDatabase.kt`)).toContain('abstract fun userDao(): UserDao')
    expect(readExample(`${KP}data/UserApiService.kt`)).toContain('@GET("users")')
    expect(readExample(`${KP}data/UserRepository.kt`)).toContain('UserDao')
    expect(readExample(`${KP}data/UserRepository.kt`)).toContain('UserApiService')
  })

  it('keeps unit and instrumented test sources in distinct source sets', () => {
    expect(readExample('app/src/androidTest/kotlin/com/example/kitdemo/UserHomeScreenTest.kt')).toContain('refresh_users_button')
    expect(readExample('app/src/androidTest/kotlin/com/example/kitdemo/UserHomeScreenTest.kt')).toContain('createComposeRule()')
    expect(readExample('app/src/test/kotlin/com/example/kitdemo/UserViewModelTest.kt')).toContain('assertEquals(')
  })

  it('does not import or require any internal benchmark fixture', () => {
    for (const file of listFiles(EXAMPLE_ROOT)) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/tests\/fixtures|benchmarks\/retrieval|com\.example\.combined/)
    }
    expect(readFileSync(join(process.cwd(), 'tests', 'integration', 'androidV113Batch4PublicExample.spec.ts'), 'utf8')).not.toMatch(/from ['"][^'"]*tests\/fixtures/)
  })
})

describe('v1.13.0 Batch 4: example index artifacts', () => {
  it('records the three source roots and runs every Android analyzer without errors', () => {
    const manifest = readJson('manifest.json')
    expect(manifest.sourceRoots).toEqual(['app/src/main', 'app/src/test', 'app/src/androidTest'])
    const status = (id: string) => manifest.analyzers.find((a: any) => a.id === id)?.status
    for (const id of [
      'android-project', 'android-components', 'android-manifest', 'android-resources',
      'android-navigation', 'android-compose-semantic', 'android-test-semantic', 'android-relationships',
    ]) {
      expect(status(id), id).toBe('complete')
    }
    expect(manifest.analyzers.every((a: any) => a.errorCount === 0)).toBe(true)
  })

  it('detects the Android application module and generates the Android artifacts', () => {
    const project = readJson('android-project.json')
    expect(project.modules.some((m: any) => m.id === 'android-module:app' && m.path === 'app')).toBe(true)
    for (const name of [
      'android-manifest.json', 'android-resources.json', 'android-navigation.json',
      'android-compose-semantic.json', 'android-test-semantic.json', 'android-components.json', 'classification.json',
    ]) {
      expect(existsSync(join(outDir, name)), name).toBe(true)
    }
    const symbolIndex = readJson('symbol-index.json')
    expect(symbolIndex.files.some((f: any) => /(^|\/)build\//.test(f.path))).toBe(false)
  })

  it('finds each Compose screen independently and resolves the test tag to its owner', () => {
    const home = search('--composable', 'UserHomeScreen')
    const settings = search('--composable', 'UserSettingsScreen')
    expect(home.results.map((r: any) => r.graphNodeId)).toEqual([HOME])
    expect(settings.results.map((r: any) => r.graphNodeId)).toEqual([SETTINGS])
    const tag = search('--test-tag', 'refresh_users_button')
    expect(tag.results).toHaveLength(1)
    expect(tag.results[0].androidMetadata.composableId).toBe(HOME)
  })

  it('preserves multiple candidates for a fuzzy query instead of selecting one winner', () => {
    const parsed = search('--query', 'UserHomeScreen', '--limit', '10')
    const paths = parsed.results.map((r: any) => r.path)
    expect(paths).toContain(`${KP}UserHomeScreen.kt`)
    expect(paths).toContain('app/src/androidTest/kotlin/com/example/kitdemo/UserHomeScreenTest.kt')
  })

  it('returns the documented graph relationships', () => {
    expect(hasEdge(HOME, 'composable-references-viewmodel', VM)).toBe(true)
    expect(hasEdge(VM, 'viewmodel-uses-repository', REPO)).toBe(true)
    expect(hasEdge(REPO, 'repository-uses-dao', DAO)).toBe(true)
    expect(hasEdge(REPO, 'repository-uses-service', SERVICE)).toBe(true)
    expect(hasEdge(DAO, 'dao-uses-entity', ENTITY)).toBe(true)
    expect(hasEdge(DB, 'room-database-exposes-dao', DAO)).toBe(true)
    expect(graph.edges.some((e) => e.kind === 'activity-hosts-composable' && e.source.endsWith('MainActivity.kt#MainActivity'))).toBe(true)
  })

  it('slices the Compose/ViewModel relationship within a bounded result', () => {
    const result = runCli(['slice', '--index', outDir, '--composable', 'UserHomeScreen', '--include-data-flow', '--json'])
    expect(result.status).toBe(0)
    const slice = json(result)
    const kinds = slice.edges.map((e: any) => e.kind)
    expect(kinds).toContain('composable-references-viewmodel')
    expect(kinds).toContain('compose-state-reads-viewmodel')
    expect(kinds).toContain('viewmodel-uses-repository')
    expect(kinds).toContain('android-test-references-composable')
    expect(slice.nodes.length).toBeLessThanOrEqual(100)
    expect(slice.edges.length).toBeLessThanOrEqual(200)
  })

  it('slices the route and Repository/DAO/Entity relationships', () => {
    const route = json(runCli(['slice', '--index', outDir, '--android-route', 'settings', '--json']))
    expect(route.edges.map((e: any) => e.kind)).toContain('compose-route-resolves-to-screen')
    const chain = json(runCli(['slice', '--index', outDir, '--node', VM, '--include-data-flow', '--depth', '3', '--json']))
    const kinds = chain.edges.map((e: any) => e.kind)
    for (const kind of ['viewmodel-uses-repository', 'repository-uses-dao', 'repository-uses-service', 'dao-uses-entity', 'room-database-exposes-dao']) {
      expect(kinds, kind).toContain(kind)
    }
  })

  it('retrieves bounded source for a composable, a route, and a string resource', () => {
    const composable = runCli(['source', '--index', outDir, '--composable', 'UserHomeScreen', '--format', 'numbered'])
    expect(composable.status).toBe(0)
    expect(composable.stdout).toContain('fun UserHomeScreen(')
    expect(composable.stdout).toContain('refresh_users_button')
    const route = runCli(['source', '--index', outDir, '--android-route', 'settings', '--format', 'numbered'])
    expect(route.status).toBe(0)
    expect(route.stdout).toContain('composable("settings")')
    const resource = runCli(['source', '--index', outDir, '--resource', 'string/user_screen_title', '--format', 'numbered'])
    expect(resource.status).toBe(0)
    expect(resource.stdout).toContain('user_screen_title')
    const windowed = runCli(['source', '--index', outDir, '--file', `${KP}data/UserDao.kt`, '--start', '1', '--end', '12', '--format', 'numbered'])
    expect(windowed.status).toBe(0)
    expect(windowed.stdout.split('\n').length).toBeLessThan(40)
  })

  it('retrieves unit and instrumented tests separately and indexes no generated output', () => {
    const unit = search('--android-role', 'android-unit-test').results.map((r: any) => r.path)
    const instrumented = search('--android-role', 'instrumented-test').results.map((r: any) => r.path)
    expect(unit.length).toBeGreaterThan(0)
    expect(instrumented.length).toBeGreaterThan(0)
    expect(unit.every((p: string) => p.startsWith('app/src/test/'))).toBe(true)
    expect(instrumented.every((p: string) => p.startsWith('app/src/androidTest/'))).toBe(true)
    expect(search('--android-role', 'generated-file').results).toEqual([])
  })
})

describe('v1.13.0 Batch 4: README commands and package allowlist', () => {
  function readmeCommands(): string[] {
    return readExample('README.md')
      .split('\n')
      .filter((line) => line.startsWith('npx @dailephd/my-dev-kit '))
  }
  function tokenize(command: string): string[] {
    return (command.match(/"[^"]*"|\S+/g) ?? []).map((t) => t.replace(/^"|"$/g, ''))
  }

  it('uses only subcommands and flags that the implemented CLI help lists', () => {
    const commands = readmeCommands()
    expect(commands.length).toBeGreaterThan(20)
    const helpBySub = new Map<string, string>()
    for (const command of commands) {
      const tokens = tokenize(command).slice(2)
      const sub = tokens[0]
      expect(['index', 'search', 'lookup', 'slice', 'source']).toContain(sub)
      if (!helpBySub.has(sub)) {
        const help = runCli([sub, '--help'])
        expect(help.status).toBe(0)
        helpBySub.set(sub, help.stdout)
      }
      for (const flag of tokens.filter((t) => t.startsWith('--'))) {
        expect(helpBySub.get(sub), `${sub} ${flag}`).toContain(flag)
      }
    }
  })

  it('runs every non-index README command successfully against the example index', () => {
    for (const command of readmeCommands()) {
      const tokens = tokenize(command).slice(2)
      if (tokens[0] === 'index') continue
      const args = tokens.map((t) => (t === `${EXAMPLE_REL}/.my-dev-kit` ? outDir : t))
      const result = runCli(args)
      expect(result.status, command).toBe(0)
    }
  }, 240_000)

  it('keeps the README index command aligned with the indexed source roots', () => {
    const indexCommand = readmeCommands().find((c) => c.includes(' index '))
    expect(indexCommand).toContain(`--root ${EXAMPLE_REL}`)
    for (const src of ['app/src/main', 'app/src/test', 'app/src/androidTest']) {
      expect(indexCommand).toContain(`--src ${src}`)
    }
  })

  it('adds the authorized example assets to the package allowlist without a broad rule', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    const files: string[] = pkg.files
    for (const entry of [
      `${EXAMPLE_REL}/README.md`,
      `${EXAMPLE_REL}/settings.gradle.kts`,
      `${EXAMPLE_REL}/build.gradle.kts`,
      `${EXAMPLE_REL}/app/build.gradle.kts`,
      `${EXAMPLE_REL}/app/src`,
    ]) {
      expect(files, entry).toContain(entry)
    }
    expect(files).not.toContain(EXAMPLE_REL)
    expect(files).not.toContain(`${EXAMPLE_REL}/`)
    expect(files.filter((f) => f === approvedRustExampleTest)).toHaveLength(1)
    expect(forbiddenPackageEntries(files)).toEqual([])
    expect(files).toContain('examples/basic-react-tsx/src')
  })

  it('still forbids every other private-looking package entry', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    const files: string[] = pkg.files
    for (const unapproved of [
      'examples/basic-rust-workspace/crates/core/tests/unapproved.rs',
      'tests/private.spec.ts',
      'benchmarks/private.json',
      'tests/fixtures/v114-language/rust',
      'examples/basic-rust-workspace/.my-dev-kit-rust-demo',
      'reports/private.md',
    ]) {
      expect(forbiddenPackageEntries([...files, unapproved]), unapproved).toEqual([unapproved])
    }
    // The exemption is exact: the approved file itself is allowed, near-miss paths are not.
    expect(forbiddenPackageEntries([...files, approvedRustExampleTest])).toEqual([])
    for (const nearMiss of [approvedRustExampleTest + '.bak', 'x/' + approvedRustExampleTest, approvedRustExampleTest.replace('worker_tests', 'other_tests')]) {
      expect(forbiddenPackageEntries([...files, nearMiss]), nearMiss).toEqual([nearMiss])
    }
  })

  it('registers the example in examples/README.md', () => {
    const readme = readFileSync(join(process.cwd(), 'examples', 'README.md'), 'utf8')
    expect(readme).toContain('basic-android-kotlin')
    expect(readme).toContain('--root examples/basic-android-kotlin')
  })
})
