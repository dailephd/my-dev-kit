import * as fs from 'node:fs'
import * as path from 'node:path'
import { buildCodeGraph } from '../graph/buildCodeGraph.js'
import { addFrontendRelationshipsToCodeGraph } from '../graph/addFrontendRelationshipsToCodeGraph.js'
import { toForwardSlash } from '../io/pathUtils.js'
import { buildIndex, type BuildIndexProgressEvent, type FileExtractionMeta } from '../symbol-index/builder.js'
import type { CallGraph, SymbolIndex } from '../symbol-index/types.js'
import { buildIndexManifest } from './buildIndexManifest.js'
import {
  DEFAULT_IGNORED_DIRECTORY_NAMES,
  DEFAULT_IGNORED_DIRECTORY_PREFIXES,
  discoverSourceFiles,
  type SourceDiscoveryProgressEvent,
  type SourceDiscoveryResult,
} from './discoverSourceFiles.js'
import { writeIndexArtifacts } from './writeIndexManifest.js'
import { computePreflightWarnings, type PreflightWarning } from './preflight.js'
import {
  buildCacheFileEntries,
  buildCacheMetadata,
  cacheMetadataPathFor,
  checkCacheCompatibility,
  classifyChangedFilePaths,
  classifyChangedFiles,
  computeConfigFingerprint,
  mergeCacheFileEntryMeta,
  readCacheMetadata,
  resetCacheMetadata,
  writeCacheMetadata,
  type CacheFileEntry,
  type CacheMode,
  type CacheResetResult,
  type ChangedFileSummary,
} from './cacheMetadata.js'
import { checkPartialRebuildEligibility, buildPartialSymbolIndex } from './partialRebuild.js'
import type { IndexManifest } from './manifestTypes.js'
import { refreshIndexOutput, type RefreshIndexOutputResult } from './refreshIndexOutput.js'
import { replaceAnalyzerStatuses, runSemanticAnalyzers } from './runSemanticAnalyzers.js'
import {
  applySemanticRolesToCodeGraph,
  applySemanticRolesToSymbolIndex,
  buildSemanticRolesFromDataModel,
} from '../semantics/index.js'
import {
  applyClassificationToCodeGraph,
  applyClassificationToSymbolIndex,
  buildClassificationArtifact,
  buildClassificationRefsBySymbolId,
  CLASSIFICATION_SCHEMA_VERSION,
  type ClassificationArtifact,
  type CompactClassificationMetadata,
} from '../classification/index.js'
import { CLASSIFICATION_FILENAME } from './managedArtifacts.js'
import type { IndexAnalyzerStatus } from './manifestTypes.js'

export interface RunIndexCommandOptions {
  root?: string
  src?: string[]
  language?: string
  out?: string
  callGraph?: boolean
  json?: boolean
  exclude?: string[]
  dryRun?: boolean
  progress?: boolean
  incremental?: boolean
  resetCache?: boolean
}

export type RunIndexCommandResult = RunIndexCommandIndexResult | RunIndexCommandDryRunResult

export interface IndexCacheSummary {
  requested: boolean
  mode: CacheMode
  cacheMetadataPath: string
  invalidationReason: string | null
  changedFileSummary: ChangedFileSummary | null
  /** Artifact families fully regenerated rather than reused during a partial rebuild (e.g. `["call-graph"]`). Always `[]` outside the two `incremental-partial*` modes. */
  partialRebuildFallbackArtifacts: string[]
}

export interface RunIndexCommandIndexResult {
  mode: 'index'
  manifest: IndexManifest
  outputDir: string
  symbolIndexPath: string
  codeGraphPath: string
  callGraphPath: string | null
  semanticArtifacts: {
    dataModelPath: string | null
    dataModelGraphPath: string | null
    modelViewLineagePath: string | null
    frontendSemanticPath: string | null
    frontendReachabilityPath: string | null
  }
  analyzers: IndexManifest['analyzers']
  managedArtifacts: {
    removed: string[]
  }
  preflightWarnings: PreflightWarning[]
  cache: IndexCacheSummary
  cacheReset: CacheResetResult | null
}

