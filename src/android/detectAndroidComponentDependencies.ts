import type { SymbolIndex } from '../symbol-index/types.js'
import { readBoundedSourceBody } from './boundedSourceBodyScan.js'
import type {
  AndroidComponentDependencyEvidenceKind,
  AndroidComponentDependencyFact,
  AndroidComponentDependencyMatchStatus,
  AndroidComponentDependencyRelationshipKind,
  AndroidComponentEntry,
  AndroidComponentRole,
} from './androidComponentTypes.js'

/**
 * v1.12.0 Batch 3: conservative static component-dependency-fact extraction.
 *
 * Reuses the same bounded, brace-depth-scanned source re-read Retrofit-service
 * detection already uses (`boundedSourceBodyScan.ts`) - never a second
 * unbounded scanner, never a member-symbol model. Every fact is derived from
 * a directly-typed declaration (constructor parameter, typed property/field,
 * or DAO/database method signature) matched against already-detected
 * `android-components.json` role facts via exact fully-qualified / import /
 * same-package / simple-name resolution, in that fixed tier order. Never
 * infers a dependency from method calls, HTTP annotations, or SQL content.
 */
export interface DetectAndroidComponentDependenciesOptions {
  symbolIndex: SymbolIndex
  components: readonly AndroidComponentEntry[]
  projectRoot: string
}

export interface DetectAndroidComponentDependenciesResult {
  dependencyFacts: AndroidComponentDependencyFact[]
  warnings: string[]
}

const SUPPORTED_WRAPPERS = new Set(['List', 'Flow', 'StateFlow', 'LiveData'])
const NON_ENTITY_BUILTIN_TYPES = new Set([
  'Long', 'Int', 'Integer', 'String', 'Boolean', 'Double', 'Float', 'Short', 'Byte', 'Char',
  'Unit', 'void', 'Any', 'Object', 'Void',
])

export function detectAndroidComponentDependencies(
  options: DetectAndroidComponentDependenciesOptions
): DetectAndroidComponentDependenciesResult {
  const { symbolIndex, components, projectRoot } = options
  const filesByPath = new Map(symbolIndex.files.map((f) => [f.path, f]))
  const componentsByRole = new Map<AndroidComponentRole, AndroidComponentEntry[]>()
  for (const c of components) {
    const list = componentsByRole.get(c.role) ?? []
    list.push(c)
    componentsByRole.set(c.role, list)
  }

  const facts: AndroidComponentDependencyFact[] = []
  const warnings = new Set<string>()
  const seenFactKeys = new Set<string>()

  for (const component of components) {
    const file = filesByPath.get(component.filePath)
    if (!file) continue
    const symbol = file.symbols.find((s) => s.name === component.symbolName)
    if (!symbol || typeof symbol.location?.line !== 'number') continue

    const body = readBoundedSourceBody(projectRoot, file.path, symbol.location.line)
    if (body === null) {
      warnings.add(`Could not read source for '${component.symbolName}' in '${component.filePath}' while scanning for component dependencies.`)
      continue
    }

    const { header, classBody } = splitHeaderAndBody(body)
    const baseLine = symbol.location.line
    const language = file.language as 'kotlin' | 'java'

    if (component.role === 'view-model' || component.role === 'repository') {
      const targetRoles: Array<{ role: AndroidComponentRole; kind: AndroidComponentDependencyRelationshipKind }> =
        component.role === 'view-model'
          ? [{ role: 'repository', kind: 'viewmodel-uses-repository' }]
          : [
              { role: 'room-dao', kind: 'repository-uses-dao' },
              { role: 'retrofit-service', kind: 'repository-uses-service' },
            ]

      const deps = extractDirectDependencies(header, classBody, component.symbolName, language, baseLine)
      for (const dep of deps) {
        const fact = resolveDependencyFact({
          component,
          dep,
          targetRoles,
          componentsByRole,
          sourceFileImports: file.imports,
          warnings,
        })
        if (fact && !seenFactKeys.has(factDedupeKey(fact))) {
          seenFactKeys.add(factDedupeKey(fact))
          facts.push(fact)
        }
      }
    }

    if (component.role === 'room-dao') {
      const methodDeps = extractMethodEntityDependencies(classBody, language, baseLine, warnings, component.symbolName)
      for (const dep of methodDeps) {
        const fact = resolveDependencyFact({
          component,
          dep,
          targetRoles: [{ role: 'room-entity', kind: 'dao-uses-entity' }],
          componentsByRole,
          sourceFileImports: file.imports,
          warnings,
        })
        if (fact && !seenFactKeys.has(factDedupeKey(fact))) {
          seenFactKeys.add(factDedupeKey(fact))
          facts.push(fact)
        }
      }
    }

    if (component.role === 'room-database') {
      const daoDeps = extractDatabaseDaoMethods(classBody, language, baseLine)
      for (const dep of daoDeps) {
        const fact = resolveDependencyFact({
          component,
          dep,
          targetRoles: [{ role: 'room-dao', kind: 'room-database-exposes-dao' }],
          componentsByRole,
          sourceFileImports: file.imports,
          warnings,
        })
        if (fact && !seenFactKeys.has(factDedupeKey(fact))) {
          seenFactKeys.add(factDedupeKey(fact))
          facts.push(fact)
        }
      }
    }
  }

  facts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { dependencyFacts: facts, warnings: [...warnings].sort() }
}

