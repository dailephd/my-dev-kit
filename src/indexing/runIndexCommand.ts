import * as fs from 'node:fs'
import * as path from 'node:path'
import { buildCodeGraph } from '../graph/buildCodeGraph.js'
import { addFrontendRelationshipsToCodeGraph } from '../graph/addFrontendRelationshipsToCodeGraph.js'
import { addAndroidRelationshipsToCodeGraph } from '../graph/addAndroidRelationshipsToCodeGraph.js'
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
import {
  ANDROID_PROJECT_FILENAME,
  ANDROID_COMPONENTS_FILENAME,
  ANDROID_GRADLE_FILENAME,
  ANDROID_MANIFEST_FILENAME,
  ANDROID_RESOURCES_FILENAME,
  ANDROID_NAVIGATION_FILENAME,
  ANDROID_COMPOSE_SEMANTIC_FILENAME,
  ANDROID_TEST_SEMANTIC_FILENAME,
  CLASSIFICATION_FILENAME,
} from './managedArtifacts.js'
import type { IndexAnalyzerStatus } from './manifestTypes.js'
import { detectAndroidProject } from '../android/detectAndroidProject.js'
import { ANDROID_PROJECT_SCHEMA_VERSION, type DetectAndroidProjectResult } from '../android/androidProjectTypes.js'
import {
  detectAndroidComponents,
  buildAndroidComponentRefsBySymbolId,
  applyAndroidComponentsToSymbolIndex,
  applyAndroidComponentsToCodeGraph,
  ANDROID_COMPONENTS_SCHEMA_VERSION,
  buildAndroidGradleProject,
  ANDROID_GRADLE_SCHEMA_VERSION,
  buildAndroidManifestProject,
  ANDROID_MANIFEST_SCHEMA_VERSION,
  buildAndroidResourceProject,
  ANDROID_RESOURCES_SCHEMA_VERSION,
  buildAndroidNavigationProject,
  buildAndroidNavigationXmlEvidenceFingerprint,
  ANDROID_NAVIGATION_SCHEMA_VERSION,
  buildAndroidArtifactRelationships,
  buildAndroidComposeSemanticProject,
  ANDROID_COMPOSE_SEMANTIC_SCHEMA_VERSION,
  buildAndroidTestSemanticProject,
  buildAndroidTestEvidenceFingerprint,
  ANDROID_TEST_SEMANTIC_SCHEMA_VERSION,
  type AndroidComponentsArtifact,
  type CompactAndroidComponentMetadata,
  type BuildAndroidGradleProjectResult,
  type BuildAndroidManifestProjectResult,
  type BuildAndroidResourceProjectResult,
  type BuildAndroidNavigationProjectResult,
  type BuildAndroidArtifactRelationshipsResult,
  type BuildAndroidComposeSemanticProjectResult,
  type BuildAndroidTestSemanticProjectResult,
} from '../android/index.js'

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
  /** Path to `android-project.json`, or `null` when no Android project evidence was detected (v1.9.0 Batch 1). */
  androidProjectPath: string | null
  /** Path to `android-components.json`, or `null` when no Android component roles were detected (v1.9.0 Batch 4). */
  androidComponentsPath: string | null
  /** Path to `android-gradle.json`, or `null` when no detailed Gradle evidence was detected (v1.10.0 Batch 1). */
  androidGradlePath: string | null
  /** Path to `android-manifest.json`, or `null` when no AndroidManifest.xml evidence was detected (v1.10.0 Batch 2). */
  androidManifestPath: string | null
  /** Path to `android-resources.json`, or `null` when no Android resource evidence was detected (v1.10.0 Batch 3). */
  androidResourcesPath: string | null
  /** Path to `android-navigation.json`, or `null` when no Android navigation evidence was detected (v1.10.0 Batch 4). */
  androidNavigationPath: string | null
  /** Path to `android-compose-semantic.json`, or `null` when no supported Compose declaration evidence was detected (v1.11.0 Batch 1). */
  androidComposeSemanticPath: string | null
  /** Path to `android-test-semantic.json`, or `null` when no supported Android `test`/`androidTest` evidence was detected (v1.11.0 Batch 5). */
  androidTestSemanticPath: string | null
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

  // Static Android project/module/source-set detection (v1.9.0 Batch 1).
  // Runs once per invocation and is reused for both cache fingerprinting and
  // artifact writing/manifest registration — never re-detected mid-run.
  // Uses projectRoot (not --src roots), since Gradle/manifest evidence
  // typically lives outside the indexed source roots.
  const androidResult = detectAndroidProject({ projectRoot })

  // Detailed static Gradle project model (v1.10.0 Batch 1). Extends the
  // v1.9.0 module/source-set detection above with plugins, dependencies,
  // `android {}` configuration, and version-catalog evidence. Computed once
  // per invocation for the same reasons as `androidResult`.
  const androidGradleResult = buildAndroidGradleProject({ projectRoot, androidProject: androidResult.artifact })

  // Detailed static Android manifest model (v1.10.0 Batch 2). Discovers and
  // parses AndroidManifest.xml files using the module/source-set model above
  // plus Batch 1's Gradle namespace/custom-manifest-path evidence. Computed
  // once per invocation for the same reasons as androidResult/androidGradleResult.
  const androidManifestResult = buildAndroidManifestProject({
    projectRoot,
    androidProject: androidResult.artifact,
    androidGradle: androidGradleResult.artifact,
  })

  // Detailed static Android resource model (v1.10.0 Batch 3). Discovers and
  // indexes res/ directories using the module/source-set model above plus
  // Batch 1's Gradle resource-directory evidence. Computed once per
  // invocation for the same reasons as the other Android builders.
  const androidResourcesResult = buildAndroidResourceProject({
    projectRoot,
    androidProject: androidResult.artifact,
    androidGradle: androidGradleResult.artifact,
  })

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
      androidResult,
      androidGradleResult,
      androidManifestResult,
      androidResourcesResult,
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
    androidResult,
    androidGradleResult,
    androidManifestResult,
    androidResourcesResult,
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
  androidResult: DetectAndroidProjectResult
  androidGradleResult: BuildAndroidGradleProjectResult
  androidManifestResult: BuildAndroidManifestProjectResult
  androidResourcesResult: BuildAndroidResourceProjectResult
}