export interface RunIndexCommandDryRunResult {
  mode: 'dry-run'
  projectRoot: string
  sourceRoots: string[]
  outputDir: string
  defaultIgnoredDirectoryNames: string[]
  userExcludes: string[]
  totalFilesDiscovered: number
  totalFilesEligibleForIndexing: number
  totalFilesSkipped: number
  skippedByDefaultIgnore: number
  skippedByUserExclude: number
  skippedByFilePattern: number
  skippedUnsupportedFiles: number
  languageCounts: Record<string, number>
  largestFiles: Array<{ path: string; sizeBytes: number }>
  sampleIndexedFiles: string[]
  sampleSkippedFiles: SourceDiscoveryResult['sampleSkippedFiles']
  preflightWarnings: PreflightWarning[]
  cacheReset: CacheResetResult | null
}

const SUPPORTED_LANGUAGES = new Set(['typescript', 'javascript', 'python'])

export async function runIndexCommand(
  options: RunIndexCommandOptions & { dryRun: true }
): Promise<RunIndexCommandDryRunResult>
export async function runIndexCommand(
  options: RunIndexCommandOptions & { dryRun?: false | undefined }
): Promise<RunIndexCommandIndexResult>
export async function runIndexCommand(options: RunIndexCommandOptions): Promise<RunIndexCommandResult>
export async function runIndexCommand(options: RunIndexCommandOptions): Promise<RunIndexCommandResult> {
  const commandStartTime = Date.now()
  const projectRoot = path.resolve(options.root ?? '.')
  const sourceRoots = options.src ?? []

  if (sourceRoots.length === 0) {
    throw new Error('The index command requires at least one --src <path> source root.')
  }

  if (options.language && !SUPPORTED_LANGUAGES.has(options.language)) {
    throw new Error(`Unsupported language "${options.language}". Supported values: typescript, javascript, python.`)
  }

  const normalizedSourceRoots = sourceRoots.map((sourceRoot) => toForwardSlash(sourceRoot))
  for (const sourceRoot of normalizedSourceRoots) {
    const absoluteSourceRoot = path.resolve(projectRoot, sourceRoot)
    if (!fs.existsSync(absoluteSourceRoot) || !fs.statSync(absoluteSourceRoot).isDirectory()) {
      throw new Error(`Source root does not exist or is not a directory: ${sourceRoot}`)
    }
  }

  const outputDir = path.resolve(projectRoot, options.out ?? '.my-dev-kit')
  const progress = createProgressReporter(options.progress === true, commandStartTime)

  // --reset-cache is a side-effecting flag applied before whatever mode is
  // selected below (dry-run, plain full index, or --incremental). It never
  // touches normal index artifacts, only the internal cache-metadata.json.
  const cacheReset: CacheResetResult | null = options.resetCache ? resetCacheMetadata(outputDir) : null

  if (options.dryRun) {
    const discovery = discoverSourceFiles({
      repoRoot: projectRoot,
      sourceRoots: normalizedSourceRoots,
      userExcludes: options.exclude,
      onProgress: progress,
    })
    return { ...buildDryRunResult(projectRoot, normalizedSourceRoots, outputDir, discovery), cacheReset }
  }

  const cacheMetadataPath = toForwardSlash(cacheMetadataPathFor(outputDir))

  if (options.incremental !== true) {
    const built = runFullIndexBuild({
      projectRoot,
      normalizedSourceRoots,
      options,
      outputDir,
      progress,
      commandStartTime,
      indexMode: 'full',
      cacheMode: undefined,
      cacheInvalidationReason: undefined,
      changedFileSummary: undefined,
      partialRebuildFallbackArtifacts: undefined,
    })
    return {
      ...built.result,
      cache: {
        requested: false,
        mode: 'full',
        cacheMetadataPath,
        invalidationReason: null,
        changedFileSummary: null,
        partialRebuildFallbackArtifacts: [],
      },
      cacheReset,
    }
  }

  return runIncrementalIndex({
    projectRoot,
    normalizedSourceRoots,
    options,
    outputDir,
    progress,
    commandStartTime,
    cacheReset,
    cacheMetadataPath,
  })
}

// ---------------------------------------------------------------------------
// Incremental orchestration
// ---------------------------------------------------------------------------

interface RunIncrementalIndexParams {
  projectRoot: string
  normalizedSourceRoots: string[]
  options: RunIndexCommandOptions
  outputDir: string
  progress: ((event: ProgressEvent) => void) | undefined
  commandStartTime: number
  cacheReset: CacheResetResult | null
  cacheMetadataPath: string
}

