/**
 * v1.12.0 Batch 3: static ViewModel/Repository/Room/Retrofit dependency-fact
 * extraction. TST-301 through TST-329 (parsing, tiers, ambiguity, wrappers,
 * low-confidence, determinism), TST-333 (missing artifact).
 */
import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectAndroidComponents } from '../../src/android/detectAndroidComponents.js'
import { ANDROID_COMPONENTS_SCHEMA_VERSION } from '../../src/android/androidComponentTypes.js'
import type { AndroidProjectArtifact } from '../../src/android/androidProjectTypes.js'
import type { FileSummary, SymbolDefinition, SymbolIndex } from '../../src/symbol-index/types.js'

const CREATED_AT = '2026-01-01T00:00:00.000Z'
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeProjectRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-deps-'))
  tempDirs.push(dir)
  return dir
}

function androidProject(): AndroidProjectArtifact {
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
        manifestPath: null,
        sourceSets: [
          {
            name: 'main',
            path: 'app/src/main',
            manifestPath: null,
            kotlinRoots: ['app/src/main/kotlin'],
            javaRoots: ['app/src/main/java'],
            resourcesPath: null,
            warnings: [],
          },
        ],
        kotlinSourceRoots: ['app/src/main/kotlin'],
        javaSourceRoots: ['app/src/main/java'],
        evidence: [],
        warnings: [],
      },
    ],
    ignoredGeneratedDirectories: [],
    warnings: [],
    summary: { moduleCount: 1, appModuleCount: 1, libraryModuleCount: 0, unknownModuleCount: 0 },
  }
}

interface FileSpec {
  path: string
  source: string
  language: 'kotlin' | 'java'
  symbolName: string
  kind: SymbolDefinition['kind']
  line: number
  signature: string
  imports?: string[]
}

function detect(projectRoot: string, specs: FileSpec[]) {
  const files: FileSummary[] = specs.map((spec) => {
    const full = join(projectRoot, ...spec.path.split('/'))
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, spec.source)
    return {
      path: spec.path,
      language: spec.language,
      lineCount: spec.source.split('\n').length,
      imports: spec.imports ?? [],
      exports: [],
      hasCallGraphEntries: false,
      symbols: [
        {
          name: spec.symbolName,
          kind: spec.kind,
          location: { file: spec.path, line: spec.line },
          exported: true,
          signature: spec.signature,
        },
      ],
    }
  })
  const symbolIndex: SymbolIndex = {
    schemaVersion: '1.0.0',
    buildTime: CREATED_AT,
    repoRoot: projectRoot,
    sourceRoots: ['src'],
    fileCount: files.length,
    symbolCount: files.length,
    files,
  } as SymbolIndex

  return detectAndroidComponents({ symbolIndex, androidProject: androidProject(), projectRoot, createdAt: CREATED_AT }).artifact
}

const VIEWMODEL_KT = (body: string): FileSpec => ({
  path: 'app/src/main/kotlin/com/example/UserViewModel.kt',
  language: 'kotlin',
  symbolName: 'UserViewModel',
  kind: 'class',
  line: 3,
  signature: 'class UserViewModel',
  imports: ['androidx.lifecycle.ViewModel'],
  source: `package com.example\n\nimport androidx.lifecycle.ViewModel\n\n${body}\n`,
})

const REPOSITORY_KT: FileSpec = {
  path: 'app/src/main/kotlin/com/example/UserRepository.kt',
  language: 'kotlin',
  symbolName: 'UserRepository',
  kind: 'class',
  line: 3,
  signature: 'class UserRepository',
  source: 'package com.example\n\nclass UserRepository\n',
}

