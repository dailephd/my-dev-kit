import * as fs from 'node:fs'
import * as path from 'node:path'
import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { CallGraph, SymbolIndex } from '../symbol-index/types.js'
import type { IndexManifest } from './manifestTypes.js'

export interface WriteIndexArtifactsOptions {
  outputDir: string
  manifest: IndexManifest
  symbolIndex: SymbolIndex
  codeGraph: CodeGraph
  callGraph: CallGraph | null
}

export function writeIndexArtifacts(options: WriteIndexArtifactsOptions): void {
  fs.mkdirSync(options.outputDir, { recursive: true })
  writeJson(path.join(options.outputDir, 'manifest.json'), options.manifest)
  writeJson(path.join(options.outputDir, 'symbol-index.json'), options.symbolIndex)
  writeJson(path.join(options.outputDir, 'code-graph.json'), options.codeGraph)
  if (options.callGraph) {
    writeJson(path.join(options.outputDir, 'call-graph.json'), options.callGraph)
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
