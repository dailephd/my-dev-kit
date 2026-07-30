/**
 * Conservative, deterministic static Compose declaration extractor (v1.11.0
 * Batch 1). Follows the same bounded, non-compiler scanning precedent as
 * `buildComposeNavigationRoutes.ts`: it re-reads already-indexed Kotlin
 * files' raw text, recognizes exactly the declaration shapes named in the
 * batch contract (top-level / private top-level / named function-local
 * `@Composable` functions, `@Preview` classification, direct exactly-resolved
 * child-composable calls, and a fixed set of structural UI-region calls),
 * and never claims support for anonymous composable lambdas, higher-order
 * function-returned composables, member composables inside classes/objects,
 * or dynamic dispatch. Unsupported-but-recognizable patterns degrade to a
 * stable warning rather than an invented declaration.
 *
 * Does not import from or modify `src/languages/kotlin/adapter.ts` — the
 * small brace/comment/string-handling primitives below are independently
 * duplicated, exactly as `buildComposeNavigationRoutes.ts` already does for
 * the same reason (the base Kotlin adapter is a separate, intentionally
 * conservative top-level-only symbol extractor, not a shared parsing
 * library).
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { toForwardSlash } from '../io/pathUtils.js'
import type { SymbolIndex } from '../symbol-index/types.js'
import type { AndroidProjectArtifact } from './androidProjectTypes.js'
import {
  ANDROID_COMPOSE_SEMANTIC_ARTIFACT_KIND,
  ANDROID_COMPOSE_SEMANTIC_SCHEMA_VERSION,
  type AndroidComposeSemanticArtifact,
  type BuildAndroidComposeSemanticProjectResult,
  type ComposeAnnotationEvidence,
  type ComposeChildCallEvidence,
  type ComposeDeclarationEntry,
  type ComposeDeclarationScope,
  type ComposeDeclarationVisibility,
  type ComposeParameterSummary,
  type ComposeSemanticSummary,
  type ComposeStructuralRegionEvidence,
  type ComposeStructuralRegionKind,
} from './androidComposeTypes.js'

export interface BuildAndroidComposeSemanticProjectOptions {
  projectRoot: string
  symbolIndex: SymbolIndex
  androidProject: AndroidProjectArtifact
  createdAt?: string
}

const MAX_SCAN_LINES = 2000
const SIGNATURE_MAX_LENGTH = 120

const STRUCTURAL_REGION_NAMES: readonly ComposeStructuralRegionKind[] = [
  'Scaffold',
  'LazyColumn',
  'LazyRow',
  'Column',
  'Row',
  'Box',
  'NavHost',
]

const FUNCTION_PATTERN_G = /\bfun\s+(?:<[^>]*>\s*)?(?:([A-Za-z_][\w.<>?]*)\.)?([A-Za-z_]\w*)\s*\(/g
const PRIVATE_MODIFIER_PATTERN = /\bprivate\b/
const INTERNAL_MODIFIER_PATTERN = /\binternal\b/
const COMPOSABLE_ANNOTATION_PATTERN = /^@(?:[\w]+\.)*Composable\b/
const PREVIEW_ANNOTATION_PATTERN = /^@(?:[\w]+\.)*Preview\b/
const CALL_CANDIDATE_PATTERN = /\b([A-Z][A-Za-z0-9_]*)\s*[({]/g
const STRING_LITERAL_PATTERN = /"(?:[^"\\\n]|\\.)*"/g

export function buildAndroidComposeSemanticProject(
  options: BuildAndroidComposeSemanticProjectOptions
): BuildAndroidComposeSemanticProjectResult {
  const { projectRoot, symbolIndex, androidProject, createdAt = new Date().toISOString() } = options

  if (!androidProject.detected) {
    return { artifact: emptyArtifact(projectRoot, createdAt) }
  }

  const kotlinFiles = symbolIndex.files
    .filter((file) => file.language === 'kotlin')
    .slice()
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  const allDeclarations: InternalDeclaration[] = []
  const fileWarnings: string[] = []
  const filesExamined: string[] = []

  for (const file of kotlinFiles) {
    const text = readFileSafely(projectRoot, file.path)
    if (text === null) continue
    filesExamined.push(file.path)
    const { declarations, warnings } = scanFileForComposeDeclarations(file.path, text, androidProject)
    allDeclarations.push(...declarations)
    fileWarnings.push(...warnings)
  }

  resolveChildCalls(allDeclarations)

  const declWarnings = allDeclarations.flatMap((d) => d.warnings)
  const publicDeclarations = allDeclarations.map(toPublicEntry).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const detected = publicDeclarations.length > 0
  const combinedWarnings = dedupeSort([...fileWarnings, ...declWarnings])

  const artifact: AndroidComposeSemanticArtifact = {
    artifactKind: ANDROID_COMPOSE_SEMANTIC_ARTIFACT_KIND,
    schemaVersion: ANDROID_COMPOSE_SEMANTIC_SCHEMA_VERSION,
    createdAt,
    projectRoot: toForwardSlash(projectRoot),
    detected,
    filesExamined: filesExamined.slice().sort(),
    declarations: detected ? publicDeclarations : [],
    warnings: combinedWarnings,
    summary: computeSummary(publicDeclarations, combinedWarnings),
  }

  return { artifact }
}

// ---------------------------------------------------------------------------
// Internal (transient) declaration model
// ---------------------------------------------------------------------------

interface InternalDeclaration {
  id: string
  name: string
  scope: ComposeDeclarationScope
  visibility: ComposeDeclarationVisibility
  isPreview: boolean
  enclosingDeclarationId: string | null
  annotations: ComposeAnnotationEvidence[]
  parameters: ComposeParameterSummary[]
  sourceRange: { file: string; startLine: number; endLine: number }
  moduleId: string | null
  sourceSet: string | null
  structuralRegions: ComposeStructuralRegionEvidence[]
  warnings: string[]
  file: string
  rawChildCallCandidates: Array<{ calleeName: string; line: number }>
  childCalls: ComposeChildCallEvidence[]
}

function toPublicEntry(d: InternalDeclaration): ComposeDeclarationEntry {
  return {
    id: d.id,
    name: d.name,
    kind: 'composable',
    scope: d.scope,
    visibility: d.visibility,
    isPreview: d.isPreview,
    enclosingDeclarationId: d.enclosingDeclarationId,
    annotations: d.annotations,
    parameters: d.parameters,
    sourceRange: d.sourceRange,
    moduleId: d.moduleId,
    sourceSet: d.sourceSet,
    childCalls: d.childCalls,
    structuralRegions: d.structuralRegions,
    warnings: d.warnings,
  }
}

// ---------------------------------------------------------------------------
// Per-file scan
// ---------------------------------------------------------------------------

function scanFileForComposeDeclarations(
  filePath: string,
  sourceText: string,
  androidProject: AndroidProjectArtifact
): { declarations: InternalDeclaration[]; warnings: string[] } {
  const warnings: string[] = []
  const rawLines = sourceText.split('\n')
  const truncated = rawLines.length > MAX_SCAN_LINES
  const lines = truncated ? rawLines.slice(0, MAX_SCAN_LINES) : rawLines
  if (truncated) warnings.push(`${filePath}: Compose declaration scan bounded to the first ${MAX_SCAN_LINES} lines.`)

  const stripState: StripState = { inBlockComment: false }
  const strippedLines = lines.map((raw) => stripLine(raw, stripState))
  const strippedText = strippedLines.join('\n')

  const depthBeforeLine: number[] = []
  let depth = 0
  for (const line of strippedLines) {
    depthBeforeLine.push(depth)
    depth += countNetBraces(line)
  }

  const annotationBlocks = collectAnnotationBlocks(strippedLines)
  const rawFunctionDecls = findFunctionDeclarations(strippedText)
  const functionDecls = assignDeclarationIds(rawFunctionDecls, filePath)
  const moduleInfo = resolveModuleAndSourceSet(filePath, androidProject)

  const declarations: InternalDeclaration[] = []

  for (const decl of functionDecls) {
    const annotations = annotationsPrecedingLine(annotationBlocks, strippedLines, decl.lineNumber)
    const hasComposable = annotations.some((a) => COMPOSABLE_ANNOTATION_PATTERN.test(a.raw))
    if (!hasComposable) continue

    const depthHere = depthBeforeLine[decl.lineNumber - 1] ?? 0
    const scope: ComposeDeclarationScope | null = depthHere === 0 ? 'top-level' : decl.enclosingId ? 'function-local' : null

    if (scope === null) {
      warnings.push(
        `${filePath}:${decl.lineNumber}: @Composable function "${decl.name}" is nested in an unsupported enclosing context and was not extracted.`
      )
      continue
    }

    if (decl.bodyKind === 'none') {
      warnings.push(
        `${filePath}:${decl.lineNumber}: @Composable function "${decl.name}" has no statically recognizable body and was not extracted.`
      )
      continue
    }

    const isPreview = annotations.some((a) => PREVIEW_ANNOTATION_PATTERN.test(a.raw))
    const visibility = visibilityFromLine(strippedLines[decl.lineNumber - 1] ?? '')
    const startLine = annotations.length > 0 ? annotations[0]!.startLine : decl.lineNumber
    const endLine = lineNumberAt(strippedText, decl.bodyEnd)
    const bodyText = strippedText.slice(decl.bodyStart, decl.bodyEnd)
    const bodyStartLine = lineNumberAt(strippedText, decl.bodyStart)
    const parameters = parseParameterList(strippedText.slice(decl.parenOpenIndex + 1, decl.paramsEnd))
    const structuralRegions = extractStructuralRegionCalls(bodyText, bodyStartLine)
    const rawChildCallCandidates = extractChildCallCandidates(bodyText, bodyStartLine)

    declarations.push({
      id: decl.id,
      name: decl.name,
      scope,
      visibility,
      isPreview,
      enclosingDeclarationId: decl.enclosingId,
      annotations: annotations.map((a) => ({ raw: a.raw.slice(0, SIGNATURE_MAX_LENGTH) })),
      parameters,
      sourceRange: { file: filePath, startLine, endLine },
      moduleId: moduleInfo.moduleId,
      sourceSet: moduleInfo.sourceSet,
      structuralRegions,
      warnings: [],
      file: filePath,
      rawChildCallCandidates,
      childCalls: [],
    })
  }

  return { declarations, warnings }
}

// ---------------------------------------------------------------------------
// Function-declaration discovery + identity assignment
// ---------------------------------------------------------------------------

interface FunctionDeclRecordRaw {
  name: string
  matchIndex: number
  parenOpenIndex: number
  paramsEnd: number
  bodyKind: 'block' | 'expression' | 'none'
  bodyStart: number
  bodyEnd: number
  lineNumber: number
}

interface FunctionDeclRecord extends FunctionDeclRecordRaw {
  id: string
  enclosingId: string | null
  chainNames: string[]
}

function findFunctionDeclarations(strippedText: string): FunctionDeclRecordRaw[] {
  const results: FunctionDeclRecordRaw[] = []
  for (const match of strippedText.matchAll(FUNCTION_PATTERN_G)) {
    const name = match[2]
    if (!name || match.index === undefined) continue
    const parenOpenIndex = match.index + match[0].length - 1
    const paramsEnd = findMatchingParen(strippedText, parenOpenIndex)
    if (paramsEnd === -1) continue

    const boundary = findBodyBoundary(strippedText, paramsEnd + 1)
    let bodyKind: 'block' | 'expression' | 'none' = 'none'
    let bodyStart = -1
    let bodyEnd = -1
    if (boundary.kind === 'block') {
      const closeIndex = findMatchingBrace(strippedText, boundary.index)
      if (closeIndex !== -1) {
        bodyKind = 'block'
        bodyStart = boundary.index + 1
        bodyEnd = closeIndex
      }
    } else if (boundary.kind === 'expression') {
      bodyKind = 'expression'
      bodyStart = boundary.index
      bodyEnd = findExpressionBodyEnd(strippedText, boundary.index)
    }

    results.push({
      name,
      matchIndex: match.index,
      parenOpenIndex,
      paramsEnd,
      bodyKind,
      bodyStart,
      bodyEnd,
      lineNumber: lineNumberAt(strippedText, match.index),
    })
  }
  return results
}

/**
 * Assigns every function declaration a deterministic id and, for nested
 * declarations, the id of its innermost textually-enclosing function
 * (composable or not — a non-Composable enclosing function still gets a
 * stable id so a nested composable's `enclosingDeclarationId` can reference
 * it, even though the enclosing function itself never appears in the
 * artifact's `declarations` array). Processed in matchIndex (document) order,
 * which guarantees an enclosing function's record already exists by the time
 * any function nested within its textual body is processed.
 */
