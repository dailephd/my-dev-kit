import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectAndroidComponents, inspectKotlinClassSupertypes } from '../../src/android/detectAndroidComponents.js'
import type { AndroidProjectArtifact } from '../../src/android/androidProjectTypes.js'
import type { FileSummary, SymbolDefinition, SymbolIndex } from '../../src/symbol-index/types.js'

const CREATED_AT = '2026-01-01T00:00:00.000Z'

function androidProject(overrides?: Partial<AndroidProjectArtifact>): AndroidProjectArtifact {
  return {
    artifactKind: 'my-dev-kit-v1-android-project',
    schemaVersion: '1.0.0',
    createdAt: CREATED_AT,
    projectRoot: '',
    detected: true,
    confidence: 'high',
    evidence: [],
    modules: [
      {
        id: 'app',
        name: 'app',
        path: 'app',
        type: 'app',
        gradleFiles: [],
        manifestPath: 'app/src/main/AndroidManifest.xml',
        sourceSets: [
          {
            name: 'main',
            path: 'app/src/main',
            manifestPath: 'app/src/main/AndroidManifest.xml',
            kotlinRoots: ['app/src/main/kotlin'],
            javaRoots: [],
            resourcesPath: null,
            warnings: [],
          },
        ],
        kotlinSourceRoots: ['app/src/main/kotlin'],
        javaSourceRoots: [],
        evidence: [],
        warnings: [],
      },
    ],
    ignoredGeneratedDirectories: [],
    warnings: [],
    summary: { moduleCount: 1, appModuleCount: 1, libraryModuleCount: 0, unknownModuleCount: 0 },
    ...overrides,
  }
}

function symbol(overrides: Partial<SymbolDefinition> & Pick<SymbolDefinition, 'name' | 'kind'>): SymbolDefinition {
  return {
    location: { file: 'app/src/main/kotlin/com/example/Sample.kt', line: 3 },
    exported: true,
    ...overrides,
  }
}

function fileSummary(overrides: Partial<FileSummary> & Pick<FileSummary, 'path' | 'symbols'>): FileSummary {
  return {
    language: 'kotlin',
    lineCount: 10,
    imports: [],
    exports: [],
    hasCallGraphEntries: false,
    ...overrides,
  }
}

function symbolIndexOf(files: FileSummary[]): SymbolIndex {
  return {
    schemaVersion: '1.0.0',
    buildTime: CREATED_AT,
    repoRoot: '/repo',
    sourceRoots: ['app/src/main'],
    fileCount: files.length,
    symbolCount: files.reduce((sum, f) => sum + f.symbols.length, 0),
    files,
  } as SymbolIndex
}

const tempDirs: string[] = []
function makeProjectRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-components-'))
  tempDirs.push(dir)
  return dir
}

function cleanup(): void {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
}

