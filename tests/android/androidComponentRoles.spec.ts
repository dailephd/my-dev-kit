import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectAndroidComponents } from '../../src/android/detectAndroidComponents.js'
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
