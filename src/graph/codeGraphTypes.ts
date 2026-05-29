export const CODE_GRAPH_SCHEMA_VERSION = '1.0.0'

export type CodeGraphNodeKind = 'file' | 'symbol'

export type CodeGraphEdgeKind = 'defines' | 'imports' | 'exports' | 'depends-on' | 'calls' | 'related-to'

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
}

export interface CodeGraphEdge {
  id: string
  source: string
  target: string
  kind: CodeGraphEdgeKind
  label?: string
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
