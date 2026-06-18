import * as path from 'node:path'
import {
  buildDataModelFromIndex,
  DATA_MODEL_ARTIFACT_KIND,
  DATA_MODEL_GRAPH_ARTIFACT_KIND,
  DATA_MODEL_SCHEMA_VERSION,
  type BuildDataModelFromIndexResult,
} from '../data-model/index.js'
import {
  runFrontendAnalyzer,
  FRONTEND_SEMANTIC_ARTIFACT_KIND,
  FRONTEND_SEMANTIC_SCHEMA_VERSION,
  type RunFrontendAnalyzerResult,
} from '../frontend/index.js'
import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { SymbolIndex } from '../symbol-index/types.js'
import type { IndexAnalyzerStatus, IndexManifest, IndexSemanticArtifacts } from './manifestTypes.js'
import type { SourceArtifacts } from './loadIndexArtifacts.js'

export interface RunSemanticAnalyzersOptions {
  outputDir: string
  manifestPath: string
  manifest: IndexManifest
  symbolIndex: SymbolIndex
  codeGraph: CodeGraph
  callGraphPath: string | null
  createdAt: string
  repoRoot: string
}

export interface RunSemanticAnalyzersResult {
  dataModelResult: BuildDataModelFromIndexResult
  frontendResult: RunFrontendAnalyzerResult
  semanticArtifacts: IndexSemanticArtifacts
  analyzers: IndexAnalyzerStatus[]
}

export function runSemanticAnalyzers(options: RunSemanticAnalyzersOptions): RunSemanticAnalyzersResult {
  const artifacts: SourceArtifacts = {
    resolved: {
      indexDir: options.outputDir,
      manifestPath: options.manifestPath,
      manifest: options.manifest,
      artifactPaths: {
        symbolIndex: path.join(options.outputDir, options.manifest.artifacts.symbolIndex),
        codeGraph: path.join(options.outputDir, options.manifest.artifacts.codeGraph),
        callGraph: options.callGraphPath,
      },
      semanticArtifactPaths: {
        dataModel: null,
        dataModelGraph: null,
        modelViewLineage: null,
        frontendSemantic: null,
      },
    },
    symbolIndex: options.symbolIndex,
    codeGraph: options.codeGraph,
  }
  const dataModelResult = buildDataModelFromIndex({
    artifacts,
    createdAt: options.createdAt,
  })
  const dmWarningCount =
    dataModelResult.dataModel.summary.warningCount + dataModelResult.dataModelGraph.summary.warningCount

  const frontendResult = runFrontendAnalyzer({
    symbolIndex: options.symbolIndex,
    repoRoot: options.manifest.projectRoot,
    createdAt: options.createdAt,
  })

  const frontendStatus =
    frontendResult.errorCount > 0
      ? 'partial'
      : frontendResult.warningCount > 0
        ? 'partial'
        : frontendResult.artifact.summary.fileCount === 0
          ? 'complete'
          : 'complete'

  return {
    dataModelResult,
    frontendResult,
    semanticArtifacts: {
      dataModel: 'data-model.json',
      dataModelGraph: 'data-model-graph.json',
      modelViewLineage: null,
      frontendSemantic: frontendResult.artifact.summary.fileCount > 0 ? 'frontend-semantic.json' : null,
    },
    analyzers: [
      {
        id: 'data-model',
        status: dmWarningCount > 0 ? 'partial' : 'complete',
        version: DATA_MODEL_SCHEMA_VERSION,
        schemaVersion: dataModelResult.dataModel.schemaVersion,
        artifacts: [
          {
            name: 'dataModel',
            path: 'data-model.json',
            artifactKind: DATA_MODEL_ARTIFACT_KIND,
          },
          {
            name: 'dataModelGraph',
            path: 'data-model-graph.json',
            artifactKind: DATA_MODEL_GRAPH_ARTIFACT_KIND,
          },
        ],
        warningCount: dmWarningCount,
        errorCount: 0,
        summary: {
          entityCount: dataModelResult.dataModel.summary.entityCount,
          fieldCount: dataModelResult.dataModel.summary.fieldCount,
          relationshipCount: dataModelResult.dataModel.summary.relationshipCount,
          graphNodeCount: dataModelResult.dataModelGraph.summary.nodeCount,
          graphEdgeCount: dataModelResult.dataModelGraph.summary.edgeCount,
        },
      },
      {
        id: 'model-view-lineage',
        status: 'not-run',
        artifacts: [],
        warningCount: 0,
        errorCount: 0,
      },
      {
        id: 'frontend-semantic',
        status: frontendStatus,
        version: FRONTEND_SEMANTIC_SCHEMA_VERSION,
        schemaVersion: FRONTEND_SEMANTIC_SCHEMA_VERSION,
        artifacts:
          frontendResult.artifact.summary.fileCount > 0
            ? [{ name: 'frontendSemantic', path: 'frontend-semantic.json', artifactKind: FRONTEND_SEMANTIC_ARTIFACT_KIND }]
            : [],
        warningCount: frontendResult.warningCount,
        errorCount: frontendResult.errorCount,
        summary: {
          fileCount: frontendResult.artifact.summary.fileCount,
          jsxFileCount: frontendResult.artifact.summary.jsxFileCount,
          testFileCount: frontendResult.artifact.summary.testFileCount,
          componentCount: frontendResult.artifact.summary.componentCount,
          hookCount: frontendResult.artifact.summary.hookCount,
          testBlockCount: frontendResult.artifact.summary.testBlockCount,
          uiStringCount: frontendResult.artifact.summary.uiStringCount,
          locatorCount: frontendResult.artifact.summary.locatorCount,
        },
      },
    ],
  }
}

export function replaceAnalyzerStatuses(
  base: readonly IndexAnalyzerStatus[] | undefined,
  replacements: readonly IndexAnalyzerStatus[]
): IndexAnalyzerStatus[] {
  const byId = new Map<string, IndexAnalyzerStatus>()
  for (const analyzer of base ?? []) byId.set(analyzer.id, analyzer)
  for (const analyzer of replacements) byId.set(analyzer.id, analyzer)
  return [...byId.values()]
}
