import type { FileSummary, RustSyntaxFact, SymbolDefinition } from '../../symbol-index/types.js'
import type { CargoPackage, RustResolutionStatus } from './cargo.js'
import { rustTargetId, type RustModule } from './moduleResolver.js'

export interface RustContext {
  module: RustModule
  file: FileSummary
  ownerKey?: string
  pkg: CargoPackage
}
export interface RustLocalTarget {
  module: RustModule
  symbol?: SymbolDefinition
}
export interface RustPathResult {
  status: RustResolutionStatus
  target?: RustLocalTarget
}
export interface RustUseObservation extends RustPathResult {
  context: RustContext
  fact: RustSyntaxFact
  path: string
  alias?: string
  glob: boolean
  line: number
  sourceIndex: number
  occurrence: number
}

const clean = (name: string) => name.replace(/^r#/, '')
const identifier = /^(?:r#)?[_\p{ID_Start}][_\p{ID_Continue}]*$/u
const within = (child: string, parent: string) => child === parent || child.startsWith(parent + '::')

/** Recognize only doc-comment tokens already observed by the Rust parser. */
function isDocumentationComment(observed: string): boolean {
  const normalized = observed.replace(/\r\n/g, '\n')
  if (normalized.includes('\r')) return false
  const text = normalized.trim()
  // The parser may retain consecutive documentation tokens in one entry.
  let offset = 0, sawDocumentation = false
  while (offset < text.length) {
    if (/\s/.test(text[offset])) { offset++; continue }
    const remaining = text.slice(offset)
    if (/^\/\/(?:\/(?!\/)|!)/.test(remaining)) {
      const newline = text.indexOf('\n', offset)
      offset = newline === -1 ? text.length : newline + 1
      sawDocumentation = true
      continue
    }
    // /**/, /***/ and /*** ... */ are ordinary block comments in Rust.
    if (!remaining.startsWith('/*!') && !/^\/\*\*(?![*/])/.test(remaining)) return false
    let depth = 1
    offset += 2
    while (offset < text.length - 1 && depth > 0) {
      const pair = text.slice(offset, offset + 2)
      if (pair === '/*') { depth++; offset += 2 }
      else if (pair === '*/') { depth--; offset += 2 }
      else offset++
    }
    if (depth !== 0) return false
    sawDocumentation = true
  }
  return sawDocumentation
}

/** Activation is never evaluated. Documentation does not neutralize restrictive attributes. */
export function rustEvidenceStatus(fact: { status?: string; endLine?: number; attributes?: string[] }): RustResolutionStatus {
  if (fact.status === 'parser-error' || fact.endLine === undefined) return 'MALFORMED'
  const attributes = (fact.attributes ?? []).filter(a => !isDocumentationComment(a)).map(a => a.trim())
  const conditional = (a: string) => /^#!?\s*\[\s*cfg(?:_attr)?\b[\s\S]*\]$/.test(a)
  if (attributes.some(a => !conditional(a) && !/^#!?\s*\[\s*(?:doc(?=\s*(?:=|\(|\]))|allow\b|warn\b|deny\b|forbid\b|expect\b|deprecated\b|derive\b|repr\b|inline\b|must_use\b|non_exhaustive\b|test\b|path\b)[\s\S]*\]$/.test(a))) return 'UNSUPPORTED_SYNTAX'
  if (attributes.some(conditional)) return 'CONDITIONAL'
  return 'RESOLVED'
}

/** N15: consumes B08 facts and B09 contexts, never constructs graph edges. */
export function resolveRustUses(packages: readonly CargoPackage[], modules: readonly RustModule[], summaries: readonly FileSummary[]) {
  const files = new Map(summaries.filter(f => f.language === 'rust').map(f => [f.path, f]))
  const contexts: RustContext[] = []
  for (const module of modules) {
    const pkg = packages.find(p => p.targets.some(t => rustTargetId(p.manifest, t) === module.targetId))
    const file = files.get(module.origin === 'external' ? module.resolvedFile ?? '' : module.file)
    const ownFact = module.origin === 'inline' ? file?.rustSyntaxFacts?.find(f => f.kind === 'module' && f.nodeId === module.declarationId) : undefined
    if (pkg && file && (module.origin !== 'inline' || ownFact?.moduleKey)) contexts.push({ module, pkg, file, ...(ownFact?.moduleKey ? { ownerKey: ownFact.moduleKey } : {}) })
  }
  const byId = new Map(contexts.map(c => [c.module.id, c]))
  const observations: RustUseObservation[] = []
  for (const context of contexts) {
    let occurrence = 0
    for (const fact of context.file.rustSyntaxFacts ?? []) {
      if (fact.kind !== 'use' || fact.ownerKey !== context.ownerKey) continue
      for (const leaf of fact.useLeaves ?? []) observations.push({ context, fact, ...leaf, occurrence: occurrence++, status: 'UNRESOLVED_SELECTED_ROOTS' })
    }
  }
  const direct = (c: RustContext) => c.file.symbols.filter(s => s.ownerKey === c.ownerKey)
  const children = (c: RustContext, name: string) => modules.filter(m => m.parentId === c.module.id && clean(m.modulePath.split('::').at(-1)!) === name)
  const bindings = (c: RustContext, name: string) => observations.filter(o => o.context.module.id === c.module.id && !o.glob && clean(o.alias ?? o.path.split('::').at(-1)!) === name && o.alias !== '_')
  const status = (c: RustContext, fact?: RustSyntaxFact): RustResolutionStatus => c.module.status !== 'RESOLVED' ? c.module.status : fact ? rustEvidenceStatus(fact) : 'RESOLVED'
  const visible = (visibility: string | undefined, defining: RustContext, from: RustContext): boolean => {
    if (visibility === 'pub') return true
    if (defining.module.targetId !== from.module.targetId) return false
    if (!visibility || visibility === 'pub(self)') return within(from.module.modulePath, defining.module.modulePath)
    if (visibility === 'pub(crate)') return true
    if (visibility === 'pub(super)') {
      const parent = byId.get(defining.module.parentId ?? '')
      return !!parent && within(from.module.modulePath, parent.module.modulePath)
    }
    const match = /^pub\(in\s+(crate(?:::[\w#]+)*)\)$/.exec(visibility ?? '')
    return !!match && within(defining.module.modulePath, match[1]) && within(from.module.modulePath, match[1])
  }
  const moduleVisibility = (m: RustModule) => {
    const parent = byId.get(m.parentId ?? '')
    return { parent, visibility: parent?.file.symbols.find(s => s.nodeId === m.declarationId)?.declarationMetadata?.rust?.visibility }
  }
  const symbolStatus = (c: RustContext, s: SymbolDefinition) => {
    const facts = c.file.rustSyntaxFacts?.filter(f => f.nodeId === s.nodeId) ?? []
    return facts.length === 1 ? rustEvidenceStatus({ ...facts[0], attributes: s.declarationMetadata?.rust?.attributes }) : 'MALFORMED'
  }
  type Expected = 'use' | 'type' | 'trait'
  const unresolved = (status: RustResolutionStatus = 'UNRESOLVED_SELECTED_ROOTS'): RustPathResult => ({ status })
  const combine = (values: RustPathResult[]): RustPathResult => {
    if (!values.length) return unresolved()
    if (values.some(v => v.status !== 'RESOLVED')) return unresolved(values.length > 1 ? 'AMBIGUOUS' : values[0].status)
    const unique = new Map(values.map(v => [v.target!.symbol ? `${v.target!.module.id}\0${v.target!.symbol.nodeId}` : v.target!.module.id, v]))
    return unique.size === 1 ? [...unique.values()][0] : unresolved('AMBIGUOUS')
  }
  const matchesKind = (s: SymbolDefinition, expected: Expected) => expected === 'use' || expected === 'type' && ['struct','enum','union'].includes(s.kind) || expected === 'trait' && s.kind === 'trait' && s.declarationMetadata?.rust?.syntaxKind === 'trait_item'
  let resolutionWork = 4096

  const resolveBinding = (o: RustUseObservation, expected: Expected, trail: Set<RustUseObservation>): RustPathResult => {
    if (--resolutionWork < 0) return unresolved('UNSUPPORTED_SYNTAX')
    if (trail.has(o) || trail.size >= 64) return unresolved('AMBIGUOUS')
    const state = status(o.context, o.fact)
    if (state !== 'RESOLVED') return unresolved(state)
    if (o.fact.unsupportedUse) return unresolved('UNSUPPORTED_SYNTAX')
    const result = resolvePath(o.context, o.path, expected, 'use', new Set([...trail, o]))
    if (o.fact.visibility && result.target?.symbol?.declarationMetadata?.rust?.visibility !== 'pub' && result.target?.symbol) return unresolved('UNSUPPORTED_SYNTAX')
    if (o.glob && result.target?.symbol) return unresolved('UNSUPPORTED_SYNTAX')
    return result
  }
  const member = (c: RustContext, name: string, from: RustContext, expected: Expected, trail: Set<RustUseObservation>): RustPathResult => {
    if (--resolutionWork < 0) return unresolved('UNSUPPORTED_SYNTAX')
    if (c.module.status !== 'RESOLVED') return unresolved(c.module.status)
    if (c.pkg.status !== 'RESOLVED') return unresolved(c.pkg.status)
    const values: RustPathResult[] = []
    for (const m of children(c, name)) {
      const visibility = moduleVisibility(m)
      if (m.status !== 'RESOLVED') values.push(unresolved(m.status))
      else if (!visibility.parent || !visible(visibility.visibility, visibility.parent, from)) values.push(unresolved('UNSUPPORTED_SYNTAX'))
      else values.push({ status: 'RESOLVED', target: { module: m } })
    }
    // Include all ordinary item namespaces for use; impl contexts constrain type/trait targets.
    for (const s of direct(c).filter(s => clean(s.name) === name && s.kind !== 'module' && (expected === 'use' || ['struct','enum','union','type','trait'].includes(s.kind)))) {
      const state = symbolStatus(c, s)
      if (!matchesKind(s, expected)) values.push(unresolved('UNSUPPORTED_SYNTAX'))
      else if (state !== 'RESOLVED') values.push(unresolved(state))
      else if (!s.nodeId || !visible(s.declarationMetadata?.rust?.visibility, c, from)) values.push(unresolved('UNSUPPORTED_SYNTAX'))
      else values.push({ status: 'RESOLVED', target: { module: c.module, symbol: s } })
    }
    for (const o of bindings(c, name)) {
      if (c.module.id !== from.module.id && !visible(o.fact.visibility, c, from)) values.push(unresolved('UNSUPPORTED_SYNTAX'))
      else values.push(resolveBinding(o, expected, trail))
    }
    return combine(values)
  }
  const dependency = (from: RustContext, name: string): RustPathResult => {
    if (from.pkg.edition === '2015') return unresolved('UNRESOLVED_EXTERNAL')
    if (from.pkg.externPreludeNames?.some(n => n.replace(/-/g, '_') === name)) return unresolved('AMBIGUOUS')
    const deps = from.pkg.dependencies.filter(d => clean(d.name.replace(/-/g, '_')) === name)
    if (!deps.length) return unresolved('UNRESOLVED_EXTERNAL')
    if (deps.length !== 1) return unresolved('AMBIGUOUS')
    const dep = deps[0]
    const sourceTarget = from.pkg.targets.find(t => rustTargetId(from.pkg.manifest,t) === from.module.targetId)
    if (sourceTarget?.kind === 'build-script' ? dep.dependencyKind !== 'build' : dep.dependencyKind !== undefined) return unresolved('UNSUPPORTED_SYNTAX')
    if (dep.status !== 'RESOLVED' || !dep.selected || !dep.manifest) return unresolved(dep.status)
    const pkgs = packages.filter(p => p.manifest === dep.manifest && p.name === dep.packageName && p.status === 'RESOLVED')
    if (pkgs.length !== 1) return unresolved('AMBIGUOUS')
    const roots = contexts.filter(c => c.pkg === pkgs[0] && c.module.origin === 'root' && pkgs[0].targets.some(t => t.kind === 'lib' && t.status === 'RESOLVED' && rustTargetId(pkgs[0].manifest,t) === c.module.targetId))
    if (roots.length === 1 && dep.name === dep.packageName && !pkgs[0].targets.some(t => rustTargetId(pkgs[0].manifest,t) === roots[0].module.targetId && t.name.replace(/-/g, '_') === name)) return unresolved('UNSUPPORTED_SYNTAX')
    return roots.length === 1 ? { status: roots[0].module.status, target: { module: roots[0].module } } : unresolved(roots.length ? 'AMBIGUOUS' : 'UNRESOLVED_SELECTED_ROOTS')
  }
  function resolvePath(from: RustContext, observed: string, expected: Expected, mode: 'use' | 'impl', trail = new Set<RustUseObservation>()): RustPathResult {
    if (!trail.size) resolutionWork = 4096
    if (--resolutionWork < 0) return unresolved('UNSUPPORTED_SYNTAX')
    let path = observed.trim()
    if (mode === 'impl') {
      // Only a nominal path with balanced generic arguments. No associated projection,
      // references, tuples, trait objects, const expressions or compiler normalization.
      if (path.startsWith('<')) return unresolved('UNSUPPORTED_SYNTAX')
      let depth = 0, nominal = '', sawGeneric = false
      for (const ch of path) {
        if (ch === '<') { if (!depth && sawGeneric) return unresolved('UNSUPPORTED_SYNTAX'); sawGeneric = true; depth++ }
        else if (ch === '>') { if (!depth) return unresolved('UNSUPPORTED_SYNTAX'); depth-- }
        else if (!depth) { if (sawGeneric && /\S/.test(ch)) return unresolved('UNSUPPORTED_SYNTAX'); nominal += ch }
      }
      if (depth) return unresolved('UNSUPPORTED_SYNTAX')
      path = nominal
    }
    // Preserve token boundaries: `dyn Trait` must never become `dynTrait`.
    path = path.replace(/\s*::\s*/g, '::').trim()
    const global = path.startsWith('::')
    const parts = (global ? path.slice(2) : path).split('::')
    if (!parts.length || parts.length > 128 || parts.some(p => !identifier.test(p))) return unresolved('UNSUPPORTED_SYNTAX')
    const names = parts.map(clean)
    let current = from
    let result: RustPathResult | undefined
    if (names[0] === 'crate' || global && from.pkg.edition === '2015' || mode === 'use' && from.pkg.edition === '2015' && !['self','super'].includes(names[0])) {
      const root = contexts.filter(c => c.module.targetId === from.module.targetId && c.module.origin === 'root')
      if (root.length !== 1) return unresolved('AMBIGUOUS')
      current = root[0]
      if (names[0] === 'crate') names.shift()
    } else if (names[0] === 'self') names.shift()
    else if (names[0] === 'super') {
      while (names[0] === 'super') {
        const parent = byId.get(current.module.parentId ?? '')
        if (!parent) return unresolved()
        current = parent; names.shift()
      }
    } else {
      if (!from.pkg.edition) return unresolved('AMBIGUOUS')
      const name = names.shift()!
      const local = global ? undefined : member(from, name, from, names.length ? 'use' : expected, trail)
      const dep = mode === 'use' && from.pkg.edition === '2015' ? undefined : dependency(from, name)
      if (global) result = dep
      else if (local?.status === 'RESOLVED' && dep?.status !== 'UNRESOLVED_EXTERNAL') result = combine([local, dep!])
      else result = local?.status !== 'UNRESOLVED_SELECTED_ROOTS' ? local : dep
      if (!result || result.status !== 'RESOLVED') return result ?? unresolved()
    }
    for (const [index, name] of names.entries()) {
      if (result?.target?.symbol) return unresolved('UNSUPPORTED_SYNTAX')
      if (result?.target) {
        const context = byId.get(result.target.module.id)
        if (!context) return unresolved()
        current = context
      }
      result = member(current, name, from, index === names.length - 1 ? expected : 'use', trail)
      if (result.status !== 'RESOLVED') return result
    }
    result ??= { status: current.module.status, target: { module: current.module } }
    if (expected !== 'use' && (!result.target?.symbol || !matchesKind(result.target.symbol, expected))) return unresolved('UNSUPPORTED_SYNTAX')
    return result
  }
  for (const o of observations) { resolutionWork = 4096; Object.assign(o, resolveBinding(o, 'use', new Set())) }
  // Statement order never resolves competing scope bindings. Preserve occurrences,
  // but no claim-bearing import edge for a binding with competing provenance.
  for (const c of contexts) {
    const groups = new Map<string,RustUseObservation[]>()
    for (const o of observations.filter(o => o.context === c && !o.glob && o.alias !== '_')) {
      const name = clean(o.alias ?? o.path.split('::').at(-1)!)
      groups.set(name, [...(groups.get(name) ?? []), o])
    }
    for (const [name, group] of groups) {
      const targets = new Set(group.map(o => o.target?.symbol ? `${o.target.module.id}\0${o.target.symbol.nodeId}` : o.target?.module.id))
      const declarations = direct(c).filter(s => clean(s.name) === name && s.kind !== 'module').map(s => `${c.module.id}\0${s.nodeId}`)
      declarations.push(...children(c,name).map(m => m.id))
      if (targets.size > 1 || group.length > 1 && group.some(o => o.status !== 'RESOLVED') || declarations.some(id => !targets.has(id))) {
        for (const o of group) { o.status = 'AMBIGUOUS'; delete o.target }
      }
    }
  }
  return { contexts, observations, resolvePath, status, direct }
}
