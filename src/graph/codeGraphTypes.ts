import type { SemanticArtifactRef, SemanticRole } from '../semantics/index.js'
import type { FrontendSourceRef, ReactFlowRelationshipKind } from '../frontend/index.js'

export const CODE_GRAPH_SCHEMA_VERSION = '1.0.0'

export type CodeGraphNodeKind = 'file' | 'symbol' | 'frontend-fact'

export type CodeGraphEdgeKind =
  | 'defines'
  | 'imports'
  | 'exports'
  | 'depends-on'
  | 'calls'
  | 'related-to'
  | ReactFlowRelationshipKind

export interface CodeGraphNode {
  id: string
  kind: CodeGraphNodeKind
  label: string
  path?: string
  symbolName?: string
  symbolKind?: string
  language?: string
  line?: number
  exported?: boolean
  frontendFactKind?: string
  frontendId?: string
  sourceRef?: FrontendSourceRef
  semanticRoles?: SemanticRole[]
  artifactRefs?: SemanticArtifactRef[]
}

export interface CodeGraphEdge {
  id: string
  source: string
  target: string
  kind: CodeGraphEdgeKind
  label?: string
  sourceRef?: FrontendSourceRef
  metadata?: Record<string, string | number | boolean | null>
}

export interface CodeGraph {
  artifactKind: 'code-graph'
  schemaVersion: string
  createdAt: string
  nodes: CodeGraphNode[]
  edges: CodeGraphEdge[]
  summary: {
    nodeCount: number
    edgeCount: number
    fileNodeCount: number
    symbolNodeCount: number
  }
}
