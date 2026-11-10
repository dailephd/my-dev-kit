import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { buildApiRelationshipEvidence } from '../../src/indexing/buildApiRelationshipEvidence.js'
import { apiRelationshipLookup, readApiRelationshipEvidence } from '../../src/lookup/apiRelationshipLookup.js'
import { readSourceAuditEvidence } from '../../src/lookup/readSourceAuditEvidence.js'
import type { BuildApiRelationshipEvidenceInput } from '../../src/indexing/buildApiRelationshipEvidence.js'

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'))
async function project(fixture?: string, overrides: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cross-'))
  mkdirSync(join(root, 'src'))
  if (fixture) cpSync(resolve('tests/fixtures/api-relationships/v1', fixture), join(root, 'src'), { recursive: true })
  for (const [p, text] of Object.entries(overrides)) { mkdirSync(dirname(join(root, 'src', p)), { recursive: true }); writeFileSync(join(root, 'src', p), text) }
  const out = join(root, 'out')
  await runIndexCommand({ root, src: ['src'], out, callGraph: true, incremental: true })
  const artifact = readApiRelationshipEvidence(out)
  const input: BuildApiRelationshipEvidenceInput = { sourceAudit: readSourceAuditEvidence(out), symbolIndex: read(join(out, 'symbol-index.json')), codeGraph: read(join(out, 'code-graph.json')), frontendReachability: read(join(out, 'frontend-reachability.json')), dataModel: read(join(out, 'data-model.json')), producerVersion: '1.14.0' }
  return { root, out, artifact, input }
}
const targets = (a: Awaited<ReturnType<typeof project>>['artifact']) => a.relationships.filter(r => r.kind === 'api-call-targets-route')

