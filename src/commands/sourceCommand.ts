import * as fs from 'node:fs'
import type { Command } from 'commander'
import { loadSourceArtifacts } from '../indexing/loadIndexArtifacts.js'
import { buildContinuationCursor, ensureInsideProjectRoot, getSourceSlice } from '../lookup/getSourceSlice.js'
import { resolveFileNodeTarget, resolveSymbolTarget } from '../lookup/resolveSourceTarget.js'
import type { SourceSlice } from '../lookup/sourceSliceTypes.js'
import {
  parseSourceOutputFormat,
  renderSourceOutput,
  writeSourceOutput,
  type SourceOutputFormat,
} from '../source/renderSourceOutput.js'
import {
  findExactMatches,
  DEFAULT_CONTEXT_LINES,
  MAX_CONTEXT_LINES,
} from '../source/findExactMatches.js'
import { toForwardSlash } from '../io/pathUtils.js'
import { renderExactMatchResult } from '../source/renderExactMatches.js'
import { findReactRegion, ReactRegionNotFoundError } from '../source/findReactRegion.js'
import { parseInteger } from './parseUtils.js'
import type { FrontendSemanticArtifact } from '../frontend/frontendTypes.js'
import { readIndexManifest, type ResolvedIndexManifest } from '../indexing/readIndexManifest.js'
import {
  buildLocalComponentTreeSource,
  renderLocalComponentTreeSource,
} from '../source/localComponentTreeSource.js'
import {
  loadFrontendReachabilityArtifact,
  resolveReachabilityMode,
  buildReachabilitySourceResult,
  type ReachabilitySourceResult,
} from '../frontend-reachability/index.js'
import {
  loadAndroidGraphData,
  resolveAndroidSelectorMode,
  resolveAndroidCandidates,
  type AndroidCandidateBase,
  type AndroidGraphData,
  type AndroidSelectorMode,
} from '../android/index.js'
import { buildComposeTreeSource, renderComposeTreeSource } from '../source/composeTreeSource.js'
import { buildSourceBundle } from '../source/sourceBundle.js'
import { renderSourceBundle } from '../source/renderSourceBundle.js'
import type { IndexManifest } from '../indexing/manifestTypes.js'
import {
  buildClassificationCommandSummary,
  findClassificationEntryByTargetId,
  loadClassificationArtifact,
  type ClassificationCommandSummary,
} from '../classification/resolveClassificationForCommands.js'

export function registerSourceCommand(program: Command): void {
  program
    .command('source')
    .description('Retrieve bounded source from an indexed project.')
    .option('--index <dir>', 'index artifact directory', '.my-dev-kit')
    .option('--node <node-id>', 'node id to retrieve source for')
    .option('--route <path>', 'retrieve source for a frontend-reachability route fact')
    .option('--storage-key <key>', 'retrieve source for a frontend-reachability browser-storage key fact')
    .option('--ui <value>', 'retrieve source for a frontend-reachability UI marker fact')
    .option('--android-route <route>', 'retrieve bounded source for a uniquely-resolved Android route (exact match)')
    .option('--resource <name>', 'retrieve bounded source for a uniquely-resolved Android resource definition')
    .option('--composable <name>', 'retrieve bounded source for a uniquely-resolved Compose composable (exact name match)')
    .option('--include-compose-tree', 'include a bounded Compose child-composable tree bundle for --composable')
    .option('--android-ui <value>', 'retrieve bounded source for a uniquely-resolved Compose visible-text or string-resource fact (exact match)')
    .option('--test-tag <tag>', 'retrieve bounded source for a uniquely-resolved Compose Modifier.testTag value (exact match)')
    .option('--file <path>', 'file path')
    .option('--start <n>', 'start line', parseInteger)
    .option('--end <n>', 'end line', parseInteger)
    .option('--symbol <name>', 'symbol name')
    .option('--include-local-component-tree', 'include a bounded local React component-tree source bundle for --symbol')
    .option('--prop <name>', 'highlight a prop name inside --include-local-component-tree output')
    .option('--contains <string>', 'exact string to search for across indexed source files')
    .option('--react-region <region>', 'React region name (component, hook, JSX region, or prop type) to retrieve')
    .option(
      '--context <n>',
      `context lines around each match for --contains (default: ${DEFAULT_CONTEXT_LINES}, max: ${MAX_CONTEXT_LINES})`,
      parseInteger,
      DEFAULT_CONTEXT_LINES
    )
    .option('--path <prefix>', 'path prefix filter for --contains (e.g. "src/components")')
    .option('--max-lines <n>', 'maximum returned lines', parseInteger, 160)
    .option('--continue-from <n>', 'continue file retrieval from this line number (requires --file)', parseInteger)
    .option('--continue', 'continue from the last preview window (requires --node or --file --symbol)')
    .option('--include-imports', 'include local import declarations in bundle')
    .option('--include-local-types', 'include local type/interface/enum definitions in bundle')
    .option('--include-props', 'include prop type definitions in bundle')
    .option('--include-local-components', 'include locally-rendered child components in bundle')
    .option('--include-local-deps', 'include all local dependencies (types, props, constants, helpers) in bundle')
    .option('--expand-to-local-dependencies', 'alias for --include-local-deps')
    .option('--max-bundle-lines <n>', 'max total lines across all blocks in bundle (default: 300)', parseInteger)
    .option('--max-blocks <n>', 'max number of blocks in bundle (default: 20)', parseInteger)
    .option('--format <json|plain|numbered>', 'output format')
    .option('--out <path>', 'write output to file')
    .option('--json', 'print JSON output (alias for --format json)')
    .action(function (this: Command, options: SourceCommandOptions) {
      const reachabilityMode = resolveReachabilityMode(options)
      if (reachabilityMode) {
        handleReachabilitySource(this, options, reachabilityMode)
        return
      }

      const androidMode = resolveAndroidSelectorMode({
        androidRoute: options.androidRoute,
        resource: options.resource,
        composable: options.composable,
        testTag: options.testTag,
        androidUi: options.androidUi,
      })
      if (options.includeComposeTree && (!androidMode || androidMode.mode !== 'composable')) {
        throw new Error('--include-compose-tree requires --composable <name>.')
      }
      if (androidMode) {
        if (androidMode.mode === 'composable' && options.includeComposeTree) {
          handleComposeTreeSource(options, androidMode.query)
          return
        }
        handleAndroidSource(options, androidMode)
        return
      }

      const format = resolveFormat(options)
      const mode = selectMode(options)

      if (mode === 'exact-match') {
        handleExactMatch(options, format)
        return
      }

      if (mode === 'react-region') {
        handleReactRegion(options, format)
        return
      }

      if (mode === 'local-component-tree') {
        handleLocalComponentTree(options, format)
        return
      }

      if (mode === 'continue-from') {
        handleContinueFrom(options, format)
        return
      }

      if (mode === 'node-continue') {
        handleNodeContinue(options, format)
        return
      }

      if (mode === 'symbol-continue') {
        handleSymbolContinue(options, format)
        return
      }

      if (mode === 'source-bundle') {
        handleSourceBundle(options, format)
        return
      }

      const artifacts = loadSourceArtifacts({
        indexDir: options.index,
        loadCodeGraph: mode === 'node',
        loadSymbolIndex: mode === 'symbol' || mode === 'node',
      })
      let target
      if (mode === 'line-range') {
        target = {
          mode,
          filePath: options.file!,
          startLine: options.start!,
          endLine: options.end!,
          warnings: [],
        }
      } else if (mode === 'symbol') {
        target = resolveSymbolTarget(artifacts.symbolIndex!, options.file!, options.symbol!, options.maxLines)
      } else {
        const nodeTarget = resolveFileNodeTarget(artifacts.codeGraph!, options.node!, options.maxLines)
        target = nodeTarget.mode === 'symbol'
          ? resolveSymbolTarget(artifacts.symbolIndex!, nodeTarget.filePath, nodeTarget.symbolName!, options.maxLines)
          : nodeTarget
      }

      const result = getSourceSlice({
        indexDir: options.index,
        projectRoot: artifacts.resolved.manifest.projectRoot,
        filePath: target.filePath,
        startLine: target.startLine!,
        endLine: target.endLine!,
        maxLines: options.maxLines,
        mode,
        symbolName: target.symbolName,
        semanticRoles: target.semanticRoles,
        artifactRefs: target.artifactRefs,
        evidenceRefs: target.evidenceRefs,
        classificationRoles: target.classificationRoles,
        classificationRefs: target.classificationRefs,
        classificationSummary: resolveClassificationSummaryForTarget(
          artifacts.resolved.manifest,
          options.index,
          target.filePath,
          target.symbolName
        ),
        androidComponentRoles: target.androidComponentRoles,
        androidComponentRefs: target.androidComponentRefs,
        warnings: target.warnings,
      })

      emitSourceResult(result, format, options)
    })
}

