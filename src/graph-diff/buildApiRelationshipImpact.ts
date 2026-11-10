import {
  API_RELATIONSHIP_CANDIDATE_LIMIT as LIMIT, apiEvidenceHash, compareApiIdentity,
  type ApiRelationship, type ApiRelationshipNode, type ApiRelationshipQualification,
  type ApiRelationshipWitness,
} from '../symbol-index/apiRelationshipEvidenceTypes.js'
import type { GraphDiffApiSnapshot } from './loadGraphDiffArtifacts.js'
import type { ApiImpactEvidenceRef, ApiImpactSubjectRef, ApiPotentialImpact, ApiRelationshipChange, ApiRelationshipImpactSection } from './types.js'

type RecordValue = ApiRelationshipNode | ApiRelationship
const isNode = (v: RecordValue): v is ApiRelationshipNode => 'provenance' in v
const ref = (v: RecordValue): ApiImpactSubjectRef => ({ id: v.id, kind: v.kind })
const sorted = (v: string[]) => [...new Set(v)].sort(compareApiIdentity)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const witnesses = (v: RecordValue) => isNode(v) ? v.provenance : v.witnesses
const unresolvedFor = (s: GraphDiffApiSnapshot, r: ApiRelationship) => s.artifact!.unresolved.filter(u =>
  u.source === r.source && u.family === r.kind && u.qualification === r.qualification && same(u.location, r.witnesses[0].span))
const qualification = (values: ApiRelationshipQualification[]): ApiRelationshipQualification =>
  values.includes('UNSUPPORTED') ? 'UNSUPPORTED' : values.includes('AMBIGUOUS') ? 'AMBIGUOUS' : values.includes('UNRESOLVED') ? 'UNRESOLVED' : 'RESOLVED'

