import type { FileSummary, SymbolDefinition, SymbolIndex } from '../symbol-index/types.js'
import type { AndroidModule, AndroidProjectArtifact } from './androidProjectTypes.js'
import { readBoundedDeclarationHeader, readBoundedSourceBody } from './boundedSourceBodyScan.js'
import { detectAndroidComponentDependencies } from './detectAndroidComponentDependencies.js'
import {
  ANDROID_COMPONENTS_ARTIFACT_KIND,
  ANDROID_COMPONENTS_SCHEMA_VERSION,
  EVIDENCE_KIND_SORT_PRIORITY,
  type AndroidComponentDependencyFact,
  type AndroidComponentDependencyRelationshipKind,
  type AndroidComponentEntry,
  type AndroidComponentEvidence,
  type AndroidComponentRole,
  type AndroidComponentsArtifact,
  type AndroidComponentConfidence,
} from './androidComponentTypes.js'

export interface DetectAndroidComponentsOptions {
  symbolIndex: SymbolIndex
  androidProject: AndroidProjectArtifact
  projectRoot: string
  createdAt: string
}

/**
 * Conservative static Android component-role detection (v1.9.0 Batch 4).
 *
 * Runs only over Kotlin/Java top-level class/interface/object symbols
 * already present in `symbolIndex` (Batch 2/3) — no method/field symbols are
 * required or inspected, matching the top-level-only precedent. Evidence
 * priority, per the batch spec: explicit annotations > superclass/interface
 * names > imports > package/path hints > naming suffixes (weakest, and never
 * alone sufficient for 'high' confidence).
 *
 * Only Retrofit-service detection needs to look past the symbol's own
 * declaration line (HTTP method annotations live inside the interface body,
 * not on the interface declaration itself) — `readBoundedSymbolBody` performs
 * a small, bounded, brace-depth-scanned re-read of the already-indexed file
 * for that one case; every other role is evaluated purely from data already
 * in `symbolIndex` (signature text, imports, name, file path).
 */
export function detectAndroidComponents(options: DetectAndroidComponentsOptions): { artifact: AndroidComponentsArtifact } {
  const { symbolIndex, androidProject, projectRoot, createdAt } = options
  const components: AndroidComponentEntry[] = []
  const warnings = new Set<string>()

  if (!androidProject.detected) {
    return { artifact: buildEmptyArtifact(createdAt) }
  }

  for (const file of symbolIndex.files) {
    if (file.language !== 'kotlin' && file.language !== 'java') continue
    const moduleInfo = resolveModuleAndSourceSet(file.path, androidProject)

    for (const symbol of file.symbols) {
      if (!isRoleCandidateKind(symbol.kind)) continue

      const matches = evaluateAllRoles(symbol, file, moduleInfo, projectRoot)
      for (const match of matches) {
        for (const w of match.warnings) warnings.add(w)
        components.push({
          id: `android-component:${file.path}#${symbol.name}:${match.role}`,
          role: match.role,
          confidence: match.confidence,
          filePath: file.path,
          symbolId: `symbol:${file.path}#${symbol.name}`,
          symbolName: symbol.name,
          sourceLanguage: file.language as 'kotlin' | 'java',
          modulePath: moduleInfo.modulePath,
          sourceSet: moduleInfo.sourceSet,
          packageName: derivePackageNameFromPath(file.path, moduleInfo),
          evidence: sortEvidence(match.evidence),
          warnings: match.warnings,
        })
      }
    }
  }

  components.sort(
    (a, b) => a.filePath.localeCompare(b.filePath) || a.symbolName.localeCompare(b.symbolName) || a.role.localeCompare(b.role)
  )

  // v1.12.0 Batch 3: extends this same detection pass with static
  // ViewModel/Repository/DAO/Database dependency facts, once every
  // component-role fact is known. Same artifact, same analyzer - never a
  // second component scanner or a second artifact.
  const { dependencyFacts, warnings: dependencyWarnings } = detectAndroidComponentDependencies({
    symbolIndex,
    components,
    projectRoot,
  })
  for (const w of dependencyWarnings) warnings.add(w)

  const summary = summarize(components, dependencyFacts)

  return {
    artifact: {
      artifactKind: ANDROID_COMPONENTS_ARTIFACT_KIND,
      schemaVersion: ANDROID_COMPONENTS_SCHEMA_VERSION,
      createdAt,
      detected: components.length > 0,
      components,
      dependencyFacts,
      summary,
      warnings: [...warnings].sort(),
    },
  }
}

