import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { SymbolIndex } from '../symbol-index/types.js'
import type { IndexManifest } from './manifestTypes.js'

export interface BuildIndexManifestOptions {
  projectRoot: string
  sourceRoots: string[]
  languages: string[]
  callGraphEnabled: boolean
  callGraphProduced: boolean
  symbolIndex: SymbolIndex
  codeGraph: CodeGraph
  warnings: string[]
  errors: string[]
}

export function buildIndexManifest(options: BuildIndexManifestOptions): IndexManifest {
  return {
    artifactKind: 'my-dev-kit-v1-manifest',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    projectRoot: options.projectRoot,
    sourceRoots: options.sourceRoots,
    languages: options.languages,
    callGraphEnabled: options.callGraphEnabled,
    artifacts: {
      symbolIndex: 'symbol-index.json',
      codeGraph: 'code-graph.json',
      callGraph: options.callGraphProduced ? 'call-graph.json' : null,
    },
    summary: {
      fileCount: options.symbolIndex.fileCount,
      symbolCount: options.symbolIndex.symbolCount,
      edgeCount: options.codeGraph.summary.edgeCount,
      warningCount: options.warnings.length,
      errorCount: options.errors.length,
    },
    warnings: options.warnings,
    errors: options.errors,
  }
}
