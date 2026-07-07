/**
 * Static Android project detector (v1.9.0 Batch 1 foundation).
 *
 * Detects Gradle/Android project, module, and source-set structure from
 * file existence and conservative text-substring evidence only. Never
 * executes Gradle, never resolves dependencies, never parses Kotlin/Java
 * symbols. See docs/COMMANDS.md "Android project detection" for the
 * static-analysis boundary this detector deliberately stays within.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { toForwardSlash } from '../io/pathUtils.js'
import { detectAndroidPluginType, parseGradleIncludes } from './parseGradleEvidence.js'
import {
  ANDROID_PROJECT_ARTIFACT_KIND,
  ANDROID_PROJECT_SCHEMA_VERSION,
  type AndroidModule,
  type AndroidModuleType,
  type AndroidProjectArtifact,
  type AndroidProjectConfidence,
  type AndroidSourceSet,
  type DetectAndroidProjectResult,
} from './androidProjectTypes.js'

const ROOT_EVIDENCE_FILES = [
  'settings.gradle',
  'settings.gradle.kts',
  'build.gradle',
  'build.gradle.kts',
  'gradlew',
  'gradlew.bat',
  'gradle/libs.versions.toml',
  'AndroidManifest.xml',
  'src/main/AndroidManifest.xml',
] as const

const SOURCE_SET_NAMES = ['main', 'test', 'androidTest'] as const
const GENERATED_DIR_NAMES = ['build', '.gradle'] as const
const SOURCE_SET_SORT_RANK: Record<string, number> = { main: 0, test: 1, androidTest: 2 }

export interface DetectAndroidProjectOptions {
  projectRoot: string
}

export function detectAndroidProject(options: DetectAndroidProjectOptions): DetectAndroidProjectResult {
  const projectRoot = options.projectRoot

  const rootEvidence = ROOT_EVIDENCE_FILES.filter((relPath) => existsAsFile(projectRoot, relPath)).map(toForwardSlash)

  const settingsText = readFirstExistingFile(projectRoot, ['settings.gradle.kts', 'settings.gradle'])
  const declaredModulePaths = settingsText ? parseGradleIncludes(settingsText) : []

  const candidatePaths = new Set<string>(declaredModulePaths)
  if (existsAsFile(projectRoot, 'app/build.gradle') || existsAsFile(projectRoot, 'app/build.gradle.kts')) {
    candidatePaths.add('app')
  }
  const rootBuildText = readFirstExistingFile(projectRoot, ['build.gradle.kts', 'build.gradle'])
  if (rootBuildText && detectAndroidPluginType(rootBuildText) !== 'unknown') {
    candidatePaths.add('.')
  }

  const modules: AndroidModule[] = []
  const warnings: string[] = []

  for (const modulePath of [...candidatePaths].sort()) {
    const { module, hasAnyEvidence } = buildModuleEvidence(projectRoot, modulePath)
    if (hasAnyEvidence) {
      modules.push(module)
    } else {
      warnings.push(`Declared module "${normalizeModulePath(modulePath)}" has no evidence on disk.`)
    }
  }

  const ignoredGeneratedDirectories = detectExistingIgnoredDirectories(projectRoot, [...candidatePaths, '.'])
  const confidence = computeConfidence(modules, rootEvidence)
  const detected = confidence !== 'none'

  const evidence = sortedUnique([...rootEvidence, ...modules.flatMap((module) => module.evidence)])

  const artifact: AndroidProjectArtifact = {
    artifactKind: ANDROID_PROJECT_ARTIFACT_KIND,
    schemaVersion: ANDROID_PROJECT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    projectRoot: toForwardSlash(projectRoot),
    detected,
    confidence,
    evidence,
    modules: sortByPath(modules),
    ignoredGeneratedDirectories: sortedUnique(ignoredGeneratedDirectories),
    warnings: sortedUnique(warnings),
    summary: {
      moduleCount: modules.length,
      appModuleCount: modules.filter((module) => module.type === 'app').length,
      libraryModuleCount: modules.filter((module) => module.type === 'library').length,
      unknownModuleCount: modules.filter((module) => module.type === 'unknown').length,
    },
  }

  return { artifact, evidenceFingerprint: computeEvidenceFingerprint(artifact) }
}

function buildModuleEvidence(projectRoot: string, modulePath: string): { module: AndroidModule; hasAnyEvidence: boolean } {
  const gradleRelPaths = ['build.gradle', 'build.gradle.kts']
    .map((name) => joinRel(modulePath, name))
    .filter((relPath) => existsAsFile(projectRoot, relPath))
  const buildText = gradleRelPaths.length > 0 ? readFirstExistingFile(projectRoot, gradleRelPaths) : null
  const type: AndroidModuleType = buildText ? detectAndroidPluginType(buildText) : 'unknown'

  const manifestRelPath = joinRel(modulePath, 'src/main/AndroidManifest.xml')
  const manifestPath = existsAsFile(projectRoot, manifestRelPath) ? toForwardSlash(manifestRelPath) : null

  const sourceSets = buildSourceSets(projectRoot, modulePath)
  const normalizedPath = normalizeModulePath(modulePath)

  const warnings: string[] = []
  if (buildText && type === 'unknown') {
    warnings.push(`Module "${normalizedPath}" has ambiguous or missing Android plugin evidence.`)
  }
  if (!manifestPath && (type !== 'unknown' || sourceSets.length > 0)) {
    warnings.push(`No AndroidManifest.xml found for module "${normalizedPath}".`)
  }

  const gradleFiles = sortedUnique(gradleRelPaths.map(toForwardSlash))
  const hasAnyEvidence = gradleFiles.length > 0 || manifestPath !== null || sourceSets.length > 0

  const module: AndroidModule = {
    id: `android-module:${normalizedPath}`,
    name: modulePath === '.' ? path.basename(path.resolve(projectRoot)) : path.basename(modulePath),
    path: normalizedPath,
    type,
    gradleFiles,
    manifestPath,
    sourceSets: sortSourceSets(sourceSets),
    kotlinSourceRoots: sortedUnique(sourceSets.flatMap((set) => set.kotlinRoots)),
    javaSourceRoots: sortedUnique(sourceSets.flatMap((set) => set.javaRoots)),
    evidence: sortedUnique([...gradleFiles, ...(manifestPath ? [manifestPath] : []), ...sourceSets.map((set) => set.path)]),
    warnings: sortedUnique(warnings),
  }

  return { module, hasAnyEvidence }
}

function buildSourceSets(projectRoot: string, modulePath: string): AndroidSourceSet[] {
  const result: AndroidSourceSet[] = []
  for (const setName of SOURCE_SET_NAMES) {
    const base = joinRel(modulePath, `src/${setName}`)
    const kotlinRel = joinRel(base, 'kotlin')
    const javaRel = joinRel(base, 'java')
    const kotlinRoot = existsAsDirectory(projectRoot, kotlinRel) ? toForwardSlash(kotlinRel) : null
    const javaRoot = existsAsDirectory(projectRoot, javaRel) ? toForwardSlash(javaRel) : null
    const manifestRel = joinRel(base, 'AndroidManifest.xml')
    const manifestPath = setName === 'main' && existsAsFile(projectRoot, manifestRel) ? toForwardSlash(manifestRel) : null
    const resourcesRel = joinRel(base, 'res')
    const resourcesPath = existsAsDirectory(projectRoot, resourcesRel) ? toForwardSlash(resourcesRel) : null

    if (kotlinRoot || javaRoot || manifestPath) {
      result.push({
        name: setName,
        path: toForwardSlash(base),
        manifestPath,
        kotlinRoots: kotlinRoot ? [kotlinRoot] : [],
        javaRoots: javaRoot ? [javaRoot] : [],
        resourcesPath,
        warnings: [],
      })
    }
  }
  return result
}

function detectExistingIgnoredDirectories(projectRoot: string, basePaths: string[]): string[] {
  const found: string[] = []
  for (const base of new Set(basePaths)) {
    for (const name of GENERATED_DIR_NAMES) {
      const rel = joinRel(base, name)
      if (existsAsDirectory(projectRoot, rel)) found.push(toForwardSlash(rel))
    }
  }
  return found
}

function computeConfidence(modules: AndroidModule[], rootEvidence: string[]): AndroidProjectConfidence {
  const hasHighConfidenceModule = modules.some(
    (module) => (module.type === 'app' || module.type === 'library') && module.manifestPath !== null
  )
  if (hasHighConfidenceModule) return 'high'
  if (modules.length > 0) return 'medium'
  if (rootEvidence.length > 0) return 'low'
  return 'none'
}

/**
 * Excludes `createdAt` (a timestamp) and `projectRoot` (an absolute,
 * environment-specific path) so the fingerprint depends only on the
 * detected structure itself — matching the rest of the incremental-cache
 * design, which never lets an absolute-path difference alone invalidate a
 * cache that would otherwise still be valid (e.g. a repo checked out to a
 * different path).
 */
