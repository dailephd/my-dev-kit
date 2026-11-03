import { createHash } from 'node:crypto'
import { readSourceText } from '../lookup/getSourceSlice.js'
import { toForwardSlash } from '../io/pathUtils.js'
import {
  readSourceAuditFileBytes,
  isCanonicalAuditRelativePath,
  SourceAuditEvidenceError,
} from '../lookup/readSourceAuditEvidence.js'
import { AUDIT_CONTENT_MAX_BYTES, SOURCE_AUDIT_SCHEMA_VERSION, type SourceAuditEvidenceArtifact } from '../symbol-index/auditEvidenceTypes.js'
import type { FrontendSemanticArtifact, FrontendFileResult } from '../frontend/frontendTypes.js'
import type { SymbolIndex } from '../symbol-index/types.js'

export type ExactMatchKind =
  | 'ui-string'
  | 'data-testid'
  | 'aria-label'
  | 'locator'
  | 'test-title'
  | 'route-like-string'
  | 'literal'
  | 'raw-text'

export type SemanticSource = 'semantic' | 'raw'

/** Conservative static classification of a match location. */
export type MatchClassification = 'declaration-like' | 'usage-like' | 'unknown'

export interface NearestOwner {
  kind: 'component' | 'test-block' | 'symbol'
  name: string
  id?: string
}

export interface ExactMatchWindow {
  /** 1-based line number of the match. */
  line: number
  /** 1-based column of the match start. */
  column: number
  windowStart: number
  windowEnd: number
  /** Source text of the context window (not the full file). */
  content: string
  matchKind: ExactMatchKind
  semanticSource: SemanticSource
  /** Conservative static classification of the match location. */
  classification: MatchClassification
  nearestOwner?: NearestOwner
  warnings: string[]
}

export interface FileMatches {
  filePath: string
  matchCount: number
  matches: ExactMatchWindow[]
}

export interface ExactMatchResult {
  value: string
  contextLines: number
  matchCount: number
  files: FileMatches[]
  warnings: string[]
  truncated: boolean
  limit: number
  pathFilter?: string
}

export const DEFAULT_CONTEXT_LINES = 3
export const MAX_CONTEXT_LINES = 40
export const MAX_TOTAL_MATCHES = 200

interface SemanticLineInfo {
  value: string
  kind: ExactMatchKind
  nearestOwner?: NearestOwner
}

type FileSemanticMap = Map<number, SemanticLineInfo[]>

export function findExactMatches(options: {
  value: string
  contextLines: number
  projectRoot: string
  symbolIndex: SymbolIndex
  frontendArtifact: FrontendSemanticArtifact | null
  pathFilter?: string
}): ExactMatchResult {
  const { value, projectRoot, symbolIndex, frontendArtifact, pathFilter } = options
  const contextLines = Math.min(Math.max(0, options.contextLines), MAX_CONTEXT_LINES)

  const globalSemanticMap = frontendArtifact
    ? buildGlobalSemanticMap(frontendArtifact, value)
    : new Map<string, FileSemanticMap>()

  const allFileMatches: FileMatches[] = []
  const warnings: string[] = []
  let totalMatches = 0
  let truncated = false

  for (const file of symbolIndex.files) {
    if (totalMatches >= MAX_TOTAL_MATCHES) {
      truncated = true
      break
    }

    const forwardPath = toForwardSlash(file.path)
    if (pathFilter && !forwardPath.startsWith(pathFilter)) continue
    const rawContent = readSourceText(projectRoot, file.path)

    const lines = rawContent.split(/\r?\n/)
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    const fileSemanticMap = globalSemanticMap.get(forwardPath) ?? new Map()
    const rawMatches = scanLinesForValue(lines, value, contextLines, fileSemanticMap)
    if (rawMatches.length === 0) continue

    const available = MAX_TOTAL_MATCHES - totalMatches
    const matches = rawMatches.length > available ? rawMatches.slice(0, available) : rawMatches
    if (rawMatches.length > available) truncated = true

    totalMatches += matches.length
    allFileMatches.push({
      filePath: forwardPath,
      matchCount: matches.length,
      matches,
    })
  }

  return {
    value,
    contextLines,
    matchCount: totalMatches,
    files: allFileMatches,
    warnings,
    truncated,
    limit: MAX_TOTAL_MATCHES,
    pathFilter: pathFilter ?? undefined,
  }
}

/** Maximum bytes of one selected file examined by an exact-file occurrence query. */
export const MAX_EXACT_FILE_SCAN_BYTES = AUDIT_CONTENT_MAX_BYTES

