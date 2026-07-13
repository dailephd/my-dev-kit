/**
 * Discovers `AndroidManifest.xml` candidates for every module the v1.9.0
 * Android project detector found, using default source-set convention paths
 * plus any statically-visible custom manifest path from the v1.10.0 Batch 1
 * Gradle model (`sourceSets["<name>"].manifest.srcFile(...)`). Never scans
 * arbitrary XML files, never reads build-output directories, never executes
 * Gradle to ask for source sets, never picks a single "effective" manifest.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { toForwardSlash } from '../io/pathUtils.js'
import type { AndroidProjectArtifact } from './androidProjectTypes.js'
import type { AndroidGradleArtifact, AndroidGradleModule } from './androidGradleTypes.js'
import type { ManifestDiscoverySource } from './androidManifestTypes.js'

export interface ManifestDiscoveryCandidate {
  path: string
  moduleId: string
  gradlePath: string | null
  sourceSet: string
  discoverySource: ManifestDiscoverySource
  gradleNamespace: string | null
  applicationId: string | null
}

export interface DiscoverAndroidManifestsResult {
  candidates: ManifestDiscoveryCandidate[]
  warnings: string[]
}

export function discoverAndroidManifests(
  projectRoot: string,
  androidProject: AndroidProjectArtifact,
  androidGradle: AndroidGradleArtifact
): DiscoverAndroidManifestsResult {
  const candidates: ManifestDiscoveryCandidate[] = []
  const warnings: string[] = []
  const gradleModuleByDirectory = new Map<string, AndroidGradleModule>(androidGradle.modules.map((m) => [m.directory, m]))

  for (const projectModule of androidProject.modules) {
    const gradleModule = gradleModuleByDirectory.get(projectModule.path) ?? null
    const gradleNamespace = gradleModule?.android?.namespace?.resolved ? gradleModule.android.namespace.value : null
    const applicationId = gradleModule?.android?.applicationId?.resolved ? gradleModule.android.applicationId.value : null
    const gradlePath = gradleModule?.gradlePath ?? null

    // 'debug'/'release' are always-present implicit AGP build types even when
    // a module's build.gradle(.kts) never declares a `buildTypes {}` block.
    const sourceSetNames = new Set<string>(['main', 'debug', 'release'])
    for (const set of projectModule.sourceSets) sourceSetNames.add(set.name)
    for (const flavor of gradleModule?.android?.productFlavors ?? []) sourceSetNames.add(flavor.name)
    for (const buildType of gradleModule?.android?.buildTypes ?? []) sourceSetNames.add(buildType.name)
    for (const override of gradleModule?.android?.sourceSetOverrides ?? []) sourceSetNames.add(override.name)

    const overridesByName = new Map((gradleModule?.android?.sourceSetOverrides ?? []).map((o) => [o.name, o]))

    for (const sourceSetName of [...sourceSetNames].sort()) {
      const override = overridesByName.get(sourceSetName)
      if (override?.manifestSrcFile) {
        const overridePath = joinModuleRelative(projectModule.path, override.manifestSrcFile)
        if (existsAsFile(projectRoot, overridePath)) {
          candidates.push({
            path: toForwardSlash(overridePath),
            moduleId: projectModule.id,
            gradlePath,
            sourceSet: sourceSetName,
            discoverySource: 'gradle-override',
            gradleNamespace,
            applicationId,
          })
        } else {
          warnings.push(
            `Custom manifest path "${overridePath}" configured for module "${projectModule.path}" source set "${sourceSetName}" was not found on disk.`
          )
        }
        continue
      }

      const defaultPath = joinModuleRelative(projectModule.path, `src/${sourceSetName}/AndroidManifest.xml`)
      if (existsAsFile(projectRoot, defaultPath)) {
        candidates.push({
          path: toForwardSlash(defaultPath),
          moduleId: projectModule.id,
          gradlePath,
          sourceSet: sourceSetName,
          discoverySource: 'default-convention',
          gradleNamespace,
          applicationId,
        })
      }
    }
  }

  return {
    candidates: candidates.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    warnings: [...new Set(warnings)].sort(),
  }
}

function joinModuleRelative(modulePath: string, relPath: string): string {
  return modulePath === '.' || modulePath === '' ? relPath : `${modulePath}/${relPath}`
}

function existsAsFile(projectRoot: string, relPath: string): boolean {
  try {
    return fs.statSync(path.join(projectRoot, ...relPath.split('/'))).isFile()
  } catch {
    return false
  }
}