/** Pure projection over authenticated persisted snapshots; no source or artifact IO. */
export function buildApiRelationshipImpact(before: GraphDiffApiSnapshot, after: GraphDiffApiSnapshot): ApiRelationshipImpactSection | undefined {
  if (!before.registered && !after.registered) return undefined
  const availability = before.registered && after.registered ? 'both' : before.registered ? 'before-only' : 'after-only'
  const warnings = new Set<string>(['static-association-only-no-runtime-compatibility-verdict'])
  for (const [side, s] of [['before', before], ['after', after]] as const) for (const w of s.warnings) warnings.add(`${side}:${w}`)
  const changes: ApiRelationshipChange[] = [], impacts: ApiPotentialImpact[] = []
  let metadataTruncated = false
  const b = before.artifact, a = after.artifact
  const available = !!b && !!a && !!before.audit && !!after.audit
  const universe = available && before.projectRoot === after.projectRoot && b.sourceSnapshot.selectionFingerprint === a.sourceSnapshot.selectionFingerprint && same(sorted(b.selection.sourceRoots), sorted(a.selection.sourceRoots)) && same(sorted(b.selection.excludes), sorted(a.selection.excludes))
  let status: ApiRelationshipImpactSection['status'] = available && universe ? 'COMPARABLE' : available ? 'UNAVAILABLE' : b || a ? 'PARTIAL' : 'UNAVAILABLE'
  if (!b || !a) warnings.add('two-authenticated-snapshots-required-no-addition-or-removal-inferred')
  if (available && !universe) warnings.add('incompatible-source-universe')
  let complete = status === 'COMPARABLE'
  const states: ApiRelationshipQualification[] = []
  for (const [side, s] of [['before', before], ['after', after]] as const) {
    if (!s.artifact) continue
    const v = s.artifact
    if (!v.selection.complete || v.selection.production !== 'complete' || !same(sorted(v.capabilities.map(c => c.file)), sorted(v.sourceSnapshot.files.map(f => f.path))) || new Set(v.capabilities.map(c => c.file)).size !== v.capabilities.length || v.capabilities.some(c => c.status !== 'complete') || !s.audit?.coverage.inventoryComplete || !s.audit.coverage.exclusionsAreExplicit) {
      complete = false; states.push('UNRESOLVED'); warnings.add(`${side}:incomplete-selection-or-capability`)
    }
    for (const u of v.unresolved) { complete = false; states.push(u.qualification); warnings.add(`${side}:${u.qualification}:${u.family}:${u.reason}`) }
    for (const r of v.relationships) if (r.qualification !== 'RESOLVED') { complete = false; states.push(r.qualification) }
    for (const l of v.limitations) if (l.code.includes('truncated') || l.code.includes('unavailable') || l.code.includes('incomplete')) { complete = false; states.push('UNRESOLVED'); warnings.add(`${side}:${l.code}`) }
  }
  if (status === 'COMPARABLE' && !complete) status = 'PARTIAL'
  if (available && universe) {
    const aliases = new Map<string, string>()
    const bn = new Map(b.nodes.map(n => [n.id, n])), an = new Map(a.nodes.map(n => [n.id, n]))
    const canonical = (id: string | null, side: GraphDiffApiSnapshot = after) => id === null ? null : side === before ? id : aliases.get(id) ?? id
    // Cancel location-only identity churn only with the same exact declaration
    // and equal semantics, uniquely on BOTH sides. Never infer a changed call
    // from a function name, line proximity, or an endpoint path resemblance.
    const nodeKey = (n: ApiRelationshipNode) => n.symbolId === null ? null : JSON.stringify([n.kind, n.file, n.symbolId, n.value])
    const group = <T>(records: T[], key: (v: T) => string | null) => {
      const result = new Map<string, T[]>()
      for (const v of records) { const k = key(v); if (k !== null) result.set(k, [...(result.get(k) ?? []), v]) }
      return result
    }
    const oldGroups = group(b.nodes, nodeKey), newGroups = group(a.nodes, nodeKey)
    for (const [key, old] of oldGroups) {
      const next = newGroups.get(key)
      if (old.length === 1 && next?.length === 1 && old[0].id !== next[0].id && (!an.has(old[0].id) || nodeKey(an.get(old[0].id)!) !== key) && (!bn.has(next[0].id) || nodeKey(bn.get(next[0].id)!) !== key)) aliases.set(next[0].id, old[0].id)
    }
    const evidence = (side: 'before' | 'after', v: RecordValue): ApiImpactEvidenceRef => {
      const s = side === 'before' ? b : a
      const all = [...witnesses(v)].sort((x, y) => compareApiIdentity(x.id, y.id))
      if (all.length > LIMIT) metadataTruncated = true
      return { side, snapshotId: s.sourceSnapshot.snapshotId, artifactIdentity: s.integrity.digest, subject: ref(v), witnesses: all.slice(0, LIMIT), availableWitnessCount: all.length, returnedWitnessCount: Math.min(all.length, LIMIT) }
    }
    const witnessSemantics = (w: ApiRelationshipWitness[]) => sorted(w.map(v => JSON.stringify([v.span.path, v.symbolId, v.provenance])))
    const declaration = (s: GraphDiffApiSnapshot, n: ApiRelationshipNode) => {
      if (!n.symbolId) return []
      return (s.audit?.files.find(f => f.path === n.file)?.facts ?? []).filter(f => f.kind === 'declaration' && f.symbolId === n.symbolId).map(f => JSON.stringify([f.symbolId, f.declarationKind, f.ownerKey, f.exported, f.visibility])).sort(compareApiIdentity)
    }
    const semantics = (v: RecordValue, s: GraphDiffApiSnapshot): Record<string, unknown> => isNode(v)
      ? { kind: v.kind, file: v.file, symbolId: v.symbolId, value: v.value, declaration: declaration(s, v) }
      : { kind: v.kind, source: canonical(v.source, s), target: canonical(v.target, s), method: v.method, path: v.path, qualification: v.qualification, unresolvedTargetKey: v.unresolvedTargetKey, limitations: sorted(v.limitations), witnessDeclarations: witnessSemantics(v.witnesses), unresolved: sorted(unresolvedFor(s, v).map(u => JSON.stringify([u.reason, sorted(u.candidates.map(id => canonical(id, s)!)), sorted(u.missingEvidence)]))) }
    const observed = (old: RecordValue | undefined, next: RecordValue | undefined) => {
      const fields = old && next ? Object.keys(semantics(old, before)).filter(k => !same(semantics(old, before)[k], semantics(next, after)[k])).sort(compareApiIdentity) : []
      if (old && next && !fields.length) return
      const kind = old && next ? 'MODIFIED' : next ? 'ADDED' : 'REMOVED'
      const q = qualification([old, next].flatMap(v => v && !isNode(v) ? [v.qualification] : []))
      const ev = [...(old ? [evidence('before', old)] : []), ...(next ? [evidence('after', next)] : [])]
      const subject = (next ?? old)!
      changes.push({ id: 'api-change:' + apiEvidenceHash([kind, old ? ref(old) : null, next ? ref(next) : null, old ? semantics(old, before) : null, next ? semantics(next, after) : null]), changeKind: kind, subjectKind: subject.kind, ...(old ? { before: ref(old) } : {}), ...(next ? { after: ref(next) } : {}), changedFields: fields, evidence: ev, qualification: q, reasonCodes: [isNode(subject) ? 'observed-contract-node-delta' : 'observed-relationship-delta', ...(isNode(subject) && kind !== 'MODIFIED' ? ['projection-membership-not-source-declaration-existence'] : []), ...(q !== 'RESOLVED' ? ['relationship-uncertainty-retained'] : [])] })
    }
    const compareRecords = (old: RecordValue[], next: RecordValue[], key: (v: RecordValue, s: GraphDiffApiSnapshot) => string) => {
      const oldMap = new Map(old.map(v => [key(v, before), v])), newMap = new Map(next.map(v => [key(v, after), v]))
      for (const id of sorted([...oldMap.keys(), ...newMap.keys()])) observed(oldMap.get(id), newMap.get(id))
    }
    compareRecords(b.nodes, a.nodes, (v, s) => JSON.stringify([canonical(v.id, s), isNode(v) ? [v.kind, v.file, v.symbolId] : null]))
    // Relationship IDs include source bytes/witness locations. Match identical
    // semantic records first so unrelated edits and line shifts create no delta.
    const remainingB = new Map(b.relationships.map(r => [r.id, r])), remainingA = new Map(a.relationships.map(r => [r.id, r]))
    for (const id of sorted([...remainingB.keys()])) if (remainingA.has(id)) { observed(remainingB.get(id), remainingA.get(id)); remainingB.delete(id); remainingA.delete(id) }
    const bg = group([...remainingB.values()], r => JSON.stringify(semantics(r, before))), ag = group([...remainingA.values()], r => JSON.stringify(semantics(r, after)))
    for (const [key, old] of bg) {
      const next = ag.get(key) ?? []
      // Equal multiplicity is necessary; duplicate equivalent occurrences do not
      // provide a declaration identity for a modified relationship.
      if (old.length === next.length) { for (const r of old) remainingB.delete(r.id); for (const r of next) remainingA.delete(r.id) }
    }
    // Exact source declaration/request identity and relationship family provide
    // an association only when one unmatched record exists on each side.
    const relationKey = (r: ApiRelationship, s: GraphDiffApiSnapshot) => {
      const n = s.artifact!.nodes.find(n => n.id === r.source)!
      return JSON.stringify([r.kind, canonical(r.source, s), n.kind, n.file, n.symbolId])
    }
    const bo = group([...remainingB.values()], r => relationKey(r, before)), ao = group([...remainingA.values()], r => relationKey(r, after))
    for (const [key, old] of bo) {
      const next = ao.get(key)
      if (old.length === 1 && next?.length === 1) { observed(old[0], next[0]); remainingB.delete(old[0].id); remainingA.delete(next[0].id) }
    }
    for (const r of remainingB.values()) observed(r, undefined)
    for (const r of remainingA.values()) observed(undefined, r)

    // Equal multisets prove absence of a semantic delta even when repeated
    // equivalent sites move. This cancels churn without pairing ambiguous sites
    // or inventing a modified identity for any individual occurrence.
    const semanticInventory = (s: GraphDiffApiSnapshot) => {
      const art = s.artifact!, nodes = new Map(art.nodes.map(n => [n.id, n]))
      const node = (id: string | null) => id === null ? null : semantics(nodes.get(id)!, s)
      return JSON.stringify([
        art.nodes.map(n => JSON.stringify(semantics(n, s))).sort(compareApiIdentity),
        art.relationships.map(r => JSON.stringify({ ...semantics(r, s), source: node(r.source), target: node(r.target), unresolved: sorted(unresolvedFor(s, r).map(u => JSON.stringify([u.reason, u.candidates.map(node).map(v => JSON.stringify(v)).sort(compareApiIdentity), sorted(u.missingEvidence)]))) })).sort(compareApiIdentity),
      ])
    }
    if (semanticInventory(before) === semanticInventory(after)) changes.length = 0

    const impactMap = new Map<string, ApiPotentialImpact>()
    for (const change of changes) for (const [side, s] of [['before', before], ['after', after]] as const) {
      const changed = side === 'before' ? change.before : change.after
      if (!changed) continue
      const art = s.artifact!, nodes = new Map(art.nodes.map(n => [n.id, n]))
      const changedRelation = art.relationships.find(r => r.id === changed.id)
      for (const r of art.relationships) {
        const direct = changedRelation ? r.id === changedRelation.id : r.source === changed.id || r.target === changed.id
        if (!direct) continue
        const unknown = unresolvedFor(s, r)
        const associated = changedRelation ? [r.source, ...(r.target ? [r.target] : [])] : [r.source, ...(r.target ? [r.target] : [])].filter(id => id !== changed.id)
        if (r.target === null) associated.push(...unknown.flatMap(u => u.candidates).filter(id => id !== changed.id))
        for (const id of sorted(associated)) {
          const n = nodes.get(id)
          if (!n) continue
          const q = qualification([change.qualification, r.qualification])
          const key = JSON.stringify([change.id, changed.kind, canonical(changed.id, s), n.kind, canonical(n.id, s), r.kind])
          const ev = evidence(side, r), previous = impactMap.get(key)
          if (previous) {
            if (!previous.evidence.some(e => e.side === side && e.subject.id === r.id)) previous.evidence.push(ev)
            previous.qualification = qualification([previous.qualification, q])
          } else impactMap.set(key, { id: 'api-impact:' + apiEvidenceHash(key), changedSubject: changed, associatedSubject: ref(n), relationshipKind: r.kind, evidence: [ev], qualification: q, reasonCodes: ['direct-static-association-only', ...(r.target === null ? ['unresolved-candidate-not-confirmed-target'] : []), ...unknown.map(u => u.reason)] })
        }
      }
    }
    for (const i of impactMap.values()) {
      i.evidence.sort((x, y) => compareApiIdentity(`${x.side}:${x.subject.id}`, `${y.side}:${y.subject.id}`))
      i.reasonCodes = sorted(i.reasonCodes)
      if (i.evidence.length > LIMIT || i.reasonCodes.length > LIMIT) metadataTruncated = true
      i.evidence = i.evidence.slice(0, LIMIT); i.reasonCodes = i.reasonCodes.slice(0, LIMIT)
      impacts.push(i)
    }
    if (b.sourceSnapshot.files.some(f => a.sourceSnapshot.files.some(n => n.path === f.path && n.contentSha256 !== f.contentSha256))) warnings.add('source-bytes-changed-only-supported-semantic-deltas-projected')
  }
  changes.sort((x, y) => compareApiIdentity(x.id, y.id)); impacts.sort((x, y) => compareApiIdentity(x.id, y.id))
  const allWarnings = [...warnings].sort(compareApiIdentity)
  const truncated = metadataTruncated || changes.length > LIMIT || impacts.length > LIMIT || allWarnings.length > LIMIT
  complete = complete && !truncated
  if (truncated && status === 'COMPARABLE') status = 'PARTIAL'
  return { availability, status, changes: changes.slice(0, LIMIT), potentialImpacts: impacts.slice(0, LIMIT), summary: { availableChangeCount: changes.length, returnedChangeCount: Math.min(changes.length, LIMIT), availableImpactCount: impacts.length, returnedImpactCount: Math.min(impacts.length, LIMIT), availableWarningCount: allWarnings.length, returnedWarningCount: Math.min(allWarnings.length, LIMIT), truncated, complete, qualification: qualification([...states, ...(!complete ? ['UNRESOLVED' as const] : [])]) }, warnings: allWarnings.slice(0, LIMIT) }
}
