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

export function extractKotlinSource(filePath: string, sourceText: string): ExtractionResult {
  const rawLines = sourceText.split('\n')
  const lineCount = rawLines.length

  const imports: string[] = []
  const symbols: SymbolDefinition[] = []
  const exports: string[] = []

  const state: LineScanState = { depth: 0, inBlockComment: false, pendingAnnotations: [] }

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

    if (depthBeforeLine === 0) {
      if (PACKAGE_PATTERN.test(trimmed)) continue

      const importMatch = trimmed.match(IMPORT_PATTERN)
      if (importMatch) {
        imports.push(importMatch[1])
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

      if (classMatch) {
        const [, keyword, name] = classMatch
        const kind = classifyClassLikeKind(trimmed, keyword)
        const exported = !PRIVATE_MODIFIER_PATTERN.test(trimmed)
        symbols.push({
          name,
          kind,
          location: { file: filePath, line: lineNumber },
          exported,
          signature: buildSignature(state, trimmed),
        })
        if (exported) exports.push(name)
        state.pendingAnnotations = []
        continue
      }

      if (functionMatch) {
        const [, , name] = functionMatch
        const exported = !PRIVATE_MODIFIER_PATTERN.test(trimmed)
        symbols.push({
          name,
          kind: 'function',
          location: { file: filePath, line: lineNumber },
          exported,
          signature: buildSignature(state, trimmed),
        })
        if (exported) exports.push(name)
        state.pendingAnnotations = []
        continue
      }

      if (propertyMatch) {
        const [, valOrVar, , name] = propertyMatch
        const kind: SymbolKind = valOrVar === 'val' ? 'const' : 'variable'
        const exported = !PRIVATE_MODIFIER_PATTERN.test(trimmed)
        symbols.push({
          name,
          kind,
          location: { file: filePath, line: lineNumber },
          exported,
          signature: buildSignature(state, trimmed),
        })
        if (exported) exports.push(name)
        state.pendingAnnotations = []
        continue
      }
    }

    state.pendingAnnotations = []
  }

  return {
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
  readonly extensions = ['.kt'] as const
  readonly supportsCallGraph = false

  extractFromSource(filePath: string, sourceText: string): ExtractionResult {
    return extractKotlinSource(filePath, sourceText)
  }

  resolveImportToFile(specifier: string, importingFile: string, knownFiles: readonly string[]): string | null {
    return resolveKotlinImportToFile(specifier, importingFile, knownFiles)
  }
}
