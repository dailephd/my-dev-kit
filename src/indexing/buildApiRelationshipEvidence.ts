import { createHash } from 'node:crypto'
import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { SymbolIndex, FileSummary, SymbolDefinition } from '../symbol-index/types.js'
import type { SourceAuditEvidenceArtifact, SourceAuditSpan } from '../symbol-index/auditEvidenceTypes.js'
import {
  API_RELATIONSHIP_ARTIFACT_KIND, API_RELATIONSHIP_SCHEMA_VERSION, API_RELATIONSHIP_PRODUCER,
  API_RELATIONSHIP_FILENAME, API_RELATIONSHIP_METHODS, API_RELATIONSHIP_CANDIDATE_LIMIT, apiEvidenceHash, apiRelationshipId,
  compareApiIdentity, sealApiRelationshipEvidence, validateApiRelationshipEvidence,
  type ApiRelationshipEvidence, type ApiRelationshipNode, type ApiRelationshipWitness,
  type ApiRelationship, type ApiRelationshipKind, type ApiUnresolvedRelationship,
  type ApiRelationshipQualification, type ApiSourceObservation, type ApiRelationshipEvidenceReference,
} from '../symbol-index/apiRelationshipEvidenceTypes.js'

export interface BuildApiRelationshipEvidenceInput {
  frontendReachability?: import('../frontend-reachability/types.js').FrontendReachabilityArtifact
  dataModel?: import('../data-model/types.js').DataModelArtifact
  symbolIndex: SymbolIndex
  codeGraph: CodeGraph
  sourceAudit: SourceAuditEvidenceArtifact
  producerVersion: string
}