function runIncrementalIndex(params: RunIncrementalIndexParams): RunIndexCommandIndexResult {
  const { projectRoot, normalizedSourceRoots, options, outputDir, progress, commandStartTime, cacheReset, cacheMetadataPath } = params

  const configFingerprint = computeConfigFingerprint({
    sourceRoots: normalizedSourceRoots,
    excludePatterns: options.exclude ?? [],
    callGraphEnabled: options.callGraph === true,
    language: options.language ?? null,
    defaultIgnoredDirectoryNames: [...DEFAULT_IGNORED_DIRECTORY_NAMES],
    defaultIgnoredDirectoryPrefixes: [...DEFAULT_IGNORED_DIRECTORY_PREFIXES],
  })

  const cacheRead = readCacheMetadata(outputDir)

  const fullRebuild = (cacheMode: CacheMode, invalidationReason: string | null): RunIndexCommandIndexResult => {
    const built = runFullIndexBuild({
      projectRoot,
      normalizedSourceRoots,
      options,
      outputDir,
      progress,
      commandStartTime,
      indexMode: 'incremental',
      cacheMode,
      cacheInvalidationReason: invalidationReason,
      changedFileSummary: null,
      partialRebuildFallbackArtifacts: [],
    })
    writeMergedCacheMetadata({
      outputDir,
      projectRoot,
      normalizedSourceRoots,
      configFingerprint,
      baseFiles: buildCacheFileEntries(built.discoveryFiles),
      fileExtractionMeta: built.fileExtractionMeta,
    })
    return {
      ...built.result,
      cache: {
        requested: true,
        mode: cacheMode,
        cacheMetadataPath,
        invalidationReason,
        changedFileSummary: null,
        partialRebuildFallbackArtifacts: [],
      },
      cacheReset,
    }
  }

  if (cacheRead.status === 'missing') {
    return fullRebuild('incremental-full-initial', null)
  }

  if (cacheRead.status === 'invalid') {
    return fullRebuild('incremental-full-cache-incompatible', cacheRead.reason)
  }

  const compatibility = checkCacheCompatibility(cacheRead.metadata)
  if (!compatibility.compatible) {
    return fullRebuild('incremental-full-cache-incompatible', compatibility.reason ?? 'Cache metadata is incompatible.')
  }

  if (cacheRead.metadata.configFingerprint !== configFingerprint) {
    return fullRebuild(
      'incremental-full-config-changed',
      'Index configuration changed (source roots, --exclude values, --call-graph, --language, or default ignore rules).'
    )
  }

  // Cache is schema/version-compatible and configuration is unchanged: do a
  // lightweight discovery + content-hash pass to classify changes before
  // deciding whether the expensive full pipeline is needed at all.
  const discovery = discoverSourceFiles({
    repoRoot: projectRoot,
    sourceRoots: normalizedSourceRoots,
    userExcludes: options.exclude,
    onProgress: progress,
  })
  const currentFileEntries = buildCacheFileEntries(discovery.files)
  const changedFileSummary = classifyChangedFiles(cacheRead.metadata.files, currentFileEntries)
  const hasChanges =
    changedFileSummary.addedCount > 0 || changedFileSummary.changedCount > 0 || changedFileSummary.removedCount > 0

  if (hasChanges) {
    const detailed = classifyChangedFilePaths(cacheRead.metadata.files, currentFileEntries)
    const eligibility = checkPartialRebuildEligibility(outputDir, detailed.unchanged)

    if (eligibility.eligible) {
      const previousCacheEntriesByPath = new Map(cacheRead.metadata.files.map((entry) => [entry.path, entry]))
      const partial = buildPartialSymbolIndex({
        repoRoot: projectRoot,
        sourceRoots: normalizedSourceRoots,
        buildCallGraph: options.callGraph === true,
        discoveryFiles: discovery.files,
        unchangedPaths: new Set(detailed.unchanged),
        previousFileSummariesByPath: eligibility.previousFileSummariesByPath,
        previousCacheEntriesByPath,
      })
      const cacheMode: CacheMode = partial.callGraphFallback
        ? 'incremental-partial-with-artifact-fallback'
        : 'incremental-partial'
      const partialRebuildFallbackArtifacts = partial.callGraphFallback ? ['call-graph'] : []

      const preflightWarnings = computePreflightWarnings({
        sourceRoots: normalizedSourceRoots,
        totalFilesDiscovered: discovery.totalFilesDiscovered,
        totalFilesEligibleForIndexing: discovery.totalFilesEligibleForIndexing,
      })

      const built = finishIndexBuild({
        projectRoot,
        normalizedSourceRoots,
        options,
        outputDir,
        progress,
        commandStartTime,
        index: partial.index,
        callGraph: partial.callGraph,
        preflightWarnings,
        indexMode: 'incremental',
        cacheMode,
        cacheInvalidationReason: null,
        changedFileSummary,
        partialRebuildFallbackArtifacts,
      })

      writeMergedCacheMetadata({
        outputDir,
        projectRoot,
        normalizedSourceRoots,
        configFingerprint,
        baseFiles: currentFileEntries,
        fileExtractionMeta: partial.fileExtractionMeta,
      })

      return {
        ...built,
        cache: {
          requested: true,
          mode: cacheMode,
          cacheMetadataPath,
          invalidationReason: null,
          changedFileSummary,
          partialRebuildFallbackArtifacts,
        },
        cacheReset,
      }
    }

    // Partial reuse was not safely possible this run: fall back honestly to
    // a full rebuild, exactly as Batch 2 always did for any detected change.
    const built = runFullIndexBuild({
      projectRoot,
      normalizedSourceRoots,
      options,
      outputDir,
      progress,
      commandStartTime,
      indexMode: 'incremental',
      cacheMode: 'incremental-change-detected-full-rebuild',
      cacheInvalidationReason: eligibility.reason,
      changedFileSummary,
      partialRebuildFallbackArtifacts: [],
    })
    writeMergedCacheMetadata({
      outputDir,
      projectRoot,
      normalizedSourceRoots,
      configFingerprint,
      baseFiles: buildCacheFileEntries(built.discoveryFiles),
      fileExtractionMeta: built.fileExtractionMeta,
    })
    return {
      ...built.result,
      cache: {
        requested: true,
        mode: 'incremental-change-detected-full-rebuild',
        cacheMetadataPath,
        invalidationReason: eligibility.reason,
        changedFileSummary,
        partialRebuildFallbackArtifacts: [],
      },
      cacheReset,
    }
  }

  // No changes: attempt the no-op fast path by reusing the existing
  // manifest/artifacts on disk without re-running the full pipeline. If the
  // existing manifest is missing or unreadable despite a valid cache (a
  // stale/inconsistent output directory), fall back to a safe full rebuild
  // rather than silently returning inconsistent data.
  const existingManifest = tryReadExistingManifest(outputDir)
  if (!existingManifest) {
    return fullRebuild(
      'incremental-full-cache-incompatible',
      'Cache metadata is valid but the existing index artifacts are missing or unreadable.'
    )
  }

  const preflightWarnings = computePreflightWarnings({
    sourceRoots: normalizedSourceRoots,
    totalFilesDiscovered: discovery.totalFilesDiscovered,
    totalFilesEligibleForIndexing: discovery.totalFilesEligibleForIndexing,
  })

  return {
    mode: 'index',
    manifest: existingManifest,
    outputDir: toForwardSlash(outputDir),
    symbolIndexPath: toForwardSlash(path.join(outputDir, existingManifest.artifacts.symbolIndex)),
    codeGraphPath: toForwardSlash(path.join(outputDir, existingManifest.artifacts.codeGraph)),
    callGraphPath: existingManifest.artifacts.callGraph
      ? toForwardSlash(path.join(outputDir, existingManifest.artifacts.callGraph))
      : null,
    semanticArtifacts: {
      dataModelPath: existingManifest.semanticArtifacts?.dataModel
        ? toForwardSlash(path.join(outputDir, existingManifest.semanticArtifacts.dataModel))
        : null,
      dataModelGraphPath: existingManifest.semanticArtifacts?.dataModelGraph
        ? toForwardSlash(path.join(outputDir, existingManifest.semanticArtifacts.dataModelGraph))
        : null,
      modelViewLineagePath: existingManifest.semanticArtifacts?.modelViewLineage
        ? toForwardSlash(path.join(outputDir, existingManifest.semanticArtifacts.modelViewLineage))
        : null,
      frontendSemanticPath: existingManifest.semanticArtifacts?.frontendSemantic
        ? toForwardSlash(path.join(outputDir, existingManifest.semanticArtifacts.frontendSemantic))
        : null,
      frontendReachabilityPath: existingManifest.semanticArtifacts?.frontendReachability
        ? toForwardSlash(path.join(outputDir, existingManifest.semanticArtifacts.frontendReachability))
        : null,
    },
    analyzers: existingManifest.analyzers,
    managedArtifacts: { removed: [] },
    preflightWarnings,
    cache: {
      requested: true,
      mode: 'incremental-no-change',
      cacheMetadataPath,
      invalidationReason: null,
      changedFileSummary,
      partialRebuildFallbackArtifacts: [],
    },
    cacheReset,
  }
}

