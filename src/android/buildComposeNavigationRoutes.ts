/**
 * Narrow, bounded static extraction of AndroidX Navigation Compose route
 * evidence (v1.10.0 Batch 4). Deliberately not a Compose semantic analyzer:
 * it recognizes exactly the builder-call shapes named in the batch contract
 * (`composable(...)`, `navigation(...)`, `dialog(...)`, `activity(...)`,
 * `NavHost(...)`'s `startDestination`), resolves only direct string
 * literals and same-file `const val` string constants, and never evaluates
 * interpolation, concatenation, function calls, or cross-file data flow.
 *
 * Runs over already-indexed Kotlin files (reusing `symbolIndex` for the
 * file list and for approximating each route's enclosing top-level symbol)
 * with a small, bounded re-read of each file's raw text — the same pattern
 * `detectAndroidComponents.ts` (v1.9.0 Batch 4) already established for
 * evidence that isn't captured by `symbol-index.json` alone.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { FileSummary, SymbolIndex } from '../symbol-index/types.js'
import type { AndroidProjectArtifact } from './androidProjectTypes.js'
import type {
  AndroidComposeRoute,
  AndroidComposeScreenCandidate,
  AndroidNavigationSourceRef,
  ComposeNavigationBuilder,
  ComposeRouteEvidenceKind,
} from './androidNavigationTypes.js'

export interface BuildComposeNavigationRoutesOptions {
  projectRoot: string
  symbolIndex: SymbolIndex
  androidProject: AndroidProjectArtifact
}

export interface BuildComposeNavigationRoutesResult {
  routes: AndroidComposeRoute[]
  screenCandidates: AndroidComposeScreenCandidate[]
  warnings: string[]
}

const MAX_SCAN_LINES = 2000

const BUILDER_CALL_PATTERN = /\b(composable|navigation|dialog|activity)\s*(?:<\s*([\w.]+)\s*>)?\s*\(/g
const NAV_HOST_PATTERN = /\bNavHost\s*\(/g
const CONST_VAL_PATTERN = /(?:^|\s)(?:private\s+|internal\s+|public\s+)?const\s+val\s+(\w+)\s*(?::\s*String)?\s*=\s*"((?:[^"\\]|\\.)*)"/g

export function buildComposeNavigationRoutes(options: BuildComposeNavigationRoutesOptions): BuildComposeNavigationRoutesResult {
  const { projectRoot, symbolIndex, androidProject } = options
  const routes: AndroidComposeRoute[] = []
  const screenCandidates: AndroidComposeScreenCandidate[] = []
  const warnings: string[] = []

  if (!androidProject.detected) {
    return { routes, screenCandidates, warnings }
  }

  for (const file of symbolIndex.files) {
    if (file.language !== 'kotlin' && file.language !== 'java') continue
    const text = readFile(projectRoot, file.path)
    if (text === null) continue

    const lines = text.split('\n')
    const truncated = lines.length > MAX_SCAN_LINES
    const scanText = truncated ? lines.slice(0, MAX_SCAN_LINES).join('\n') : text
    if (truncated) warnings.push(`${file.path}: Compose route scan bounded to the first ${MAX_SCAN_LINES} lines.`)

    if (!/\bcomposable\s*[(<]|\bnavigation\s*\(|\bdialog\s*\(|\bNavHost\s*\(/.test(scanText)) continue

    const constants = collectStringConstants(scanText)
    const moduleInfo = resolveModuleAndSourceSet(file.path, androidProject)

    let routeIndex = 0
    const emitRoute = (
      builder: ComposeNavigationBuilder,
      matchIndex: number,
      typeArgName: string | undefined,
      argsText: string,
      lambdaBody: string | null
    ) => {
      const routeId = `android-navigation-compose-route:${file.path}#${routeIndex}`
      routeIndex++
      const source = sourceRefAt(file.path, scanText, matchIndex)
      const enclosingSymbol = findEnclosingSymbol(file, lineNumberAt(scanText, matchIndex))

      let evidenceKind: ComposeRouteEvidenceKind
      let rawRouteExpression: string | null = null
      let resolvedRoute: string | null = null
      let typeRouteName: string | null = null
      const routeWarnings: string[] = []

      if (typeArgName) {
        evidenceKind = 'type-safe-route'
        typeRouteName = typeArgName
      } else {
        const routeArg = extractRouteArgument(argsText)
        if (routeArg === null) {
          evidenceKind = 'unresolved-recognized-call'
          routeWarnings.push(`No statically recognizable route argument for this ${builder} call.`)
        } else {
          rawRouteExpression = routeArg
          const literal = parseStringLiteral(routeArg)
          if (literal !== null) {
            evidenceKind = 'string-route'
            resolvedRoute = literal
          } else if (/^[A-Za-z_]\w*$/.test(routeArg) && constants.has(routeArg)) {
            evidenceKind = 'resolved-local-constant-route'
            resolvedRoute = constants.get(routeArg)!
          } else {
            evidenceKind = 'unresolved-recognized-call'
            routeWarnings.push(`Route expression "${routeArg}" is not a direct string literal or a resolvable local const val.`)
          }
        }
      }

      const screenCandidateIds: string[] = []
      if (lambdaBody !== null) {
        const candidate = detectDirectScreenCandidate(lambdaBody, routeId, file.path, matchIndex, scanText)
        if (candidate) {
          screenCandidates.push(candidate)
          screenCandidateIds.push(candidate.id)
        }
      }

      routes.push({
        id: routeId,
        evidenceKind,
        builder,
        rawRouteExpression,
        resolvedRoute,
        typeRouteName,
        moduleId: moduleInfo.moduleId,
        sourceSet: moduleInfo.sourceSet,
        file: file.path,
        enclosingSymbol,
        source,
        screenCandidateIds: screenCandidateIds.sort(),
        warnings: routeWarnings,
      })
    }

    for (const match of scanText.matchAll(BUILDER_CALL_PATTERN)) {
      const builder = match[1] as ComposeNavigationBuilder
      const typeArgName = match[2]
      const parenOpenIndex = match.index! + match[0].length - 1
      const argsEnd = findMatchingParen(scanText, parenOpenIndex)
      if (argsEnd === -1) continue
      const argsText = scanText.slice(parenOpenIndex + 1, argsEnd)
      const lambdaBody = extractFollowingLambdaBody(scanText, argsEnd + 1)
      emitRoute(builder, match.index!, typeArgName, argsText, lambdaBody)
    }

    for (const match of scanText.matchAll(NAV_HOST_PATTERN)) {
      const parenOpenIndex = match.index! + match[0].length - 1
      const argsEnd = findMatchingParen(scanText, parenOpenIndex)
      if (argsEnd === -1) continue
      const argsText = scanText.slice(parenOpenIndex + 1, argsEnd)
      const startDestMatch = /startDestination\s*=\s*("(?:[^"\\]|\\.)*"|[A-Za-z_]\w*)/.exec(argsText)
      if (!startDestMatch) continue
      const raw = startDestMatch[1]!
      const literal = parseStringLiteral(raw)
      const routeId = `android-navigation-compose-route:${file.path}#${routeIndex}`
      routeIndex++
      const source = sourceRefAt(file.path, scanText, match.index!)
      const enclosingSymbol = findEnclosingSymbol(file, lineNumberAt(scanText, match.index!))
      const resolvedFromConst = literal === null && /^[A-Za-z_]\w*$/.test(raw) ? constants.get(raw) ?? null : null

      routes.push({
        id: routeId,
        evidenceKind: literal !== null ? 'string-route' : resolvedFromConst !== null ? 'resolved-local-constant-route' : 'unresolved-recognized-call',
        builder: 'nav-host-start-destination',
        rawRouteExpression: raw,
        resolvedRoute: literal ?? resolvedFromConst,
        typeRouteName: null,
        moduleId: moduleInfo.moduleId,
        sourceSet: moduleInfo.sourceSet,
        file: file.path,
        enclosingSymbol,
        source,
        screenCandidateIds: [],
        warnings: literal === null && resolvedFromConst === null ? [`NavHost startDestination "${raw}" is not a direct string literal or a resolvable local const val.`] : [],
      })
    }
  }

  return {
    routes: sortById(routes),
    screenCandidates: sortById(screenCandidates),
    warnings: [...new Set(warnings)].sort(),
  }
}

/**
 * Reused as-is by `buildAndroidComposeSemanticProject.ts` (v1.11.0 Batch 3)
 * for `navigate(...)` call-site route-argument extraction, so Compose
 * call-site route evidence stays classified with exactly the same rules as
 * `composable(...)`/`navigation(...)`/`dialog(...)` route definitions here —
 * never a second, independently-drifting route-expression resolver.
 */
