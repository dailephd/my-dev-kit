import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { SymbolIndex } from '../symbol-index/types.js'
import type { DataModelArtifact } from '../data-model/types.js'
import type { FrontendSemanticArtifact } from '../frontend/frontendTypes.js'
import type { FrontendReachabilityArtifact } from '../frontend-reachability/index.js'
import { classifyFile } from './classifyFiles.js'
import { classifySymbol } from './classifySymbols.js'
import { gatherSymbolEvidence } from './gatherSymbolEvidence.js'
import { CLASSIFICATION_ARTIFACT_KIND, CLASSIFICATION_SCHEMA_VERSION, type ClassificationArtifact } from './classificationTypes.js'

export interface BuildClassificationArtifactOptions {
  symbolIndex: SymbolIndex
  codeGraph: CodeGraph
  dataModel: DataModelArtifact | null
  frontendSemantic: FrontendSemanticArtifact | null
  frontendReachability: FrontendReachabilityArtifact | null
  createdAt: string
}

export interface BuildClassificationArtifactResult {
  artifact: ClassificationArtifact
  warningCount: number
  errorCount: number
}

/**
 * PSE-001: top-level classification pipeline. Iterates symbolIndex.files in
 * stable (as-listed) order for files, then each file's symbols in
 * declaration order, producing a deterministic concatenation of file entries
 * followed by symbol entries (BEH-071).
 */
export function buildClassificationArtifact(options: BuildClassificationArtifactOptions): BuildClassificationArtifactResult {
  const fileEntries = options.symbolIndex.files.map((file) => classifyFile(file))

  const symbolEntries = options.symbolIndex.files.flatMap((file) =>
    file.symbols.map((symbol) => {
      const evidence = gatherSymbolEvidence(
        file.path,
        symbol,
        options.codeGraph,
        options.dataModel,
        options.frontendSemantic,
        options.frontendReachability
      )
      return classifySymbol(file.path, symbol, evidence)
    })
  )

  const allEntries = [...fileEntries, ...symbolEntries]
  const warningCount = allEntries.reduce((sum, entry) => sum + entry.warnings.length, 0)

  const artifact: ClassificationArtifact = {
    artifactKind: CLASSIFICATION_ARTIFACT_KIND,
    schemaVersion: CLASSIFICATION_SCHEMA_VERSION,
    createdAt: options.createdAt,
    entries: allEntries,
    summary: {
      entryCount: allEntries.length,
      fileEntryCount: fileEntries.length,
      symbolEntryCount: symbolEntries.length,
      warningCount,
    },
  }

  return { artifact, warningCount, errorCount: 0 }
}
