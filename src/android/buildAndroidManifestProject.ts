/**
 * Detailed static Android manifest model (v1.10.0 Batch 2).
 *
 * Discovers `AndroidManifest.xml` files via `discoverAndroidManifests`
 * (reusing v1.9.0 module/source-set detection and Batch 1 Gradle namespace/
 * custom-manifest-path evidence), parses each one independently via
 * `parseAndroidManifest`, and assembles the deterministic `android-manifest.json`
 * contract. Each source-set manifest is preserved as its own record — this
 * never simulates Android's manifest-merging algorithm.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { toForwardSlash } from '../io/pathUtils.js'
import type { AndroidProjectArtifact } from './androidProjectTypes.js'
import type { AndroidGradleArtifact } from './androidGradleTypes.js'
import { discoverAndroidManifests } from './discoverAndroidManifests.js'
import { parseAndroidManifest } from './parseAndroidManifest.js'
import {
  ANDROID_MANIFEST_ARTIFACT_KIND,
  ANDROID_MANIFEST_SCHEMA_VERSION,
  type AndroidManifestApplicationEvidence,
  type AndroidManifestArtifact,
  type AndroidManifestComponentEvidence,
  type AndroidManifestDeclaredPermissionEvidence,
  type AndroidManifestDeepLinkCandidate,
  type AndroidManifestFileRecord,
  type AndroidManifestIntentFilterEvidence,
  type AndroidManifestLauncherCandidate,
  type AndroidManifestMetadataEvidence,
  type AndroidManifestPermissionEvidence,
  type AndroidManifestUsesFeatureEvidence,
  type BuildAndroidManifestProjectResult,
} from './androidManifestTypes.js'

export interface BuildAndroidManifestProjectOptions {
  projectRoot: string
  androidProject: AndroidProjectArtifact
  androidGradle: AndroidGradleArtifact
  /** Defaults to the current time, mirroring `detectAndroidProject`/`buildAndroidGradleProject`'s self-contained timestamp convention. */
  createdAt?: string
}

export function buildAndroidManifestProject(options: BuildAndroidManifestProjectOptions): BuildAndroidManifestProjectResult {
  const { projectRoot, androidProject, androidGradle, createdAt = new Date().toISOString() } = options

  const discovery = discoverAndroidManifests(projectRoot, androidProject, androidGradle)
  const warnings: string[] = [...discovery.warnings]
  const filesExamined = new Set<string>()

  const manifests: AndroidManifestFileRecord[] = []
  const applications: AndroidManifestApplicationEvidence[] = []
  const components: AndroidManifestComponentEvidence[] = []
  const intentFilters: AndroidManifestIntentFilterEvidence[] = []
  const launcherCandidates: AndroidManifestLauncherCandidate[] = []
  const deepLinkCandidates: AndroidManifestDeepLinkCandidate[] = []
  const permissions: AndroidManifestPermissionEvidence[] = []
  const declaredPermissions: AndroidManifestDeclaredPermissionEvidence[] = []
  const usesFeatures: AndroidManifestUsesFeatureEvidence[] = []
  const metadata: AndroidManifestMetadataEvidence[] = []

  for (const candidate of discovery.candidates) {
    filesExamined.add(candidate.path)
    const xmlText = readFile(projectRoot, candidate.path)
    if (xmlText === null) {
      warnings.push(`Manifest "${candidate.path}" could not be read.`)
      continue
    }

    const result = parseAndroidManifest(xmlText, {
      filePath: candidate.path,
      moduleId: candidate.moduleId,
      gradlePath: candidate.gradlePath,
      sourceSet: candidate.sourceSet,
      discoverySource: candidate.discoverySource,
      gradleNamespace: candidate.gradleNamespace,
      applicationId: candidate.applicationId,
    })

    manifests.push(result.record)
    applications.push(...result.applications)
    components.push(...result.components)
    intentFilters.push(...result.intentFilters)
    launcherCandidates.push(...result.launcherCandidates)
    deepLinkCandidates.push(...result.deepLinkCandidates)
    permissions.push(...result.permissions)
    declaredPermissions.push(...result.declaredPermissions)
    usesFeatures.push(...result.usesFeatures)
    metadata.push(...result.metadata)
    warnings.push(...result.record.warnings.map((w) => `${candidate.path}: ${w}`))
    warnings.push(...componentWarningsFor(result.components, candidate.path))
    warnings.push(...deepLinkWarningsFor(result.deepLinkCandidates, candidate.path))
  }

  const detected = manifests.length > 0

  const artifact: AndroidManifestArtifact = {
    artifactKind: ANDROID_MANIFEST_ARTIFACT_KIND,
    schemaVersion: ANDROID_MANIFEST_SCHEMA_VERSION,
    createdAt,
    projectRoot: toForwardSlash(projectRoot),
    detected,
    filesExamined: [...filesExamined].sort(),
    manifests: sortById(manifests),
    applications: sortById(applications),
    components: sortById(components),
    intentFilters: sortById(intentFilters),
    launcherCandidates: sortById(launcherCandidates),
    deepLinkCandidates: sortById(deepLinkCandidates),
    permissions: sortById(permissions),
    declaredPermissions: sortById(declaredPermissions),
    usesFeatures: sortById(usesFeatures),
    metadata: sortById(metadata),
    warnings: [...new Set(warnings)].sort(),
    summary: {
      moduleCount: new Set(manifests.map((m) => m.moduleId)).size,
      manifestFileCount: manifests.length,
      applicationCount: applications.length,
      componentCount: components.length,
      permissionCount: permissions.length,
      intentFilterCount: intentFilters.length,
      deepLinkCount: deepLinkCandidates.length,
      warningCount: [...new Set(warnings)].length,
    },
  }

  return { artifact, evidenceFingerprint: computeEvidenceFingerprint(artifact) }
}

function componentWarningsFor(components: AndroidManifestComponentEvidence[], filePath: string): string[] {
  return components.flatMap((c) => c.warnings.map((w) => `${filePath}: ${w}`))
}

function deepLinkWarningsFor(candidates: AndroidManifestDeepLinkCandidate[], filePath: string): string[] {
  return candidates.flatMap((c) => c.warnings.map((w) => `${filePath}: ${w}`))
}

function sortById<T extends { id: string }>(values: T[]): T[] {
  return [...values].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function computeEvidenceFingerprint(artifact: AndroidManifestArtifact): string {
  const stable = { ...artifact, createdAt: '', projectRoot: '' }
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}

function readFile(projectRoot: string, relPath: string): string | null {
  try {
    return fs.readFileSync(path.join(projectRoot, ...relPath.split('/')), 'utf8')
  } catch {
    return null
  }
}
