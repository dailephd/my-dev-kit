import type { Command } from 'commander'
import { runIndexCommand, type RunIndexCommandOptions } from '../indexing/runIndexCommand.js'

export function registerIndexCommand(program: Command): void {
  program
    .command('index')
    .description('Index a local TypeScript, JavaScript, or Python codebase.')
    .option('--root <path>', 'project root', '.')
    .option('--src <path>', 'source root to index; may be repeated', collectValues, [])
    .option('--language <language>', 'source language: typescript, javascript, or python')
    .option('--out <dir>', 'output directory', '.my-dev-kit')
    .option('--exclude <path-or-name>', 'directory name or relative path prefix to exclude; may be repeated', collectValues, [])
    .option('--dry-run', 'scan and report what would be indexed without writing artifacts')
    .option('--progress', 'print bounded progress diagnostics to stderr')
    .option('--call-graph', 'include call graph when supported')
    .option('--json', 'print JSON output')
    .action(async (options: RunIndexCommandOptions) => {
      const result = await runIndexCommand(options)
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      if (result.mode === 'dry-run') {
        printDryRunSummary(result)
        return
      }
      console.log(`Indexed ${result.manifest.summary.fileCount} file(s) and ${result.manifest.summary.symbolCount} symbol(s).`)
      console.log(`Output: ${result.outputDir}`)
      console.log('Artifacts: manifest.json, symbol-index.json, code-graph.json')
      if (result.callGraphPath) {
        console.log('Call graph: call-graph.json')
      }
    })
}

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value]
}

function printDryRunSummary(result: Extract<Awaited<ReturnType<typeof runIndexCommand>>, { mode: 'dry-run' }>): void {
  console.log('Dry-run scan completed.')
  console.log(`Project root: ${result.projectRoot}`)
  console.log(`Source roots: ${result.sourceRoots.join(', ')}`)
  console.log(`Output directory: ${result.outputDir}`)
  console.log(`Eligible files: ${result.totalFilesEligibleForIndexing}`)
  console.log(`Files discovered: ${result.totalFilesDiscovered}`)
  console.log(`Skipped paths: ${result.totalFilesSkipped}`)
  console.log(`Skipped by default ignore: ${result.skippedByDefaultIgnore}`)
  console.log(`Skipped by user exclude: ${result.skippedByUserExclude}`)
  console.log(`Language counts: ${JSON.stringify(result.languageCounts)}`)
  if (result.largestFiles.length > 0) {
    console.log('Largest files:')
    for (const file of result.largestFiles) {
      console.log(`- ${file.path} (${file.sizeBytes} bytes)`)
    }
  }
  if (result.sampleIndexedFiles.length > 0) {
    console.log('Sample indexed files:')
    for (const file of result.sampleIndexedFiles) console.log(`- ${file}`)
  }
  if (result.sampleSkippedFiles.length > 0) {
    console.log('Sample skipped paths:')
    for (const file of result.sampleSkippedFiles) console.log(`- ${file.path} (${file.reason})`)
  }
}