function assignDeclarationIds(raws: FunctionDeclRecordRaw[], filePath: string): FunctionDeclRecord[] {
  const idCounts = new Map<string, number>()
  const result: FunctionDeclRecord[] = []
  for (const raw of raws) {
    const enclosing = findEnclosingFunction(result, raw.matchIndex)
    const chainNames = enclosing ? [...enclosing.chainNames, enclosing.name] : []
    const id = computeDeclarationId(filePath, chainNames, raw.name, idCounts)
    result.push({ ...raw, id, enclosingId: enclosing ? enclosing.id : null, chainNames })
  }
  return result
}

function findEnclosingFunction(candidates: readonly FunctionDeclRecord[], index: number): FunctionDeclRecord | null {
  let best: FunctionDeclRecord | null = null
  let bestSpan = Infinity
  for (const candidate of candidates) {
    if (candidate.bodyKind === 'none') continue
    if (candidate.bodyStart < index && index < candidate.bodyEnd) {
      const span = candidate.bodyEnd - candidate.bodyStart
      if (span < bestSpan) {
        bestSpan = span
        best = candidate
      }
    }
  }
  return best
}

function computeDeclarationId(filePath: string, chainNames: string[], name: string, idCounts: Map<string, number>): string {
  const chainPart = chainNames.length > 0 ? `${chainNames.join('>')}>` : ''
  const base = `android-compose-declaration:${filePath}#${chainPart}${name}`
  const count = idCounts.get(base) ?? 0
  idCounts.set(base, count + 1)
  return count === 0 ? base : `${base}#${count}`
}

