import * as fs from 'node:fs'
import * as path from 'node:path'
import { buildCodeGraph } from '../graph/buildCodeGraph.js'
import { addFrontendRelationshipsToCodeGraph } from '../graph/addFrontendRelationshipsToCodeGraph.js'
import { toForwardSlash } from '../io/pathUtils.js'
import { buildIndex, type BuildIndexProgressEvent } from '../symbol-index/builder.js'
import { buildIndexManifest } from './buildIndexManifest.js'
import {
  discoverSourceFiles,
  type SourceDiscoveryProgressEvent,
  type SourceDiscoveryResult,
} from './discoverSourceFiles.js'
import { writeIndexArtifacts } from './writeIndexManifest.js'
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
}

export type RunIndexCommandResult = RunIndexCommandIndexResult | RunIndexCommandDryRunResult

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
  const warnings: string[] = []
  const errors: string[] = []

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

  if (options.dryRun) {
    const discovery = discoverSourceFiles({
      repoRoot: projectRoot,
      sourceRoots: normalizedSourceRoots,
      userExcludes: options.exclude,
      onProgress: progress,
    })
    return buildDryRunResult(projectRoot, normalizedSourceRoots, outputDir, discovery)
  }

  const buildResult = buildIndex({
    repoRoot: projectRoot,
    sourceRoots: normalizedSourceRoots,
    buildCallGraph: options.callGraph === true,
    excludePatterns: options.exclude,
    onProgress: progress,
  })

  const languages = inferLanguages(buildResult.index.files.map((file) => file.language), options.language)
  const codeGraph = buildCodeGraph({
    symbolIndex: buildResult.index,
    callGraph: buildResult.callGraph,
  })
  const createdAt = new Date().toISOString()
  const baseManifest = buildIndexManifest({
    projectRoot: toForwardSlash(projectRoot),
    sourceRoots: normalizedSourceRoots,
    languages,
    callGraphEnabled: options.callGraph === true,
    callGraphProduced: buildResult.callGraph !== null,
    symbolIndex: buildResult.index,
    codeGraph,
    warnings,
    errors,
    createdAt,
  })
  const outputManifestPath = path.join(outputDir, 'manifest.json')
  const callGraphPath = baseManifest.artifacts.callGraph ? path.join(outputDir, baseManifest.artifacts.callGraph) : null
  const semanticResult = runSemanticAnalyzers({
    outputDir,
    manifestPath: outputManifestPath,
    manifest: baseManifest,
    symbolIndex: buildResult.index,
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
  const enrichedSymbolIndex = applySemanticRolesToSymbolIndex(buildResult.index, semanticMetadataBySymbolId)
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
    callGraphProduced: buildResult.callGraph !== null,
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
    callGraph: buildResult.callGraph,
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
