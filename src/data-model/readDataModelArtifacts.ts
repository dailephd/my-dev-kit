import * as fs from 'node:fs'
import { resolveDataModelArtifactPaths } from './dataModelArtifactPaths.js'
import { DATA_MODEL_GRAPH_ARTIFACT_KIND, type DataModelGraphArtifact } from './dataModelGraphTypes.js'
import { DATA_MODEL_ARTIFACT_KIND, type DataModelArtifact } from './types.js'

export interface DataModelArtifactReadResult {
  outputDir: string
  dataModelPath: string
  dataModelGraphPath: string
  dataModel: DataModelArtifact
  dataModelGraph: DataModelGraphArtifact
}

export function readDataModelArtifacts(outputDir: string): DataModelArtifactReadResult {
  const paths = resolveDataModelArtifactPaths(outputDir)
  const dataModel = readJson<DataModelArtifact>(paths.dataModelPath, 'data-model.json')
  const dataModelGraph = readJson<DataModelGraphArtifact>(paths.dataModelGraphPath, 'data-model-graph.json')
  validateArtifactKind(dataModel, DATA_MODEL_ARTIFACT_KIND, 'data-model.json')
  validateArtifactKind(dataModelGraph, DATA_MODEL_GRAPH_ARTIFACT_KIND, 'data-model-graph.json')

  return {
    outputDir: paths.outputDir,
    dataModelPath: paths.dataModelPath,
    dataModelGraphPath: paths.dataModelGraphPath,
    dataModel,
    dataModelGraph,
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

function validateArtifactKind(value: unknown, expectedKind: string, label: string): void {
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid ${label}: expected an object.`)
  }
  const artifactKind = (value as { artifactKind?: unknown }).artifactKind
  if (artifactKind !== expectedKind) {
    throw new Error(`Invalid ${label}: artifactKind must be ${expectedKind}.`)
  }
}
