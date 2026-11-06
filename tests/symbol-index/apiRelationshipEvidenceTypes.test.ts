import { describe, expect, it } from 'vitest'
import {
  API_RELATIONSHIP_ARTIFACT_KIND, API_RELATIONSHIP_PRODUCER, API_RELATIONSHIP_SCHEMA_VERSION,
  apiEvidenceHash, apiRelationshipId, sealApiRelationshipEvidence, validateApiRelationshipEvidence,
  type ApiRelationshipEvidence, type ApiRelationshipWitness, type ApiRelationship,
} from '../../src/symbol-index/apiRelationshipEvidenceTypes.js'

function empty(): ApiRelationshipEvidence {
  return sealApiRelationshipEvidence({
    artifactKind: API_RELATIONSHIP_ARTIFACT_KIND, schemaVersion: API_RELATIONSHIP_SCHEMA_VERSION,
    producer: { packageName: '@dailephd/my-dev-kit', packageVersion: '1.14.0', revision: API_RELATIONSHIP_PRODUCER },
    sourceSnapshot: { snapshotId: 'a'.repeat(64), selectionFingerprint: 'b'.repeat(64), files: [] },
    selection: { sourceRoots: ['src'], excludes: [], complete: true, production: 'complete' },
    capabilities: [], nodes: [], relationships: [], unresolved: [], limitations: [],
  })
}
describe('API relationship artifact contract (RSP-001)', () => {
  it('does not accept a fabricated cross-layer relationship enum under schema 1.0.0', () => {
    const { integrity: _, ...body } = empty()
    const span = { path: 'src/app.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: null }
    const w: ApiRelationshipWitness = { id: 'w', span, contentSha256: 'c'.repeat(64), symbolId: 'source', factId: null, provenance: 'typescript-ast' }
    const relationship: ApiRelationship = { id: '', kind: 'api-client-invokes-request', source: 'source', target: 'target', qualification: 'RESOLVED', witnesses: [w], limitations: [], method: null, path: null, unresolvedTargetKey: null }
    relationship.id = apiRelationshipId(relationship)
    const valid = { ...body, sourceSnapshot: { ...body.sourceSnapshot, files: [{ path: span.path, contentSha256: w.contentSha256 }] }, nodes: ['source', 'target'].map(id => ({ id, kind: 'source-symbol' as const, file: span.path, symbolId: id, location: span, value: id, provenance: [w] })), relationships: [relationship] }
    expect(validateApiRelationshipEvidence(sealApiRelationshipEvidence(valid)).valid).toBe(true)
    const fabricated = { ...relationship, kind: 'react-event-executes-api' } as unknown as ApiRelationship
    fabricated.id = apiRelationshipId(fabricated)
    expect(validateApiRelationshipEvidence(sealApiRelationshipEvidence({ ...valid, relationships: [fabricated] })).errors).toEqual(['relationship-endpoint'])
  })
  it('validates the separate versioned truthful empty contract', () => {
    const a = empty()
    expect(validateApiRelationshipEvidence(a)).toEqual({ valid: true, errors: [] })
    expect(a.artifactKind).toBe('kit-api-relationship-evidence-v1')
    expect(a.schemaVersion).toBe('1.0.0')
    expect(JSON.stringify(a)).toBe(JSON.stringify(empty()))
  })
  it('does not accept malformed, unsupported or altered artifact bytes', () => {
    for (const value of [null, {}, { ...empty(), schemaVersion: '2.0.0' }, { ...empty(), nodes: null }, { ...empty(), selection: { complete: false } }]) expect(validateApiRelationshipEvidence(value).valid).toBe(false)
  })
  it('rejects resealed false completeness and unsupported capability claims', () => {
    const { integrity: _, ...body } = empty()
    expect(validateApiRelationshipEvidence(sealApiRelationshipEvidence({ ...body, selection: { ...body.selection, complete: false } })).errors).toContain('incomplete-production-state')
    const sourceSnapshot = { ...body.sourceSnapshot, files: [{ path: 'src/other.py', contentSha256: null }] }
    const falseProfile = sealApiRelationshipEvidence({ ...body, sourceSnapshot, capabilities: [{ file: 'src/other.py', profile: 'unsupported', status: 'complete' }] })
    expect(validateApiRelationshipEvidence(falseProfile).errors).toContain('unsupported-profile-state')
  })
  it('derives IDs from qualified endpoints and ordered witness identity', () => {
    const w = { id: 'witness:src/client.ts:1:0', span: { path: 'src/client.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: null }, contentSha256: 'c'.repeat(64), symbolId: 'symbol:src/client.ts#load', factId: null, provenance: 'typescript-ast' } satisfies ApiRelationshipWitness
    const value: Omit<ApiRelationship, 'id'> = { kind: 'api-call-targets-route', source: 'call:src/client.ts:1', target: 'framework-route:exact', qualification: 'RESOLVED', method: 'GET', path: '/items', unresolvedTargetKey: null, witnesses: [w], limitations: ['static-only'] }
    expect(apiRelationshipId(value)).toBe('api-relationship:' + apiEvidenceHash([value.kind, value.source, value.target, [w.id]]))
    expect(apiRelationshipId({ ...value, target: 'framework-route:other' })).not.toBe(apiRelationshipId(value))
    expect(apiRelationshipId({ ...value, witnesses: [{ ...w, id: 'another' }] })).not.toBe(apiRelationshipId(value))
  })
  it('rejects dangling, unqualified and duplicate relationship identities even when resealed', () => {
    const a = empty()
    const bad = { id: 'x', kind: 'api-call-targets-route', source: 'absent', target: 'absent', qualification: 'RESOLVED', witnesses: [], limitations: [], method: 'GET', path: '/', unresolvedTargetKey: null } as ApiRelationship
    const { integrity: _, ...body } = a
    for (const relationships of [[bad], [bad, bad], [{ ...bad, qualification: 'MAYBE' } as unknown as ApiRelationship]]) expect(validateApiRelationshipEvidence(sealApiRelationshipEvidence({ ...body, relationships })).valid).toBe(false)
  })
})
