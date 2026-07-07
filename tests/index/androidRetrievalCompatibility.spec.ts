import { mkdtempSync, readFileSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

const MIXED_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'android', 'mixed-kotlin-java-app')
const tempDirs: string[] = []

function copyFixture(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-retrieval-compat-${label}-`))
  tempDirs.push(root)
  cpSync(MIXED_FIXTURE, root, { recursive: true })
  return root
}

function indexInto(root: string, out = 'out') {
  const result = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', out, '--json'])
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout)
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('Batch 5: mixed Kotlin/Java Android retrieval compatibility', () => {
  it('index writes android-project.json and android-components.json for a mixed Kotlin/Java project', () => {
    const root = copyFixture('index')
    const parsed = indexInto(root)

    expect(parsed.androidProjectPath).toBeTruthy()
    expect(parsed.androidComponentsPath).toBeTruthy()

    const androidProject = JSON.parse(readFileSync(join(root, 'out', 'android-project.json'), 'utf8'))
    expect(androidProject.detected).toBe(true)

    const components = JSON.parse(readFileSync(join(root, 'out', 'android-components.json'), 'utf8'))
    const roleByName = Object.fromEntries(
      components.components.map((c: { symbolName: string; role: string; sourceLanguage: string }) => [c.symbolName, c])
    )
    expect(roleByName.MainActivity.role).toBe('activity')
    expect(roleByName.MainActivity.sourceLanguage).toBe('kotlin')
    expect(roleByName.MainViewModel.role).toBe('view-model')
    expect(roleByName.SyncWorker.role).toBe('worker')
    expect(roleByName.SyncWorker.sourceLanguage).toBe('java')
    expect(roleByName.UserRepository.role).toBe('repository')
    expect(roleByName.UserRepository.sourceLanguage).toBe('java')
  })

  it('manifest registers android-project and android-components analyzers as complete', () => {
    const root = copyFixture('manifest')
    const parsed = indexInto(root)

    const androidAnalyzer = parsed.analyzers.find((a: { id: string }) => a.id === 'android-project')
    const componentsAnalyzer = parsed.analyzers.find((a: { id: string }) => a.id === 'android-components')
    expect(androidAnalyzer.status).toBe('complete')
    expect(componentsAnalyzer.status).toBe('complete')
  })

  it('Kotlin and Java symbols coexist in symbol-index.json with roles attached only to role-bearing symbols', () => {
    const root = copyFixture('symbol-index')
    indexInto(root)
    const symbolIndex = JSON.parse(readFileSync(join(root, 'out', 'symbol-index.json'), 'utf8'))

    const kotlinFile = symbolIndex.files.find((f: { path: string }) => f.path.endsWith('MainActivity.kt'))
    const javaFile = symbolIndex.files.find((f: { path: string }) => f.path.endsWith('UserRepository.java'))
    expect(kotlinFile.language).toBe('kotlin')
    expect(javaFile.language).toBe('java')

    const mainActivity = kotlinFile.symbols.find((s: { name: string }) => s.name === 'MainActivity')
    expect(mainActivity.androidComponentRoles).toEqual([{ role: 'activity', confidence: 'high' }])

    const nonRoleKotlinFile = symbolIndex.files.find((f: { path: string }) => f.path.endsWith('StringExtensions.kt'))
    const nonRoleKotlinSymbol = nonRoleKotlinFile.symbols.find((s: { name: string }) => s.name === 'StringExtensions')
    expect(nonRoleKotlinSymbol.androidComponentRoles).toBeUndefined()

    const nonRoleJavaFile = symbolIndex.files.find((f: { path: string }) => f.path.endsWith('JavaUtils.java'))
    const nonRoleJavaSymbol = nonRoleJavaFile.symbols.find((s: { name: string }) => s.name === 'JavaUtils')
    expect(nonRoleJavaSymbol.androidComponentRoles).toBeUndefined()
  })

  it('Kotlin and Java nodes coexist in code-graph.json with role metadata on the expected nodes only', () => {
    const root = copyFixture('code-graph')
    indexInto(root)
    const codeGraph = JSON.parse(readFileSync(join(root, 'out', 'code-graph.json'), 'utf8'))

    const viewModelNode = codeGraph.nodes.find((n: { id: string }) => n.id.endsWith('MainViewModel.kt#MainViewModel'))
    expect(viewModelNode.androidComponentRoles).toEqual([{ role: 'view-model', confidence: 'high' }])

    const workerNode = codeGraph.nodes.find((n: { id: string }) => n.id.endsWith('SyncWorker.java#SyncWorker'))
    expect(workerNode.androidComponentRoles).toEqual([{ role: 'worker', confidence: 'high' }])

    const plainJavaNode = codeGraph.nodes.find((n: { id: string }) => n.id.endsWith('JavaUtils.java#JavaUtils'))
    expect(plainJavaNode.androidComponentRoles).toBeUndefined()
  })

  it('search finds Kotlin, Java, and role-bearing symbols across the mixed project', () => {
    const root = copyFixture('search')
    indexInto(root)
    const index = join(root, 'out')

    const viewModel = JSON.parse(runCli(['search', '--index', index, '--query', 'ViewModel', '--json']).stdout)
    expect(viewModel.results.some((r: { id: string }) => r.id.endsWith('MainViewModel.kt#MainViewModel'))).toBe(true)

    const repository = JSON.parse(runCli(['search', '--index', index, '--query', 'Repository', '--json']).stdout)
    expect(repository.results.some((r: { id: string }) => r.id.endsWith('UserRepository.java#UserRepository'))).toBe(true)

    const activity = JSON.parse(runCli(['search', '--index', index, '--query', 'MainActivity', '--json']).stdout)
    expect(activity.results.some((r: { id: string }) => r.id.endsWith('MainActivity.kt#MainActivity'))).toBe(true)

    const plainJava = JSON.parse(runCli(['search', '--index', index, '--query', 'JavaUtils', '--json']).stdout)
    expect(plainJava.results.some((r: { id: string }) => r.id.endsWith('JavaUtils.java#JavaUtils'))).toBe(true)
  })

  it('lookup exposes role metadata for role-bearing Kotlin and Java nodes, and no invented metadata for plain nodes', () => {
    const root = copyFixture('lookup')
    indexInto(root)
    const index = join(root, 'out')

    const kotlinRoleLookup = JSON.parse(
      runCli(['lookup', '--index', index, '--node', 'symbol:app/src/main/kotlin/com/example/MainViewModel.kt#MainViewModel', '--json']).stdout
    )
    expect(kotlinRoleLookup.androidComponentRoles).toEqual([{ role: 'view-model', confidence: 'high' }])

    const javaRoleLookup = JSON.parse(
      runCli(['lookup', '--index', index, '--node', 'symbol:app/src/main/java/com/example/SyncWorker.java#SyncWorker', '--json']).stdout
    )
    expect(javaRoleLookup.androidComponentRoles).toEqual([{ role: 'worker', confidence: 'high' }])

    const plainLookup = JSON.parse(
      runCli(['lookup', '--index', index, '--node', 'symbol:app/src/main/java/com/example/JavaUtils.java#JavaUtils', '--json']).stdout
    )
    expect(plainLookup.androidComponentRoles).toBeUndefined()
  })

  it('source returns bounded Kotlin and Java source for role-bearing nodes', () => {
    const root = copyFixture('source')
    indexInto(root)
    const index = join(root, 'out')

    const kotlinSource = runCli([
      'source', '--index', index, '--node', 'symbol:app/src/main/kotlin/com/example/MainViewModel.kt#MainViewModel', '--format', 'numbered',
    ])
    expect(kotlinSource.status).toBe(0)
    expect(kotlinSource.stdout).toContain('MainViewModel')

    const javaSource = runCli([
      'source', '--index', index, '--node', 'symbol:app/src/main/java/com/example/SyncWorker.java#SyncWorker', '--format', 'numbered',
    ])
    expect(javaSource.status).toBe(0)
    expect(javaSource.stdout).toContain('SyncWorker')
  })

  it('slice preserves Kotlin/Java role metadata across the mixed project', () => {
    const root = copyFixture('slice')
    indexInto(root)
    const index = join(root, 'out')

    const result = runCli([
      'slice', '--index', index, '--node', 'symbol:app/src/main/kotlin/com/example/MainActivity.kt#MainActivity', '--depth', '1', '--json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    const node = parsed.nodes.find((n: { id: string }) => n.id.endsWith('MainActivity.kt#MainActivity'))
    expect(node.androidComponentRoles).toEqual([{ role: 'activity', confidence: 'high' }])
  })
})