function buildEmptyArtifact(createdAt: string): AndroidComponentsArtifact {
  return {
    artifactKind: ANDROID_COMPONENTS_ARTIFACT_KIND,
    schemaVersion: ANDROID_COMPONENTS_SCHEMA_VERSION,
    createdAt,
    detected: false,
    components: [],
    dependencyFacts: [],
    summary: {
      componentCount: 0,
      highConfidenceCount: 0,
      mediumConfidenceCount: 0,
      lowConfidenceCount: 0,
      roleCounts: {},
      dependencyFactCount: 0,
      resolvedDependencyFactCount: 0,
      ambiguousDependencyFactCount: 0,
      unresolvedDependencyFactCount: 0,
      dependencyFactCountByKind: {
        'viewmodel-uses-repository': 0,
        'repository-uses-dao': 0,
        'repository-uses-service': 0,
        'dao-uses-entity': 0,
        'room-database-exposes-dao': 0,
      },
    },
    warnings: [],
  }
}

function summarize(components: readonly AndroidComponentEntry[], dependencyFacts: readonly AndroidComponentDependencyFact[]) {
  const roleCounts: Partial<Record<AndroidComponentRole, number>> = {}
  let high = 0
  let medium = 0
  let low = 0
  for (const c of components) {
    roleCounts[c.role] = (roleCounts[c.role] ?? 0) + 1
    if (c.confidence === 'high') high += 1
    else if (c.confidence === 'medium') medium += 1
    else low += 1
  }

  const dependencyFactCountByKind: Record<AndroidComponentDependencyRelationshipKind, number> = {
    'viewmodel-uses-repository': 0,
    'repository-uses-dao': 0,
    'repository-uses-service': 0,
    'dao-uses-entity': 0,
    'room-database-exposes-dao': 0,
  }
  let resolvedCount = 0
  let ambiguousCount = 0
  let unresolvedCount = 0
  for (const fact of dependencyFacts) {
    dependencyFactCountByKind[fact.relationshipKind] += 1
    if (fact.matchStatus === 'resolved') resolvedCount += 1
    else if (fact.matchStatus === 'ambiguous') ambiguousCount += 1
    else unresolvedCount += 1
  }

  return {
    componentCount: components.length,
    highConfidenceCount: high,
    mediumConfidenceCount: medium,
    lowConfidenceCount: low,
    roleCounts,
    dependencyFactCount: dependencyFacts.length,
    resolvedDependencyFactCount: resolvedCount,
    ambiguousDependencyFactCount: ambiguousCount,
    unresolvedDependencyFactCount: unresolvedCount,
    dependencyFactCountByKind,
  }
}

function sortEvidence(evidence: readonly AndroidComponentEvidence[]): AndroidComponentEvidence[] {
  return [...evidence].sort(
    (a, b) => EVIDENCE_KIND_SORT_PRIORITY[a.kind] - EVIDENCE_KIND_SORT_PRIORITY[b.kind] || a.value.localeCompare(b.value)
  )
}

function isRoleCandidateKind(kind: SymbolDefinition['kind']): boolean {
  return kind === 'class' || kind === 'interface' || kind === 'object'
}

// ---------------------------------------------------------------------------
// Module / source-set resolution
// ---------------------------------------------------------------------------

