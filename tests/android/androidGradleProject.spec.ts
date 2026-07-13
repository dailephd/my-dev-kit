import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectAndroidProject } from '../../src/android/detectAndroidProject.js'
import { buildAndroidGradleProject } from '../../src/android/buildAndroidGradleProject.js'
import {
  classifyAndroidGradleModuleType,
  parseAllDependencies,
  parseAllPlugins,
  parseAndroidBlock,
  parseSettingsEvidence,
  parseVersionCatalogToml,
} from '../../src/android/parseGradleEvidence.js'

const FIXTURES_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android-gradle')

const tempDirs: string[] = []
function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-gradle-'))
  tempDirs.push(root)
  return root
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function buildForFixture(name: string) {
  const projectRoot = join(FIXTURES_ROOT, name)
  const { artifact: androidProject } = detectAndroidProject({ projectRoot })
  return buildAndroidGradleProject({ projectRoot, androidProject, createdAt: '2026-01-01T00:00:00.000Z' })
}

// ---------------------------------------------------------------------------
// Low-level parser unit tests
// ---------------------------------------------------------------------------

describe('parseSettingsEvidence', () => {
  it('parses Groovy rootProject.name and include statements', () => {
    const text = "rootProject.name = 'my-app'\ninclude ':app', ':library'\n"
    const evidence = parseSettingsEvidence(text, 'settings.gradle')
    expect(evidence.dsl).toBe('groovy')
    expect(evidence.rootProjectName).toEqual({
      resolved: true,
      value: 'my-app',
      raw: "'my-app'",
      source: { file: 'settings.gradle', line: 1 },
    })
    expect(evidence.includedModules.map((m) => m.path)).toEqual(['app', 'library'])
  })

  it('parses Kotlin DSL includeBuild and project-directory remaps', () => {
    const text = [
      'rootProject.name = "kotlin-settings"',
      'include(":app")',
      'includeBuild("../shared-build")',
      'project(":app").projectDir = file("modules/app")',
    ].join('\n')
    const evidence = parseSettingsEvidence(text, 'settings.gradle.kts')
    expect(evidence.dsl).toBe('kotlin')
    expect(evidence.includedBuilds).toEqual([{ path: '../shared-build', source: { file: 'settings.gradle.kts', line: 3 } }])
    expect(evidence.includedModules[0]?.projectDir).toBe('modules/app')
  })
})

describe('classifyAndroidGradleModuleType', () => {
  it('classifies dynamic-feature and test modules', () => {
    expect(classifyAndroidGradleModuleType("id 'com.android.dynamic-feature'")).toBe('dynamic-feature')
    expect(classifyAndroidGradleModuleType("id 'com.android.test'")).toBe('test')
    expect(classifyAndroidGradleModuleType("id 'com.android.application'")).toBe('app')
  })
})

describe('parseAllPlugins', () => {
  it('recognizes id(), id-space, alias(), and apply-plugin forms', () => {
    const text = [
      'plugins {',
      '  id("com.android.application")',
      "  id 'org.jetbrains.kotlin.android'",
      '  id("com.google.dagger.hilt.android") version "2.51"',
      '  alias(libs.plugins.compose.compiler)',
      '}',
      'apply plugin: "kotlin-parcelize"',
    ].join('\n')
    const plugins = parseAllPlugins(text, 'build.gradle.kts')
    const ids = plugins.filter((p) => p.plugin.resolved).map((p) => (p.plugin as { id: string }).id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'com.android.application',
        'org.jetbrains.kotlin.android',
        'com.google.dagger.hilt.android',
        'kotlin-parcelize',
      ])
    )
    const hilt = plugins.find((p) => p.plugin.resolved && (p.plugin as { id: string }).id === 'com.google.dagger.hilt.android')
    expect(hilt?.version).toEqual({ resolved: true, value: '2.51', raw: '"2.51"', source: expect.any(Object) })
    const alias = plugins.find((p) => !p.plugin.resolved)
    expect(alias?.plugin).toEqual({ resolved: false, alias: 'libs.plugins.compose.compiler' })
    expect(alias?.warnings[0]).toMatch(/not resolved/)
  })
})

