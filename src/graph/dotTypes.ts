import type { GraphArtifactSelection } from './adaptGraphArtifact.js'

export type GraphViewFormat = 'dot' | 'svg' | 'png'

export type GraphEdgeStyleMode = 'semantic' | 'labeled' | 'minimal'

export interface GraphViewResult {
  status: 'ok'
  indexDir: string
  graph: GraphArtifactSelection
  requestedFormat: GraphViewFormat
  format: GraphViewFormat
  actualFormat: GraphViewFormat
  outputPath: string
  artifactPath: string
  nodeCount: number
  edgeCount: number
  graphvizUsed: boolean
  dotFallbackUsed: boolean
  fallbackStatus: 'none' | 'dot-fallback'
  edgeStyle: GraphEdgeStyleMode
  warnings: string[]
}
