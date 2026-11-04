/**
 * Conservative, deterministic static Kotlin extractor (v1.9.0 Batch 2).
 *
 * Line-based scanning with a brace-depth counter — not a Kotlin compiler or
 * a real grammar-based parser. Only top-level declarations (depth 0) become
 * symbols, exactly matching how the TypeScript adapter only visits
 * `sourceFile`'s direct children (`ts.forEachChild`) and the Python adapter
 * only walks `tree.body`: neither language extracts class members as
 * separate symbol-index entries today, so Kotlin member functions/properties
 * are not either — inventing a member-symbol model for Kotlin alone would be
 * a parallel, inconsistent architecture rather than reuse of the existing
 * one. Modifiers, receiver types, `suspend`, and `Flow`/`StateFlow` usage
 * are all surfaced through the existing `signature` text field (capped at
 * 120 chars, same as every other language) rather than new dedicated
 * fields — the same choice the Python adapter already made for decorators.
 *
 * Known conservative-parser limitations (documented, not defects): braces
 * inside string/template literals can perturb depth tracking; only
 * single-line `//` comments and single-line-opening `/* ... *\/` block
 * comments are stripped reliably; nested (e.g. companion object) and member
 * declarations are not extracted as symbols; call-graph extraction is not
 * implemented (Kotlin's trailing-lambda call syntax makes regex-based call
 * detection too unreliable to be worth the false-positive risk).
 */

import type { LanguageAdapter, ExtractionResult } from '../types.js'
import type { SymbolDefinition, SymbolKind } from '../../symbol-index/types.js'
import { auditCapabilityMap, type SourceAuditExtractionPayload } from '../../symbol-index/auditObservations.js'
import type { SourceAuditFact, SourceAuditSpan } from '../../symbol-index/auditEvidenceTypes.js'

const MODIFIER_KEYWORDS = new Set([
  'public',
  'private',
  'protected',
  'internal',
  'open',
  'final',
  'abstract',
  'sealed',
  'data',
  'inner',
  'annotation',
  'value',
  'expect',
  'actual',
  'external',
  'override',
  'lateinit',
  'const',
  'suspend',
  'operator',
  'infix',
  'tailrec',
  'crossinline',
  'noinline',
  'reified',
  'vararg',
  'inline',
  'fun',
  'enum',
  'companion',
])

