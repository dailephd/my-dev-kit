import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { runGraphDiff } from '../../src/graph-diff/runGraphDiff.js'
import { loadGraphDiffArtifacts } from '../../src/graph-diff/loadGraphDiffArtifacts.js'
import { buildApiRelationshipImpact } from '../../src/graph-diff/buildApiRelationshipImpact.js'
import { validateApiRelationshipEvidence, sealApiRelationshipEvidence, type ApiRelationshipEvidence } from '../../src/symbol-index/apiRelationshipEvidenceTypes.js'
import { allocateV114OutputDir } from '../helpers/v114OutputRoot.js'

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'))
const write = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n')
const fixture = resolve('tests/fixtures/api-relationships/v1/contract-impact')
type Files = Record<string, string>
const fixtureFiles = (side: string): Files => Object.fromEntries(readdirSync(join(fixture, side)).map(n => [n, readFileSync(join(fixture, side, n), 'utf8')]))

async function pair(old: Files, next: Files = old) {
  const base = allocateV114OutputDir('api-impact'), root = join(base, 'project'), src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  for (const [name, content] of Object.entries(old)) writeFileSync(join(src, name), content)
  const before = join(base, 'before'), after = join(base, 'after')
  await runIndexCommand({ root, src: ['src'], out: before, callGraph: true })
  // This workspace and its files were created by this test alone. Historical
  // snapshots stay frozen; only this disposable source workspace is replaced.
  for (const name of Object.keys(old)) if (!(name in next)) rmSync(join(src, name))
  for (const [name, content] of Object.entries(next)) writeFileSync(join(src, name), content)
  await runIndexCommand({ root, src: ['src'], out: after, callGraph: true })
  return { before, after, root, base }
}
type Pair = Awaited<ReturnType<typeof pair>>
const impact = (p: Pair) => runGraphDiff(p).apiRelationshipImpact!
const clone = (p: string) => { const out = join(allocateV114OutputDir('api-impact-copy'), 'index'); cpSync(p, out, { recursive: true }); return out }
function registration(out: string, mutate: (m: any) => void) { const p = join(out, 'manifest.json'), m = read(p); mutate(m); write(p, m) }
function malformed(out: string, mutate: (a: any) => void, reseal = false) {
  const p = join(out, 'api-relationship-evidence.json'), a = read(p)
  mutate(a)
  const { integrity: _integrity, ...body } = a
  write(p, reseal ? sealApiRelationshipEvidence(body) : a)
  registration(out, m => { m.apiRelationshipEvidence.sha256 = createHash('sha256').update(readFileSync(p)).digest('hex') })
}
const bytes = (out: string) => Object.fromEntries(readdirSync(out).filter(n => n.endsWith('.json')).map(n => [n, createHash('sha256').update(readFileSync(join(out, n))).digest('hex')]))

