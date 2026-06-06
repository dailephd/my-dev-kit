import type { Command } from 'commander'
import type { CodeGraph } from '../graph/codeGraphTypes.js'
import { readIndexManifest } from '../indexing/readIndexManifest.js'
import { readRequiredJson } from '../indexing/loadIndexArtifacts.js'
import { searchIndex } from '../search/searchIndex.js'
import type { SearchIndexResult } from '../search/searchTypes.js'
import type { SymbolIndex } from '../symbol-index/types.js'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Search indexed files, symbols, and graph edges.')
    .option('--index <dir>', 'index artifact directory', '.my-dev-kit')
    .option('--query <text>', 'search query')
    .option('--limit <n>', `result limit, 1 through ${MAX_LIMIT}`, parseLimit, DEFAULT_LIMIT)
    .option('--json', 'print JSON output')
    .action((options: SearchCommandOptions) => {
      if (!options.query) throw new Error('The search command requires --query <text>.')
      const resolved = readIndexManifest(options.index)
      const result = searchIndex({
        resolved,
        symbolIndex: readRequiredJson<SymbolIndex>(resolved.artifactPaths.symbolIndex, 'symbol index'),
        codeGraph: readRequiredJson<CodeGraph>(resolved.artifactPaths.codeGraph, 'code graph'),
        query: options.query,
        limit: options.limit,
      })

      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      printTextResult(result)
    })
}

interface SearchCommandOptions {
  index: string
  query?: string
  limit: number
  json?: boolean
}

function parseLimit(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`Expected --limit to be an integer, got "${value}".`)
  if (parsed < 1) throw new Error('--limit must be a positive integer.')
  if (parsed > MAX_LIMIT) throw new Error(`--limit must be ${MAX_LIMIT} or less.`)
  return parsed
}

function printTextResult(result: SearchIndexResult): void {
  console.log(`Search query: ${result.query}`)
  console.log(`Index dir: ${result.indexDir}`)
  console.log(`Results: ${result.results.length}`)

  for (const [index, item] of result.results.entries()) {
    const target = item.path ? `${item.id} (${item.path})` : item.id
    console.log(`${index + 1}. [${item.kind}] score ${item.score}: ${item.label} - ${target}`)
    const reasons = item.matchReasons
      .slice(0, 3)
      .map((reason) => `${reason.field}:${reason.term}`)
      .join(', ')
    if (reasons) console.log(`   matches: ${reasons}`)
  }
}