describe('detectAndroidComponents', () => {
  it('detects an Activity role from a strong superclass match', () => {
    const projectRoot = makeProjectRoot()
    const file = fileSummary({
      path: 'app/src/main/kotlin/com/example/MainActivity.kt',
      symbols: [symbol({ name: 'MainActivity', kind: 'class', signature: 'class MainActivity : AppCompatActivity() {' })],
    })
    const result = detectAndroidComponents({
      symbolIndex: symbolIndexOf([file]),
      androidProject: androidProject(),
      projectRoot,
      createdAt: CREATED_AT,
    })
    cleanup()

    expect(result.artifact.components).toHaveLength(1)
    expect(result.artifact.components[0].role).toBe('activity')
    expect(result.artifact.components[0].confidence).toBe('high')
    expect(result.artifact.components[0].evidence[0].kind).toBe('superclass')
  })

  it('detects a Fragment role from an import when no superclass is visible', () => {
    const projectRoot = makeProjectRoot()
    const file = fileSummary({
      path: 'app/src/main/kotlin/com/example/HomeFragment.kt',
      imports: ['androidx.fragment.app.Fragment'],
      symbols: [symbol({ name: 'HomeFragment', kind: 'class', signature: 'class HomeFragment {' })],
    })
    const result = detectAndroidComponents({
      symbolIndex: symbolIndexOf([file]),
      androidProject: androidProject(),
      projectRoot,
      createdAt: CREATED_AT,
    })
    cleanup()

    expect(result.artifact.components[0].role).toBe('fragment')
    expect(result.artifact.components[0].confidence).toBe('medium')
  })

  it('detects a ViewModel role', () => {
    const projectRoot = makeProjectRoot()
    const file = fileSummary({
      path: 'app/src/main/kotlin/com/example/MainViewModel.kt',
      symbols: [symbol({ name: 'MainViewModel', kind: 'class', signature: 'class MainViewModel : ViewModel() {' })],
    })
    const result = detectAndroidComponents({
      symbolIndex: symbolIndexOf([file]),
      androidProject: androidProject(),
      projectRoot,
      createdAt: CREATED_AT,
    })
    cleanup()
    expect(result.artifact.components[0].role).toBe('view-model')
    expect(result.artifact.components[0].confidence).toBe('high')
  })

  it('detects a Service role only for class symbols, not interfaces', () => {
    const projectRoot = makeProjectRoot()
    const file = fileSummary({
      path: 'app/src/main/kotlin/com/example/SyncService.kt',
      symbols: [
        symbol({ name: 'SyncService', kind: 'class', signature: 'class SyncService : Service() {' }),
        symbol({ name: 'ApiService', kind: 'interface', signature: 'interface ApiService {' }),
      ],
    })
    const result = detectAndroidComponents({
      symbolIndex: symbolIndexOf([file]),
      androidProject: androidProject(),
      projectRoot,
      createdAt: CREATED_AT,
    })
    cleanup()

    const service = result.artifact.components.find((c) => c.symbolName === 'SyncService')
    expect(service?.role).toBe('service')
    expect(service?.confidence).toBe('high')
    expect(result.artifact.components.some((c) => c.symbolName === 'ApiService' && c.role === 'service')).toBe(false)
  })

  it('detects a BroadcastReceiver role', () => {
    const projectRoot = makeProjectRoot()
    const file = fileSummary({
      path: 'app/src/main/kotlin/com/example/BootReceiver.kt',
      symbols: [symbol({ name: 'BootReceiver', kind: 'class', signature: 'class BootReceiver : BroadcastReceiver() {' })],
    })
    const result = detectAndroidComponents({
      symbolIndex: symbolIndexOf([file]),
      androidProject: androidProject(),
      projectRoot,
      createdAt: CREATED_AT,
    })
    cleanup()
    expect(result.artifact.components[0].role).toBe('broadcast-receiver')
  })

  it('detects a ContentProvider role', () => {
    const projectRoot = makeProjectRoot()
    const file = fileSummary({
      path: 'app/src/main/kotlin/com/example/FileProvider2.kt',
      symbols: [symbol({ name: 'FileProvider2', kind: 'class', signature: 'class FileProvider2 : ContentProvider() {' })],
    })
    const result = detectAndroidComponents({
      symbolIndex: symbolIndexOf([file]),
      androidProject: androidProject(),
      projectRoot,
      createdAt: CREATED_AT,
    })
    cleanup()
    expect(result.artifact.components[0].role).toBe('content-provider')
  })

  it('detects a Worker role', () => {
    const projectRoot = makeProjectRoot()
    const file = fileSummary({
      path: 'app/src/main/kotlin/com/example/SyncWorker.kt',
      symbols: [symbol({ name: 'SyncWorker', kind: 'class', signature: 'class SyncWorker : CoroutineWorker() {' })],
    })
    const result = detectAndroidComponents({
      symbolIndex: symbolIndexOf([file]),
      androidProject: androidProject(),
      projectRoot,
      createdAt: CREATED_AT,
    })
    cleanup()
    expect(result.artifact.components[0].role).toBe('worker')
  })

  it('detects a Repository role from name suffix at medium confidence, never high', () => {
    const projectRoot = makeProjectRoot()
    const file = fileSummary({
      path: 'app/src/main/kotlin/com/example/UserRepository.kt',
      symbols: [symbol({ name: 'UserRepository', kind: 'class', signature: 'class UserRepository {' })],
    })
    const result = detectAndroidComponents({
      symbolIndex: symbolIndexOf([file]),
      androidProject: androidProject(),
      projectRoot,
      createdAt: CREATED_AT,
    })
    cleanup()
    expect(result.artifact.components[0].role).toBe('repository')
    expect(result.artifact.components[0].confidence).toBe('medium')
  })

  it('detects a UseCase role from a path hint even without a matching name suffix', () => {
    const projectRoot = makeProjectRoot()
    const file = fileSummary({
      path: 'app/src/main/kotlin/com/example/domain/FetchUser.kt',
      symbols: [symbol({ name: 'FetchUser', kind: 'class', signature: 'class FetchUser {' })],
    })
    const result = detectAndroidComponents({
      symbolIndex: symbolIndexOf([file]),
      androidProject: androidProject(),
      projectRoot,
      createdAt: CREATED_AT,
    })
    cleanup()
    expect(result.artifact.components[0].role).toBe('use-case')
    expect(result.artifact.components[0].confidence).toBe('medium')
  })

  it('detects a Room Entity role from the @Entity annotation', () => {
    const projectRoot = makeProjectRoot()
    const file = fileSummary({
      path: 'app/src/main/kotlin/com/example/UserRow.kt',
      symbols: [symbol({ name: 'UserRow', kind: 'class', signature: '@Entity data class UserRow(val id: String)' })],
    })
    const result = detectAndroidComponents({
      symbolIndex: symbolIndexOf([file]),
      androidProject: androidProject(),
      projectRoot,
      createdAt: CREATED_AT,
    })
    cleanup()
    expect(result.artifact.components[0].role).toBe('room-entity')
    expect(result.artifact.components[0].confidence).toBe('high')
    expect(result.artifact.components[0].evidence[0].kind).toBe('annotation')
  })

  it('detects a Room DAO role from the @Dao annotation', () => {
    const projectRoot = makeProjectRoot()
    const file = fileSummary({
      path: 'app/src/main/kotlin/com/example/UserDao.kt',
      symbols: [symbol({ name: 'UserDao', kind: 'interface', signature: '@Dao interface UserDao {' })],
    })
    const result = detectAndroidComponents({
      symbolIndex: symbolIndexOf([file]),
      androidProject: androidProject(),
      projectRoot,
      createdAt: CREATED_AT,
    })
    cleanup()
    expect(result.artifact.components[0].role).toBe('room-dao')
    expect(result.artifact.components[0].confidence).toBe('high')
  })

  it('detects a Room Database role from the RoomDatabase superclass', () => {
    const projectRoot = makeProjectRoot()
    const file = fileSummary({
      path: 'app/src/main/kotlin/com/example/AppDatabase.kt',
      symbols: [symbol({ name: 'AppDatabase', kind: 'class', signature: 'abstract class AppDatabase : RoomDatabase() {' })],
    })
    const result = detectAndroidComponents({
      symbolIndex: symbolIndexOf([file]),
      androidProject: androidProject(),
      projectRoot,
      createdAt: CREATED_AT,
    })
    cleanup()
    expect(result.artifact.components[0].role).toBe('room-database')
    expect(result.artifact.components[0].confidence).toBe('high')
  })

  it('detects a Retrofit service role from an HTTP method annotation inside the interface body', () => {
    const projectRoot = makeProjectRoot()
    mkdirSync(join(projectRoot, 'app/src/main/kotlin/com/example'), { recursive: true })
    const source = 'package com.example\n\ninterface UserApi {\n    @GET("users")\n    suspend fun getUsers(): List<String>\n}\n'
    writeFileSync(join(projectRoot, 'app/src/main/kotlin/com/example/UserApi.kt'), source)

    const file = fileSummary({
      path: 'app/src/main/kotlin/com/example/UserApi.kt',
      symbols: [symbol({ name: 'UserApi', kind: 'interface', signature: 'interface UserApi {', location: { file: 'app/src/main/kotlin/com/example/UserApi.kt', line: 3 } })],
    })
    const result = detectAndroidComponents({
      symbolIndex: symbolIndexOf([file]),
      androidProject: androidProject(),
      projectRoot,
      createdAt: CREATED_AT,
    })
    cleanup()

    expect(result.artifact.components[0].role).toBe('retrofit-service')
    expect(result.artifact.components[0].confidence).toBe('high')
    expect(result.artifact.components[0].evidence[0].kind).toBe('source-pattern')
  })

  it('detects a Retrofit service role at medium confidence from imports + name suffix alone', () => {
    const projectRoot = makeProjectRoot()
    const file = fileSummary({
      path: 'app/src/main/kotlin/com/example/UserApi.kt',
      imports: ['retrofit2.http.GET'],
      symbols: [symbol({ name: 'UserApi', kind: 'interface', signature: 'interface UserApi {' })],
    })
    const result = detectAndroidComponents({
      symbolIndex: symbolIndexOf([file]),
      androidProject: androidProject(),
      projectRoot,
      createdAt: CREATED_AT,
    })
    cleanup()
    expect(result.artifact.components[0].role).toBe('retrofit-service')
    expect(result.artifact.components[0].confidence).toBe('medium')
  })

  it('detects a Hilt module role from the @Module annotation', () => {
    const projectRoot = makeProjectRoot()
    const file = fileSummary({
      path: 'app/src/main/kotlin/com/example/NetworkModule.kt',
      symbols: [symbol({ name: 'NetworkModule', kind: 'object', signature: '@Module @InstallIn(SingletonComponent::class) object NetworkModule {' })],
    })
    const result = detectAndroidComponents({
      symbolIndex: symbolIndexOf([file]),
      androidProject: androidProject(),
      projectRoot,
      createdAt: CREATED_AT,
    })
    cleanup()
    expect(result.artifact.components[0].role).toBe('hilt-module')
    expect(result.artifact.components[0].confidence).toBe('high')
  })

  it('assigns low confidence and a warning for name-suffix-only evidence', () => {
    const projectRoot = makeProjectRoot()
    const file = fileSummary({
      path: 'app/src/main/kotlin/com/example/HomeFragment.kt',
      symbols: [symbol({ name: 'HomeFragment', kind: 'class', signature: 'class HomeFragment {' })],
    })
    const result = detectAndroidComponents({
      symbolIndex: symbolIndexOf([file]),
      androidProject: androidProject(),
      projectRoot,
      createdAt: CREATED_AT,
    })
    cleanup()
    expect(result.artifact.components[0].confidence).toBe('low')
    expect(result.artifact.components[0].warnings.length).toBeGreaterThan(0)
    expect(result.artifact.warnings.length).toBeGreaterThan(0)
  })

  it('never emits high confidence from a name suffix alone', () => {
    const projectRoot = makeProjectRoot()
    const roleFixtures: Array<{ name: string; kind: 'class' | 'interface' | 'object' }> = [
      { name: 'HomeFragment', kind: 'class' },
      { name: 'SettingsActivity', kind: 'class' },
      { name: 'SomeWorker', kind: 'class' },
    ]
    const file = fileSummary({
      path: 'app/src/main/kotlin/com/example/Various.kt',
      symbols: roleFixtures.map((f) => symbol({ name: f.name, kind: f.kind, signature: `class ${f.name} {` })),
    })
    const result = detectAndroidComponents({
      symbolIndex: symbolIndexOf([file]),
      androidProject: androidProject(),
      projectRoot,
      createdAt: CREATED_AT,
    })
    cleanup()

    expect(result.artifact.components.every((c) => c.confidence !== 'high')).toBe(true)
  })

  it('does not detect an Activity from a name suffix outside the main source set', () => {
    const projectRoot = makeProjectRoot()
    const project = androidProject({
      modules: [
        {
          id: 'app',
          name: 'app',
          path: 'app',
          type: 'app',
          gradleFiles: [],
          manifestPath: null,
          sourceSets: [
            {
              name: 'test',
              path: 'app/src/test',
              manifestPath: null,
              kotlinRoots: ['app/src/test/kotlin'],
              javaRoots: [],
              resourcesPath: null,
              warnings: [],
            },
          ],
          kotlinSourceRoots: ['app/src/test/kotlin'],
          javaSourceRoots: [],
          evidence: [],
          warnings: [],
        },
      ],
    })
    const file = fileSummary({
      path: 'app/src/test/kotlin/com/example/FakeActivity.kt',
      symbols: [symbol({ name: 'FakeActivity', kind: 'class', signature: 'class FakeActivity {' })],
    })
    const result = detectAndroidComponents({
      symbolIndex: symbolIndexOf([file]),
      androidProject: project,
      projectRoot,
      createdAt: CREATED_AT,
    })
    cleanup()
    expect(result.artifact.components).toHaveLength(0)
  })

  it('produces no components and a not-detected artifact for a non-Android project', () => {
    const projectRoot = makeProjectRoot()
    const file = fileSummary({
      path: 'src/MainActivity.kt',
      symbols: [symbol({ name: 'MainActivity', kind: 'class', signature: 'class MainActivity : AppCompatActivity() {' })],
    })
    const result = detectAndroidComponents({
      symbolIndex: symbolIndexOf([file]),
      androidProject: androidProject({ detected: false, confidence: 'none', modules: [] }),
      projectRoot,
      createdAt: CREATED_AT,
    })
    cleanup()
    expect(result.artifact.detected).toBe(false)
    expect(result.artifact.components).toEqual([])
  })

  it('produces deterministic, sorted output across repeated calls', () => {
    const projectRoot = makeProjectRoot()
    const files = [
      fileSummary({
        path: 'app/src/main/kotlin/com/example/ZFragment.kt',
        symbols: [symbol({ name: 'ZFragment', kind: 'class', signature: 'class ZFragment : Fragment() {' })],
      }),
      fileSummary({
        path: 'app/src/main/kotlin/com/example/AActivity.kt',
        symbols: [symbol({ name: 'AActivity', kind: 'class', signature: 'class AActivity : Activity() {' })],
      }),
    ]
    const index = symbolIndexOf(files)
    const project = androidProject()

    const first = detectAndroidComponents({ symbolIndex: index, androidProject: project, projectRoot, createdAt: CREATED_AT })
    const second = detectAndroidComponents({ symbolIndex: index, androidProject: project, projectRoot, createdAt: CREATED_AT })
    cleanup()

    expect(first.artifact.components.map((c) => c.filePath)).toEqual([
      'app/src/main/kotlin/com/example/AActivity.kt',
      'app/src/main/kotlin/com/example/ZFragment.kt',
    ])
    expect(first.artifact).toEqual(second.artifact)
  })
})

