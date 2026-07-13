/**
 * Detailed static Gradle project model (v1.10.0 Batch 1).
 *
 * Extends the v1.9.0 Android foundation: reuses `detectAndroidProject`'s
 * module/source-set discovery for *where* modules live, and layers detailed,
 * conservative Gradle evidence (plugins, dependencies, `android {}`
 * configuration, version catalogs) on top via `parseGradleEvidence.ts`.
 * Never executes Gradle, never resolves dependencies, never invents a
 * resolved value for a dynamic expression.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { toForwardSlash } from '../io/pathUtils.js'
import type { AndroidProjectArtifact } from './androidProjectTypes.js'
import {
  classifyAndroidGradleModuleType,
  parseAllDependencies,
  parseAllPlugins,
  parseAndroidBlock,
  parseSettingsEvidence,
  parseVersionCatalogToml,
} from './parseGradleEvidence.js'
import {
  ANDROID_GRADLE_ARTIFACT_KIND,
  ANDROID_GRADLE_SCHEMA_VERSION,
  type AndroidGradleAndroidBlock,
  type AndroidGradleArtifact,
  type AndroidGradleModule,
  type AndroidGradleSettingsEvidence,
  type AndroidGradleValue,
  type AndroidGradleVersionCatalog,
  type BuildAndroidGradleProjectResult,
} from './androidGradleTypes.js'

export interface BuildAndroidGradleProjectOptions {
  projectRoot: string
  androidProject: AndroidProjectArtifact
  /** Defaults to the current time, mirroring `detectAndroidProject`'s self-contained timestamp convention. */
  createdAt?: string
}

const SETTINGS_FILE_CANDIDATES = ['settings.gradle.kts', 'settings.gradle']
const VERSION_CATALOG_DEFAULT_RELATIVE_PATH = 'gradle/libs.versions.toml'

export function buildAndroidGradleProject(options: BuildAndroidGradleProjectOptions): BuildAndroidGradleProjectResult {
  const { projectRoot, androidProject, createdAt = new Date().toISOString() } = options
  const warnings: string[] = []
  const filesExamined = new Set<string>()

  const settingsFile = SETTINGS_FILE_CANDIDATES.find((name) => existsAsFile(projectRoot, name)) ?? null
  let settings: AndroidGradleSettingsEvidence | null = null
  if (settingsFile) {
    filesExamined.add(settingsFile)
    const settingsText = readFile(projectRoot, settingsFile)
    settings = settingsText ? parseSettingsEvidence(settingsText, toForwardSlash(settingsFile)) : null
  }

  const modules: AndroidGradleModule[] = []
  for (const projectModule of androidProject.modules) {
    const buildFileRel = projectModule.gradleFiles[0] ?? null
    const buildFile = buildFileRel ? toForwardSlash(buildFileRel) : null
    if (buildFile) filesExamined.add(buildFile)
    const buildText = buildFile ? readFile(projectRoot, buildFile) : null

    const dsl: 'groovy' | 'kotlin' | null = buildFile ? (buildFile.endsWith('.kts') ? 'kotlin' : 'groovy') : null
    const moduleType = buildText ? classifyAndroidGradleModuleType(buildText) : 'unknown'
    const plugins = buildText && buildFile ? parseAllPlugins(buildText, buildFile) : []
    const dependencies = buildText && buildFile ? parseAllDependencies(buildText, buildFile) : []
    const android = buildText && buildFile ? parseAndroidBlock(buildText, buildFile) : null

    const moduleWarnings: string[] = []
    if (!buildText) {
      moduleWarnings.push(`Module "${projectModule.path}" has no readable build file for detailed Gradle evidence.`)
    }

    modules.push({
      id: `android-gradle-module:${projectModule.path}`,
      gradlePath: modulePathToGradlePath(projectModule.path),
      directory: projectModule.path,
      buildFile,
      dsl,
      moduleType,
      sourceSetRefs: [...projectModule.sourceSets.map((set) => set.name)].sort(),
      plugins,
      android,
      dependencies,
      warnings: moduleWarnings.sort(),
    })
  }
  modules.sort((a, b) => (a.directory < b.directory ? -1 : a.directory > b.directory ? 1 : 0))

  const versionCatalogs: AndroidGradleVersionCatalog[] = []
  const catalogRelativePaths = new Set<string>()
  if (existsAsFile(projectRoot, VERSION_CATALOG_DEFAULT_RELATIVE_PATH)) {
    catalogRelativePaths.add(VERSION_CATALOG_DEFAULT_RELATIVE_PATH)
  }
  for (const extra of settings?.versionCatalogFiles ?? []) {
    catalogRelativePaths.add(extra)
  }
  for (const relPath of [...catalogRelativePaths].sort()) {
    if (!existsAsFile(projectRoot, relPath)) {
      warnings.push(`Version catalog "${relPath}" referenced but not found on disk.`)
      continue
    }
    filesExamined.add(toForwardSlash(relPath))
    const tomlText = readFile(projectRoot, relPath)
    if (tomlText === null) continue
    const catalog = parseVersionCatalogToml(tomlText, toForwardSlash(relPath))
    versionCatalogs.push(catalog)
    warnings.push(...catalog.warnings.map((w) => `${relPath}: ${w}`))
  }
  versionCatalogs.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))

  if (settings) filesExamined.add(settings.file)
  warnings.push(...(settings?.warnings ?? []))
  warnings.push(...modules.flatMap((m) => m.warnings))
  warnings.push(...modules.flatMap((m) => m.plugins.flatMap((p) => p.warnings)))
  warnings.push(...modules.flatMap((m) => m.dependencies.flatMap((d) => d.warnings)))
  warnings.push(...modules.flatMap((m) => (m.android ? collectAndroidBlockWarnings(m.android) : [])))

  const detected = modules.length > 0 || settings !== null
  const settingsFileCount = settings ? 1 : 0
  const buildFileCount = modules.filter((m) => m.buildFile !== null).length

  const artifact: AndroidGradleArtifact = {
    artifactKind: ANDROID_GRADLE_ARTIFACT_KIND,
    schemaVersion: ANDROID_GRADLE_SCHEMA_VERSION,
    createdAt,
    projectRoot: toForwardSlash(projectRoot),
    detected,
    filesExamined: [...filesExamined].sort(),
    settings,
    modules,
    versionCatalogs,
    warnings: sortedUnique(warnings),
    summary: {
      moduleCount: modules.length,
      settingsFileCount,
      buildFileCount,
      versionCatalogFileCount: versionCatalogs.length,
      warningCount: sortedUnique(warnings).length,
    },
  }

  return { artifact, evidenceFingerprint: computeEvidenceFingerprint(artifact) }
}