interface ModuleInfo {
  modulePath: string | null
  sourceSet: string | null
}

function resolveModuleAndSourceSet(filePath: string, project: AndroidProjectArtifact): ModuleInfo {
  let best: { modulePath: string; sourceSet: string; matchLength: number } | null = null
  for (const module of project.modules) {
    for (const sourceSet of module.sourceSets) {
      if (!sourceSet.path) continue
      if (filePath === sourceSet.path || filePath.startsWith(`${sourceSet.path}/`)) {
        if (!best || sourceSet.path.length > best.matchLength) {
          best = { modulePath: module.path, sourceSet: sourceSet.name, matchLength: sourceSet.path.length }
        }
      }
    }
  }
  if (best) return { modulePath: best.modulePath, sourceSet: best.sourceSet }

  const moduleMatch = findModuleByPath(filePath, project.modules)
  return moduleMatch ? { modulePath: moduleMatch.path, sourceSet: null } : { modulePath: null, sourceSet: null }
}

function findModuleByPath(filePath: string, modules: readonly AndroidModule[]): AndroidModule | null {
  return modules.find((module) => filePath === module.path || filePath.startsWith(`${module.path}/`)) ?? null
}

/** Best-effort: the portion of the file path between the resolved source-set root and the file's own directory, dot-joined. Not a substitute for actually parsing a `package` declaration. */
function derivePackageNameFromPath(filePath: string, moduleInfo: ModuleInfo): string | null {
  if (!moduleInfo.sourceSet || !moduleInfo.modulePath) return null
  const langRootMatch = filePath.match(/\/(kotlin|java)\/(.+)\/[^/]+\.(kt|java)$/)
  if (!langRootMatch) return null
  return langRootMatch[2].replace(/\//g, '.')
}

// ---------------------------------------------------------------------------
// Signature / import matching helpers
// ---------------------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function signatureContainsAny(signature: string | undefined, tokens: readonly string[]): string | null {
  if (!signature) return null
  for (const token of tokens) {
    // '@' is a non-word character, so a leading `\b` (which requires a
    // word/non-word transition) never matches right before it — use a
    // start-of-string-or-whitespace lookbehind-free alternative instead.
    const leadingBoundary = token.startsWith('@') ? '(?:^|\\s)' : '\\b'
    const pattern = new RegExp(`${leadingBoundary}${escapeRegExp(token)}\\b`)
    if (pattern.test(signature)) return token
  }
  return null
}

function importsContainAny(imports: readonly string[], substrings: readonly string[]): string | null {
  for (const imp of imports) {
    for (const sub of substrings) {
      if (imp === sub || imp.includes(sub)) return imp
    }
  }
  return null
}

function pathContainsAny(filePath: string, hints: readonly string[]): boolean {
  const lower = filePath.toLowerCase()
  return hints.some((hint) => lower.includes(hint))
}

// ---------------------------------------------------------------------------
// Role evaluation
// ---------------------------------------------------------------------------

interface RoleMatch {
  role: AndroidComponentRole
  confidence: AndroidComponentConfidence
  evidence: AndroidComponentEvidence[]
  warnings: string[]
}

interface StandardRoleRule {
  role: AndroidComponentRole
  strongSuperclassTokens: readonly string[]
  mediumImportSubstrings: readonly string[]
  weakNameSuffix: string
  weakRequiresSourceSetMain?: boolean
}

