import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, cpSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const KOTLIN_ANDROID_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'android', 'basic-kotlin-app')
const JAVA_ANDROID_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'android', 'basic-java-app')
const KOTLIN_PLAIN_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'kotlin', 'basic')
const JAVA_PLAIN_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'java', 'basic')
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

function copyFixture(source: string, label: string): string {
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-android-components-${label}-`))
  tempDirs.push(root)
  cpSync(source, root, { recursive: true })
  return root
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('Android component role indexing', () => {
  it('writes android-components.json for the Kotlin Android fixture and registers the analyzer', () => {
    const root = copyFixture(KOTLIN_ANDROID_FIXTURE, 'kotlin')
    const result = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', 'out', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.androidComponentsPath).toBeTruthy()
    const analyzer = parsed.analyzers.find((a: { id: string }) => a.id === 'android-components')
    expect(analyzer.status).toBe('complete')
    expect(analyzer.artifacts).toEqual([
      { name: 'androidComponents', path: 'android-components.json', artifactKind: 'my-dev-kit-v1-android-components' },
    ])

    const components = JSON.parse(readFileSync(join(root, 'out', 'android-components.json'), 'utf8'))
    const roleByName = Object.fromEntries(components.components.map((c: { symbolName: string; role: string }) => [c.symbolName, c.role]))
    expect(roleByName.MainActivity).toBe('activity')
    expect(roleByName.MainViewModel).toBe('view-model')
    expect(roleByName.UserRepository).toBe('repository')
    expect(roleByName.UserEntity).toBe('room-entity')
    expect(roleByName.UserDao).toBe('room-dao')
    expect(roleByName.AppDatabase).toBe('room-database')
    expect(roleByName.UserApi).toBe('retrofit-service')
    expect(roleByName.NetworkModule).toBe('hilt-module')
    expect(roleByName.GetUserUseCase).toBe('use-case')
  })

  it('writes android-components.json for the Java Android fixture', () => {
    const root = copyFixture(JAVA_ANDROID_FIXTURE, 'java')
    const result = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', 'out', '--json'])
    expect(result.status).toBe(0)

    const components = JSON.parse(readFileSync(join(root, 'out', 'android-components.json'), 'utf8'))
    const roleByName = Object.fromEntries(components.components.map((c: { symbolName: string; role: string }) => [c.symbolName, c.role]))
    expect(roleByName.MainActivity).toBe('activity')
    expect(roleByName.SyncWorker).toBe('worker')
    expect(roleByName.ExampleService).toBe('service')
    expect(roleByName.ExampleReceiver).toBe('broadcast-receiver')
    expect(roleByName.ExampleProvider).toBe('content-provider')
  })

  it('attaches compact androidComponentRoles/androidComponentRefs to symbol-index.json symbols', () => {
    const root = copyFixture(KOTLIN_ANDROID_FIXTURE, 'symbol-refs')
    runCli(['index', '--root', root, '--src', 'app/src/main', '--out', 'out', '--json'])

    const symbolIndex = JSON.parse(readFileSync(join(root, 'out', 'symbol-index.json'), 'utf8'))
    const file = symbolIndex.files.find((f: { path: string }) => f.path.endsWith('MainActivity.kt'))
    const symbol = file.symbols.find((s: { name: string }) => s.name === 'MainActivity')
    expect(symbol.androidComponentRoles).toEqual([{ role: 'activity', confidence: 'high' }])
    expect(symbol.androidComponentRefs[0].artifact).toBe('android-components.json')
  })

  it('attaches compact androidComponentRoles/androidComponentRefs to code-graph.json symbol nodes', () => {
    const root = copyFixture(KOTLIN_ANDROID_FIXTURE, 'graph-refs')
    runCli(['index', '--root', root, '--src', 'app/src/main', '--out', 'out', '--json'])

    const codeGraph = JSON.parse(readFileSync(join(root, 'out', 'code-graph.json'), 'utf8'))
    const node = codeGraph.nodes.find((n: { id: string }) => n.id.endsWith('MainActivity.kt#MainActivity'))
    expect(node.androidComponentRoles).toEqual([{ role: 'activity', confidence: 'high' }])
  })

  it('search finds role-bearing symbols by role-related query', () => {
    const root = copyFixture(KOTLIN_ANDROID_FIXTURE, 'search')
    runCli(['index', '--root', root, '--src', 'app/src/main', '--out', 'out', '--json'])

    const viewModel = runCli(['search', '--index', join(root, 'out'), '--query', 'ViewModel', '--json'])
    const viewModelResults = JSON.parse(viewModel.stdout)
    expect(viewModelResults.results.some((r: { id: string }) => r.id.endsWith('MainViewModel.kt#MainViewModel'))).toBe(true)

    const roomEntity = runCli(['search', '--index', join(root, 'out'), '--query', 'Room Entity', '--json'])
    const roomEntityResults = JSON.parse(roomEntity.stdout)
    expect(roomEntityResults.results.some((r: { id: string }) => r.id.endsWith('UserEntity.kt#UserEntity'))).toBe(true)
  })

  it('lookup exposes role metadata for a role-bearing symbol node', () => {
    const root = copyFixture(KOTLIN_ANDROID_FIXTURE, 'lookup')
    runCli(['index', '--root', root, '--src', 'app/src/main', '--out', 'out', '--json'])

    const result = runCli([
      'lookup',
      '--index',
      join(root, 'out'),
      '--node',
      'symbol:app/src/main/kotlin/com/example/MainViewModel.kt#MainViewModel',
      '--json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.androidComponentRoles).toEqual([{ role: 'view-model', confidence: 'high' }])
    expect(parsed.node.androidComponentRoles).toEqual([{ role: 'view-model', confidence: 'high' }])
  })

  it('source still returns bounded source for a role-bearing symbol', () => {
    const root = copyFixture(KOTLIN_ANDROID_FIXTURE, 'source')
    runCli(['index', '--root', root, '--src', 'app/src/main', '--out', 'out', '--json'])

    const result = runCli([
      'source',
      '--index',
      join(root, 'out'),
      '--node',
      'symbol:app/src/main/kotlin/com/example/MainViewModel.kt#MainViewModel',
      '--format',
      'numbered',
    ])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('MainViewModel')
  })

  it('slice preserves role metadata on the node', () => {
    const root = copyFixture(KOTLIN_ANDROID_FIXTURE, 'slice')
    runCli(['index', '--root', root, '--src', 'app/src/main', '--out', 'out', '--json'])

    const result = runCli([
      'slice',
      '--index',
      join(root, 'out'),
      '--node',
      'symbol:app/src/main/kotlin/com/example/MainViewModel.kt#MainViewModel',
      '--depth',
      '1',
      '--json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    const node = parsed.nodes.find((n: { id: string }) => n.id.endsWith('MainViewModel.kt#MainViewModel'))
    expect(node.androidComponentRoles).toEqual([{ role: 'view-model', confidence: 'high' }])
  })

  it('keeps Android project detection (Batch 1) correct alongside component roles', () => {
    const root = copyFixture(KOTLIN_ANDROID_FIXTURE, 'batch1-compat')
    const result = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', 'out', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.androidProjectPath).toBeTruthy()

    const androidProject = JSON.parse(readFileSync(join(root, 'out', 'android-project.json'), 'utf8'))
    expect(androidProject.detected).toBe(true)
    expect(androidProject.modules[0].type).toBe('app')
  })

  it('keeps Kotlin indexing (Batch 2) correct on the plain Kotlin fixture (no Android evidence)', () => {
    const root = copyFixture(KOTLIN_PLAIN_FIXTURE, 'batch2-compat')
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'out', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.androidComponentsPath).toBeNull()

    const symbolIndex = JSON.parse(readFileSync(join(root, 'out', 'symbol-index.json'), 'utf8'))
    const modelsFile = symbolIndex.files.find((f: { path: string }) => f.path === 'src/Models.kt')
    expect(modelsFile.symbols.some((s: { name: string; androidComponentRoles?: unknown }) => s.name === 'User' && !s.androidComponentRoles)).toBe(true)
  })

  it('keeps Java indexing (Batch 3) correct on the plain Java fixture (no Android evidence)', () => {
    const root = copyFixture(JAVA_PLAIN_FIXTURE, 'batch3-compat')
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'out', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.androidComponentsPath).toBeNull()

    const analyzer = parsed.analyzers.find((a: { id: string }) => a.id === 'android-components')
    expect(analyzer.status).toBe('skipped')
  })

  it('non-Android projects remain fully unaffected: no android-components.json is written', () => {
    const root = copyFixture(KOTLIN_PLAIN_FIXTURE, 'non-android')
    runCli(['index', '--root', root, '--src', 'src', '--out', 'out', '--json'])

    expect(existsSync(join(root, 'out', 'android-components.json'))).toBe(false)
  })
})