function handleExactMatch(options: SourceCommandOptions, format: SourceOutputFormat | undefined): void {
  const value = options.contains!
  if (!value || value.length === 0) {
    throw new Error('--contains value must be a non-empty string.')
  }

  const contextLines = options.context
  if (contextLines < 0) {
    throw new Error(`--context must be a non-negative integer (0 to ${MAX_CONTEXT_LINES}).`)
  }

  // Validate optional --path filter
  let pathFilter: string | undefined
  if (options.path !== undefined) {
    if (options.path.includes('..')) {
      throw new Error('--path must not contain ".." path components.')
    }
    pathFilter = toForwardSlash(options.path)
  }

  const artifacts = loadSourceArtifacts({
    indexDir: options.index,
    loadSymbolIndex: true,
  })

  const frontendArtifact = loadOptionalFrontendArtifact(artifacts.resolved)

  const matchResult = findExactMatches({
    value,
    contextLines,
    projectRoot: artifacts.resolved.manifest.projectRoot,
    symbolIndex: artifacts.symbolIndex!,
    frontendArtifact,
    pathFilter,
  })

  const resolvedFormat: SourceOutputFormat = format ?? 'numbered'
  const rendered = renderExactMatchResult(matchResult, resolvedFormat)

  if (options.out) {
    const writtenPath = writeSourceOutput(options.out, rendered)
    console.log(`Wrote source matches to ${writtenPath}`)
    return
  }

  process.stdout.write(rendered)
}

function handleReactRegion(options: SourceCommandOptions, format: SourceOutputFormat | undefined): void {
  const region = options.reactRegion!
  const filePath = options.file!

  const artifacts = loadSourceArtifacts({
    indexDir: options.index,
    loadSymbolIndex: false,
  })

  const frontendArtifact = loadOptionalFrontendArtifact(artifacts.resolved)
  if (!frontendArtifact) {
    throw new Error(
      'No frontend semantic artifact found. Run `npx @dailephd/my-dev-kit index` on a project with TSX/JSX files first.',
    )
  }

  let regionResult
  try {
    regionResult = findReactRegion({
      region,
      filePath,
      frontendArtifact,
    })
  } catch (err) {
    if (err instanceof ReactRegionNotFoundError) {
      throw err
    }
    throw err
  }

  const { match } = regionResult

  const result = getSourceSlice({
    indexDir: options.index,
    projectRoot: artifacts.resolved.manifest.projectRoot,
    filePath,
    startLine: match.startLine,
    endLine: match.endLine,
    maxLines: options.maxLines,
    mode: 'symbol',
    symbolName: match.matchedName,
    warnings: match.warnings,
  })

  const resolvedFormat: SourceOutputFormat = format ?? 'numbered'

  if (format === 'json') {
    const jsonResult = {
      ...result,
      reactRegion: {
        region,
        matchedKind: match.matchedKind,
        matchedId: match.matchedId,
        matchedName: match.matchedName,
      },
    }
    const rendered = JSON.stringify(jsonResult, null, 2) + '\n'
    if (options.out) {
      const writtenPath = writeSourceOutput(options.out, rendered)
      console.log(`Wrote React region source to ${writtenPath}`)
      return
    }
    process.stdout.write(rendered)
    return
  }

  const rendered = renderSourceOutput(result, resolvedFormat)
  if (options.out) {
    const writtenPath = writeSourceOutput(options.out, rendered)
    console.log(`Wrote React region source to ${writtenPath}`)
    return
  }
  process.stdout.write(rendered)
}

