/**
 * Symbol-index builder.
 *
 * Scans one or more source root directories for TypeScript, JavaScript, and Python files,
 * extracts symbols and imports from each file, and returns a complete SymbolIndex.
 *
 * The builder is reusable across projects: no project-specific logic is
 * embedded here. Configure it via BuildConfig.
 *
 * Call-graph construction is delegated to graphBuilder.ts and is optional.
 */

import * as fs from 'fs'
import type { ExtractionResult } from './symbolExtractor.js'
import { createCallGraph } from './graphBuilder.js'
import { createDefaultRegistry } from '../languages/registry.js'
import type { LanguageAdapter, SourceFileInput } from '../languages/types.js'
import {
  discoverSourceFiles,
  type SourceDiscoveryProgressEvent,
  type SourceDiscoveryResult,
} from '../indexing/discoverSourceFiles.js'
import {
  type FileSummary,
  type SymbolIndex,
  type CallGraph,
  type CallGraphEdge,
  SCHEMA_VERSION,
  type SymbolIndexGraph,
  type FileDependencyEdge,
  type GraphSymbolRecord,
} from './types.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Configuration for a symbol-index build. */
export interface BuildConfig {
  /**
   * Absolute path of the repository root.
   * All relative paths in the output are computed relative to this.
   */
  repoRoot: string
  /**
   * Source root directories to scan, relative to `repoRoot`.
   * Supported files under these roots are indexed after shared source discovery
   * applies default ignores and configured excludes.
   */
  sourceRoots: string[]
  /**
   * Additional directory names or relative path prefixes to exclude.
   * These are applied alongside default generated/dependency/cache directories.
   */
  excludePatterns?: string[]
  /**
   * When true, also build a call-graph.
   * Default: false.
   */
  buildCallGraph?: boolean
  onProgress?: (event: BuildIndexProgressEvent) => void
}

/** Per-file extraction metadata not carried in the compact `FileSummary` shape. */
export interface FileExtractionMeta {
  reExportSpecifiers: string[]
  exportAllSpecifiers: string[]
}

/** The products of a build run. */
export interface BuildResult {
  index: SymbolIndex
  callGraph: CallGraph | null
  discovery: SourceDiscoveryResult
  /**
   * Per-file extraction metadata (module specifiers not present in `FileSummary`),
   * keyed by relative path. Used by incremental partial-rebuild reuse (Batch 3) to
   * reconstruct a full `ExtractionResult` for an unchanged file without re-parsing it.
   */
  fileExtractionMeta: Map<string, FileExtractionMeta>
}

export type BuildIndexProgressEvent =
  | SourceDiscoveryProgressEvent
  | {
      phase:
        | 'index-start'
        | 'index-progress'
        | 'index-complete'
        | 'call-graph-start'
        | 'call-graph-complete'
      message: string
      elapsedMs: number
      filesIndexed: number
      totalFiles: number
    }

/**
 * Builds the symbol-index (and optionally the call graph) for the given config.
 *
 * Returns a BuildResult containing the main index and, if enabled, the call
 * graph. Neither artifact is written to disk by this function — use writer.ts
 * for that.
 */