function factDedupeKey(fact: AndroidComponentDependencyFact): string {
  return [fact.relationshipKind, fact.sourceSymbolId, fact.declaredTypeName, fact.sourceRef.line, [...fact.candidateSymbolIds].sort().join(',')].join('\0')
}

// ---------------------------------------------------------------------------
// Header/body split (depth-tracked, no member-symbol model - pure text spans)
// ---------------------------------------------------------------------------

function splitHeaderAndBody(fullBody: string): { header: string; classBody: string } {
  for (let i = 0; i < fullBody.length; i++) {
    if (fullBody[i] === '{') {
      const closeIdx = findMatchingBraceClose(fullBody, i)
      const header = fullBody.slice(0, i)
      const rawClassBody = closeIdx === -1 ? fullBody.slice(i + 1) : fullBody.slice(i + 1, closeIdx)
      return { header, classBody: blankNestedBraces(rawClassBody) }
    }
  }
  return { header: fullBody, classBody: '' }
}

function findMatchingBraceClose(text: string, openIndex: number): number {
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function findMatchingParenClose(text: string, openIndex: number): number {
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function findMatchingAngleClose(text: string, openIndex: number): number {
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '<') depth++
    else if (text[i] === '>') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Blanks nested-brace (depth > 0) content to spaces, preserving newlines, so line-based regexes never see method-body content. */
function blankNestedBraces(text: string): string {
  let depth = 0
  let out = ''
  for (const ch of text) {
    if (ch === '{') {
      depth++
      out += ' '
      continue
    }
    if (ch === '}') {
      depth--
      out += ' '
      continue
    }
    if (depth > 0) {
      out += ch === '\n' ? '\n' : ' '
      continue
    }
    out += ch
  }
  return out
}

function lineOffsetAt(text: string, index: number): number {
  let line = 0
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++
  }
  return line
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
// Extracted-dependency shape
// ---------------------------------------------------------------------------

interface ExtractedDependency {
  rawType: string
  evidenceKind: AndroidComponentDependencyEvidenceKind
  line: number
}

// ---------------------------------------------------------------------------
// ViewModel/Repository: constructor parameters + typed properties/fields
// ---------------------------------------------------------------------------

function extractDirectDependencies(
  header: string,
  classBody: string,
  className: string,
  language: 'kotlin' | 'java',
  baseLine: number
): ExtractedDependency[] {
  const results: ExtractedDependency[] = []

  if (language === 'kotlin') {
    results.push(...extractKotlinPrimaryConstructorParams(header, className, baseLine))
    results.push(...extractKotlinSecondaryConstructorParams(classBody, baseLine))
    results.push(...extractKotlinTypedProperties(classBody, baseLine))
  } else {
    results.push(...extractJavaConstructorParams(classBody, className, baseLine))
    results.push(...extractJavaTypedFields(classBody, baseLine))
  }
  return results
}

function extractKotlinPrimaryConstructorParams(header: string, className: string, baseLine: number): ExtractedDependency[] {
  const classRegex = new RegExp(`\\bclass\\s+${escapeRegExp(className)}\\b`)
  const m = classRegex.exec(header)
  if (!m) return []
  let idx = m.index + m[0].length
  if (header[idx] === '<') {
    const close = findMatchingAngleClose(header, idx)
    if (close !== -1) idx = close + 1
  }
  while (idx < header.length && /\s/.test(header[idx]!)) idx++
  if (header[idx] !== '(') return []
  const closeIdx = findMatchingParenClose(header, idx)
  if (closeIdx === -1) return []
  const paramListText = header.slice(idx + 1, closeIdx)
  const line = baseLine + lineOffsetAt(header, idx)
  return parseKotlinParamList(paramListText).map((p) => ({ rawType: p.rawType, evidenceKind: 'primary-constructor-parameter' as const, line }))
}

function extractKotlinSecondaryConstructorParams(classBody: string, baseLine: number): ExtractedDependency[] {
  const results: ExtractedDependency[] = []
  const regex = /\bconstructor\s*\(/g
  let m: RegExpExecArray | null
  while ((m = regex.exec(classBody))) {
    const openIdx = m.index + m[0].length - 1
    const closeIdx = findMatchingParenClose(classBody, openIdx)
    if (closeIdx === -1) continue
    const paramListText = classBody.slice(openIdx + 1, closeIdx)
    const line = baseLine + lineOffsetAt(classBody, openIdx)
    for (const p of parseKotlinParamList(paramListText)) {
      results.push({ rawType: p.rawType, evidenceKind: 'secondary-constructor-parameter', line })
    }
  }
  return results
}

function extractKotlinTypedProperties(classBody: string, baseLine: number): ExtractedDependency[] {
  const results: ExtractedDependency[] = []
  const lines = classBody.split('\n')
  const modifierPattern = /^(private|protected|internal|public|override|open|final|lateinit|abstract)\s+/
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!.trim()
    // Skip lines that are constructor signatures (already handled separately).
    if (/^constructor\s*\(/.test(line)) continue
    while (modifierPattern.test(line)) line = line.replace(modifierPattern, '')
    const propMatch = /^(?:val|var)\s+(\w+)\s*:\s*([^\n={]+?)(?:\s*=.*)?$/.exec(line)
    if (propMatch) {
      results.push({ rawType: propMatch[2]!.trim(), evidenceKind: 'typed-property', line: baseLine + i })
    }
  }
  return results
}

function extractJavaConstructorParams(classBody: string, className: string, baseLine: number): ExtractedDependency[] {
  const results: ExtractedDependency[] = []
  const regex = new RegExp(`(?:^|[\\s{};])(?:public\\s+|private\\s+|protected\\s+)?${escapeRegExp(className)}\\s*\\(`, 'g')
  let m: RegExpExecArray | null
  while ((m = regex.exec(classBody))) {
    const openIdx = m.index + m[0].length - 1
    const closeIdx = findMatchingParenClose(classBody, openIdx)
    if (closeIdx === -1) continue
    const paramListText = classBody.slice(openIdx + 1, closeIdx)
    const line = baseLine + lineOffsetAt(classBody, openIdx)
    for (const p of parseJavaParamList(paramListText)) {
      results.push({ rawType: p.rawType, evidenceKind: 'constructor-parameter', line })
    }
  }
  return results
}

function extractJavaTypedFields(classBody: string, baseLine: number): ExtractedDependency[] {
  const results: ExtractedDependency[] = []
  const lines = classBody.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line.endsWith(';') || line.includes('(')) continue
    const fieldMatch = /^(?:private|protected|public|static|final|\s)*([\w.]+(?:<[^;]+>)?)\s+(\w+)\s*;$/.exec(line)
    if (fieldMatch) {
      results.push({ rawType: fieldMatch[1]!.trim(), evidenceKind: 'typed-field', line: baseLine + i })
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Room DAO: method parameter/return entity extraction
// ---------------------------------------------------------------------------

interface MethodSignature {
  params: { rawType: string }[]
  returnType: string | null
  line: number
}

function extractMethodSignatures(classBody: string, language: 'kotlin' | 'java', baseLine: number): MethodSignature[] {
  const results: MethodSignature[] = []
  const lines = classBody.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line) continue
    if (language === 'kotlin') {
      const m = /^(?:abstract\s+|open\s+|override\s+|suspend\s+)*fun\s+\w+\s*\(([^)]*)\)\s*(?::\s*([^\n]+?))?\s*$/.exec(line)
      if (m) {
        results.push({
          params: parseKotlinParamList(m[1] ?? '').map((p) => ({ rawType: p.rawType })),
          returnType: m[2] ? m[2].trim() : null,
          line: baseLine + i,
        })
      }
    } else {
      if (line.includes('=')) continue
      const m = /^(?:public\s+|abstract\s+|static\s+)*([\w.<>[\],\s?]+?)\s+(\w+)\s*\(([^)]*)\)\s*;?\s*$/.exec(line)
      if (m && !/^(if|for|while|switch|catch|return)$/.test(m[2]!)) {
        results.push({
          params: parseJavaParamList(m[3] ?? '').map((p) => ({ rawType: p.rawType })),
          returnType: m[1]!.trim(),
          line: baseLine + i,
        })
      }
    }
  }
  return results
}

function extractMethodEntityDependencies(
  classBody: string,
  language: 'kotlin' | 'java',
  baseLine: number,
  warnings: Set<string>,
  daoName: string
): ExtractedDependency[] {
  const results: ExtractedDependency[] = []
  for (const method of extractMethodSignatures(classBody, language, baseLine)) {
    for (const param of method.params) {
      const unwrapped = unwrapEntityType(param.rawType, warnings, daoName)
      if (unwrapped) results.push({ rawType: unwrapped, evidenceKind: 'method-parameter', line: method.line })
    }
    if (method.returnType) {
      const unwrapped = unwrapEntityType(method.returnType, warnings, daoName)
      if (unwrapped) results.push({ rawType: unwrapped, evidenceKind: 'method-return', line: method.line })
    }
  }
  return results
}

/**
 * Unwraps `List<T>`/`Flow<T>`/`StateFlow<T>`/`LiveData<T>` (nested combinations of
 * only these) and a trailing nullable `?`, returning the contained bare type
 * name when it looks like a real (non-builtin) type - or `null` when the type
 * is a known non-entity builtin (silently skipped) or an unsupported generic
 * wrapper (a warning is recorded and the caller treats it as unresolved).
 */
function unwrapEntityType(rawType: string, warnings: Set<string>, ownerName: string): string | null {
  let type = rawType.trim()
  if (type.endsWith('?')) type = type.slice(0, -1).trim()
  if (type === '' || type === 'Unit' || type === 'void') return null

  const genericMatch = /^([\w.]+)<(.+)>$/.exec(type)
  if (genericMatch) {
    const wrapperName = genericMatch[1]!
    if (!SUPPORTED_WRAPPERS.has(wrapperName)) {
      warnings.add(`Unsupported generic wrapper '${wrapperName}' on a Room DAO method in '${ownerName}': only List/Flow/StateFlow/LiveData are supported.`)
      return '__unsupported-wrapper__'
    }
    return unwrapEntityType(genericMatch[2]!, warnings, ownerName)
  }

  const simpleName = type.includes('.') ? type.slice(type.lastIndexOf('.') + 1) : type
  if (NON_ENTITY_BUILTIN_TYPES.has(simpleName)) return null
  return type
}

// ---------------------------------------------------------------------------
// Room database: DAO-returning method extraction
// ---------------------------------------------------------------------------

function extractDatabaseDaoMethods(classBody: string, language: 'kotlin' | 'java', baseLine: number): ExtractedDependency[] {
  const results: ExtractedDependency[] = []
  for (const method of extractMethodSignatures(classBody, language, baseLine)) {
    if (!method.returnType) continue
    const returnType = method.returnType.endsWith('?') ? method.returnType.slice(0, -1).trim() : method.returnType
    if (returnType === 'Unit' || returnType === 'void' || returnType === '') continue
    results.push({ rawType: returnType, evidenceKind: 'method-return', line: method.line })
  }
  return results
}

// ---------------------------------------------------------------------------
// Kotlin/Java parameter-list tokenizers (top-level comma splitting)
// ---------------------------------------------------------------------------

function splitTopLevelParams(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of text) {
    if (ch === '(' || ch === '<' || ch === '[') depth++
    else if (ch === ')' || ch === '>' || ch === ']') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim() !== '') parts.push(current)
  return parts.map((p) => p.trim()).filter((p) => p.length > 0)
}

