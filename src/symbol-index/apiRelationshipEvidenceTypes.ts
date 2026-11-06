import { createHash } from 'node:crypto'
import { API_CONTRACT_EDGE_KINDS, type ApiContractEdgeKind } from '../graph/apiContractTypes.js'
import type { SourceAuditSpan } from './auditEvidenceTypes.js'

/** Independent projection; never changes the source-audit or code-graph schema. */
export const API_RELATIONSHIP_ARTIFACT_KIND = 'kit-api-relationship-evidence-v1' as const
export const API_RELATIONSHIP_SCHEMA_VERSION = '1.0.0' as const
export const API_RELATIONSHIP_PRODUCER = 'api-relationship-v1.0.0' as const
export const API_RELATIONSHIP_FILENAME = 'api-relationship-evidence.json' as const
export const API_RELATIONSHIP_CANDIDATE_LIMIT = 64
export const API_RELATIONSHIP_QUALIFICATIONS = ['RESOLVED', 'AMBIGUOUS', 'UNRESOLVED', 'UNSUPPORTED'] as const
export type ApiRelationshipQualification = typeof API_RELATIONSHIP_QUALIFICATIONS[number]
export const API_RELATIONSHIP_NODE_KINDS = ['api-client-call', 'framework-route', 'source-symbol', 'schema-declaration', 'api-data-entity-ref', 'api-data-field-ref'] as const
export const API_RELATIONSHIP_KINDS = [...API_CONTRACT_EDGE_KINDS, 'api-endpoint-handled-by', 'api-client-invokes-request', 'api-call-references-declaration'] as const
export type ApiRelationshipKind = ApiContractEdgeKind | 'api-endpoint-handled-by' | 'api-client-invokes-request' | 'api-call-references-declaration'
export const API_RELATIONSHIP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export type ApiRelationshipMethod = typeof API_RELATIONSHIP_METHODS[number]

/** Raw observations from the existing AST, before declaration IDs are assigned. */
export interface ApiSourceObservation {
  kind: 'request' | 'call' | 'type-reference' | 'unsupported-route'
  line: number
  column: number
  endLine: number
  ownerLine: number | null
  ownerName: string | null
  name: string | null
  method: ApiRelationshipMethod | null
  path: string | null
  reason: string | null
}
export interface ApiSourceObservations {
  revision: typeof API_RELATIONSHIP_PRODUCER
  status: 'complete' | 'unsupported' | 'failed'
  observations: ApiSourceObservation[]
}
export interface ApiRelationshipWitness {
  id: string
  span: SourceAuditSpan
  contentSha256: string
  symbolId: string | null
  factId: string | null
  provenance: 'typescript-ast' | 'framework-graph' | 'symbol-import-graph'
}
export interface ApiRelationshipNode {
  id: string
  kind: typeof API_RELATIONSHIP_NODE_KINDS[number]
  file: string
  symbolId: string | null
  location: SourceAuditSpan
  value: string | null
  provenance: ApiRelationshipWitness[]
}
export interface ApiRelationship {
  id: string
  kind: ApiRelationshipKind
  source: string
  target: string | null
  qualification: ApiRelationshipQualification
  method: ApiRelationshipMethod | null
  path: string | null
  unresolvedTargetKey: string | null
  witnesses: ApiRelationshipWitness[]
  limitations: string[]
}
export interface ApiUnresolvedRelationship {
  source: string | null
  location: SourceAuditSpan
  family: ApiRelationshipKind
  qualification: Exclude<ApiRelationshipQualification, 'RESOLVED'>
  reason: string
  candidates: string[]
  missingEvidence: string[]
}
export interface ApiRelationshipLimitation { code: string; scope: string }
export interface ApiRelationshipEvidence {
  schemaVersion: typeof API_RELATIONSHIP_SCHEMA_VERSION
  artifactKind: typeof API_RELATIONSHIP_ARTIFACT_KIND
  producer: { packageName: '@dailephd/my-dev-kit'; packageVersion: string; revision: typeof API_RELATIONSHIP_PRODUCER }
  sourceSnapshot: { snapshotId: string; selectionFingerprint: string; files: Array<{ path: string; contentSha256: string | null }> }
  selection: { sourceRoots: string[]; excludes: string[]; complete: boolean; production: 'complete' | 'partial' | 'unsupported' | 'failed' }
  capabilities: Array<{ file: string; profile: 'js-ts-static-v1' | 'unsupported'; status: 'complete' | 'unsupported' | 'failed' }>
  nodes: ApiRelationshipNode[]
  relationships: ApiRelationship[]
  unresolved: ApiUnresolvedRelationship[]
  limitations: ApiRelationshipLimitation[]
  integrity: { algorithm: 'sha256'; digest: string }
}
export interface ApiRelationshipEvidenceReference {
  path: typeof API_RELATIONSHIP_FILENAME
  schemaVersion: typeof API_RELATIONSHIP_SCHEMA_VERSION
  sha256: string
  snapshotId: string
}
export interface ApiRelationshipValidationResult { valid: boolean; errors: string[] }
export const compareApiIdentity = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
export const apiEvidenceHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const isApiEvidencePath = (p: string): boolean => !!p && !p.includes('\\') && !p.includes(':') && !p.startsWith('/') && p.split('/').every(s => !!s && s !== '.' && s !== '..')
export function apiRelationshipId(value: Omit<ApiRelationship, 'id'>): string {
  return 'api-relationship:' + apiEvidenceHash([value.kind, value.source, value.target ?? value.unresolvedTargetKey, value.witnesses.map(w => w.id)])
}
export function sealApiRelationshipEvidence(value: Omit<ApiRelationshipEvidence, 'integrity'>): ApiRelationshipEvidence {
  return { ...value, integrity: { algorithm: 'sha256', digest: apiEvidenceHash(value) } }
}

