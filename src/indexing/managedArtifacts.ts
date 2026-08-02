export const INDEX_MANIFEST_FILENAME = 'manifest.json'
export const SYMBOL_INDEX_FILENAME = 'symbol-index.json'
export const CODE_GRAPH_FILENAME = 'code-graph.json'
export const CALL_GRAPH_FILENAME = 'call-graph.json'
export const DATA_MODEL_FILENAME = 'data-model.json'
export const DATA_MODEL_GRAPH_FILENAME = 'data-model-graph.json'
export const FRONTEND_SEMANTIC_FILENAME = 'frontend-semantic.json'
export const FRONTEND_REACHABILITY_FILENAME = 'frontend-reachability.json'
export const CLASSIFICATION_FILENAME = 'classification.json'
export const ANDROID_PROJECT_FILENAME = 'android-project.json'
export const ANDROID_COMPONENTS_FILENAME = 'android-components.json'
export const ANDROID_GRADLE_FILENAME = 'android-gradle.json'
export const ANDROID_MANIFEST_FILENAME = 'android-manifest.json'
export const ANDROID_RESOURCES_FILENAME = 'android-resources.json'
export const ANDROID_NAVIGATION_FILENAME = 'android-navigation.json'
export const ANDROID_COMPOSE_SEMANTIC_FILENAME = 'android-compose-semantic.json'
export const ANDROID_TEST_SEMANTIC_FILENAME = 'android-test-semantic.json'

export const REQUIRED_INDEX_ARTIFACT_FILENAMES = [
  INDEX_MANIFEST_FILENAME,
  SYMBOL_INDEX_FILENAME,
  CODE_GRAPH_FILENAME,
] as const

export const OPTIONAL_INDEX_ARTIFACT_FILENAMES = [
  CALL_GRAPH_FILENAME,
  DATA_MODEL_FILENAME,
  DATA_MODEL_GRAPH_FILENAME,
  FRONTEND_SEMANTIC_FILENAME,
  FRONTEND_REACHABILITY_FILENAME,
  CLASSIFICATION_FILENAME,
  ANDROID_PROJECT_FILENAME,
  ANDROID_COMPONENTS_FILENAME,
  ANDROID_GRADLE_FILENAME,
  ANDROID_MANIFEST_FILENAME,
  ANDROID_RESOURCES_FILENAME,
  ANDROID_NAVIGATION_FILENAME,
  ANDROID_COMPOSE_SEMANTIC_FILENAME,
  ANDROID_TEST_SEMANTIC_FILENAME,
] as const

export const MANAGED_INDEX_ARTIFACT_FILENAMES = [
  ...REQUIRED_INDEX_ARTIFACT_FILENAMES,
  ...OPTIONAL_INDEX_ARTIFACT_FILENAMES,
] as const

export type ManagedIndexArtifactFilename = (typeof MANAGED_INDEX_ARTIFACT_FILENAMES)[number]