function handleLocalComponentTree(options: SourceCommandOptions, format: SourceOutputFormat | undefined): void {
  const artifacts = loadSourceArtifacts({
    indexDir: options.index,
    loadSymbolIndex: false,
  })
  const frontendArtifact = loadOptionalFrontendArtifact(artifacts.resolved)
  const result = buildLocalComponentTreeSource({
    indexDir: options.index,
    projectRoot: artifacts.resolved.manifest.projectRoot,
    frontendArtifact,
    symbol: options.symbol!,
    filePath: options.file,
    maxLines: options.maxLines,
    propName: options.prop,
  })

  const resolvedFormat: SourceOutputFormat = format ?? 'numbered'
  const rendered = renderLocalComponentTreeSource(result, resolvedFormat)
  if (options.out) {
    const writtenPath = writeSourceOutput(options.out, rendered)
    console.log(`Wrote local component-tree source to ${writtenPath}`)
    return
  }
  process.stdout.write(rendered)
}

function handleContinueFrom(options: SourceCommandOptions, format: SourceOutputFormat | undefined): void {
  const continueFrom = options.continueFrom!
  const filePath = options.file!

  const artifacts = loadSourceArtifacts({
    indexDir: options.index,
    loadCodeGraph: false,
    loadSymbolIndex: options.symbol !== undefined,
  })

  const projectRoot = artifacts.resolved.manifest.projectRoot
  const absolutePath = ensureInsideProjectRoot(projectRoot, filePath)
  const fileLineCount = readFileLineCount(absolutePath)
  const normalizedFilePath = toForwardSlash(filePath)

  const warnings: string[] = []

  if (continueFrom > fileLineCount) {
    warnings.push(`Continuation from line ${continueFrom} is past the end of file (${fileLineCount} lines).`)
    const cursor = buildContinuationCursor({
      filePath: normalizedFilePath,
      endLine: fileLineCount,
      fileLineCount,
      targetKind: 'line-range',
      symbolName: options.symbol ?? null,
      maxLines: options.maxLines,
      symbolBoundaryKnown: true,
      warnings,
    })
    const eofResult: SourceSlice = {
      status: 'ok',
      mode: 'line-range',
      indexDir: options.index,
      filePath: normalizedFilePath,
      absolutePath: toForwardSlash(absolutePath),
      symbolName: options.symbol ?? null,
      startLine: continueFrom,
      endLine: fileLineCount,
      lineCount: 0,
      content: '',
      warnings,
      continuationCursor: cursor,
    }
    emitSourceResult(eofResult, format, options)
    return
  }

  let symbolName: string | null = null
  let semanticRoles = undefined
  let artifactRefs = undefined
  let evidenceRefs = undefined
  if (options.symbol && artifacts.symbolIndex) {
    try {
      const symTarget = resolveSymbolTarget(artifacts.symbolIndex, filePath, options.symbol, options.maxLines)
      symbolName = symTarget.symbolName ?? null
      semanticRoles = symTarget.semanticRoles
      artifactRefs = symTarget.artifactRefs
      evidenceRefs = symTarget.evidenceRefs
    } catch {
      // symbol metadata is optional in continue-from mode
    }
  }

  const endLine = Math.min(continueFrom + options.maxLines - 1, fileLineCount)

  const result = getSourceSlice({
    indexDir: options.index,
    projectRoot,
    filePath,
    startLine: continueFrom,
    endLine,
    maxLines: options.maxLines,
    mode: 'line-range',
    symbolName,
    symbolBoundaryKnown: true,
    semanticRoles,
    artifactRefs,
    evidenceRefs,
    warnings,
  })

  emitSourceResult(result, format, options)
}

function handleNodeContinue(options: SourceCommandOptions, format: SourceOutputFormat | undefined): void {
  const artifacts = loadSourceArtifacts({
    indexDir: options.index,
    loadCodeGraph: true,
    loadSymbolIndex: true,
  })

  const nodeTarget = resolveFileNodeTarget(artifacts.codeGraph!, options.node!, options.maxLines)
  const projectRoot = artifacts.resolved.manifest.projectRoot
  let filePath: string
  let symbolName: string | null = null
  let symStartLine: number | null = null
  let semanticRoles = undefined
  let artifactRefs = undefined
  let evidenceRefs = undefined

  if (nodeTarget.mode === 'symbol') {
    const symTarget = resolveSymbolTarget(artifacts.symbolIndex!, nodeTarget.filePath, nodeTarget.symbolName!, options.maxLines)
    filePath = symTarget.filePath
    symbolName = symTarget.symbolName ?? null
    symStartLine = symTarget.startLine!
    semanticRoles = symTarget.semanticRoles
    artifactRefs = symTarget.artifactRefs
    evidenceRefs = symTarget.evidenceRefs
  } else {
    filePath = nodeTarget.filePath
  }

  const absolutePath = ensureInsideProjectRoot(projectRoot, filePath)
  const fileLineCount = readFileLineCount(absolutePath)
  const normalizedFilePath = toForwardSlash(filePath)

  // Symbol nodes: first window is startLine..startLine+min(maxLines,20)-1
  // File nodes: first window is 1..min(maxLines,fileLineCount)
  const continueFrom = symStartLine !== null
    ? symStartLine + Math.min(options.maxLines, 20)
    : Math.min(options.maxLines, fileLineCount) + 1
  const symbolBoundaryKnown = symStartLine === null

  const warnings: string[] = []

  if (continueFrom > fileLineCount) {
    warnings.push(`Continuation from line ${continueFrom} is past the end of file (${fileLineCount} lines).`)
    const cursor = buildContinuationCursor({
      filePath: normalizedFilePath,
      endLine: fileLineCount,
      fileLineCount,
      targetKind: 'node',
      targetId: options.node,
      symbolName,
      maxLines: options.maxLines,
      symbolBoundaryKnown,
      warnings,
    })
    const eofResult: SourceSlice = {
      status: 'ok',
      mode: 'node',
      indexDir: options.index,
      filePath: normalizedFilePath,
      absolutePath: toForwardSlash(absolutePath),
      symbolName,
      startLine: continueFrom,
      endLine: fileLineCount,
      lineCount: 0,
      content: '',
      warnings,
      continuationCursor: cursor,
    }
    emitSourceResult(eofResult, format, options)
    return
  }

  const endLine = Math.min(continueFrom + options.maxLines - 1, fileLineCount)

  const result = getSourceSlice({
    indexDir: options.index,
    projectRoot,
    filePath,
    startLine: continueFrom,
    endLine,
    maxLines: options.maxLines,
    mode: 'node',
    symbolName,
    symbolBoundaryKnown,
    targetId: options.node,
    semanticRoles,
    artifactRefs,
    evidenceRefs,
    warnings,
  })

  emitSourceResult(result, format, options)
}