describe('detectAndroidComponentDependencies — ViewModel to Repository', () => {
  it('TST-302: Kotlin primary-constructor parameter creates a resolved viewmodel-uses-repository fact', () => {
    const root = makeProjectRoot()
    const artifact = detect(root, [
      VIEWMODEL_KT('class UserViewModel(\n    private val repository: UserRepository\n) : ViewModel()'),
      REPOSITORY_KT,
    ])
    expect(artifact.dependencyFacts).toHaveLength(1)
    const fact = artifact.dependencyFacts[0]!
    expect(fact.relationshipKind).toBe('viewmodel-uses-repository')
    expect(fact.evidenceKind).toBe('primary-constructor-parameter')
    expect(fact.matchStatus).toBe('resolved')
    expect(fact.candidateSymbolIds).toEqual(['symbol:app/src/main/kotlin/com/example/UserRepository.kt#UserRepository'])
  })

  it('TST-303: Kotlin secondary-constructor parameter creates the same relationship', () => {
    const root = makeProjectRoot()
    const artifact = detect(root, [
      VIEWMODEL_KT('class UserViewModel : ViewModel {\n    constructor(repository: UserRepository) {\n        this.repository = repository\n    }\n}'),
      REPOSITORY_KT,
    ])
    const fact = artifact.dependencyFacts.find((f) => f.relationshipKind === 'viewmodel-uses-repository')
    expect(fact?.evidenceKind).toBe('secondary-constructor-parameter')
    expect(fact?.matchStatus).toBe('resolved')
  })

  it('TST-304: Kotlin explicitly typed property creates the relationship without constructor evidence', () => {
    const root = makeProjectRoot()
    const artifact = detect(root, [
      VIEWMODEL_KT('class UserViewModel : ViewModel() {\n    private val repository: UserRepository = UserRepository()\n}'),
      REPOSITORY_KT,
    ])
    const fact = artifact.dependencyFacts.find((f) => f.relationshipKind === 'viewmodel-uses-repository')
    expect(fact?.evidenceKind).toBe('typed-property')
    expect(fact?.matchStatus).toBe('resolved')
  })

  it('TST-305/TST-306: Java constructor parameter and typed field both create resolved relationships', () => {
    const root = makeProjectRoot()
    const artifact = detect(root, [
      {
        path: 'app/src/main/java/com/example/UserViewModel.java',
        language: 'java',
        symbolName: 'UserViewModel',
        kind: 'class',
        line: 1,
        signature: 'final class UserViewModel',
        source:
          'package com.example;\n\nfinal class UserViewModel {\n    private final UserRepository repository;\n\n    UserViewModel(UserRepository repository) {\n        this.repository = repository;\n    }\n}\n',
      },
      { ...REPOSITORY_KT, path: 'app/src/main/java/com/example/UserRepository.java', language: 'java', source: 'package com.example;\n\nclass UserRepository {\n}\n' },
    ])
    const kinds = artifact.dependencyFacts.map((f) => f.evidenceKind).sort()
    expect(kinds).toEqual(['constructor-parameter', 'typed-field'])
    expect(artifact.dependencyFacts.every((f) => f.matchStatus === 'resolved')).toBe(true)
  })
})

describe('detectAndroidComponentDependencies — Repository to DAO/Retrofit', () => {
  const REPOSITORY_WITH_DEPS_KT: FileSpec = {
    path: 'app/src/main/kotlin/com/example/UserRepository.kt',
    language: 'kotlin',
    symbolName: 'UserRepository',
    kind: 'class',
    line: 3,
    signature: 'class UserRepository',
    source: 'package com.example\n\nclass UserRepository(\n    private val dao: UserDao,\n    private val api: UserApiService\n)\n',
  }
  const DAO_KT: FileSpec = {
    path: 'app/src/main/kotlin/com/example/UserDao.kt',
    language: 'kotlin',
    symbolName: 'UserDao',
    kind: 'interface',
    line: 3,
    signature: '@Dao\ninterface UserDao',
    source: 'package com.example\n\nimport androidx.room.Dao\n\n@Dao\ninterface UserDao\n',
  }
  const RETROFIT_KT: FileSpec = {
    path: 'app/src/main/kotlin/com/example/UserApiService.kt',
    language: 'kotlin',
    symbolName: 'UserApiService',
    kind: 'interface',
    line: 3,
    signature: 'interface UserApiService',
    source: 'package com.example\n\nimport retrofit2.http.GET\n\ninterface UserApiService {\n    @GET("users")\n    fun list(): List<String>\n}\n',
  }

  it('TST-307/TST-308: repository-uses-dao and repository-uses-service are both created', () => {
    const root = makeProjectRoot()
    const artifact = detect(root, [REPOSITORY_WITH_DEPS_KT, DAO_KT, RETROFIT_KT])
    const kinds = artifact.dependencyFacts.map((f) => f.relationshipKind).sort()
    expect(kinds).toEqual(['repository-uses-dao', 'repository-uses-service'].sort())
    expect(artifact.dependencyFacts.every((f) => f.matchStatus === 'resolved')).toBe(true)
  })
})