function tryReadExistingManifest(outputDir: string): IndexManifest | null {
  try {
    const manifestPath = path.join(outputDir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) return null
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as IndexManifest
    if (parsed.artifactKind !== 'my-dev-kit-v1-manifest') return null
    if (!parsed.artifacts?.symbolIndex || !parsed.artifacts?.codeGraph) return null
    if (!fs.existsSync(path.join(outputDir, parsed.artifacts.symbolIndex))) return null
    if (!fs.existsSync(path.join(outputDir, parsed.artifacts.codeGraph))) return null
    return parsed
  } catch {
    return null
  }
}

function writeMergedCacheMetadata(params: {
  outputDir: string
  projectRoot: string
  normalizedSourceRoots: string[]
  configFingerprint: string
  baseFiles: CacheFileEntry[]
  fileExtractionMeta: ReadonlyMap<string, FileExtractionMeta>
}): void {
  const files = mergeCacheFileEntryMeta(params.baseFiles, params.fileExtractionMeta)
  writeCacheMetadata(
    params.outputDir,
    buildCacheMetadata({
      projectRoot: params.projectRoot,
      sourceRoots: params.normalizedSourceRoots,
      configFingerprint: params.configFingerprint,
      files,
    })
  )
}

// ---------------------------------------------------------------------------
// Full index build (shared by plain `index` and every incremental full-rebuild mode)
// ---------------------------------------------------------------------------