const STANDARD_RULES: readonly StandardRoleRule[] = [
  {
    role: 'activity',
    strongSuperclassTokens: ['Activity', 'ComponentActivity', 'AppCompatActivity', 'FragmentActivity'],
    mediumImportSubstrings: ['android.app.Activity', 'androidx.activity.ComponentActivity', 'androidx.appcompat.app.AppCompatActivity'],
    weakNameSuffix: 'Activity',
    weakRequiresSourceSetMain: true,
  },
  {
    role: 'fragment',
    strongSuperclassTokens: ['Fragment', 'DialogFragment', 'BottomSheetDialogFragment'],
    mediumImportSubstrings: ['androidx.fragment.app.Fragment'],
    weakNameSuffix: 'Fragment',
  },
  {
    role: 'view-model',
    strongSuperclassTokens: ['ViewModel', 'AndroidViewModel'],
    mediumImportSubstrings: ['androidx.lifecycle.ViewModel'],
    weakNameSuffix: 'ViewModel',
  },
  {
    role: 'service',
    strongSuperclassTokens: ['Service', 'IntentService', 'LifecycleService'],
    mediumImportSubstrings: ['android.app.Service'],
    weakNameSuffix: 'Service',
  },
  {
    role: 'broadcast-receiver',
    strongSuperclassTokens: ['BroadcastReceiver'],
    mediumImportSubstrings: ['android.content.BroadcastReceiver'],
    weakNameSuffix: 'Receiver',
  },
  {
    role: 'content-provider',
    strongSuperclassTokens: ['ContentProvider'],
    mediumImportSubstrings: ['android.content.ContentProvider'],
    weakNameSuffix: 'Provider',
  },
  {
    role: 'worker',
    strongSuperclassTokens: ['Worker', 'CoroutineWorker', 'ListenableWorker'],
    mediumImportSubstrings: ['androidx.work.Worker', 'androidx.work.CoroutineWorker', 'androidx.work.ListenableWorker'],
    weakNameSuffix: 'Worker',
  },
]

function evaluateAllRoles(
  symbol: SymbolDefinition,
  file: FileSummary,
  moduleInfo: ModuleInfo,
  projectRoot: string
): RoleMatch[] {
  const matches: RoleMatch[] = []

  // Android framework/AndroidX component classes: Service and Retrofit share the
  // 'Service' name suffix in practice, so Service evidence is restricted to
  // `class` symbols and Retrofit evidence to `interface` symbols below.
  if (symbol.kind === 'class') {
    for (const rule of STANDARD_RULES) {
      const match = evaluateStandardRole(rule, symbol, file, moduleInfo, projectRoot)
      if (match) matches.push(match)
    }
  }

  const repository = evaluateNameOrPathRole('repository', 'Repository', ['repository', 'repositories'], symbol, file)
  if (repository) matches.push(repository)

  const useCase = evaluateNameOrPathRole('use-case', 'UseCase', ['usecase', 'usecases', 'interactor', 'domain'], symbol, file)
  if (useCase) matches.push(useCase)

  const entity = evaluateRoomAnnotatedRole({
    role: 'room-entity',
    annotationTokens: ['@Entity'],
    superclassTokens: [],
    importSubstrings: ['androidx.room.Entity'],
    nameSuffix: 'Entity',
    pathHints: ['database', 'model', 'entity'],
    symbol,
    file,
  })
  if (entity) matches.push(entity)

  const dao = evaluateRoomAnnotatedRole({
    role: 'room-dao',
    annotationTokens: ['@Dao'],
    superclassTokens: [],
    importSubstrings: ['androidx.room.Dao'],
    nameSuffix: 'Dao',
    pathHints: ['database', 'dao'],
    symbol,
    file,
  })
  if (dao) matches.push(dao)

  const database = evaluateRoomAnnotatedRole({
    role: 'room-database',
    annotationTokens: ['@Database'],
    superclassTokens: ['RoomDatabase'],
    importSubstrings: ['androidx.room.Database', 'androidx.room.RoomDatabase'],
    nameSuffix: 'Database',
    pathHints: ['database'],
    symbol,
    file,
  })
  if (database) matches.push(database)

  if (symbol.kind === 'interface') {
    const retrofit = evaluateRetrofitService(symbol, file, projectRoot)
    if (retrofit) matches.push(retrofit)
  }

  const hiltModule = evaluateHiltModule(symbol, file)
  if (hiltModule) matches.push(hiltModule)

  return matches
}