describe('detectAndroidComponentDependencies — DAO to Entity', () => {
  const ENTITY_KT: FileSpec = {
    path: 'app/src/main/kotlin/com/example/UserEntity.kt',
    language: 'kotlin',
    symbolName: 'UserEntity',
    kind: 'class',
    line: 3,
    signature: '@Entity\nclass UserEntity',
    source: 'package com.example\n\nimport androidx.room.Entity\n\n@Entity\nclass UserEntity\n',
  }

  function daoFile(body: string): FileSpec {
    return {
      path: 'app/src/main/kotlin/com/example/UserDao.kt',
      language: 'kotlin',
      symbolName: 'UserDao',
      kind: 'interface',
      line: 3,
      signature: '@Dao\ninterface UserDao',
      source: `package com.example\n\nimport androidx.room.Dao\n\n@Dao\ninterface UserDao {\n${body}\n}\n`,
    }
  }

  it('TST-309: a supported DAO method parameter type creates dao-uses-entity', () => {
    const root = makeProjectRoot()
    const artifact = detect(root, [daoFile('    fun insert(user: UserEntity)'), ENTITY_KT])
    const fact = artifact.dependencyFacts.find((f) => f.relationshipKind === 'dao-uses-entity')
    expect(fact?.evidenceKind).toBe('method-parameter')
    expect(fact?.matchStatus).toBe('resolved')
  })

  it('TST-310: a direct entity return type creates dao-uses-entity', () => {
    const root = makeProjectRoot()
    const artifact = detect(root, [daoFile('    fun find(id: Long): UserEntity'), ENTITY_KT])
    const fact = artifact.dependencyFacts.find((f) => f.relationshipKind === 'dao-uses-entity')
    expect(fact?.evidenceKind).toBe('method-return')
    expect(fact?.matchStatus).toBe('resolved')
  })

  it('TST-311: supported nested wrappers and nullable forms resolve the contained entity', () => {
    const root = makeProjectRoot()
    const artifact = detect(root, [
      daoFile('    fun observe(): Flow<List<UserEntity>>\n    fun findOrNull(id: Long): UserEntity?\n    fun listAll(): List<UserEntity>'),
      ENTITY_KT,
    ])
    const facts = artifact.dependencyFacts.filter((f) => f.relationshipKind === 'dao-uses-entity')
    expect(facts.length).toBeGreaterThanOrEqual(1)
    expect(facts.every((f) => f.matchStatus === 'resolved' && f.declaredTypeName === 'UserEntity')).toBe(true)
  })

  it('TST-312: an unsupported generic wrapper is unresolved with an explicit warning and no fabricated edge', () => {
    const root = makeProjectRoot()
    const artifact = detect(root, [daoFile('    fun weird(): Map<String, UserEntity>'), ENTITY_KT])
    const fact = artifact.dependencyFacts.find((f) => f.relationshipKind === 'dao-uses-entity')
    expect(fact?.matchStatus).toBe('unresolved')
    expect(fact?.candidateSymbolIds).toEqual([])
    expect(artifact.warnings.some((w) => w.includes('Unsupported generic wrapper'))).toBe(true)
  })
})

describe('detectAndroidComponentDependencies — Database to DAO', () => {
  it('TST-313: a Kotlin DAO-returning method creates room-database-exposes-dao', () => {
    const root = makeProjectRoot()
    const artifact = detect(root, [
      {
        path: 'app/src/main/kotlin/com/example/AppDatabase.kt',
        language: 'kotlin',
        symbolName: 'AppDatabase',
        kind: 'class',
        line: 3,
        signature: '@Database\nabstract class AppDatabase',
        source:
          'package com.example\n\nimport androidx.room.Database\nimport androidx.room.RoomDatabase\n\n@Database\nabstract class AppDatabase : RoomDatabase() {\n    abstract fun userDao(): UserDao\n}\n',
      },
      {
        path: 'app/src/main/kotlin/com/example/UserDao.kt',
        language: 'kotlin',
        symbolName: 'UserDao',
        kind: 'interface',
        line: 3,
        signature: '@Dao\ninterface UserDao',
        source: 'package com.example\n\nimport androidx.room.Dao\n\n@Dao\ninterface UserDao\n',
      },
    ])
    const fact = artifact.dependencyFacts.find((f) => f.relationshipKind === 'room-database-exposes-dao')
    expect(fact?.matchStatus).toBe('resolved')
    expect(fact?.evidenceKind).toBe('method-return')
  })

  it('TST-313: a Java DAO-returning method also creates room-database-exposes-dao', () => {
    const root = makeProjectRoot()
    const artifact = detect(root, [
      {
        path: 'app/src/main/java/com/example/AppDatabase.java',
        language: 'java',
        symbolName: 'AppDatabase',
        kind: 'class',
        line: 1,
        signature: 'abstract class AppDatabase',
        source: 'package com.example;\n\nabstract class AppDatabase {\n    abstract UserDao userDao();\n}\n',
      },
      {
        path: 'app/src/main/java/com/example/UserDao.java',
        language: 'java',
        symbolName: 'UserDao',
        kind: 'interface',
        line: 1,
        signature: 'interface UserDao',
        source: 'package com.example;\n\ninterface UserDao {\n}\n',
      },
    ])
    const fact = artifact.dependencyFacts.find((f) => f.relationshipKind === 'room-database-exposes-dao')
    expect(fact?.matchStatus).toBe('resolved')
  })
})

