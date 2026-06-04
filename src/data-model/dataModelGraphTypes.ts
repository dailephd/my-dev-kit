import type { DataModelSourceRef, DataModelWarning } from './types.js'

export const DATA_MODEL_GRAPH_ARTIFACT_KIND = 'my-dev-kit-v1-data-model-graph'

export type DataModelGraphNodeKind = 'entity' | 'field'
export type DataModelGraphEdgeKind = 'has-field' | 'relates-to' | 'derives-from'

export interface DataModelGraphNode {
  id: string
  kind: DataModelGraphNodeKind
  label: string
  entityId?: string | null
  fieldId?: string | null
  parentEntityId?: string | null
  sourceRefs: DataModelSourceRef[]
  warnings: DataModelWarning[]
}

export interface DataModelGraphEdge {
  id: string
  source: string
  target: string
  kind: DataModelGraphEdgeKind
  relationshipId?: string | null
  sourceRefs: DataModelSourceRef[]
  warnings: DataModelWarning[]
}

export interface DataModelGraphSummary {
  nodeCount: number
  edgeCount: number
  entityNodeCount: number
  fieldNodeCount: number
  relationshipEdgeCount: number
  warningCount: number
}

export interface DataModelGraphArtifact {
  artifactKind: typeof DATA_MODEL_GRAPH_ARTIFACT_KIND
  schemaVersion: string
  createdAt: string
  nodes: DataModelGraphNode[]
  edges: DataModelGraphEdge[]
  warnings: DataModelWarning[]
  summary: DataModelGraphSummary
}