interface RunFullIndexBuildParams {
  projectRoot: string
  normalizedSourceRoots: string[]
  options: RunIndexCommandOptions
  outputDir: string
  progress: ((event: ProgressEvent) => void) | undefined
  commandStartTime: number
  indexMode: 'full' | 'incremental'
  cacheMode: CacheMode | undefined
  cacheInvalidationReason: string | null | undefined
  changedFileSummary: ChangedFileSummary | null | undefined
  partialRebuildFallbackArtifacts: string[] | undefined
}

interface RunFullIndexBuildResult {
  result: Omit<RunIndexCommandIndexResult, 'cache' | 'cacheReset'>
  discoveryFiles: SourceDiscoveryResult['files']
  fileExtractionMeta: ReadonlyMap<string, FileExtractionMeta>
}

function runFullIndexBuild(params: RunFullIndexBuildParams): RunFullIndexBuildResult {
  const { projectRoot, normalizedSourceRoots, options, outputDir, progress } = params

  const buildResult = buildIndex({
    repoRoot: projectRoot,
    sourceRoots: normalizedSourceRoots,
    buildCallGraph: options.callGraph === true,
    excludePatterns: options.exclude,
    onProgress: progress,
  })

  const preflightWarnings = computePreflightWarnings({
    sourceRoots: normalizedSourceRoots,
    totalFilesDiscovered: buildResult.discovery.totalFilesDiscovered,
    totalFilesEligibleForIndexing: buildResult.discovery.totalFilesEligibleForIndexing,
  })

  const result = finishIndexBuild({
    ...params,
    index: buildResult.index,
    callGraph: buildResult.callGraph,
    preflightWarnings,
  })

  return { result, discoveryFiles: buildResult.discovery.files, fileExtractionMeta: buildResult.fileExtractionMeta }
}

