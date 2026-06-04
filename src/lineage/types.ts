export const MODEL_VIEW_LINEAGE_SCHEMA_VERSION = '1.1.0'
export const MODEL_VIEW_LINEAGE_ARTIFACT_KIND = 'my-dev-kit-v1-model-view-lineage'

export type ModelViewLineageNodeKind =
  | 'data-entity'
  | 'data-field'
  | 'transformation'
  | 'view-model'
  | 'component'
  | 'component-prop'
  | 'rendered-field'
  | 'unknown'

export type ModelViewLineageEdgeKind =
  | 'reads-field'
  | 'derives-field'
  | 'creates-view-model'
  | 'passes-prop'
  | 'renders-field'
  | 'relates-to'
  | 'unknown'

export type ModelViewLineageConfidence = 'explicit' | 'inferred-static' | 'partial' | 'unknown'

export type ModelViewLineageWarningKind =
  | 'unsupported-pattern'
  | 'ambiguous-lineage'
  | 'missing-data-model-artifact'
  | 'missing-source'
  | 'skipped-dynamic-pattern'
  | 'partial-lineage'

export interface ModelViewLineageEvidenceRef {
  filePath: string
  symbolId?: string | null
  line?: number | null
  column?: number | null
  dataModelEntityId?: string | null
  dataModelFieldId?: string | null
  note?: string | null
}

export interface ModelViewLineageWarning {
  kind: ModelViewLineageWarningKind
  message: string
  nodeId?: string | null
  edgeId?: string | null
  evidenceRefs?: ModelViewLineageEvidenceRef[]
}

export interface ModelViewLineageNode {
  id: string
  kind: ModelViewLineageNodeKind
  label: string
  confidence: ModelViewLineageConfidence
  dataModelEntityId?: string | null
  dataModelFieldId?: string | null
  evidenceRefs: ModelViewLineageEvidenceRef[]
  warnings: ModelViewLineageWarning[]
}

export interface ModelViewLineageEdge {
  id: string
  kind: ModelViewLineageEdgeKind
  source: string
  target: string
  confidence: ModelViewLineageConfidence
  evidenceRefs: ModelViewLineageEvidenceRef[]
  warnings: ModelViewLineageWarning[]
}

export interface ModelViewLineageSummary {
  nodeCount: number
  edgeCount: number
  evidenceCount: number
  warningCount: number
}

export interface ModelViewLineageArtifact {
  artifactKind: typeof MODEL_VIEW_LINEAGE_ARTIFACT_KIND
  schemaVersion: string
  createdAt: string
  nodes: ModelViewLineageNode[]
  edges: ModelViewLineageEdge[]
  warnings: ModelViewLineageWarning[]
  summary: ModelViewLineageSummary
}
