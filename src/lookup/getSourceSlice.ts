import * as fs from 'node:fs'
import * as path from 'node:path'
import { toForwardSlash } from '../io/pathUtils.js'
import type { ContinuationCursor, SourceSlice, SourceSliceMode } from './sourceSliceTypes.js'

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
  symbolBoundaryKnown?: boolean
  targetId?: string
  semanticRoles?: SourceSlice['semanticRoles']
  artifactRefs?: SourceSlice['artifactRefs']
  evidenceRefs?: SourceSlice['evidenceRefs']
  classificationRoles?: SourceSlice['classificationRoles']
  classificationRefs?: SourceSlice['classificationRefs']
  classificationSummary?: SourceSlice['classificationSummary']
  warnings?: string[]
}): SourceSlice {
  validateLineRange(options.startLine, options.endLine, options.maxLines)
  const absolutePath = ensureInsideProjectRoot(options.projectRoot, options.filePath)
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`Source file does not exist: ${options.filePath}`)
  }

  const rawLines = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/)
  // Standard text files end with \n, which produces a trailing empty string — don't count it as a line.
  const lines = rawLines.length > 0 && rawLines[rawLines.length - 1] === '' ? rawLines.slice(0, -1) : rawLines
  if (options.startLine > lines.length) {
    throw new Error(`Start line ${options.startLine} is beyond the end of file ${options.filePath}.`)
  }
  const endLine = Math.min(options.endLine, lines.length)
  const content = lines.slice(options.startLine - 1, endLine).join('\n')

  const filePath = toForwardSlash(options.filePath)
  const symbolBoundaryKnown = options.symbolBoundaryKnown ?? (options.mode === 'line-range')
  const cursor = buildContinuationCursor({
    filePath,
    endLine,
    fileLineCount: lines.length,
    targetKind: options.mode,
    targetId: options.targetId,
    symbolName: options.symbolName,
    maxLines: options.maxLines,
    symbolBoundaryKnown,
  })

  return {
    status: 'ok',
    mode: options.mode,
    indexDir: options.indexDir,
    filePath,
    absolutePath: toForwardSlash(absolutePath),
    symbolName: options.symbolName ?? null,
    startLine: options.startLine,
    endLine,
    lineCount: endLine - options.startLine + 1,
    content,
    semanticRoles: emptyToUndefined(options.semanticRoles),
    artifactRefs: emptyToUndefined(options.artifactRefs),
    evidenceRefs: emptyToUndefined(options.evidenceRefs),
    classificationRoles: emptyToUndefined(options.classificationRoles),
    classificationRefs: emptyToUndefined(options.classificationRefs),
    ...(options.classificationSummary !== undefined ? { classificationSummary: options.classificationSummary } : {}),
    warnings: options.warnings ?? [],
    continuationCursor: cursor,
  }
}

export function buildContinuationCursor(options: {
  filePath: string
  endLine: number
  fileLineCount: number
  targetKind: string
  targetId?: string
  symbolName?: string | null
  maxLines: number
  symbolBoundaryKnown: boolean
  warnings?: string[]
  fallbackReason?: string
}): ContinuationCursor {
  const nextStartLine = options.endLine + 1
  const eof = nextStartLine > options.fileLineCount
  let reason: ContinuationCursor['reason']
  if (eof) {
    reason = 'eof'
  } else if (!options.symbolBoundaryKnown) {
    reason = 'symbol-end-unknown'
  } else {
    reason = 'window-capped'
  }
  return {
    filePath: options.filePath,
    nextStartLine,
    previousEndLine: options.endLine,
    targetKind: options.targetKind,
    targetId: options.targetId,
    symbolName: options.symbolName ?? null,
    maxLines: options.maxLines,
    eof,
    symbolBoundaryKnown: options.symbolBoundaryKnown,
    reason,
    warnings: options.warnings ?? [],
    fallbackReason: options.fallbackReason,
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
