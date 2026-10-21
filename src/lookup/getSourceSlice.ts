import * as fs from 'node:fs'
import * as path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { toForwardSlash } from '../io/pathUtils.js'
import type { ContinuationCursor, SourceSlice, SourceSliceMode } from './sourceSliceTypes.js'

export class UnsafeSourceError extends Error {}

// The command supplies the current persisted inventory lazily, after option validation.
const sourceAuthority = new AsyncLocalStorage<(root: string, file: string) => void>()
export function withSourceAuthority<T>(authorize: (root: string, file: string) => void, action: () => T): T {
  return sourceAuthority.run(authorize, action)
}

function contained(root: string, file: string): boolean {
  const relative = path.relative(root, file)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export function ensureInsideProjectRoot(projectRoot: string, filePath: string): string {
  const root = path.resolve(projectRoot)
  const resolved = path.resolve(root, filePath)
  const relative = path.relative(root, resolved)
  if (!contained(root, resolved) || filePath.includes('\0')) {
    throw new UnsafeSourceError('File path escapes the indexed project root.')
  }
  sourceAuthority.getStore()?.(root, toForwardSlash(relative))
  try {
    const physicalRoot = fs.realpathSync(root)
    const physicalFile = fs.realpathSync(resolved)
    if (!contained(physicalRoot, physicalFile)) throw new UnsafeSourceError('Physical source path is outside the indexed project root; unsafe symlink or junction.')
    if (!fs.statSync(physicalFile).isFile()) throw new UnsafeSourceError('Source target must be a regular file.')
  } catch (error) {
    if (error instanceof UnsafeSourceError) throw error
    // Existing index consumers resolve missing paths to emit their own diagnostics.
    // The actual source reader below always resolves again and fails before any read.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return resolved
    throw new UnsafeSourceError('Source file is missing, unreadable, or has an unresolved symlink. Re-index the selected source.')
  }
  return resolved
}

/** Read the verified physical file through a descriptor, checking identity before releasing bytes.
 * These checks detect substitutions; they are not an atomic filesystem sandbox.
 */
export function readSourceText(projectRoot: string, filePath: string): string {
  const lexical = ensureInsideProjectRoot(projectRoot, filePath)
  let descriptor: number | undefined
  try {
    const root = fs.realpathSync(projectRoot)
    const physical = fs.realpathSync(lexical)
    if (!contained(root, physical)) throw new UnsafeSourceError('Physical source path is outside the indexed project root.')
    const expected = fs.statSync(physical)
    descriptor = fs.openSync(physical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    const before = fs.fstatSync(descriptor)
    const same = (a: fs.Stats, b: fs.Stats) => a.isFile() && b.isFile() && a.ino !== 0 && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs
    if (!same(expected, before) || fs.realpathSync(lexical) !== physical || fs.realpathSync(projectRoot) !== root) throw new UnsafeSourceError('Unsafe source substitution; retry after re-indexing.')
    const text = fs.readFileSync(descriptor, 'utf8')
    if (!same(before, fs.fstatSync(descriptor)) || !same(before, fs.statSync(physical)) || fs.realpathSync(lexical) !== physical || fs.realpathSync(projectRoot) !== root) throw new UnsafeSourceError('Unsafe source substitution; retry after re-indexing.')
    return text
  } catch (error) {
    if (error instanceof UnsafeSourceError) throw error
    throw new UnsafeSourceError('Source file is missing, unreadable, or has an unsafe unresolved symlink. Re-index the selected source.')
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
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
  /** Validated indexed symbol end line; bounds the window and suppresses cursors into later declarations. */
  symbolEndLine?: number
  targetId?: string
  semanticRoles?: SourceSlice['semanticRoles']
  artifactRefs?: SourceSlice['artifactRefs']
  evidenceRefs?: SourceSlice['evidenceRefs']
  classificationRoles?: SourceSlice['classificationRoles']
  classificationRefs?: SourceSlice['classificationRefs']
  classificationSummary?: SourceSlice['classificationSummary']
  androidComponentRoles?: SourceSlice['androidComponentRoles']
  androidComponentRefs?: SourceSlice['androidComponentRefs']
  warnings?: string[]
}): SourceSlice {
  validateLineRange(options.startLine, options.endLine, options.maxLines)
  const absolutePath = ensureInsideProjectRoot(options.projectRoot, options.filePath)
  const rawLines = readSourceText(options.projectRoot, options.filePath).split(/\r?\n/)
  // Standard text files end with \n, which produces a trailing empty string — don't count it as a line.
  const lines = rawLines.length > 0 && rawLines[rawLines.length - 1] === '' ? rawLines.slice(0, -1) : rawLines
  if (options.symbolEndLine !== undefined) assertSymbolSpanPresent(options.filePath, options.symbolEndLine, lines.length)
  if (options.startLine > lines.length) {
    throw new Error(`Start line ${options.startLine} is beyond the end of file ${options.filePath}.`)
  }
  const symbolEndLine = options.symbolEndLine
  const endLine = Math.min(options.endLine, lines.length, symbolEndLine ?? Number.POSITIVE_INFINITY)
  const content = lines.slice(options.startLine - 1, endLine).join('\n')

  const filePath = toForwardSlash(options.filePath)
  const symbolBoundaryKnown = symbolEndLine !== undefined ? true : (options.symbolBoundaryKnown ?? (options.mode === 'line-range'))
  // A known symbol that is fully returned has no continuation: the rest of the file is a different declaration.
  const cursor =
    symbolEndLine !== undefined && endLine >= symbolEndLine
      ? undefined
      : buildContinuationCursor({
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
    androidComponentRoles: emptyToUndefined(options.androidComponentRoles),
    androidComponentRefs: emptyToUndefined(options.androidComponentRefs),
    warnings: options.warnings ?? [],
    ...(cursor ? { continuationCursor: cursor } : {}),
  }
}

/**
 * A parser-derived symbol end describes the indexed snapshot. If the current file is shorter than that
 * span, the index no longer matches the source and a "complete symbol" claim would be false.
 */
export function assertSymbolSpanPresent(filePath: string, symbolEndLine: number, fileLineCount: number): void {
  if (fileLineCount < symbolEndLine) {
    throw new Error(
      `Stale index/source mismatch: ${filePath} has ${fileLineCount} lines but the indexed symbol ends at line ${symbolEndLine}. Re-run the index.`
    )
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