function evaluateStandardRole(
  rule: StandardRoleRule,
  symbol: SymbolDefinition,
  file: FileSummary,
  moduleInfo: ModuleInfo,
  projectRoot: string
): RoleMatch | null {
  const superclass = findStandardRoleSuperclass(rule, symbol, file, projectRoot)
  if (superclass) {
    return {
      role: rule.role,
      confidence: 'high',
      evidence: [{ kind: 'superclass', value: superclass.token, source: superclass.source, confidence: 'high' }],
      warnings: [],
    }
  }

  // A file-level import is not proof that every class in the file has the imported
  // framework role (v1.13.0 D2-D). Import evidence counts only when the same
  // symbol also carries its own role signal (the role's name suffix).
  const importMatch = importsContainAny(file.imports, rule.mediumImportSubstrings)
  if (importMatch && symbol.name.endsWith(rule.weakNameSuffix)) {
    return {
      role: rule.role,
      confidence: 'medium',
      evidence: [
        { kind: 'import', value: importMatch, source: file.path, confidence: 'medium' },
        { kind: 'name', value: symbol.name, source: file.path, confidence: 'low' },
      ],
      warnings: [],
    }
  }

  if (!importMatch && symbol.name.endsWith(rule.weakNameSuffix)) {
    if (rule.weakRequiresSourceSetMain && moduleInfo.sourceSet !== 'main') return null
    const warning = `Ambiguous ${rule.role} role for '${symbol.name}': matched only by name suffix '${rule.weakNameSuffix}', no annotation/superclass/import evidence found.`
    return {
      role: rule.role,
      confidence: 'low',
      evidence: [{ kind: 'name', value: symbol.name, source: file.path, confidence: 'low' }],
      warnings: [warning],
    }
  }

  return null
}

interface StandardRoleSuperclass {
  token: string
  source: string
}

/**
 * Explicit supported superclass for a standard Android class role. Java keeps the
 * existing signature token match. Kotlin reads the declared supertype list only:
 * a type that appears solely as a constructor parameter type is never a
 * superclass. A first-line signature that does not settle the question
 * (multiline primary constructor) is completed by one bounded declaration-header
 * read; anything still unsettled yields no superclass evidence.
 */
function findStandardRoleSuperclass(
  rule: StandardRoleRule,
  symbol: SymbolDefinition,
  file: FileSummary,
  projectRoot: string
): StandardRoleSuperclass | null {
  if (file.language !== 'kotlin') {
    const token = signatureContainsAny(symbol.signature, rule.strongSuperclassTokens)
    return token ? { token, source: symbol.signature ?? '' } : null
  }

  let inspection: KotlinSupertypeInspection = symbol.signature
    ? inspectKotlinClassSupertypes(symbol.signature, symbol.name, true)
    : { status: 'insufficient' }
  let source = symbol.signature ?? ''
  if (inspection.status === 'insufficient') {
    const header = readBoundedDeclarationHeader(projectRoot, file.path, symbol.location.line)
    if (header) {
      inspection = inspectKotlinClassSupertypes(header.text, symbol.name, header.truncated)
      source = `${file.path}:${header.startLine}-${header.endLine}`
    }
  }
  if (inspection.status !== 'supertypes') return null
  for (const token of rule.strongSuperclassTokens) {
    if (inspection.names.includes(token)) return { token, source }
  }
  return null
}

export type KotlinSupertypeInspection =
  | { status: 'supertypes'; names: string[] }
  | { status: 'none' }
  | { status: 'insufficient' }