export function buildIndex(config: BuildConfig): BuildResult {
  const startTime = Date.now()
  const buildTime = new Date().toISOString()
  const registry = createDefaultRegistry()

  const discovery = discoverSourceFiles({
    repoRoot: config.repoRoot,
    sourceRoots: config.sourceRoots,
    userExcludes: config.excludePatterns,
    registry,
    onProgress: config.onProgress,
  })
  const sourceFiles = discovery.files

  // Build set of all file paths for call-graph edge resolution
  const callGraphInputsByAdapter = new Map<LanguageAdapter, SourceFileInput[]>()
  const summaries: FileSummary[] = []
  const rawExtractions: Array<{ relPath: string; extraction: ExtractionResult }> = []
  const fileExtractionMeta = new Map<string, FileExtractionMeta>()

  emitBuildProgress(config, 'index-start', 'Indexing started', startTime, 0, sourceFiles.length)
  let filesIndexed = 0
  let lastProgressTime = 0
  for (const { relPath, absPath } of sourceFiles) {
    let sourceText: string
    try {
      sourceText = fs.readFileSync(absPath, 'utf-8')
    } catch {
      continue // Skip unreadable files silently
    }

    const adapter = registry.adapterForFile(relPath)!
    const result = adapter.extractFromSource(relPath, sourceText)
    rawExtractions.push({ relPath, extraction: result })
    fileExtractionMeta.set(relPath, {
      reExportSpecifiers: result.reExportSpecifiers,
      exportAllSpecifiers: result.exportAllSpecifiers,
    })
    summaries.push({
      path: relPath,
      language: result.language,
      lineCount: result.lineCount,
      imports: result.imports,
      exports: result.exports,
      symbols: result.symbols,
      hasCallGraphEntries: false, // updated below if call graph is built
    })

    if (config.buildCallGraph && adapter.supportsCallGraph && adapter.extractCallGraphEdges) {
      const inputs = callGraphInputsByAdapter.get(adapter) ?? []
      inputs.push({ filePath: relPath, sourceText })
      callGraphInputsByAdapter.set(adapter, inputs)
    }
    filesIndexed += 1
    const now = Date.now()
    if (now - lastProgressTime >= 1000) {
      lastProgressTime = now
      emitBuildProgress(config, 'index-progress', 'Indexing source files', startTime, filesIndexed, sourceFiles.length)
    }
  }
  emitBuildProgress(config, 'index-complete', 'Indexing completed', startTime, filesIndexed, sourceFiles.length)

  // Build call graph if requested
  let callGraph: CallGraph | null = null
  if (config.buildCallGraph && callGraphInputsByAdapter.size > 0) {
    emitBuildProgress(config, 'call-graph-start', 'Call graph building started', startTime, filesIndexed, sourceFiles.length)
    const edges: CallGraphEdge[] = []
    for (const [adapter, inputs] of callGraphInputsByAdapter) {
      edges.push(...adapter.extractCallGraphEdges!(inputs))
    }
    callGraph = createCallGraph(edges)

    // Mark files that have call-graph entries
    const filesWithEdges = new Set<string>()
    for (const edge of callGraph.edges) {
      filesWithEdges.add(edge.caller.file)
      if (edge.callee.file) filesWithEdges.add(edge.callee.file)
    }
    for (const summary of summaries) {
      if (filesWithEdges.has(summary.path)) {
        summary.hasCallGraphEntries = true
      }
    }
    emitBuildProgress(config, 'call-graph-complete', 'Call graph building completed', startTime, filesIndexed, sourceFiles.length)
  }

  // Build richer graph section
  const indexedFileSet = new Set(summaries.map((s) => s.path))
  const graph = buildGraphSection(rawExtractions, indexedFileSet, registry)

  const symbolCount = summaries.reduce((n, f) => n + f.symbols.length, 0)

  const index: SymbolIndex = {
    schemaVersion: SCHEMA_VERSION,
    buildTime,
    repoRoot: config.repoRoot,
    sourceRoots: config.sourceRoots,
    fileCount: summaries.length,
    symbolCount,
    files: summaries,
    graph,
    // callGraphArtifact set by writer after writing the artifact
  }

  return { index, callGraph, discovery, fileExtractionMeta }
}

// ---------------------------------------------------------------------------
// Graph section construction
// ---------------------------------------------------------------------------

/**
 * Builds the SymbolIndexGraph from the raw per-file extractions.
 *
 * - fileDeps: resolved internal file-to-file dependency edges, sorted from→to
 * - symbols:  flat compact symbol records across all files, sorted file→name
 *
 * Exported for reuse by incremental partial-rebuild merging (Batch 3), which
 * must recompute this section globally from a merged set of reused and fresh
 * per-file extractions rather than a purely fresh set.
 */
export function buildGraphSection(
  rawExtractions: Array<{ relPath: string; extraction: ExtractionResult }>,
  indexedFileSet: Set<string>,
  registry: ReturnType<typeof createDefaultRegistry>
): SymbolIndexGraph {
  const fileDeps: FileDependencyEdge[] = []
  const symbols: GraphSymbolRecord[] = []
  const knownFiles = [...indexedFileSet]

  for (const { relPath, extraction } of rawExtractions) {
    const adapter = registry.adapterForFile(relPath)!

    for (const specifier of extraction.imports) {
      const to = adapter.resolveImportToFile(specifier, relPath, knownFiles)
      if (to && to !== relPath) fileDeps.push({ from: relPath, to, kind: 'import' })
    }

    for (const specifier of extraction.reExportSpecifiers) {
      const to = adapter.resolveImportToFile(specifier, relPath, knownFiles)
      if (to && to !== relPath) fileDeps.push({ from: relPath, to, kind: 're-export' })
    }

    for (const specifier of extraction.exportAllSpecifiers) {
      const to = adapter.resolveImportToFile(specifier, relPath, knownFiles)
      if (to && to !== relPath) fileDeps.push({ from: relPath, to, kind: 'export-all' })
    }

    for (const sym of extraction.symbols) {
      symbols.push({
        file: relPath,
        name: sym.name,
        kind: sym.kind,
        exported: sym.exported,
        line: sym.location.line,
      })
    }
  }

  // Deduplicate edges
  const seen = new Set<string>()
  const uniqueDeps = fileDeps.filter((e) => {
    const key = `${e.from}\0${e.to}\0${e.kind}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Sort deterministically
  uniqueDeps.sort((a, b) =>
    a.from < b.from ? -1 : a.from > b.from ? 1 :
    a.to < b.to ? -1 : a.to > b.to ? 1 : 0
  )
  symbols.sort((a, b) =>
    a.file < b.file ? -1 : a.file > b.file ? 1 :
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  )

  return { fileDeps: uniqueDeps, symbols }
}

function emitBuildProgress(
  config: BuildConfig,
  phase: Extract<BuildIndexProgressEvent, { filesIndexed: number }>['phase'],
  message: string,
  startTime: number,
  filesIndexed: number,
  totalFiles: number
): void {
  config.onProgress?.({
    phase,
    message,
    elapsedMs: Date.now() - startTime,
    filesIndexed,
    totalFiles,
  })
}
