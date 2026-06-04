import * as fs from 'node:fs'
import { resolveDataModelArtifactPaths } from './dataModelArtifactPaths.js'
import type { DataModelGraphArtifact } from './dataModelGraphTypes.js'
import type { DataModelArtifact } from './types.js'

export interface DataModelArtifactWriteResult {
  outputDir: string
  dataModelPath: string
  dataModelGraphPath: string
  entityCount: number
  fieldCount: number
  relationshipCount: number
  graphNodeCount: number
  graphEdgeCount: number
  warningCount: number
}

export function writeDataModelArtifacts(options: {
  outputDir: string
  dataModel: DataModelArtifact
  dataModelGraph: DataModelGraphArtifact
}): DataModelArtifactWriteResult {
  const paths = resolveDataModelArtifactPaths(options.outputDir)
  fs.mkdirSync(paths.outputDir, { recursive: true })
  writeJson(paths.dataModelPath, options.dataModel)
  writeJson(paths.dataModelGraphPath, options.dataModelGraph)

  return {
    outputDir: paths.outputDir,
    dataModelPath: paths.dataModelPath,
    dataModelGraphPath: paths.dataModelGraphPath,
    entityCount: options.dataModel.summary.entityCount,
    fieldCount: options.dataModel.summary.fieldCount,
    relationshipCount: options.dataModel.summary.relationshipCount,
    graphNodeCount: options.dataModelGraph.summary.nodeCount,
    graphEdgeCount: options.dataModelGraph.summary.edgeCount,
    warningCount: options.dataModel.summary.warningCount + options.dataModelGraph.summary.warningCount,
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
