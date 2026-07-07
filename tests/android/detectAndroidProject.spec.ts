import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectAndroidProject } from '../../src/android/detectAndroidProject.js'
import { parseGradleIncludes, detectAndroidPluginType } from '../../src/android/parseGradleEvidence.js'

const FIXTURES_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android')

const tempDirs: string[] = []
function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-detect-'))
  tempDirs.push(root)
  return root
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('parseGradleIncludes', () => {
  it('parses Groovy multi-arg include statements', () => {
    expect(parseGradleIncludes("include ':app', ':library'")).toEqual(['app', 'library'])
  })

  it('parses Kotlin-DSL repeated include(...) calls', () => {
    expect(parseGradleIncludes('include(":app")\ninclude(":feature:login")')).toEqual(['app', 'feature/login'])
  })

  it('returns an empty array when there is no include statement', () => {
    expect(parseGradleIncludes('rootProject.name = "x"')).toEqual([])
  })
})

describe('detectAndroidPluginType', () => {
  it('detects the application plugin', () => {
    expect(detectAndroidPluginType('id("com.android.application")')).toBe('app')
  })

  it('detects the library plugin', () => {
    expect(detectAndroidPluginType("id 'com.android.library'")).toBe('library')
  })

  it('returns unknown when neither plugin id is present', () => {
    expect(detectAndroidPluginType('id("java-library")')).toBe('unknown')
  })
})

