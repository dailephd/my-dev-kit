/**
 * Discovers Android resource directories (`res/`, and each qualified
 * `res/<type>[-qualifiers]/` child) for every module the v1.9.0 Android
 * project detector found, using default source-set convention paths plus
 * any statically-visible custom resource directory from the v1.10.0 Batch 1
 * Gradle model (`sourceSets["<name>"].res.srcDirs(...)`). Mirrors
 * `discoverAndroidManifests.ts`'s discovery strategy. Never scans arbitrary
 * directories, never reads `build/` output, never executes Gradle, never
 * picks one source set as the runtime winner.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { toForwardSlash } from '../io/pathUtils.js'
import type { AndroidProjectArtifact } from './androidProjectTypes.js'
import type { AndroidGradleArtifact, AndroidGradleModule } from './androidGradleTypes.js'
import { parseResourceDirectoryName } from './parseResourceDirectoryName.js'
import type { AndroidResourceDirectory, ResourceDiscoverySource } from './androidResourceTypes.js'

export interface DiscoverAndroidResourceDirectoriesResult {
  directories: AndroidResourceDirectory[]
  warnings: string[]
}

export function discoverAndroidResourceDirectories(
  projectRoot: string,
  androidProject: AndroidProjectArtifact,
  androidGradle: AndroidGradleArtifact
): DiscoverAndroidResourceDirectoriesResult {
  const directories: AndroidResourceDirectory[] = []
  const warnings: string[] = []
  const gradleModuleByDirectory = new Map<string, AndroidGradleModule>(androidGradle.modules.map((m) => [m.directory, m]))

  for (const projectModule of androidProject.modules) {
    const gradleModule = gradleModuleByDirectory.get(projectModule.path) ?? null
    const gradlePath = gradleModule?.gradlePath ?? null

    const sourceSetNames = new Set<string>(['main', 'debug', 'release'])
    for (const set of projectModule.sourceSets) sourceSetNames.add(set.name)
    for (const flavor of gradleModule?.android?.productFlavors ?? []) sourceSetNames.add(flavor.name)
    for (const buildType of gradleModule?.android?.buildTypes ?? []) sourceSetNames.add(buildType.name)
    for (const override of gradleModule?.android?.sourceSetOverrides ?? []) sourceSetNames.add(override.name)

    const overridesByName = new Map((gradleModule?.android?.sourceSetOverrides ?? []).map((o) => [o.name, o]))

    for (const sourceSetName of [...sourceSetNames].sort()) {
      const override = overridesByName.get(sourceSetName)
      const resDirCandidates: Array<{ relPath: string; discoverySource: ResourceDiscoverySource }> = []

      if (override && override.resSrcDirs.length > 0) {
        for (const dir of override.resSrcDirs) {
          resDirCandidates.push({ relPath: joinModuleRelative(projectModule.path, dir), discoverySource: 'gradle-override' })
        }
      } else {
        resDirCandidates.push({ relPath: joinModuleRelative(projectModule.path, `src/${sourceSetName}/res`), discoverySource: 'default-convention' })
      }

      for (const candidate of resDirCandidates) {
        if (!existsAsDirectory(projectRoot, candidate.relPath)) {
          if (candidate.discoverySource === 'gradle-override') {
            warnings.push(
              `Custom resource directory "${candidate.relPath}" configured for module "${projectModule.path}" source set "${sourceSetName}" was not found on disk.`
            )
          }
          continue
        }

        for (const childName of listChildDirectories(projectRoot, candidate.relPath)) {
          const childRelPath = `${candidate.relPath}/${childName}`
          const { baseType, qualifiers } = parseResourceDirectoryName(childName)
          const dirWarnings: string[] = []
          if (baseType === 'unknown') {
            dirWarnings.push(`Resource directory "${childRelPath}" has an unrecognized base resource type "${childName.split('-')[0]}".`)
          }
          directories.push({
            id: `android-resource-dir:${toForwardSlash(childRelPath)}`,
            moduleId: projectModule.id,
            gradlePath,
            sourceSet: sourceSetName,
            path: toForwardSlash(childRelPath),
            baseType,
            rawDirectoryName: childName,
            qualifiers,
            discoverySource: candidate.discoverySource,
            warnings: dirWarnings,
          })
        }
      }
    }
  }

  return {
    directories: directories.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    warnings: [...new Set(warnings)].sort(),
  }
}

function joinModuleRelative(modulePath: string, relPath: string): string {
  return modulePath === '.' || modulePath === '' ? relPath : `${modulePath}/${relPath}`
}

function existsAsDirectory(projectRoot: string, relPath: string): boolean {
  try {
    return fs.statSync(path.join(projectRoot, ...relPath.split('/'))).isDirectory()
  } catch {
    return false
  }
}

function listChildDirectories(projectRoot: string, relPath: string): string[] {
  try {
    return fs
      .readdirSync(path.join(projectRoot, ...relPath.split('/')), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}
