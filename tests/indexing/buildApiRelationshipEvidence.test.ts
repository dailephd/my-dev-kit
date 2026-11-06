import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { buildApiRelationshipEvidence, serializeApiRelationshipEvidence } from '../../src/indexing/buildApiRelationshipEvidence.js'
import { readSourceAuditEvidence } from '../../src/lookup/readSourceAuditEvidence.js'
import { apiRelationshipLookup, readApiRelationshipEvidence } from '../../src/lookup/apiRelationshipLookup.js'
import { API_RELATIONSHIP_FILENAME, validateApiRelationshipEvidence } from '../../src/symbol-index/apiRelationshipEvidenceTypes.js'
import { SOURCE_AUDIT_SCHEMA_VERSION } from '../../src/symbol-index/auditEvidenceTypes.js'
import { SOURCE_AUDIT_EXTRACTOR_CONTRACT_REVISION } from '../../src/indexing/buildSourceAuditEvidence.js'
import { CACHE_SCHEMA_VERSION } from '../../src/indexing/cacheMetadata.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'

const json = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8'))
const hash = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')
async function project(fixture?: string, sources: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kit-api-foundation-'))
  const src = join(root, 'src'); mkdirSync(src)
  if (fixture) cpSync(resolve('tests/fixtures/api-relationships/v1', fixture), src, { recursive: true })
  for (const [file, content] of Object.entries(sources)) { mkdirSync(join(src, file, '..'), { recursive: true }); writeFileSync(join(src, file), content) }
  const out = join(root, 'out')
  await runIndexCommand({ root, src: ['src'], out, incremental: true })
  const artifact = readApiRelationshipEvidence(out)
  const input = { sourceAudit: readSourceAuditEvidence(out), symbolIndex: json<SymbolIndex>(join(out, 'symbol-index.json')), codeGraph: json<CodeGraph>(join(out, 'code-graph.json')), producerVersion: '1.14.0' }
  return { root, out, artifact, input }
}
const targets = (a: Awaited<ReturnType<typeof project>>['artifact']) => a.relationships.filter(r => r.kind === 'api-call-targets-route')