function unresolvedWarning(value: AndroidGradleValue<unknown> | null | undefined): string[] {
  return value && !value.resolved ? [value.warning] : []
}

/** Walks every unresolved-value slot in an `android {}` block and surfaces its warning at the artifact level, so a dynamic expression is never silently dropped. */
function collectAndroidBlockWarnings(android: AndroidGradleAndroidBlock): string[] {
  const warnings: string[] = [
    ...unresolvedWarning(android.namespace),
    ...unresolvedWarning(android.compileSdk),
    ...unresolvedWarning(android.applicationId),
    ...unresolvedWarning(android.minSdk),
    ...unresolvedWarning(android.targetSdk),
    ...unresolvedWarning(android.versionCode),
    ...unresolvedWarning(android.versionName),
    ...unresolvedWarning(android.testInstrumentationRunner),
    ...unresolvedWarning(android.buildFeatures?.compose),
    ...unresolvedWarning(android.buildFeatures?.viewBinding),
    ...unresolvedWarning(android.buildFeatures?.dataBinding),
    ...unresolvedWarning(android.buildFeatures?.buildConfig),
  ]
  for (const buildType of android.buildTypes) {
    warnings.push(
      ...unresolvedWarning(buildType.applicationIdSuffix),
      ...unresolvedWarning(buildType.versionNameSuffix),
      ...unresolvedWarning(buildType.debuggable),
      ...unresolvedWarning(buildType.minifyEnabled),
      ...unresolvedWarning(buildType.shrinkResources)
    )
  }
  for (const flavor of android.productFlavors) {
    warnings.push(
      ...unresolvedWarning(flavor.applicationId),
      ...unresolvedWarning(flavor.applicationIdSuffix),
      ...unresolvedWarning(flavor.versionNameSuffix),
      ...unresolvedWarning(flavor.minSdk),
      ...unresolvedWarning(flavor.targetSdk)
    )
  }
  return warnings
}

function modulePathToGradlePath(modulePath: string): string {
  if (modulePath === '.' || modulePath === '') return ':'
  return `:${modulePath.split('/').filter(Boolean).join(':')}`
}

/**
 * Excludes `createdAt` and `projectRoot` for the same reason
 * `detectAndroidProject`'s fingerprint does: an absolute, environment- and
 * run-specific value must never alone invalidate an otherwise-equivalent
 * incremental cache.
 */
function computeEvidenceFingerprint(artifact: AndroidGradleArtifact): string {
  const stable = { ...artifact, createdAt: '', projectRoot: '' }
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function resolvePath(projectRoot: string, relPath: string): string {
  return path.join(projectRoot, ...relPath.split('/'))
}

function existsAsFile(projectRoot: string, relPath: string): boolean {
  try {
    return fs.statSync(resolvePath(projectRoot, relPath)).isFile()
  } catch {
    return false
  }
}

function readFile(projectRoot: string, relPath: string): string | null {
  try {
    return fs.readFileSync(resolvePath(projectRoot, relPath), 'utf8')
  } catch {
    return null
  }
}
