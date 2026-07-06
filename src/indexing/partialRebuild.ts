/**
 * Incremental partial rebuild (Batch 3).
 *
 * When `index --incremental` detects added/changed/removed files against a
 * compatible cache, this module reuses unchanged files' per-file analysis
 * (read back from the previous run's `symbol-index.json`, combined with the
 * `reExportSpecifiers`/`exportAllSpecifiers` carried in `cache-metadata.json`)
 * instead of re-parsing them, re-analyzes changed/added files exactly as a
 * full build would, and then rebuilds `graph.fileDeps`/`graph.symbols` (and,
 * if requested, the call graph) globally from the merged per-file data via
 * the same `buildGraphSection()` used by a full build — because import
 * resolution and call-graph edges depend on the *complete* current file set,
 * not just the files that changed (see docs/COMMANDS.md "Incremental
 * indexing").
 *
 * Call-graph extraction re-parses source text itself (it is not derived from
 * the cached per-file analysis), so whenever `--call-graph` is requested
 * during a partial rebuild it is always fully regenerated from every current
 * file's source text and reported as an artifact fallback rather than a
 * silent partial reuse.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createCallGraph } from '../symbol-index/graphBuilder.js'
import { buildGraphSection, type FileExtractionMeta } from '../symbol-index/builder.js'
import { createDefaultRegistry, type LanguageRegistry } from '../languages/registry.js'
import type { LanguageAdapter, SourceFileInput } from '../languages/types.js'
import type { ExtractionResult } from '../symbol-index/symbolExtractor.js'
import {
  SCHEMA_VERSION,
  type CallGraph,
  type CallGraphEdge,
  type FileSummary,
  type SymbolDefinition,
  type SymbolIndex,
} from '../symbol-index/types.js'
import type { SourceDiscoveryResult } from './discoverSourceFiles.js'
import type { CacheFileEntry } from './cacheMetadata.js'
import { toForwardSlash } from '../io/pathUtils.js'

export interface PartialRebuildEligibility {
  eligible: boolean
  reason: string | null
  previousFileSummariesByPath: Map<string, FileSummary>
}

/**
 * Checks whether unchanged files' previous analysis can be safely reused:
 * the previous `symbol-index.json` must exist, parse, match the current
 * schema version, and contain a `FileSummary` for every path the caller
 * intends to reuse. Any failure here means "fall back to a full rebuild",
 * never a partial-of-partial attempt.
 */
export function checkPartialRebuildEligibility(outputDir: string, unchangedPaths: readonly string[]): PartialRebuildEligibility {
  const symbolIndexPath = path.join(outputDir, 'symbol-index.json')
  if (!fs.existsSync(symbolIndexPath)) {
    return { eligible: false, reason: 'Previous symbol-index.json is missing.', previousFileSummariesByPath: new Map() }
  }

  let previousIndex: SymbolIndex
  try {
    previousIndex = JSON.parse(fs.readFileSync(symbolIndexPath, 'utf8')) as SymbolIndex
  } catch {
    return { eligible: false, reason: 'Previous symbol-index.json is not valid JSON.', previousFileSummariesByPath: new Map() }
  }

  if (previousIndex.schemaVersion !== SCHEMA_VERSION) {
    return {
      eligible: false,
      reason: `Previous symbol-index.json schema version "${previousIndex.schemaVersion}" does not match the current schema version "${SCHEMA_VERSION}".`,
      previousFileSummariesByPath: new Map(),
    }
  }

  const previousFileSummariesByPath = new Map(previousIndex.files.map((file) => [file.path, file]))
  for (const unchangedPath of unchangedPaths) {
    if (!previousFileSummariesByPath.has(unchangedPath)) {
      return {
        eligible: false,
        reason: `Previous symbol-index.json has no entry for unchanged file "${unchangedPath}".`,
        previousFileSummariesByPath: new Map(),
      }
    }
  }

  return { eligible: true, reason: null, previousFileSummariesByPath }
}

export interface BuildPartialSymbolIndexInput {
  repoRoot: string
  sourceRoots: string[]
  buildCallGraph: boolean
  registry?: LanguageRegistry
  /** All currently discovered files (unchanged + changed + added; removed files must not be present). */
  discoveryFiles: SourceDiscoveryResult['files']
  unchangedPaths: ReadonlySet<string>
  previousFileSummariesByPath: ReadonlyMap<string, FileSummary>
  previousCacheEntriesByPath: ReadonlyMap<string, CacheFileEntry>
}

export interface BuildPartialSymbolIndexResult {
  index: SymbolIndex
  callGraph: CallGraph | null
  /** True whenever `--call-graph` was requested — call-graph is always fully regenerated, never partially reused. */
  callGraphFallback: boolean
  fileExtractionMeta: Map<string, FileExtractionMeta>
}

/** Strips semantic/classification stamping fields so reused symbols start from a clean slate, exactly like a fresh extraction. */
function cleanSymbol(symbol: SymbolDefinition): SymbolDefinition {
  const clean: SymbolDefinition = {
    name: symbol.name,
    kind: symbol.kind,
    location: symbol.location,
    exported: symbol.exported,
  }
  if (symbol.signature !== undefined) clean.signature = symbol.signature
  return clean
}