// ---------------------------------------------------------------------------
// v1.13.0 D2-D: symbol-local import evidence and bounded multiline Kotlin
// class-header inspection
// ---------------------------------------------------------------------------

const KT_DIR = 'app/src/main/kotlin/com/example'

interface HeaderFixtureClass {
  name: string
  /** Text that appears on the class declaration line; used to find the indexed line. */
  needle: string
  signature: string
  kind?: 'class' | 'interface' | 'object'
}

function detectFromSource(
  fileName: string,
  source: string,
  classes: HeaderFixtureClass[],
  imports: string[]
): ReturnType<typeof detectAndroidComponents>['artifact'] {
  const projectRoot = makeProjectRoot()
  const rel = `${KT_DIR}/${fileName}`
  mkdirSync(join(projectRoot, KT_DIR), { recursive: true })
  writeFileSync(join(projectRoot, rel), source, 'utf8')
  const lines = source.split('\n')
  const file = fileSummary({
    path: rel,
    imports,
    lineCount: lines.length,
    symbols: classes.map((c) =>
      symbol({
        name: c.name,
        kind: c.kind ?? 'class',
        signature: c.signature,
        location: { file: rel, line: lines.findIndex((l) => l.includes(c.needle)) + 1 },
      })
    ),
  })
  const result = detectAndroidComponents({
    symbolIndex: symbolIndexOf([file]),
    androidProject: androidProject(),
    projectRoot,
    createdAt: CREATED_AT,
  })
  cleanup()
  return result.artifact
}