// ---------------------------------------------------------------------------
// Shared finishing pipeline: semantic analyzers, classification, manifest, write.
//
// Used by both a full build (index/callGraph from buildIndex()) and a
// partial rebuild (index/callGraph from buildPartialSymbolIndex()) — the
// pipeline itself does not know or care which one produced its input.
// ---------------------------------------------------------------------------

interface FinishIndexBuildParams {
  projectRoot: string
  normalizedSourceRoots: string[]
  options: RunIndexCommandOptions
  outputDir: string
  progress: ((event: ProgressEvent) => void) | undefined
  commandStartTime: number
  index: SymbolIndex
  callGraph: CallGraph | null
  preflightWarnings: PreflightWarning[]
  indexMode: 'full' | 'incremental'
  cacheMode: CacheMode | undefined
  cacheInvalidationReason: string | null | undefined
  changedFileSummary: ChangedFileSummary | null | undefined
  partialRebuildFallbackArtifacts: string[] | undefined
}

function finishIndexBuild(params: FinishIndexBuildParams): Omit<RunIndexCommandIndexResult, 'cache' | 'cacheReset'> {
  const {
    projectRoot,
    normalizedSourceRoots,
    options,
    outputDir,
    progress,
    commandStartTime,
    index,
    callGraph,
    preflightWarnings,
    indexMode,
    cacheMode,
    cacheInvalidationReason,
    changedFileSummary,
    partialRebuildFallbackArtifacts,
  } = params

  const warnings: string[] = []
  const errors: string[] = []

  const languages = inferLanguages(index.files.map((file) => file.language), options.language)
  const codeGraph = buildCodeGraph({ symbolIndex: index, callGraph })
  const createdAt = new Date().toISOString()
  const baseManifest = buildIndexManifest({
    projectRoot: toForwardSlash(projectRoot),
    sourceRoots: normalizedSourceRoots,
    languages,
    callGraphEnabled: options.callGraph === true,
    callGraphProduced: callGraph !== null,
    symbolIndex: index,
    codeGraph,
    warnings,
    errors,
    createdAt,
    indexMode,
    cacheMode,
    cacheInvalidationReason,
    changedFileSummary,
    partialRebuildFallbackArtifacts,
  })
  const outputManifestPath = path.join(outputDir, 'manifest.json')
  const callGraphPath = baseManifest.artifacts.callGraph ? path.join(outputDir, baseManifest.artifacts.callGraph) : null
  const semanticResult = runSemanticAnalyzers({
    outputDir,
    manifestPath: outputManifestPath,
    manifest: baseManifest,
    symbolIndex: index,
    codeGraph,
    callGraphPath,
    createdAt,
    repoRoot: projectRoot,
  })
  const semanticMetadataBySymbolId = buildSemanticRolesFromDataModel({
    dataModel: semanticResult.dataModelResult.dataModel,
    dataModelPath: semanticResult.semanticArtifacts.dataModel ?? undefined,
    dataModelGraphPath: semanticResult.semanticArtifacts.dataModelGraph ?? undefined,
  })
  const enrichedSymbolIndex = applySemanticRolesToSymbolIndex(index, semanticMetadataBySymbolId)
  const frontendFlowCodeGraph = addFrontendRelationshipsToCodeGraph(codeGraph, semanticResult.frontendResult.artifact)
  const enrichedCodeGraph = applySemanticRolesToCodeGraph(frontendFlowCodeGraph, semanticMetadataBySymbolId)

  const { classification, classificationAnalyzerStatus } = runClassificationAnalyzer({
    symbolIndex: enrichedSymbolIndex,
    codeGraph: enrichedCodeGraph,
    dataModel: semanticResult.dataModelResult.dataModel,
    frontendSemantic: semanticResult.frontendResult.artifact,
    frontendReachability: semanticResult.frontendReachabilityResult.artifact,
    createdAt,
  })
  const classificationRefsBySymbolId = classification
    ? buildClassificationRefsBySymbolId(classification.entries, CLASSIFICATION_FILENAME)
    : new Map<string, CompactClassificationMetadata>()
  const classifiedSymbolIndex = applyClassificationToSymbolIndex(enrichedSymbolIndex, classificationRefsBySymbolId)
  const classifiedCodeGraph = applyClassificationToCodeGraph(enrichedCodeGraph, classificationRefsBySymbolId)

  const manifest = buildIndexManifest({
    projectRoot: toForwardSlash(projectRoot),
    sourceRoots: normalizedSourceRoots,
    languages,
    callGraphEnabled: options.callGraph === true,
    callGraphProduced: callGraph !== null,
    symbolIndex: classifiedSymbolIndex,
    codeGraph: classifiedCodeGraph,
    warnings,
    errors,
    createdAt,
    semanticArtifacts: semanticResult.semanticArtifacts,
    analyzers: replaceAnalyzerStatuses(
      [...(baseManifest.analyzers ?? []), classificationAnalyzerStatus],
      semanticResult.analyzers
    ),
    indexMode,
    cacheMode,
    cacheInvalidationReason,
    changedFileSummary,
    partialRebuildFallbackArtifacts,
  })

  progress?.({
    phase: 'artifact-write-start',
    message: 'Final artifact writing started',
    elapsedMs: Date.now() - commandStartTime,
  })
  const refreshResult: RefreshIndexOutputResult = refreshIndexOutput(outputDir)
  writeIndexArtifacts({
    outputDir,
    manifest,
    symbolIndex: classifiedSymbolIndex,
    codeGraph: classifiedCodeGraph,
    callGraph,
    classification,
    dataModel: semanticResult.dataModelResult.dataModel,
    dataModelGraph: semanticResult.dataModelResult.dataModelGraph,
    frontendSemantic: semanticResult.frontendResult.artifact,
    frontendReachability: semanticResult.frontendReachabilityResult.artifact,
  })
  progress?.({
    phase: 'artifact-write-complete',
    message: 'Final artifact writing completed',
    elapsedMs: Date.now() - commandStartTime,
  })

  return {
    mode: 'index',
    manifest,
    outputDir: toForwardSlash(outputDir),
    symbolIndexPath: toForwardSlash(path.join(outputDir, manifest.artifacts.symbolIndex)),
    codeGraphPath: toForwardSlash(path.join(outputDir, manifest.artifacts.codeGraph)),
    callGraphPath: manifest.artifacts.callGraph ? toForwardSlash(path.join(outputDir, manifest.artifacts.callGraph)) : null,
    semanticArtifacts: {
      dataModelPath: manifest.semanticArtifacts?.dataModel
        ? toForwardSlash(path.join(outputDir, manifest.semanticArtifacts.dataModel))
        : null,
      dataModelGraphPath: manifest.semanticArtifacts?.dataModelGraph
        ? toForwardSlash(path.join(outputDir, manifest.semanticArtifacts.dataModelGraph))
        : null,
      modelViewLineagePath: manifest.semanticArtifacts?.modelViewLineage
        ? toForwardSlash(path.join(outputDir, manifest.semanticArtifacts.modelViewLineage))
        : null,
      frontendSemanticPath: manifest.semanticArtifacts?.frontendSemantic
        ? toForwardSlash(path.join(outputDir, manifest.semanticArtifacts.frontendSemantic))
        : null,
      frontendReachabilityPath: manifest.semanticArtifacts?.frontendReachability
        ? toForwardSlash(path.join(outputDir, manifest.semanticArtifacts.frontendReachability))
        : null,
    },
    analyzers: manifest.analyzers,
    managedArtifacts: {
      removed: refreshResult.removed,
    },
    preflightWarnings,
  }
}

