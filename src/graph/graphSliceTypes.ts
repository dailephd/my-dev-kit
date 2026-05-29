import type { CodeGraphEdge, CodeGraphNode } from './codeGraphTypes.js'

export type GraphSliceDirection = 'both' | 'incoming' | 'outgoing'

export interface GraphSlice {
  artifactKind: 'my-dev-kit-v1-graph-slice'
  version: '1.0.0'
  createdAt: string
  indexDir: string
  focusNodeId: string
  depth: number
  direction: GraphSliceDirection
  nodes: CodeGraphNode[]
  edges: CodeGraphEdge[]
  summary: {
    nodeCount: number
    edgeCount: number
    nodesByKind: Record<string, number>
    edgesByKind: Record<string, number>
  }
  artifactPaths: {
    manifest: string
    codeGraph: string
  }
  warnings: string[]
}

export interface GraphSliceCore {
  nodes: CodeGraphNode[]
  edges: CodeGraphEdge[]
  warnings: string[]
}