describe('authenticated API relationship impact', () => {
  let p: Pair
  beforeAll(async () => { p = await pair(fixtureFiles('before'), fixtureFiles('after')) })

  it('projects authentic endpoint additions and removals with source evidence', () => {
    const r = impact(p)
    expect(r.availability).toBe('both')
    expect(r.changes).toContainEqual(expect.objectContaining({ changeKind: 'ADDED', subjectKind: 'framework-route' }))
    expect(r.changes).toContainEqual(expect.objectContaining({ changeKind: 'REMOVED', subjectKind: 'framework-route' }))
    expect(r.changes.every(c => c.evidence.length && c.evidence.every(e => e.witnesses.length))).toBe(true)
  })
  it('observes exact supported endpoint method and path deltas without compatibility verdicts', () => {
    const r = impact(p), data = JSON.stringify(r)
    expect(r.changes.some(c => c.subjectKind === 'api-endpoint-handled-by' && (c.changedFields.includes('method') || c.changeKind !== 'MODIFIED'))).toBe(true)
    expect(r.changes.some(c => c.subjectKind === 'framework-route' || c.changedFields.includes('path'))).toBe(true)
    expect(data).not.toMatch(/breaking|riskScore|compatibilityPercent|runtimeReachable/)
  })
  it('observes handler association changes', () => {
    const r = impact(p)
    expect(r.changes.some(c => c.subjectKind === 'api-endpoint-handled-by' && (c.changedFields.includes('target') || c.changeKind !== 'MODIFIED'))).toBe(true)
    expect(r.potentialImpacts.some(i => i.associatedSubject.id === 'symbol:src/server.ts#listUsers')).toBe(true)
  })
  it('observes supported client method/path changes and removed endpoint associations', () => {
    const r = impact(p)
    expect(r.changes.some(c => c.subjectKind === 'api-client-call' && c.changedFields.includes('value'))).toBe(true)
    expect(r.changes.some(c => c.subjectKind === 'api-call-targets-route' && c.qualification === 'UNRESOLVED')).toBe(true)
    expect(r.potentialImpacts.some(i => i.associatedSubject.kind === 'api-client-call')).toBe(true)
  })
  it('observes explicit schema and imported model association changes', () => {
    const r = impact(p)
    expect(r.changes.some(c => c.subjectKind === 'api-handler-references-schema')).toBe(true)
    expect(r.changes.some(c => c.subjectKind === 'api-handler-uses-data-entity')).toBe(true)
    expect(r.potentialImpacts.some(i => i.associatedSubject.kind === 'api-data-entity-ref')).toBe(true)
  })
  it('observes UI handler witnesses and preserves directly linked request candidates', () => {
    const r = impact(p)
    expect(r.changes.some(c => c.subjectKind === 'api-client-invokes-request')).toBe(true)
    expect(r.potentialImpacts.some(i => i.relationshipKind === 'api-client-invokes-request')).toBe(true)
    for (const i of r.potentialImpacts) for (const e of i.evidence) {
      const a = read(join(e.side === 'before' ? p.before : p.after, 'api-relationship-evidence.json')) as ApiRelationshipEvidence
      const relation = a.relationships.find(r => r.id === e.subject.id)!
      const unknown = a.unresolved.filter(u => u.source === relation.source && u.family === relation.kind && u.qualification === relation.qualification && JSON.stringify(u.location) === JSON.stringify(relation.witnesses[0].span))
      expect([relation.source, relation.target, ...unknown.flatMap(u => u.candidates)]).toContain(i.associatedSubject.id)
    }
  })
  it('retains multiple direct associations with no recursive closure', () => {
    const r = impact(p)
    expect(r.potentialImpacts.length).toBeGreaterThan(1)
    expect(r.potentialImpacts.every(i => i.reasonCodes.includes('direct-static-association-only'))).toBe(true)
  })
  it('produces identical deterministic output and IDs without machine paths', () => {
    const first = impact(p)
    expect(impact(p)).toEqual(first)
    expect([...first.changes, ...first.potentialImpacts].every(v => !v.id.includes(p.base) && /^api-(change|impact):[a-f0-9]{64}$/.test(v.id))).toBe(true)
    expect(first.changes.map(c => c.id)).toEqual(first.changes.map(c => c.id).sort())
    expect(first.potentialImpacts.map(c => c.id)).toEqual(first.potentialImpacts.map(c => c.id).sort())
  })
  it('does not mutate either persisted input even though live before bytes changed', () => {
    const b = bytes(p.before), a = bytes(p.after)
    impact(p)
    expect(bytes(p.before)).toEqual(b); expect(bytes(p.after)).toEqual(a)
  })
  it('preserves the original artifact kind, schema, producer and validator', () => {
    for (const out of [p.before, p.after]) {
      const a = read(join(out, 'api-relationship-evidence.json'))
      expect(validateApiRelationshipEvidence(a)).toEqual({ valid: true, errors: [] })
      expect(a).toMatchObject({ artifactKind: 'kit-api-relationship-evidence-v1', schemaVersion: '1.0.0', producer: { revision: 'api-relationship-v1.0.0' } })
    }
  })
  it('preserves all original graph-diff fields and warning order for legacy comparisons', () => {
    const full = runGraphDiff(p), b = clone(p.before), a = clone(p.after)
    registration(b, m => { delete m.apiRelationshipEvidence }); registration(a, m => { delete m.apiRelationshipEvidence })
    const legacy = runGraphDiff({ before: b, after: a }), { apiRelationshipImpact: _section, ...original } = full
    // Index-dir paths are caller input, not comparison semantics.
    expect({ ...legacy, before: full.before, after: full.after }).toEqual(original)
    expect(legacy).not.toHaveProperty('apiRelationshipImpact')
  })
  it.each(['before', 'after'] as const)('qualifies %s-only registration without fabricated adds/removals', side => {
    const b = clone(p.before), a = clone(p.after)
    registration(side === 'before' ? a : b, m => { delete m.apiRelationshipEvidence })
    const r = runGraphDiff({ before: b, after: a }).apiRelationshipImpact!
    expect(r).toMatchObject({ availability: `${side}-only`, status: 'PARTIAL', changes: [], potentialImpacts: [], summary: { complete: false } })
  })
  it.each([
    ['kind', (a: any) => { a.artifactKind = 'wrong' }],
    ['schema', (a: any) => { a.schemaVersion = '999' }],
    ['producer', (a: any) => { a.producer.revision = 'wrong' }],
    ['integrity', (a: any) => { a.integrity.digest = '0'.repeat(64) }],
    ['structural relationship', (a: any) => { a.relationships[0].target = 'missing' }],
    ['invalid path field', (a: any) => { a.relationships[0].path = 123 }],
  ])('rejects malformed %s without treating it as empty evidence', (_name, mutate) => {
    const b = clone(p.before); malformed(b, mutate as (a: any) => void)
    const r = runGraphDiff({ before: b, after: p.after }).apiRelationshipImpact!
    expect(r.status).toBe('PARTIAL'); expect(r.changes).toEqual([])
    expect(r.summary.complete).toBe(false); expect(r.warnings.some(w => w.startsWith('before:'))).toBe(true)
  })
  it('rejects checksum mismatch', () => {
    const b = clone(p.before); registration(b, m => { m.apiRelationshipEvidence.sha256 = '0'.repeat(64) })
    expect(runGraphDiff({ before: b, after: p.after }).apiRelationshipImpact!.warnings).toContain('before:artifact-checksum-invalid')
  })
  it.each(['snapshotId', 'path', 'schemaVersion'])('rejects inconsistent manifest %s', field => {
    const b = clone(p.before); registration(b, m => { m.apiRelationshipEvidence[field] = 'wrong' })
    expect(runGraphDiff({ before: b, after: p.after }).apiRelationshipImpact).toMatchObject({ status: 'PARTIAL', changes: [], summary: { complete: false } })
  })
  it('returns UNAVAILABLE when neither registered artifact is trustworthy', () => {
    const b = clone(p.before), a = clone(p.after)
    for (const out of [b, a]) registration(out, m => { m.apiRelationshipEvidence.sha256 = '0'.repeat(64) })
    expect(runGraphDiff({ before: b, after: a }).apiRelationshipImpact).toMatchObject({ availability: 'both', status: 'UNAVAILABLE', changes: [] })
  })
  it('does not compare unrelated repositories', async () => {
    const other = await pair(fixtureFiles('after'))
    expect(runGraphDiff({ before: p.before, after: other.after }).apiRelationshipImpact).toMatchObject({ status: 'UNAVAILABLE', changes: [], summary: { complete: false } })
  })
  it('rejects an internally inconsistent selection even with a resealed artifact', () => {
    const b = clone(p.before); malformed(b, a => { a.selection.sourceRoots = ['different'] }, true)
    expect(runGraphDiff({ before: b, after: p.after }).apiRelationshipImpact!.warnings).toContain('before:snapshot-registration-inconsistent')
  })
  it('rejects a persisted source-audit checksum mismatch', () => {
    const b = clone(p.before); registration(b, m => { m.sourceAuditEvidence.sha256 = '0'.repeat(64) })
    expect(runGraphDiff({ before: b, after: p.after }).apiRelationshipImpact).toMatchObject({ status: 'PARTIAL', changes: [], summary: { complete: false } })
  })
  it('does not compare distinct selected source roots', async () => {
    const q = await pair({ 'plain.ts': 'export const value = 1' })
    mkdirSync(join(q.root, 'other'))
    await runIndexCommand({ root: q.root, src: ['src', 'other'], out: q.after, callGraph: true })
    expect(impact(q)).toMatchObject({ status: 'UNAVAILABLE', changes: [], summary: { complete: false } })
  })
  it('does not fabricate changes for equivalent unchanged snapshots', async () => {
    const q = await pair(fixtureFiles('before'))
    expect(impact(q)).toMatchObject({ changes: [], potentialImpacts: [], summary: { complete: true, truncated: false } })
  })
  it('does not fabricate contract changes for line movement or unrelated source edits', async () => {
    const old = fixtureFiles('before'), next = Object.fromEntries(Object.entries(old).map(([k, v]) => [k, '\n\n' + v]))
    const q = await pair(old, next)
    expect(impact(q).changes).toEqual([])
  })
  it('reports authenticated declaration export changes without inferring a runtime signature', async () => {
    const old = fixtureFiles('before'), q = await pair(old, { ...old, 'server.ts': old['server.ts'].replace('export function listUsers', 'function listUsers') })
    expect(impact(q).changes).toContainEqual(expect.objectContaining({ subjectKind: 'source-symbol', changedFields: ['declaration'] }))
  })
  it('retains a newly unresolved schema reference without claiming deletion of its declaration', async () => {
    const old = fixtureFiles('before'), q = await pair(old, { ...old, 'server.ts': old['server.ts'].replace('listUsers(): User', 'listUsers(): Missing') })
    const r = impact(q)
    expect(r.changes.some(c => c.subjectKind === 'api-handler-references-schema' && c.qualification === 'UNRESOLVED')).toBe(true)
    expect(r.summary.complete).toBe(false)
    for (const c of r.changes.filter(c => c.subjectKind === 'schema-declaration' && c.changeKind === 'REMOVED')) expect(c.reasonCodes).toContain('projection-membership-not-source-declaration-existence')
  })
  it('cancels repeated equivalent moved requests without assigning arbitrary occurrence identities', async () => {
    const content = "export function load(){\nfetch('/users');\nreturn fetch('/users')\n}"
    const q = await pair({ 'client.ts': content }, { 'client.ts': '\n\n' + content })
    expect(impact(q).changes).toEqual([])
  })
  it('does not match a reused source location to a different declaration', async () => {
    const q = await pair({ 'client.ts': "export function oldOwner(){return fetch('/users')}" }, { 'client.ts': "export function newOwner(){return fetch('/users')}" })
    expect(impact(q).changes.some(c => c.changeKind === 'MODIFIED')).toBe(false)
  })
  it('keeps same-name different-file identities as additions/removals', async () => {
    const q = await pair({ 'client.ts': "export function load(){return fetch('/missing')}" }, { 'other.ts': "export function load(){return fetch('/missing')}" })
    expect(impact(q).changes.some(c => c.changeKind === 'MODIFIED')).toBe(false)
  })
  it('compares empty complete compatible snapshots without claiming whole-application coverage', async () => {
    const q = await pair({ 'plain.ts': 'export const value = 1' })
    expect(impact(q)).toMatchObject({ status: 'COMPARABLE', changes: [], summary: { complete: true } })
    expect(impact(q).warnings).toContain('static-association-only-no-runtime-compatibility-verdict')
  })
  it('retains unsupported source-profile changes as uncertainty', async () => {
    const q = await pair({ 'plain.py': 'def value(): return 1' }, { 'plain.py': 'def value(): return 2' })
    expect(impact(q)).toMatchObject({ status: 'PARTIAL', changes: [], summary: { complete: false, qualification: 'UNSUPPORTED' } })
    expect(impact(q).warnings.some(w => w.includes('unsupported-language-profile'))).toBe(true)
  })
  it.each([
    ['dynamic route', "import express from 'express'; const app=express(); declare const path:string; function h(){}; app.get(path,h)", 'server.ts'],
    ['dynamic client URL', 'declare const url:string; export function load(){return fetch(url)}', 'client.ts'],
    ['external origin', "export function load(){return fetch('https://other.test/users')}", 'client.ts'],
    ['unqualified framework', "const app={get(...a:unknown[]){}}; function h(){}; app.get('/users',h)", 'server.ts'],
    ['ambiguous mounted router', "import express from 'express';const app=express();const r=express.Router();function h(){};r.get('/users',h);app.use('/a',r);app.use('/b',r)", 'server.ts'],
    ['ORM lineage', "import {PrismaClient} from '@prisma/client';const db=new PrismaClient();export function load(){return db.user.findMany()}", 'data.ts'],
    ['missing handler', "import express from 'express';const app=express();app.get('/users',missing)", 'server.ts'],
    ['unsupported schema inference', "import express from 'express';const app=express();function h(): Missing{return value};app.get('/users',h)", 'server.ts'],
  ])('preserves %s uncertainty and never invents complete negatives', async (_name, content, file) => {
    const q = await pair({ [file]: content })
    const r = impact(q)
    expect(r.summary.complete).toBe(false); expect(r.changes).toEqual([])
    expect(r.warnings.some(w => /UNRESOLVED|UNSUPPORTED|AMBIGUOUS/.test(w))).toBe(true)
  })
  it('keeps ambiguous candidates and does not select a resolved winner', async () => {
    const old = { 'server.ts': "import express from 'express'; const app=express();function a(){};function b(){};app.get('/users',a);app.get('/users',b)", 'client.ts': "export function load(){return fetch('/users')}" }
    const q = await pair(old, { ...old, 'client.ts': "export function load(){return fetch('/users',{method:'POST'})}" })
    const r = impact(q)
    expect(r.summary.complete).toBe(false)
    const ambiguous = r.potentialImpacts.filter(i => i.qualification === 'AMBIGUOUS')
    expect(ambiguous.length).toBeGreaterThan(1)
  })
  it('keeps ambiguous candidates attached to their exact event witnesses', async () => {
    const client = "export function load(){return fetch('/a')}\nexport function load(){return fetch('/b')}\nexport function other(){return fetch('/c')}\nexport function other(){return fetch('/d')}"
    const view = "import React from 'react';import {load,other} from './client';export function UI(){return <><button onClick={load}/><button onClick={other}/></>}"
    const q = await pair({ 'client.ts': client, 'view.tsx': view }, { 'client.ts': client, 'view.tsx': view.replace('onClick={load}', 'onClick={other}') })
    const r = impact(q)
    expect(r.changes.length).toBeGreaterThan(0)
    const candidates = r.potentialImpacts.filter(i => i.relationshipKind === 'api-client-invokes-request' && i.associatedSubject.kind === 'api-client-call')
    expect(candidates.length).toBeGreaterThan(0)
    for (const i of candidates) for (const e of i.evidence) {
      const a = read(join(e.side === 'before' ? q.before : q.after, 'api-relationship-evidence.json')) as ApiRelationshipEvidence
      const relation = a.relationships.find(r => r.id === e.subject.id)!
      const exact = a.unresolved.filter(u => u.source === relation.source && u.family === relation.kind && u.qualification === relation.qualification && JSON.stringify(u.location) === JSON.stringify(relation.witnesses[0].span))
      expect(exact.flatMap(u => u.candidates)).toContain(i.associatedSubject.id)
      expect(i.qualification).toBe('AMBIGUOUS')
    }
  })
  it('does not turn similar-name decoys into schema relationships', async () => {
    const q = await pair({ 'model.ts': 'export class User{}', 'server.ts': "import express from 'express';const app=express();function h(): UserLike{return value};app.get('/users',h)" })
    const r = impact(q)
    expect(r.changes).toEqual([]); expect(r.summary.complete).toBe(false)
  })
  it('qualifies missing capability metadata rather than complete absence', () => {
    const b = clone(p.before); malformed(b, a => { a.capabilities = [] }, true)
    const r = runGraphDiff({ before: b, after: p.after }).apiRelationshipImpact!
    expect(r.summary.complete).toBe(false)
  })
  it('does not mutate pure projection inputs', () => {
    const b = loadGraphDiffArtifacts(p.before).apiRelationship, a = loadGraphDiffArtifacts(p.after).apiRelationship
    const saved = JSON.stringify([b, a]); buildApiRelationshipImpact(b, a)
    expect(JSON.stringify([b, a])).toBe(saved)
  })
  it.each([32, 33])('orders and bounds authentic %i-route change collections at 64', async count => {
    const content = "import express from 'express'; const app=express();\n" + Array.from({ length: count }, (_, i) => `app.get('/r${i}', missing${i})`).join('\n')
    const q = await pair({ 'server.ts': "import express from 'express'; const app=express();" }, { 'server.ts': content })
    const r = impact(q)
    expect(r.summary.availableChangeCount).toBe(count * 2)
    expect(r.changes).toHaveLength(64)
    expect(r.summary.returnedChangeCount).toBe(64)
    expect(r.summary.truncated).toBe(count > 32)
    expect(r.summary.complete).toBe(false)
  })
  it('bounds potential impacts with honest available and returned counts', async () => {
    const common = "import express from 'express';const app=express();export function h(){};app.get('/users',h)\n"
    const requests = Array.from({ length: 70 }, (_, i) => `export function load${i}(){return fetch('/users')}`).join('\n')
    const q = await pair({ 'server.ts': common, 'client.ts': requests }, { 'server.ts': common.replace("'/users'", "'/changed'"), 'client.ts': requests })
    const r = impact(q)
    expect(r.summary.availableImpactCount).toBeGreaterThan(64)
    expect(r.summary.returnedImpactCount).toBe(64); expect(r.potentialImpacts).toHaveLength(64)
    expect(r.summary).toMatchObject({ truncated: true, complete: false })
  })
})