// ---------------------------------------------------------------------------
// Child-call resolution (INV-003: exact same-file match only, never a guess)
// ---------------------------------------------------------------------------

function resolveChildCalls(allDeclarations: InternalDeclaration[]): void {
  const byFileAndName = new Map<string, InternalDeclaration[]>()
  for (const d of allDeclarations) {
    const key = `${d.file}::${d.name}`
    const list = byFileAndName.get(key)
    if (list) list.push(d)
    else byFileAndName.set(key, [d])
  }

  for (const d of allDeclarations) {
    for (const candidate of d.rawChildCallCandidates) {
      const key = `${d.file}::${candidate.calleeName}`
      const matches = (byFileAndName.get(key) ?? []).filter((m) => m !== d)
      if (matches.length === 1) {
        d.childCalls.push({ calleeDeclarationId: matches[0]!.id, calleeName: candidate.calleeName, line: candidate.line })
      } else if (matches.length > 1) {
        d.warnings.push(
          `Ambiguous child-composable call "${candidate.calleeName}" at line ${candidate.line}: multiple same-named declarations in this file; not recorded as a child-call edge.`
        )
      }
    }
    d.childCalls.sort((a, b) => a.line - b.line || a.calleeName.localeCompare(b.calleeName))
  }
}

// ---------------------------------------------------------------------------
// Body-content extraction (structural regions + child-call candidates)
// ---------------------------------------------------------------------------

