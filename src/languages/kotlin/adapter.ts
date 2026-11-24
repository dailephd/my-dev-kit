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
 * Comments and supported literals are masked before lexical matching.
 * Unhandled templates and incomplete lexical regions remain partial.
 * Nested (e.g. companion object) and member
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
const IMPORT_PATTERN = /^import[ \t]+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*(?:\.\*)?)(?:[ \t]+as[ \t]+([A-Za-z_]\w*))?[ \t]*;?[ \t]*$/
const IMPORT_RESERVED_NAMES = new Set('as break class continue do else false for fun if import in interface is null object package return super this throw true try typealias typeof val var when while'.split(' '))
const PRIVATE_MODIFIER_PATTERN = /\bprivate\b/

const SIGNATURE_MAX_LENGTH = 120

interface LineScanState {
  depth: number
  pendingAnnotations: string[]
}

function stripLineComment(line: string): string {
  const index = line.indexOf('//')
  return index === -1 ? line : line.slice(0, index)
}

/** Same-width masks keep literal text out of matching without joining tokens across comments. */
function scanKotlinLines(rawLines: string[], uncertain: Map<string, string>): { code: string; text: string; topLevel: boolean }[] {
  let comments = 0
  let raw = false
  let quarantined = false
  const delimiters: string[] = []
  const lines = rawLines.map((line) => {
    const topLevel = delimiters.length === 0
    let code = ''
    let text = ''
    const mask = (value: string, literal = false): void => {
      code += (literal ? '~' : ' ').repeat(value.length)
      text += literal ? value : ' '.repeat(value.length)
    }
    for (let i = 0; i < line.length;) {
      if (quarantined) { mask(line.slice(i)); break }
      const rest = line.slice(i)
      if (comments > 0) {
        if (rest.startsWith('/*')) { comments++; mask('/*'); i += 2 }
        else if (rest.startsWith('*/')) { comments--; mask('*/'); i += 2 }
        else { mask(line[i]!); i++ }
      } else if (raw) {
        if (rest.startsWith('"""')) { raw = false; mask('"""', true); i += 3 }
        else if (rest.startsWith('${')) {
          uncertain.set('kotlin-string-template', 'Template expressions are outside the verified lexical profile; subsequent text is not enumerated.')
          quarantined = true
        } else { mask(line[i]!, true); i++ }
      } else if (rest.startsWith('//')) { mask(rest); break }
      else if (rest.startsWith('/*')) { comments++; mask('/*'); i += 2 }
      else if (rest.startsWith('"""')) {
        raw = true; mask('"""', true); i += 3
      } else if (line[i] === '"' || line[i] === "'") {
        const quote = line[i]!
        let end = i + 1
        for (; end < line.length; end++) {
          if (line[end] === '\\') {
            if (!/^(?:\\[tbnr'"\\$]|\\u[0-9a-fA-F]{4})/.test(line.slice(end))) uncertain.set('kotlin-literal-escape', 'An unsupported literal escape prevents verified lexical enumeration.')
            end++; continue
          }
          if (quote === '"' && line.slice(end, end + 2) === '${') {
            uncertain.set('kotlin-string-template', 'Template expressions are outside the verified lexical profile; subsequent text is not enumerated.')
            quarantined = true
            break
          }
          if (line[end] === quote) break
        }
        if (end >= line.length) {
          uncertain.set('unterminated-kotlin-literal', 'A quoted literal did not close on its line; subsequent text is not enumerated.')
          quarantined = true
        }
        if (quote === "'" && !/^(?:[^'\\]|\\[tbnr'"\\$]|\\u[0-9a-fA-F]{4})$/.test(line.slice(i + 1, end))) uncertain.set('kotlin-character-literal', 'An unsupported character literal prevents verified lexical enumeration.')
        mask(line.slice(i, Math.min(end + 1, line.length)), true)
        i = end + 1
      } else if (rest.startsWith('*/')) {
        uncertain.set('kotlin-unmatched-comment', 'A block comment terminator has no matching opener.')
        mask('*/'); i += 2
      } else if (line[i] === '`') {
        uncertain.set('kotlin-escaped-identifier', 'Escaped identifiers are outside the verified lexical profile; subsequent text is not enumerated.')
        quarantined = true
      } else {
        code += line[i]; text += line[i]; i++
      }
    }
    for (const char of code) {
      if ('({['.includes(char)) delimiters.push(char)
      else if (')}]'.includes(char) && delimiters.pop() !== ({ ')': '(', '}': '{', ']': '[' } as Record<string, string>)[char]) {
        uncertain.set('kotlin-unbalanced-delimiters', 'Mismatched delimiters prevent verified lexical enumeration.')
      }
    }
    return { code, text, topLevel }
  })
  if (comments) uncertain.set('unterminated-block-comment', 'A block comment was not closed.')
  if (raw) uncertain.set('unterminated-kotlin-raw-string', 'A raw string literal was not closed.')
  if (delimiters.length) uncertain.set('kotlin-unbalanced-delimiters', 'Unclosed delimiters prevent verified lexical enumeration.')
  return lines
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
  const importUncertain = new Map<string, string>()
  if (/\r(?!\n)|[\u2028\u2029]/.test(sourceText)) importUncertain.set('kotlin-line-boundary', 'Only LF and CRLF line boundaries are verified for explicit-import enumeration.')
  const lexicalLines = scanKotlinLines(rawLines, importUncertain)
  const scopes: KotlinScope[] = []
  const hold: { pending: PendingKotlinScope | null } = { pending: null }
  const seenQualified = new Set<string>()
  const packageName = parseKotlinPackageName(sourceText)
  let packageKnown = packageName !== null ? /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(packageName) : !/\bpackage\b/.test(sourceText)
  let jvmCoverageComplete = true
  let packageDeclarations = 0

  const state: LineScanState = { depth: 0, pendingAnnotations: [] }
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
    qualified = true,
  ): void => {
    target.push({
      ...base, kind: 'declaration', span: kotlinSpan(filePath, lineNumber), name, symbolId, declarationKind: kind, ownerKey,
      visibility, exported, exportOrigin: exported === null || visibility === 'unknown' ? 'unknown' : 'visibility-inferred',
      ...(!isScript && packageKnown && qualified ? { jvmDeclaration: { packageName: packageName ?? '', qualifiedName: [packageName, ...(ownerKey ? ownerKey.split('/').slice(1).map((part) => part.slice(part.indexOf(':') + 1)) : []), name].filter(Boolean).join('.'), role: kind === 'function' ? 'kotlin-top-level-function' as const : kind === 'const' || kind === 'variable' ? 'kotlin-top-level-property' as const : 'type' as const } } : {}),
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
    const lineNumber = i + 1
    const { code: line, text, topLevel: lexicalTopLevel } = lexicalLines[i]!
    const trimmed = line.trim()
    const importMatch = trimmed.match(IMPORT_PATTERN)
    const importNames = importMatch ? [...importMatch[1]!.split('.'), ...(importMatch[2] ? [importMatch[2]] : [])] : []
    const validImport = lexicalTopLevel && state.depth === 0 && importMatch !== null
      && !(importMatch[1]!.endsWith('.*') && importMatch[2])
      && importNames.every(name => !IMPORT_RESERVED_NAMES.has(name) && !/^_+$/.test(name))
    if (/\bimport\b/.test(line) && !validImport) importUncertain.set('kotlin-import-syntax', 'An import occurs outside the supported whole-directive profile.')
    if (trimmed.startsWith('#!') || trimmed.startsWith('@file:')) importUncertain.set('kotlin-import-directive', 'Script directives and file annotations are outside the verified import profile.')
    const inlineCompanion = trimmed.match(/^(?:(?:public|internal|private)\s+)?object\s+([A-Za-z_]\w*)\s*\{\s*companion\s+object\s+([A-Za-z_]\w*)\s*\{\s*\}\s*\}\s*$/)
    if (!inlineCompanion && (trimmed.match(/\b(?:class|interface|object)\s+[A-Za-z_]\w*/g)?.length ?? 0) > 1) jvmCoverageComplete = false
    if (/\btypealias\b|`/.test(trimmed) || /;\s*(?:fun|val|var)\b/.test(trimmed)) jvmCoverageComplete = false
    const depthBeforeLine = state.depth
    if (CLASS_LIKE_PATTERN.test(trimmed) && depthBeforeLine > 0 && (!scopes.length || depthBeforeLine !== scopes[scopes.length - 1]!.bodyDepth)) jvmCoverageComplete = false
    state.depth += countNetBraces(line)

    if (trimmed.length === 0) continue

    if (isScript && (trimmed.startsWith('#!') || trimmed.startsWith('@file:'))) {
      uncertain.set('kotlin-script-directive', 'Script directives and file annotations are outside the explicit declaration profile.')
    }
    if (isScript && (line.includes(';') || (line.match(/\b(?:class|interface|object)\b/g)?.length ?? 0) > 1)) {
      uncertain.set('kotlin-script-multiple-statements', 'Multiple or inline script declarations cannot be enumerated by the line profile.')
    }
    if (text.includes('"""')) uncertain.set('raw-string-literal', 'Raw string declaration semantics are outside the declaration line profile.')
    if (literalBraceImbalance(text)) uncertain.set('brace-in-literal', 'A literal brace is outside the qualified declaration nesting profile.')

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
      if (PACKAGE_PATTERN.test(trimmed)) {
        if (++packageDeclarations > 1 || !/^package\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*;?\s*$/.test(trimmed)) packageKnown = false
        continue
      }
      if (/^package\b/.test(trimmed)) packageKnown = false

      if (validImport && importMatch) {
        imports.push(importMatch[1])
        const segments = importMatch[1].split('.')
        topFacts.push({
          ...base, kind: 'import', span: kotlinSpan(filePath, lineNumber), sourceSpecifier: importMatch[1],
          importedNames: [segments[segments.length - 1]!], importResolution: 'observed',
          jvmImportTarget: importMatch[1].includes('*') || importMatch[2] ? { kind: 'unsupported', qualifiedName: null } : { kind: 'kotlin-direct', qualifiedName: importMatch[1] },
        })
        continue
      }
      // A rejected directive must not be reinterpreted as a declaration.
      if (/^import\b/.test(trimmed)) continue
    }

    if (trimmed.startsWith('@')) {
      if (/\b(?:class|interface|object|fun|val|var)\b/.test(trimmed)) jvmCoverageComplete = false
      state.pendingAnnotations.push(text.trim())
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
          signature: buildSignature(state, text.trim()),
        })
        if (exported) exports.push(name)
        const explicit = explicitKotlinVisibility(trimmed.slice(0, matchIndex))
        const visibility: SourceAuditFact['visibility'] = explicit ?? implicitVisibility(null)
        const qualified = trimmed.slice(0, matchIndex).trim().split(/\s+/).filter(Boolean).every((modifier) => MODIFIER_KEYWORDS.has(modifier)) && (!classMatch || !/[$\p{L}\p{N}_]/u.test(trimmed[matchIndex + classMatch[0].length] ?? ''))
        if (!qualified) jvmCoverageComplete = false
        declarationFacts(topFacts, lineNumber, name, kind, visibility, topExportState(visibility), null, '', qualified)
        state.pendingAnnotations = []
      }

      if (classMatch) {
        const [, keyword, name] = classMatch
        const kind = classifyClassLikeKind(trimmed, keyword)
        topLevel(name, kind, classMatch.index ?? 0)
        if (inlineCompanion) {
          const nestedName = inlineCompanion[2]!
          const visibility = explicitKotlinVisibility(trimmed.slice(0, classMatch.index ?? 0)) ?? implicitVisibility(null)
          declarationFacts(nestedFacts, lineNumber, nestedName, 'object', 'public', topExportState(visibility), `kotlin/object:${name}`,
            `audit-symbol:${encodeURIComponent(filePath)}#${encodeURIComponent(`${name}.${nestedName}`)}`)
        }
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
      if (/\b(?:class|interface|object|fun|val|var)\b/.test(trimmed)) jvmCoverageComplete = false
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
  for (const [code, message] of importUncertain) uncertain.set(code, message)

  const capabilities = auditCapabilityMap('unsupported')
  const diagnostics: SourceAuditExtractionPayload['diagnostics'] = []
  const settled = uncertain.size === 0
  capabilities.declarations = settled ? 'complete' : 'partial'
  capabilities.jvmDeclarations = isScript ? 'unsupported' : settled && packageKnown && jvmCoverageComplete ? 'complete' : 'partial'
  capabilities.imports = importUncertain.size === 0 ? 'complete' : 'partial'
  capabilities.exports = 'partial'
  capabilities['source-ranges'] = 'partial'
  diagnostics.push({ code: 'lexical-line-ranges', message: 'The lexical scanner records declaration start lines only; columns and end ranges are unknown.', span: null })
  diagnostics.push({ code: 'visibility-inferred-exports', message: 'Kotlin exports are inferred from explicit or default visibility and do not reflect module boundaries.', span: null })
  if (isScript) diagnostics.push({ code: 'kotlin-script-visibility-unknown', message: 'Explicit script declarations are enumerated lexically; implicit script-owner accessibility remains unknown and is not an ordinary compilation-unit export claim.', span: null })
  for (const [code, message] of [...uncertain].sort(([a], [b]) => (a < b ? -1 : 1))) diagnostics.push({ code, message, span: null })
  // Nested facts are published only when the lexical nesting is certain.
  const facts = settled ? [...topFacts, ...nestedFacts] : topFacts
  if (!packageKnown || !jvmCoverageComplete || !settled) for (const fact of facts) delete fact.jvmDeclaration

  return {
    sourceAudit: { facts, capabilities, diagnostics, ...(!isScript && packageKnown ? { jvmPackageName: packageName ?? '' } : {}) },
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