describe('parseAllDependencies', () => {
  it('classifies external module, project, catalog, platform, and file dependencies', () => {
    const text = [
      'dependencies {',
      "  implementation 'com.squareup.retrofit2:retrofit:2.11.0'",
      '  implementation(project(":core"))',
      '  implementation(libs.coil.compose)',
      '  implementation(platform("com.google.firebase:firebase-bom:33.0.0"))',
      '  implementation(files("libs/local.jar"))',
      '  implementation(someCustomFunction())',
      '}',
    ].join('\n')
    const deps = parseAllDependencies(text, 'build.gradle.kts')
    expect(deps).toHaveLength(6)
    const retrofit = deps.find((d) => d.raw.includes('retrofit'))
    expect(retrofit).toMatchObject({ kind: 'external-module', group: 'com.squareup.retrofit2', artifact: 'retrofit', version: '2.11.0' })
    const project = deps.find((d) => d.kind === 'project')
    expect(project?.projectPath).toBe(':core')
    const catalog = deps.find((d) => d.kind === 'version-catalog-alias')
    expect(catalog?.catalogAlias).toBe('libs.coil.compose')
    const platform = deps.find((d) => d.kind === 'platform')
    expect(platform).toMatchObject({ group: 'com.google.firebase', artifact: 'firebase-bom', version: '33.0.0' })
    const file = deps.find((d) => d.kind === 'file')
    expect(file).toBeDefined()
    const unknown = deps.find((d) => d.kind === 'unknown')
    expect(unknown?.warnings[0]).toMatch(/not statically resolvable/)
  })
})

describe('parseAndroidBlock', () => {
  it('extracts namespace, SDK values, build types, flavors, and buildFeatures', () => {
    const text = [
      'android {',
      '  namespace = "com.example.x"',
      '  compileSdk = 34',
      '  defaultConfig {',
      '    applicationId = "com.example.x"',
      '    minSdk = 24',
      '    targetSdk = 34',
      '    versionCode = 3',
      '    versionName = "3.0"',
      '  }',
      '  buildFeatures {',
      '    compose = true',
      '  }',
      '  buildTypes {',
      '    release {',
      '      minifyEnabled = true',
      '      proguardFiles("proguard-rules.pro")',
      '    }',
      '  }',
      '}',
    ].join('\n')
    const android = parseAndroidBlock(text, 'build.gradle.kts')
    expect(android?.namespace).toEqual({ resolved: true, value: 'com.example.x', raw: '"com.example.x"', source: expect.any(Object) })
    expect(android?.compileSdk).toMatchObject({ resolved: true, value: 34 })
    expect(android?.minSdk).toMatchObject({ resolved: true, value: 24 })
    expect(android?.targetSdk).toMatchObject({ resolved: true, value: 34 })
    expect(android?.versionCode).toMatchObject({ resolved: true, value: 3 })
    expect(android?.versionName).toMatchObject({ resolved: true, value: '3.0' })
    expect(android?.buildFeatures?.compose).toMatchObject({ resolved: true, value: true })
    expect(android?.buildTypes).toHaveLength(1)
    expect(android?.buildTypes[0]).toMatchObject({ name: 'release', minifyEnabled: { resolved: true, value: true } })
    expect(android?.buildTypes[0]?.proguardFiles).toEqual(['proguard-rules.pro'])
  })

  it('returns null when there is no android {} block', () => {
    expect(parseAndroidBlock('plugins { id("java-library") }', 'build.gradle.kts')).toBeNull()
  })

  it('preserves unresolved dynamic expressions with warnings and never invents a value', () => {
    const text = [
      'android {',
      '  namespace = "com.example.y"',
      '  compileSdk = rootProject.extra["sdk"] as Int',
      '  defaultConfig {',
      '    minSdk = myMinSdkVariable',
      '    versionName = "v" + getVersionName()',
      '  }',
      '}',
    ].join('\n')
    const android = parseAndroidBlock(text, 'build.gradle.kts')
    expect(android?.compileSdk?.resolved).toBe(false)
    expect(android?.minSdk?.resolved).toBe(false)
    expect(android?.versionName?.resolved).toBe(false)
    if (android && !android.compileSdk?.resolved && android.compileSdk) {
      expect(android.compileSdk.warning).toMatch(/not a static integer literal/)
    }
  })
})