const CLASS_LIKE_PATTERN = /\b(class|interface|object)\s+([A-Za-z_]\w*)/
const ENUM_CLASS_PATTERN = /\benum\s+class\b/
const FUNCTION_PATTERN = /\bfun\s+(?:<[^>]*>\s*)?(?:([A-Za-z_][\w.<>?]*)\.)?([A-Za-z_]\w*)\s*\(/
const PROPERTY_PATTERN = /\b(val|var)\s+(?:<[^>]*>\s*)?(?:([A-Za-z_][\w.<>?]*)\.)?([A-Za-z_]\w*)\s*[:=]/
const PACKAGE_PATTERN = /^package\s+([\w.]+)/
const IMPORT_PATTERN = /^import\s+([\w.*]+)/
const PRIVATE_MODIFIER_PATTERN = /\bprivate\b/

const SIGNATURE_MAX_LENGTH = 120

interface LineScanState {
  depth: number
  inBlockComment: boolean
  pendingAnnotations: string[]
}

function stripLineComment(line: string): string {
  const index = line.indexOf('//')
  return index === -1 ? line : line.slice(0, index)
}

/** Handles only block comments that open and close within the scan (a `/* ... *\/` fully containing multiple lines is tracked via `inBlockComment`, not parsed token-by-token). */
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

function countNetBraces(line: string): number {
  let net = 0
  for (const char of line) {
    if (char === '{') net += 1
    else if (char === '}') net -= 1
  }
  return net
}

function buildSignature(state: LineScanState, trimmedLine: string): string {
  const parts = [...state.pendingAnnotations, trimmedLine]
  return parts.join(' ').slice(0, SIGNATURE_MAX_LENGTH)
}

function classifyClassLikeKind(line: string, keyword: string): SymbolKind {
  if (keyword === 'interface') return 'interface'
  if (keyword === 'object') return 'object'
  if (ENUM_CLASS_PATTERN.test(line)) return 'enum'
  return 'class'
}

/**
 * Extracts the file's package declaration, if any. Kept as a standalone
 * function (rather than a new `ExtractionResult`/`FileSummary` field,
 * neither of which has a natural slot for it) so it stays independently
 * testable; nothing in the shared cross-language artifact model currently
 * represents a per-file "package" concept the way it does `imports`.
 */
export function parseKotlinPackageName(sourceText: string): string | null {
  for (const rawLine of sourceText.split('\n')) {
    const trimmed = stripLineComment(rawLine).trim()
    if (trimmed.length === 0) continue
    const match = trimmed.match(PACKAGE_PATTERN)
    if (match) return match[1]
    if (!trimmed.startsWith('@') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')) return null
  }
  return null
}

/** Strict form of a nested declaration line: only modifiers may precede the class-like keyword. */
const NESTED_DECLARATION_PATTERN = /^((?:(?:public|protected|private|internal|open|final|abstract|sealed|data|inner|annotation|value|expect|actual|external|enum|fun)\s+)*)(class|interface|object)\s+([A-Za-z_]\w*)/
const COMPANION_PATTERN = /^((?:(?:public|protected|private|internal)\s+)*)companion\s+object(?:\s+([A-Za-z_]\w*))?/
const ANNOTATION_PREFIX_PATTERN = /^(?:@[\w.]+(?:\([^)]*\))?\s*)+/
const LITERAL_PATTERN = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g
const CONTINUATION_PATTERN = /^(?::|,|\)|<|where\b)/

type KotlinVisibility = 'public' | 'internal' | 'protected' | 'private'

interface KotlinScope {
  name: string
  keyword: string
  bodyDepth: number
  qualified: string
  effectivelyPublic: boolean | null
}

interface PendingKotlinScope extends Omit<KotlinScope, 'bodyDepth'> {
  depth: number
  parens: number
}

function netBy(line: string, open: string, close: string): number {
  let net = 0
  for (const char of line) {
    if (char === open) net += 1
    else if (char === close) net -= 1
  }
  return net
}

function literalBraceImbalance(line: string): boolean {
  for (const literal of line.match(LITERAL_PATTERN) ?? []) {
    if (countNetBraces(literal) !== 0) return true
  }
  return false
}

function explicitKotlinVisibility(head: string): KotlinVisibility | null {
  const modifiers = head.replace(ANNOTATION_PREFIX_PATTERN, '')
  const match = modifiers.match(/\b(public|internal|protected|private)\b/)
  return match ? (match[1] as KotlinVisibility) : null
}

function kotlinSpan(filePath: string, line: number): SourceAuditSpan {
  // The lexical scanner establishes line starts only; columns and end ranges are unknown, never guessed.
  return { path: filePath, startLine: line, startColumn: null, endLine: null, endColumn: null }
}

