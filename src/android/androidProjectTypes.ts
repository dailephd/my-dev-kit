export const ANDROID_PROJECT_ARTIFACT_KIND = 'my-dev-kit-v1-android-project'
export const ANDROID_PROJECT_SCHEMA_VERSION = '1.0.0'
export const ANDROID_PROJECT_FILENAME = 'android-project.json'

export type AndroidProjectConfidence = 'none' | 'low' | 'medium' | 'high'
export type AndroidModuleType = 'app' | 'library' | 'unknown'
export type AndroidSourceSetName = 'main' | 'test' | 'androidTest' | (string & {})

export interface AndroidSourceSet {
  name: AndroidSourceSetName
  path: string
  manifestPath: string | null
  kotlinRoots: string[]
  javaRoots: string[]
  resourcesPath: string | null
  warnings: string[]
}

export interface AndroidModule {
  id: string
  name: string
  path: string
  type: AndroidModuleType
  gradleFiles: string[]
  manifestPath: string | null
  sourceSets: AndroidSourceSet[]
  kotlinSourceRoots: string[]
  javaSourceRoots: string[]
  evidence: string[]
  warnings: string[]
}

export interface AndroidProjectSummary {
  moduleCount: number
  appModuleCount: number
  libraryModuleCount: number
  unknownModuleCount: number
}

export interface AndroidProjectArtifact {
  artifactKind: typeof ANDROID_PROJECT_ARTIFACT_KIND
  schemaVersion: typeof ANDROID_PROJECT_SCHEMA_VERSION
  createdAt: string
  projectRoot: string
  detected: boolean
  confidence: AndroidProjectConfidence
  evidence: string[]
  modules: AndroidModule[]
  ignoredGeneratedDirectories: string[]
  warnings: string[]
  summary: AndroidProjectSummary
}

export interface DetectAndroidProjectResult {
  artifact: AndroidProjectArtifact
  /** Deterministic fingerprint of every detection-relevant fact, for incremental-cache invalidation. */
  evidenceFingerprint: string
}