/** Validation is fail-closed; callers receive no trusted domain value on failure. */
export function validateApiRelationshipEvidence(value: unknown): ApiRelationshipValidationResult {
  const errors: string[] = []
  const fail = (message: string) => { errors.push(message) }
  const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
  try {
    if (!value || typeof value !== 'object') throw new Error('not-object')
    const a = value as ApiRelationshipEvidence
    if (a.schemaVersion !== API_RELATIONSHIP_SCHEMA_VERSION || a.artifactKind !== API_RELATIONSHIP_ARTIFACT_KIND || a.producer.revision !== API_RELATIONSHIP_PRODUCER || a.producer.packageName !== '@dailephd/my-dev-kit') fail('unsupported-contract')
    if (typeof a.producer.packageVersion !== 'string' || !a.producer.packageVersion || !Array.isArray(a.selection.sourceRoots) || !Array.isArray(a.selection.excludes) || [...a.selection.sourceRoots, ...a.selection.excludes].some(s => typeof s !== 'string')) fail('producer-or-selection-metadata')
    if (!hash(a.sourceSnapshot.snapshotId) || !hash(a.sourceSnapshot.selectionFingerprint)) fail('snapshot-identity')
    if (!['complete', 'partial', 'unsupported', 'failed'].includes(a.selection.production) || typeof a.selection.complete !== 'boolean') fail('selection-state')
    const files = new Map(a.sourceSnapshot.files.map(f => [f.path, f.contentSha256]))
    if (files.size !== a.sourceSnapshot.files.length || [...files].some(([p, h]) => !isApiEvidencePath(p) || h !== null && !hash(h))) fail('file-identity')
    const sorted = (ids: string[]) => ids.every((id, i) => i === 0 || compareApiIdentity(ids[i - 1], id) < 0)
    if (!sorted(a.nodes.map(n => n.id)) || !sorted(a.relationships.map(r => r.id))) fail('duplicate-or-unsorted-identity')
    const ids = new Set(a.nodes.map(n => n.id))
    const span = (s: SourceAuditSpan) => isApiEvidencePath(s.path) && Number.isInteger(s.startLine) && s.startLine > 0 && (s.startColumn === null || Number.isInteger(s.startColumn) && s.startColumn >= 0) && (s.endLine === null || s.endLine >= s.startLine)
    const witness = (w: ApiRelationshipWitness) => typeof w.id === 'string' && !!w.id && span(w.span) && files.get(w.span.path) === w.contentSha256 && hash(w.contentSha256) && (w.symbolId === null || typeof w.symbolId === 'string' && !!w.symbolId) && (w.factId === null || typeof w.factId === 'string' && !!w.factId) && ['typescript-ast', 'framework-graph', 'symbol-import-graph'].includes(w.provenance)
    for (const n of a.nodes) if (!API_RELATIONSHIP_NODE_KINDS.includes(n.kind) || !files.has(n.file) || n.location.path !== n.file || !span(n.location) || !n.provenance.length || !n.provenance.every(witness)) fail('node-provenance')
    for (const r of a.relationships) {
      if (!API_RELATIONSHIP_KINDS.includes(r.kind) || !API_RELATIONSHIP_QUALIFICATIONS.includes(r.qualification) || !ids.has(r.source) || r.target !== null && !ids.has(r.target)) fail('relationship-endpoint')
      if (r.method !== null && !API_RELATIONSHIP_METHODS.includes(r.method)) fail('method')
      if (r.id !== apiRelationshipId(r) || !r.witnesses.length || !r.witnesses.every(witness)) fail('relationship-identity-or-witness')
      if (r.qualification === 'RESOLVED' ? r.target === null || r.unresolvedTargetKey !== null : r.target !== null || !r.unresolvedTargetKey) fail('qualification-target')
      if (r.qualification === 'RESOLVED' && ['api-call-targets-route', 'api-endpoint-handled-by'].includes(r.kind) && (r.method === null || r.path === null)) fail('missing-endpoint-evidence')
      if (r.qualification !== 'RESOLVED' && !a.unresolved.some(u => u.source === r.source && u.family === r.kind && u.qualification === r.qualification)) fail('missing-unresolved-record')
    }
    for (const u of a.unresolved) if (!span(u.location) || u.source !== null && !ids.has(u.source) || !API_RELATIONSHIP_KINDS.includes(u.family) || !['AMBIGUOUS', 'UNRESOLVED', 'UNSUPPORTED'].includes(u.qualification) || !u.reason || u.candidates.some(c => !ids.has(c))) fail('unresolved-record')
    if (a.capabilities.some(c => !files.has(c.file) || !['js-ts-static-v1', 'unsupported'].includes(c.profile) || !['complete', 'unsupported', 'failed'].includes(c.status))) fail('capabilities')
    if (a.capabilities.some(c => c.profile === 'unsupported' && c.status !== 'unsupported')) fail('unsupported-profile-state')
    if (a.selection.production === 'complete' && (!a.selection.complete || a.capabilities.some(c => c.status !== 'complete'))) fail('incomplete-production-state')
    if (a.selection.production === 'unsupported' && (!a.capabilities.length || a.capabilities.some(c => c.status !== 'unsupported'))) fail('unsupported-production-state')
    const { integrity, ...body } = a
    if (integrity.algorithm !== 'sha256' || integrity.digest !== apiEvidenceHash(body)) fail('integrity')
  } catch { fail('malformed-artifact') }
  return { valid: errors.length === 0, errors: [...new Set(errors)].sort(compareApiIdentity) }
}