/** Replaces comment and string/char-literal content with spaces, preserving newlines and length. */
function blankKotlinCommentsAndStrings(text: string): string {
  const out = text.split('')
  let i = 0
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '
  }
  while (i < text.length) {
    const two = text.slice(i, i + 2)
    if (two === '//') {
      let end = text.indexOf('\n', i)
      if (end < 0) end = text.length
      blank(i, end)
      i = end
    } else if (two === '/*') {
      const close = text.indexOf('*/', i + 2)
      const end = close < 0 ? text.length : close + 2
      blank(i, end)
      i = end
    } else if (text.startsWith('"""', i)) {
      const close = text.indexOf('"""', i + 3)
      const end = close < 0 ? text.length : close + 3
      blank(i, end)
      i = end
    } else if (text[i] === '"' || text[i] === "'") {
      const quote = text[i] as string
      let j = i + 1
      while (j < text.length && text[j] !== quote && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1
      const end = Math.min(j + 1, text.length)
      blank(i, end)
      i = end
    } else {
      i += 1
    }
  }
  return out.join('')
}

function skipBalanced(text: string, start: number, open: string, close: string): number {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (c === open) depth += 1
    else if (c === close && !(close === '>' && text[i - 1] === '-')) {
      depth -= 1
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/**
 * Bounded, conservative reader for the supertype list of one Kotlin class
 * declaration header (v1.13.0 D2-D). Not a Kotlin parser: it understands the
 * class name, optional type parameters, annotations, the `constructor` keyword,
 * one primary-constructor parameter list, and a `: A(), B` supertype list, in that
 * order. Comments and string literals are ignored. `truncated` means the text may
 * continue past what was supplied.
 */
export function inspectKotlinClassSupertypes(headerText: string, className: string, truncated: boolean): KotlinSupertypeInspection {
  const text = blankKotlinCommentsAndStrings(headerText)
  const escapedName = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const declaration = new RegExp(`\\bclass\\s+\`?${escapedName}\`?(?![\\w\`])`).exec(text)
  if (!declaration) return { status: 'insufficient' }
  const declarationLine = text.slice(0, declaration.index).split('\n').length
  if (declarationLine > 3) return { status: 'insufficient' }

  let pos = declaration.index + declaration[0].length
  let sawConstructor = false
  for (;;) {
    while (pos < text.length && /\s/.test(text[pos] as string)) pos += 1
    if (pos >= text.length) return truncated ? { status: 'insufficient' } : { status: 'none' }
    const c = text[pos] as string
    if (c === '<' && !sawConstructor) {
      const end = skipBalanced(text, pos, '<', '>')
      if (end < 0) return { status: 'insufficient' }
      pos = end
    } else if (c === '@') {
      const annotation = /^@[\w.]+(?::[\w.]+)?/.exec(text.slice(pos))
      if (!annotation) return { status: 'insufficient' }
      pos += annotation[0].length
      let look = pos
      while (look < text.length && text[look] === ' ') look += 1
      if (text[look] === '(') {
        const end = skipBalanced(text, look, '(', ')')
        if (end < 0) return { status: 'insufficient' }
        pos = end
      }
    } else if (!sawConstructor && /^constructor\b/.test(text.slice(pos))) {
      pos += 'constructor'.length
    } else if (c === '(' && !sawConstructor) {
      const end = skipBalanced(text, pos, '(', ')')
      if (end < 0) return { status: 'insufficient' }
      sawConstructor = true
      pos = end
    } else {
      break
    }
  }

  if (text[pos] !== ':') return { status: 'none' }
  pos += 1
  let list = ''
  let depth = 0
  let terminated = false
  for (; pos < text.length; pos++) {
    const c = text[pos] as string
    if (depth === 0 && c === '{') {
      terminated = true
      break
    }
    if (depth === 0 && /^where\b/.test(text.slice(pos)) && /\s/.test(text[pos - 1] ?? ' ')) {
      terminated = true
      break
    }
    if (c === '(' || c === '[' || c === '<') depth += 1
    else if (c === ')' || c === ']' || (c === '>' && text[pos - 1] !== '-')) depth -= 1
    if (c === '\n' && depth === 0) {
      const before = list.trimEnd()
      const after = text.slice(pos + 1).trimStart()
      if (before.length > 0 && !before.endsWith(',') && !after.startsWith(',')) {
        if (after.length === 0 && truncated) return { status: 'insufficient' }
        terminated = true
        break
      }
    }
    list += c
  }
  if (depth !== 0) return { status: 'insufficient' }
  if (!terminated && truncated) return { status: 'insufficient' }

  const names: string[] = []
  let current = ''
  let level = 0
  const flush = () => {
    const entry = current.trim().replace(/^(?:@[\w.]+(?:\([^)]*\))?\s*)+/, '').split(/\sby\s/)[0] ?? ''
    const nameMatch = /^[\w.`]+/.exec(entry.trim())
    if (nameMatch) names.push((nameMatch[0].split('.').pop() ?? '').replace(/`/g, ''))
    current = ''
  }
  for (const c of list) {
    if (c === '(' || c === '<' || c === '[') level += 1
    else if (c === ')' || c === '>' || c === ']') level -= 1
    if (c === ',' && level === 0) flush()
    else current += c
  }
  flush()
  return names.length > 0 ? { status: 'supertypes', names } : { status: 'insufficient' }
}

