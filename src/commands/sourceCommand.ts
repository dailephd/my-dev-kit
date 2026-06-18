import * as fs from 'node:fs'
import type { Command } from 'commander'
import { loadSourceArtifacts } from '../indexing/loadIndexArtifacts.js'
import { getSourceSlice } from '../lookup/getSourceSlice.js'
import { resolveFileNodeTarget, resolveSymbolTarget } from '../lookup/resolveSourceTarget.js'
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
import type { ResolvedIndexManifest } from '../indexing/readIndexManifest.js'

export function registerSourceCommand(program: Command): void {
  program
    .command('source')
    .description('Retrieve bounded source from an indexed project.')
    .option('--index <dir>', 'index artifact directory', '.my-dev-kit')
    .option('--node <node-id>', 'node id to retrieve source for')
    .option('--file <path>', 'file path')
    .option('--start <n>', 'start line', parseInteger)
    .option('--end <n>', 'end line', parseInteger)
    .option('--symbol <name>', 'symbol name')
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
    .option('--format <json|plain|numbered>', 'output format')
    .option('--out <path>', 'write output to file')
    .option('--json', 'print JSON output (alias for --format json)')
    .action((options: SourceCommandOptions) => {
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
        warnings: target.warnings,
      })

      if (format === undefined) {
        if (options.out) {
          const rendered = renderSourceOutput(result, 'plain')
          const writtenPath = writeSourceOutput(options.out, rendered)
          console.log(`Wrote plain source to ${writtenPath}`)
        } else {
          console.log(`${result.filePath}:${result.startLine}-${result.endLine}`)
          if (result.warnings.length > 0) console.log(`Warnings: ${result.warnings.join('; ')}`)
          console.log(result.content)
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
  file?: string
  start?: number
  end?: number
  symbol?: string
  contains?: string
  context: number
  path?: string
  reactRegion?: string
  maxLines: number
  format?: string
  out?: string
  json?: boolean
}

function resolveFormat(options: SourceCommandOptions): SourceOutputFormat | undefined {
  if (options.json && options.format !== undefined && options.format !== 'json') {
    throw new Error(`--json and --format ${options.format} cannot be used together. Use --format json or omit --json.`)
  }
  if (options.json) return 'json'
  if (options.format !== undefined) return parseSourceOutputFormat(options.format)
  return undefined
}

function selectMode(options: SourceCommandOptions): 'node' | 'line-range' | 'symbol' | 'exact-match' | 'react-region' {
  const hasContains = options.contains !== undefined
  const hasReactRegion = options.reactRegion !== undefined
  const hasNode = options.node !== undefined
  const hasSymbol = options.symbol !== undefined
  const hasStartEnd = options.start !== undefined || options.end !== undefined

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
  if (!hasContains && options.path !== undefined) throw new Error('--path is only valid when combined with --contains.')
  if (hasContains) return 'exact-match'

  const hasRange = options.file !== undefined || hasStartEnd
  if (hasNode && (hasRange || hasSymbol)) throw new Error('Use only one source mode: --node, --file with --start/--end, or --file with --symbol.')
  if (!hasNode && !hasRange && !hasSymbol) throw new Error('Provide one source mode: --node, --file with --start/--end, or --file with --symbol.')
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
