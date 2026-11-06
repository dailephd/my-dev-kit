import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { apiRelationshipLookup, readApiRelationshipEvidence } from '../../src/lookup/apiRelationshipLookup.js'
import { API_RELATIONSHIP_FILENAME } from '../../src/symbol-index/apiRelationshipEvidenceTypes.js'

async function fixture(extraFiles = 0) {
  const root = fs.mkdtempSync(join(tmpdir(), 'kit-api-lookup-')); fs.mkdirSync(join(root, 'src'))
  const source = "import express from 'express'; const app=express(); function h(){}; app.get('/x',h); export function load(){return fetch('/x')}\n"
  fs.writeFileSync(join(root, 'src/app.ts'), source)
  for (let i = 0; i < extraFiles; i++) fs.writeFileSync(join(root, `src/plain${i}.ts`), `export const value${i} = ${i}`)
  const out = join(root, 'out'); await runIndexCommand({ root, src: ['src'], out })
  return { root, out, source, artifact: readApiRelationshipEvidence(out) }
}
describe('bounded authenticated API relationship lookup (RSP-005/RSP-006)', () => {
  it('filters exact source, target, kind and bounded file sets with witnesses and identity', async () => {
    const { artifact: a } = await fixture()
    const edge = a.relationships.find(r => r.kind === 'api-call-targets-route')!
    const result = apiRelationshipLookup(a, { sourceNodeId: edge.source, targetNodeId: edge.target!, kind: edge.kind, files: ['src/app.ts'], maxResults: 8 })
    expect(result.relationships).toEqual([edge])
    expect(result.relationships[0].witnesses).not.toHaveLength(0)
    expect(result.sourceSnapshot).toEqual({ snapshotId: a.sourceSnapshot.snapshotId, selectionFingerprint: a.sourceSnapshot.selectionFingerprint })
    expect(result.artifactIdentity).toBe(a.integrity.digest)
    expect(result.complete).toBe(true)
  })
  it('propagates cap truncation and missing source/target/selection limitations', async () => {
    const { artifact: a } = await fixture()
    expect(apiRelationshipLookup(a, { maxResults: 1 })).toMatchObject({ truncated: true, complete: false, relationships: [expect.anything()] })
    for (const query of [{ sourceNodeId: 'absent' }, { targetNodeId: 'absent' }]) {
      const result = apiRelationshipLookup(a, query)
      expect(result.relationships).toEqual([])
      expect(result.complete).toBe(false)
      expect(result.limitations.some(l => l.code.endsWith('node-not-found'))).toBe(true)
    }
    expect(apiRelationshipLookup(a, { files: ['not-selected.ts'] }).limitations).toContainEqual({ code: 'file-outside-selection', scope: 'not-selected.ts' })
    expect(() => apiRelationshipLookup(a, { files: ['../outside.ts'] })).toThrow('INVALID_API_RELATIONSHIP_FILES')
    expect(() => apiRelationshipLookup(a, { maxResults: 0 })).toThrow('INVALID_API_RELATIONSHIP_LIMIT')
  })
  it('performs no filesystem read in the pure query and never mutates source or artifact', async () => {
    const { artifact: a, root, source } = await fixture()
    const before = JSON.stringify(a)
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('arbitrary source read') })
    try { expect(apiRelationshipLookup(a).relationships.length).toBeGreaterThan(0) } finally { spy.mockRestore() }
    expect(JSON.stringify(a)).toBe(before)
    expect(fs.readFileSync(join(root, 'src/app.ts'), 'utf8')).toBe(source)
  })
  it('returns relevant unresolved records rather than a false complete negative', async () => {
    const { root, out } = await fixture()
    fs.writeFileSync(join(root, 'src/app.ts'), "export function load(url:string){return fetch(url)}")
    await runIndexCommand({ root, src: ['src'], out })
    const a = readApiRelationshipEvidence(out)
    const result = apiRelationshipLookup(a, { kind: 'api-call-targets-route' })
    expect(result.unresolved).toEqual([expect.objectContaining({ qualification: 'UNRESOLVED', reason: 'dynamic-url' })])
    expect(result.relationships).toEqual([expect.objectContaining({ target: null, qualification: 'UNRESOLVED' })])
  })
  it('fails closed for missing artifact, checksum tampering, stale selected bytes and mismatched snapshot', async () => {
    const { root, out } = await fixture()
    const path = join(out, API_RELATIONSHIP_FILENAME); const original = fs.readFileSync(path, 'utf8')
    fs.writeFileSync(path, original + ' ')
    expect(() => readApiRelationshipEvidence(out)).toThrow('API_RELATIONSHIP_EVIDENCE_INVALID')
    fs.writeFileSync(path, original)
    const manifestPath = join(out, 'manifest.json'); const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.apiRelationshipEvidence.snapshotId = 'f'.repeat(64); fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    expect(() => readApiRelationshipEvidence(out)).toThrow('STALE_API_RELATIONSHIP_EVIDENCE')
    delete manifest.apiRelationshipEvidence; fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    expect(() => readApiRelationshipEvidence(out)).toThrow('API_RELATIONSHIP_EVIDENCE_UNAVAILABLE')
    expect(fs.readFileSync(join(root, 'src/app.ts'), 'utf8')).toContain("fetch('/x')")
  })
  it('bounds metadata instead of returning the entire selected file inventory', async () => {
    const { artifact } = await fixture(80)
    const result = apiRelationshipLookup(artifact, { maxResults: 1 })
    expect(result.sourceSnapshot).not.toHaveProperty('files')
    expect(result.selection.selectedFileCount).toBe(81)
    expect(result.capabilitySummary.complete).toBe(81)
    expect(result.capabilities.map(c => c.file)).toEqual(['src/app.ts'])
    expect(result.limitations.length).toBeLessThan(16)
  })
})
