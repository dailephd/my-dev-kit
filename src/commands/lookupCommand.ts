import type { Command } from 'commander'
import { toForwardSlash } from '../io/pathUtils.js'
import { loadLookupArtifacts } from '../indexing/loadIndexArtifacts.js'
import { lookupNode } from '../lookup/lookupNode.js'
import { parseInteger } from './parseUtils.js'
import {
  loadFrontendReachabilityArtifact,
  resolveReachabilityMode,
  buildReachabilityLookupResult,
  type ReachabilityLookupResult,
} from '../frontend-reachability/index.js'
import {
  loadAndroidGraphData,
  buildAndroidComponentLookupResult,
  type AndroidComponentLookupResult,
} from '../android/index.js'

interface LookupCommandOptions {
  index: string
  node?: string
  route?: string
  storageKey?: string
  ui?: string
  androidComponent?: string
  depth: number
  json?: boolean
  resolveClassification?: boolean
}

export function registerLookupCommand(program: Command): void {
  program
    .command('lookup')
    .description('Look up an indexed graph node.')
    .option('--index <dir>', 'index artifact directory', '.my-dev-kit')
    .option('--node <node-id>', 'node id to look up')
    .option('--route <path>', 'look up a frontend-reachability route fact')
    .option('--storage-key <key>', 'look up a frontend-reachability browser-storage key fact')
    .option('--ui <value>', 'look up a frontend-reachability UI marker fact')
    .option('--android-component <name>', 'look up an Android manifest component (exact FQCN, raw manifest name, or simple name)')
    .option('--depth <n>', 'traversal depth', parseInteger, 1)
    .option(
      '--resolve-classification',
      'resolve the full classification.json entry for --node, when a classification analyzer artifact is present'
    )
    .option('--json', 'print JSON output')
    .action((options: LookupCommandOptions) => {
      const reachabilityMode = resolveReachabilityMode(options)
      if (reachabilityMode) {
        if (options.node !== undefined) {
          throw new Error(
            'The reachability flags (--route, --storage-key, --ui) cannot be combined with --node.'
          )
        }
        const artifact = loadFrontendReachabilityArtifact(options.index)
        const result = buildReachabilityLookupResult(artifact, reachabilityMode.mode, reachabilityMode.query)
        if (options.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }
        printReachabilityLookupResult(result)
        return
      }

      if (options.androidComponent !== undefined) {
        if (options.node !== undefined) {
          throw new Error('--android-component cannot be combined with --node.')
        }
        const graphData = loadAndroidGraphData(options.index)
        const result = buildAndroidComponentLookupResult(graphData, options.androidComponent)
        if (options.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }
        printAndroidComponentLookupResult(result)
        return
      }

      if (!options.node) {
        throw new Error(
          'The lookup command requires --node <node-id> (or --route, --storage-key, --ui, or --android-component).'
        )
      }
      const artifacts = loadLookupArtifacts(options.index)
      const result = lookupNode({
        graph: artifacts.codeGraph,
        indexDir: options.index,
        nodeId: options.node,
        depth: options.depth,
        manifestPath: toForwardSlash(artifacts.resolved.manifestPath),
        codeGraphPath: toForwardSlash(artifacts.resolved.artifactPaths.codeGraph),
        resolveClassification: options.resolveClassification,
        manifest: artifacts.resolved.manifest,
      })
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log(`Found ${result.node.kind} node: ${result.node.id}`)
      console.log(`Incoming edges: ${result.incomingEdges.length}`)
      console.log(`Outgoing edges: ${result.outgoingEdges.length}`)
      console.log(`Neighbors within depth ${result.depth}: ${result.neighbors.length}`)
      if (result.classificationRoles?.length) {
        console.log(`Classification: ${result.classificationRoles.map((role) => role.role).join(', ')}`)
      }
      if (result.androidComponentRoles?.length) {
        console.log(`Android roles: ${result.androidComponentRoles.map((role) => `${role.role} (${role.confidence})`).join(', ')}`)
      }
    })
}

function printAndroidComponentLookupResult(result: AndroidComponentLookupResult): void {
  console.log(`Android component lookup: ${result.query}`)
  console.log(`Status: ${result.status}`)
  for (const warning of result.warnings) console.log(`Warning: ${warning}`)
  if (result.status === 'ambiguous') {
    for (const candidate of result.candidates) {
      console.log(`- ${candidate.graphNodeId} (${candidate.matchKind}, ${candidate.kind})`)
    }
    return
  }
  if (result.status === 'found' && result.detail) {
    console.log(`Component: ${result.detail.graphNodeId} (${result.detail.componentKind ?? 'unknown'})`)
    console.log(`Resolved name: ${result.detail.resolvedName ?? 'unresolved'}`)
    console.log(`Source class candidates: ${result.detail.sourceClassCandidates.length}`)
    console.log(`Intent filters: ${result.detail.intentFilterIds.length}`)
    console.log(`Permission edges: ${result.detail.permissionEdges.length}`)
  }
}

function printReachabilityLookupResult(result: ReachabilityLookupResult): void {
  console.log(`Reachability lookup (${result.mode}): ${result.query}`)
  console.log(`Status: ${result.status}`)
  if (result.status !== 'found') {
    for (const warning of result.warnings) console.log(`Warning: ${warning}`)
    return
  }
  console.log(`Facts: ${result.summary.factCount}, related edges: ${result.summary.edgeCount}`)
  for (const fact of result.facts) {
    console.log(`- ${fact.id} (${fact.confidence})`)
  }
}
