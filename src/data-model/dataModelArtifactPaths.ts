import * as path from 'node:path'
import { isInsideRoot } from '../io/pathUtils.js'

export const DATA_MODEL_ARTIFACT_FILENAME = 'data-model.json'
export const DATA_MODEL_GRAPH_ARTIFACT_FILENAME = 'data-model-graph.json'

export function ensureDataModelArtifactPathInsideOutputDir(outputDir: string, artifactPath: string): string {
  const resolvedOutputDir = path.resolve(outputDir)
  const resolvedArtifactPath = path.resolve(resolvedOutputDir, artifactPath)
  if (!isInsideRoot(resolvedOutputDir, resolvedArtifactPath)) {
    throw new Error(`Data-model artifact path escapes the artifact directory: ${artifactPath}`)
  }
  return resolvedArtifactPath
}

export function resolveDataModelArtifactPaths(outputDir: string): {
  outputDir: string
  dataModelPath: string
  dataModelGraphPath: string
} {
  const resolvedOutputDir = path.resolve(outputDir)
  return {
    outputDir: resolvedOutputDir,
    dataModelPath: ensureDataModelArtifactPathInsideOutputDir(resolvedOutputDir, DATA_MODEL_ARTIFACT_FILENAME),
    dataModelGraphPath: ensureDataModelArtifactPathInsideOutputDir(
      resolvedOutputDir,
      DATA_MODEL_GRAPH_ARTIFACT_FILENAME
    ),
  }
}
