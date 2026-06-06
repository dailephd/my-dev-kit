import * as fs from 'node:fs'
import * as path from 'node:path'
import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { CallGraph, SymbolIndex } from '../symbol-index/types.js'
import type { DataModelGraphArtifact } from '../data-model/dataModelGraphTypes.js'
import type { DataModelArtifact } from '../data-model/types.js'
import type { IndexManifest } from './manifestTypes.js'
import {
  CALL_GRAPH_FILENAME,
  CODE_GRAPH_FILENAME,
  DATA_MODEL_FILENAME,
  DATA_MODEL_GRAPH_FILENAME,
  INDEX_MANIFEST_FILENAME,
  SYMBOL_INDEX_FILENAME,
} from './managedArtifacts.js'

export interface WriteIndexArtifactsOptions {
  outputDir: string
  manifest: IndexManifest
  symbolIndex: SymbolIndex
  codeGraph: CodeGraph
  callGraph: CallGraph | null
  dataModel?: DataModelArtifact | null
  dataModelGraph?: DataModelGraphArtifact | null
}

export function writeIndexArtifacts(options: WriteIndexArtifactsOptions): void {
  fs.mkdirSync(options.outputDir, { recursive: true })
  writeJson(path.join(options.outputDir, INDEX_MANIFEST_FILENAME), options.manifest)
  writeJson(path.join(options.outputDir, SYMBOL_INDEX_FILENAME), options.symbolIndex)
  writeJson(path.join(options.outputDir, CODE_GRAPH_FILENAME), options.codeGraph)
  if (options.callGraph) {
    writeJson(path.join(options.outputDir, CALL_GRAPH_FILENAME), options.callGraph)
  }
  if (options.dataModel) {
    writeJson(path.join(options.outputDir, DATA_MODEL_FILENAME), options.dataModel)
  }
  if (options.dataModelGraph) {
    writeJson(path.join(options.outputDir, DATA_MODEL_GRAPH_FILENAME), options.dataModelGraph)
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
