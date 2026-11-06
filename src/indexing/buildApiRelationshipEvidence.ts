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
  limit('router-mount-prefix-not-resolved', 'artifact')
  limit('request-profile-direct-fetch-and-exact-wrapper-calls', 'artifact')
  limit('endpoint-profile-express-only', 'artifact')
  limit('schema-profile-explicit-source-type-references-only', 'artifact')
  limit('data-access-mapping-reserved-not-produced', 'artifact')
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
  const endpoints: Array<{ node: ApiRelationshipNode; method: ApiRelationship['method']; path: string; handler: string }> = []
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
    const qualified = supported && file.capabilities.declarations === 'complete' && m?.pathStatus === 'static' && n.value !== null && target && handledBy
    add('api-endpoint-handled-by', n, qualified ? target : null, [w, ...(qualified ? target.provenance : [])], qualified ? null : !supported ? 'unsupported-framework-or-method' : 'route-or-handler-identity-unresolved', [], !supported ? 'UNSUPPORTED' : qualified ? 'RESOLVED' : 'UNRESOLVED', method, n.value)
    if (qualified) endpoints.push({ node: n, method, path: n.value!, handler: target.id })
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
      const candidates = !o.reason && o.method && o.path?.startsWith('/') && !o.path.startsWith('//') ? endpoints.filter(e => e.method === o.method && e.path === o.path) : []
      // A candidate is a bounded static method/path association, never proof of runtime dispatch.
      const reason = o.reason ?? (!o.path?.startsWith('/') || o.path.startsWith('//') ? 'external-or-unqualified-path' : !origin ? 'missing-declaration-identity' : candidates.length > 1 ? 'ambiguous-route-candidates' : candidates.length === 0 ? 'no-qualified-selected-endpoint' : null)
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
    }
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