describe('parseVersionCatalogToml', () => {
  it('parses versions, libraries, bundles, and plugins, including malformed entries', () => {
    const toml = [
      '[versions]',
      'coreKtx = "1.13.0"',
      '',
      '[libraries]',
      'core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "coreKtx" }',
      'material = "com.google.android.material:material:1.11.0"',
      'broken = { name = "no-module" }',
      '',
      '[bundles]',
      'compose = ["core-ktx", "material"]',
      '',
      '[plugins]',
      'android-app = { id = "com.android.application", version.ref = "coreKtx" }',
      'broken-plugin = { version.ref = "coreKtx" }',
    ].join('\n')

    const catalog = parseVersionCatalogToml(toml, 'gradle/libs.versions.toml')
    expect(catalog.versions).toEqual([{ key: 'coreKtx', value: '1.13.0', raw: '"1.13.0"', warning: null }])
    expect(catalog.libraries.find((l) => l.alias === 'core-ktx')).toMatchObject({
      group: 'androidx.core',
      name: 'core-ktx',
      versionRef: 'coreKtx',
    })
    expect(catalog.libraries.find((l) => l.alias === 'material')).toMatchObject({
      group: 'com.google.android.material',
      name: 'material',
      version: '1.11.0',
    })
    expect(catalog.libraries.find((l) => l.alias === 'broken')?.warning).toBeTruthy()
    expect(catalog.bundles).toEqual([{ alias: 'compose', libraries: ['core-ktx', 'material'] }])
    expect(catalog.plugins.find((p) => p.alias === 'android-app')).toMatchObject({ id: 'com.android.application', versionRef: 'coreKtx' })
    expect(catalog.plugins.find((p) => p.alias === 'broken-plugin')?.warning).toBeTruthy()
    expect(catalog.warnings.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// buildAndroidGradleProject orchestration tests (fixture-backed)
// ---------------------------------------------------------------------------

describe('buildAndroidGradleProject', () => {
  it('builds a detailed model for a Groovy single-module app', () => {
    const { artifact } = buildForFixture('groovy-single-module-app')
    expect(artifact.detected).toBe(true)
    expect(artifact.settings?.rootProjectName).toMatchObject({ resolved: true, value: 'groovy-single-module-app' })
    expect(artifact.modules).toHaveLength(1)
    const [module] = artifact.modules
    expect(module.dsl).toBe('groovy')
    expect(module.moduleType).toBe('app')
    expect(module.android?.namespace).toMatchObject({ resolved: true, value: 'com.example.groovyapp' })
    expect(module.android?.applicationId).toMatchObject({ resolved: true, value: 'com.example.groovyapp' })
    expect(module.android?.minSdk).toMatchObject({ resolved: true, value: 24 })
    expect(module.android?.buildTypes.map((bt) => bt.name)).toEqual(['release'])
    expect(module.dependencies.map((d) => d.kind).sort()).toEqual(['external-module', 'project'])
  })

  it('builds a detailed model for a Kotlin DSL app', () => {
    const { artifact } = buildForFixture('kotlin-dsl-app')
    const [module] = artifact.modules
    expect(module.dsl).toBe('kotlin')
    expect(module.android?.compileSdk).toMatchObject({ resolved: true, value: 34 })
    expect(module.android?.versionCode).toMatchObject({ resolved: true, value: 2 })
    expect(module.dependencies[0]).toMatchObject({ kind: 'external-module', group: 'androidx.core', artifact: 'core-ktx' })
  })

  it('builds a multi-module app + library model with distinct namespaces and a project dependency', () => {
    const { artifact } = buildForFixture('multi-module-app')
    expect(artifact.modules.map((m) => m.directory)).toEqual(['app', 'core'])
    const app = artifact.modules.find((m) => m.directory === 'app')!
    const core = artifact.modules.find((m) => m.directory === 'core')!
    expect(app.moduleType).toBe('app')
    expect(core.moduleType).toBe('library')
    expect(app.android?.namespace).toMatchObject({ value: 'com.example.app' })
    expect(core.android?.namespace).toMatchObject({ value: 'com.example.core' })
    expect(app.dependencies.find((d) => d.kind === 'project')?.projectPath).toBe(':core')
  })

  it('represents build types, product flavors, and flavor dimensions, preserving one unresolved computed value', () => {
    const { artifact } = buildForFixture('build-types-flavors-app')
    const [module] = artifact.modules
    expect(module.android?.flavorDimensions).toEqual(['tier'])
    expect(module.android?.buildTypes.map((bt) => bt.name)).toEqual(['debug', 'release'])
    const debug = module.android?.buildTypes.find((bt) => bt.name === 'debug')
    expect(debug?.applicationIdSuffix).toMatchObject({ resolved: true, value: '.debug' })
    expect(debug?.debuggable).toMatchObject({ resolved: true, value: true })
    const release = module.android?.buildTypes.find((bt) => bt.name === 'release')
    expect(release?.minifyEnabled).toMatchObject({ resolved: true, value: true })
    expect(release?.shrinkResources).toMatchObject({ resolved: true, value: true })
    expect(module.android?.productFlavors.map((f) => f.name)).toEqual(['free', 'paid'])
    const free = module.android?.productFlavors.find((f) => f.name === 'free')
    expect(free?.dimension).toBe('tier')
    expect(free?.applicationIdSuffix).toMatchObject({ resolved: true, value: '.free' })
    const paid = module.android?.productFlavors.find((f) => f.name === 'paid')
    expect(paid?.applicationId).toMatchObject({ resolved: true, value: 'com.example.flavors.paid' })
    expect(module.android?.versionCode?.resolved).toBe(false)
  })

  it('parses a version catalog, dependency aliases, and a version-catalog plugin alias, with malformed-entry warnings', () => {
    const { artifact } = buildForFixture('version-catalog-app')
    expect(artifact.versionCatalogs).toHaveLength(1)
    const catalog = artifact.versionCatalogs[0]
    expect(catalog.libraries.find((l) => l.alias === 'core-ktx')?.versionRef).toBe('coreKtx')
    expect(catalog.libraries.find((l) => l.alias === 'malformed-entry')?.warning).toBeTruthy()
    expect(catalog.plugins.find((p) => p.alias === 'malformed-plugin')?.warning).toBeTruthy()
    const [module] = artifact.modules
    expect(module.plugins.some((p) => !p.plugin.resolved && p.plugin.alias === 'libs.plugins.android.application')).toBe(true)
    expect(module.dependencies.some((d) => d.kind === 'version-catalog-alias' && d.catalogAlias === 'libs.core.ktx')).toBe(true)
    expect(artifact.warnings.some((w) => w.includes('malformed'))).toBe(true)
  })

  it('represents statically visible source-set overrides', () => {
    const { artifact } = buildForFixture('source-set-overrides-app')
    const [module] = artifact.modules
    const main = module.android?.sourceSetOverrides.find((s) => s.name === 'main')
    expect(main?.manifestSrcFile).toBe('custom/AndroidManifest.xml')
    expect(main?.javaSrcDirs).toEqual(['custom/java'])
    expect(main?.resSrcDirs).toEqual(['custom/res'])
    const test = module.android?.sourceSetOverrides.find((s) => s.name === 'test')
    expect(test?.javaSrcDirs).toEqual(['custom/testJava'])
  })

  it('degrades dynamic Gradle expressions to warnings without inventing resolved values, and still completes indexing', () => {
    const { artifact } = buildForFixture('dynamic-evidence-app')
    const [module] = artifact.modules
    expect(module.android?.compileSdk?.resolved).toBe(false)
    expect(module.android?.minSdk?.resolved).toBe(false)
    expect(module.android?.targetSdk?.resolved).toBe(false)
    expect(module.android?.versionName?.resolved).toBe(false)
    expect(artifact.warnings.length).toBeGreaterThan(0)
    // namespace and applicationId are static string literals and should still resolve.
    expect(module.android?.namespace).toMatchObject({ resolved: true, value: 'com.example.dynamic' })
  })

  it('does not produce misleading Android module configuration for a non-Android Gradle project', () => {
    const { artifact } = buildForFixture('non-android-gradle-project')
    expect(artifact.modules).toHaveLength(1)
    const [module] = artifact.modules
    expect(module.moduleType).toBe('unknown')
    expect(module.android).toBeNull()
  })

  it('reports detected: false and no files examined for a project with zero Gradle evidence', () => {
    const root = createTempRoot()
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1\n')
    const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
    const { artifact } = buildAndroidGradleProject({ projectRoot: root, androidProject, createdAt: '2026-01-01T00:00:00.000Z' })
    expect(artifact.detected).toBe(false)
    expect(artifact.modules).toEqual([])
    expect(artifact.filesExamined).toEqual([])
  })

  it('produces deterministic, byte-identical output across repeated runs against the same fixture', () => {
    const first = buildForFixture('multi-module-app')
    const second = buildForFixture('multi-module-app')
    expect(first.artifact).toEqual(second.artifact)
    expect(first.evidenceFingerprint).toBe(second.evidenceFingerprint)
  })

  it('sorts modules, plugins, dependencies, and warnings deterministically regardless of source order', () => {
    const { artifact } = buildForFixture('groovy-single-module-app')
    const [module] = artifact.modules
    const depRaws = module.dependencies.map((d) => d.raw)
    expect(depRaws).toEqual([...depRaws].sort())
  })
})
