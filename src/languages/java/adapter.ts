/**
 * Conservative, deterministic static Java extractor (v1.9.0 Batch 3).
 *
 * Line-based scanning with a brace-depth counter — not `javac`, not a real
 * grammar-based parser. Only top-level declarations (depth 0) become
 * symbols, exactly matching the Kotlin adapter (Batch 2), which itself
 * matches the existing TypeScript (`ts.forEachChild`, direct children only)
 * and Python (`tree.body`, top-level only) precedent: no language extracts
 * class members (methods/fields/constructors) as separate symbol-index
 * entries today, so Java doesn't either — inventing a member-symbol schema
 * for Java alone would be a parallel, inconsistent architecture rather than
 * reuse of the existing one. Modifiers (`abstract`/`final`/`static`/
 * `sealed`/`non-sealed`), `extends`/`implements` targets, and annotations
 * are all surfaced through the existing `signature` text field (capped at
 * 120 chars, same as every other language) rather than new dedicated
 * fields — the same choice the Kotlin adapter made, and the Python adapter
 * before it for decorators.
 *
 * Known conservative-parser limitations (documented, not defects): braces
 * inside string/text-block literals can perturb depth tracking; only
 * single-line `//` comments and single-line-opening `/* ... *\/` block
 * comments (including Javadoc) are stripped reliably; nested/inner
 * declarations and members are not extracted as symbols; call-graph
 * extraction is not implemented (matches the Kotlin decision — regex-based
 * call detection is not reliable enough to be worth the false-positive
 * risk, and was out of scope for this batch regardless).
 */

import type { LanguageAdapter, ExtractionResult } from '../types.js'
import type { SymbolDefinition, SymbolKind } from '../../symbol-index/types.js'

/**
 * Matches `class|interface|enum|record` anywhere in the (comment-stripped,
 * trimmed) line, regardless of preceding modifiers — `\b` is satisfied
 * right after any modifier/whitespace, so `public sealed class Shape`
 * matches `class Shape` the same way `class Shape` alone does, without
 * needing a modifier allow-list. This also matches the `interface` part of
 * `@interface MyAnnotation` (an annotation type declaration), since `\b`
 * matches between the non-word `@` and the word `i`.
 */
const CLASS_LIKE_PATTERN = /\b(class|interface|enum|record)\s+([A-Za-z_]\w*)/
const ANNOTATION_TYPE_PATTERN = /^@\s*interface\b/
const PACKAGE_PATTERN = /^package\s+([\w.]+)/
const IMPORT_PATTERN = /^import\s+(static\s+)?([\w.*]+)/
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

function classifyClassLikeKind(keyword: string): SymbolKind {
  if (keyword === 'interface') return 'interface'
  if (keyword === 'enum') return 'enum'
  // 'record' maps to 'class' (a class-like declaration); "record" itself
  // remains visible in the signature text, matching the Kotlin adapter's
  // treatment of `data class`/`sealed class` modifiers.
  return 'class'
}

/**
 * Extracts the file's package declaration, if any. Kept as a standalone
 * function (rather than a new `ExtractionResult`/`FileSummary` field,
 * neither of which has a natural slot for it) so it stays independently
 * testable — mirrors `parseKotlinPackageName` from the Kotlin adapter.
 */
export function parseJavaPackageName(sourceText: string): string | null {
  for (const rawLine of sourceText.split('\n')) {
    const trimmed = stripLineComment(rawLine).trim()
    if (trimmed.length === 0) continue
    const match = trimmed.match(PACKAGE_PATTERN)
    if (match) return match[1]
    if (!trimmed.startsWith('@') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')) return null
  }
  return null
}

export function extractJavaSource(filePath: string, sourceText: string): ExtractionResult {
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
        // Static-ness is not preserved as separate metadata (no dedicated
        // field exists for it, matching the "no new fields" design already
        // used for Kotlin) — the qualified name is still captured either way.
        imports.push(importMatch[2])
        continue
      }
    }

    const isAnnotationTypeDeclaration = ANNOTATION_TYPE_PATTERN.test(trimmed)
    if (trimmed.startsWith('@') && !isAnnotationTypeDeclaration) {
      state.pendingAnnotations.push(trimmed)
      continue
    }

    if (depthBeforeLine === 0) {
      const classMatch = trimmed.match(CLASS_LIKE_PATTERN)

      if (classMatch) {
        const [, keyword, name] = classMatch
        const kind = classifyClassLikeKind(keyword)
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
    language: 'java',
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
 * Resolves a Java import specifier to a local file. Unlike Kotlin, Java
 * enforces (for the primary public top-level type) that a file's name
 * matches its public type's name, so `<packageDir>/<LastSegment>.java` is a
 * reliable — though still best-effort, not semantically verified —
 * resolution target. A wildcard import (`import com.example.*;` or
 * `import static com.example.Foo.*;`) has no single target and correctly
 * resolves to `null` rather than guessing.
 */
export function resolveJavaImportToFile(specifier: string, _importingFile: string, knownFiles: readonly string[]): string | null {
  if (specifier.endsWith('.*')) return null
  const parts = specifier.split('.')
  if (parts.length < 2) return null
  const packageDir = parts.slice(0, -1).join('/')
  const symbolName = parts.at(-1)
  const candidateSuffix = `${packageDir}/${symbolName}.java`
  return knownFiles.find((file) => file === candidateSuffix || file.endsWith(`/${candidateSuffix}`)) ?? null
}

export class JavaAdapter implements LanguageAdapter {
  readonly extensions = ['.java'] as const
  readonly supportsCallGraph = false

  extractFromSource(filePath: string, sourceText: string): ExtractionResult {
    return extractJavaSource(filePath, sourceText)
  }

  resolveImportToFile(specifier: string, importingFile: string, knownFiles: readonly string[]): string | null {
    return resolveJavaImportToFile(specifier, importingFile, knownFiles)
  }
}
