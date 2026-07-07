export { detectAndroidProject, type DetectAndroidProjectOptions } from './detectAndroidProject.js'
export { parseGradleIncludes, detectAndroidPluginType, hasKotlinAndroidPluginEvidence } from './parseGradleEvidence.js'
export {
  ANDROID_PROJECT_ARTIFACT_KIND,
  ANDROID_PROJECT_SCHEMA_VERSION,
  ANDROID_PROJECT_FILENAME,
  type AndroidProjectArtifact,
  type AndroidProjectConfidence,
  type AndroidModule,
  type AndroidModuleType,
  type AndroidSourceSet,
  type AndroidSourceSetName,
  type AndroidProjectSummary,
  type DetectAndroidProjectResult,
} from './androidProjectTypes.js'
export { detectAndroidComponents, type DetectAndroidComponentsOptions } from './detectAndroidComponents.js'
export { buildAndroidComponentRefsBySymbolId } from './buildAndroidComponentRefsBySymbolId.js'
export { applyAndroidComponentsToSymbolIndex } from './applyAndroidComponentsToSymbolIndex.js'
export { applyAndroidComponentsToCodeGraph } from './applyAndroidComponentsToCodeGraph.js'
export {
  ANDROID_COMPONENTS_ARTIFACT_KIND,
  ANDROID_COMPONENTS_SCHEMA_VERSION,
  ANDROID_COMPONENTS_FILENAME,
  type AndroidComponentRole,
  type AndroidComponentConfidence,
  type AndroidComponentEvidenceKind,
  type AndroidComponentEvidence,
  type AndroidComponentEntry,
  type AndroidComponentsSummary,
  type AndroidComponentsArtifact,
  type AndroidComponentRoleRef,
  type CompactAndroidComponentMetadata,
} from './androidComponentTypes.js'