function inferLanguages(languages: string[], requestedLanguage: string | undefined): string[] {
  if (requestedLanguage) return [requestedLanguage]
  return [...new Set(languages)].sort()
}

function buildDryRunResult(
  projectRoot: string,
  sourceRoots: string[],
  outputDir: string,
  discovery: SourceDiscoveryResult
): RunIndexCommandDryRunResult {
  return {
    mode: 'dry-run',
    projectRoot: toForwardSlash(projectRoot),
    sourceRoots,
    outputDir: toForwardSlash(outputDir),
    defaultIgnoredDirectoryNames: discovery.defaultIgnoredDirectoryNames,
    userExcludes: discovery.userExcludes,
    totalFilesDiscovered: discovery.totalFilesDiscovered,
    totalFilesEligibleForIndexing: discovery.totalFilesEligibleForIndexing,
    totalFilesSkipped: discovery.totalFilesSkipped,
    skippedByDefaultIgnore: discovery.skippedByDefaultIgnore,
    skippedByUserExclude: discovery.skippedByUserExclude,
    skippedByFilePattern: discovery.skippedByFilePattern,
    skippedUnsupportedFiles: discovery.skippedUnsupportedFiles,
    languageCounts: discovery.languageCounts,
    largestFiles: discovery.largestFiles,
    sampleIndexedFiles: discovery.sampleIndexedFiles,
    sampleSkippedFiles: discovery.sampleSkippedFiles,
    preflightWarnings: computePreflightWarnings({
      sourceRoots,
      totalFilesDiscovered: discovery.totalFilesDiscovered,
      totalFilesEligibleForIndexing: discovery.totalFilesEligibleForIndexing,
    }),
    cacheReset: null,
  }
}

