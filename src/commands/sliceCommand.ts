import type { Command } from 'commander'
import { loadLookupArtifacts } from '../indexing/loadIndexArtifacts.js'
import { sliceGraph, summarizeSlice } from '../graph/sliceGraph.js'
import type { GraphSlice, GraphSliceDirection } from '../graph/graphSliceTypes.js'
import { writeGraphSlice } from '../graph/writeGraphSlice.js'
import { parseInteger } from './parseUtils.js'

export function registerSliceCommand(program: Command): void {
  program
    .command('slice')
    .description('Build a bounded graph neighborhood slice.')
    .option('--index <dir>', 'index artifact directory', '.my-dev-kit')
    .option('--node <node-id>', 'node id to slice around')
    .option('--depth <n>', 'slice depth', parseInteger, 1)
    .option('--direction <both|incoming|outgoing>', 'traversal direction', 'both')
    .option('--out <path>', 'output path')
    .option('--json', 'print JSON output')
    .action((options: SliceCommandOptions) => {
      if (!options.node) throw new Error('The slice command requires --node <node-id>.')
      const artifacts = loadLookupArtifacts(options.index)
      const core = sliceGraph({
        graph: artifacts.codeGraph,
        focusNodeId: options.node,
        depth: options.depth,
        direction: options.direction,
      })
      const slice: GraphSlice = {
        artifactKind: 'my-dev-kit-v1-graph-slice',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        indexDir: options.index,
        focusNodeId: options.node,
        depth: options.depth,
        direction: options.direction,
        nodes: core.nodes,
        edges: core.edges,
        summary: summarizeSlice(core.nodes, core.edges),
        artifactPaths: {
          manifest: `${options.index}/manifest.json`,
          codeGraph: `${options.index}/${artifacts.resolved.manifest.artifacts.codeGraph}`,
        },
        warnings: core.warnings,
      }
      const writtenPath = options.out ? writeGraphSlice(options.out, slice) : null
      const result = { ...slice, outputPath: writtenPath }
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log(`Graph slice: ${slice.summary.nodeCount} node(s), ${slice.summary.edgeCount} edge(s).`)
      if (writtenPath) console.log(`Wrote: ${writtenPath}`)
    })
}

interface SliceCommandOptions {
  index: string
  node?: string
  depth: number
  direction: GraphSliceDirection
  out?: string
  json?: boolean
}
