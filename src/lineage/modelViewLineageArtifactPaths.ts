import * as path from 'node:path'
import { isInsideRoot } from '../io/pathUtils.js'

export const MODEL_VIEW_LINEAGE_ARTIFACT_FILENAME = 'model-view-lineage.json'

export function ensureModelViewLineagePathInsideOutputDir(outputDir: string, artifactPath: string): string {
  const resolvedOutputDir = path.resolve(outputDir)
  const resolvedArtifactPath = path.resolve(resolvedOutputDir, artifactPath)
  if (!isInsideRoot(resolvedOutputDir, resolvedArtifactPath)) {
    throw new Error(`Model-view-lineage artifact path escapes the artifact directory: ${artifactPath}`)
  }
  return resolvedArtifactPath
}

export function resolveModelViewLineageArtifactPath(outputDir: string): {
  outputDir: string
  modelViewLineagePath: string
} {
  const resolvedOutputDir = path.resolve(outputDir)
  return {
    outputDir: resolvedOutputDir,
    modelViewLineagePath: ensureModelViewLineagePathInsideOutputDir(
      resolvedOutputDir,
      MODEL_VIEW_LINEAGE_ARTIFACT_FILENAME
    ),
  }
}
