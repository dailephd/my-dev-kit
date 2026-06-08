import { adaptCodeGraph } from './adaptGraphArtifact.js'
import type { CodeGraph } from './codeGraphTypes.js'
import { buildRenderableDotGraph } from './buildRenderableDotGraph.js'
import type { GraphEdgeStyleMode } from './dotTypes.js'

export interface BuildDotGraphOptions {
  edgeStyle?: GraphEdgeStyleMode
}

export function buildDotGraph(graph: CodeGraph, options: BuildDotGraphOptions = {}): string {
  return buildRenderableDotGraph(adaptCodeGraph(graph), options)
}
