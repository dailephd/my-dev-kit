import type { Command } from 'commander'
import * as path from 'node:path'
import {
  adaptCodeGraph,
  adaptDataModelGraph,
  adaptModelViewLineageGraph,
  type GraphArtifactSelection,
} from '../graph/adaptGraphArtifact.js'
import {
  adaptReactComponentGraph,
  adaptReactFlowGraph,
} from '../graph/adaptFrontendGraphs.js'
import type { CodeGraph } from '../graph/codeGraphTypes.js'
import { buildRenderableDotGraph } from '../graph/buildRenderableDotGraph.js'
import type { DataModelGraphArtifact } from '../data-model/dataModelGraphTypes.js'
import type { ModelViewLineageArtifact } from '../lineage/types.js'
import type { FrontendSemanticArtifact } from '../frontend/frontendTypes.js'
import { isGraphvizAvailable, renderGraphviz } from '../graph/renderGraphviz.js'
import { writeGraphView } from '../graph/writeGraphView.js'
import type { GraphEdgeStyleMode, GraphViewFormat, GraphViewResult } from '../graph/dotTypes.js'
import { loadViewGraphArtifact } from '../indexing/loadIndexArtifacts.js'

export function registerViewCommand(program: Command): void {
  program
    .command('view')
    .description('Render code graph artifacts as DOT, SVG, or PNG.')
    .option('--index <dir>', 'index artifact directory', '.my-dev-kit')
    .option('--graph <code|data-model|model-view-lineage|react-component|react-flow>', 'graph artifact to render', 'code')
    .option('--format <dot|svg|png>', 'output format', 'dot')
    .option('--out <path>', 'output path')
    .option('--edge-style <semantic|labeled|minimal>', 'edge visualization style', 'semantic')
    .option('--allow-dot-fallback', 'fall back when Graphviz dot is unavailable')
    .option('--json', 'print JSON output')
    .action((options: ViewCommandOptions) => {
      const requestedFormat = parseFormat(options.format)
      const edgeStyle = parseEdgeStyle(options.edgeStyle)
      const graphSelection = parseGraph(options.graph)
      const graphArtifact = loadViewGraphArtifact(options.index, graphSelection)
      const renderableGraph = adaptSelectedGraph(graphSelection, graphArtifact.artifact)
      const dotText = buildRenderableDotGraph(renderableGraph, { edgeStyle })
      const warnings: string[] = []
      let actualFormat: GraphViewFormat = requestedFormat
      let graphvizUsed = false
      let dotFallbackUsed = false
      let outputPath = options.out ?? path.join(options.index, `graph.${requestedFormat}`)
      let content: string | Buffer = dotText

      if (requestedFormat !== 'dot') {
        if (!isGraphvizAvailable()) {
          if (!options.allowDotFallback) {
            throw new Error('Graphviz dot executable is not available. Install Graphviz or use --allow-dot-fallback.')
          }
          warnings.push('Graphviz dot executable is not available; wrote DOT fallback instead.')
          actualFormat = 'dot'
          dotFallbackUsed = true
          outputPath = options.out ?? path.join(options.index, 'graph.dot')
          if (!outputPath.endsWith('.dot')) outputPath = outputPath.replace(/\.(svg|png)$/i, '.dot')
        } else {
          content = renderGraphviz(dotText, requestedFormat)
          graphvizUsed = true
        }
      }

      const writtenPath = writeGraphView(outputPath, content)
      const result: GraphViewResult = {
        status: 'ok',
        indexDir: options.index,
        graph: graphSelection,
        requestedFormat,
        format: actualFormat,
        actualFormat,
        outputPath: writtenPath,
        artifactPath: graphArtifact.artifactPath,
        nodeCount: renderableGraph.nodes.length,
        edgeCount: renderableGraph.edges.length,
        graphvizUsed,
        dotFallbackUsed,
        fallbackStatus: dotFallbackUsed ? 'dot-fallback' : 'none',
        edgeStyle,
        warnings,
      }
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log(`Wrote ${actualFormat.toUpperCase()} graph: ${writtenPath}`)
      if (warnings.length > 0) console.log(`Warnings: ${warnings.join('; ')}`)
    })
}

interface ViewCommandOptions {
  index: string
  graph: string
  format: string
  out?: string
  edgeStyle: string
  allowDotFallback?: boolean
  json?: boolean
}

function adaptSelectedGraph(graph: GraphArtifactSelection, artifact: unknown) {
  if (graph === 'code') return adaptCodeGraph(artifact as CodeGraph)
  if (graph === 'data-model') return adaptDataModelGraph(artifact as DataModelGraphArtifact)
  if (graph === 'model-view-lineage') return adaptModelViewLineageGraph(artifact as ModelViewLineageArtifact)
  if (graph === 'react-component') return adaptReactComponentGraph(artifact as FrontendSemanticArtifact)
  return adaptReactFlowGraph(artifact as FrontendSemanticArtifact)
}

function parseGraph(value: string): GraphArtifactSelection {
  if (
    value === 'code' ||
    value === 'data-model' ||
    value === 'model-view-lineage' ||
    value === 'react-component' ||
    value === 'react-flow'
  ) return value
  throw new Error(
    `Unsupported --graph value "${value}". Supported values: code, data-model, model-view-lineage, react-component, react-flow.`
  )
}

function parseFormat(format: string): GraphViewFormat {
  if (format === 'dot' || format === 'svg' || format === 'png') return format
  throw new Error(`Unsupported view format "${format}". Supported values: dot, svg, png.`)
}

function parseEdgeStyle(value: string): GraphEdgeStyleMode {
  if (value === 'semantic' || value === 'labeled' || value === 'minimal') return value
  throw new Error(`Unsupported --edge-style value "${value}". Supported values: semantic, labeled, minimal.`)
}