function evaluateNameOrPathRole(
  role: 'repository' | 'use-case',
  nameSuffix: string,
  pathHints: readonly string[],
  symbol: SymbolDefinition,
  file: FileSummary
): RoleMatch | null {
  if (symbol.kind !== 'class' && symbol.kind !== 'object') return null

  const nameMatch = symbol.name.endsWith(nameSuffix)
  const pathMatch = pathContainsAny(file.path, pathHints)
  if (!nameMatch && !pathMatch) return null

  const evidence: AndroidComponentEvidence[] = []
  if (nameMatch) evidence.push({ kind: 'name', value: symbol.name, source: file.path, confidence: 'medium' })
  if (pathMatch) evidence.push({ kind: 'path', value: file.path, source: file.path, confidence: 'medium' })

  return { role, confidence: 'medium', evidence, warnings: [] }
}

interface RoomRuleOptions {
  role: AndroidComponentRole
  annotationTokens: readonly string[]
  superclassTokens: readonly string[]
  importSubstrings: readonly string[]
  nameSuffix: string
  pathHints: readonly string[]
  symbol: SymbolDefinition
  file: FileSummary
}

function evaluateRoomAnnotatedRole(options: RoomRuleOptions): RoleMatch | null {
  const { role, annotationTokens, superclassTokens, importSubstrings, nameSuffix, pathHints, symbol, file } = options

  const annotationMatch = signatureContainsAny(symbol.signature, annotationTokens)
  if (annotationMatch) {
    return {
      role,
      confidence: 'high',
      evidence: [{ kind: 'annotation', value: annotationMatch, source: symbol.signature ?? '', confidence: 'high' }],
      warnings: [],
    }
  }

  const superMatch = signatureContainsAny(symbol.signature, superclassTokens)
  if (superMatch) {
    return {
      role,
      confidence: 'high',
      evidence: [{ kind: 'superclass', value: superMatch, source: symbol.signature ?? '', confidence: 'high' }],
      warnings: [],
    }
  }

  const importMatch = importsContainAny(file.imports, importSubstrings)
  const nameMatch = symbol.name.endsWith(nameSuffix)
  if (importMatch && nameMatch) {
    return {
      role,
      confidence: 'medium',
      evidence: [
        { kind: 'import', value: importMatch, source: file.path, confidence: 'medium' },
        { kind: 'name', value: symbol.name, source: file.path, confidence: 'medium' },
      ],
      warnings: [],
    }
  }

  const pathMatch = pathContainsAny(file.path, pathHints)
  if (nameMatch && pathMatch) {
    const warning = `Ambiguous ${role} role for '${symbol.name}': matched only by name suffix + path hint, no annotation/superclass/import evidence found.`
    return {
      role,
      confidence: 'low',
      evidence: [
        { kind: 'name', value: symbol.name, source: file.path, confidence: 'low' },
        { kind: 'path', value: file.path, source: file.path, confidence: 'low' },
      ],
      warnings: [warning],
    }
  }

  return null
}