/**
 * Builds a merged `SymbolIndex` (and, if requested, call graph) from reused
 * unchanged-file analysis plus fresh analysis of changed/added files. Removed
 * files are simply absent from `discoveryFiles` and therefore never included.
 */
export function buildPartialSymbolIndex(input: BuildPartialSymbolIndexInput): BuildPartialSymbolIndexResult {
  const registry = input.registry ?? createDefaultRegistry()
  const summaries: FileSummary[] = []
  const rawExtractions: Array<{ relPath: string; extraction: ExtractionResult }> = []
  const fileExtractionMeta = new Map<string, FileExtractionMeta>()
  const callGraphInputsByAdapter = new Map<LanguageAdapter, SourceFileInput[]>()

  for (const file of input.discoveryFiles) {
    const relPath = toForwardSlash(file.relPath)
    const adapter = registry.adapterForFile(relPath)
    if (!adapter) continue

    if (input.unchangedPaths.has(relPath)) {
      const previousSummary = input.previousFileSummariesByPath.get(relPath)
      if (!previousSummary) continue // eligibility check already guards this; defensive only
      const previousCacheEntry = input.previousCacheEntriesByPath.get(relPath)
      const reExportSpecifiers = previousCacheEntry?.reExportSpecifiers ?? []
      const exportAllSpecifiers = previousCacheEntry?.exportAllSpecifiers ?? []
      const cleanSymbols = previousSummary.symbols.map(cleanSymbol)

      summaries.push({
        path: relPath,
        language: previousSummary.language,
        lineCount: previousSummary.lineCount,
        imports: previousSummary.imports,
        exports: previousSummary.exports,
        symbols: cleanSymbols,
        hasCallGraphEntries: false,
      })
      rawExtractions.push({
        relPath,
        extraction: {
          language: previousSummary.language,
          lineCount: previousSummary.lineCount,
          imports: previousSummary.imports,
          exports: previousSummary.exports,
          symbols: cleanSymbols,
          reExportSpecifiers,
          exportAllSpecifiers,
        },
      })
      fileExtractionMeta.set(relPath, { reExportSpecifiers, exportAllSpecifiers })

      if (input.buildCallGraph && adapter.supportsCallGraph && adapter.extractCallGraphEdges) {
        const sourceText = readFileSafely(file.absPath)
        if (sourceText !== null) {
          const inputs = callGraphInputsByAdapter.get(adapter) ?? []
          inputs.push({ filePath: relPath, sourceText })
          callGraphInputsByAdapter.set(adapter, inputs)
        }
      }
      continue
    }

    // Changed or added file: analyze it exactly like a full build would.
    const sourceText = readFileSafely(file.absPath)
    if (sourceText === null) continue
    const extraction = adapter.extractFromSource(relPath, sourceText)
    rawExtractions.push({ relPath, extraction })
    fileExtractionMeta.set(relPath, {
      reExportSpecifiers: extraction.reExportSpecifiers,
      exportAllSpecifiers: extraction.exportAllSpecifiers,
    })
    summaries.push({
      path: relPath,
      language: extraction.language,
      lineCount: extraction.lineCount,
      imports: extraction.imports,
      exports: extraction.exports,
      symbols: extraction.symbols,
      hasCallGraphEntries: false,
    })

    if (input.buildCallGraph && adapter.supportsCallGraph && adapter.extractCallGraphEdges) {
      const inputs = callGraphInputsByAdapter.get(adapter) ?? []
      inputs.push({ filePath: relPath, sourceText })
      callGraphInputsByAdapter.set(adapter, inputs)
    }
  }

  summaries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  rawExtractions.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))

  let callGraph: CallGraph | null = null
  if (input.buildCallGraph && callGraphInputsByAdapter.size > 0) {
    const edges: CallGraphEdge[] = []
    for (const [adapter, inputs] of callGraphInputsByAdapter) {
      edges.push(...adapter.extractCallGraphEdges!(inputs))
    }
    callGraph = createCallGraph(edges)

    const filesWithEdges = new Set<string>()
    for (const edge of callGraph.edges) {
      filesWithEdges.add(edge.caller.file)
      if (edge.callee.file) filesWithEdges.add(edge.callee.file)
    }
    for (const summary of summaries) {
      if (filesWithEdges.has(summary.path)) summary.hasCallGraphEntries = true
    }
  }

  const indexedFileSet = new Set(summaries.map((summary) => summary.path))
  const graph = buildGraphSection(rawExtractions, indexedFileSet, registry)
  const symbolCount = summaries.reduce((sum, file) => sum + file.symbols.length, 0)

  const index: SymbolIndex = {
    schemaVersion: SCHEMA_VERSION,
    buildTime: new Date().toISOString(),
    repoRoot: input.repoRoot,
    sourceRoots: input.sourceRoots,
    fileCount: summaries.length,
    symbolCount,
    files: summaries,
    graph,
  }

  return {
    index,
    callGraph,
    callGraphFallback: input.buildCallGraph === true,
    fileExtractionMeta,
  }
}

function readFileSafely(absPath: string): string | null {
  try {
    return fs.readFileSync(absPath, 'utf-8')
  } catch {
    return null
  }
}
