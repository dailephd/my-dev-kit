import type { CacheMode, ChangedFileSummary } from './cacheMetadata.js'
import type { IncrementalRefreshSummary } from './incrementalRefreshTypes.js'

export interface IndexManifest {
  artifactKind: 'my-dev-kit-v1-manifest'
  version: '1.0.0'
  createdAt: string
  projectRoot: string
  sourceRoots: string[]
  languages: string[]
  callGraphEnabled: boolean
  artifacts: {
    symbolIndex: string
    codeGraph: string
    callGraph: string | null
  }
  semanticArtifacts?: IndexSemanticArtifacts
  analyzers?: IndexAnalyzerStatus[]
  summary: {
    fileCount: number
    symbolCount: number
    edgeCount: number
    warningCount: number
    errorCount: number
  }
  warnings: string[]
  errors: string[]
  /** How this specific build was produced. Set every time artifacts are (re)written. */
  indexMode?: IndexModeValue
  /** Populated only when `indexMode` is `'incremental'`. */
  cacheMode?: CacheMode
  cacheInvalidationReason?: string | null
  changedFileSummary?: ChangedFileSummary | null
  /**
   * Artifact families that were fully regenerated rather than partially
   * reused during a partial rebuild (e.g. `["call-graph"]`). Always an
   * empty array outside the two `incremental-partial*` cache modes.
   */
  partialRebuildFallbackArtifacts?: string[]
  /**
   * v1.12.5: requested/applied refresh scope and fresh-vs-reused evidence.
   * Additive and optional. Present only when an incremental invocation wrote
   * this index; a no-change run leaves the on-disk manifest untouched.
   */
  incrementalRefresh?: IncrementalRefreshSummary
}

export type IndexModeValue = 'full' | 'incremental'

export interface IndexSemanticArtifacts {
  dataModel: string | null
  dataModelGraph: string | null
  modelViewLineage: string | null
  frontendSemantic: string | null
  frontendReachability?: string | null
}

export type IndexAnalyzerId =
  | 'syntax'
  | 'call-graph'
  | 'data-model'
  | 'model-view-lineage'
  | 'frontend-semantic'
  | 'frontend-reachability'
  | 'classification'
  | 'android-project'
  | 'android-components'
  | (string & {})

export type IndexAnalyzerStatusValue = 'not-run' | 'complete' | 'partial' | 'failed' | 'skipped'

export interface IndexAnalyzerArtifactRef {
  name: string
  path: string
  artifactKind?: string | null
}

export interface IndexAnalyzerStatus {
  id: IndexAnalyzerId
  status: IndexAnalyzerStatusValue
  version?: string | null
  schemaVersion?: string | null
  artifacts?: IndexAnalyzerArtifactRef[]
  warningCount: number
  errorCount: number
  summary?: Record<string, number | string | boolean | null>
}