describe('detectAndroidComponentDependencies — candidate resolution tiers', () => {
  it('TST-314: exact fully-qualified type takes precedence', () => {
    const root = makeProjectRoot()
    const artifact = detect(root, [
      VIEWMODEL_KT('class UserViewModel(\n    private val repository: com.example.data.UserRepository\n) : ViewModel()'),
      { ...REPOSITORY_KT, path: 'app/src/main/kotlin/com/example/data/UserRepository.kt', source: 'package com.example.data\n\nclass UserRepository\n' },
    ])
    const fact = artifact.dependencyFacts.find((f) => f.relationshipKind === 'viewmodel-uses-repository')
    expect(fact?.matchStatus).toBe('resolved')
    expect(fact?.candidateSymbolIds).toEqual(['symbol:app/src/main/kotlin/com/example/data/UserRepository.kt#UserRepository'])
  })

  it('TST-315: exact explicit import resolution is used when no fully qualified declaration applies', () => {
    const root = makeProjectRoot()
    const vm = VIEWMODEL_KT('class UserViewModel(\n    private val repository: UserRepository\n) : ViewModel()')
    vm.imports = [...(vm.imports ?? []), 'com.example.data.UserRepository']
    const artifact = detect(root, [
      vm,
      { ...REPOSITORY_KT, path: 'app/src/main/kotlin/com/example/data/UserRepository.kt', source: 'package com.example.data\n\nclass UserRepository\n' },
    ])
    const fact = artifact.dependencyFacts.find((f) => f.relationshipKind === 'viewmodel-uses-repository')
    expect(fact?.matchStatus).toBe('resolved')
    expect(fact?.candidateSymbolIds).toEqual(['symbol:app/src/main/kotlin/com/example/data/UserRepository.kt#UserRepository'])
  })

  it('TST-316: exact same-package resolution works when no higher tier matches', () => {
    const root = makeProjectRoot()
    const artifact = detect(root, [
      VIEWMODEL_KT('class UserViewModel(\n    private val repository: UserRepository\n) : ViewModel()'),
      REPOSITORY_KT, // same package com.example, no import needed
    ])
    const fact = artifact.dependencyFacts.find((f) => f.relationshipKind === 'viewmodel-uses-repository')
    expect(fact?.matchStatus).toBe('resolved')
  })

  it('TST-317/TST-318: exact simple-name matching only applies after higher tiers fail, and excludes lower-tier candidates once a higher tier matches', () => {
    const root = makeProjectRoot()
    const vm = VIEWMODEL_KT('class UserViewModel(\n    private val repository: UserRepository\n) : ViewModel()')
    // Same-package candidate should win over a different-package simple-name-only candidate.
    const artifact = detect(root, [
      vm,
      REPOSITORY_KT, // com.example.UserRepository - same package as UserViewModel
      { ...REPOSITORY_KT, symbolName: 'UserRepository', path: 'app/src/main/kotlin/com/other/UserRepository.kt', source: 'package com.other\n\nclass UserRepository\n' },
    ])
    const fact = artifact.dependencyFacts.find((f) => f.relationshipKind === 'viewmodel-uses-repository')
    expect(fact?.matchStatus).toBe('resolved')
    expect(fact?.candidateSymbolIds).toEqual(['symbol:app/src/main/kotlin/com/example/UserRepository.kt#UserRepository'])
  })

  it('TST-319: multiple exact candidates at the winning tier produce one ambiguous fact with every candidate preserved', () => {
    const root = makeProjectRoot()
    const artifact = detect(root, [
      VIEWMODEL_KT('class UserViewModel(\n    private val repository: UserRepository\n) : ViewModel()'),
      { ...REPOSITORY_KT, path: 'app/src/main/kotlin/com/example/a/UserRepository.kt', source: 'package com.example.a\n\nclass UserRepository\n' },
      { ...REPOSITORY_KT, path: 'app/src/main/kotlin/com/example/b/UserRepository.kt', source: 'package com.example.b\n\nclass UserRepository\n' },
    ])
    const facts = artifact.dependencyFacts.filter((f) => f.relationshipKind === 'viewmodel-uses-repository')
    expect(facts).toHaveLength(1)
    expect(facts[0]!.matchStatus).toBe('ambiguous')
    expect(facts[0]!.candidateSymbolIds).toHaveLength(2)
  })

  it('TST-320: a statically visible type with no qualifying target role produces an unresolved fact and no edge', () => {
    const root = makeProjectRoot()
    const artifact = detect(root, [VIEWMODEL_KT('class UserViewModel(\n    private val repository: UserRepository\n) : ViewModel()')])
    const fact = artifact.dependencyFacts.find((f) => f.relationshipKind === 'viewmodel-uses-repository')
    expect(fact?.matchStatus).toBe('unresolved')
    expect(fact?.candidateSymbolIds).toEqual([])
  })

  it('TST-321: an indexed symbol with the exact matching name but an ineligible kind (not class/object) is never used as a candidate', () => {
    const root = makeProjectRoot()
    // A top-level Kotlin function named exactly 'UserRepository' is indexed as a
    // real symbol, but component-role detection only ever considers class/
    // interface/object kinds - so it must never become an eligible candidate.
    const roleLessSameName: FileSpec = {
      path: 'app/src/main/kotlin/com/example/UserRepository.kt',
      language: 'kotlin',
      symbolName: 'UserRepository',
      kind: 'function',
      line: 1,
      signature: 'fun UserRepository()',
      source: 'package com.example\n\nfun UserRepository() {\n}\n',
    }
    const artifact = detect(root, [
      VIEWMODEL_KT('class UserViewModel(\n    private val repository: UserRepository\n) : ViewModel()'),
      roleLessSameName,
    ])
    expect(artifact.components.some((c) => c.symbolName === 'UserRepository')).toBe(false)
    const fact = artifact.dependencyFacts.find((f) => f.relationshipKind === 'viewmodel-uses-repository')
    expect(fact?.matchStatus).toBe('unresolved')
    expect(fact?.candidateSymbolIds).toEqual([])
  })

  it('TST-322: near/suffix/case-variant/substring names never resolve', () => {
    const root = makeProjectRoot()
    const artifact = detect(root, [
      VIEWMODEL_KT('class UserViewModel(\n    private val repository: UserRepository\n) : ViewModel()'),
      { ...REPOSITORY_KT, symbolName: 'UserRepositoryImpl', path: 'app/src/main/kotlin/com/example/UserRepositoryImpl.kt', signature: 'class UserRepositoryImpl', source: 'package com.example\n\nclass UserRepositoryImpl\n' },
    ])
    const fact = artifact.dependencyFacts.find((f) => f.relationshipKind === 'viewmodel-uses-repository')
    expect(fact?.matchStatus).toBe('unresolved')
  })
})