/** Pure composition of authenticated index facts. Never opens source or invokes a parser. */
export function buildApiRelationshipEvidence(input: BuildApiRelationshipEvidenceInput): ApiRelationshipEvidence {
  const { sourceAudit: audit, symbolIndex: index, codeGraph: graph } = input
  const nodes = new Map<string, ApiRelationshipNode>()
  const relationships = new Map<string, ApiRelationship>()
  const unresolved: ApiUnresolvedRelationship[] = []
  const limitations = new Map<string, { code: string; scope: string }>()
  const limit = (code: string, scope: string) => limitations.set(`${code}\0${scope}`, { code, scope })
  limit('static-source-only-no-runtime-reachability-or-validation', 'artifact')
  limit('request-profile-direct-fetch-and-exact-wrapper-calls', 'artifact')
  limit('endpoint-profile-express-and-authenticated-next-app-static', 'artifact')
  limit('schema-profile-explicit-source-type-references-only', 'artifact')
  limit('data-profile-explicit-imported-class-declaration-only-no-runtime-data-access', 'artifact')
  const selected = new Map(audit.files.map(f => [f.path, f]))
  const files = index.files.filter(f => selected.has(f.path)).sort((a, b) => compareApiIdentity(a.path, b.path))
  const symbols = files.flatMap(f => f.symbols.map(s => ({ file: f, symbol: s })))
  const graphIds = new Set(graph.nodes.map(n => n.id))
  const span = (file: string, line: number, column: number | null, endLine: number | null): SourceAuditSpan => ({ path: file, startLine: line, startColumn: column, endLine, endColumn: null })
  const witness = (location: SourceAuditSpan, symbolId: string | null, provenance: ApiRelationshipWitness['provenance'], factId: string | null = null): ApiRelationshipWitness | null => {
    const hash = selected.get(location.path)?.contentSha256
    if (!hash) return null
    return { id: 'api-witness:' + apiEvidenceHash([location, symbolId, provenance, factId, hash]), span: location, contentSha256: hash, symbolId, factId, provenance }
  }
  const symbolNode = (file: FileSummary, s: SymbolDefinition, kind: ApiRelationshipNode['kind'] = 'source-symbol'): ApiRelationshipNode | null => {
    if (!s.nodeId || !graphIds.has(s.nodeId)) return null
    const existing = nodes.get(s.nodeId)
    if (existing) return existing
    const location = span(file.path, s.location.line, null, s.location.endLine ?? null)
    const w = witness(location, s.nodeId, 'symbol-import-graph')
    if (!w) return null
    const n: ApiRelationshipNode = { id: s.nodeId, kind, file: file.path, symbolId: s.nodeId, location, value: s.qualifiedName ?? s.name, provenance: [w] }
    nodes.set(n.id, n)
    return n
  }
  const owner = (file: FileSummary, o: ApiSourceObservation) => {
    const matches = file.symbols.filter(s => s.name === o.ownerName && s.location.line === o.ownerLine)
    return matches.length === 1 ? symbolNode(file, matches[0]) : null
  }
  const add = (kind: ApiRelationshipKind, source: ApiRelationshipNode, target: ApiRelationshipNode | null, w: ApiRelationshipWitness[], reason: string | null = null, candidates: string[] = [], qualification: ApiRelationshipQualification = target ? 'RESOLVED' : 'UNRESOLVED', method: ApiRelationship['method'] = null, path: string | null = null) => {
    const identities = [...new Set(candidates)].sort(compareApiIdentity)
    const candidateLimitations = identities.length > API_RELATIONSHIP_CANDIDATE_LIMIT ? ['candidate-limit-truncated'] : []
    if (candidateLimitations.length) limit('candidate-limit-truncated', source.file)
    const body: Omit<ApiRelationship, 'id'> = { kind, source: source.id, target: target?.id ?? null, qualification, method, path, unresolvedTargetKey: target ? null : `${reason}:${method ?? ''}:${path ?? ''}`, witnesses: w, limitations: ['static-source-only', ...(reason ? [reason] : []), ...candidateLimitations] }
    const r = { ...body, id: apiRelationshipId(body) }
    if (relationships.has(r.id)) return
    relationships.set(r.id, r)
    if (!target) unresolved.push({ source: source.id, location: w[0].span, family: kind, qualification: qualification as Exclude<ApiRelationshipQualification, 'RESOLVED'>, reason: reason ?? 'target-not-established', candidates: identities.slice(0, API_RELATIONSHIP_CANDIDATE_LIMIT), missingEvidence: [reason ?? 'target-identity', ...candidateLimitations] })
  }
  const diagnostic = (file: string, reason: string, qualification: 'UNRESOLVED' | 'UNSUPPORTED', family: ApiRelationshipKind = 'api-call-targets-route', location = span(file, 1, 0, null), candidates: string[] = []) => {
    const identities = [...new Set(candidates)].sort(compareApiIdentity)
    const missingEvidence = [reason, ...(identities.length > API_RELATIONSHIP_CANDIDATE_LIMIT ? ['candidate-limit-truncated'] : [])]
    if (identities.length > API_RELATIONSHIP_CANDIDATE_LIMIT) limit('candidate-limit-truncated', file)
    unresolved.push({ source: null, location, family, qualification, reason, candidates: identities.slice(0, API_RELATIONSHIP_CANDIDATE_LIMIT), missingEvidence })
    limit(reason, file)
  }
  // Resolve through exact import binding + authenticated selected target paths, never by cross-file name alone.
  const referenced = (file: FileSummary, name: string | null, declaration: boolean): Array<{ file: FileSummary; symbol: SymbolDefinition }> => {
    if (!name) return []
    const local = file.symbols.filter(s => s.name === name && !s.ownerKey && (!declaration || ['interface', 'type', 'class', 'enum'].includes(s.kind)))
    const bindings = (file.importBindings ?? []).filter(b => b.localName === name && b.resolutionStatus === 'resolved-local')
    if (local.length) return local.map(symbol => ({ file, symbol }))
    if (bindings.length !== 1) return []
    const binding = bindings[0]
    const imports = selected.get(file.path)?.facts.filter(f => f.kind === 'import' && f.sourceSpecifier === binding.sourceSpecifier && f.importResolution === 'resolved-local') ?? []
    const paths = [...new Set(imports.flatMap(f => f.targetPaths ?? []))]
    if (paths.length !== 1 || !index.graph?.fileDeps.some(e => e.from === file.path && e.to === paths[0] && e.kind === 'import')) return []
    const target = files.find(f => f.path === paths[0])
    if (!target) return []
    const exports = selected.get(target.path)?.facts.filter(f => f.kind === 'export' && f.name === binding.importedName) ?? []
    const ids = new Set(exports.map(f => f.symbolId).filter(Boolean))
    return symbols.filter(s => s.file.path === target.path && s.symbol.nodeId && ids.has(s.symbol.nodeId) && (!declaration || ['interface', 'type', 'class', 'enum'].includes(s.symbol.kind)))
  }
  const usable = (file: string) => {
    const f = selected.get(file), s = files.find(s => s.path === file)
    return !!f?.contentSha256 && f.capabilities.declarations === 'complete' && s?.apiRelationships?.status === 'complete'
  }
  const referenceWitnesses = (file: FileSummary, name: string | null, symbolId: string) => {
    const binding = file.importBindings?.find(b => b.localName === name)
    return binding ? (selected.get(file.path)?.facts ?? []).filter(f => f.kind === 'import' && f.sourceSpecifier === binding.sourceSpecifier && f.importResolution === 'resolved-local').flatMap(f => {
      const item = witness(f.span, symbolId, 'symbol-import-graph', f.id)
      return item ? [item] : []
    }) : []
  }
  for (const file of files) if (file.imports.some(i => ['@prisma/client', 'sequelize', 'typeorm'].includes(i))) diagnostic(file.path, 'unsupported-dynamic-data-access-profile', 'UNSUPPORTED', 'api-handler-uses-data-entity')
  // Only literal root-relative paths. No case folding, decoding, dot-segment or regex equivalence.
  const literalPath = (value: string | null, request = false): string | null => {
    const p = request ? value?.split(/[?#]/, 1)[0] : value
    return p?.startsWith('/') && !p.startsWith('//') && !/[\\\s:*?#]/.test(p) && !p.split('/').some(s => s === '.' || s === '..') ? p : null
  }
  const compose = (prefix: string, route: string) => prefix.replace(/\/$/, '') + (route === '/' ? '/' : route)
  const routerKey = (file: FileSummary, name: string, seen = new Set<string>()): string | null => {
    const key = `${file.path}#${name}`
    if (seen.has(key) || !usable(file.path)) return null
    seen.add(key)
    const locals = (file.frameworkRouteFacts ?? []).filter(f => f.kind === 'router' && f.framework === 'express' && f.name === name && f.status === 'static')
    if (locals.length === 1) return locals[0].target ? routerKey(file, locals[0].target, seen) : key
    if (locals.length) return null
    const targets = referenced(file, name, false)
    return targets.length === 1 ? routerKey(targets[0].file, targets[0].symbol.name, seen) : null
  }
  const mounts = files.flatMap(file => (file.frameworkRouteFacts ?? []).filter(f => f.framework === 'express' && f.kind === 'mount').map(fact => ({ file, fact, source: routerKey(file, fact.name), target: fact.target ? routerKey(file, fact.target) : null })))
  for (const m of mounts) if (!m.source || !m.target || m.fact.status !== 'static') diagnostic(m.file.path, 'mount-identity-or-prefix-unresolved', 'UNRESOLVED')
  const endpoints: Array<{ node: ApiRelationshipNode; method: ApiRelationship['method']; path: string; handler: string; ambiguous?: boolean; contextGroup?: string }> = []
  for (const g of graph.nodes.filter(n => n.kind === 'framework-route').sort((a, b) => compareApiIdentity(a.id, b.id))) {
    const file = selected.get(g.path ?? '')
    if (!file) { limit('route-outside-selection', g.path ?? g.id); continue }
    const m = g.routeMetadata
    const location = span(file.path, g.line ?? 1, typeof m?.column === 'number' ? m.column : null, typeof m?.endLine === 'number' ? m.endLine : null)
    const w = witness(location, typeof m?.handlerId === 'string' ? m.handlerId : null, 'framework-graph', g.id)
    if (!w) { diagnostic(file.path, 'source-evidence-unavailable', 'UNRESOLVED'); continue }
    const n: ApiRelationshipNode = { id: g.id, kind: 'framework-route', file: file.path, symbolId: w.symbolId, location, value: typeof m?.observedPath === 'string' ? m.observedPath : null, provenance: [w] }
    nodes.set(n.id, n)
    const method = API_RELATIONSHIP_METHODS.find(v => v === m?.method) ?? null
    const handler = symbols.find(s => s.symbol.nodeId === m?.handlerId)
    const target = handler ? symbolNode(handler.file, handler.symbol) : null
    const handledBy = target && graph.edges.some(e => e.source === g.id && e.target === target.id && e.kind === 'framework-route-handled-by-symbol')
    const supported = m?.framework === 'express' && method !== null
    const ownerFile = files.find(f => f.path === file.path)!
    const key = typeof m?.ownerBinding === 'string' ? routerKey(ownerFile, m.ownerBinding) : null
    const contexts = key ? mounts.filter(x => x.target === key) : []
    const mountEdges = graph.edges.filter(e => e.kind === 'framework-router-mounts-route' && e.target === g.id)
    const nested = contexts.some(x => mounts.some(parent => parent.target === x.source))
    const mountWitnesses = contexts.flatMap(x => { const item = witness(span(x.file.path, x.fact.line, x.fact.column, x.fact.endLine ?? null), null, 'framework-graph', mountEdges.find(e => e.metadata?.callSite === `${x.file.path}:${x.fact.line}:${x.fact.column}`)?.id ?? null); return item ? [item] : [] })
    n.provenance = [w, ...mountWitnesses]
    const mountValid = contexts.every(x => x.fact.status === 'static' && x.source && literalPath(x.fact.prefix ?? null) && mountEdges.some(e => e.metadata?.callSite === `${x.file.path}:${x.fact.line}:${x.fact.column}`))
    const paths = literalPath(n.value) ? contexts.length ? contexts.flatMap(x => literalPath(x.fact.prefix ?? null) ? [compose(x.fact.prefix!, n.value!)] : []) : [n.value!] : []
    const ambiguous = contexts.length > 1
    const qualified = supported && usable(file.path) && target && usable(target.file) && m?.pathStatus === 'static' && handledBy && mountValid && !nested && paths.length > 0
    const reason = !supported ? 'unsupported-framework-or-method' : nested ? 'unsupported-nested-mount' : !mountValid ? 'mount-identity-or-prefix-unresolved' : ambiguous ? 'ambiguous-mount-contexts' : !qualified ? 'route-or-handler-identity-unresolved' : null
    const evidence = [w, ...mountWitnesses, ...(qualified ? target.provenance : [])]
    add('api-endpoint-handled-by', n, qualified && !ambiguous ? target : null, evidence, reason, ambiguous && target ? [target.id] : [], !supported || nested ? 'UNSUPPORTED' : ambiguous && qualified ? 'AMBIGUOUS' : qualified ? 'RESOLVED' : 'UNRESOLVED', method, paths.length === 1 ? paths[0] : n.value)
    if (qualified) for (const path of paths) {
      const candidate = ambiguous ? { ...n, id: 'framework-route:mounted:' + apiEvidenceHash([n.id, path]), value: path } : n
      nodes.set(candidate.id, candidate)
      endpoints.push({ node: candidate, method, path, handler: target.id, ambiguous, contextGroup: n.id })
    }
  }
  for (const file of files.filter(f => /(^|\/)route\.[jt]sx?$/.test(f.path))) {
    const declared = input.frontendReachability?.routes.some(r => r.declarations?.some(d => d.convention === 'app-route-handler' && d.sourceRef.filePath === file.path))
    if (!declared && (file.imports.includes('next/server') || /^(src\/)?app\/api\//.test(file.path))) diagnostic(file.path, 'unsupported-next-route-file-scope', 'UNSUPPORTED')
  }
  // Consume the existing file-convention producer, authenticated by a real next/server reference.
  for (const route of input.frontendReachability?.routes ?? []) for (const d of route.declarations ?? []) {
    if (d.convention !== 'app-route-handler') continue
    const file = files.find(f => f.path === d.sourceRef.filePath)
    if (!file) continue
    const auth = (file.importBindings ?? []).filter(b => b.sourceSpecifier === 'next/server' && (file.apiRelationships?.observations ?? []).some(o => ['framework-reference', 'type-reference'].includes(o.kind) && o.name === b.localName && o.reason === null))
    const imports = selected.get(file.path)!.facts.filter(f => f.kind === 'import' && f.sourceSpecifier === 'next/server')
    const staticProfile = /^(src\/)?app\/api\/(?:[A-Za-z0-9_-]+\/)*route\.[jt]s$/.test(file.path) && d.status === 'supported' && !route.declarationsTruncated && (d.segmentKinds ?? []).every(k => k === 'static') && literalPath(d.pattern)
    if (!staticProfile || !auth.length || !imports.length || !usable(file.path)) { diagnostic(file.path, !auth.length ? 'next-framework-context-unavailable' : 'unsupported-next-route-profile', !auth.length ? 'UNRESOLVED' : 'UNSUPPORTED'); continue }
    for (const observed of d.methods ?? []) {
      const method = API_RELATIONSHIP_METHODS.find(v => v === observed.method)
      if (!method) continue
      const matches = file.symbols.filter(s => s.name === method && s.exported && ['function', 'const'].includes(s.kind) && s.location.line === observed.sourceRef.line)
      const exported = selected.get(file.path)!.facts.filter(f => f.kind === 'export' && f.name === method && matches.some(s => f.symbolId === s.nodeId))
      const target = matches.length === 1 && exported.length ? symbolNode(file, matches[0]) : null
      if (!target) { diagnostic(file.path, 'next-handler-identity-unresolved', 'UNRESOLVED'); continue }
      const w = witness(span(file.path, observed.sourceRef.line ?? 1, observed.sourceRef.column ?? null, null), target.id, 'symbol-import-graph', exported[0].id)!
      const provenance = [w, ...imports.flatMap(f => { const w = witness(f.span, null, 'symbol-import-graph', f.id); return w ? [w] : [] })]
      const n: ApiRelationshipNode = { id: 'framework-route:next-app:' + apiEvidenceHash([file.path, target.id, method, d.pattern]), kind: 'framework-route', file: file.path, symbolId: target.id, location: w.span, value: d.pattern, provenance }
      nodes.set(n.id, n)
      add('api-endpoint-handled-by', n, target, [...provenance, ...target.provenance], null, [], 'RESOLVED', method, d.pattern)
      endpoints.push({ node: n, method, path: d.pattern, handler: target.id })
    }
  }
  const requests: Array<{ file: FileSummary; observation: ApiSourceObservation; node: ApiRelationshipNode; owner: ApiRelationshipNode | null }> = []
  const capabilities: ApiRelationshipEvidence['capabilities'] = []
  for (const f of audit.files) {
    const file = files.find(x => x.path === f.path)
    const supported = f.language === 'typescript' || f.language === 'javascript'
    const payload = file?.apiRelationships
    const status = !supported ? 'unsupported' : !f.contentSha256 || !file || !payload || payload.revision !== API_RELATIONSHIP_PRODUCER || f.capabilities.declarations !== 'complete' ? 'failed' : payload.status
    capabilities.push({ file: f.path, profile: supported ? 'js-ts-static-v1' : 'unsupported', status })
    if (status !== 'complete') { diagnostic(f.path, !supported ? 'unsupported-language-profile' : !payload ? 'missing-source-capability' : 'source-evidence-unavailable', supported ? 'UNRESOLVED' : 'UNSUPPORTED'); continue }
    for (const o of payload!.observations) {
      if (o.kind === 'unsupported-route') { diagnostic(f.path, o.reason!, 'UNSUPPORTED', 'api-call-targets-route', span(f.path, o.line, o.column, o.endLine)); continue }
      if (o.kind !== 'request') continue
      const origin = owner(file!, o)
      const location = span(f.path, o.line, o.column, o.endLine)
      const w = witness(location, origin?.id ?? null, 'typescript-ast')!
      const n: ApiRelationshipNode = { id: 'api-client-call:' + apiEvidenceHash([f.path, o.line, o.column]), kind: 'api-client-call', file: f.path, symbolId: origin?.id ?? null, location, value: o.path, provenance: [w] }
      nodes.set(n.id, n)
      requests.push({ file: file!, observation: o, node: n, owner: origin })
      if (origin) add('api-call-originates-in-component', n, origin, [w, ...origin.provenance])
      else add('api-call-originates-in-component', n, null, [w], 'missing-declaration-identity')
      const requestPath = literalPath(o.path, true)
      const matched = !o.reason && o.method && requestPath ? endpoints.filter(e => e.method === o.method && e.path === requestPath) : []
      const groups = new Set(matched.filter(e => e.ambiguous).map(e => e.contextGroup))
      const candidates = [...new Map([...matched, ...endpoints.filter(e => e.ambiguous && groups.has(e.contextGroup))].map(e => [e.node.id, e])).values()]
      // A candidate is a bounded static method/path association, never proof of runtime dispatch.
      const reason = o.reason ?? (!requestPath ? 'external-or-unqualified-path' : !origin ? 'missing-declaration-identity' : candidates.length > 1 || candidates.some(c => c.ambiguous) ? 'ambiguous-route-candidates' : candidates.length === 0 ? 'no-qualified-selected-endpoint' : null)
      const target = reason === null && candidates.length === 1 ? candidates[0].node : null
      add('api-call-targets-route', n, target, [w, ...(target?.provenance ?? [])], reason, candidates.map(c => c.node.id), reason === 'ambiguous-route-candidates' ? 'AMBIGUOUS' : reason?.startsWith('shadowed') || reason?.startsWith('unsupported') ? 'UNSUPPORTED' : target ? 'RESOLVED' : 'UNRESOLVED', o.method, o.path)
    }
  }
  // Establish supported invocation owners before considering their explicit type references.
  for (const family of ['call', 'type-reference'] as const) for (const file of files) for (const o of (file.apiRelationships?.observations ?? []).filter(o => o.kind === family)) {
    const source = owner(file, o)
    if (!source) {
      if (family === 'call') {
        const bindings = referenced(file, o.name, false)
        const candidates = requests.filter(r => bindings.some(t => t.symbol.nodeId === r.owner?.id)).map(r => r.node.id)
        if (candidates.length) diagnostic(file.path, 'missing-call-owner-identity', 'UNRESOLVED', 'api-client-invokes-request', span(file.path, o.line, o.column, o.endLine), candidates)
      }
      continue
    }
    if (family === 'type-reference' && !requests.some(r => r.owner?.id === source.id) && ![...nodes.values()].some(n => n.kind === 'framework-route' && n.symbolId === source.id) && ![...relationships.values()].some(r => r.kind === 'api-client-invokes-request' && r.source === source.id)) continue
    const w = witness(span(file.path, o.line, o.column, o.endLine), source.id, 'typescript-ast')
    if (!w) continue
    const targets = o.reason && o.kind !== 'call' ? [] : referenced(file, o.name, o.kind === 'type-reference')
    const binding = file.importBindings?.find(b => b.localName === o.name)
    const importWitnesses = binding ? (selected.get(file.path)?.facts ?? []).filter(f => f.kind === 'import' && f.sourceSpecifier === binding.sourceSpecifier && f.importResolution === 'resolved-local').flatMap(f => {
      const item = witness(f.span, source.id, 'symbol-import-graph', f.id)
      return item ? [item] : []
    }) : []
    if (o.kind === 'call') {
      const targetRequests = requests.filter(r => targets.some(t => r.owner?.id === t.symbol.nodeId))
      if (targetRequests.length && (targets.length !== 1 || o.reason)) {
        const candidates = [...new Set(targetRequests.map(r => r.node.id))]
        add('api-client-invokes-request', source, null, [w, ...importWitnesses], candidates.length > 1 ? 'ambiguous-invoked-symbol' : 'unqualified-invoked-symbol', candidates, candidates.length > 1 ? 'AMBIGUOUS' : 'UNRESOLVED')
      } else for (const r of targetRequests) add('api-client-invokes-request', source, r.node, [w, ...importWitnesses, ...r.node.provenance])
    } else {
      const candidates = targets.flatMap(t => { const n = symbolNode(t.file, t.symbol, 'schema-declaration'); return n ? [n] : [] })
      const target = targets.length === 1 && candidates.length === 1 ? candidates[0] : null
      const kind = endpoints.some(e => e.handler === source.id) ? 'api-handler-references-schema' : 'api-call-references-declaration'
      add(kind, source, target, [w, ...importWitnesses, ...(target?.provenance ?? [])], target ? null : candidates.length > 1 ? 'ambiguous-declaration-identity' : 'missing-declaration-identity', candidates.map(n => n.id), candidates.length > 1 ? 'AMBIGUOUS' : target ? 'RESOLVED' : 'UNRESOLVED')
      // Class declaration identity + exact existing model source ref; never name-only model lineage.
      if (kind === 'api-handler-references-schema' && target && targets[0].symbol.kind === 'class' && binding) {
        const models = (input.dataModel?.entities ?? []).filter(e => e.sourceRefs.length === 1 && e.sourceRefs.some(r => r.filePath === target.file && r.symbolId === target.id && r.line === target.location.startLine))
        if (models.length === 1 && models[0].warnings.length === 0) {
          const model = models[0]
          const ref: ApiRelationshipNode = { ...target, id: 'api-data-entity-ref:' + encodeURIComponent(model.id), kind: 'api-data-entity-ref', value: model.id }
          nodes.set(ref.id, ref)
          add('api-handler-uses-data-entity', source, ref, [w, ...importWitnesses, ...target.provenance])
        } else diagnostic(file.path, 'data-model-identity-unavailable-or-ambiguous', 'UNRESOLVED', 'api-handler-uses-data-entity', w.span)
      }
    }
  }
  // An event reference is static evidence only. Follow exact call observations with a bounded cycle-safe walk.
  for (const file of files) for (const event of (file.apiRelationships?.observations ?? []).filter(o => o.kind === 'ui-event')) {
    const component = owner(file, event)
    if (!component) {
      diagnostic(file.path, 'ui-component-identity-unavailable', 'UNRESOLVED', 'api-client-invokes-request', span(file.path, event.line, event.column, event.endLine))
      continue
    }
    const w = witness(span(file.path, event.line, event.column, event.endLine), component.id, 'typescript-ast')!
    const reactContext = (file.importBindings ?? []).some(b => ['react', 'react/jsx-runtime'].includes(b.sourceSpecifier))
    const handlers = event.reason || !reactContext ? [] : referenced(file, event.name, false)
    const pending = handlers.map(h => ({ ...h, witnesses: [w, ...referenceWitnesses(file, event.name, component.id)], seen: new Set<string>() }))
    let visited = 0, found = false
    while (pending.length && visited++ < 64) {
      const current = pending.shift()!, id = current.symbol.nodeId
      if (!id || current.seen.has(id) || !usable(current.file.path)) continue
      const handler = symbolNode(current.file, current.symbol)
      if (!handler) continue
      const seen = new Set([...current.seen, id])
      const evidence = [...current.witnesses, ...handler.provenance]
      for (const r of requests.filter(r => r.owner?.id === id)) {
        found = true
        add('api-client-invokes-request', component, handlers.length === 1 ? r.node : null, [...evidence, ...r.node.provenance], handlers.length === 1 ? null : 'ambiguous-ui-handler', [r.node.id], handlers.length === 1 ? 'RESOLVED' : 'AMBIGUOUS')
      }
      for (const call of (current.file.apiRelationships?.observations ?? []).filter(o => o.kind === 'call' && !o.reason && o.ownerName === current.symbol.name && o.ownerLine === current.symbol.location.line)) {
        const targets = referenced(current.file, call.name, false)
        if (targets.length !== 1) continue
        const cw = witness(span(current.file.path, call.line, call.column, call.endLine), id, 'typescript-ast')
        if (cw) pending.push({ ...targets[0], witnesses: [...evidence, cw, ...referenceWitnesses(current.file, call.name, id)], seen })
      }
    }
    if (!found || pending.length) add('api-client-invokes-request', component, null, [w], pending.length ? 'ui-call-bound-exceeded' : 'unresolved-ui-handler', [], 'UNRESOLVED')
    limit('ui-event-reference-does-not-prove-execution', file.path)
  }
  const complete = audit.coverage.inventoryComplete && audit.coverage.exclusionsAreExplicit
  if (!complete) limit('incomplete-source-selection', 'artifact')
  // Speculative local symbol checks are not API facts unless a qualified claim or diagnostic uses them.
  const usedNodeIds = new Set([...relationships.values()].flatMap(r => r.target === null ? [r.source] : [r.source, r.target]))
  for (const u of unresolved) { if (u.source) usedNodeIds.add(u.source); for (const id of u.candidates) usedNodeIds.add(id) }
  const production = capabilities.some(c => c.status === 'complete') ? capabilities.every(c => c.status === 'complete') && complete ? 'complete' : 'partial' : capabilities.some(c => c.status === 'failed') ? 'failed' : capabilities.length ? 'unsupported' : complete ? 'complete' : 'partial'
  const artifact = sealApiRelationshipEvidence({
    artifactKind: API_RELATIONSHIP_ARTIFACT_KIND, schemaVersion: API_RELATIONSHIP_SCHEMA_VERSION,
    producer: { packageName: '@dailephd/my-dev-kit', packageVersion: input.producerVersion, revision: API_RELATIONSHIP_PRODUCER },
    sourceSnapshot: { snapshotId: audit.source.snapshotId, selectionFingerprint: audit.source.selectionFingerprint, files: audit.files.map(f => ({ path: f.path, contentSha256: f.contentSha256 })).sort((a, b) => compareApiIdentity(a.path, b.path)) },
    selection: { sourceRoots: [...audit.source.sourceRoots], excludes: [...audit.source.excludes], complete, production },
    capabilities: capabilities.sort((a, b) => compareApiIdentity(a.file, b.file)),
    nodes: [...nodes.values()].filter(n => usedNodeIds.has(n.id)).sort((a, b) => compareApiIdentity(a.id, b.id)),
    relationships: [...relationships.values()].sort((a, b) => compareApiIdentity(a.id, b.id)),
    unresolved: [...new Map(unresolved.map(u => [apiEvidenceHash(u), u])).values()].sort((a, b) => compareApiIdentity(JSON.stringify([a.source ?? a.location.path, a.family, a.location.startLine, a.reason]), JSON.stringify([b.source ?? b.location.path, b.family, b.location.startLine, b.reason]))),
    limitations: [...limitations.values()].sort((a, b) => compareApiIdentity(`${a.code}\0${a.scope}`, `${b.code}\0${b.scope}`)),
  })
  const validation = validateApiRelationshipEvidence(artifact)
  if (!validation.valid) throw new Error(`Invalid API relationship evidence: ${validation.errors.join(', ')}`)
  return artifact
}

export function serializeApiRelationshipEvidence(artifact: ApiRelationshipEvidence): { json: string; reference: ApiRelationshipEvidenceReference } {
  const result = validateApiRelationshipEvidence(artifact)
  if (!result.valid) throw new Error(`Invalid API relationship evidence: ${result.errors.join(', ')}`)
  const json = JSON.stringify(artifact, null, 2) + '\n'
  return { json, reference: { path: API_RELATIONSHIP_FILENAME, schemaVersion: API_RELATIONSHIP_SCHEMA_VERSION, sha256: createHash('sha256').update(json).digest('hex'), snapshotId: artifact.sourceSnapshot.snapshotId } }
}
