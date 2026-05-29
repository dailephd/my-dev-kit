export type GraphViewFormat = 'dot' | 'svg' | 'png'

export type GraphEdgeStyleMode = 'semantic' | 'labeled' | 'minimal'

export interface GraphViewResult {
  status: 'ok'
  indexDir: string
  requestedFormat: GraphViewFormat
  actualFormat: GraphViewFormat
  outputPath: string
  nodeCount: number
  edgeCount: number
  graphvizUsed: boolean
  dotFallbackUsed: boolean
  edgeStyle: GraphEdgeStyleMode
  warnings: string[]
}