function handleSymbolContinue(options: SourceCommandOptions, format: SourceOutputFormat | undefined): void {
  const artifacts = loadSourceArtifacts({
    indexDir: options.index,
    loadCodeGraph: false,
    loadSymbolIndex: true,
  })

  const symTarget = resolveSymbolTarget(artifacts.symbolIndex!, options.file!, options.symbol!, options.maxLines)
  const startLine = symTarget.startLine!
  const previousEndLine = startLine + Math.min(options.maxLines, 20) - 1
  const continueFrom = previousEndLine + 1

  const projectRoot = artifacts.resolved.manifest.projectRoot
  const absolutePath = ensureInsideProjectRoot(projectRoot, options.file!)
  const fileLineCount = readFileLineCount(absolutePath)
  const normalizedFilePath = toForwardSlash(symTarget.filePath)

  const warnings: string[] = []

  if (continueFrom > fileLineCount) {
    warnings.push(`Continuation from line ${continueFrom} is past the end of file (${fileLineCount} lines).`)
    const cursor = buildContinuationCursor({
      filePath: normalizedFilePath,
      endLine: fileLineCount,
      fileLineCount,
      targetKind: 'symbol',
      symbolName: symTarget.symbolName ?? null,
      maxLines: options.maxLines,
      symbolBoundaryKnown: false,
      warnings,
    })
    const eofResult: SourceSlice = {
      status: 'ok',
      mode: 'symbol',
      indexDir: options.index,
      filePath: normalizedFilePath,
      absolutePath: toForwardSlash(absolutePath),
      symbolName: symTarget.symbolName ?? null,
      startLine: continueFrom,
      endLine: fileLineCount,
      lineCount: 0,
      content: '',
      warnings,
      continuationCursor: cursor,
    }
    emitSourceResult(eofResult, format, options)
    return
  }

  const endLine = Math.min(continueFrom + options.maxLines - 1, fileLineCount)

  const result = getSourceSlice({
    indexDir: options.index,
    projectRoot,
    filePath: options.file!,
    startLine: continueFrom,
    endLine,
    maxLines: options.maxLines,
    mode: 'symbol',
    symbolName: symTarget.symbolName,
    symbolBoundaryKnown: false,
    semanticRoles: symTarget.semanticRoles,
    artifactRefs: symTarget.artifactRefs,
    evidenceRefs: symTarget.evidenceRefs,
    classificationRoles: symTarget.classificationRoles,
    classificationRefs: symTarget.classificationRefs,
    classificationSummary: resolveClassificationSummaryForTarget(
      artifacts.resolved.manifest,
      options.index,
      symTarget.filePath,
      symTarget.symbolName
    ),
    androidComponentRoles: symTarget.androidComponentRoles,
    androidComponentRefs: symTarget.androidComponentRefs,
    warnings,
  })

  emitSourceResult(result, format, options)
}

const DEFAULT_MAX_BUNDLE_LINES = 300
const DEFAULT_MAX_BLOCKS = 20

function handleSourceBundle(options: SourceCommandOptions, format: SourceOutputFormat | undefined): void {
  const artifacts = loadSourceArtifacts({
    indexDir: options.index,
    loadCodeGraph: options.node !== undefined,
    loadSymbolIndex: true,
  })

  const frontendArtifact = loadOptionalFrontendArtifact(artifacts.resolved)
  const maxLinesPerBlock = options.maxLines
  const maxLinesPerBundle = options.maxBundleLines ?? DEFAULT_MAX_BUNDLE_LINES
  const maxBlocks = options.maxBlocks ?? DEFAULT_MAX_BLOCKS

  const bundle = buildSourceBundle({
    indexDir: options.index,
    projectRoot: artifacts.resolved.manifest.projectRoot,
    filePath: options.file,
    symbolName: options.symbol,
    nodeId: options.node,
    startLine: options.start,
    endLine: options.end,
    maxLinesPerBlock,
    maxLinesPerBundle,
    maxBlocks,
    includeImports: options.includeImports === true,
    includeLocalTypes: options.includeLocalTypes === true,
    includeProps: options.includeProps === true,
    includeLocalComponents: options.includeLocalComponents === true,
    includeLocalDeps: (options.includeLocalDeps === true) || (options.expandToLocalDependencies === true),
    symbolIndex: artifacts.symbolIndex!,
    codeGraph: artifacts.codeGraph,
    frontendArtifact,
  })

  const resolvedFormat: 'json' | 'numbered' = format === 'json' ? 'json' : 'numbered'
  const rendered = renderSourceBundle(bundle, resolvedFormat)

  if (options.out) {
    const writtenPath = writeSourceOutput(options.out, rendered)
    if (resolvedFormat === 'json') {
      console.log(`Wrote source bundle JSON to ${writtenPath}`)
    } else {
      console.log(`Wrote source bundle to ${writtenPath}`)
    }
    return
  }

  process.stdout.write(rendered)
}