function computeEvidenceFingerprint(artifact: AndroidProjectArtifact): string {
  const stable = { ...artifact, createdAt: '', projectRoot: '' }
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}

function joinRel(base: string, sub: string): string {
  if (base === '.' || base === '') return sub
  return `${base}/${sub}`
}

function normalizeModulePath(modulePath: string): string {
  return modulePath === '' ? '.' : modulePath
}

function sortByPath(modules: AndroidModule[]): AndroidModule[] {
  return [...modules].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

function sortSourceSets(sets: AndroidSourceSet[]): AndroidSourceSet[] {
  return [...sets].sort((a, b) => {
    const rankDiff = (SOURCE_SET_SORT_RANK[a.name] ?? 99) - (SOURCE_SET_SORT_RANK[b.name] ?? 99)
    if (rankDiff !== 0) return rankDiff
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function resolvePath(projectRoot: string, relPath: string): string {
  if (relPath === '.' || relPath === '') return projectRoot
  return path.join(projectRoot, ...relPath.split('/'))
}

function existsAsFile(projectRoot: string, relPath: string): boolean {
  try {
    return fs.statSync(resolvePath(projectRoot, relPath)).isFile()
  } catch {
    return false
  }
}

function existsAsDirectory(projectRoot: string, relPath: string): boolean {
  try {
    return fs.statSync(resolvePath(projectRoot, relPath)).isDirectory()
  } catch {
    return false
  }
}

function readFirstExistingFile(projectRoot: string, relPaths: string[]): string | null {
  for (const relPath of relPaths) {
    if (existsAsFile(projectRoot, relPath)) {
      try {
        return fs.readFileSync(resolvePath(projectRoot, relPath), 'utf8')
      } catch {
        return null
      }
    }
  }
  return null
}