const KOTLIN_PARAM_MODIFIER = /^(private|protected|internal|public|val|var|vararg|noinline|crossinline)\s+/

function parseKotlinParamList(paramListText: string): { name: string; rawType: string }[] {
  const results: { name: string; rawType: string }[] = []
  for (const rawPart of splitTopLevelParams(paramListText)) {
    let part = rawPart
    const eqIdx = topLevelIndexOf(part, '=')
    if (eqIdx !== -1) part = part.slice(0, eqIdx).trim()
    while (KOTLIN_PARAM_MODIFIER.test(part)) part = part.replace(KOTLIN_PARAM_MODIFIER, '')
    const colonIdx = part.indexOf(':')
    if (colonIdx === -1) continue
    const name = part.slice(0, colonIdx).trim()
    const rawType = part.slice(colonIdx + 1).trim()
    if (name && rawType) results.push({ name, rawType })
  }
  return results
}

function parseJavaParamList(paramListText: string): { name: string; rawType: string }[] {
  const results: { name: string; rawType: string }[] = []
  for (const rawPart of splitTopLevelParams(paramListText)) {
    const part = rawPart.replace(/^(final\s+)/, '').trim()
    const lastSpace = topLevelLastIndexOfSpace(part)
    if (lastSpace === -1) continue
    const rawType = part.slice(0, lastSpace).trim()
    const name = part.slice(lastSpace + 1).trim().replace(/\[\]$/, '')
    if (name && rawType) results.push({ name, rawType })
  }
  return results
}

