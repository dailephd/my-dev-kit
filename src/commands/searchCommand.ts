import * as fs from 'node:fs'
import type { Command } from 'commander'
import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { FrontendSemanticArtifact } from '../frontend/frontendTypes.js'
import { readIndexManifest, type ResolvedIndexManifest } from '../indexing/readIndexManifest.js'
import { readRequiredJson } from '../indexing/loadIndexArtifacts.js'
import { searchIndex } from '../search/searchIndex.js'
import type { SearchIndexResult } from '../search/searchTypes.js'
import type { SymbolIndex } from '../symbol-index/types.js'
import {
  loadFrontendReachabilityArtifact,
  resolveReachabilityMode,
  buildReachabilitySearchResult,
  type ReachabilitySearchResult,
} from '../frontend-reachability/index.js'
import {
  loadAndroidGraphData,
  resolveAndroidSelectorMode,
  buildAndroidSearchResult,
  type AndroidSearchResult,
  isAndroidRoleSearchValue,
  buildAndroidRoleSearchResult,
  ANDROID_ROLE_SEARCH_VALUES,
} from '../android/index.js'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Search indexed files, symbols, and graph edges.')
    .option('--index <dir>', 'index artifact directory', '.my-dev-kit')
    .option('--query <text>', 'search query')
    .option('--route <path>', 'search frontend-reachability route facts')
    .option('--storage-key <key>', 'search frontend-reachability browser-storage key facts')
    .option('--ui <value>', 'search frontend-reachability UI marker facts')
    .option('--android-route <route>', 'search Android navigation/Compose route evidence (exact match)')
    .option('--permission <name>', 'search Android permission declarations and references (exact match)')
    .option('--resource <name>', 'search Android resource definitions (canonical "type/name", "@type/name", or bare name)')
    .option('--android-component <name>', 'search Android manifest components (exact FQCN, raw manifest name, or simple name)')
    .option('--composable <name>', 'search Compose composables (exact name or stable declaration id)')
    .option('--test-tag <tag>', 'search Compose resolved Modifier.testTag values (exact match)')
    .option('--android-ui <value>', 'search Compose resolved visible-text/string-resource evidence (exact match)')
    .option(
      '--android-role <role>',
      `search for an exact Android classification role (exact match; one of: ${ANDROID_ROLE_SEARCH_VALUES.join(', ')})`
    )
    .option('--limit <n>', `result limit, 1 through ${MAX_LIMIT}`, parseLimit, DEFAULT_LIMIT)
    .option('--json', 'print JSON output')
    .action((options: SearchCommandOptions) => {
      const otherSelectorFlags = [
        options.route,
        options.storageKey,
        options.ui,
        options.androidRoute,
        options.permission,
        options.resource,
        options.androidComponent,
        options.composable,
        options.testTag,
        options.androidUi,
      ]
      if (options.androidRole !== undefined) {
        if (options.query !== undefined || otherSelectorFlags.some((v) => v !== undefined)) {
          throw new Error(
            '--android-role is mutually exclusive with --query and every other search selector (--route, --storage-key, --ui, --android-route, --permission, --resource, --android-component, --composable, --test-tag, --android-ui).'
          )
        }
        if (!isAndroidRoleSearchValue(options.androidRole)) {
          throw new Error(
            `Invalid --android-role value "${options.androidRole}". Allowed values: ${ANDROID_ROLE_SEARCH_VALUES.join(', ')}.`
          )
        }
        const resolved = readIndexManifest(options.index)
        const result = buildAndroidRoleSearchResult({
          resolved,
          codeGraph: readRequiredJson<CodeGraph>(resolved.artifactPaths.codeGraph, 'code graph'),
          role: options.androidRole,
          limit: options.limit,
        })
        if (options.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }
        printTextResult(result)
        return
      }

      const reachabilityMode = resolveReachabilityMode(options)
      if (reachabilityMode) {
        if (options.query !== undefined) {
          throw new Error(
            'The reachability flags (--route, --storage-key, --ui) cannot be combined with --query.'
          )
        }
        const artifact = loadFrontendReachabilityArtifact(options.index)
        const result = buildReachabilitySearchResult(artifact, reachabilityMode.mode, reachabilityMode.query)
        if (options.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }
        printReachabilitySearchResult(result)
        return
      }

      const androidMode = resolveAndroidSelectorMode(options)
      if (androidMode) {
        if (options.query !== undefined) {
          throw new Error(
            'The Android selector flags (--android-route, --permission, --resource, --android-component, --composable, --test-tag, --android-ui) cannot be combined with --query.'
          )
        }
        const graphData = loadAndroidGraphData(options.index)
        const result = buildAndroidSearchResult(graphData, androidMode.mode, androidMode.query)
        if (options.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }
        printAndroidSearchResult(result)
        return
      }

      if (!options.query) {
        throw new Error(
          'The search command requires --query <text> (or --route, --storage-key, --ui, --android-route, --permission, --resource, --android-component, --composable, --test-tag, or --android-ui).'
        )
      }
      const resolved = readIndexManifest(options.index)
      const result = searchIndex({
        resolved,
        symbolIndex: readRequiredJson<SymbolIndex>(resolved.artifactPaths.symbolIndex, 'symbol index'),
        codeGraph: readRequiredJson<CodeGraph>(resolved.artifactPaths.codeGraph, 'code graph'),
        frontendArtifact: loadOptionalFrontendArtifact(resolved),
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
  route?: string
  storageKey?: string
  ui?: string
  androidRoute?: string
  permission?: string
  resource?: string
  androidComponent?: string
  composable?: string
  testTag?: string
  androidUi?: string
  androidRole?: string
  limit: number
  json?: boolean
}

function printReachabilitySearchResult(result: ReachabilitySearchResult): void {
  console.log(`Reachability search (${result.mode}): ${result.query}`)
  if (result.status === 'missing-artifact') {
    console.log(`Status: missing-artifact`)
    for (const warning of result.warnings) console.log(`Warning: ${warning}`)
    return
  }
  console.log(`Results: ${result.summary.resultCount}, related edges: ${result.summary.edgeCount}`)
  for (const [index, item] of result.results.entries()) {
    console.log(`${index + 1}. [${item.factKind}] ${item.label} (${item.confidence}) - ${item.id}`)
  }
}

function printAndroidSearchResult(result: AndroidSearchResult): void {
  console.log(`Android search (${result.mode}): ${result.query}`)
  console.log(`Results: ${result.summary.resultCount}`)
  for (const [index, item] of result.results.entries()) {
    console.log(`${index + 1}. [${item.kind}] ${item.matchKind}: ${item.label} - ${item.graphNodeId}`)
    if (item.path) console.log(`   ${item.path}${item.line ? `:${item.line}` : ''}`)
  }
}

function parseLimit(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`Expected --limit to be an integer, got "${value}".`)
  if (parsed < 1) throw new Error('--limit must be a positive integer.')
  if (parsed > MAX_LIMIT) throw new Error(`--limit must be ${MAX_LIMIT} or less.`)
  return parsed
}

function loadOptionalFrontendArtifact(resolved: ResolvedIndexManifest): FrontendSemanticArtifact | null {
  const artifactPath = resolved.semanticArtifactPaths.frontendSemantic
  if (!artifactPath) return null
  try {
    if (!fs.existsSync(artifactPath)) return null
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as FrontendSemanticArtifact
  } catch {
    return null
  }
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
