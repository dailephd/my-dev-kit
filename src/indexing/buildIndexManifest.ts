import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { SymbolIndex } from '../symbol-index/types.js'
import type { IndexAnalyzerStatus, IndexManifest, IndexSemanticArtifacts } from './manifestTypes.js'

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
  semanticArtifacts?: Partial<IndexSemanticArtifacts>
  analyzers?: IndexAnalyzerStatus[]
  createdAt?: string
}

export function buildIndexManifest(options: BuildIndexManifestOptions): IndexManifest {
  return {
    artifactKind: 'my-dev-kit-v1-manifest',
    version: '1.0.0',
    createdAt: options.createdAt ?? new Date().toISOString(),
    projectRoot: options.projectRoot,
    sourceRoots: options.sourceRoots,
    languages: options.languages,
    callGraphEnabled: options.callGraphEnabled,
    artifacts: {
      symbolIndex: 'symbol-index.json',
      codeGraph: 'code-graph.json',
      callGraph: options.callGraphProduced ? 'call-graph.json' : null,
    },
    semanticArtifacts: {
      dataModel: options.semanticArtifacts?.dataModel ?? null,
      dataModelGraph: options.semanticArtifacts?.dataModelGraph ?? null,
      modelViewLineage: options.semanticArtifacts?.modelViewLineage ?? null,
      frontendSemantic: options.semanticArtifacts?.frontendSemantic ?? null,
      frontendReachability: options.semanticArtifacts?.frontendReachability ?? null,
    },
    analyzers: options.analyzers ?? buildDefaultAnalyzerStatuses(options),
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

function buildDefaultAnalyzerStatuses(options: BuildIndexManifestOptions): IndexAnalyzerStatus[] {
  const artifacts = [
    { name: 'symbolIndex', path: 'symbol-index.json', artifactKind: 'symbol-index' },
    { name: 'codeGraph', path: 'code-graph.json', artifactKind: 'code-graph' },
  ]
  return [
    {
      id: 'syntax',
      status: options.errors.length > 0 ? 'failed' : options.warnings.length > 0 ? 'partial' : 'complete',
      schemaVersion: options.symbolIndex.schemaVersion,
      artifacts,
      warningCount: options.warnings.length,
      errorCount: options.errors.length,
      summary: {
        fileCount: options.symbolIndex.fileCount,
        symbolCount: options.symbolIndex.symbolCount,
      },
    },
    {
      id: 'call-graph',
      status: options.callGraphProduced ? 'complete' : options.callGraphEnabled ? 'skipped' : 'not-run',
      schemaVersion: options.callGraphProduced ? options.symbolIndex.schemaVersion : null,
      artifacts: options.callGraphProduced
        ? [{ name: 'callGraph', path: 'call-graph.json', artifactKind: 'call-graph' }]
        : [],
      warningCount: 0,
      errorCount: 0,
      summary: {
        enabled: options.callGraphEnabled,
        produced: options.callGraphProduced,
      },
    },
    {
      id: 'data-model',
      status: 'not-run',
      artifacts: [],
      warningCount: 0,
      errorCount: 0,
    },
    {
      id: 'model-view-lineage',
      status: 'not-run',
      artifacts: [],
      warningCount: 0,
      errorCount: 0,
    },
  ]
}