function topLevelIndexOf(text: string, needle: string): number {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '(' || ch === '<' || ch === '[') depth++
    else if (ch === ')' || ch === '>' || ch === ']') depth--
    else if (depth === 0 && text.startsWith(needle, i)) return i
  }
  return -1
}

function topLevelLastIndexOfSpace(text: string): number {
  let depth = 0
  let last = -1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '(' || ch === '<' || ch === '[') depth++
    else if (ch === ')' || ch === '>' || ch === ']') depth--
    else if (depth === 0 && ch === ' ') last = i
  }
  return last
}

// ---------------------------------------------------------------------------
// Candidate resolution (exact, role-restricted, tiered)
// ---------------------------------------------------------------------------

interface ResolveDependencyFactOptions {
  component: AndroidComponentEntry
  dep: ExtractedDependency
  targetRoles: Array<{ role: AndroidComponentRole; kind: AndroidComponentDependencyRelationshipKind }>
  componentsByRole: Map<AndroidComponentRole, AndroidComponentEntry[]>
  sourceFileImports: readonly string[]
  warnings: Set<string>
}

function resolveDependencyFact(options: ResolveDependencyFactOptions): AndroidComponentDependencyFact | null {
  const { component, dep, targetRoles, componentsByRole, sourceFileImports, warnings } = options

  if (dep.rawType === '__unsupported-wrapper__') {
    return buildFact(component, targetRoles[0]!.kind, targetRoles[0]!.role, dep, [], [], 'unresolved', [
      `Unsupported generic wrapper on a dependency declaration in '${component.symbolName}' - no fact resolved.`,
    ])
  }

  for (const target of targetRoles) {
    const candidates = componentsByRole.get(target.role) ?? []
    const resolved = resolveTieredCandidates(dep.rawType, component.packageName, sourceFileImports, candidates)
    if (resolved.length > 0) {
      const factWarnings: string[] = []
      for (const candidate of resolved) {
        if (candidate.confidence === 'low') {
          factWarnings.push(
            `low-confidence-role-evidence: candidate '${candidate.symbolName}' has low-confidence '${target.role}' role evidence.`
          )
        }
      }
      if (component.confidence === 'low') {
        factWarnings.push(`low-confidence-role-evidence: source component '${component.symbolName}' has low-confidence '${component.role}' role evidence.`)
      }
      for (const w of factWarnings) warnings.add(w)
      const matchStatus: AndroidComponentDependencyMatchStatus = resolved.length === 1 ? 'resolved' : 'ambiguous'
      return buildFact(component, target.kind, target.role, dep, resolved.map((c) => c.id), resolved.map((c) => c.symbolId), matchStatus, factWarnings)
    }
  }

  // No candidate for any target role. Only record an unresolved fact when the
  // declared type's own naming convention matches one of the supported target
  // roles' vocabulary - otherwise this simply isn't a supported dependency
  // declaration (e.g. Context, Application, SavedStateHandle) and is skipped.
  const inferredTarget = inferUnresolvedTarget(dep.rawType, targetRoles)
  if (!inferredTarget) return null
  const reason = `no local role-bearing candidate found for declared type '${dep.rawType}' in '${component.symbolName}'`
  return buildFact(component, inferredTarget.kind, inferredTarget.role, dep, [], [], 'unresolved', [reason])
}

