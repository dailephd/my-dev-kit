export const GRAPH_DIFF_REPORT_KIND = 'my-dev-kit-v1-graph-diff'

export interface GraphDiffSide {
  indexDir: string
  projectRoot: string
}

export interface ChangedFieldEntry {
  field: string
  before: unknown
  after: unknown
}

export interface CompactNodeRef {
  id: string
  kind: string
  label: string
}

export interface ChangedNodeEntry {
  id: string
  kind: string
  changedFields: string[]
  before: Record<string, unknown>
  after: Record<string, unknown>
}

export interface CompactEdgeRef {
  id: string
  source: string
  target: string
  kind: string
}

export interface ChangedEdgeEntry {
  id: string
  source: string
  target: string
  kind: string
  changedFields: string[]
  before: Record<string, unknown>
  after: Record<string, unknown>
}

export interface GraphDiffNodesSection {
  added: CompactNodeRef[]
  removed: CompactNodeRef[]
  changed: ChangedNodeEntry[]
}

export interface GraphDiffEdgesSection {
  added: CompactEdgeRef[]
  removed: CompactEdgeRef[]
  changed: ChangedEdgeEntry[]
}

export interface SymbolIndexDiffSection {
  available: boolean
  filesAdded: string[]
  filesRemoved: string[]
  filesChanged: string[]
  symbolsAdded: string[]
  symbolsRemoved: string[]
  symbolsChanged: string[]
}

export interface AnalyzerStatusChange {
  id: string
  before: string | null
  after: string | null
}

export interface ManifestDiffSection {
  schemaVersionMatch: boolean
  changedFields: ChangedFieldEntry[]
  analyzerChanges: AnalyzerStatusChange[]
}

export type ArtifactAvailability = 'both' | 'before-only' | 'after-only' | 'neither'

export interface ClassificationDiffSection {
  available: ArtifactAvailability
  added: string[]
  removed: string[]
  changed: Array<{ id: string; changedFields: string[] }>
}

export interface SemanticSummaryDiffSection {
  available: ArtifactAvailability
  changedFields: ChangedFieldEntry[]
}

export interface GraphDiffSummary {
  nodesAdded: number
  nodesRemoved: number
  nodesChanged: number
  edgesAdded: number
  edgesRemoved: number
  edgesChanged: number
  filesAdded: number
  filesRemoved: number
  filesChanged: number
  symbolsAdded: number
  symbolsRemoved: number
  symbolsChanged: number
}

export interface GraphDiffResult {
  reportKind: typeof GRAPH_DIFF_REPORT_KIND
  before: GraphDiffSide
  after: GraphDiffSide
  summary: GraphDiffSummary
  nodes: GraphDiffNodesSection
  edges: GraphDiffEdgesSection
  symbolIndex: SymbolIndexDiffSection
  manifest: ManifestDiffSection
  classification: ClassificationDiffSection
  semanticArtifacts: {
    dataModel: SemanticSummaryDiffSection
    frontendSemantic: SemanticSummaryDiffSection
    frontendReachability: SemanticSummaryDiffSection
  }
  warnings: string[]
}
