import type { Command } from 'commander'
import * as path from 'node:path'
import { loadLookupArtifacts } from '../indexing/loadIndexArtifacts.js'
import { buildDotGraph } from '../graph/buildDotGraph.js'
import { isGraphvizAvailable, renderGraphviz } from '../graph/renderGraphviz.js'
import { writeGraphView } from '../graph/writeGraphView.js'
import type { GraphEdgeStyleMode, GraphViewFormat, GraphViewResult } from '../graph/dotTypes.js'

export function registerViewCommand(program: Command): void {
  program
    .command('view')
    .description('Render code graph artifacts as DOT, SVG, or PNG.')
    .option('--index <dir>', 'index artifact directory', '.my-dev-kit-v1')
    .option('--format <dot|svg|png>', 'output format', 'dot')
    .option('--out <path>', 'output path')
    .option('--edge-style <semantic|labeled|minimal>', 'edge visualization style', 'semantic')
    .option('--allow-dot-fallback', 'fall back when Graphviz dot is unavailable')
    .option('--json', 'print JSON output')
    .action((options: ViewCommandOptions) => {
      const requestedFormat = parseFormat(options.format)
      const edgeStyle = parseEdgeStyle(options.edgeStyle)
      const artifacts = loadLookupArtifacts(options.index)
      const dotText = buildDotGraph(artifacts.codeGraph, { edgeStyle })
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
        requestedFormat,
        actualFormat,
        outputPath: writtenPath,
        nodeCount: artifacts.codeGraph.nodes.length,
        edgeCount: artifacts.codeGraph.edges.length,
        graphvizUsed,
        dotFallbackUsed,
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
  format: string
  out?: string
  edgeStyle: string
  allowDotFallback?: boolean
  json?: boolean
}

function parseFormat(format: string): GraphViewFormat {
  if (format === 'dot' || format === 'svg' || format === 'png') return format
  throw new Error(`Unsupported view format "${format}". Supported values: dot, svg, png.`)
}

function parseEdgeStyle(value: string): GraphEdgeStyleMode {
  if (value === 'semantic' || value === 'labeled' || value === 'minimal') return value
  throw new Error(`Unsupported --edge-style value "${value}". Supported values: semantic, labeled, minimal.`)
}