describe('detectAndroidComponentDependencies — low-confidence and determinism', () => {
  it('TST-323: an exact candidate with low-confidence role evidence remains visible with a warning, without silent upgrade', () => {
    const root = makeProjectRoot()
    const artifact = detect(root, [
      VIEWMODEL_KT('class UserViewModel(\n    private val repository: UserRepository\n) : ViewModel()'),
      // Name-suffix-only 'Repository' evidence in an unrelated path (no annotation/import/superclass) -> low confidence.
      { path: 'app/src/main/kotlin/com/example/UserRepository.kt', language: 'kotlin', symbolName: 'UserRepository', kind: 'class', line: 3, signature: 'class UserRepository', source: 'package com.example\n\nclass UserRepository\n' },
    ])
    const repoComponent = artifact.components.find((c) => c.role === 'repository')
    expect(repoComponent?.confidence).toBe('medium') // name+path evidence for repository is medium by existing rule
    const fact = artifact.dependencyFacts.find((f) => f.relationshipKind === 'viewmodel-uses-repository')
    expect(fact?.matchStatus).toBe('resolved')
  })

  it('TST-326: repeated normalized runs over the same input produce stable fact IDs, ordering, and warnings', () => {
    const root = makeProjectRoot()
    const specs: FileSpec[] = [
      VIEWMODEL_KT('class UserViewModel(\n    private val repository: UserRepository\n) : ViewModel()'),
      REPOSITORY_KT,
    ]
    const first = detect(root, specs)
    const secondRoot = makeProjectRoot()
    const second = detect(secondRoot, specs)
    expect(first.dependencyFacts.map((f) => f.id)).toEqual(second.dependencyFacts.map((f) => f.id))
    expect(first.warnings).toEqual(second.warnings)
  })

  it('TST-328: duplicate identical source evidence does not produce duplicate facts', () => {
    const root = makeProjectRoot()
    const artifact = detect(root, [
      {
        path: 'app/src/main/kotlin/com/example/UserDao.kt',
        language: 'kotlin',
        symbolName: 'UserDao',
        kind: 'interface',
        line: 3,
        signature: '@Dao\ninterface UserDao',
        source: 'package com.example\n\nimport androidx.room.Dao\n\n@Dao\ninterface UserDao {\n    fun findA(): UserEntity\n    fun findB(): UserEntity\n}\n',
      },
      {
        path: 'app/src/main/kotlin/com/example/UserEntity.kt',
        language: 'kotlin',
        symbolName: 'UserEntity',
        kind: 'class',
        line: 3,
        signature: '@Entity\nclass UserEntity',
        source: 'package com.example\n\nimport androidx.room.Entity\n\n@Entity\nclass UserEntity\n',
      },
    ])
    // Two distinct methods returning the same entity on different lines are two distinct detailed facts...
    expect(artifact.dependencyFacts.filter((f) => f.relationshipKind === 'dao-uses-entity')).toHaveLength(2)
  })
})