function rolesOf(artifact: ReturnType<typeof detectAndroidComponents>['artifact'], name: string) {
  return artifact.components.filter((c) => c.symbolName === name)
}

const VIEWMODEL_IMPORT = ['androidx.lifecycle.ViewModel']

describe('D2-D symbol-local component-role evidence', () => {
  const sharedImportSource = [
    'package com.example',
    '',
    'import androidx.lifecycle.ViewModel',
    '',
    'class MainActivity : ComponentActivity() {',
    '    private val factory = object : ViewModelProvider.Factory {}',
    '}',
    '',
    'data class UserUiState(',
    '    val users: List<String> = emptyList(),',
    '    val isRefreshing: Boolean = false',
    ')',
    '',
    'class UserViewModel(',
    '    private val repository: UserRepository',
    ') : ViewModel() {',
    '}',
    '',
  ].join('\n')
  const sharedClasses: HeaderFixtureClass[] = [
    { name: 'MainActivity', needle: 'class MainActivity', signature: 'class MainActivity : ComponentActivity() {' },
    { name: 'UserUiState', needle: 'data class UserUiState', signature: 'data class UserUiState(' },
    { name: 'UserViewModel', needle: 'class UserViewModel', signature: 'class UserViewModel(' },
  ]

  it('T01: classes sharing a ViewModel import keep only their own roles', () => {
    const artifact = detectFromSource('Shared.kt', sharedImportSource, sharedClasses, VIEWMODEL_IMPORT)
    expect(rolesOf(artifact, 'MainActivity').map((c) => [c.role, c.confidence])).toEqual([['activity', 'high']])
    expect(rolesOf(artifact, 'UserUiState')).toEqual([])
    const viewModel = rolesOf(artifact, 'UserViewModel')
    expect(viewModel.map((c) => [c.role, c.confidence])).toEqual([['view-model', 'high']])
    expect(viewModel[0]!.evidence[0]).toMatchObject({ kind: 'superclass', value: 'ViewModel', confidence: 'high' })
    // header-derived evidence keeps its source-location provenance
    expect(viewModel[0]!.evidence[0]!.source).toMatch(/\/Shared\.kt:14-\d+$/)
  })

  it('T02: a single-line superclass stays high confidence from the signature', () => {
    const artifact = detectFromSource(
      'One.kt',
      'class OneViewModel : ViewModel() {\n}\n',
      [{ name: 'OneViewModel', needle: 'class OneViewModel', signature: 'class OneViewModel : ViewModel() {' }],
      VIEWMODEL_IMPORT
    )
    const [role] = rolesOf(artifact, 'OneViewModel')
    expect(role).toMatchObject({ role: 'view-model', confidence: 'high' })
    expect(role!.evidence[0]!.source).toBe('class OneViewModel : ViewModel() {')
  })

  it('T03: a superclass after a multiline primary constructor is grounded', () => {
    const source = ['class Sync(', '    private val a: A,', '    private val b: B', ') : Service() {', '}', ''].join('\n')
    const artifact = detectFromSource('Sync.kt', source, [{ name: 'Sync', needle: 'class Sync', signature: 'class Sync(' }], [])
    expect(rolesOf(artifact, 'Sync')).toHaveLength(1)
    expect(rolesOf(artifact, 'Sync')[0]).toMatchObject({ role: 'service', confidence: 'high' })
  })

  it('T04: a ViewModel constructor parameter does not make a ViewModel', () => {
    const single = detectFromSource(
      'Holder.kt',
      'class Holder(private val vm: ViewModel) {\n}\n',
      [{ name: 'Holder', needle: 'class Holder', signature: 'class Holder(private val vm: ViewModel) {' }],
      VIEWMODEL_IMPORT
    )
    expect(rolesOf(single, 'Holder')).toEqual([])
    const multi = detectFromSource(
      'Holder2.kt',
      ['class Holder2(', '    private val vm: ViewModel,', '    private val other: Other', ') {', '}', ''].join('\n'),
      [{ name: 'Holder2', needle: 'class Holder2', signature: 'class Holder2(' }],
      VIEWMODEL_IMPORT
    )
    expect(rolesOf(multi, 'Holder2')).toEqual([])
  })

  it('T05: an import without class-local evidence assigns no role, for every standard class role', () => {
    const imports = [
      'android.app.Activity',
      'androidx.fragment.app.Fragment',
      'androidx.lifecycle.ViewModel',
      'android.app.Service',
      'android.content.BroadcastReceiver',
      'android.content.ContentProvider',
      'androidx.work.Worker',
    ]
    const artifact = detectFromSource(
      'Plain.kt',
      'data class Plain(val a: Int)\n',
      [{ name: 'Plain', needle: 'data class Plain', signature: 'data class Plain(val a: Int)' }],
      imports
    )
    expect(rolesOf(artifact, 'Plain')).toEqual([])
  })

  it('T06: a name-suffix-only class keeps the existing low-confidence behavior and warning', () => {
    const artifact = detectFromSource(
      'Named.kt',
      'class NamedViewModel {\n}\n',
      [{ name: 'NamedViewModel', needle: 'class NamedViewModel', signature: 'class NamedViewModel {' }],
      []
    )
    const [role] = rolesOf(artifact, 'NamedViewModel')
    expect(role).toMatchObject({ role: 'view-model', confidence: 'low' })
    expect(role!.warnings.length).toBe(1)
    expect(role!.evidence.map((e) => e.kind)).toEqual(['name'])
  })

  it('T07: a corroborated import (suffix plus relevant import) is medium confidence with both evidence kinds', () => {
    const artifact = detectFromSource(
      'Corroborated.kt',
      'class CorroboratedViewModel {\n}\n',
      [{ name: 'CorroboratedViewModel', needle: 'class CorroboratedViewModel', signature: 'class CorroboratedViewModel {' }],
      VIEWMODEL_IMPORT
    )
    const [role] = rolesOf(artifact, 'CorroboratedViewModel')
    expect(role).toMatchObject({ role: 'view-model', confidence: 'medium', warnings: [] })
    expect(role!.evidence.map((e) => `${e.kind}:${e.confidence}`)).toEqual(['import:medium', 'name:low'])
  })

  it('T08: header inspection never crosses into the next declaration', () => {
    const source = ['class Alpha(val a: Int)', '', 'class BetaViewModel : ViewModel()', '', 'class Gamma(', '    val g: Int', ') {', '}', ''].join('\n')
    const artifact = detectFromSource(
      'Many.kt',
      source,
      [
        { name: 'Alpha', needle: 'class Alpha', signature: 'class Alpha(val a: Int)' },
        { name: 'BetaViewModel', needle: 'class BetaViewModel', signature: 'class BetaViewModel : ViewModel()' },
        { name: 'Gamma', needle: 'class Gamma', signature: 'class Gamma(' },
      ],
      VIEWMODEL_IMPORT
    )
    expect(rolesOf(artifact, 'Alpha')).toEqual([])
    expect(rolesOf(artifact, 'Gamma')).toEqual([])
    expect(rolesOf(artifact, 'BetaViewModel')[0]).toMatchObject({ confidence: 'high' })
    // a body-less class whose declaration continues on the next line is still read to its end
    expect(inspectKotlinClassSupertypes('class Alpha(val a: Int)\n\nclass Beta : ViewModel()\n', 'Alpha', false)).toEqual({ status: 'none' })
  })

  it('T09: comments and string literals never establish inheritance', () => {
    const source = [
      'class Quoted(',
      '    // : ViewModel() in a comment',
      '    /* ) : ViewModel() { */',
      '    val label: String = ") : ViewModel() {"',
      ') {',
      '}',
      '',
    ].join('\n')
    const artifact = detectFromSource('Quoted.kt', source, [{ name: 'Quoted', needle: 'class Quoted', signature: 'class Quoted(' }], VIEWMODEL_IMPORT)
    expect(rolesOf(artifact, 'Quoted')).toEqual([])
    expect(inspectKotlinClassSupertypes('class Z {\n  // : ViewModel()\n}\n', 'Z', false)).toEqual({ status: 'none' })
    expect(inspectKotlinClassSupertypes('class Z : Base() {\n  val s = ": ViewModel()"\n}\n', 'Z', false)).toEqual({ status: 'supertypes', names: ['Base'] })
  })

  it('T10: malformed or oversized headers return insufficient evidence and never a fabricated superclass', () => {
    expect(inspectKotlinClassSupertypes('class Z(', 'Z', false)).toEqual({ status: 'insufficient' })
    expect(inspectKotlinClassSupertypes('class Z(val a: Int', 'Z', true)).toEqual({ status: 'insufficient' })
    expect(inspectKotlinClassSupertypes('class Other : ViewModel() {', 'Z', false)).toEqual({ status: 'insufficient' })
    expect(inspectKotlinClassSupertypes('class Z : ViewModel(', 'Z', false)).toEqual({ status: 'insufficient' })
    expect(inspectKotlinClassSupertypes('class Z', 'Z', true)).toEqual({ status: 'insufficient' })
    // the declaration must be at the indexed line, not far below it
    expect(inspectKotlinClassSupertypes('\n\n\n\nclass Z : ViewModel() {', 'Z', false)).toEqual({ status: 'insufficient' })

    const params = Array.from({ length: 14 }, (_, i) => `    val p${i}: Int,`)
    const source = ['class BigViewModel(', ...params, ') : ViewModel() {', '}', ''].join('\n')
    const artifact = detectFromSource('Big.kt', source, [{ name: 'BigViewModel', needle: 'class BigViewModel', signature: 'class BigViewModel(' }], VIEWMODEL_IMPORT)
    // 12-line window cannot reach the supertype: no high superclass evidence; existing medium/name behavior only
    const [role] = rolesOf(artifact, 'BigViewModel')
    expect(role!.confidence).toBe('medium')
    expect(role!.evidence.some((e) => e.kind === 'superclass')).toBe(false)

    const missing = detectAndroidComponents({
      symbolIndex: symbolIndexOf([
        fileSummary({
          path: `${KT_DIR}/Gone.kt`,
          symbols: [symbol({ name: 'GoneViewModel', kind: 'class', signature: 'class GoneViewModel(', location: { file: `${KT_DIR}/Gone.kt`, line: 1 } })],
        }),
      ]),
      androidProject: androidProject(),
      projectRoot: makeProjectRoot(),
      createdAt: CREATED_AT,
    })
    cleanup()
    expect(missing.artifact.components[0]).toMatchObject({ role: 'view-model', confidence: 'low' })
  })

  it('T10b: supports annotations, constructor keyword, type parameters, supertype list on following lines and delegation', () => {
    expect(inspectKotlinClassSupertypes('@HiltViewModel\nclass X @Inject constructor(\n  val a: A\n) : ViewModel() {', 'X', false)).toEqual({
      status: 'supertypes',
      names: ['ViewModel'],
    })
    expect(inspectKotlinClassSupertypes('class X<T>(\n  val a: List<T>\n)\n  : Base<T>(),\n    Marker by delegate {', 'X', false)).toEqual({
      status: 'supertypes',
      names: ['Base', 'Marker'],
    })
    expect(inspectKotlinClassSupertypes('class X : androidx.lifecycle.ViewModel()', 'X', false)).toEqual({ status: 'supertypes', names: ['ViewModel'] })
    expect(inspectKotlinClassSupertypes('class X {\n}', 'X', false)).toEqual({ status: 'none' })
  })

  it('T11: other standard Android roles keep strong, corroborated and name-only behavior', () => {
    const cases: Array<{ cls: string; superclass: string; role: string; imports: string[] }> = [
      { cls: 'SomeActivity', superclass: 'AppCompatActivity', role: 'activity', imports: ['androidx.appcompat.app.AppCompatActivity'] },
      { cls: 'SomeFragment', superclass: 'Fragment', role: 'fragment', imports: ['androidx.fragment.app.Fragment'] },
      { cls: 'SomeService', superclass: 'Service', role: 'service', imports: ['android.app.Service'] },
      { cls: 'SomeReceiver', superclass: 'BroadcastReceiver', role: 'broadcast-receiver', imports: ['android.content.BroadcastReceiver'] },
      { cls: 'SomeProvider', superclass: 'ContentProvider', role: 'content-provider', imports: ['android.content.ContentProvider'] },
      { cls: 'SomeWorker', superclass: 'CoroutineWorker', role: 'worker', imports: ['androidx.work.CoroutineWorker', 'androidx.work.Worker'] },
    ]
    for (const c of cases) {
      const strong = detectFromSource(
        `${c.cls}.kt`,
        [`class ${c.cls}(`, '    private val dep: Dep', `) : ${c.superclass}() {`, '}', ''].join('\n'),
        [{ name: c.cls, needle: `class ${c.cls}`, signature: `class ${c.cls}(` }],
        c.imports
      )
      expect(rolesOf(strong, c.cls).map((r) => [r.role, r.confidence])).toEqual([[c.role, 'high']])
      const corroborated = detectFromSource(
        `${c.cls}2.kt`,
        `class ${c.cls} {\n}\n`,
        [{ name: c.cls, needle: `class ${c.cls}`, signature: `class ${c.cls} {` }],
        c.imports
      )
      expect(rolesOf(corroborated, c.cls).map((r) => [r.role, r.confidence])).toEqual([[c.role, 'medium']])
      const unrelated = detectFromSource(
        `Unrelated${c.cls}.kt`,
        'class Unrelated {\n}\n',
        [{ name: 'Unrelated', needle: 'class Unrelated', signature: 'class Unrelated {' }],
        c.imports
      )
      expect(rolesOf(unrelated, 'Unrelated')).toEqual([])
    }
  })

  it('T12: identical inputs produce identical roles, evidence, confidence and ordering', () => {
    const first = detectFromSource('Shared.kt', sharedImportSource, sharedClasses, VIEWMODEL_IMPORT)
    const second = detectFromSource('Shared.kt', sharedImportSource, sharedClasses, VIEWMODEL_IMPORT)
    expect(second).toEqual(first)
    expect(first.components.map((c) => c.id)).toEqual([...first.components.map((c) => c.id)].sort((a, b) => a.localeCompare(b)))
  })
})