describe('static API relationship producer (RSP-002 through RSP-005)', () => {
  it('publishes static method/path, exact cross-file handler and imported wrapper/UI witnesses', async () => {
    const { artifact: a, out } = await project('client-server-static')
    const [edge] = targets(a)
    expect(edge).toMatchObject({ qualification: 'RESOLVED', method: 'GET', path: '/items' })
    expect(a.nodes.find(n => n.id === edge.target)).toMatchObject({ file: 'src/server.ts', symbolId: 'symbol:src/handlers.ts#listItems', kind: 'framework-route' })
    expect(edge.witnesses.map(w => w.span.path)).toEqual(['src/client.ts', 'src/server.ts'])
    expect(a.relationships.some(r => r.kind === 'api-endpoint-handled-by' && r.target === 'symbol:src/handlers.ts#listItems' && r.qualification === 'RESOLVED')).toBe(true)
    const invocation = a.relationships.find(r => r.kind === 'api-client-invokes-request')
    expect(invocation).toMatchObject({ source: 'symbol:src/view.tsx#Items', qualification: 'RESOLVED', target: edge.source })
    expect(invocation!.witnesses.some(w => w.factId?.startsWith('audit:') || w.provenance === 'symbol-import-graph')).toBe(true)
    expect(a.selection.production).toBe('complete')
    expect(validateApiRelationshipEvidence(a).valid).toBe(true)
    const serialized = serializeApiRelationshipEvidence(a)
    expect(readFileSync(join(out, API_RELATIONSHIP_FILENAME), 'utf8')).toBe(serialized.json)
    expect(json<{ apiRelationshipEvidence: unknown }>(join(out, 'manifest.json')).apiRelationshipEvidence).toEqual(serialized.reference)
  })
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])('extracts the supported %s literal method', async method => {
    const { artifact: a } = await project(undefined, { 'app.js': `import express from 'express'; const app=express(); function h(){}; app.${method.toLowerCase()}('/x',h); export function load(){return fetch('/x',{method:'${method}'})}` })
    expect(targets(a)).toEqual([expect.objectContaining({ qualification: 'RESOLVED', method, path: '/x' })])
  })
  it('retains every ambiguous candidate without choosing a winner', async () => {
    const { artifact: a } = await project('client-server-ambiguous')
    expect(targets(a)[0]).toMatchObject({ qualification: 'AMBIGUOUS', target: null })
    expect(a.unresolved.find(u => u.qualification === 'AMBIGUOUS')?.candidates).toHaveLength(2)
    expect(a.unresolved.find(u => u.qualification === 'AMBIGUOUS')?.candidates.every(id => a.nodes.some(n => n.id === id))).toBe(true)
  })
  it('retains dynamic URL, dynamic route and unrelated framework observations', async () => {
    const { artifact: a } = await project('client-server-dynamic')
    expect(targets(a)[0]).toMatchObject({ qualification: 'UNRESOLVED', target: null, path: null })
    expect(a.unresolved.map(u => u.reason)).toEqual(expect.arrayContaining(['dynamic-url', 'route-or-handler-identity-unresolved', 'unsupported-express-registration-syntax']))
    expect(a.unresolved.find(u => u.reason === 'unsupported-express-registration-syntax')).toMatchObject({ qualification: 'UNSUPPORTED', location: { path: 'src/server.ts', startLine: 8 } })
    expect(a.nodes.some(n => n.value === '/not-a-route')).toBe(false)
    expect(targets(a).some(r => r.qualification === 'RESOLVED')).toBe(false)
  })
  it('distinguishes complete supported no-API source from unsupported language profiles', async () => {
    const plain = await project(undefined, { 'plain.ts': 'const values = new Map(); export const value = values.get("x"); export interface Local {} export function identity(value: Local): Local { return value }\n' })
    expect(plain.artifact).toMatchObject({ nodes: [], relationships: [], unresolved: [], selection: { complete: true, production: 'complete' } })
    const other = await project(undefined, { 'plain.py': 'def value():\n    return 1\n' })
    expect(other.artifact.selection.production).toBe('unsupported')
    expect(other.artifact.unresolved).toEqual([expect.objectContaining({ qualification: 'UNSUPPORTED', reason: 'unsupported-language-profile' })])
  })
  it('grounds explicit handler/client type references in exact imported declaration identities', async () => {
    const { artifact: a } = await project('schema-associations')
    expect(a.relationships).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'api-handler-references-schema', source: 'symbol:src/server.ts#listItems', target: 'symbol:src/model.ts#Item', qualification: 'RESOLVED' })]))
    expect(a.relationships.some(r => r.kind === 'api-call-references-declaration' && r.target === 'symbol:src/model.ts#Item')).toBe(true)
    expect(a.unresolved.some(u => u.reason === 'missing-declaration-identity')).toBe(true)
    expect(a.limitations.map(l => l.code)).toContain('static-source-only-no-runtime-reachability-or-validation')
    expect(a.relationships.some(r => r.kind === 'api-handler-uses-data-entity' || r.kind === 'api-schema-maps-data-entity')).toBe(false)
  })
  it('retains missing capability, unavailable bytes, incomplete selection and missing owner identity', async () => {
    const { input } = await project('client-server-static')
    const noCapability = structuredClone(input); delete noCapability.symbolIndex.files.find(f => f.path === 'src/client.ts')!.apiRelationships
    expect(buildApiRelationshipEvidence(noCapability).unresolved.some(u => u.reason === 'missing-source-capability')).toBe(true)
    const missing = structuredClone(input); missing.sourceAudit.files.find(f => f.path === 'src/client.ts')!.contentSha256 = null
    expect(buildApiRelationshipEvidence(missing).unresolved.some(u => u.reason === 'source-evidence-unavailable')).toBe(true)
    const incomplete = structuredClone(input); incomplete.sourceAudit.coverage.inventoryComplete = false
    expect(buildApiRelationshipEvidence(incomplete).selection).toMatchObject({ complete: false, production: 'partial' })
    const owner = structuredClone(input); owner.symbolIndex.files.find(f => f.path === 'src/client.ts')!.symbols = []
    expect(targets(buildApiRelationshipEvidence(owner))[0].qualification).toBe('UNRESOLVED')
  })
  it('does not infer targets from lexical names, external paths, shadowed fetch or unsupported options', async () => {
    const { artifact: a } = await project(undefined, {
      'other.ts': 'export interface Item { id: string }',
      'client.ts': "export function load(): Item { return fetch('https://example.test/items', {...options}) as unknown as Item }",
      'shadow.ts': "export function test(fetch: Function) { return fetch('/items') }",
    })
    expect(targets(a).every(r => r.qualification !== 'RESOLVED')).toBe(true)
    expect(a.unresolved.some(u => u.qualification === 'UNSUPPORTED')).toBe(true)
    expect(a.relationships.some(r => r.target === 'symbol:src/other.ts#Item')).toBe(false)
  })
  it('does not qualify a graph target outside the selected inventory or excluded vendor/generated source', async () => {
    const { artifact: a, input } = await project('client-server-static', {
      'node_modules/vendor/client.ts': "export function hidden(){ return fetch('/items') }",
      'dist/generated.ts': "export function generated(){ return fetch('/items') }",
    })
    expect(a.sourceSnapshot.files.some(f => /node_modules|dist\//.test(f.path))).toBe(false)
    const partial = structuredClone(input); partial.sourceAudit.files = partial.sourceAudit.files.filter(f => f.path !== 'src/server.ts')
    expect(targets(buildApiRelationshipEvidence(partial))[0].qualification).toBe('UNRESOLVED')
    expect(buildApiRelationshipEvidence(partial).limitations.some(l => l.code === 'route-outside-selection')).toBe(true)
  })
  it('suppresses exact duplicates and produces stable repeated-run ordering', async () => {
    const { input, artifact } = await project('client-server-static')
    const duplicate = structuredClone(input)
    const payload = duplicate.symbolIndex.files.find(f => f.path === 'src/client.ts')!.apiRelationships!
    payload.observations.push(...structuredClone(payload.observations))
    expect(buildApiRelationshipEvidence(duplicate)).toEqual(artifact)
    expect(buildApiRelationshipEvidence(input)).toEqual(buildApiRelationshipEvidence(structuredClone(input)))
    expect(artifact.nodes.map(n => n.id)).toEqual(artifact.nodes.map(n => n.id).sort())
    expect(artifact.relationships.map(r => r.id)).toEqual(artifact.relationships.map(r => r.id).sort())
  })
  it('invalidates changed bytes at the same HEAD and full/incremental output agrees without source mutation', async () => {
    const { root, out, artifact } = await project('client-server-static')
    const client = join(root, 'src/client.ts'); const before = hash(client)
    await runIndexCommand({ root, src: ['src'], out, incremental: true })
    expect(readApiRelationshipEvidence(out)).toEqual(artifact)
    expect(hash(client)).toBe(before)
    writeFileSync(client, "export function loadItems(){ return fetch('/other') }\n")
    expect(() => readApiRelationshipEvidence(out)).toThrow(/STALE_SOURCE_EVIDENCE/)
    await runIndexCommand({ root, src: ['src'], out, incremental: true })
    const partial = readApiRelationshipEvidence(out)
    expect(partial.sourceSnapshot.snapshotId).not.toBe(artifact.sourceSnapshot.snapshotId)
    expect(targets(partial)[0]).toMatchObject({ qualification: 'UNRESOLVED', path: '/other' })
    const after = hash(client)
    await runIndexCommand({ root, src: ['src'], out })
    expect(readApiRelationshipEvidence(out)).toEqual(partial)
    expect(hash(client)).toBe(after)
  })
  it('preserves the exact inherited source-audit and cache contracts (RSP-007)', async () => {
    expect(SOURCE_AUDIT_SCHEMA_VERSION).toBe('1.1.0')
    expect(SOURCE_AUDIT_EXTRACTOR_CONTRACT_REVISION).toBe('source-audit-v1.5.0')
    expect(CACHE_SCHEMA_VERSION).toBe('1.4.0')
    const { input } = await project('client-server-static')
    const before = JSON.stringify(input.sourceAudit)
    buildApiRelationshipEvidence(input)
    expect(JSON.stringify(input.sourceAudit)).toBe(before)
    expect(input.sourceAudit.files.find(f => f.path === 'src/client.ts')!.capabilities['api-client-calls']).not.toBe('complete')
  })
  it('distinguishes failed parser production from a complete empty selected root', async () => {
    const empty = await project()
    expect(empty.artifact.selection).toMatchObject({ complete: true, production: 'complete' })
    expect(empty.artifact.relationships).toEqual([])
    const failed = await project(undefined, { 'broken.ts': 'export function load( { return fetch(' })
    expect(failed.artifact.selection.production).toBe('failed')
    expect(failed.artifact.unresolved.some(u => u.reason === 'source-evidence-unavailable')).toBe(true)
  })
  it('qualifies Nest framework and unsupported Express methods without expanding the profile', async () => {
    const nest = await project(undefined, { 'server.ts': "import { Controller, Get } from '@nestjs/common'; @Controller('x') export class Service { @Get('y') load(){return 1} }" })
    expect(nest.artifact.unresolved.some(u => u.qualification === 'UNSUPPORTED' && u.reason === 'unsupported-framework-or-method')).toBe(true)
    const head = await project(undefined, { 'server.ts': "import express from 'express'; const app=express(); function h(){}; app.head('/x',h)" })
    expect(head.artifact.relationships.some(r => r.qualification === 'RESOLVED')).toBe(false)
    expect(head.artifact.unresolved.some(u => u.qualification === 'UNSUPPORTED')).toBe(true)
  })
  it('keeps static external URLs and non-imported matching type names unresolved', async () => {
    const { artifact } = await project(undefined, { 'client.ts': "export function load(): Item { return fetch('https://example.test/items') as unknown as Item }", 'model.ts': 'export interface Item { id: string }' })
    expect(artifact.unresolved.some(u => u.reason === 'external-or-unqualified-path')).toBe(true)
    expect(artifact.relationships.some(r => r.target === 'symbol:src/model.ts#Item')).toBe(false)
  })
  it('never promotes a locally named function expression or explicit overwritten global fetch', async () => {
    const { artifact } = await project(undefined, {
      'local.ts': "export const custom = function fetch(){ return fetch('/x') }",
      'global.ts': "globalThis.fetch = custom; export function load(){return fetch('/x')}",
      'server.ts': "import express from 'express'; const app=express(); function h(){}; app.get('/x',h)",
    })
    expect(targets(artifact).every(r => r.qualification === 'UNSUPPORTED')).toBe(true)
  })
  it('does not connect a shadowing generic parameter to a same-named imported declaration', async () => {
    const { artifact } = await project(undefined, {
      'model.ts': 'export interface Item { id: string }',
      'client.ts': "import type { Item } from './model'; export function choose<Item>(value: Item): Item { fetch('/x'); return value }",
    })
    expect(artifact.relationships.some(r => r.target === 'symbol:src/model.ts#Item')).toBe(false)
    expect(artifact.unresolved.some(u => u.reason === 'missing-declaration-identity')).toBe(true)
  })
  it('retains ambiguous imported declarations and wrapper callees without resolved winners', async () => {
    const { artifact } = await project(undefined, {
      'model.ts': 'export interface Item { id: string }\nexport interface Item { value: number }',
      'client.ts': "export function load(){ return fetch('/x') }\nexport function load(){ return fetch('/x') }",
      'view.tsx': "import {load} from './client'; import type {Item} from './model'; export function View(): Item { return load() as unknown as Item }",
    })
    const schema = artifact.unresolved.find(u => u.reason === 'ambiguous-declaration-identity')
    expect(schema).toMatchObject({ qualification: 'AMBIGUOUS' })
    expect(schema!.candidates).toHaveLength(2)
    const call = artifact.relationships.find(r => r.kind === 'api-client-invokes-request')
    expect(call).toMatchObject({ qualification: 'AMBIGUOUS', target: null })
    expect(artifact.unresolved.find(u => u.reason === 'ambiguous-invoked-symbol')!.candidates).toHaveLength(2)
    const candidates = artifact.unresolved.find(u => u.reason === 'ambiguous-invoked-symbol')!.candidates
    expect(candidates.every(id => artifact.nodes.some(n => n.id === id && n.kind === 'api-client-call'))).toBe(true)
    expect(apiRelationshipLookup(artifact, { kind: 'api-client-invokes-request', targetNodeId: candidates[0] }).unresolved).toHaveLength(1)
    expect(artifact.relationships.some(r => r.source === 'symbol:src/view.tsx#View' && r.qualification === 'RESOLVED')).toBe(false)
  })
  it('caps ambiguous candidate diagnostics deterministically without selecting a target', async () => {
    const { artifact } = await project(undefined, {
      'client.ts': "export function load(){return fetch('/x')}",
      'server.ts': "import {Router} from 'express'; const app=Router();\n" + Array.from({ length: 65 }, (_, i) => `function h${i}(){}; app.get('/x',h${i});`).join('\n'),
    })
    const unresolved = artifact.unresolved.find(u => u.reason === 'ambiguous-route-candidates')!
    expect(unresolved).toMatchObject({ qualification: 'AMBIGUOUS' })
    expect(unresolved.candidates).toHaveLength(64)
    expect(unresolved.missingEvidence).toContain('candidate-limit-truncated')
    expect(targets(artifact)[0]).toMatchObject({ qualification: 'AMBIGUOUS', target: null })
    expect(unresolved.candidates).toEqual([...unresolved.candidates].sort())
  })
  it('retains a module-level imported wrapper invocation when caller declaration identity is unavailable', async () => {
    const { artifact } = await project(undefined, {
      'client.ts': "export function load(){return fetch('/x')}",
      'bootstrap.ts': "import {load} from './client'\nload()\n",
    })
    const record = artifact.unresolved.find(u => u.reason === 'missing-call-owner-identity')!
    expect(record).toMatchObject({ source: null, family: 'api-client-invokes-request', qualification: 'UNRESOLVED', location: { path: 'src/bootstrap.ts', startLine: 2 } })
    expect(record.candidates).toHaveLength(1)
    expect(artifact.nodes.some(n => n.id === record.candidates[0] && n.kind === 'api-client-call')).toBe(true)
  })
})
