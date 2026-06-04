import * as fs from 'node:fs'
import { resolveModelViewLineageArtifactPath } from './modelViewLineageArtifactPaths.js'
import type { ModelViewLineageArtifact } from './types.js'

export interface ModelViewLineageWriteResult {
  outputDir: string
  modelViewLineagePath: string
  nodeCount: number
  edgeCount: number
  warningCount: number
}

export function writeModelViewLineage(options: {
  outputDir: string
  lineage: ModelViewLineageArtifact
}): ModelViewLineageWriteResult {
  const paths = resolveModelViewLineageArtifactPath(options.outputDir)
  fs.mkdirSync(paths.outputDir, { recursive: true })
  fs.writeFileSync(paths.modelViewLineagePath, `${JSON.stringify(options.lineage, null, 2)}\n`, 'utf8')

  return {
    outputDir: paths.outputDir,
    modelViewLineagePath: paths.modelViewLineagePath,
    nodeCount: options.lineage.summary.nodeCount,
    edgeCount: options.lineage.summary.edgeCount,
    warningCount: options.lineage.summary.warningCount,
  }
}