function extractStructuralRegionCalls(bodyText: string, bodyStartLine: number): ComposeStructuralRegionEvidence[] {
  const results: ComposeStructuralRegionEvidence[] = []
  for (const kind of STRUCTURAL_REGION_NAMES) {
    const pattern = new RegExp(`\\b${kind}\\s*[({]`, 'g')
    for (const match of bodyText.matchAll(pattern)) {
      if (match.index === undefined) continue
      results.push({ kind, line: bodyStartLine + countNewlines(bodyText.slice(0, match.index)) })
    }
  }
  return results.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind))
}

function extractChildCallCandidates(bodyText: string, bodyStartLine: number): Array<{ calleeName: string; line: number }> {
  const results: Array<{ calleeName: string; line: number }> = []
  for (const match of bodyText.matchAll(CALL_CANDIDATE_PATTERN)) {
    const name = match[1]
    if (!name || match.index === undefined) continue
    if ((STRUCTURAL_REGION_NAMES as readonly string[]).includes(name)) continue
    results.push({ calleeName: name, line: bodyStartLine + countNewlines(bodyText.slice(0, match.index)) })
  }
  return results
}

function countNewlines(text: string): number {
  return (text.match(/\n/g) ?? []).length
}

// ---------------------------------------------------------------------------
// Annotation-block discovery
// ---------------------------------------------------------------------------

interface AnnotationBlock {
  raw: string
  startLine: number
  endLine: number
}