interface RunClassificationAnalyzerOptions {
  symbolIndex: Parameters<typeof buildClassificationArtifact>[0]['symbolIndex']
  codeGraph: Parameters<typeof buildClassificationArtifact>[0]['codeGraph']
  dataModel: Parameters<typeof buildClassificationArtifact>[0]['dataModel']
  frontendSemantic: Parameters<typeof buildClassificationArtifact>[0]['frontendSemantic']
  frontendReachability: Parameters<typeof buildClassificationArtifact>[0]['frontendReachability']
  createdAt: string
}

/**
 * PSE-001 integration point: runs after enrichedSymbolIndex/enrichedCodeGraph
 * exist (so existing-semantic-role evidence is available), and reports
 * manifest analyzer status 'failed' rather than throwing/aborting the whole
 * index run if classification construction fails (AC-002/TST-070 graceful
 * failure-mode contract) - other analyzers' artifacts are unaffected either way
 * since this runs after their results are already computed.
 */
function runClassificationAnalyzer(options: RunClassificationAnalyzerOptions): {
  classification: ClassificationArtifact | null
  classificationAnalyzerStatus: IndexAnalyzerStatus
} {
  try {
    const { artifact, warningCount } = buildClassificationArtifact(options)
    return {
      classification: artifact,
      classificationAnalyzerStatus: {
        id: 'classification',
        status: warningCount > 0 ? 'partial' : 'complete',
        version: CLASSIFICATION_SCHEMA_VERSION,
        schemaVersion: CLASSIFICATION_SCHEMA_VERSION,
        artifacts: [
          {
            name: 'classification',
            path: CLASSIFICATION_FILENAME,
            artifactKind: 'my-dev-kit-v1-classification',
          },
        ],
        warningCount,
        errorCount: 0,
        summary: {
          entryCount: artifact.summary.entryCount,
          fileEntryCount: artifact.summary.fileEntryCount,
          symbolEntryCount: artifact.summary.symbolEntryCount,
        },
      },
    }
  } catch (error) {
    return {
      classification: null,
      classificationAnalyzerStatus: {
        id: 'classification',
        status: 'failed',
        version: CLASSIFICATION_SCHEMA_VERSION,
        schemaVersion: CLASSIFICATION_SCHEMA_VERSION,
        artifacts: [],
        warningCount: 0,
        errorCount: 1,
        summary: { errorMessage: error instanceof Error ? error.message : String(error) },
      },
    }
  }
}

type ProgressEvent =
  | BuildIndexProgressEvent
  | SourceDiscoveryProgressEvent
  | { phase: 'artifact-write-start' | 'artifact-write-complete'; message: string; elapsedMs: number }

function createProgressReporter(enabled: boolean, commandStartTime: number): ((event: ProgressEvent) => void) | undefined {
  if (!enabled) return undefined
  return (event) => {
    const elapsedSeconds = ((event.elapsedMs || Date.now() - commandStartTime) / 1000).toFixed(1)
    const counts =
      'filesEligible' in event
        ? ` discovered=${event.filesDiscovered} eligible=${event.filesEligible} skipped=${event.filesSkipped}`
        : 'filesIndexed' in event
          ? ` indexed=${event.filesIndexed}/${event.totalFiles}`
          : ''
    const sourceRoot = 'currentSourceRoot' in event && event.currentSourceRoot ? ` source=${event.currentSourceRoot}` : ''
    process.stderr.write(`[my-dev-kit:index] ${event.message} (${elapsedSeconds}s)${sourceRoot}${counts}\n`)
  }
}