/**
 * Resolves a compact classification risk/warning/edit-guidance summary for a
 * source target, keyed by the same file/symbol node id already used by
 * search/lookup/slice (file:<path> or symbol:<path>#<name>). Returns null
 * (never throws) when classification.json is absent, unregistered, or has
 * no matching entry - source must not fail when classification data is
 * missing (classification-contract.txt section 7 backward compatibility).
 */
function resolveClassificationSummaryForTarget(
  manifest: IndexManifest,
  indexDir: string,
  filePath: string,
  symbolName: string | null | undefined
): ClassificationCommandSummary | null {
  const targetId = symbolName ? `symbol:${filePath}#${symbolName}` : `file:${filePath}`
  const artifact = loadClassificationArtifact(indexDir, manifest)
  return buildClassificationCommandSummary(findClassificationEntryByTargetId(artifact, targetId))
}

function emitSourceResult(result: SourceSlice, format: SourceOutputFormat | undefined, options: SourceCommandOptions): void {
  if (format === undefined) {
    if (options.out) {
      const rendered = renderSourceOutput(result, 'plain')
      const writtenPath = writeSourceOutput(options.out, rendered)
      console.log(`Wrote plain source to ${writtenPath}`)
    } else {
      console.log(`${result.filePath}:${result.startLine}-${result.endLine}`)
      if (result.warnings.length > 0) console.log(`Warnings: ${result.warnings.join('; ')}`)
      if (result.classificationSummary) {
        const { editGuidance, risks } = result.classificationSummary
        const riskNote = risks.length > 0 ? ` (${risks.join(', ')})` : ''
        console.log(`Classification edit guidance: ${editGuidance}${riskNote}`)
      }
      console.log(result.content)
      const cursor = result.continuationCursor
      if (cursor && !cursor.eof) {
        console.log(`[CONTINUE: ${cursor.filePath} from line ${cursor.nextStartLine} (reason: ${cursor.reason})]`)
      }
    }
    return
  }

  const rendered = renderSourceOutput(result, format)

  if (options.out) {
    const writtenPath = writeSourceOutput(options.out, rendered)
    if (format === 'json') {
      console.log(`Wrote JSON source result to ${writtenPath}`)
    } else {
      console.log(`Wrote ${format} source to ${writtenPath}`)
    }
    return
  }

  process.stdout.write(rendered)
}

const ANDROID_BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ttf', '.otf', '.so', '.mp3', '.mp4', '.ogg', '.wav', '.zip',
])

interface AndroidSourceResultItem {
  graphNodeId: string
  matchKind: string
  kind: string
  path?: string
  line?: number
  moduleId?: string
  sourceSetId?: string
  androidMetadata?: Record<string, string | number | boolean | null>
  binary: boolean
  slice?: SourceSlice
  warnings: string[]
}

interface AndroidSourceResult {
  artifactKind: 'my-dev-kit-v1-android-source-result'
  version: '1.0.0'
  mode: AndroidSelectorMode
  query: string
  status: 'ok' | 'not-found' | 'ambiguous'
  result: AndroidSourceResultItem | null
  candidates: Array<{ graphNodeId: string; matchKind: string; kind: string; path?: string }>
  warnings: string[]
}

const ANDROID_SOURCE_SELECTOR_FLAG_NAMES: Record<AndroidSelectorMode, string> = {
  'android-route': '--android-route',
  permission: '--permission',
  resource: '--resource',
  'android-component': '--android-component',
  composable: '--composable',
  'test-tag': '--test-tag',
  'android-ui': '--android-ui',
}

function handleAndroidSource(options: SourceCommandOptions, androidMode: { mode: AndroidSelectorMode; query: string }): void {
  const flagName = ANDROID_SOURCE_SELECTOR_FLAG_NAMES[androidMode.mode]
  for (const [flag, present] of [
    ['--node', options.node !== undefined],
    ['--file', options.file !== undefined],
    ['--symbol', options.symbol !== undefined],
    ['--contains', options.contains !== undefined],
    ['--react-region', options.reactRegion !== undefined],
    ['--start', options.start !== undefined],
    ['--end', options.end !== undefined],
    ['--continue-from', options.continueFrom !== undefined],
    ['--continue', options.continue === true],
  ] as const) {
    if (present) {
      throw new Error(`${flagName} cannot be combined with ${flag}.`)
    }
  }

  const graphData = loadAndroidGraphData(options.index)
  const resolved = readIndexManifest(options.index)
  const candidates: AndroidCandidateBase[] = resolveAndroidCandidates(graphData, androidMode.mode, androidMode.query)

  const wantsJson = options.json || options.format === 'json'
  const format = resolveFormat(options)

  if (candidates.length === 0) {
    const result: AndroidSourceResult = {
      artifactKind: 'my-dev-kit-v1-android-source-result',
      version: '1.0.0',
      mode: androidMode.mode,
      query: androidMode.query,
      status: 'not-found',
      result: null,
      candidates: [],
      warnings: [`No exact Android ${androidMode.mode} match for "${androidMode.query}".`],
    }
    emitAndroidSourceResult(result, wantsJson, options)
    return
  }

  if (candidates.length > 1) {
    const result: AndroidSourceResult = {
      artifactKind: 'my-dev-kit-v1-android-source-result',
      version: '1.0.0',
      mode: androidMode.mode,
      query: androidMode.query,
      status: 'ambiguous',
      result: null,
      candidates: candidates.map((c) => ({ graphNodeId: c.graphNodeId, matchKind: c.matchKind, kind: c.kind, path: c.path })),
      warnings: [`Multiple exact Android matches for "${androidMode.query}"; no candidate was selected.`],
    }
    emitAndroidSourceResult(result, wantsJson, options)
    return
  }

  const candidate = candidates[0]!
  const item = buildAndroidSourceResultItem(graphData, resolved.manifest.projectRoot, options.index, candidate, options.maxLines)
  const result: AndroidSourceResult = {
    artifactKind: 'my-dev-kit-v1-android-source-result',
    version: '1.0.0',
    mode: androidMode.mode,
    query: androidMode.query,
    status: 'ok',
    result: item,
    candidates: [],
    warnings: [],
  }
  emitAndroidSourceResult(result, wantsJson, options)
}

