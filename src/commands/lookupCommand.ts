import type { Command } from 'commander'
import { toForwardSlash } from '../io/pathUtils.js'
import { loadLookupArtifacts } from '../indexing/loadIndexArtifacts.js'
import { lookupNode } from '../lookup/lookupNode.js'
import { parseInteger } from './parseUtils.js'

export function registerLookupCommand(program: Command): void {
  program
    .command('lookup')
    .description('Look up an indexed graph node.')
    .option('--index <dir>', 'index artifact directory', '.my-dev-kit')
    .option('--node <node-id>', 'node id to look up')
    .option('--depth <n>', 'traversal depth', parseInteger, 1)
    .option('--json', 'print JSON output')
    .action((options: { index: string; node?: string; depth: number; json?: boolean }) => {
      if (!options.node) throw new Error('The lookup command requires --node <node-id>.')
      const artifacts = loadLookupArtifacts(options.index)
      const result = lookupNode({
        graph: artifacts.codeGraph,
        indexDir: options.index,
        nodeId: options.node,
        depth: options.depth,
        manifestPath: toForwardSlash(artifacts.resolved.manifestPath),
        codeGraphPath: toForwardSlash(artifacts.resolved.artifactPaths.codeGraph),
      })
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log(`Found ${result.node.kind} node: ${result.node.id}`)
      console.log(`Incoming edges: ${result.incomingEdges.length}`)
      console.log(`Outgoing edges: ${result.outgoingEdges.length}`)
      console.log(`Neighbors within depth ${result.depth}: ${result.neighbors.length}`)
    })
}
