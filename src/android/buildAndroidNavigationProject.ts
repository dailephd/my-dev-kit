/**
 * Assembles the final `android-navigation.json` artifact by merging the
 * early-computed XML navigation model (`buildAndroidNavigationXmlModel`,
 * independent of Kotlin/Java indexing) with the late-computed static
 * Compose route evidence (`buildComposeNavigationRoutes`, which needs the
 * already-built `symbolIndex`). XML and Compose evidence are kept in
 * clearly separate arrays — this batch never infers a relationship between
 * an XML destination and a Compose route from name/string similarity alone.
 */

import { createHash } from 'node:crypto'
import { toForwardSlash } from '../io/pathUtils.js'
import type { SymbolIndex } from '../symbol-index/types.js'
import type { AndroidProjectArtifact } from './androidProjectTypes.js'
import type { AndroidGradleArtifact } from './androidGradleTypes.js'
import type { AndroidResourcesArtifact } from './androidResourceTypes.js'
import { buildAndroidNavigationXmlModel, type AndroidNavigationXmlModel } from './buildAndroidNavigationXmlModel.js'
import { buildComposeNavigationRoutes } from './buildComposeNavigationRoutes.js'
import {
  ANDROID_NAVIGATION_ARTIFACT_KIND,
  ANDROID_NAVIGATION_SCHEMA_VERSION,
  type AndroidNavigationArtifact,
  type BuildAndroidNavigationProjectResult,
} from './androidNavigationTypes.js'

export interface BuildAndroidNavigationProjectOptions {
  projectRoot: string
  androidProject: AndroidProjectArtifact
  androidGradle: AndroidGradleArtifact
  androidResources: AndroidResourcesArtifact
  /** The already-built symbol index (Kotlin/Java files), used only for narrow static Compose route evidence. Omit for the early cache-fingerprint-only call — Compose evidence is empty in that case. */
  symbolIndex?: SymbolIndex
  createdAt?: string
}

/** Computes only the XML-navigation portion, for use as the early (pre-full/incremental-decision) cache fingerprint input — mirrors the other three Android builders' `evidenceFingerprint` convention. */
export function buildAndroidNavigationXmlEvidenceFingerprint(options: {
  projectRoot: string
  androidResources: AndroidResourcesArtifact
}): string {
  return buildAndroidNavigationXmlModel(options).evidenceFingerprint
}

export function buildAndroidNavigationProject(options: BuildAndroidNavigationProjectOptions): BuildAndroidNavigationProjectResult {
  const { projectRoot, androidProject, androidGradle, androidResources, symbolIndex, createdAt = new Date().toISOString() } = options

  const { model } = buildAndroidNavigationXmlModel({ projectRoot, androidResources })
  const composeResult = symbolIndex
    ? buildComposeNavigationRoutes({ projectRoot, symbolIndex, androidProject })
    : { routes: [], screenCandidates: [], warnings: [] }

  const warnings = [...new Set([...model.warnings, ...composeResult.warnings])].sort()
  const detected = model.navigationFiles.length > 0 || composeResult.routes.length > 0

  const artifact: AndroidNavigationArtifact = {
    artifactKind: ANDROID_NAVIGATION_ARTIFACT_KIND,
    schemaVersion: ANDROID_NAVIGATION_SCHEMA_VERSION,
    createdAt,
    projectRoot: toForwardSlash(projectRoot),
    detected,
    filesExamined: model.filesExamined,
    navigationFiles: model.navigationFiles,
    graphs: model.graphs,
    destinations: model.destinations,
    actions: model.actions,
    arguments: model.arguments,
    xmlDeepLinks: model.xmlDeepLinks,
    includes: model.includes,
    composeRoutes: composeResult.routes,
    screenCandidates: composeResult.screenCandidates,
    warnings,
    summary: {
      moduleCount: new Set(model.navigationFiles.map((f) => f.moduleId)).size,
      sourceSetCount: new Set(model.navigationFiles.map((f) => `${f.moduleId}#${f.sourceSet}`)).size,
      xmlGraphCount: model.graphs.length,
      nestedGraphCount: model.graphs.filter((g) => g.kind === 'nested').length,
      destinationCount: model.destinations.length,
      actionCount: model.actions.length,
      argumentCount: model.arguments.length,
      xmlDeepLinkCount: model.xmlDeepLinks.length,
      includeCount: model.includes.length,
      composeRouteCount: composeResult.routes.length,
      screenCandidateCount: composeResult.screenCandidates.length,
      warningCount: warnings.length,
    },
  }

  return { artifact, evidenceFingerprint: computeEvidenceFingerprint(artifact, model) }
}

function computeEvidenceFingerprint(artifact: AndroidNavigationArtifact, xmlModel: AndroidNavigationXmlModel): string {
  const stable = { ...artifact, createdAt: '', projectRoot: '' }
  return createHash('sha256').update(JSON.stringify({ stable, xmlEvidenceFingerprint: hashModel(xmlModel) })).digest('hex')
}

function hashModel(model: AndroidNavigationXmlModel): string {
  return createHash('sha256').update(JSON.stringify(model)).digest('hex')
}
