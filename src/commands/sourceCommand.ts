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
import { parseInteger } from './parseUtils.js'

export function registerSourceCommand(program: Command): void {
  program
    .command('source')
    .description('Retrieve bounded source from an indexed project.')
    .option('--index <dir>', 'index artifact directory', '.my-dev-kit-v1')
    .option('--node <node-id>', 'node id to retrieve source for')
    .option('--file <path>', 'file path')
    .option('--start <n>', 'start line', parseInteger)
    .option('--end <n>', 'end line', parseInteger)
    .option('--symbol <name>', 'symbol name')
    .option('--max-lines <n>', 'maximum returned lines', parseInteger, 160)
    .option('--format <json|plain|numbered>', 'output format')
    .option('--out <path>', 'write output to file')
    .option('--json', 'print JSON output (alias for --format json)')
    .action((options: SourceCommandOptions) => {
      const format = resolveFormat(options)
      const mode = selectMode(options)
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

interface SourceCommandOptions {
  index: string
  node?: string
  file?: string
  start?: number
  end?: number
  symbol?: string
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

function selectMode(options: SourceCommandOptions): 'node' | 'line-range' | 'symbol' {
  const hasNode = options.node !== undefined
  const hasRange = options.file !== undefined || options.start !== undefined || options.end !== undefined
  const hasSymbol = options.symbol !== undefined
  if (hasNode && (hasRange || hasSymbol)) throw new Error('Use only one source mode: --node, --file with --start/--end, or --file with --symbol.')
  if (!hasNode && !hasRange && !hasSymbol) throw new Error('Provide one source mode: --node, --file with --start/--end, or --file with --symbol.')
  if (hasNode) return 'node'
  if (hasSymbol) {
    if (!options.file) throw new Error('Symbol mode requires --file <path> and --symbol <name>.')
    if (options.start !== undefined || options.end !== undefined) throw new Error('Do not mix --symbol with --start/--end.')
    return 'symbol'
  }
  if (!options.file) throw new Error('Line range mode requires --file <path>.')
  if (options.start === undefined) throw new Error('--start is required when --end is provided.')
  if (options.end === undefined) throw new Error('--end is required when --start is provided.')
  return 'line-range'
}