function inferUnresolvedTarget(
  rawType: string,
  targetRoles: Array<{ role: AndroidComponentRole; kind: AndroidComponentDependencyRelationshipKind }>
): { role: AndroidComponentRole; kind: AndroidComponentDependencyRelationshipKind } | null {
  if (targetRoles.length === 1) return targetRoles[0]!
  const simpleName = rawType.includes('.') ? rawType.slice(rawType.lastIndexOf('.') + 1) : rawType
  for (const target of targetRoles) {
    if (target.role === 'room-dao' && simpleName.endsWith('Dao')) return target
    if (target.role === 'retrofit-service' && (simpleName.endsWith('Service') || simpleName.endsWith('Api'))) return target
  }
  return null
}

function buildFact(
  component: AndroidComponentEntry,
  relationshipKind: AndroidComponentDependencyRelationshipKind,
  targetRole: AndroidComponentRole,
  dep: ExtractedDependency,
  candidateComponentIds: string[],
  candidateSymbolIds: string[],
  matchStatus: AndroidComponentDependencyMatchStatus,
  warnings: string[]
): AndroidComponentDependencyFact {
  const sortedComponentIds = [...candidateComponentIds].sort()
  const sortedSymbolIds = [...candidateSymbolIds].sort()
  return {
    id: `android-component-dependency:${component.symbolId}:${relationshipKind}:${dep.rawType}:L${dep.line}`,
    relationshipKind,
    sourceComponentId: component.id,
    sourceSymbolId: component.symbolId,
    sourceRole: component.role,
    targetRole,
    declaredTypeName: dep.rawType,
    evidenceKind: dep.evidenceKind,
    sourceRef: { file: component.filePath, line: dep.line },
    matchStatus,
    candidateComponentIds: sortedComponentIds,
    candidateSymbolIds: sortedSymbolIds,
    warnings: [...new Set(warnings)].sort(),
  }
}