const RETROFIT_HTTP_ANNOTATIONS = ['@GET', '@POST', '@PUT', '@DELETE', '@PATCH', '@HEAD', '@OPTIONS'] as const

function evaluateRetrofitService(symbol: SymbolDefinition, file: FileSummary, projectRoot: string): RoleMatch | null {
  if (typeof symbol.location?.line === 'number') {
    const body = readBoundedSourceBody(projectRoot, file.path, symbol.location.line)
    if (body) {
      const bodyMatch = RETROFIT_HTTP_ANNOTATIONS.find((token) => body.includes(token))
      if (bodyMatch) {
        return {
          role: 'retrofit-service',
          confidence: 'high',
          evidence: [{ kind: 'source-pattern', value: bodyMatch, source: file.path, confidence: 'high' }],
          warnings: [],
        }
      }
    }
  }

  const importMatch = importsContainAny(file.imports, ['retrofit2.http'])
  const nameMatch = symbol.name.endsWith('Service') || symbol.name.endsWith('Api')
  if (importMatch && nameMatch) {
    return {
      role: 'retrofit-service',
      confidence: 'medium',
      evidence: [
        { kind: 'import', value: importMatch, source: file.path, confidence: 'medium' },
        { kind: 'name', value: symbol.name, source: file.path, confidence: 'medium' },
      ],
      warnings: [],
    }
  }

  if (symbol.name.endsWith('ApiService')) {
    const warning = `Ambiguous retrofit-service role for '${symbol.name}': matched only by name suffix 'ApiService', no Retrofit HTTP-method annotation or import evidence found.`
    return {
      role: 'retrofit-service',
      confidence: 'low',
      evidence: [{ kind: 'name', value: symbol.name, source: file.path, confidence: 'low' }],
      warnings: [warning],
    }
  }

  return null
}

function evaluateHiltModule(symbol: SymbolDefinition, file: FileSummary): RoleMatch | null {
  if (symbol.kind !== 'class' && symbol.kind !== 'object') return null

  const annotationMatch = signatureContainsAny(symbol.signature, ['@Module', '@InstallIn'])
  if (annotationMatch) {
    return {
      role: 'hilt-module',
      confidence: 'high',
      evidence: [{ kind: 'annotation', value: annotationMatch, source: symbol.signature ?? '', confidence: 'high' }],
      warnings: [],
    }
  }

  const importMatch = importsContainAny(file.imports, ['dagger.Module', 'dagger.hilt.InstallIn', 'dagger.Provides', 'dagger.Binds'])
  const nameMatch = symbol.name.endsWith('Module')
  if (importMatch && nameMatch) {
    return {
      role: 'hilt-module',
      confidence: 'medium',
      evidence: [
        { kind: 'import', value: importMatch, source: file.path, confidence: 'medium' },
        { kind: 'name', value: symbol.name, source: file.path, confidence: 'medium' },
      ],
      warnings: [],
    }
  }

  const pathMatch = pathContainsAny(file.path, ['di', 'inject', 'dagger', 'hilt'])
  if (nameMatch && pathMatch) {
    const warning = `Ambiguous hilt-module role for '${symbol.name}': matched only by name suffix + path hint, no annotation/import evidence found.`
    return {
      role: 'hilt-module',
      confidence: 'low',
      evidence: [
        { kind: 'name', value: symbol.name, source: file.path, confidence: 'low' },
        { kind: 'path', value: file.path, source: file.path, confidence: 'low' },
      ],
      warnings: [warning],
    }
  }

  return null
}
