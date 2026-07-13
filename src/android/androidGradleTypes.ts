export const ANDROID_GRADLE_ARTIFACT_KIND = 'my-dev-kit-v1-android-gradle'
export const ANDROID_GRADLE_SCHEMA_VERSION = '1.0.0'
export const ANDROID_GRADLE_FILENAME = 'android-gradle.json'

/** Source reference for a piece of static evidence: which file, and (when practical) which line. */
export interface AndroidGradleSourceRef {
  file: string
  line: number | null
}

/**
 * A statically-observed value that is either resolved to a literal, or left
 * unresolved because the source expression could not be evaluated without
 * running Gradle. Unresolved values always preserve the raw source text —
 * never an invented resolved value.
 */
export type AndroidGradleValue<T> =
  | { resolved: true; value: T; raw: string; source: AndroidGradleSourceRef }
  | { resolved: false; raw: string; source: AndroidGradleSourceRef; warning: string }

export type AndroidGradleDsl = 'groovy' | 'kotlin'

export interface AndroidGradleIncludedModule {
  path: string
  projectDir: string | null
  source: AndroidGradleSourceRef
}

export interface AndroidGradleIncludedBuild {
  path: string
  source: AndroidGradleSourceRef
}

export interface AndroidGradleSettingsEvidence {
  file: string
  dsl: AndroidGradleDsl | null
  rootProjectName: AndroidGradleValue<string> | null
  includedModules: AndroidGradleIncludedModule[]
  includedBuilds: AndroidGradleIncludedBuild[]
  versionCatalogFiles: string[]
  warnings: string[]
}

export type AndroidGradlePluginId =
  | { resolved: true; id: string }
  | { resolved: false; alias: string }

export interface AndroidGradlePlugin {
  plugin: AndroidGradlePluginId
  version: AndroidGradleValue<string> | null
  source: AndroidGradleSourceRef
  warnings: string[]
}

export type AndroidGradleDependencyKind =
  | 'external-module'
  | 'project'
  | 'version-catalog-alias'
  | 'platform'
  | 'file'
  | 'unknown'

export interface AndroidGradleDependency {
  configuration: string
  kind: AndroidGradleDependencyKind
  group: string | null
  artifact: string | null
  version: string | null
  projectPath: string | null
  catalogAlias: string | null
  raw: string
  source: AndroidGradleSourceRef
  warnings: string[]
}

export interface AndroidGradleBuildType {
  id: string
  name: string
  source: AndroidGradleSourceRef
  applicationIdSuffix: AndroidGradleValue<string> | null
  versionNameSuffix: AndroidGradleValue<string> | null
  debuggable: AndroidGradleValue<boolean> | null
  minifyEnabled: AndroidGradleValue<boolean> | null
  shrinkResources: AndroidGradleValue<boolean> | null
  proguardFiles: string[]
  matchingFallbacks: string[]
}

export interface AndroidGradleProductFlavor {
  id: string
  name: string
  dimension: string | null
  source: AndroidGradleSourceRef
  applicationId: AndroidGradleValue<string> | null
  applicationIdSuffix: AndroidGradleValue<string> | null
  versionNameSuffix: AndroidGradleValue<string> | null
  minSdk: AndroidGradleValue<number> | null
  targetSdk: AndroidGradleValue<number> | null
  manifestPlaceholders: Record<string, string>
}

export interface AndroidGradleSourceSetOverride {
  name: string
  manifestSrcFile: string | null
  javaSrcDirs: string[]
  kotlinSrcDirs: string[]
  resSrcDirs: string[]
  assetsSrcDirs: string[]
  aidlSrcDirs: string[]
  source: AndroidGradleSourceRef
}

export interface AndroidGradleBuildFeatures {
  compose: AndroidGradleValue<boolean> | null
  viewBinding: AndroidGradleValue<boolean> | null
  dataBinding: AndroidGradleValue<boolean> | null
  buildConfig: AndroidGradleValue<boolean> | null
}

export interface AndroidGradleAndroidBlock {
  namespace: AndroidGradleValue<string> | null
  compileSdk: AndroidGradleValue<number> | null
  applicationId: AndroidGradleValue<string> | null
  minSdk: AndroidGradleValue<number> | null
  targetSdk: AndroidGradleValue<number> | null
  versionCode: AndroidGradleValue<number> | null
  versionName: AndroidGradleValue<string> | null
  testInstrumentationRunner: AndroidGradleValue<string> | null
  buildFeatures: AndroidGradleBuildFeatures | null
  flavorDimensions: string[]
  buildTypes: AndroidGradleBuildType[]
  productFlavors: AndroidGradleProductFlavor[]
  sourceSetOverrides: AndroidGradleSourceSetOverride[]
  signingConfigNamesReferenced: string[]
}

export interface AndroidGradleModule {
  id: string
  gradlePath: string
  directory: string
  buildFile: string | null
  dsl: AndroidGradleDsl | null
  moduleType: 'app' | 'library' | 'test' | 'dynamic-feature' | 'unknown'
  sourceSetRefs: string[]
  plugins: AndroidGradlePlugin[]
  android: AndroidGradleAndroidBlock | null
  dependencies: AndroidGradleDependency[]
  warnings: string[]
}

export interface AndroidGradleVersionCatalogVersion {
  key: string
  value: string | null
  raw: string
  warning: string | null
}

export interface AndroidGradleVersionCatalogLibrary {
  alias: string
  group: string | null
  name: string | null
  module: string | null
  versionRef: string | null
  version: string | null
  warning: string | null
}

export interface AndroidGradleVersionCatalogBundle {
  alias: string
  libraries: string[]
}

export interface AndroidGradleVersionCatalogPlugin {
  alias: string
  id: string | null
  versionRef: string | null
  version: string | null
  warning: string | null
}

export interface AndroidGradleVersionCatalog {
  file: string
  versions: AndroidGradleVersionCatalogVersion[]
  libraries: AndroidGradleVersionCatalogLibrary[]
  bundles: AndroidGradleVersionCatalogBundle[]
  plugins: AndroidGradleVersionCatalogPlugin[]
  warnings: string[]
}

export interface AndroidGradleSummary {
  moduleCount: number
  settingsFileCount: number
  buildFileCount: number
  versionCatalogFileCount: number
  warningCount: number
}

export interface AndroidGradleArtifact {
  artifactKind: typeof ANDROID_GRADLE_ARTIFACT_KIND
  schemaVersion: typeof ANDROID_GRADLE_SCHEMA_VERSION
  createdAt: string
  projectRoot: string
  detected: boolean
  filesExamined: string[]
  settings: AndroidGradleSettingsEvidence | null
  modules: AndroidGradleModule[]
  versionCatalogs: AndroidGradleVersionCatalog[]
  warnings: string[]
  summary: AndroidGradleSummary
}

export interface BuildAndroidGradleProjectResult {
  artifact: AndroidGradleArtifact
  /** Deterministic fingerprint of every detection-relevant fact, for incremental-cache invalidation. */
  evidenceFingerprint: string
}