function collectAnnotationBlocks(strippedLines: string[]): AnnotationBlock[] {
  const blocks: AnnotationBlock[] = []
  let i = 0
  while (i < strippedLines.length) {
    const trimmed = strippedLines[i]!.trim()
    if (trimmed.startsWith('@')) {
      const startLine = i + 1
      const parts = [trimmed]
      let openParens = countChar(trimmed, '(') - countChar(trimmed, ')')
      let j = i
      while (openParens > 0 && j + 1 < strippedLines.length) {
        j++
        const next = strippedLines[j]!.trim()
        parts.push(next)
        openParens += countChar(next, '(') - countChar(next, ')')
      }
      blocks.push({ raw: parts.join(' '), startLine, endLine: j + 1 })
      i = j + 1
    } else {
      i++
    }
  }
  return blocks
}

function countChar(s: string, ch: string): number {
  let n = 0
  for (const c of s) if (c === ch) n++
  return n
}

/** Collects the contiguous run of annotation blocks immediately preceding `functionLine` (blank-line gaps allowed, any other content breaks the chain). */
function annotationsPrecedingLine(blocks: AnnotationBlock[], strippedLines: string[], functionLine: number): AnnotationBlock[] {
  const collected: AnnotationBlock[] = []
  let cursor = functionLine
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]!
    if (block.endLine >= cursor) continue
    let gapIsBlank = true
    for (let ln = block.endLine + 1; ln < cursor; ln++) {
      if ((strippedLines[ln - 1] ?? '').trim() !== '') {
        gapIsBlank = false
        break
      }
    }
    if (!gapIsBlank) break
    collected.unshift(block)
    cursor = block.startLine
  }
  return collected
}

// ---------------------------------------------------------------------------
// Parameter parsing
// ---------------------------------------------------------------------------

function parseParameterList(paramsText: string): ComposeParameterSummary[] {
  const trimmed = paramsText.trim()
  if (trimmed === '') return []
  const result: ComposeParameterSummary[] = []
  for (const segment of splitTopLevelByComma(trimmed)) {
    const s = segment.trim()
    if (s === '') continue
    const colonIndex = findTopLevelChar(s, ':')
    if (colonIndex === -1) {
      result.push({ name: s, typeText: null })
      continue
    }
    const name = s.slice(0, colonIndex).trim()
    const rest = s.slice(colonIndex + 1)
    const eqIndex = findTopLevelChar(rest, '=')
    const typeText = (eqIndex === -1 ? rest : rest.slice(0, eqIndex)).trim()
    result.push({ name, typeText: typeText === '' ? null : typeText })
  }
  return result
}

function splitTopLevelByComma(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of text) {
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth++
    else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current)
  return parts
}

function findTopLevelChar(text: string, target: string): number {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth++
    else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth = Math.max(0, depth - 1)
    else if (ch === target && depth === 0) return i
  }
  return -1
}

// ---------------------------------------------------------------------------
// Bounded text scanning primitives (paren/brace matching, body-boundary
// detection) -- independently duplicated from the equivalent conventions in
// buildComposeNavigationRoutes.ts and src/languages/kotlin/adapter.ts.
// ---------------------------------------------------------------------------

