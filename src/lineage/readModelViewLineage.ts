import * as fs from 'node:fs'
import { resolveModelViewLineageArtifactPath } from './modelViewLineageArtifactPaths.js'
import { MODEL_VIEW_LINEAGE_ARTIFACT_KIND, type ModelViewLineageArtifact } from './types.js'

export interface ModelViewLineageReadResult {
  outputDir: string
  modelViewLineagePath: string
  lineage: ModelViewLineageArtifact
}

export function readModelViewLineage(outputDir: string): ModelViewLineageReadResult {
  const paths = resolveModelViewLineageArtifactPath(outputDir)
  const lineage = readJson<ModelViewLineageArtifact>(paths.modelViewLineagePath, 'model-view-lineage.json')
  validateArtifactKind(lineage, MODEL_VIEW_LINEAGE_ARTIFACT_KIND)
  return {
    outputDir: paths.outputDir,
    modelViewLineagePath: paths.modelViewLineagePath,
    lineage,
  }
}

function readJson<T>(filePath: string, label: string): T {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required ${label}: ${filePath}`)
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${label}: ${error.message}`)
    }
    throw new Error(`Failed to read ${label}: ${(error as Error).message}`)
  }
}

function validateArtifactKind(value: unknown, expectedKind: string): void {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid model-view-lineage.json: expected an object.')
  }
  const artifactKind = (value as { artifactKind?: unknown }).artifactKind
  if (artifactKind !== expectedKind) {
    throw new Error(`Invalid model-view-lineage.json: artifactKind must be ${expectedKind}.`)
  }
}