interface ComposeTreeResult {
  artifactKind: 'my-dev-kit-v1-compose-tree-result'
  version: '1.0.0'
  query: string
  status: 'ok' | 'not-found' | 'ambiguous'
  candidates: Array<{ graphNodeId: string; matchKind: string; kind: string; path?: string }>
  tree: ReturnType<typeof buildComposeTreeSource> | null
  warnings: string[]
}

function handleComposeTreeSource(options: SourceCommandOptions, query: string): void {
  for (const [flag, present] of [
    ['--node', options.node !== undefined],
    ['--file', options.file !== undefined],
    ['--symbol', options.symbol !== undefined],
    ['--contains', options.contains !== undefined],
    ['--react-region', options.reactRegion !== undefined],
    ['--start', options.start !== undefined],
    ['--end', options.end !== undefined],
    ['--continue-from', options.continueFrom !== undefined],
    ['--continue', options.continue === true],
  ] as const) {
    if (present) {
      throw new Error(`--composable --include-compose-tree cannot be combined with ${flag}.`)
    }
  }

  const graphData = loadAndroidGraphData(options.index)
  const resolved = readIndexManifest(options.index)
  const candidates = resolveAndroidCandidates(graphData, 'composable', query)
  const wantsJson = options.json || options.format === 'json'
  const maxLinesPerBundle = options.maxBundleLines ?? DEFAULT_MAX_BUNDLE_LINES

  if (candidates.length === 0) {
    emitComposeTreeResult(
      { artifactKind: 'my-dev-kit-v1-compose-tree-result', version: '1.0.0', query, status: 'not-found', candidates: [], tree: null, warnings: [`No exact composable match for "${query}".`] },
      wantsJson,
      options
    )
    return
  }
  if (candidates.length > 1) {
    emitComposeTreeResult(
      {
        artifactKind: 'my-dev-kit-v1-compose-tree-result',
        version: '1.0.0',
        query,
        status: 'ambiguous',
        candidates: candidates.map((c) => ({ graphNodeId: c.graphNodeId, matchKind: c.matchKind, kind: c.kind, path: c.path })),
        tree: null,
        warnings: [`Multiple exact composable matches for "${query}"; no candidate was selected.`],
      },
      wantsJson,
      options
    )
    return
  }

  const tree = buildComposeTreeSource({
    projectRoot: resolved.manifest.projectRoot,
    graphData,
    rootNodeId: candidates[0]!.graphNodeId,
    requestedComposable: query,
    maxLines: maxLinesPerBundle,
  })
  emitComposeTreeResult(
    { artifactKind: 'my-dev-kit-v1-compose-tree-result', version: '1.0.0', query, status: 'ok', candidates: [], tree, warnings: [] },
    wantsJson,
    options
  )
}

function emitComposeTreeResult(result: ComposeTreeResult, wantsJson: boolean, options: SourceCommandOptions): void {
  const format = resolveFormat(options) ?? 'numbered'
  if (wantsJson || format === 'json') {
    const rendered = JSON.stringify(result, null, 2) + '\n'
    if (options.out) {
      const writtenPath = writeSourceOutput(options.out, rendered)
      console.log(`Wrote Compose tree result to ${writtenPath}`)
      return
    }
    process.stdout.write(rendered)
    return
  }

  if (result.status !== 'ok' || !result.tree) {
    const lines: string[] = [`Compose tree: ${result.query}`, `Status: ${result.status}`]
    for (const warning of result.warnings) lines.push(`Warning: ${warning}`)
    if (result.status === 'ambiguous') {
      for (const candidate of result.candidates) lines.push(`- ${candidate.graphNodeId} (${candidate.matchKind})`)
    }
    const rendered = lines.join('\n') + '\n'
    if (options.out) {
      const writtenPath = writeSourceOutput(options.out, rendered)
      console.log(`Wrote Compose tree result to ${writtenPath}`)
      return
    }
    process.stdout.write(rendered)
    return
  }

  const rendered = renderComposeTreeSource(result.tree, format === 'plain' ? 'plain' : 'numbered')
  if (options.out) {
    const writtenPath = writeSourceOutput(options.out, rendered)
    console.log(`Wrote Compose tree source to ${writtenPath}`)
    return
  }
  process.stdout.write(rendered)
}

function buildAndroidSourceResultItem(
  graphData: AndroidGraphData,
  projectRoot: string,
  indexDir: string,
  candidate: AndroidCandidateBase,
  maxLines: number
): AndroidSourceResultItem {
  const base = {
    graphNodeId: candidate.graphNodeId,
    matchKind: candidate.matchKind,
    kind: candidate.kind,
    path: candidate.path,
    line: candidate.line,
    moduleId: candidate.moduleId,
    sourceSetId: candidate.sourceSetId,
    androidMetadata: candidate.androidMetadata,
  }

  if (!candidate.path) {
    return { ...base, binary: false, warnings: ['No source file path is available for this Android node.'] }
  }

  const extension = candidate.path.slice(candidate.path.lastIndexOf('.')).toLowerCase()
  if (ANDROID_BINARY_EXTENSIONS.has(extension)) {
    return {
      ...base,
      binary: true,
      warnings: ['This is a binary Android resource; contents are not decoded. Only file path and metadata are returned.'],
    }
  }

  const startLine = candidate.line ?? 1
  const window = Math.max(1, Math.min(maxLines, 12))
  try {
    const slice = getSourceSlice({
      indexDir,
      projectRoot,
      filePath: candidate.path,
      startLine,
      endLine: startLine + window - 1,
      maxLines,
      mode: 'line-range',
      warnings: ['Static evidence only: this is a bounded excerpt, not proof of runtime reachability.'],
    })
    return { ...base, binary: false, slice, warnings: [] }
  } catch (error) {
    return { ...base, binary: false, warnings: [(error as Error).message] }
  }
}

