import type { Command } from 'commander'
import { runIndexCommand, type IndexCacheSummary, type RunIndexCommandOptions } from '../indexing/runIndexCommand.js'
import type { PreflightWarning } from '../indexing/preflight.js'
import type { CacheResetResult } from '../indexing/cacheMetadata.js'

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
    .option(
      '--incremental',
      'partially rebuild using internal cache metadata: reuse unchanged files, re-analyze changed/added files, drop removed files; falls back to a full rebuild when partial reuse is unsafe (see docs/COMMANDS.md)'
    )
    .option('--reset-cache', 'clear internal incremental-index cache metadata for --out before running')
    .option('--json', 'print JSON output')
    .action(async (options: RunIndexCommandOptions) => {
      const result = await runIndexCommand(options)
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      printCacheReset(result.cacheReset)
      if (result.mode === 'dry-run') {
        printDryRunSummary(result)
        printPreflightWarnings(result.preflightWarnings)
        return
      }
      console.log(`Indexed ${result.manifest.summary.fileCount} file(s) and ${result.manifest.summary.symbolCount} symbol(s).`)
      console.log(`Output: ${result.outputDir}`)
      console.log('Artifacts: manifest.json, symbol-index.json, code-graph.json')
      if (result.callGraphPath) {
        console.log('Call graph: call-graph.json')
      }
      printCacheSummary(result.cache)
      printPreflightWarnings(result.preflightWarnings)
    })
}

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value]
}

function printCacheReset(cacheReset: CacheResetResult | null): void {
  if (!cacheReset) return
  console.log(
    cacheReset.existed
      ? `Cache reset: removed internal cache metadata at ${cacheReset.path}`
      : `Cache reset: no internal cache metadata existed at ${cacheReset.path}`
  )
}

function printCacheSummary(cache: IndexCacheSummary): void {
  if (!cache.requested) return
  console.log(`Cache mode: ${cache.mode}`)
  if (cache.invalidationReason) {
    console.log(`Cache invalidation reason: ${cache.invalidationReason}`)
  }
  if (cache.changedFileSummary) {
    const summary = cache.changedFileSummary
    console.log(
      `Changed files: added=${summary.addedCount} changed=${summary.changedCount} removed=${summary.removedCount} unchanged=${summary.unchangedCount}`
    )
  }
  if (cache.mode === 'incremental-change-detected-full-rebuild') {
    console.log('Incremental note: changes were detected, but partial-rebuild reuse was not safely possible this run; a full rebuild ran instead.')
  }
  if (cache.partialRebuildFallbackArtifacts.length > 0) {
    console.log(`Partial rebuild artifact fallback: ${cache.partialRebuildFallbackArtifacts.join(', ')} regenerated in full (not incrementally reused).`)
  }
}

function printPreflightWarnings(preflightWarnings: PreflightWarning[]): void {
  if (preflightWarnings.length === 0) return
  console.log('Preflight warnings:')
  for (const warning of preflightWarnings) {
    console.log(`- [${warning.code}] ${warning.message}`)
  }
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
