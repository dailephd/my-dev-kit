import type { Command } from 'commander'
import { runGraphDiff } from '../graph-diff/runGraphDiff.js'
import type { GraphDiffResult } from '../graph-diff/types.js'

interface GraphDiffCommandOptions {
  before?: string
  after?: string
  json?: boolean
}

export function registerGraphDiffCommand(program: Command): void {
  program
    .command('graph-diff')
    .description('Compare two existing my-dev-kit index directories and report added, removed, and changed graph elements.')
    .option('--before <index-dir>', 'the earlier index artifact directory')
    .option('--after <index-dir>', 'the later index artifact directory')
    .option('--json', 'print JSON output')
    .action((options: GraphDiffCommandOptions) => {
      if (!options.before || !options.after) {
        throw new Error('The graph-diff command requires both --before <index-dir> and --after <index-dir>.')
      }
      const result = runGraphDiff({ before: options.before, after: options.after })
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      printGraphDiffSummary(result)
    })
}

function printGraphDiffSummary(result: GraphDiffResult): void {
  console.log(`Comparing ${result.before.indexDir} -> ${result.after.indexDir}`)
  console.log(
    `Nodes: +${result.summary.nodesAdded} -${result.summary.nodesRemoved} ~${result.summary.nodesChanged}`
  )
  console.log(
    `Edges: +${result.summary.edgesAdded} -${result.summary.edgesRemoved} ~${result.summary.edgesChanged}`
  )
  if (result.symbolIndex.available) {
    console.log(
      `Files: +${result.summary.filesAdded} -${result.summary.filesRemoved} ~${result.summary.filesChanged}` +
        `  Symbols: +${result.summary.symbolsAdded} -${result.summary.symbolsRemoved} ~${result.summary.symbolsChanged}`
    )
  }
  if (result.manifest.changedFields.length > 0 || result.manifest.analyzerChanges.length > 0) {
    console.log(
      `Manifest: ${result.manifest.changedFields.length} field(s) changed, ${result.manifest.analyzerChanges.length} analyzer status change(s)`
    )
  }
  if (result.classification.available === 'both') {
    console.log(
      `Classification: +${result.classification.added.length} -${result.classification.removed.length} ~${result.classification.changed.length}`
    )
  }
  if (result.warnings.length > 0) {
    console.log('Warnings:')
    for (const warning of result.warnings) console.log(`- ${warning}`)
  }
}
