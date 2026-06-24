import type { Command } from 'commander'
import { toForwardSlash } from '../io/pathUtils.js'
import { loadLookupArtifacts } from '../indexing/loadIndexArtifacts.js'
import { sliceGraph, summarizeSlice } from '../graph/sliceGraph.js'
import type { GraphSlice, GraphSliceDirection } from '../graph/graphSliceTypes.js'
import { writeGraphSlice } from '../graph/writeGraphSlice.js'
import { parseInteger } from './parseUtils.js'
import { isReactEventFlowKind, isReactPropFlowKind } from '../source/localComponentTreeSource.js'
import {
  loadFrontendReachabilityArtifact,
  resolveReachabilityMode,
  buildReachabilitySliceResult,
  type ReachabilitySliceResult,
} from '../frontend-reachability/index.js'

export function registerSliceCommand(program: Command): void {
  program
    .command('slice')
    .description('Build a bounded graph neighborhood slice.')
    .option('--index <dir>', 'index artifact directory', '.my-dev-kit')
    .option('--node <node-id>', 'node id to slice around')
    .option('--route <path>', 'slice around a frontend-reachability route fact')
    .option('--storage-key <key>', 'slice around a frontend-reachability browser-storage key fact')
    .option('--ui <value>', 'slice around a frontend-reachability UI marker fact')
    .option('--include-tests', 'include test evidence refs (reachability slice only)')
    .option('--include-storage', 'include storage key facts in route/UI reachability slice')
    .option('--include-ui', 'include UI marker facts in route reachability slice')
    .option('--depth <n>', 'slice depth', parseInteger, 1)
    .option('--direction <both|incoming|outgoing>', 'traversal direction', 'both')
    .option('--include-prop-flow', 'include local React prop-flow relationship edges')
    .option('--include-event-handlers', 'include local React event-handler relationship edges')
    .option('--out <path>', 'output path')
    .option('--json', 'print JSON output')
    .action((options: SliceCommandOptions) => {
      const reachabilityMode = resolveReachabilityMode(options)
      if (reachabilityMode) {
        if (options.node !== undefined) {
          throw new Error(
            'The reachability flags (--route, --storage-key, --ui) cannot be combined with --node.'
          )
        }
        const artifact = loadFrontendReachabilityArtifact(options.index)
        const result = buildReachabilitySliceResult(artifact, reachabilityMode.mode, reachabilityMode.query, {
          includeTests: options.includeTests,
          includeStorage: options.includeStorage,
          includeUi: options.includeUi,
        })
        if (options.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }
        printReachabilitySliceResult(result)
        return
      }

      if (options.includeTests || options.includeStorage || options.includeUi) {
        throw new Error(
          'The --include-tests, --include-storage, and --include-ui flags are only valid with --route, --storage-key, or --ui.'
        )
      }
      if (!options.node) {
        throw new Error('The slice command requires --node <node-id> (or --route, --storage-key, or --ui).')
      }
      const artifacts = loadLookupArtifacts(options.index)
      const includeEdgeKinds = selectedReactFlowKinds(options)
      const core = sliceGraph({
        graph: artifacts.codeGraph,
        focusNodeId: options.node,
        depth: options.depth,
        direction: options.direction,
        includeEdgeKinds,
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
          manifest: toForwardSlash(artifacts.resolved.manifestPath),
          codeGraph: toForwardSlash(artifacts.resolved.artifactPaths.codeGraph),
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
  route?: string
  storageKey?: string
  ui?: string
  includeTests?: boolean
  includeStorage?: boolean
  includeUi?: boolean
  depth: number
  direction: GraphSliceDirection
  includePropFlow?: boolean
  includeEventHandlers?: boolean
  out?: string
  json?: boolean
}

function printReachabilitySliceResult(result: ReachabilitySliceResult): void {
  console.log(`Reachability slice (${result.mode}): ${result.query}`)
  console.log(`Status: ${result.status}`)
  if (result.status !== 'ok') {
    for (const warning of result.warnings) console.log(`Warning: ${warning}`)
    return
  }
  const { routeCount, storageKeyCount, uiCount, edgeCount } = result.summary
  console.log(
    `Routes: ${routeCount}, storage keys: ${storageKeyCount}, UI markers: ${uiCount}, edges: ${edgeCount}.`
  )
  if (result.testEvidence.length > 0) console.log(`Test evidence: ${result.testEvidence.length}`)
}

function selectedReactFlowKinds(options: SliceCommandOptions): Set<string> | undefined {
  if (!options.includePropFlow && !options.includeEventHandlers) return undefined
  const kinds = new Set<string>()
  for (const kind of ALL_REACT_FLOW_EDGE_KINDS) {
    if ((options.includePropFlow || options.includeEventHandlers) && kind === 'react-renders-local-component') {
      kinds.add(kind)
    }
    if (options.includePropFlow && isReactPropFlowKind(kind)) kinds.add(kind)
    if (options.includeEventHandlers && isReactEventFlowKind(kind)) kinds.add(kind)
  }
  return kinds
}

const ALL_REACT_FLOW_EDGE_KINDS = [
  'react-renders-local-component',
  'react-passes-prop',
  'react-passes-callback-prop',
  'react-callback-invoked-by-child',
  'react-event-uses-handler',
  'react-handler-reads-state',
  'react-handler-sets-state',
  'react-state-controls-jsx-branch',
  'react-helper-computes-prop',
  'react-prop-reference',
]
