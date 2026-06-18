import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import { toForwardSlash } from '../io/pathUtils.js'
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
}): ExactMatchResult {
  const { value, projectRoot, symbolIndex, frontendArtifact } = options
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
    const absPath = nodePath.resolve(projectRoot, file.path)

    let rawContent: string
    try {
      rawContent = fs.readFileSync(absPath, 'utf8')
    } catch {
      continue
    }

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
  }
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
        nearestOwner: semanticEntry?.nearestOwner,
        warnings: [],
      })

      pos = idx + value.length
    }
  }

  return matches
}
