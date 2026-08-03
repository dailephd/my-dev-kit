import type { CodeGraphNode } from '../graph/codeGraphTypes.js'
import { ANDROID_PROJECT_ROOT_NODE_ID } from '../android/buildAndroidArtifactRelationships.js'
import { buildWarning, validateEntry } from './classificationHelpers.js'
import type { ClassificationEntry } from './classificationTypes.js'

const ANDROID_PROJECT_ARTIFACT_REF = {
  artifact: 'android-project.json',
  artifactKind: 'my-dev-kit-v1-android-project',
  id: ANDROID_PROJECT_ROOT_NODE_ID,
  path: 'android-project.json',
}

export interface BuildAndroidGraphNodeClassificationsOptions {
  /** The final Android relationship nodes (`android-project`/`android-module` kinds only are consulted). */
  graphNodes: readonly CodeGraphNode[]
}

export interface BuildAndroidGraphNodeClassificationsResult {
  entries: ClassificationEntry[]
  warningCount: number
}

/**
 * v1.12.0 Batch 1: classifies the existing `android-project:root` node and
 * every existing `android-module` node produced by
 * `buildAndroidArtifactRelationships`. Never invents a target - it only
 * classifies graph nodes that already exist in `graphNodes`, so a module
 * without a corresponding graph node is silently skipped rather than guessed.
 */
export function buildAndroidGraphNodeClassifications(
  options: BuildAndroidGraphNodeClassificationsOptions
): BuildAndroidGraphNodeClassificationsResult {
  const entries: ClassificationEntry[] = []

  for (const node of options.graphNodes) {
    if (node.kind === 'android-project') {
      entries.push(buildProjectRootEntry(node))
    } else if (node.kind === 'android-module') {
      entries.push(buildModuleEntry(node))
    }
  }

  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const warningCount = entries.reduce((sum, entry) => sum + entry.warnings.length, 0)
  return { entries, warningCount }
}

function buildProjectRootEntry(node: CodeGraphNode): ClassificationEntry {
  const targetId = node.id
  const entry: ClassificationEntry = {
    id: `classification:graph-node:${targetId}`,
    targetId,
    targetKind: 'graph-node',
    filePath: null,
    symbolName: null,
    nodeId: targetId,
    classifications: [{ role: 'android-project', subtype: null, confidence: 'certain' }],
    editGuidance: 'read-only-reference',
    readiness: 'ready',
    risks: [],
    evidence: [
      {
        kind: 'artifact-cross-reference',
        source: 'android-project.json',
        artifactSource: ANDROID_PROJECT_ARTIFACT_REF,
        reason: `detected Android project backed by android-project.json, projected onto graph node '${targetId}'`,
      },
    ],
    uncertainty: 'certain',
    reason: 'Android project root detected from static android-project.json evidence.',
    sourceRefs: [{ filePath: 'android-project.json' }],
    artifactRefs: [ANDROID_PROJECT_ARTIFACT_REF],
    warnings: [],
  }
  validateEntry(entry)
  return entry
}

function buildModuleEntry(node: CodeGraphNode): ClassificationEntry {
  const targetId = node.id
  const moduleType = node.androidMetadata?.moduleType
  const modulePath = node.path ?? targetId
  const moduleArtifactRef = {
    artifact: 'android-project.json',
    artifactKind: 'my-dev-kit-v1-android-project',
    id: targetId,
    path: 'android-project.json',
  }

  if (moduleType === 'app' || moduleType === 'library') {
    const subtypeRole = moduleType === 'app' ? 'android-app-module' : 'android-library-module'
    const entry: ClassificationEntry = {
      id: `classification:graph-node:${targetId}`,
      targetId,
      targetKind: 'graph-node',
      filePath: modulePath,
      symbolName: null,
      nodeId: targetId,
      classifications: [
        { role: 'gradle-module', subtype: null, confidence: 'certain' },
        { role: subtypeRole, subtype: null, confidence: 'certain' },
      ],
      editGuidance: 'inspect-before-edit',
      readiness: 'ready',
      risks: [],
      evidence: [
        {
          kind: 'artifact-cross-reference',
          source: 'android-project.json',
          artifactSource: moduleArtifactRef,
          reason: `module type '${moduleType}' statically determined from android-project.json Gradle plugin evidence`,
        },
      ],
      uncertainty: 'certain',
      reason: `Android ${moduleType} module detected from static Gradle plugin evidence.`,
      sourceRefs: [{ filePath: modulePath }],
      artifactRefs: [moduleArtifactRef],
      warnings: [],
    }
    validateEntry(entry)
    return entry
  }

  const entry: ClassificationEntry = {
    id: `classification:graph-node:${targetId}`,
    targetId,
    targetKind: 'graph-node',
    filePath: modulePath,
    symbolName: null,
    nodeId: targetId,
    classifications: [{ role: 'gradle-module', subtype: null, confidence: 'possible' }],
    editGuidance: 'inspect-before-edit',
    readiness: 'needs-more-context',
    risks: [],
    evidence: [
      {
        kind: 'artifact-cross-reference',
        source: 'android-project.json',
        artifactSource: moduleArtifactRef,
        reason: "module is a Gradle module but its type could not be statically resolved to 'app' or 'library'",
      },
    ],
    uncertainty: 'possible',
    reason: 'Gradle module type is unknown; no app/library plugin evidence was statically found.',
    sourceRefs: [{ filePath: modulePath }],
    artifactRefs: [moduleArtifactRef],
    warnings: [
      buildWarning('no-static-evidence', "module type could not be statically determined as 'app' or 'library'"),
    ],
  }
  validateEntry(entry)
  return entry
}