export function extractKotlinSource(filePath: string, sourceText: string): ExtractionResult {
  const rawLines = sourceText.split('\n')
  const lineCount = rawLines.length
  const isScript = filePath.toLowerCase().endsWith('.kts')

  const imports: string[] = []
  const symbols: SymbolDefinition[] = []
  const exports: string[] = []
  const topFacts: SourceAuditFact[] = []
  const nestedFacts: SourceAuditFact[] = []
  const uncertain = new Map<string, string>()
  const scopes: KotlinScope[] = []
  const hold: { pending: PendingKotlinScope | null } = { pending: null }
  const seenQualified = new Set<string>()

  const state: LineScanState = { depth: 0, inBlockComment: false, pendingAnnotations: [] }
  const base = { id: '', extractionMethod: 'kotlin-lexical' as const }

  // Kotlin declarations without a modifier are public; scripts have a different top-level scope, so they stay unknown.
  const implicitVisibility = (scope: KotlinScope | null): SourceAuditFact['visibility'] => (scope === null && isScript ? 'unknown' : 'public')
  // Script-owner accessibility is not a qualified external API boundary.
  // Keep explicit nonpublic evidence, but do not turn a public modifier on
  // a script member into a known ordinary compilation-unit export.
  const topExportState = (visibility: SourceAuditFact['visibility']): boolean | null =>
    visibility === 'unknown' || isScript && visibility === 'public' ? null : visibility === 'public'

  const declarationFacts = (
    target: SourceAuditFact[],
    lineNumber: number,
    name: string,
    kind: SymbolKind,
    visibility: SourceAuditFact['visibility'],
    exported: boolean | null,
    ownerKey: string | null,
    symbolId: string,
  ): void => {
    target.push({
      ...base, kind: 'declaration', span: kotlinSpan(filePath, lineNumber), name, symbolId, declarationKind: kind, ownerKey,
      visibility, exported, exportOrigin: exported === null || visibility === 'unknown' ? 'unknown' : 'visibility-inferred',
    })
    if (exported === true) {
      target.push({ ...base, kind: 'export', span: kotlinSpan(filePath, lineNumber), name, exportOrigin: 'visibility-inferred', visibility, exported: true, ...(symbolId ? { symbolId } : {}) })
    }
  }

  const openScope = (next: PendingKotlinScope, depthAfter: number, hasBrace: boolean): void => {
    if (depthAfter > next.depth) {
      if (depthAfter - next.depth !== 1) uncertain.set('multiple-braces-on-declaration-line', 'More than one scope opened at a class-like declaration.')
      const { depth, parens: _parens, ...scope } = next
      scopes.push({ ...scope, bodyDepth: depth + 1 })
    } else if (!hasBrace) {
      hold.pending = next
    }
  }

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i]
    const lineNumber = i + 1

    let line = rawLine
    if (state.inBlockComment) {
      const end = line.indexOf('*/')
      if (end === -1) continue
      line = line.slice(end + 2)
      state.inBlockComment = false
    }

    line = stripBlockCommentSpans(line)
    const openBlockStart = line.indexOf('/*')
    if (openBlockStart !== -1) {
      line = line.slice(0, openBlockStart)
      state.inBlockComment = true
    }
    line = stripLineComment(line)

    const trimmed = line.trim()
    const depthBeforeLine = state.depth
    state.depth += countNetBraces(line)

    if (trimmed.length === 0) continue

    if (isScript && (trimmed.startsWith('#!') || trimmed.startsWith('@file:'))) {
      uncertain.set('kotlin-script-directive', 'Script directives and file annotations are outside the explicit declaration profile.')
    }
    if (isScript && (line.includes(';') || (line.match(/\b(?:class|interface|object)\b/g)?.length ?? 0) > 1)) {
      uncertain.set('kotlin-script-multiple-statements', 'Multiple or inline script declarations cannot be enumerated by the line profile.')
    }
    if (line.includes('"""')) uncertain.set('raw-string-literal', 'A raw string literal can hide braces from the depth scanner.')
    if (literalBraceImbalance(line)) uncertain.set('brace-in-literal', 'A string or character literal contains an unbalanced brace that can corrupt scope depth.')

    while (scopes.length > 0 && depthBeforeLine < scopes[scopes.length - 1]!.bodyDepth) scopes.pop()

    const waiting = hold.pending
    if (waiting) {
      if (isScript && waiting.parens > 0) uncertain.set('kotlin-script-multiline-declaration', 'A multiline script declaration header is outside the explicit line profile.')
      waiting.parens += netBy(line, '(', ')')
      if (waiting.parens <= 0 && !CONTINUATION_PATTERN.test(trimmed) && !trimmed.startsWith('{') && depthBeforeLine === waiting.depth) {
        // A body-less declaration (for example a data class) ends where a non-continuation line begins.
        hold.pending = null
      } else if (state.depth > waiting.depth) {
        hold.pending = null
        openScope(waiting, state.depth, true)
      } else if (line.includes('{')) {
        hold.pending = null
      }
    }

    if (depthBeforeLine === 0) {
      if (PACKAGE_PATTERN.test(trimmed)) continue

      const importMatch = trimmed.match(IMPORT_PATTERN)
      if (importMatch) {
        imports.push(importMatch[1])
        const segments = importMatch[1].split('.')
        topFacts.push({
          ...base, kind: 'import', span: kotlinSpan(filePath, lineNumber), sourceSpecifier: importMatch[1],
          importedNames: [segments[segments.length - 1]!], importResolution: 'observed',
        })
        continue
      }
    }

    if (trimmed.startsWith('@')) {
      state.pendingAnnotations.push(trimmed)
      continue
    }

    if (depthBeforeLine === 0) {
      const classMatch = trimmed.match(CLASS_LIKE_PATTERN)
      const functionMatch = trimmed.match(FUNCTION_PATTERN)
      const propertyMatch = trimmed.match(PROPERTY_PATTERN)

      const topLevel = (name: string, kind: SymbolKind, matchIndex: number): void => {
        const exported = !PRIVATE_MODIFIER_PATTERN.test(trimmed)
        symbols.push({
          name,
          kind,
          location: { file: filePath, line: lineNumber },
          exported,
          signature: buildSignature(state, trimmed),
        })
        if (exported) exports.push(name)
        const explicit = explicitKotlinVisibility(trimmed.slice(0, matchIndex))
        const visibility: SourceAuditFact['visibility'] = explicit ?? implicitVisibility(null)
        declarationFacts(topFacts, lineNumber, name, kind, visibility, topExportState(visibility), null, '')
        state.pendingAnnotations = []
      }

      if (classMatch) {
        const [, keyword, name] = classMatch
        const kind = classifyClassLikeKind(trimmed, keyword)
        topLevel(name, kind, classMatch.index ?? 0)
        const visibility = explicitKotlinVisibility(trimmed.slice(0, classMatch.index ?? 0)) ?? implicitVisibility(null)
        openScope(
          { name, keyword, depth: depthBeforeLine, parens: netBy(line, '(', ')'), qualified: name, effectivelyPublic: topExportState(visibility) },
          state.depth,
          line.includes('{'),
        )
        continue
      }

      if (functionMatch) {
        topLevel(functionMatch[2], 'function', functionMatch.index ?? 0)
        continue
      }

      if (propertyMatch) {
        topLevel(propertyMatch[3], propertyMatch[1] === 'val' ? 'const' : 'variable', propertyMatch.index ?? 0)
        continue
      }
      if (isScript) uncertain.set('kotlin-script-statement', 'An executable or unrecognized top-level script statement is outside the explicit declaration profile.')
    } else if (scopes.length > 0 && depthBeforeLine === scopes[scopes.length - 1]!.bodyDepth) {
      const owner = scopes[scopes.length - 1]!
      const companion = trimmed.match(COMPANION_PATTERN)
      const strict = companion ? null : trimmed.match(NESTED_DECLARATION_PATTERN)
      if (companion || strict) {
        const head = (companion ? companion[1] : strict![1]) ?? ''
        const keyword = companion ? 'companion' : strict![2]!
        const name = companion ? (companion[2] ?? 'Companion') : strict![3]!
        const kind = companion ? 'object' : classifyClassLikeKind(trimmed, keyword)
        const qualified = `${owner.qualified}.${name}`
        if (seenQualified.has(qualified)) uncertain.set('duplicate-nested-declaration', 'Two nested declarations share one lexical path.')
        seenQualified.add(qualified)
        const visibility = explicitKotlinVisibility(head) ?? 'public'
        const effectivelyPublic = visibility === 'public' ? owner.effectivelyPublic : false
        const chain = scopes.map((scope) => `${scope.keyword}:${scope.name}`).join('/')
        declarationFacts(
          nestedFacts, lineNumber, name, kind, visibility, effectivelyPublic, `kotlin/${chain}`,
          `audit-symbol:${encodeURIComponent(filePath)}#${encodeURIComponent(qualified)}`,
        )
        openScope(
          { name, keyword, depth: depthBeforeLine, parens: netBy(line, '(', ')'), qualified, effectivelyPublic },
          state.depth,
          line.includes('{'),
        )
      } else if (CLASS_LIKE_PATTERN.test(trimmed)) {
        uncertain.set('unrecognized-nested-declaration', 'A member line mentions a class-like keyword in a form the scanner cannot classify.')
      }
    }

    state.pendingAnnotations = []
  }

  if (state.depth !== 0) uncertain.set('unbalanced-braces', 'Brace depth did not return to zero at the end of the file.')
  if (state.inBlockComment) uncertain.set('unterminated-block-comment', 'A block comment was not closed.')

  const capabilities = auditCapabilityMap('unsupported')
  const diagnostics: SourceAuditExtractionPayload['diagnostics'] = []
  const settled = uncertain.size === 0
  capabilities.declarations = settled ? 'complete' : 'partial'
  capabilities.imports = settled ? 'complete' : 'partial'
  capabilities.exports = 'partial'
  capabilities['source-ranges'] = 'partial'
  diagnostics.push({ code: 'lexical-line-ranges', message: 'The lexical scanner records declaration start lines only; columns and end ranges are unknown.', span: null })
  diagnostics.push({ code: 'visibility-inferred-exports', message: 'Kotlin exports are inferred from explicit or default visibility and do not reflect module boundaries.', span: null })
  if (isScript) diagnostics.push({ code: 'kotlin-script-visibility-unknown', message: 'Explicit script declarations are enumerated lexically; implicit script-owner accessibility remains unknown and is not an ordinary compilation-unit export claim.', span: null })
  for (const [code, message] of [...uncertain].sort(([a], [b]) => (a < b ? -1 : 1))) diagnostics.push({ code, message, span: null })
  // Nested facts are published only when the lexical nesting is certain.
  const facts = settled ? [...topFacts, ...nestedFacts] : topFacts

  return {
    sourceAudit: { facts, capabilities, diagnostics },
    language: 'kotlin',
    lineCount,
    imports: dedupe(imports),
    exports: dedupe(exports),
    symbols,
    reExportSpecifiers: [],
    exportAllSpecifiers: [],
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

/**
 * Resolves a Kotlin import specifier to a local file using the common
 * single-top-level-declaration-per-file convention: `com.example.foo.Bar`
 * maps to `<sourceRoot-relative>/com/example/foo/Bar.kt`. Kotlin does not
 * enforce file-name-matches-declaration-name the way Java does, so this is
 * a best-effort heuristic, not guaranteed resolution — a project that
 * groups multiple top-level declarations per file, or a wildcard import,
 * correctly resolves to `null` rather than guessing.
 */
export function resolveKotlinImportToFile(specifier: string, _importingFile: string, knownFiles: readonly string[]): string | null {
  if (specifier.endsWith('.*')) return null
  const parts = specifier.split('.')
  if (parts.length < 2) return null
  const packageDir = parts.slice(0, -1).join('/')
  const symbolName = parts.at(-1)
  const candidateSuffix = `${packageDir}/${symbolName}.kt`
  return knownFiles.find((file) => file === candidateSuffix || file.endsWith(`/${candidateSuffix}`)) ?? null
}

export class KotlinAdapter implements LanguageAdapter {
  readonly extensions = ['.kt', '.kts'] as const
  readonly supportsCallGraph = false

  extractFromSource(filePath: string, sourceText: string): ExtractionResult {
    return extractKotlinSource(filePath, sourceText)
  }

  resolveImportToFile(specifier: string, importingFile: string, knownFiles: readonly string[]): string | null {
    return resolveKotlinImportToFile(specifier, importingFile, knownFiles)
  }
}
