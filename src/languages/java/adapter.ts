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
import { auditCapabilityMap, type SourceAuditExtractionPayload } from '../../symbol-index/auditObservations.js'
import type { SourceAuditFact, SourceAuditSpan } from '../../symbol-index/auditEvidenceTypes.js'

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

/** Strict form of a declaration line: only modifiers may precede the class-like keyword. */
const NESTED_DECLARATION_PATTERN = /^((?:(?:public|protected|private|static|final|abstract|sealed|non-sealed|strictfp)\s+)*)(@\s*interface|class|interface|enum|record)\s+([A-Za-z_]\w*)/
const ANNOTATION_PREFIX_PATTERN = /^(?:@(?!\s*interface\b)[\w.]+(?:\([^)]*\))?\s*)+/
const LITERAL_PATTERN = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g

interface JavaScope {
  name: string
  kind: SymbolKind
  keyword: string
  bodyDepth: number
  /** Dotted lexical path, established only from certain nesting. */
  qualified: string
  effectivelyPublic: boolean
  implicitMemberVisibility: 'public' | 'package'
}

interface PendingScope extends Omit<JavaScope, 'bodyDepth'> {
  depth: number
  waited: number
}

function literalBraceImbalance(line: string): boolean {
  for (const literal of line.match(LITERAL_PATTERN) ?? []) {
    if (countNetBraces(literal) !== 0) return true
  }
  return false
}

function javaVisibility(head: string): 'public' | 'protected' | 'private' | null {
  const modifiers = head.replace(ANNOTATION_PREFIX_PATTERN, '')
  if (/\bpublic\b/.test(modifiers)) return 'public'
  if (/\bprotected\b/.test(modifiers)) return 'protected'
  if (/\bprivate\b/.test(modifiers)) return 'private'
  return null
}

function javaSpan(filePath: string, line: number): SourceAuditSpan {
  // The lexical scanner establishes line starts only; columns and end ranges are unknown, never guessed.
  return { path: filePath, startLine: line, startColumn: null, endLine: null, endColumn: null }
}

