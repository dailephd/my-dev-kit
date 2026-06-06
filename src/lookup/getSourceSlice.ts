import * as fs from 'node:fs'
import * as path from 'node:path'
import { toForwardSlash } from '../io/pathUtils.js'
import type { SourceSlice, SourceSliceMode } from './sourceSliceTypes.js'

export function ensureInsideProjectRoot(projectRoot: string, filePath: string): string {
  const root = path.resolve(projectRoot)
  const resolved = path.resolve(root, filePath)
  const relative = path.relative(root, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`File path escapes the indexed project root: ${filePath}`)
  }
  return resolved
}

export function getSourceSlice(options: {
  indexDir: string
  projectRoot: string
  filePath: string
  startLine: number
  endLine: number
  maxLines: number
  mode: SourceSliceMode
  symbolName?: string | null
  semanticRoles?: SourceSlice['semanticRoles']
  artifactRefs?: SourceSlice['artifactRefs']
  evidenceRefs?: SourceSlice['evidenceRefs']
  warnings?: string[]
}): SourceSlice {
  validateLineRange(options.startLine, options.endLine, options.maxLines)
  const absolutePath = ensureInsideProjectRoot(options.projectRoot, options.filePath)
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`Source file does not exist: ${options.filePath}`)
  }

  const lines = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/)
  if (options.startLine > lines.length) {
    throw new Error(`Start line ${options.startLine} is beyond the end of file ${options.filePath}.`)
  }
  const endLine = Math.min(options.endLine, lines.length)
  const content = lines.slice(options.startLine - 1, endLine).join('\n')

  return {
    status: 'ok',
    mode: options.mode,
    indexDir: options.indexDir,
    filePath: toForwardSlash(options.filePath),
    absolutePath: toForwardSlash(absolutePath),
    symbolName: options.symbolName ?? null,
    startLine: options.startLine,
    endLine,
    lineCount: endLine - options.startLine + 1,
    content,
    semanticRoles: emptyToUndefined(options.semanticRoles),
    artifactRefs: emptyToUndefined(options.artifactRefs),
    evidenceRefs: emptyToUndefined(options.evidenceRefs),
    warnings: options.warnings ?? [],
  }
}

function emptyToUndefined<T>(values: T[] | undefined): T[] | undefined {
  return values && values.length > 0 ? values : undefined
}

export function validateLineRange(startLine: number, endLine: number, maxLines: number): void {
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
    throw new Error('Start and end lines must be positive integers.')
  }
  if (startLine < 1 || endLine < 1) throw new Error('Start and end lines must be positive integers.')
  if (startLine > endLine) throw new Error('Start line must be less than or equal to end line.')
  if (!Number.isInteger(maxLines) || maxLines < 1) throw new Error('Max lines must be a positive integer.')
  const requested = endLine - startLine + 1
  if (requested > maxLines) {
    throw new Error(`Requested source slice has ${requested} lines, which exceeds --max-lines ${maxLines}.`)
  }
}
