import type { FileSummary, RustSyntaxFact } from '../symbol-index/types.js'
import type { CargoPackage } from '../languages/rust/cargo.js'
import type { RustModule } from '../languages/rust/moduleResolver.js'
import { resolveRustUses, rustEvidenceStatus } from '../languages/rust/useResolver.js'
import type { CodeGraph, CodeGraphEdgeKind } from './codeGraphTypes.js'

/** Physical syntax identity, independent of every Cargo target context. */
export const rustImplId = (file: string, lexicalScopeKey: string, ordinal: number) =>
  `rust-impl:${encodeURIComponent(file)}#${encodeURIComponent(lexicalScopeKey)}#${ordinal}`

/** N16: the only Rust R4 graph projector; shared by full and partial finishing. */
export function buildRustRelationships(graph: CodeGraph, summaries: readonly FileSummary[], packages: readonly CargoPackage[], modules: readonly RustModule[]): { graph: CodeGraph; warnings: string[] } {
  if (!summaries.some(f => f.language === 'rust')) return { graph, warnings: [] }
  const resolver = resolveRustUses(packages, modules, summaries)
  const nodes = [...graph.nodes], edges = [...graph.edges]
  const ids = new Set(nodes.map(n => n.id)), edgeIds = new Set(edges.map(e => e.id))
  const warnings: string[] = []
  const warn = (text: string) => { if (warnings.length < 255) warnings.push(text); else if (warnings.length === 255) warnings.push('Rust relationship diagnostics truncated at 256; original syntax facts retained') }
  const edge = (source: string, kind: CodeGraphEdgeKind, target: string, metadata?: Record<string, string | number | boolean | null>, occurrence?: string) => {
    if (!ids.has(source) || !ids.has(target)) throw new Error(`Invalid Rust relationship endpoint: ${source} -> ${target}`)
    const canonical = `${source}--${kind}-->${target}`
    const id = occurrence ? `${canonical}#${occurrence}` : canonical
    if (edgeIds.has(id)) throw new Error(`Duplicate Rust relationship edge: ${id}`)
    edgeIds.add(id); edges.push({ id, source, kind, target, ...(metadata ? { metadata } : {}) })
  }
  const sourceMetadata = (file: string, fact: RustSyntaxFact) => ({ file, line: fact.line, sourceIndex: fact.sourceIndex ?? 0, syntaxKind: fact.syntaxKind, resolutionStatus: 'RESOLVED' })
  for (const context of resolver.contexts) {
    if (context.module.status !== 'RESOLVED') continue
    for (const s of resolver.direct(context)) {
      const facts = context.file.rustSyntaxFacts?.filter(f => f.nodeId === s.nodeId) ?? []
      if (!s.nodeId || !ids.has(s.nodeId) || facts.length !== 1 || rustEvidenceStatus({ ...facts[0], attributes: s.declarationMetadata?.rust?.attributes }) !== 'RESOLVED') continue
      edge(context.module.id, 'rust-module-defines-symbol', s.nodeId, sourceMetadata(context.file.path, facts[0]))
    }
  }
  for (const file of summaries.filter(f => f.language === 'rust')) {
    if (!ids.has(`file:${file.path}`) || /^(?:[\\/]|[A-Za-z]:)/.test(file.path) || file.path.includes('\\') || file.path.split('/').some(p => !p || p === '.' || p === '..')) {
      warn('UNSUPPORTED_SYNTAX: untrusted physical Rust source path'); continue
    }
    const ordinals = new Map<string, number>()
    for (const fact of (file.rustSyntaxFacts ?? []).filter(f => f.kind === 'impl').sort((a,b) => a.line - b.line || (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0))) {
      if (!fact.ownerKey) { warn(`MALFORMED: ${file.path}:${fact.line} missing physical impl key`); continue }
      const ordinal = ordinals.get(fact.ownerKey) ?? 0
      ordinals.set(fact.ownerKey, ordinal + 1)
      const id = rustImplId(file.path, fact.ownerKey, ordinal)
      if (ids.has(id)) throw new Error(`Duplicate Rust impl node: ${id}`)
      const contexts = resolver.contexts.filter(c => c.file.path === file.path && c.ownerKey === fact.parentOwnerKey)
      let state = rustEvidenceStatus(fact)
      if (fact.negative) state = 'UNSUPPORTED_SYNTAX'
      if (contexts.some(c => c.module.status !== 'RESOLVED')) state = contexts.find(c => c.module.status !== 'RESOLVED')!.module.status
      // A nested conditional/macro owner may be outside a selected module context.
      for (const ancestor of file.rustSyntaxFacts ?? []) if (ancestor.kind === 'module' && ancestor.moduleKey && fact.ownerKey.startsWith(ancestor.moduleKey + '/')) {
        const status = rustEvidenceStatus(ancestor)
        if (status !== 'RESOLVED') state = status
      }
      nodes.push({ id, kind: 'rust-impl', label: fact.text ?? fact.typePath ?? 'impl', path: file.path, line: fact.line, language: 'rust', ownerKey: fact.ownerKey,
        rustMetadata: { origin: 'syntax', status: state, endLine: fact.endLine, sourceIndex: fact.sourceIndex,
          lexicalModuleOwner: fact.parentOwnerKey, implementation: fact.implementation, typePath: fact.typePath, traitPath: fact.traitPath,
          syntax: fact.text, genericParameters: fact.genericParameters, negative: fact.negative, identityProvenance: 'B08 parser lexical owner; B02 persisted associated declaration IDs' } })
      ids.add(id)
      if (state !== 'RESOLVED') { warn(`${state}: ${file.path}:${fact.line} impl relationship evidence`); continue }
      for (const s of file.symbols.filter(s => s.ownerKey === fact.ownerKey && ['method','function','const','type'].includes(s.kind))) {
        const facts = file.rustSyntaxFacts?.filter(f => f.nodeId === s.nodeId && f.ownerKey === fact.ownerKey) ?? []
        if (s.nodeId && ids.has(s.nodeId) && facts.length === 1 && rustEvidenceStatus({ ...facts[0], attributes: s.declarationMetadata?.rust?.attributes }) === 'RESOLVED') edge(id, 'rust-impl-defines-symbol', s.nodeId, sourceMetadata(file.path, facts[0]))
      }
      const genericNames = (fact.genericParameterNames ?? []).map(name => name.replace(/^r#/, ''))
      const unknownGenerics = !!fact.genericParameters && fact.genericParameterNames === undefined
      const genericTarget = genericNames.includes((fact.typePath?.trim().split(/::|</)[0] ?? '').trim().replace(/^r#/, ''))
      const resolve = (path: string | undefined, expected: 'type' | 'trait', kind: CodeGraphEdgeKind) => {
        if (!path || !contexts.length || unknownGenerics) return
        if (genericNames.includes(path.trim().split(/::|</)[0].trim().replace(/^r#/, ''))) return
        const results = contexts.map(c => resolver.resolvePath(c, path, expected, 'impl'))
        const targets = new Set(results.map(r => r.target?.symbol?.nodeId))
        if (results.every(r => r.status === 'RESOLVED' && r.target?.symbol?.nodeId) && targets.size === 1) edge(id, kind, results[0].target!.symbol!.nodeId!, { ...sourceMetadata(file.path, fact), observedPath: path })
        else warn(`${results.find(r => r.status !== 'RESOLVED')?.status ?? 'AMBIGUOUS'}: ${file.path}:${fact.line} impl ${expected} ${path}`)
      }
      resolve(fact.typePath, 'type', 'rust-impl-for-type')
      if (!fact.negative && !genericTarget) resolve(fact.traitPath, 'trait', 'rust-impl-of-trait')
    }
  }
  const imports: Array<{ source: string; kind: CodeGraphEdgeKind; target: string; metadata: Record<string,string|number|boolean|null>; occurrence: string }> = []
  for (const o of resolver.observations) {
    if (o.status !== 'RESOLVED' || !o.target) { warn(`${o.status}: ${o.context.file.path}:${o.line}:${o.sourceIndex} use ${o.path}`); continue }
    const metadata = { ...sourceMetadata(o.context.file.path, o.fact), line: o.line, sourceIndex: o.sourceIndex, occurrence: o.occurrence,
      syntaxKind: o.fact.syntaxKind, importedPath: o.path, observedSyntax: o.fact.text ?? '', alias: o.alias ?? '', visibility: o.fact.visibility ?? '', glob: o.glob,
      resolvedTargetModuleId: o.target.module.id, resolvedTargetSymbolId: o.target.symbol?.nodeId ?? '', targetId: o.context.module.targetId, conditional: false }
    const occurrence = `${encodeURIComponent(o.context.file.path)}:${o.line}:${o.sourceIndex}:${o.occurrence}`
    if (o.context.module.id !== o.target.module.id) imports.push({ source: o.context.module.id, kind: 'rust-module-uses-module', target: o.target.module.id, metadata, occurrence })
    if (o.fact.visibility && !o.glob && o.target.symbol?.nodeId) imports.push({ source: o.context.module.id, kind: 'rust-module-reexports-symbol', target: o.target.symbol.nodeId, metadata, occurrence })
  }
  const counts = new Map<string,number>()
  for (const e of imports) { const key = `${e.source}--${e.kind}-->${e.target}`; counts.set(key, (counts.get(key) ?? 0) + 1) }
  for (const e of imports) edge(e.source, e.kind, e.target, e.metadata, counts.get(`${e.source}--${e.kind}-->${e.target}`)! > 1 ? e.occurrence : undefined)
  nodes.sort((a,b) => a.id.localeCompare(b.id)); edges.sort((a,b) => a.id.localeCompare(b.id))
  return { graph: { ...graph, nodes, edges, summary: { ...graph.summary, nodeCount: nodes.length, edgeCount: edges.length } }, warnings }
}