export function extractJavaSource(filePath: string, sourceText: string): ExtractionResult {
  const rawLines = sourceText.split('\n')
  const lineCount = rawLines.length

  const imports: string[] = []
  const symbols: SymbolDefinition[] = []
  const exports: string[] = []
  const topFacts: SourceAuditFact[] = []
  const nestedFacts: SourceAuditFact[] = []
  const uncertain = new Map<string, string>()
  const scopes: JavaScope[] = []
  let pending: PendingScope | null = null
  const seenQualified = new Set<string>()
  const packageName = parseJavaPackageName(sourceText)
  let packageKnown = packageName !== null ? /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(packageName) : !/\bpackage\b/.test(sourceText)
  let jvmCoverageComplete = true
  let packageDeclarations = 0

  const state: LineScanState = { depth: 0, inBlockComment: false, pendingAnnotations: [] }
  const base = { id: '', extractionMethod: 'java-lexical' as const }

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
      ...base, kind: 'declaration', span: javaSpan(filePath, lineNumber), name, symbolId, declarationKind: kind, ownerKey,
      visibility, exported, exportOrigin: visibility === 'unknown' ? 'unknown' : 'visibility-inferred',
      ...(packageKnown && qualified ? { jvmDeclaration: { packageName: packageName ?? '', qualifiedName: [packageName, ...scopes.map((scope) => scope.name), name].filter(Boolean).join('.'), role: 'type' as const } } : {}),
    })
    if (exported === true) {
      target.push({ ...base, kind: 'export', span: javaSpan(filePath, lineNumber), name, exportOrigin: 'visibility-inferred', visibility, exported: true, ...(symbolId ? { symbolId } : {}) })
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
    if ((trimmed.match(/\b(?:class|interface|enum|record)\s+[A-Za-z_]\w*/g)?.length ?? 0) > 1) jvmCoverageComplete = false
    const depthBeforeLine = state.depth
    if (depthBeforeLine === 0 && /^(?:open\s+)?module\b/.test(trimmed)) jvmCoverageComplete = false
    state.depth += countNetBraces(line)

    if (trimmed.length === 0) continue

    if (line.includes('"""')) uncertain.set('text-block-literal', 'A text block can hide braces from the depth scanner.')
    if (literalBraceImbalance(line)) uncertain.set('brace-in-literal', 'A string or character literal contains an unbalanced brace that can corrupt scope depth.')

    // Close scopes whose bodies ended on earlier lines.
    while (scopes.length > 0 && depthBeforeLine < scopes[scopes.length - 1]!.bodyDepth) scopes.pop()

    // A declared body opens when real brace depth increases past the declaration depth.
    if (pending) {
      if (state.depth > pending.depth) {
        if (state.depth - pending.depth !== 1) uncertain.set('multiple-braces-on-declaration-line', 'More than one scope opened at a class-like declaration.')
        const { depth, waited: _waited, ...scope } = pending
        scopes.push({ ...scope, bodyDepth: depth + 1 })
        pending = null
      } else if (line.includes('{')) {
        // The body opened and closed on this line.
        pending = null
      } else if (trimmed.endsWith(';') || ++pending.waited > 4) {
        uncertain.set('declaration-body-not-found', 'A class-like declaration did not open a body where one was expected.')
        pending = null
      }
    }

    if (depthBeforeLine === 0) {
      if (PACKAGE_PATTERN.test(trimmed)) {
        if (++packageDeclarations > 1 || !/^package\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*;\s*$/.test(trimmed)) packageKnown = false
        continue
      }
      if (/^package\b/.test(trimmed)) packageKnown = false

      const importMatch = trimmed.match(IMPORT_PATTERN)
      if (importMatch) {
        // Static-ness is not preserved as separate metadata (no dedicated
        // field exists for it, matching the "no new fields" design already
        // used for Kotlin) — the qualified name is still captured either way.
        imports.push(importMatch[2])
        const segments = importMatch[2].split('.')
        topFacts.push({
          ...base, kind: 'import', span: javaSpan(filePath, lineNumber), sourceSpecifier: importMatch[2],
          importedNames: [segments[segments.length - 1]!], importResolution: 'observed',
          jvmImportTarget: importMatch[2].includes('*') || !/^import\s+(?:static\s+)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s*;\s*$/.test(trimmed) ? { kind: 'unsupported', qualifiedName: null } : importMatch[1] ? { kind: 'java-static-owner', qualifiedName: segments.length > 2 ? segments.slice(0, -1).join('.') : null } : { kind: 'java-type', qualifiedName: importMatch[2] },
        })
        continue
      }
    }

    const isAnnotationTypeDeclaration = ANNOTATION_TYPE_PATTERN.test(trimmed)
    if (trimmed.startsWith('@') && !isAnnotationTypeDeclaration) {
      if (CLASS_LIKE_PATTERN.test(trimmed)) jvmCoverageComplete = false
      state.pendingAnnotations.push(trimmed)
      continue
    }

    if (depthBeforeLine === 0) {
      const classMatch = trimmed.match(CLASS_LIKE_PATTERN)

      if (classMatch) {
        const qualified = NESTED_DECLARATION_PATTERN.test(trimmed) && !/[$\p{L}\p{N}_]/u.test(trimmed[(classMatch.index ?? 0) + classMatch[0].length] ?? '')
        if (!qualified) jvmCoverageComplete = false
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
        // Explicit visibility from the modifiers before the keyword; no modifier means package-private, never public.
        const visibility = javaVisibility(trimmed.slice(0, classMatch.index ?? 0)) ?? 'package'
        declarationFacts(topFacts, lineNumber, name, kind, visibility, visibility === 'public', null, '', qualified)
        const next: PendingScope = {
          name, kind, keyword: isAnnotationTypeDeclaration ? '@interface' : keyword, depth: depthBeforeLine, waited: 0, qualified: name,
          effectivelyPublic: visibility === 'public',
          implicitMemberVisibility: keyword === 'interface' || isAnnotationTypeDeclaration ? 'public' : 'package',
        }
        if (state.depth > depthBeforeLine) {
          if (state.depth - depthBeforeLine !== 1) uncertain.set('multiple-braces-on-declaration-line', 'More than one scope opened at a class-like declaration.')
          const { depth, waited: _waited, ...scope } = next
          scopes.push({ ...scope, bodyDepth: depth + 1 })
        } else if (!line.includes('{')) {
          pending = next
        }
        state.pendingAnnotations = []
        continue
      }
    } else if (scopes.length > 0 && depthBeforeLine === scopes[scopes.length - 1]!.bodyDepth) {
      // Member level of a known class body: only class-like declarations are audit-visible here.
      const owner = scopes[scopes.length - 1]!
      const looksClassLike = CLASS_LIKE_PATTERN.test(trimmed)
      const strict = trimmed.match(NESTED_DECLARATION_PATTERN)
      if (strict) {
        const qualifiedIdentity = !/[$\p{L}\p{N}_]/u.test(trimmed[strict[0].length] ?? '')
        if (!qualifiedIdentity) jvmCoverageComplete = false
        const [, head, keyword, name] = strict
        const annotationType = keyword.startsWith('@')
        const kind = classifyClassLikeKind(annotationType ? 'interface' : keyword)
        const qualified = `${owner.qualified}.${name}`
        if (seenQualified.has(qualified)) uncertain.set('duplicate-nested-declaration', 'Two nested declarations share one lexical path.')
        seenQualified.add(qualified)
        const visibility = javaVisibility(head) ?? owner.implicitMemberVisibility
        const effectivelyPublic = owner.effectivelyPublic && visibility === 'public'
        const chain = scopes.map((scope) => `${scope.keyword}:${scope.name}`).join('/')
        declarationFacts(
          nestedFacts, lineNumber, name, kind, visibility, effectivelyPublic, `java/${chain}`,
          `audit-symbol:${encodeURIComponent(filePath)}#${encodeURIComponent(qualified)}`,
          qualifiedIdentity,
        )
        const next: PendingScope = {
          name, kind, keyword: annotationType ? '@interface' : keyword, depth: depthBeforeLine, waited: 0, qualified, effectivelyPublic,
          implicitMemberVisibility: keyword === 'interface' || annotationType ? 'public' : 'package',
        }
        if (state.depth > depthBeforeLine) {
          if (state.depth - depthBeforeLine !== 1) uncertain.set('multiple-braces-on-declaration-line', 'More than one scope opened at a class-like declaration.')
          const { depth, waited: _waited, ...scope } = next
          scopes.push({ ...scope, bodyDepth: depth + 1 })
        } else if (!line.includes('{')) {
          pending = next
        }
        state.pendingAnnotations = []
        continue
      } else if (looksClassLike) {
        uncertain.set('unrecognized-nested-declaration', 'A member line mentions a class-like keyword in a form the scanner cannot classify.')
      }
    }

    state.pendingAnnotations = []
    if (/\b(?:class|interface|enum|record)\b/.test(trimmed)) jvmCoverageComplete = false
  }

  if (state.depth !== 0) uncertain.set('unbalanced-braces', 'Brace depth did not return to zero at the end of the file.')
  if (state.inBlockComment) uncertain.set('unterminated-block-comment', 'A block comment was not closed.')
  if (pending) uncertain.set('declaration-body-not-found', 'A class-like declaration did not open a body where one was expected.')

  const capabilities = auditCapabilityMap('unsupported')
  const diagnostics: SourceAuditExtractionPayload['diagnostics'] = []
  const settled = uncertain.size === 0
  capabilities.declarations = settled ? 'complete' : 'partial'
  capabilities.jvmDeclarations = settled && packageKnown && jvmCoverageComplete ? 'complete' : 'partial'
  capabilities.imports = settled ? 'complete' : 'partial'
  capabilities.exports = 'partial'
  capabilities['source-ranges'] = 'partial'
  diagnostics.push({ code: 'lexical-line-ranges', message: 'The lexical scanner records declaration start lines only; columns and end ranges are unknown.', span: null })
  diagnostics.push({ code: 'visibility-inferred-exports', message: 'Java has no export statements; exports are inferred from explicit class-like visibility and do not reflect module descriptors.', span: null })
  for (const [code, message] of [...uncertain].sort(([a], [b]) => (a < b ? -1 : 1))) diagnostics.push({ code, message, span: null })
  // Nested facts are published only when the lexical nesting is certain.
  const facts = settled ? [...topFacts, ...nestedFacts] : topFacts
  if (!packageKnown || !jvmCoverageComplete || !settled) for (const fact of facts) delete fact.jvmDeclaration

  return {
    sourceAudit: { facts, capabilities, diagnostics, ...(packageKnown ? { jvmPackageName: packageName ?? '' } : {}) },
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