describe('detectAndroidProject', () => {
  it('reports no evidence for a project with zero Gradle/Android files', () => {
    const root = createTempRoot()
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1\n')

    const { artifact } = detectAndroidProject({ projectRoot: root })

    expect(artifact.detected).toBe(false)
    expect(artifact.confidence).toBe('none')
    expect(artifact.modules).toEqual([])
    expect(artifact.evidence).toEqual([])
    expect(artifact.warnings).toEqual([])
  })

  it('detects a basic Kotlin app module with high confidence', () => {
    const { artifact } = detectAndroidProject({ projectRoot: join(FIXTURES_ROOT, 'basic-kotlin-app') })

    expect(artifact.detected).toBe(true)
    expect(artifact.confidence).toBe('high')
    expect(artifact.modules).toHaveLength(1)
    const [module] = artifact.modules
    expect(module.path).toBe('app')
    expect(module.type).toBe('app')
    expect(module.manifestPath).toBe('app/src/main/AndroidManifest.xml')
    expect(module.kotlinSourceRoots).toEqual(['app/src/main/kotlin', 'app/src/test/kotlin'])
    expect(module.javaSourceRoots).toEqual([])
    expect(module.sourceSets.map((set) => set.name)).toEqual(['main', 'test'])
    expect(artifact.summary).toEqual({ moduleCount: 1, appModuleCount: 1, libraryModuleCount: 0, unknownModuleCount: 0 })
  })

  it('detects a basic Java app module using Groovy settings.gradle/build.gradle', () => {
    const { artifact } = detectAndroidProject({ projectRoot: join(FIXTURES_ROOT, 'basic-java-app') })

    expect(artifact.detected).toBe(true)
    expect(artifact.confidence).toBe('high')
    const [module] = artifact.modules
    expect(module.type).toBe('app')
    expect(module.javaSourceRoots).toEqual(['app/src/main/java'])
    expect(module.kotlinSourceRoots).toEqual([])
  })

  it('detects app and library modules in a multi-module project, sorted by path', () => {
    const { artifact } = detectAndroidProject({ projectRoot: join(FIXTURES_ROOT, 'multi-module-app') })

    expect(artifact.detected).toBe(true)
    expect(artifact.modules.map((m) => m.path)).toEqual(['app', 'library'])
    expect(artifact.modules.find((m) => m.path === 'app')?.type).toBe('app')
    expect(artifact.modules.find((m) => m.path === 'library')?.type).toBe('library')
    expect(artifact.summary).toEqual({ moduleCount: 2, appModuleCount: 1, libraryModuleCount: 1, unknownModuleCount: 0 })
  })

  it('reports low confidence and no modules for a gradlew-only partial project', () => {
    const { artifact } = detectAndroidProject({ projectRoot: join(FIXTURES_ROOT, 'partial-android-project') })

    expect(artifact.detected).toBe(true)
    expect(artifact.confidence).toBe('low')
    expect(artifact.modules).toEqual([])
    expect(artifact.evidence).toEqual(['gradlew'])
  })

  it('reports ambiguous plugin evidence as a warning and type unknown', () => {
    const root = createTempRoot()
    mkdirSync(join(root, 'app'), { recursive: true })
    writeFileSync(join(root, 'app', 'build.gradle'), "plugins { id 'java-library' }\n")

    const { artifact } = detectAndroidProject({ projectRoot: root })

    expect(artifact.modules).toHaveLength(1)
    expect(artifact.modules[0].type).toBe('unknown')
    expect(artifact.modules[0].warnings.some((w) => w.includes('ambiguous'))).toBe(true)
  })

  it('warns when a module has no AndroidManifest.xml', () => {
    const root = createTempRoot()
    writeFileSync(join(root, 'settings.gradle'), "include ':library'\n")
    mkdirSync(join(root, 'library', 'src', 'main', 'kotlin'), { recursive: true })
    writeFileSync(join(root, 'library', 'build.gradle'), "plugins { id 'com.android.library' }\n")

    const { artifact } = detectAndroidProject({ projectRoot: root })

    const [module] = artifact.modules
    expect(module.manifestPath).toBeNull()
    expect(module.warnings.some((w) => w.includes('No AndroidManifest.xml'))).toBe(true)
    expect(artifact.confidence).toBe('medium')
  })

  it('warns about a declared module with no evidence on disk', () => {
    const root = createTempRoot()
    writeFileSync(join(root, 'settings.gradle'), "include ':app', ':phantom'\n")
    mkdirSync(join(root, 'app'), { recursive: true })
    writeFileSync(join(root, 'app', 'build.gradle'), "plugins { id 'com.android.application' }\n")
    mkdirSync(join(root, 'app', 'src', 'main'), { recursive: true })
    writeFileSync(join(root, 'app', 'src', 'main', 'AndroidManifest.xml'), '<manifest />\n')

    const { artifact } = detectAndroidProject({ projectRoot: root })

    expect(artifact.modules.map((m) => m.path)).toEqual(['app'])
    expect(artifact.warnings.some((w) => w.includes('phantom'))).toBe(true)
  })

  it('detects .gradle and build directories as ignored-generated evidence', () => {
    const root = createTempRoot()
    mkdirSync(join(root, 'app', '.gradle'), { recursive: true })
    mkdirSync(join(root, 'app', 'build'), { recursive: true })
    writeFileSync(join(root, 'app', 'build.gradle'), "plugins { id 'com.android.application' }\n")

    const { artifact } = detectAndroidProject({ projectRoot: root })

    expect(artifact.ignoredGeneratedDirectories).toEqual(['app/.gradle', 'app/build'])
  })

  it('treats a root build.gradle with Android plugin evidence as a single root module when no settings.gradle exists', () => {
    const root = createTempRoot()
    writeFileSync(join(root, 'build.gradle.kts'), 'plugins { id("com.android.application") }\n')
    mkdirSync(join(root, 'src', 'main', 'kotlin'), { recursive: true })
    writeFileSync(join(root, 'src', 'main', 'AndroidManifest.xml'), '<manifest />\n')

    const { artifact } = detectAndroidProject({ projectRoot: root })

    expect(artifact.modules).toHaveLength(1)
    expect(artifact.modules[0].path).toBe('.')
    expect(artifact.modules[0].kotlinSourceRoots).toEqual(['src/main/kotlin'])
  })

  it('produces deterministic, byte-identical output across repeated runs against the same fixture', () => {
    const first = detectAndroidProject({ projectRoot: join(FIXTURES_ROOT, 'multi-module-app') })
    const second = detectAndroidProject({ projectRoot: join(FIXTURES_ROOT, 'multi-module-app') })

    const normalize = (artifact: typeof first.artifact) => ({ ...artifact, createdAt: 'NORMALIZED' })
    expect(normalize(first.artifact)).toEqual(normalize(second.artifact))
    expect(first.evidenceFingerprint).toBe(second.evidenceFingerprint)
  })

  it('produces the same evidenceFingerprint for identically-structured projects at different absolute paths', () => {
    const rootA = createTempRoot()
    const rootB = createTempRoot()
    for (const root of [rootA, rootB]) {
      mkdirSync(join(root, 'app'), { recursive: true })
      writeFileSync(join(root, 'app', 'build.gradle'), "plugins { id 'com.android.application' }\n")
    }

    const resultA = detectAndroidProject({ projectRoot: rootA })
    const resultB = detectAndroidProject({ projectRoot: rootB })

    expect(resultA.evidenceFingerprint).toBe(resultB.evidenceFingerprint)
  })
})
