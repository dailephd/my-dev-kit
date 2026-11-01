import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { CallGraph, SymbolIndex } from '../symbol-index/types.js'
import type { DataModelGraphArtifact } from '../data-model/dataModelGraphTypes.js'
import type { DataModelArtifact } from '../data-model/types.js'
import type { FrontendSemanticArtifact } from '../frontend/frontendTypes.js'
import {
  sortFrontendReachabilityArtifact,
  type FrontendReachabilityArtifact,
} from '../frontend-reachability/index.js'
import type { ClassificationArtifact } from '../classification/classificationTypes.js'
import type { AndroidProjectArtifact } from '../android/androidProjectTypes.js'
import type { AndroidComponentsArtifact } from '../android/androidComponentTypes.js'
import type { AndroidGradleArtifact } from '../android/androidGradleTypes.js'
import type { AndroidManifestArtifact } from '../android/androidManifestTypes.js'
import type { AndroidResourcesArtifact } from '../android/androidResourceTypes.js'
import type { AndroidNavigationArtifact } from '../android/androidNavigationTypes.js'
import type { AndroidComposeSemanticArtifact } from '../android/androidComposeTypes.js'
import type { AndroidTestSemanticArtifact } from '../android/androidTestTypes.js'
import type { IndexManifest } from './manifestTypes.js'
import {
  ANDROID_PROJECT_FILENAME,
  ANDROID_COMPONENTS_FILENAME,
  ANDROID_GRADLE_FILENAME,
  ANDROID_MANIFEST_FILENAME,
  ANDROID_RESOURCES_FILENAME,
  ANDROID_NAVIGATION_FILENAME,
  ANDROID_COMPOSE_SEMANTIC_FILENAME,
  ANDROID_TEST_SEMANTIC_FILENAME,
  CALL_GRAPH_FILENAME,
  CLASSIFICATION_FILENAME,
  CODE_GRAPH_FILENAME,
  DATA_MODEL_FILENAME,
  DATA_MODEL_GRAPH_FILENAME,
  FRONTEND_REACHABILITY_FILENAME,
  FRONTEND_SEMANTIC_FILENAME,
  INDEX_MANIFEST_FILENAME,
  SOURCE_AUDIT_EVIDENCE_FILENAME,
  SYMBOL_INDEX_FILENAME,
} from './managedArtifacts.js'

export interface WriteIndexArtifactsOptions {
  outputDir: string
  manifest: IndexManifest
  symbolIndex: SymbolIndex
  codeGraph: CodeGraph
  callGraph: CallGraph | null
  dataModel?: DataModelArtifact | null
  dataModelGraph?: DataModelGraphArtifact | null
  frontendSemantic?: FrontendSemanticArtifact | null
  frontendReachability?: FrontendReachabilityArtifact | null
  classification?: ClassificationArtifact | null
  androidProject?: AndroidProjectArtifact | null
  androidComponents?: AndroidComponentsArtifact | null
  androidGradle?: AndroidGradleArtifact | null
  androidManifest?: AndroidManifestArtifact | null
  androidResources?: AndroidResourcesArtifact | null
  androidNavigation?: AndroidNavigationArtifact | null
  androidComposeSemantic?: AndroidComposeSemanticArtifact | null
  androidTestSemantic?: AndroidTestSemanticArtifact | null
  /** Exact serialized source-audit artifact; its SHA-256 must equal manifest.sourceAuditEvidence.sha256. */
  sourceAuditEvidenceJson?: string | null
}

export function writeIndexArtifacts(options: WriteIndexArtifactsOptions): void {
  fs.mkdirSync(options.outputDir, { recursive: true })
  // The manifest is the publication pointer: it is written last so it never references a missing or partial artifact.
  writeJson(path.join(options.outputDir, SYMBOL_INDEX_FILENAME), options.symbolIndex)
  writeJson(path.join(options.outputDir, CODE_GRAPH_FILENAME), options.codeGraph)
  if (options.callGraph) {
    writeJson(path.join(options.outputDir, CALL_GRAPH_FILENAME), options.callGraph)
  }
  if (options.dataModel) {
    writeJson(path.join(options.outputDir, DATA_MODEL_FILENAME), options.dataModel)
  }
  if (options.dataModelGraph) {
    writeJson(path.join(options.outputDir, DATA_MODEL_GRAPH_FILENAME), options.dataModelGraph)
  }
  if (options.frontendSemantic && options.frontendSemantic.summary.fileCount > 0) {
    writeJson(path.join(options.outputDir, FRONTEND_SEMANTIC_FILENAME), options.frontendSemantic)
    if (options.frontendReachability) {
      writeJson(
        path.join(options.outputDir, FRONTEND_REACHABILITY_FILENAME),
        sortFrontendReachabilityArtifact(options.frontendReachability)
      )
    }
  }
  if (options.classification) {
    writeJson(path.join(options.outputDir, CLASSIFICATION_FILENAME), options.classification)
  }
  if (options.androidProject) {
    writeJson(path.join(options.outputDir, ANDROID_PROJECT_FILENAME), options.androidProject)
  }
  if (options.androidComponents) {
    writeJson(path.join(options.outputDir, ANDROID_COMPONENTS_FILENAME), options.androidComponents)
  }
  if (options.androidGradle) {
    writeJson(path.join(options.outputDir, ANDROID_GRADLE_FILENAME), options.androidGradle)
  }
  if (options.androidManifest) {
    writeJson(path.join(options.outputDir, ANDROID_MANIFEST_FILENAME), options.androidManifest)
  }
  if (options.androidResources) {
    writeJson(path.join(options.outputDir, ANDROID_RESOURCES_FILENAME), options.androidResources)
  }
  if (options.androidNavigation) {
    writeJson(path.join(options.outputDir, ANDROID_NAVIGATION_FILENAME), options.androidNavigation)
  }
  if (options.androidComposeSemantic) {
    writeJson(path.join(options.outputDir, ANDROID_COMPOSE_SEMANTIC_FILENAME), options.androidComposeSemantic)
  }
  if (options.androidTestSemantic) {
    writeJson(path.join(options.outputDir, ANDROID_TEST_SEMANTIC_FILENAME), options.androidTestSemantic)
  }
  const reference = options.manifest.sourceAuditEvidence
  if (reference) {
    if (options.sourceAuditEvidenceJson === undefined || options.sourceAuditEvidenceJson === null) {
      throw new Error('The manifest references source-audit evidence but no serialized artifact was supplied.')
    }
    const target = path.join(options.outputDir, SOURCE_AUDIT_EVIDENCE_FILENAME)
    fs.writeFileSync(target, options.sourceAuditEvidenceJson, 'utf8')
    // Verify the bytes on disk before the manifest can point at them.
    const written = createHash('sha256').update(fs.readFileSync(target)).digest('hex')
    if (written !== reference.sha256) {
      throw new Error('The written source-audit artifact does not match the SHA-256 recorded for the manifest.')
    }
  }
  writeJson(path.join(options.outputDir, INDEX_MANIFEST_FILENAME), options.manifest)
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