/** Raw literal-text occurrences in one selected file. Interpretation (imports, fixtures, policy) belongs to the consumer. */
export interface AuditFileOccurrenceResult {
  schemaVersion: '1.0.0'
  mode: 'exact-file-occurrence'
  snapshotId: string
  filePath: string
  value: string
  scannedBytes: number
  complete: boolean
  reasonCode: string | null
  matchCount: number
  returnedMatches: number
  truncated: boolean
  matches: Array<{ line: number; column: number; windowStart: number; windowEnd: number; content: string }>
}

/**
 * Exact literal-substring occurrences in ONE exact selected file of a verified source-audit artifact.
 * complete=true only when the file's recorded content hash matched the live bytes, the whole file was
 * valid UTF-8 within the scan limit, and the match list was not capped; anything else is complete=false
 * with a reasonCode, so a zero-match result is an absence proof only when complete. Stale, missing,
 * escaping or unselected files throw SourceAuditEvidenceError instead of returning a result.
 */
export function findExactFileOccurrences(options: {
  artifact: SourceAuditEvidenceArtifact
  filePath: string
  value: string
  contextLines: number
}): AuditFileOccurrenceResult {
  const { artifact, filePath, value } = options
  if (value.length === 0) throw new Error('--contains value must be a non-empty string.')
  if (value.includes('\n') || value.includes('\r')) throw new Error('An exact-file --contains value must not contain line breaks.')
  if (!isCanonicalAuditRelativePath(filePath)) {
    throw new SourceAuditEvidenceError('INVALID_AUDIT_PATH', 'The path must be a canonical, forward-slash, root-relative selected path without traversal.')
  }
  const file = artifact.files.find((candidate) => candidate.path === filePath)
  if (!file) throw new SourceAuditEvidenceError('INVALID_AUDIT_PATH', `"${filePath}" is not in the selected source-audit inventory.`)
  const contextLines = Math.min(Math.max(0, options.contextLines), MAX_CONTEXT_LINES)

  const result = (fields: Pick<AuditFileOccurrenceResult, 'scannedBytes' | 'complete' | 'reasonCode' | 'matchCount' | 'matches'>): AuditFileOccurrenceResult => ({
    schemaVersion: SOURCE_AUDIT_SCHEMA_VERSION,
    mode: 'exact-file-occurrence',
    snapshotId: artifact.source.snapshotId,
    filePath,
    value,
    returnedMatches: fields.matches.length,
    truncated: fields.matchCount > fields.matches.length,
    ...fields,
  })

  // Without a trusted content hash the bytes cannot be authenticated; nothing is read or claimed.
  if (file.contentSha256 === null) {
    return result({ scannedBytes: 0, complete: false, reasonCode: 'CONTENT_HASH_UNAVAILABLE', matchCount: 0, matches: [] })
  }
  // Rejects missing, replaced, changed and root-escaping files before any content is released.
  const jsonContent = file.path.toLowerCase().endsWith('.json')
  const bytes = readSourceAuditFileBytes(artifact, file, jsonContent ? MAX_EXACT_FILE_SCAN_BYTES : Infinity)
  const text = bytes.toString('utf8')
  const validUtf8 = createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex') === file.contentSha256 && (!jsonContent || !bytes.includes(0))
  const withinLimit = bytes.length <= MAX_EXACT_FILE_SCAN_BYTES
  const scanned = withinLimit ? text : bytes.subarray(0, MAX_EXACT_FILE_SCAN_BYTES).toString('utf8')

  const lines = scanned.split(/\r?\n/)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const all = scanLinesForValue(lines, value, contextLines, new Map())
  const matches = all.slice(0, MAX_TOTAL_MATCHES).map(({ line, column, windowStart, windowEnd, content }) => ({ line, column, windowStart, windowEnd, content }))
  const reasonCode = !validUtf8 ? 'FILE_NOT_VALID_UTF8' : !withinLimit ? 'FILE_EXCEEDS_SCAN_LIMIT' : all.length > matches.length ? 'MATCHES_TRUNCATED' : null
  return result({ scannedBytes: Math.min(bytes.length, MAX_EXACT_FILE_SCAN_BYTES), complete: reasonCode === null, reasonCode, matchCount: all.length, matches })
}

function buildGlobalSemanticMap(
  artifact: FrontendSemanticArtifact,
  targetValue: string
): Map<string, FileSemanticMap> {
  const globalMap = new Map<string, FileSemanticMap>()
  for (const fileResult of artifact.files) {
    const fileMap = buildFileSemanticMap(fileResult, targetValue)
    if (fileMap.size > 0) {
      globalMap.set(toForwardSlash(fileResult.filePath), fileMap)
    }
  }
  return globalMap
}