export function extractRouteArgument(argsText: string): string | null {
  const trimmed = argsText.trim()
  if (trimmed === '') return null

  const namedRoute = /(?:^|,)\s*route\s*=\s*("(?:[^"\\]|\\.)*"|[A-Za-z_]\w*)/.exec(argsText)
  if (namedRoute) return namedRoute[1]!.trim()

  // Bare first positional argument, e.g. composable("home") — only when it
  // isn't itself a named parameter (`arguments = ...`, `navController = ...`).
  const firstArgEnd = findTopLevelCommaOrEnd(argsText)
  const firstArg = argsText.slice(0, firstArgEnd).trim()
  if (firstArg === '' || firstArg.includes('=')) return null
  return firstArg
}

function findTopLevelCommaOrEnd(text: string): number {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (ch === ',' && depth === 0) return i
  }
  return text.length
}

/** Reused by `buildAndroidComposeSemanticProject.ts` (v1.11.0 Batch 3) for navigation-call route-literal parsing. */
export function parseStringLiteral(token: string): string | null {
  const match = /^"((?:[^"\\]|\\.)*)"$/.exec(token.trim())
  if (!match) return null
  const inner = match[1]!
  if (inner.includes('${')) return null // template interpolation is never resolved
  return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

/** Reused by `buildAndroidComposeSemanticProject.ts` (v1.11.0 Batch 3) so navigate(...) same-file `const val` route-constant resolution matches this artifact's existing rules exactly. */
export function collectStringConstants(text: string): Map<string, string> {
  const constants = new Map<string, string>()
  for (const match of text.matchAll(CONST_VAL_PATTERN)) {
    const name = match[1]
    const value = match[2]
    if (name && value !== undefined) constants.set(name, value)
  }
  return constants
}

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

