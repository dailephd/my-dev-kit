export const INDEX_MANIFEST_FILENAME = 'manifest.json'
export const SYMBOL_INDEX_FILENAME = 'symbol-index.json'
export const CODE_GRAPH_FILENAME = 'code-graph.json'
export const CALL_GRAPH_FILENAME = 'call-graph.json'
export const DATA_MODEL_FILENAME = 'data-model.json'
export const DATA_MODEL_GRAPH_FILENAME = 'data-model-graph.json'
export const FRONTEND_SEMANTIC_FILENAME = 'frontend-semantic.json'

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
] as const

export const MANAGED_INDEX_ARTIFACT_FILENAMES = [
  ...REQUIRED_INDEX_ARTIFACT_FILENAMES,
  ...OPTIONAL_INDEX_ARTIFACT_FILENAMES,
] as const

export type ManagedIndexArtifactFilename = (typeof MANAGED_INDEX_ARTIFACT_FILENAMES)[number]