describe('cross-layer relationship integration', () => {
  it('composes an authenticated imported router mount and preserves the observed query/fragment', async () => {
    const { artifact: a } = await project('express-mounted-router')
    expect(targets(a)).toEqual([expect.objectContaining({ qualification: 'RESOLVED', method: 'GET', path: '/api/users?active=true#list' })])
    const route = a.relationships.find(r => r.kind === 'api-endpoint-handled-by')!
    expect(route).toMatchObject({ qualification: 'RESOLVED', path: '/api/users', target: 'symbol:src/handler.ts#listUsers' })
    expect(route.witnesses.map(w => w.span.path)).toEqual(expect.arrayContaining(['src/app.ts', 'src/router.ts', 'src/handler.ts']))
  })
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])('matches exact static %s method and effective path', async method => {
    const { artifact } = await project('express-mounted-router', {
      'router.ts': `import {Router} from 'express'; export const router=Router(); function h(){}; router.${method.toLowerCase()}('/users',h)`,
      'client.ts': `export function load(){return fetch('/api/users',{method:'${method}'})}`,
    })
    expect(targets(artifact)).toEqual([expect.objectContaining({ qualification: 'RESOLVED', method })])
  })
  it.each([
    ["declare const prefix:string; app.use(prefix,router)", 'UNRESOLVED'],
    ["app.use('/one',router); app.use('/two',router)", 'AMBIGUOUS'],
    ["declare const unknown:any; app.use('/api',unknown)", 'UNRESOLVED'],
  ])('qualifies mounting context %s', async (mount, qualification) => {
    const { artifact } = await project('express-mounted-router', { 'app.ts': `import express from 'express'; import {router} from './router'; const app=express(); ${mount}`, 'client.ts': "export function load(){return fetch('/one/users')}" })
    expect(targets(artifact)[0].qualification).toBe(qualification)
    expect(apiRelationshipLookup(artifact, { kind: 'api-call-targets-route' }).complete).toBe(false)
  })
  it('does not confuse unrelated routers or normalize path case', async () => {
    const { artifact } = await project('express-mounted-router', { 'client.ts': "export function load(){return fetch('/api/Users')}", 'other.ts': "import express from 'express'; const app=express(); function h(){}; app.get('/users',h)" })
    expect(targets(artifact)[0].qualification).toBe('UNRESOLVED')
  })
  it('keeps multiple compatible endpoints ambiguous', async () => {
    const { artifact } = await project('express-mounted-router', { 'other.ts': "import express from 'express'; const app=express(); function h(){}; app.get('/api/users',h)" })
    expect(targets(artifact)[0].qualification).toBe('AMBIGUOUS')
  })
  it('retains both effective path candidates for multiple mounting contexts', async () => {
    const { artifact } = await project('express-mounted-router', { 'app.ts': "import express from 'express'; import {router} from './router'; const app=express(); app.use('/api',router); app.use('/v2',router)" })
    const unknown = artifact.unresolved.find(u => u.reason === 'ambiguous-route-candidates')!
    expect(unknown.candidates.map(id => artifact.nodes.find(n => n.id === id)?.value).sort()).toEqual(['/api/users', '/v2/users'])
  })
  it('does not resolve unsupported nested mounts', async () => {
    const { artifact } = await project('express-mounted-router', { 'app.ts': "import express from 'express'; import {router} from './router'; const app=express(); const parent=express.Router(); parent.use('/api',router); app.use('/v1',parent)" })
    expect(targets(artifact)[0].qualification).not.toBe('RESOLVED')
    expect(artifact.unresolved.some(u => u.reason === 'unsupported-nested-mount')).toBe(true)
  })
  it('does not resolve ambiguous router imports', async () => {
    const { artifact } = await project('express-mounted-router', { 'router.ts': "import {Router} from 'express'; export const router=Router(); export const router=Router(); function h(){}; router.get('/users',h)" })
    expect(targets(artifact)[0].qualification).not.toBe('RESOLVED')
  })
  it.each(["fetch('https://other.test/users')", "fetch('//other.test/users')", 'fetch(url)'])('does not resolve an external or dynamic request %s', async expression => {
    const { artifact } = await project('react-request-route', { 'client.ts': `declare const url:string; export function loadUsers(){return ${expression}}` })
    expect(targets(artifact)[0].qualification).not.toBe('RESOLVED')
  })
  it('retains unknown Express-like registrations as unsupported without guessing routes', async () => {
    const { artifact } = await project(undefined, { 'server.ts': "const app={get(...args:unknown[]){}}; function h(){}; app.get('/users',h)" })
    expect(artifact.unresolved).toEqual(expect.arrayContaining([expect.objectContaining({ qualification: 'UNSUPPORTED', reason: 'unsupported-router-profile' })]))
    expect(apiRelationshipLookup(artifact).complete).toBe(false)
  })
  it('links onClick and cross-file onSubmit to the request with component, handler and call witnesses', async () => {
    const { artifact } = await project('react-request-route')
    const ui = artifact.relationships.filter(r => r.kind === 'api-client-invokes-request' && r.source === 'symbol:src/view.tsx#Users' && r.qualification === 'RESOLVED')
    expect(ui).toHaveLength(2)
    expect(ui.every(r => r.witnesses.some(w => w.symbolId === 'symbol:src/client.ts#loadUsers'))).toBe(true)
    expect(ui.flatMap(r => r.witnesses.map(w => w.symbolId))).toEqual(expect.arrayContaining(['symbol:src/view.tsx#handleClick', 'symbol:src/handlers.ts#handleSubmit']))
    expect(targets(artifact)[0].qualification).toBe('RESOLVED')
  })
  it('retains an unresolved JSX handler instead of inventing a call', async () => {
    const { artifact } = await project('react-request-route', { 'view.tsx': "import React from 'react'; declare const missing:any; export function Users(){return <button onClick={missing}/> }" })
    expect(artifact.unresolved.some(u => u.reason === 'unresolved-ui-handler')).toBe(true)
  })
  it('does not return a complete UI negative when component identity is unavailable', async () => {
    const { artifact } = await project('react-request-route', { 'view.tsx': "import React from 'react'; import {loadUsers} from './client'; export default () => <button onClick={loadUsers}/>" })
    const result = apiRelationshipLookup(artifact, { kind: 'api-client-invokes-request', files: ['src/view.tsx'] })
    expect(result.unresolved).toContainEqual(expect.objectContaining({ reason: 'ui-component-identity-unavailable' }))
    expect(result.complete).toBe(false)
  })
  it('uses existing Next App Router declarations and genuine Next import references', async () => {
    const { artifact } = await project('next-app-route')
    expect(targets(artifact)[0]).toMatchObject({ qualification: 'RESOLVED', method: 'GET' })
    expect(artifact.relationships).toContainEqual(expect.objectContaining({ kind: 'api-endpoint-handled-by', qualification: 'RESOLVED', path: '/api/users', target: 'symbol:src/app/api/users/route.ts#GET' }))
  })
  it.each([
    ['app/api/users/route.ts', 'export function GET(){return []}'],
    ['other/route.ts', "import {NextResponse} from 'next/server'; export function GET(){return NextResponse.json([])}"],
    ['app/api/[id]/route.ts', "import {NextResponse} from 'next/server'; export function GET(){return NextResponse.json([])}"],
    ['app/api/[...id]/route.ts', "import {NextResponse} from 'next/server'; export function GET(){return NextResponse.json([])}"],
    ['app/api/[[...id]]/route.ts', "import {NextResponse} from 'next/server'; export function GET(){return NextResponse.json([])}"],
    ['app/api/@modal/route.ts', "import {NextResponse} from 'next/server'; export function GET(){return NextResponse.json([])}"],
    ['app/api/(.)users/route.ts', "import {NextResponse} from 'next/server'; export function GET(){return NextResponse.json([])}"],
    ['app/api/users/route.tsx', "import {NextResponse} from 'next/server'; export function GET(){return NextResponse.json([])}"],
  ])('does not invent a supported Next endpoint for %s', async (file, content) => {
    const { artifact } = await project(undefined, { [file]: content, 'client.ts': "export function load(){return fetch('/api/users')}" })
    expect(targets(artifact)[0].qualification).not.toBe('RESOLVED')
  })
  it('associates the handler and imported model class by exact declaration identity', async () => {
    const { artifact } = await project('typed-handler-model')
    expect(artifact.relationships).toContainEqual(expect.objectContaining({ kind: 'api-handler-references-schema', target: 'symbol:src/model.ts#User', qualification: 'RESOLVED' }))
    const data = artifact.relationships.find(r => r.kind === 'api-handler-uses-data-entity')!
    expect(data).toMatchObject({ source: 'symbol:src/server.ts#listUsers', qualification: 'RESOLVED' })
    expect(artifact.nodes.find(n => n.id === data.target)).toMatchObject({ kind: 'api-data-entity-ref', file: 'src/model.ts', symbolId: 'symbol:src/model.ts#User' })
    expect(artifact.relationships.some(r => r.target === 'symbol:src/decoy.ts#User')).toBe(false)
  })
  it('does not call generic JSX a React event relationship without a React import context', async () => {
    const { artifact } = await project('react-request-route', { 'view.tsx': "import {loadUsers} from './client'; export function Users(){return <button onClick={loadUsers}/> }" })
    expect(artifact.relationships.filter(r => r.kind === 'api-client-invokes-request' && r.source === 'symbol:src/view.tsx#Users').every(r => r.qualification !== 'RESOLVED')).toBe(true)
    expect(artifact.unresolved.some(u => u.reason === 'unresolved-ui-handler')).toBe(true)
  })
  it('does not promote similar type names or dynamic database access to model lineage', async () => {
    const { artifact } = await project('typed-handler-model', { 'server.ts': "import express from 'express'; const app=express(); declare const db:any; declare const table:string; function h(): User {return db[table].findMany()}; app.get('/users',h)" })
    expect(artifact.relationships.some(r => r.kind === 'api-handler-uses-data-entity')).toBe(false)
    expect(artifact.unresolved.some(u => u.reason === 'missing-declaration-identity')).toBe(true)
  })
  it('retains ambiguous imported schema identity without a model winner', async () => {
    const { artifact } = await project('typed-handler-model', { 'model.ts': 'export interface User {id:string}\nexport interface User {value:number}' })
    expect(artifact.unresolved.some(u => u.reason === 'ambiguous-declaration-identity' && u.qualification === 'AMBIGUOUS')).toBe(true)
    expect(artifact.relationships.some(r => r.kind === 'api-handler-uses-data-entity' && r.qualification === 'RESOLVED')).toBe(false)
  })
  it('labels dynamic ORM access unsupported instead of manufacturing lineage', async () => {
    const { artifact } = await project(undefined, { 'data.ts': "import {PrismaClient} from '@prisma/client'; const db=new PrismaClient(); declare const table:string; export function load(){return db[table].findMany()}" })
    expect(artifact.unresolved).toContainEqual(expect.objectContaining({ qualification: 'UNSUPPORTED', reason: 'unsupported-dynamic-data-access-profile' }))
    expect(apiRelationshipLookup(artifact).complete).toBe(false)
  })
  it('finds mount associations by witness file with the same bounded lookup contract', async () => {
    const { artifact } = await project('express-mounted-router')
    const result = apiRelationshipLookup(artifact, { files: ['src/app.ts'], kind: 'api-call-targets-route' })
    expect(result.relationships).toHaveLength(1)
    expect(result.relationships[0].witnesses.some(w => w.span.path === 'src/app.ts')).toBe(true)
  })
  it('preserves same-HEAD freshness, deterministic full/incremental output and source bytes', async () => {
    const { root, out, artifact } = await project('express-mounted-router')
    const source = join(root, 'src/app.ts'), before = readFileSync(source, 'utf8')
    await runIndexCommand({ root, src: ['src'], out, callGraph: true, incremental: true })
    expect(readApiRelationshipEvidence(out)).toEqual(artifact)
    expect(readFileSync(source, 'utf8')).toBe(before)
    writeFileSync(source, before.replace('/api', '/v2'))
    expect(() => readApiRelationshipEvidence(out)).toThrow(/STALE_SOURCE_EVIDENCE/)
    await runIndexCommand({ root, src: ['src'], out, callGraph: true, incremental: true })
    const changed = readApiRelationshipEvidence(out)
    await runIndexCommand({ root, src: ['src'], out, callGraph: true })
    expect(readApiRelationshipEvidence(out)).toEqual(changed)
    expect(targets(changed)[0].qualification).toBe('UNRESOLVED')
  })
  it('does not make complete negative claims with missing capability or selected roots', async () => {
    const { input } = await project('express-mounted-router')
    input.sourceAudit.coverage.inventoryComplete = false
    delete input.symbolIndex.files.find(f => f.path === 'src/router.ts')!.apiRelationships
    const a = buildApiRelationshipEvidence(input)
    expect(apiRelationshipLookup(a, { kind: 'api-call-targets-route' }).complete).toBe(false)
    expect(targets(a)[0].qualification).not.toBe('RESOLVED')
  })
  it('bounds lookup over the new UI and route associations', async () => {
    const { artifact } = await project('react-request-route')
    const result = apiRelationshipLookup(artifact, { maxResults: 1 })
    expect(result.relationships.length + result.unresolved.length).toBe(1)
    expect(result).toMatchObject({ truncated: true, complete: false })
  })
})
