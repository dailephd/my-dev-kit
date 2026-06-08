export interface RenderableGraphNode {
  id: string
  kind: string
  label: string
  shape?: string
}

export interface RenderableGraphEdge {
  id: string
  source: string
  target: string
  kind: string
  label?: string
}

export interface RenderableGraph {
  id: string
  label: string
  nodes: RenderableGraphNode[]
  edges: RenderableGraphEdge[]
}