function emitAndroidSourceResult(result: AndroidSourceResult, wantsJson: boolean, options: SourceCommandOptions): void {
  if (wantsJson) {
    const rendered = JSON.stringify(result, null, 2) + '\n'
    if (options.out) {
      const writtenPath = writeSourceOutput(options.out, rendered)
      console.log(`Wrote Android source result to ${writtenPath}`)
      return
    }
    process.stdout.write(rendered)
    return
  }

  const lines: string[] = []
  lines.push(`Android source (${result.mode}): ${result.query}`)
  lines.push(`Status: ${result.status}`)
  for (const warning of result.warnings) lines.push(`Warning: ${warning}`)
  if (result.status === 'ambiguous') {
    for (const candidate of result.candidates) lines.push(`- ${candidate.graphNodeId} (${candidate.matchKind})`)
  } else if (result.status === 'ok' && result.result) {
    lines.push(`${result.result.graphNodeId} (${result.result.kind})`)
    if (result.result.path) lines.push(`${result.result.path}${result.result.line ? `:${result.result.line}` : ''}`)
    if (result.result.binary) {
      lines.push('[binary resource: contents not decoded]')
    } else if (result.result.slice) {
      lines.push(result.result.slice.content)
    }
    for (const warning of result.result.warnings) lines.push(`Warning: ${warning}`)
  }
  const rendered = lines.join('\n') + '\n'
  if (options.out) {
    const writtenPath = writeSourceOutput(options.out, rendered)
    console.log(`Wrote Android source to ${writtenPath}`)
    return
  }
  process.stdout.write(rendered)
}

const REACHABILITY_SOURCE_DEFAULT_CONTEXT = 10

function handleReachabilitySource(
  command: Command,
  options: SourceCommandOptions,
  reachabilityMode: { mode: 'route' | 'storage-key' | 'ui'; query: string }
): void {
  // Reject combination with non-reachability source modes.
  for (const [flag, present] of [
    ['--node', options.node !== undefined],
    ['--file', options.file !== undefined],
    ['--symbol', options.symbol !== undefined],
    ['--contains', options.contains !== undefined],
    ['--react-region', options.reactRegion !== undefined],
    ['--start', options.start !== undefined],
    ['--end', options.end !== undefined],
    ['--continue-from', options.continueFrom !== undefined],
    ['--continue', options.continue === true],
  ] as const) {
    if (present) {
      throw new Error(
        `The reachability flags (--route, --storage-key, --ui) cannot be combined with ${flag}.`
      )
    }
  }

  const contextLines =
    command.getOptionValueSource('context') === 'default'
      ? REACHABILITY_SOURCE_DEFAULT_CONTEXT
      : options.context
  if (contextLines < 0) {
    throw new Error(`--context must be a non-negative integer (0 to ${MAX_CONTEXT_LINES}).`)
  }

  const resolved = readIndexManifest(options.index)
  const artifact = loadFrontendReachabilityArtifact(options.index)
  const result = buildReachabilitySourceResult({
    artifact,
    mode: reachabilityMode.mode,
    query: reachabilityMode.query,
    indexDir: options.index,
    projectRoot: resolved.manifest.projectRoot,
    contextLines,
    maxLines: options.maxLines,
  })

  const wantsJson = options.json || options.format === 'json'
  if (wantsJson) {
    const rendered = JSON.stringify(result, null, 2) + '\n'
    if (options.out) {
      const writtenPath = writeSourceOutput(options.out, rendered)
      console.log(`Wrote reachability source result to ${writtenPath}`)
      return
    }
    process.stdout.write(rendered)
    return
  }

  const rendered = renderReachabilitySourceText(result)
  if (options.out) {
    const writtenPath = writeSourceOutput(options.out, rendered)
    console.log(`Wrote reachability source to ${writtenPath}`)
    return
  }
  process.stdout.write(rendered)
}

function renderReachabilitySourceText(result: ReachabilitySourceResult): string {
  const lines: string[] = []
  lines.push(`Reachability source (${result.mode}): ${result.query}`)
  lines.push(`Status: ${result.status}`)
  for (const warning of result.warnings) lines.push(`Warning: ${warning}`)
  for (const block of result.blocks) {
    lines.push('')
    lines.push(`# ${block.factKind} ${block.label} (${block.confidence}) - ${block.factId}`)
    lines.push(`${block.filePath}:${block.startLine}-${block.endLine}`)
    lines.push(block.content)
  }
  return lines.join('\n') + '\n'
}

function readFileLineCount(absolutePath: string): number {
  const raw = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/)
  return raw.length > 0 && raw[raw.length - 1] === '' ? raw.length - 1 : raw.length
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

interface SourceCommandOptions {
  index: string
  node?: string
  route?: string
  storageKey?: string
  ui?: string
  androidRoute?: string
  resource?: string
  composable?: string
  includeComposeTree?: boolean
  androidUi?: string
  testTag?: string
  file?: string
  start?: number
  end?: number
  symbol?: string
  includeLocalComponentTree?: boolean
  prop?: string
  contains?: string
  context: number
  path?: string
  reactRegion?: string
  maxLines: number
  format?: string
  out?: string
  json?: boolean
  continueFrom?: number
  continue?: boolean
  includeImports?: boolean
  includeLocalTypes?: boolean
  includeProps?: boolean
  includeLocalComponents?: boolean
  includeLocalDeps?: boolean
  expandToLocalDependencies?: boolean
  maxBundleLines?: number
  maxBlocks?: number
}

function resolveFormat(options: SourceCommandOptions): SourceOutputFormat | undefined {
  if (options.json && options.format !== undefined && options.format !== 'json') {
    throw new Error(`--json and --format ${options.format} cannot be used together. Use --format json or omit --json.`)
  }
  if (options.json) return 'json'
  if (options.format !== undefined) return parseSourceOutputFormat(options.format)
  return undefined
}