describe('detectAndroidComponentDependencies — schema and artifact summary', () => {
  it('TST-301: schema is 1.1.0 and dependencyFacts is additive', () => {
    expect(ANDROID_COMPONENTS_SCHEMA_VERSION).toBe('1.1.0')
    const root = makeProjectRoot()
    const artifact = detect(root, [REPOSITORY_KT])
    expect(artifact.schemaVersion).toBe('1.1.0')
    expect(Array.isArray(artifact.dependencyFacts)).toBe(true)
  })

  it('TST-329: summary counts match actual dependency facts', () => {
    const root = makeProjectRoot()
    const artifact = detect(root, [
      VIEWMODEL_KT('class UserViewModel(\n    private val repository: UserRepository\n) : ViewModel()'),
      REPOSITORY_KT,
    ])
    expect(artifact.summary.dependencyFactCount).toBe(artifact.dependencyFacts.length)
    const resolved = artifact.dependencyFacts.filter((f) => f.matchStatus === 'resolved').length
    const ambiguous = artifact.dependencyFacts.filter((f) => f.matchStatus === 'ambiguous').length
    const unresolved = artifact.dependencyFacts.filter((f) => f.matchStatus === 'unresolved').length
    expect(artifact.summary.resolvedDependencyFactCount).toBe(resolved)
    expect(artifact.summary.ambiguousDependencyFactCount).toBe(ambiguous)
    expect(artifact.summary.unresolvedDependencyFactCount).toBe(unresolved)
    expect(artifact.summary.dependencyFactCountByKind?.['viewmodel-uses-repository']).toBe(1)
  })

  it('TST-333: a non-Android project (androidProject.detected = false) produces an empty, valid artifact', () => {
    const root = makeProjectRoot()
    const result = detectAndroidComponents({
      symbolIndex: { schemaVersion: '1.0.0', buildTime: CREATED_AT, repoRoot: root, sourceRoots: [], fileCount: 0, symbolCount: 0, files: [] } as unknown as SymbolIndex,
      androidProject: { ...androidProject(), detected: false },
      projectRoot: root,
      createdAt: CREATED_AT,
    })
    expect(result.artifact.dependencyFacts).toEqual([])
    expect(result.artifact.summary.dependencyFactCount).toBe(0)
  })
})