function buildFileSemanticMap(fileResult: FrontendFileResult, targetValue: string): FileSemanticMap {
  const map: FileSemanticMap = new Map()

  const componentById = new Map<string, string>()
  for (const c of fileResult.components) componentById.set(c.id, c.name)
  for (const c of fileResult.localComponents) componentById.set(c.id, c.name)

  const testBlockById = new Map<string, string>()
  for (const b of fileResult.testBlocks) {
    if (b.title) testBlockById.set(b.id, b.title)
  }

  function addEntry(line: number, entry: SemanticLineInfo): void {
    if (!map.has(line)) map.set(line, [])
    map.get(line)!.push(entry)
  }

  for (const uiStr of fileResult.uiStrings) {
    if (uiStr.value !== targetValue) continue
    const kind: ExactMatchKind =
      uiStr.kind === 'data-testid' ? 'data-testid'
        : uiStr.kind === 'aria-label' || uiStr.kind === 'aria-labelledby' ? 'aria-label'
          : 'ui-string'
    const owner: NearestOwner | undefined = uiStr.componentId
      ? { kind: 'component', name: componentById.get(uiStr.componentId) ?? uiStr.componentId, id: uiStr.componentId }
      : undefined
    addEntry(uiStr.sourceRef.line, { value: targetValue, kind, nearestOwner: owner })
  }

  for (const block of fileResult.testBlocks) {
    if (block.title !== targetValue) continue
    addEntry(block.sourceRef.line, {
      value: targetValue,
      kind: 'test-title',
      nearestOwner: { kind: 'test-block', name: block.title ?? '', id: block.id },
    })
  }

  for (const loc of fileResult.locators) {
    if (!loc.value || loc.value !== targetValue) continue
    const owner: NearestOwner | undefined = loc.testBlockId
      ? { kind: 'test-block', name: testBlockById.get(loc.testBlockId) ?? loc.testBlockId, id: loc.testBlockId }
      : undefined
    addEntry(loc.sourceRef.line, { value: targetValue, kind: 'locator', nearestOwner: owner })
  }

  for (const route of fileResult.routeStrings) {
    if (route.value !== targetValue) continue
    addEntry(route.sourceRef.line, { value: targetValue, kind: 'route-like-string' })
  }

  return map
}

function scanLinesForValue(
  lines: string[],
  value: string,
  contextLines: number,
  fileSemanticMap: FileSemanticMap
): ExactMatchWindow[] {
  const matches: ExactMatchWindow[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let pos = 0
    while (true) {
      const idx = line.indexOf(value, pos)
      if (idx === -1) break

      const lineNumber = i + 1
      const column = idx + 1

      const semanticInfos = fileSemanticMap.get(lineNumber)
      const semanticEntry = semanticInfos?.find((e) => e.value === value)

      const matchKind: ExactMatchKind = semanticEntry?.kind ?? 'raw-text'
      const semanticSource: SemanticSource = semanticEntry ? 'semantic' : 'raw'

      const windowStart = Math.max(1, lineNumber - contextLines)
      const windowEnd = Math.min(lines.length, lineNumber + contextLines)
      const content = lines.slice(windowStart - 1, windowEnd).join('\n')

      matches.push({
        line: lineNumber,
        column,
        windowStart,
        windowEnd,
        content,
        matchKind,
        semanticSource,
        classification: classifyMatch(line, column),
        nearestOwner: semanticEntry?.nearestOwner,
        warnings: [],
      })

      pos = idx + value.length
    }
  }

  return matches
}

/**
 * Conservative static classification of a match by its line context.
 * Checks text immediately before the match start (1-based column).
 */
export function classifyMatch(line: string, column: number): MatchClassification {
  const before = line.slice(0, column - 1)
  const trimmedRaw = before.trimEnd()
  // Strip the opening quote so patterns match the operator/keyword that precedes the literal
  const trimmed = /['"]$/.test(trimmedRaw) ? trimmedRaw.slice(0, -1).trimEnd() : trimmedRaw

  // Usage-like: comparison operators (===, !==, ==, !=)
  if (/[!=]==?\s*$/.test(trimmed)) return 'usage-like'

  // Usage-like: function call or array/spread argument
  if (/[,(]\s*$/.test(trimmed)) return 'usage-like'

  // Declaration-like: const/let/var/type keyword assignment
  if (/\b(const|let|var|type)\b.*=\s*$/.test(trimmed)) return 'declaration-like'

  // Usage-like: JSX attribute (attrName= without declaration keywords)
  if (/[a-zA-Z0-9_-]=\s*$/.test(trimmed)) return 'usage-like'

  // Declaration-like: object property value (key: '...' pattern)
  if (/:\s*$/.test(trimmed)) return 'declaration-like'

  return 'unknown'
}