const BUNDLE_FLAGS = ['includeImports', 'includeLocalTypes', 'includeProps', 'includeLocalComponents', 'includeLocalDeps', 'expandToLocalDependencies'] as const

function hasBundleFlags(options: SourceCommandOptions): boolean {
  return (
    options.includeImports === true ||
    options.includeLocalTypes === true ||
    options.includeProps === true ||
    options.includeLocalComponents === true ||
    options.includeLocalDeps === true ||
    options.expandToLocalDependencies === true
  )
}

function selectMode(options: SourceCommandOptions): 'node' | 'line-range' | 'symbol' | 'exact-match' | 'react-region' | 'local-component-tree' | 'continue-from' | 'node-continue' | 'symbol-continue' | 'source-bundle' {
  const hasContains = options.contains !== undefined
  const hasReactRegion = options.reactRegion !== undefined
  const hasLocalComponentTree = options.includeLocalComponentTree === true
  const hasNode = options.node !== undefined
  const hasSymbol = options.symbol !== undefined
  const hasStartEnd = options.start !== undefined || options.end !== undefined
  const hasContinueFrom = options.continueFrom !== undefined
  const hasContinue = options.continue === true

  if (hasContinue && hasContinueFrom) {
    throw new Error('--continue and --continue-from cannot be used together.')
  }

  if (hasContinue) {
    if (!hasNode && !hasSymbol) throw new Error('--continue requires --node or --file --symbol.')
    if (hasNode) {
      if (hasSymbol || hasStartEnd || hasContains || hasReactRegion || hasLocalComponentTree) {
        throw new Error('--node --continue cannot be combined with --file, --symbol, --start, --end, --contains, or --react-region.')
      }
      return 'node-continue'
    }
    if (!options.file) throw new Error('--file --symbol --continue requires --file.')
    if (hasNode || hasStartEnd || hasContains || hasReactRegion || hasLocalComponentTree) {
      throw new Error('--file --symbol --continue cannot be combined with --node, --start, --end, --contains, or --react-region.')
    }
    return 'symbol-continue'
  }

  if (hasContinueFrom) {
    if (hasNode) throw new Error('--continue-from cannot be combined with --node.')
    if (!options.file) throw new Error('--continue-from requires --file <path>.')
    if (hasContains) throw new Error('--continue-from cannot be combined with --contains.')
    if (hasReactRegion) throw new Error('--continue-from cannot be combined with --react-region.')
    if (hasLocalComponentTree) throw new Error('--continue-from cannot be combined with --include-local-component-tree.')
    if (hasStartEnd) throw new Error('--continue-from cannot be combined with --start or --end.')
    return 'continue-from'
  }

  if (!hasLocalComponentTree && options.prop !== undefined) {
    throw new Error('--prop is only valid with --include-local-component-tree.')
  }

  if (hasLocalComponentTree) {
    if (!hasSymbol) throw new Error('--include-local-component-tree requires --symbol <component>.')
    if (hasContains) throw new Error('--include-local-component-tree cannot be combined with --contains.')
    if (hasReactRegion) throw new Error('--include-local-component-tree cannot be combined with --react-region.')
    if (hasNode) throw new Error('--include-local-component-tree cannot be combined with --node.')
    if (hasStartEnd) throw new Error('--include-local-component-tree cannot be combined with --start or --end.')
    return 'local-component-tree'
  }

  if (hasReactRegion && hasContains) throw new Error('--react-region cannot be combined with --contains.')
  if (hasReactRegion && hasNode) throw new Error('--react-region cannot be combined with --node.')
  if (hasReactRegion && hasSymbol) throw new Error('--react-region cannot be combined with --symbol.')
  if (hasReactRegion && hasStartEnd) throw new Error('--react-region cannot be combined with --start or --end.')
  if (hasReactRegion) {
    if (!options.file) throw new Error('--react-region requires --file <path>.')
    return 'react-region'
  }

  if (hasContains && hasNode) throw new Error('--contains cannot be combined with --node.')
  if (hasContains && hasSymbol) throw new Error('--contains cannot be combined with --symbol.')
  if (hasContains && hasStartEnd) throw new Error('--contains cannot be combined with --start or --end.')
  if (hasContains && options.file !== undefined) throw new Error('--contains cannot be combined with --file. Use --contains alone to search all indexed files.')
  if (hasContains && hasBundleFlags(options)) throw new Error('Bundle flags cannot be combined with --contains.')
  if (!hasContains && options.path !== undefined) throw new Error('--path is only valid when combined with --contains.')
  if (hasContains) return 'exact-match'

  const hasRange = options.file !== undefined || hasStartEnd
  if (hasNode && (hasRange || hasSymbol)) throw new Error('Use only one source mode: --node, --file with --start/--end, or --file with --symbol.')
  if (!hasNode && !hasRange && !hasSymbol) throw new Error('Provide one source mode: --node, --file with --start/--end, or --file with --symbol.')

  // Bundle mode: any bundle flag present
  if (hasBundleFlags(options)) {
    if (hasContains) throw new Error('Bundle flags cannot be combined with --contains.')
    if (hasReactRegion) throw new Error('Bundle flags cannot be combined with --react-region.')
    if (hasLocalComponentTree) throw new Error('Bundle flags cannot be combined with --include-local-component-tree.')
    if (!hasNode && !hasSymbol && !hasStartEnd) throw new Error('Bundle flags require a target: --node, --file --symbol, or --file --start --end.')
    return 'source-bundle'
  }

  if (hasNode) return 'node'
  if (hasSymbol) {
    if (!options.file) throw new Error('Symbol mode requires --file <path> and --symbol <name>.')
    if (hasStartEnd) throw new Error('Do not mix --symbol with --start/--end.')
    return 'symbol'
  }
  if (!options.file) throw new Error('Line range mode requires --file <path>.')
  if (options.start === undefined) throw new Error('--start is required when --end is provided.')
  if (options.end === undefined) throw new Error('--end is required when --start is provided.')
  return 'line-range'
}