function extractFollowingLambdaBody(text: string, fromIndex: number): string | null {
  let i = fromIndex
  while (i < text.length && /\s/.test(text[i]!)) i++
  if (text[i] !== '{') return null
  let depth = 1
  const bodyStart = i + 1
  i++
  for (; i < text.length && depth > 0; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') depth--
  }
  if (depth !== 0) return null
  return text.slice(bodyStart, i - 1)
}

const CONTROL_FLOW_PATTERN = /\b(if|when|for|while|try)\b/

function detectDirectScreenCandidate(
  lambdaBody: string,
  routeId: string,
  filePath: string,
  callMatchIndex: number,
  fullText: string
): AndroidComposeScreenCandidate | null {
  const trimmed = lambdaBody.trim()
  if (trimmed === '') return null
  if (CONTROL_FLOW_PATTERN.test(trimmed)) return null

  const callMatch = /^([A-Z][A-Za-z0-9_]*)\s*\(/.exec(trimmed)
  if (!callMatch) return null
  const parenOpenIndex = callMatch[0].length - 1
  const callEnd = findMatchingParen(trimmed, parenOpenIndex)
  if (callEnd === -1) return null
  // The call (plus an optional trailing lambda) must be the entire body —
  // otherwise multiple statements exist and ownership is ambiguous.
  let rest = trimmed.slice(callEnd + 1).trim()
  if (rest.startsWith('{')) {
    const trailingLambdaEnd = extractFollowingLambdaBody(rest, 0)
    if (trailingLambdaEnd === null) return null
    const closeIdx = findMatchingBraceFromStart(rest)
    rest = closeIdx === -1 ? '' : rest.slice(closeIdx + 1).trim()
  }
  if (rest !== '') return null

  return {
    id: `${routeId}#screen-candidate:0`,
    routeId,
    calledScreenName: callMatch[1]!,
    symbolId: null,
    source: sourceRefAt(filePath, fullText, callMatchIndex),
    evidenceBasis: 'direct-top-level-call-in-route-content-lambda',
    confidence: 'high',
    warnings: [],
  }
}

function findMatchingBraceFromStart(text: string): number {
  if (text[0] !== '{') return -1
  let depth = 1
  for (let i = 1; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function lineNumberAt(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++
  }
  return line
}

function sourceRefAt(filePath: string, text: string, index: number): AndroidNavigationSourceRef {
  let line = 1
  let lastNewline = -1
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') {
      line++
      lastNewline = i
    }
  }
  return { file: filePath, line, column: index - lastNewline }
}

function findEnclosingSymbol(file: FileSummary, line: number): string | null {
  let best: string | null = null
  let bestLine = -1
  for (const symbol of file.symbols) {
    if (symbol.location.line <= line && symbol.location.line > bestLine) {
      best = symbol.name
      bestLine = symbol.location.line
    }
  }
  return best
}

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

function sortById<T extends { id: string }>(values: T[]): T[] {
  return [...values].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function readFile(projectRoot: string, relPath: string): string | null {
  try {
    return fs.readFileSync(path.join(projectRoot, ...relPath.split('/')), 'utf8')
  } catch {
    return null
  }
}