function runIncrementalIndex(params: RunIncrementalIndexParams): RunIndexCommandIndexResult {
  const {
    projectRoot,
    normalizedSourceRoots,
    options,
    outputDir,
    progress,
    commandStartTime,
    cacheReset,
    cacheMetadataPath,
    androidResult,
    androidGradleResult,
    androidManifestResult,
    androidResourcesResult,
  } = params

  const configFingerprint = computeConfigFingerprint({
    sourceRoots: normalizedSourceRoots,
    excludePatterns: options.exclude ?? [],
    callGraphEnabled: options.callGraph === true,
    language: options.language ?? null,
    defaultIgnoredDirectoryNames: [...DEFAULT_IGNORED_DIRECTORY_NAMES],
    defaultIgnoredDirectoryPrefixes: [...DEFAULT_IGNORED_DIRECTORY_PREFIXES],
    androidEvidenceFingerprint: androidResult.evidenceFingerprint,
    androidGradleEvidenceFingerprint: androidGradleResult.evidenceFingerprint,
    androidManifestEvidenceFingerprint: androidManifestResult.evidenceFingerprint,
    androidResourcesEvidenceFingerprint: androidResourcesResult.evidenceFingerprint,
    androidNavigationXmlEvidenceFingerprint: buildAndroidNavigationXmlEvidenceFingerprint({
      projectRoot,
      androidResources: androidResourcesResult.artifact,
    }),
    androidTestEvidenceFingerprint: buildAndroidTestEvidenceFingerprint(projectRoot, androidResult.artifact),
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
      androidResult,
      androidGradleResult,
      androidManifestResult,
      androidResourcesResult,
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
      'Index configuration changed (source roots, --exclude values, --call-graph, --language, default ignore rules, or detected Android project/module/source-set evidence).'
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
        androidResult,
        androidGradleResult,
        androidManifestResult,
        androidResourcesResult,
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
      androidResult,
      androidGradleResult,
      androidManifestResult,
      androidResourcesResult,
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
    androidProjectPath: resolveAndroidProjectPathFromManifest(existingManifest, outputDir),
    androidComponentsPath: resolveAndroidComponentsPathFromManifest(existingManifest, outputDir),
    androidGradlePath: resolveAndroidGradlePathFromManifest(existingManifest, outputDir),
    androidManifestPath: resolveAndroidManifestPathFromManifest(existingManifest, outputDir),
    androidResourcesPath: resolveAndroidResourcesPathFromManifest(existingManifest, outputDir),
    androidNavigationPath: resolveAndroidNavigationPathFromManifest(existingManifest, outputDir),
    androidComposeSemanticPath: resolveAndroidComposeSemanticPathFromManifest(existingManifest, outputDir),
    androidTestSemanticPath: resolveAndroidTestSemanticPathFromManifest(existingManifest, outputDir),
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

function resolveAndroidProjectPathFromManifest(manifest: IndexManifest, outputDir: string): string | null {
  return resolveAnalyzerArtifactPathFromManifest(manifest, outputDir, 'android-project')
}

function resolveAndroidComponentsPathFromManifest(manifest: IndexManifest, outputDir: string): string | null {
  return resolveAnalyzerArtifactPathFromManifest(manifest, outputDir, 'android-components')
}

function resolveAndroidGradlePathFromManifest(manifest: IndexManifest, outputDir: string): string | null {
  return resolveAnalyzerArtifactPathFromManifest(manifest, outputDir, 'android-gradle')
}

function resolveAndroidManifestPathFromManifest(manifest: IndexManifest, outputDir: string): string | null {
  return resolveAnalyzerArtifactPathFromManifest(manifest, outputDir, 'android-manifest')
}

function resolveAndroidResourcesPathFromManifest(manifest: IndexManifest, outputDir: string): string | null {
  return resolveAnalyzerArtifactPathFromManifest(manifest, outputDir, 'android-resources')
}

function resolveAndroidNavigationPathFromManifest(manifest: IndexManifest, outputDir: string): string | null {
  return resolveAnalyzerArtifactPathFromManifest(manifest, outputDir, 'android-navigation')
}

function resolveAndroidComposeSemanticPathFromManifest(manifest: IndexManifest, outputDir: string): string | null {
  return resolveAnalyzerArtifactPathFromManifest(manifest, outputDir, 'android-compose-semantic')
}

function resolveAndroidTestSemanticPathFromManifest(manifest: IndexManifest, outputDir: string): string | null {
  return resolveAnalyzerArtifactPathFromManifest(manifest, outputDir, 'android-test-semantic')
}

function resolveAnalyzerArtifactPathFromManifest(manifest: IndexManifest, outputDir: string, analyzerId: string): string | null {
  const analyzer = manifest.analyzers?.find((entry) => entry.id === analyzerId)
  const artifactPath = analyzer?.artifacts?.[0]?.path
  return artifactPath ? toForwardSlash(path.join(outputDir, artifactPath)) : null
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
  androidResult: DetectAndroidProjectResult
  androidGradleResult: BuildAndroidGradleProjectResult
  androidManifestResult: BuildAndroidManifestProjectResult
  androidResourcesResult: BuildAndroidResourceProjectResult
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
  androidResult: DetectAndroidProjectResult
  androidGradleResult: BuildAndroidGradleProjectResult
  androidManifestResult: BuildAndroidManifestProjectResult
  androidResourcesResult: BuildAndroidResourceProjectResult
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
    androidResult,
    androidGradleResult,
    androidManifestResult,
    androidResourcesResult,
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

  const androidAnalyzerStatus = buildAndroidAnalyzerStatus(androidResult)
  const androidGradleAnalyzerStatus = buildAndroidGradleAnalyzerStatus(androidGradleResult)
  const androidManifestAnalyzerStatus = buildAndroidManifestAnalyzerStatus(androidManifestResult)
  const androidResourcesAnalyzerStatus = buildAndroidResourcesAnalyzerStatus(androidResourcesResult)

  const { androidComponents, androidComponentsAnalyzerStatus } = runAndroidComponentsAnalyzer({
    symbolIndex: classifiedSymbolIndex,
    androidProject: androidResult.artifact,
    projectRoot,
    createdAt,
  })
  const androidComponentRefsBySymbolId = androidComponents
    ? buildAndroidComponentRefsBySymbolId(androidComponents.components, ANDROID_COMPONENTS_FILENAME)
    : new Map<string, CompactAndroidComponentMetadata>()
  const roledSymbolIndex = applyAndroidComponentsToSymbolIndex(classifiedSymbolIndex, androidComponentRefsBySymbolId)
  const roledCodeGraph = applyAndroidComponentsToCodeGraph(classifiedCodeGraph, androidComponentRefsBySymbolId)

  // Detailed static Android navigation model (v1.10.0 Batch 4). Computed
  // here — not alongside the other three Android builders at the top of
  // runIndexCommand — because its Compose-route evidence needs the
  // already-built symbol index (mirrors how android-components, Batch 4 of
  // v1.9.0, is computed inside this same finishing pipeline for the same
  // reason). The XML-navigation portion was already fingerprinted early
  // (see androidNavigationXmlEvidenceFingerprint in the config fingerprint)
  // and is safely recomputed here from the same static evidence.
  const androidNavigationResult = buildAndroidNavigationProject({
    projectRoot,
    androidProject: androidResult.artifact,
    androidGradle: androidGradleResult.artifact,
    androidResources: androidResourcesResult.artifact,
    symbolIndex: roledSymbolIndex,
    createdAt,
  })
  const androidNavigationAnalyzerStatus = buildAndroidNavigationAnalyzerStatus(androidNavigationResult)

  // Compose declaration-level semantic evidence (v1.11.0 Batch 1), extended in
  // Batch 2 with state/effect/ViewModel/UI-marker facts and in Batch 3 with
  // click-handler and navigation-call usage facts. Computed here, alongside
  // android-navigation, since it needs the already-built symbol index to
  // enumerate Kotlin files, and (Batch 3) the already-built
  // `androidNavigationResult.artifact` to exact-match `navigate(...)`
  // call-site routes against its existing `composeRoutes[]`/`destinations[]`
  // IDs. Still does not participate in code-graph projection, retrieval, or
  // graph-diff. A sibling of android-navigation.json, never a replacement.
  const { androidComposeSemantic, androidComposeSemanticAnalyzerStatus } = runAndroidComposeSemanticAnalyzer({
    projectRoot,
    symbolIndex: roledSymbolIndex,
    androidProject: androidResult.artifact,
    androidNavigation: androidNavigationResult.artifact,
    createdAt,
  })

  // Android test-source semantic evidence (v1.11.0 Batch 5). A separate
  // artifact from android-compose-semantic.json (production Compose
  // declarations/facts) — this one owns Android `test`/`androidTest`
  // source-set evidence only: test classes/methods, JUnit/Compose-rule/
  // Espresso/Robolectric evidence, and assertion/route/test-double facts.
  // Computed here since it needs the already-built `androidComposeSemantic`
  // and `androidNavigationResult.artifact` for exact static cross-reference
  // matching (never re-parsed). Discovers files only under the already-
  // detected `test`/`androidTest` source-set roots on `android-project.json`
  // — it never adds them to `symbol-index.json` or the core `--src` boundary.
  const { androidTestSemantic, androidTestSemanticAnalyzerStatus } = runAndroidTestSemanticAnalyzer({
    projectRoot,
    androidProject: androidResult.artifact,
    androidComposeSemantic,
    androidNavigation: androidNavigationResult.artifact,
    symbolIndex: roledSymbolIndex,
    createdAt,
  })

  // Android artifact relationships (v1.10.0 Batch 5, extended in v1.11.0
  // Batch 4 with Compose declaration/fact projection). Connects all seven
  // Android artifacts into the existing code-graph architecture — compact
  // artifact-backed nodes plus deterministic relationship edges, merged
  // additively into `roledCodeGraph`. Computed last among the Android
  // builders since it consumes every other Android artifact (including the
  // just-built `androidComposeSemantic`) plus the fully role-enriched symbol
  // index. No new top-level artifact is produced; this only enriches
  // `code-graph.json` and reports status via the existing analyzer-registry
  // convention (`android-relationships`).
  const androidRelationships = buildAndroidArtifactRelationships({
    projectRoot,
    androidProject: androidResult.artifact,
    androidGradle: androidGradleResult.artifact,
    androidManifest: androidManifestResult.artifact,
    androidResources: androidResourcesResult.artifact,
    androidNavigation: androidNavigationResult.artifact,
    androidComposeSemantic: androidComposeSemantic ?? undefined,
    androidTestSemantic: androidTestSemantic ?? undefined,
    symbolIndex: roledSymbolIndex,
  })
  const relationshipCodeGraph = addAndroidRelationshipsToCodeGraph(roledCodeGraph, androidRelationships)
  const androidRelationshipsAnalyzerStatus = buildAndroidRelationshipsAnalyzerStatus(androidResult, androidRelationships)

  const manifest = buildIndexManifest({
    projectRoot: toForwardSlash(projectRoot),
    sourceRoots: normalizedSourceRoots,
    languages,
    callGraphEnabled: options.callGraph === true,
    callGraphProduced: callGraph !== null,
    symbolIndex: roledSymbolIndex,
    codeGraph: relationshipCodeGraph,
    warnings,
    errors,
    createdAt,
    semanticArtifacts: semanticResult.semanticArtifacts,
    analyzers: replaceAnalyzerStatuses(
      [
        ...(baseManifest.analyzers ?? []),
        classificationAnalyzerStatus,
        androidAnalyzerStatus,
        androidComponentsAnalyzerStatus,
        androidGradleAnalyzerStatus,
        androidManifestAnalyzerStatus,
        androidResourcesAnalyzerStatus,
        androidNavigationAnalyzerStatus,
        androidComposeSemanticAnalyzerStatus,
        androidTestSemanticAnalyzerStatus,
        androidRelationshipsAnalyzerStatus,
      ],
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
    symbolIndex: roledSymbolIndex,
    codeGraph: relationshipCodeGraph,
    callGraph,
    classification,
    dataModel: semanticResult.dataModelResult.dataModel,
    dataModelGraph: semanticResult.dataModelResult.dataModelGraph,
    frontendSemantic: semanticResult.frontendResult.artifact,
    frontendReachability: semanticResult.frontendReachabilityResult.artifact,
    androidProject: androidResult.artifact.detected ? androidResult.artifact : null,
    androidComponents: androidComponents && androidComponents.detected ? androidComponents : null,
    androidGradle: androidGradleResult.artifact.detected ? androidGradleResult.artifact : null,
    androidManifest: androidManifestResult.artifact.detected ? androidManifestResult.artifact : null,
    androidResources: androidResourcesResult.artifact.detected ? androidResourcesResult.artifact : null,
    androidNavigation: androidNavigationResult.artifact.detected ? androidNavigationResult.artifact : null,
    androidComposeSemantic: androidComposeSemantic && androidComposeSemantic.detected ? androidComposeSemantic : null,
    androidTestSemantic: androidTestSemantic && androidTestSemantic.detected ? androidTestSemantic : null,
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
    androidProjectPath: androidResult.artifact.detected
      ? toForwardSlash(path.join(outputDir, ANDROID_PROJECT_FILENAME))
      : null,
    androidComponentsPath: androidComponents && androidComponents.detected
      ? toForwardSlash(path.join(outputDir, ANDROID_COMPONENTS_FILENAME))
      : null,
    androidGradlePath: androidGradleResult.artifact.detected
      ? toForwardSlash(path.join(outputDir, ANDROID_GRADLE_FILENAME))
      : null,
    androidManifestPath: androidManifestResult.artifact.detected
      ? toForwardSlash(path.join(outputDir, ANDROID_MANIFEST_FILENAME))
      : null,
    androidResourcesPath: androidResourcesResult.artifact.detected
      ? toForwardSlash(path.join(outputDir, ANDROID_RESOURCES_FILENAME))
      : null,
    androidNavigationPath: androidNavigationResult.artifact.detected
      ? toForwardSlash(path.join(outputDir, ANDROID_NAVIGATION_FILENAME))
      : null,
    androidComposeSemanticPath: androidComposeSemantic && androidComposeSemantic.detected
      ? toForwardSlash(path.join(outputDir, ANDROID_COMPOSE_SEMANTIC_FILENAME))
      : null,
    androidTestSemanticPath: androidTestSemantic && androidTestSemantic.detected
      ? toForwardSlash(path.join(outputDir, ANDROID_TEST_SEMANTIC_FILENAME))
      : null,
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

/**
 * Registers Android project detection (v1.9.0 Batch 1) via the same
 * analyzer-registry pattern `classification` uses, rather than a new
 * top-level manifest field. Never `'failed'`: static evidence-gathering has
 * no real failure mode short of an I/O error, which `detectAndroidProject()`
 * already degrades to "no evidence found" rather than throwing.
 */
function buildAndroidAnalyzerStatus(androidResult: DetectAndroidProjectResult): IndexAnalyzerStatus {
  const { artifact } = androidResult
  const status: IndexAnalyzerStatus['status'] = !artifact.detected
    ? 'skipped'
    : artifact.confidence === 'high'
      ? 'complete'
      : 'partial'

  return {
    id: 'android-project',
    status,
    version: ANDROID_PROJECT_SCHEMA_VERSION,
    schemaVersion: ANDROID_PROJECT_SCHEMA_VERSION,
    artifacts: artifact.detected
      ? [{ name: 'androidProject', path: ANDROID_PROJECT_FILENAME, artifactKind: 'my-dev-kit-v1-android-project' }]
      : [],
    warningCount: artifact.warnings.length,
    errorCount: 0,
    summary: {
      detected: artifact.detected,
      confidence: artifact.confidence,
      moduleCount: artifact.summary.moduleCount,
    },
  }
}

/**
 * Registers detailed Gradle project evidence (v1.10.0 Batch 1) via the same
 * analyzer-registry pattern `android-project` uses. Never `'failed'`: like
 * `detectAndroidProject`, `buildAndroidGradleProject` degrades unreadable or
 * dynamic evidence to warnings rather than throwing.
 */
function buildAndroidGradleAnalyzerStatus(androidGradleResult: BuildAndroidGradleProjectResult): IndexAnalyzerStatus {
  const { artifact } = androidGradleResult
  const status: IndexAnalyzerStatus['status'] = !artifact.detected ? 'skipped' : artifact.warnings.length > 0 ? 'partial' : 'complete'

  return {
    id: 'android-gradle',
    status,
    version: ANDROID_GRADLE_SCHEMA_VERSION,
    schemaVersion: ANDROID_GRADLE_SCHEMA_VERSION,
    artifacts: artifact.detected
      ? [{ name: 'androidGradle', path: ANDROID_GRADLE_FILENAME, artifactKind: 'my-dev-kit-v1-android-gradle' }]
      : [],
    warningCount: artifact.warnings.length,
    errorCount: 0,
    summary: {
      detected: artifact.detected,
      moduleCount: artifact.summary.moduleCount,
      versionCatalogFileCount: artifact.summary.versionCatalogFileCount,
    },
  }
}

/**
 * Registers detailed Android manifest evidence (v1.10.0 Batch 2) via the
 * same analyzer-registry pattern `android-gradle` uses. Never `'failed'`:
 * a malformed manifest degrades to a bounded per-file warning (see
 * `parseAndroidManifest`'s `parsingStatus: 'malformed'` record) rather than
 * throwing, mirroring `android-gradle`'s conservative failure-mode contract.
 */
function buildAndroidManifestAnalyzerStatus(androidManifestResult: BuildAndroidManifestProjectResult): IndexAnalyzerStatus {
  const { artifact } = androidManifestResult
  const status: IndexAnalyzerStatus['status'] = !artifact.detected ? 'skipped' : artifact.warnings.length > 0 ? 'partial' : 'complete'

  return {
    id: 'android-manifest',
    status,
    version: ANDROID_MANIFEST_SCHEMA_VERSION,
    schemaVersion: ANDROID_MANIFEST_SCHEMA_VERSION,
    artifacts: artifact.detected
      ? [{ name: 'androidManifest', path: ANDROID_MANIFEST_FILENAME, artifactKind: 'my-dev-kit-v1-android-manifest' }]
      : [],
    warningCount: artifact.warnings.length,
    errorCount: 0,
    summary: {
      detected: artifact.detected,
      manifestFileCount: artifact.summary.manifestFileCount,
      componentCount: artifact.summary.componentCount,
    },
  }
}

/**
 * Registers detailed Android resource evidence (v1.10.0 Batch 3) via the
 * same analyzer-registry pattern `android-manifest` uses. Never `'failed'`:
 * a malformed individual resource XML file degrades to a bounded per-file
 * warning rather than throwing, mirroring the conservative failure-mode
 * contract every other Android analyzer already has.
 */
function buildAndroidResourcesAnalyzerStatus(androidResourcesResult: BuildAndroidResourceProjectResult): IndexAnalyzerStatus {
  const { artifact } = androidResourcesResult
  const status: IndexAnalyzerStatus['status'] = !artifact.detected ? 'skipped' : artifact.warnings.length > 0 ? 'partial' : 'complete'

  return {
    id: 'android-resources',
    status,
    version: ANDROID_RESOURCES_SCHEMA_VERSION,
    schemaVersion: ANDROID_RESOURCES_SCHEMA_VERSION,
    artifacts: artifact.detected
      ? [{ name: 'androidResources', path: ANDROID_RESOURCES_FILENAME, artifactKind: 'my-dev-kit-v1-android-resources' }]
      : [],
    warningCount: artifact.warnings.length,
    errorCount: 0,
    summary: {
      detected: artifact.detected,
      resourceFileCount: artifact.summary.resourceFileCount,
      valueResourceCount: artifact.summary.valueResourceCount,
    },
  }
}

/**
 * Registers detailed Android navigation evidence (v1.10.0 Batch 4) via the
 * same analyzer-registry pattern `android-resources` uses. Never `'failed'`:
 * a malformed navigation XML file degrades to a bounded per-file warning
 * (mirroring `android-resources`), and unsupported Compose route syntax
 * degrades to a per-route warning rather than an invented route.
 */
function buildAndroidNavigationAnalyzerStatus(androidNavigationResult: BuildAndroidNavigationProjectResult): IndexAnalyzerStatus {
  const { artifact } = androidNavigationResult
  const status: IndexAnalyzerStatus['status'] = !artifact.detected ? 'skipped' : artifact.warnings.length > 0 ? 'partial' : 'complete'

  return {
    id: 'android-navigation',
    status,
    version: ANDROID_NAVIGATION_SCHEMA_VERSION,
    schemaVersion: ANDROID_NAVIGATION_SCHEMA_VERSION,
    artifacts: artifact.detected
      ? [{ name: 'androidNavigation', path: ANDROID_NAVIGATION_FILENAME, artifactKind: 'my-dev-kit-v1-android-navigation' }]
      : [],
    warningCount: artifact.warnings.length,
    errorCount: 0,
    summary: {
      detected: artifact.detected,
      xmlGraphCount: artifact.summary.xmlGraphCount,
      composeRouteCount: artifact.summary.composeRouteCount,
    },
  }
}

/**
 * Registers Android artifact-relationship enrichment (v1.10.0 Batch 5) via
 * the same analyzer-registry pattern the other five Android analyzers use.
 * Unlike them, this analyzer produces no new top-level artifact file — it
 * only enriches `code-graph.json` — so its `artifacts` list is always
 * empty; `summary` reports the enrichment size instead. Never `'failed'`:
 * `buildAndroidArtifactRelationships` degrades unresolved/ambiguous
 * evidence to an omitted edge or a warning, never an exception.
 */
function buildAndroidRelationshipsAnalyzerStatus(
  androidResult: DetectAndroidProjectResult,
  relationships: BuildAndroidArtifactRelationshipsResult
): IndexAnalyzerStatus {
  const detected = androidResult.artifact.detected && (relationships.nodes.length > 0 || relationships.edges.length > 0)
  const status: IndexAnalyzerStatus['status'] = !detected ? 'skipped' : relationships.warnings.length > 0 ? 'partial' : 'complete'

  return {
    id: 'android-relationships',
    status,
    version: '1.0.0',
    schemaVersion: '1.0.0',
    artifacts: [],
    warningCount: relationships.warnings.length,
    errorCount: 0,
    summary: {
      detected,
      addedNodeCount: relationships.nodes.length,
      addedEdgeCount: relationships.edges.length,
    },
  }
}

interface RunAndroidComposeSemanticAnalyzerOptions {
  projectRoot: string
  symbolIndex: SymbolIndex
  androidProject: DetectAndroidProjectResult['artifact']
  androidNavigation: BuildAndroidNavigationProjectResult['artifact']
  createdAt: string
}

/**
 * Registers Compose declaration-level semantic evidence (v1.11.0 Batch 1)
 * via the same analyzer-registry pattern `android-navigation` uses. Reports
 * 'failed' rather than throwing if the builder itself raises (mirrors the
 * `android-components` failure-mode contract, since this analyzer re-reads
 * arbitrary Kotlin source files from disk the same way android-components
 * does) — per-file I/O errors are already handled inside the builder itself
 * (a file is silently skipped, not a thrown error), so a genuine exception
 * here indicates a real internal defect, not routine unreadable-file noise.
 */
function runAndroidComposeSemanticAnalyzer(options: RunAndroidComposeSemanticAnalyzerOptions): {
  androidComposeSemantic: BuildAndroidComposeSemanticProjectResult['artifact'] | null
  androidComposeSemanticAnalyzerStatus: IndexAnalyzerStatus
} {
  try {
    const { artifact } = buildAndroidComposeSemanticProject(options)
    const status: IndexAnalyzerStatus['status'] = !artifact.detected ? 'skipped' : artifact.warnings.length > 0 ? 'partial' : 'complete'
    return {
      androidComposeSemantic: artifact,
      androidComposeSemanticAnalyzerStatus: {
        id: 'android-compose-semantic',
        status,
        version: ANDROID_COMPOSE_SEMANTIC_SCHEMA_VERSION,
        schemaVersion: ANDROID_COMPOSE_SEMANTIC_SCHEMA_VERSION,
        artifacts: artifact.detected
          ? [{ name: 'androidComposeSemantic', path: ANDROID_COMPOSE_SEMANTIC_FILENAME, artifactKind: 'my-dev-kit-v1-android-compose-semantic' }]
          : [],
        warningCount: artifact.warnings.length,
        errorCount: 0,
        summary: {
          detected: artifact.detected,
          declarationCount: artifact.summary.declarationCount,
          previewCount: artifact.summary.previewCount,
          topLevelCount: artifact.summary.topLevelCount,
          functionLocalCount: artifact.summary.functionLocalCount,
          childCallCount: artifact.summary.childCallCount,
          structuralRegionCallCount: artifact.summary.structuralRegionCallCount,
        },
      },
    }
  } catch (error) {
    return {
      androidComposeSemantic: null,
      androidComposeSemanticAnalyzerStatus: {
        id: 'android-compose-semantic',
        status: 'failed',
        version: ANDROID_COMPOSE_SEMANTIC_SCHEMA_VERSION,
        schemaVersion: ANDROID_COMPOSE_SEMANTIC_SCHEMA_VERSION,
        artifacts: [],
        warningCount: 0,
        errorCount: 1,
        summary: { errorMessage: error instanceof Error ? error.message : String(error) },
      },
    }
  }
}

interface RunAndroidTestSemanticAnalyzerOptions {
  projectRoot: string
  androidProject: DetectAndroidProjectResult['artifact']
  androidComposeSemantic: BuildAndroidComposeSemanticProjectResult['artifact'] | null
  androidNavigation: BuildAndroidNavigationProjectResult['artifact']
  symbolIndex: SymbolIndex
  createdAt: string
}

/**
 * Registers Android test-source semantic evidence (v1.11.0 Batch 5) via the
 * same analyzer-registry pattern `android-compose-semantic` uses. Reports
 * 'failed' rather than throwing if the builder itself raises — per-file I/O
 * errors are already handled inside the builder itself (a file is silently
 * skipped, not a thrown error), so a genuine exception here indicates a real
 * internal defect, not routine unreadable-file noise.
 */
function runAndroidTestSemanticAnalyzer(options: RunAndroidTestSemanticAnalyzerOptions): {
  androidTestSemantic: BuildAndroidTestSemanticProjectResult['artifact'] | null
  androidTestSemanticAnalyzerStatus: IndexAnalyzerStatus
} {
  try {
    const { artifact } = buildAndroidTestSemanticProject({
      projectRoot: options.projectRoot,
      androidProject: options.androidProject,
      androidComposeSemantic: options.androidComposeSemantic ?? undefined,
      androidNavigation: options.androidNavigation,
      symbolIndex: options.symbolIndex,
      createdAt: options.createdAt,
    })
    const status: IndexAnalyzerStatus['status'] = !artifact.detected ? 'skipped' : artifact.warnings.length > 0 ? 'partial' : 'complete'
    return {
      androidTestSemantic: artifact,
      androidTestSemanticAnalyzerStatus: {
        id: 'android-test-semantic',
        status,
        version: ANDROID_TEST_SEMANTIC_SCHEMA_VERSION,
        schemaVersion: ANDROID_TEST_SEMANTIC_SCHEMA_VERSION,
        artifacts: artifact.detected
          ? [{ name: 'androidTestSemantic', path: ANDROID_TEST_SEMANTIC_FILENAME, artifactKind: 'my-dev-kit-v1-android-test-semantic' }]
          : [],
        warningCount: artifact.warnings.length,
        errorCount: 0,
        summary: {
          detected: artifact.detected,
          testFileCount: artifact.summary.testFileCount,
          testClassCount: artifact.summary.testClassCount,
          testMethodCount: artifact.summary.testMethodCount,
          composeRuleCount: artifact.summary.composeRuleCount,
          visibleTextAssertionCount: artifact.summary.visibleTextAssertionCount,
          testTagAssertionCount: artifact.summary.testTagAssertionCount,
          routeReferenceCount: artifact.summary.routeReferenceCount,
        },
      },
    }
  } catch (error) {
    return {
      androidTestSemantic: null,
      androidTestSemanticAnalyzerStatus: {
        id: 'android-test-semantic',
        status: 'failed',
        version: ANDROID_TEST_SEMANTIC_SCHEMA_VERSION,
        schemaVersion: ANDROID_TEST_SEMANTIC_SCHEMA_VERSION,
        artifacts: [],
        warningCount: 0,
        errorCount: 1,
        summary: { errorMessage: error instanceof Error ? error.message : String(error) },
      },
    }
  }
}

interface RunAndroidComponentsAnalyzerOptions {
  symbolIndex: SymbolIndex
  androidProject: DetectAndroidProjectResult['artifact']
  projectRoot: string
  createdAt: string
}

/**
 * Registers Android component-role detection (v1.9.0 Batch 4) via the same
 * analyzer-registry pattern classification/android-project already use.
 * Skipped entirely (no detection run, no artifact) when Android project
 * evidence itself was not detected — component roles only make sense in the
 * context of an already-detected Android project. Reports 'failed' rather
 * than throwing if detection construction fails (mirrors the classification
 * analyzer's failure-mode contract), since detection reads already-indexed
 * source files from disk for Retrofit-service body evidence and that read
 * can fail even though the rest of the index run succeeded.
 */
function runAndroidComponentsAnalyzer(options: RunAndroidComponentsAnalyzerOptions): {
  androidComponents: AndroidComponentsArtifact | null
  androidComponentsAnalyzerStatus: IndexAnalyzerStatus
} {
  if (!options.androidProject.detected) {
    return {
      androidComponents: null,
      androidComponentsAnalyzerStatus: {
        id: 'android-components',
        status: 'skipped',
        version: ANDROID_COMPONENTS_SCHEMA_VERSION,
        schemaVersion: ANDROID_COMPONENTS_SCHEMA_VERSION,
        artifacts: [],
        warningCount: 0,
        errorCount: 0,
        summary: { detected: false, componentCount: 0 },
      },
    }
  }

  try {
    const { artifact } = detectAndroidComponents({
      symbolIndex: options.symbolIndex,
      androidProject: options.androidProject,
      projectRoot: options.projectRoot,
      createdAt: options.createdAt,
    })

    if (artifact.components.length === 0) {
      return {
        androidComponents: artifact,
        androidComponentsAnalyzerStatus: {
          id: 'android-components',
          status: 'skipped',
          version: ANDROID_COMPONENTS_SCHEMA_VERSION,
          schemaVersion: ANDROID_COMPONENTS_SCHEMA_VERSION,
          artifacts: [],
          warningCount: 0,
          errorCount: 0,
          summary: { detected: false, componentCount: 0 },
        },
      }
    }

    const allWeakOnly = artifact.components.every((component) => component.confidence === 'low')
    return {
      androidComponents: artifact,
      androidComponentsAnalyzerStatus: {
        id: 'android-components',
        status: allWeakOnly ? 'partial' : 'complete',
        version: ANDROID_COMPONENTS_SCHEMA_VERSION,
        schemaVersion: ANDROID_COMPONENTS_SCHEMA_VERSION,
        artifacts: [
          { name: 'androidComponents', path: ANDROID_COMPONENTS_FILENAME, artifactKind: 'my-dev-kit-v1-android-components' },
        ],
        warningCount: artifact.warnings.length,
        errorCount: 0,
        summary: {
          detected: true,
          componentCount: artifact.summary.componentCount,
          highConfidenceCount: artifact.summary.highConfidenceCount,
          mediumConfidenceCount: artifact.summary.mediumConfidenceCount,
          lowConfidenceCount: artifact.summary.lowConfidenceCount,
        },
      },
    }
  } catch (error) {
    return {
      androidComponents: null,
      androidComponentsAnalyzerStatus: {
        id: 'android-components',
        status: 'failed',
        version: ANDROID_COMPONENTS_SCHEMA_VERSION,
        schemaVersion: ANDROID_COMPONENTS_SCHEMA_VERSION,
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