function findMatchingParen(text: string, openIndex: number): number {
  let depth = 1
  for (let i = openIndex + 1; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function findMatchingBrace(text: string, openIndex: number): number {
  let depth = 1
  for (let i = openIndex + 1; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Scans forward from just after a function's parameter list for its body start: the first top-level `{` (block body), `=` (expression body), or `;`/scan-limit (no statically recognizable body). Skips `<...>` generic return-type brackets. */
function findBodyBoundary(text: string, fromIndex: number): { kind: 'block' | 'expression' | 'none'; index: number } {
  let angleDepth = 0
  const limit = Math.min(text.length, fromIndex + 2000)
  for (let i = fromIndex; i < limit; i++) {
    const ch = text[i]
    if (ch === '<') {
      angleDepth++
      continue
    }
    if (ch === '>' && angleDepth > 0) {
      angleDepth--
      continue
    }
    if (angleDepth > 0) continue
    if (ch === '{') return { kind: 'block', index: i }
    if (ch === '=' && text[i + 1] !== '=') return { kind: 'expression', index: i + 1 }
    if (ch === ';') return { kind: 'none', index: i }
  }
  return { kind: 'none', index: fromIndex }
}

/** Bounded balanced-bracket scan for an expression body: ends at the first newline reached at bracket depth 0, or at an unexpected out-of-scope closing bracket (the enclosing construct's own close). */
function findExpressionBodyEnd(text: string, fromIndex: number): number {
  let depth = 0
  let i = fromIndex
  for (; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) break
      depth--
    } else if (ch === '\n' && depth === 0) break
  }
  return i
}

function countNetBraces(line: string): number {
  let net = 0
  for (const ch of line) {
    if (ch === '{') net++
    else if (ch === '}') net--
  }
  return net
}

function lineNumberAt(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++
  }
  return line
}

function visibilityFromLine(line: string): ComposeDeclarationVisibility {
  if (PRIVATE_MODIFIER_PATTERN.test(line)) return 'private'
  if (INTERNAL_MODIFIER_PATTERN.test(line)) return 'internal'
  return 'public'
}

// ---------------------------------------------------------------------------
// Comment / string-literal stripping (extends the base Kotlin adapter's
// comment-only stripping with single-line string-literal blanking, so
// annotation-like or brace-like text inside a string cannot be mistaken for
// real syntax; multi-line triple-quoted strings are a documented, not
// defect, limitation of this bounded scanner).
// ---------------------------------------------------------------------------

interface StripState {
  inBlockComment: boolean
}

function stripLine(rawLine: string, state: StripState): string {
  let line = stripStringLiterals(rawLine)
  if (state.inBlockComment) {
    const end = line.indexOf('*/')
    if (end === -1) return ''
    line = line.slice(end + 2)
    state.inBlockComment = false
  }
  line = stripBlockCommentSpans(line)
  const openBlockStart = line.indexOf('/*')
  if (openBlockStart !== -1) {
    line = line.slice(0, openBlockStart)
    state.inBlockComment = true
  }
  return stripLineComment(line)
}

function stripStringLiterals(line: string): string {
  return line.replace(STRING_LITERAL_PATTERN, '""')
}

function stripBlockCommentSpans(line: string): string {
  let result = line
  let start = result.indexOf('/*')
  while (start !== -1) {
    const end = result.indexOf('*/', start + 2)
    if (end === -1) break
    result = result.slice(0, start) + result.slice(end + 2)
    start = result.indexOf('/*')
  }
  return result
}

function stripLineComment(line: string): string {
  const index = line.indexOf('//')
  return index === -1 ? line : line.slice(0, index)
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface ModuleSourceSetInfo {
  moduleId: string | null
  sourceSet: string | null
}

function resolveModuleAndSourceSet(filePath: string, androidProject: AndroidProjectArtifact): ModuleSourceSetInfo {
  for (const module of androidProject.modules) {
    for (const sourceSet of module.sourceSets) {
      if (filePath === sourceSet.path || filePath.startsWith(`${sourceSet.path}/`)) {
        return { moduleId: module.id, sourceSet: sourceSet.name }
      }
    }
  }
  return { moduleId: null, sourceSet: null }
}

function readFileSafely(projectRoot: string, relPath: string): string | null {
  try {
    return fs.readFileSync(path.join(projectRoot, ...relPath.split('/')), 'utf8')
  } catch {
    return null
  }
}

function dedupeSort(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function computeSummary(declarations: ComposeDeclarationEntry[], warnings: string[]): ComposeSemanticSummary {
  return {
    declarationCount: declarations.length,
    previewCount: declarations.filter((d) => d.isPreview).length,
    topLevelCount: declarations.filter((d) => d.scope === 'top-level').length,
    functionLocalCount: declarations.filter((d) => d.scope === 'function-local').length,
    privateTopLevelCount: declarations.filter((d) => d.scope === 'top-level' && d.visibility === 'private').length,
    childCallCount: declarations.reduce((sum, d) => sum + d.childCalls.length, 0),
    structuralRegionCallCount: declarations.reduce((sum, d) => sum + d.structuralRegions.length, 0),
    warningCount: warnings.length,
  }
}

function emptyArtifact(projectRoot: string, createdAt: string): AndroidComposeSemanticArtifact {
  return {
    artifactKind: ANDROID_COMPOSE_SEMANTIC_ARTIFACT_KIND,
    schemaVersion: ANDROID_COMPOSE_SEMANTIC_SCHEMA_VERSION,
    createdAt,
    projectRoot: toForwardSlash(projectRoot),
    detected: false,
    filesExamined: [],
    declarations: [],
    warnings: [],
    summary: computeSummary([], []),
  }
}