// ---------------------------------------------------------------------------
// Tiered exact resolution: fully-qualified > explicit import > same-package > simple name
// ---------------------------------------------------------------------------

function resolveTieredCandidates(
  rawType: string,
  sourcePackageName: string | null,
  sourceFileImports: readonly string[],
  candidates: readonly AndroidComponentEntry[]
): AndroidComponentEntry[] {
  const simpleName = rawType.includes('.') ? rawType.slice(rawType.lastIndexOf('.') + 1) : rawType

  if (rawType.includes('.')) {
    const lastDot = rawType.lastIndexOf('.')
    const pkg = rawType.slice(0, lastDot)
    const cls = rawType.slice(lastDot + 1)
    const fq = candidates.filter((c) => c.packageName === pkg && c.symbolName === cls)
    if (fq.length > 0) return sortCandidates(fq)
    return []
  }

  const importMatch = sourceFileImports.find((imp) => imp.endsWith(`.${simpleName}`))
  if (importMatch) {
    const importPkg = importMatch.slice(0, importMatch.lastIndexOf('.'))
    const viaImport = candidates.filter((c) => c.packageName === importPkg && c.symbolName === simpleName)
    if (viaImport.length > 0) return sortCandidates(viaImport)
  }

  if (sourcePackageName !== null) {
    const samePackage = candidates.filter((c) => c.packageName === sourcePackageName && c.symbolName === simpleName)
    if (samePackage.length > 0) return sortCandidates(samePackage)
  }

  const bySimpleName = candidates.filter((c) => c.symbolName === simpleName)
  if (bySimpleName.length > 0) return sortCandidates(bySimpleName)

  return []
}

function sortCandidates(candidates: AndroidComponentEntry[]): AndroidComponentEntry[] {
  return [...candidates].sort((a, b) => a.symbolId.localeCompare(b.symbolId))
}
