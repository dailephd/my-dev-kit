import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import * as cacheMetadata from '../../src/indexing/cacheMetadata.js'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { buildFrameworkRoutes } from '../../src/graph/buildFrameworkRoutes.js'
import { buildCodeGraph } from '../../src/graph/buildCodeGraph.js'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { readIndexManifest } from '../../src/indexing/readIndexManifest.js'
import { searchIndex } from '../../src/search/searchIndex.js'
import { resolveFileNodeTarget } from '../../src/lookup/resolveSourceTarget.js'
import { rankCandidateNodes } from '../../src/context/candidateRanking.js'
import { selectGraphNeighborhood } from '../../src/context/graphSelection.js'
import { buildEvidenceGroups } from '../../src/context/evidenceGroups.js'
import { computeConfigFingerprint } from '../../src/indexing/cacheMetadata.js'
import type { ContextFocus } from '../../src/context/types.js'
import { allocateV114OutputDir } from '../helpers/v114OutputRoot.js'

const base = allocateV114OutputDir('js-framework-routes-v114')
function fixture(sources: Record<string, string>) {
  mkdirSync(base, { recursive: true })
  const root = mkdtempSync(join(base, 'js-framework-'))
  for (const [file, text] of Object.entries(sources)) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  return root
}
function project(sources: Record<string, string>) {
  const root = fixture(sources)
  const { index } = buildIndex({ repoRoot: root, sourceRoots: ['src'] })
  return { root, index, graph: buildFrameworkRoutes(buildCodeGraph({ symbolIndex: index }), index.files) }
}
const express = `import express, { Router as MakeRouter } from 'express';
const app = express();
const router = MakeRouter();
function listItems() { return null; }
router.get('/items', listItems);
app.use('/api', router);
app.use('/v2', router);
`
const nest = `import {Controller, Get, Post, UseGuards, UseInterceptors, UsePipes, UseFilters} from '@nestjs/common';
@Controller('/users')
@UseGuards(AuthGuard)
export class UsersController {
  @Get(':id')
  @UseInterceptors(Trace)
  @UsePipes(new ValidationPipe())
  @UseFilters(Filter)
  async getUser() { return null; }
  @Post()
  static create() { return null; }
}
@Controller('/admins')
export class AdminController {
  @Get(':id')
  getUser() { return null; }
}
class Ordinary { method() {} }
`
const routeId = (file: string, framework: string, key: string, method: string, path: string, ordinal: number) => 'framework-route:' + [file, framework, key, method, path].map(encodeURIComponent).join('#') + `#${ordinal}`
const normalize = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, val) => key === 'createdAt' || key === 'buildTime' ? '<timestamp>' : val))

describe('B06 JavaScript framework source evidence', () => {
  it('keeps exact Express handler and route identities and separate mount call sites', () => {
    const { graph: g } = project({ 'src/app.ts': express })
    const id = routeId('src/app.ts', 'express', 'symbol:src/app.ts#listItems', 'GET', '/items', 0)
    expect(g.nodes.find(n => n.id === id)?.routeMetadata).toMatchObject({ framework: 'express', observedPath: '/items', ownerBinding: 'router', method: 'GET', handlerId: 'symbol:src/app.ts#listItems', pathStatus: 'static', line: 5 })
    expect(g.edges.filter(e => e.source === id).map(e => [e.kind, e.target]).sort()).toEqual([['framework-route-defined-in-file', 'file:src/app.ts'], ['framework-route-handled-by-symbol', 'symbol:src/app.ts#listItems']])
    const mounts = g.edges.filter(e => e.kind === 'framework-router-mounts-route')
    expect(mounts.map(e => [e.source, e.target, e.metadata?.prefix, e.metadata?.line])).toEqual([['file:src/app.ts', id, '/api', 6], ['file:src/app.ts', id, '/v2', 7]])
    expect(new Set(mounts.map(e => e.id)).size).toBe(2)
  })

  it.each(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all'])('observes Express %s without expanding ALL into requests', method => {
    const { graph } = project({ 'src/app.cjs': `const express=require('express'); const app=express(); function h(){}; app.${method}(\`/x\`, h);` })
    const id = routeId('src/app.cjs', 'express', 'symbol:src/app.cjs#h', method.toUpperCase(), '/x', 0)
    expect(graph.nodes.filter(n => n.kind === 'framework-route').map(n => n.id)).toEqual([id])
    expect(graph.edges.find(e => e.kind === 'framework-route-handled-by-symbol')).toMatchObject({ source: id, target: 'symbol:src/app.cjs#h' })
  })

  it.each([
    ["import express from 'express'; const e=express; const app=e();", 'app'],
    ["import {Router as R} from 'express'; const Make=R; const app=Make();", 'app'],
    ["const {Router:R}=require('express'); const app=R();", 'app'],
    ["const e=require('express'); const R=e.Router; const app=R();", 'app'],
  ])('accepts grounded constructor aliases: %s', (prefix, receiver) => {
    const { graph } = project({ 'src/app.js': `${prefix}\nfunction h(){}\n${receiver}.get('/x',h);` })
    const id = routeId('src/app.js', 'express', 'symbol:src/app.js#h', 'GET', '/x', 0)
    expect(graph.edges.find(e => e.kind === 'framework-route-handled-by-symbol')).toMatchObject({ source: id, target: 'symbol:src/app.js#h' })
  })

  it.each([
    "function express(){} const app=express(); app.get('/x',h);",
    "import express from 'other'; const app=express(); app.get('/x',h);",
    "import express from 'express'; express=other; const app=express(); app.get('/x',h);",
    "import express from 'express'; const app=express(); const alias=app; alias.get=other; app.get('/x',h);",
    "import express from 'express'; const app=express(); app=other; app.get('/x',h);",
    "import express from 'express'; const app=express(); ({app}=other); app.get('/x',h);",
    "import express from 'express'; const app=express(); let alias; alias=app; alias.get=other; app.get('/x',h);",
    "import express from 'express'; const app=express(); app.get('/setting');",
    "import express from 'express'; const app=express(); Object.assign(app,{get:other}); app.get('/x',h);",
    "import express from 'express'; const app=express(); function f(app){app.get('/x',h);}",
    "import express from 'express'; const app=express(); if(flag) app.get('/x',h);",
    "import type {Router} from 'express'; const app=Router(); app.get('/x',h);",
    "const require=other; const express=require('express'); const app=express(); app.get('/x',h);",
    "const {default: express}=require('express'); const app=express(); app.get('/x',h);",
  ])('does not fabricate Express provenance: %s', source => {
    const { graph } = project({ 'src/negative.ts': source })
    expect(graph.nodes.filter(n => n.kind === 'framework-route')).toEqual([])
    expect(graph.edges.filter(e => e.kind.startsWith('framework-'))).toEqual([])
  })

  it.each([
    ['src/handler.ts', 'export function real(){}', "import {real as h} from './handler.js';"],
    ['src/handler.js', 'function real(){} export {real as renamed};', "import {renamed as h} from './handler';"],
    ['src/handler.cjs', 'function real(){} module.exports=real;', "const h=require('./handler');"],
    ['src/handler.cjs', 'function real(){} exports.run=real;', "const {run:h}=require('./handler');"],
    ['src/handler.ts', 'export default function real(){}', "import h from './handler';"],
    ['src/handler.ts', 'const real=()=>null; export default real;', "import h from './handler';"],
  ])('resolves an imported handler only inside its unique module: %s %s', (path, handler, imported) => {
    const { graph } = project({ [path]: handler, 'src/unrelated.ts': 'export function real(){}', 'src/app.ts': `${imported}\nimport express from 'express'; const app=express(); app.get('/x',h);` })
    const id = routeId('src/app.ts', 'express', `symbol:${path}#real`, 'GET', '/x', 0)
    expect(graph.edges.find(e => e.kind === 'framework-route-handled-by-symbol')).toMatchObject({ source: id, target: `symbol:${path}#real` })
  })

  it.each([
    ['const h=runtime();', {}],
    ["import {h} from './missing';", { 'src/unrelated.ts': 'export function h(){}' }],
    ["import {h} from './handler';", { 'src/handler.ts': 'export function h(){}', 'src/handler.js': 'export function h(){}' }],
    ['function h(){}; h=other;', {}],
    ['function h(){}; function nested(h){};', {}],
    ["import {h} from './handler';", { 'src/handler.ts': 'export const h=runtime();' }],
    ["import type {h} from './handler';", { 'src/handler.ts': 'export function h(){}' }],
  ] as Array<[string, Record<string, string>]>)('retains a route without guessed handlers: %s', (handler, extra) => {
    const { graph } = project({ ...extra, 'src/app.ts': `import express from 'express'; const app=express(); ${handler}\napp.get('/x',h);` })
    expect(graph.nodes.filter(n => n.kind === 'framework-route')).toHaveLength(1)
    expect(graph.edges.filter(e => e.kind === 'framework-route-handled-by-symbol')).toEqual([])
  })

  it('retains dynamic/inline route evidence and rejects unsupported mounts', () => {
    const { graph } = project({ 'src/app.ts': express + "router.post(runtime(), listItems);\nrouter.put(`/x/${id}`,()=>null);\napp.use(runtime(),router);\napp.use('/missing',unknown);" })
    const dynamic = graph.nodes.filter(n => n.kind === 'framework-route' && n.routeMetadata?.pathStatus === 'unresolved')
    expect(dynamic).toHaveLength(2)
    expect(graph.edges.filter(e => dynamic.some(n => n.id === e.source) && e.kind === 'framework-route-handled-by-symbol')).toEqual([])
    expect(graph.edges.filter(e => e.kind === 'framework-router-mounts-route')).toHaveLength(2)
  })

  it('keeps an inline callback as call-site evidence without a physical named handler', () => {
    const { graph } = project({ 'src/inline.js': "const express=require('express');\nconst app=express();\napp.get('/x',()=>null);" })
    const id = routeId('src/inline.js', 'express', '3:0', 'GET', '/x', 0)
    expect(graph.nodes.find(n => n.id === id)?.routeMetadata).toMatchObject({ handlerId: null, handlerStatus: 'unresolved', line: 3, column: 0 })
    expect(graph.edges.filter(e => e.source === id).map(e => [e.kind, e.target])).toEqual([['framework-route-defined-in-file', 'file:src/inline.js']])
  })

  it.each([
    ["import {router} from './router';", { 'src/router.ts': "import {Router} from 'express'; export const router=Router(); function h(){}; router.get('/x',h);", 'src/router.js': "export const router=other;" }, ''],
    ["import {router} from './missing';", { 'src/router.ts': "import {Router} from 'express'; export const router=Router(); function h(){}; router.get('/x',h);" }, ''],
    ["import {router} from './router';", { 'src/router.ts': "import {Router} from 'express'; export const router=Router(); function h(){}; router.get('/x',h);" }, 'router.get=other;'],
  ] as Array<[string, Record<string, string>, string]>)('does not guess imported mount targets: %s', (imported, sources, mutation) => {
    const { graph } = project({ ...sources, 'src/app.ts': `import express from 'express'; ${imported} const app=express(); ${mutation} app.use('/api',router);` })
    expect(graph.edges.filter(e => e.kind === 'framework-router-mounts-route')).toEqual([])
  })

  it.each([
    ['src/router.ts', "import {Router} from 'express'; export const router=Router(); router.get('/x',h); function h(){}", "import {router as r} from './router';"],
    ['src/router.cjs', "const express=require('express'); const router=express.Router(); router.get('/x',h); function h(){}; module.exports=router;", "const r=require('./router');"],
  ])('mounts a uniquely selected imported router: %s', (path, source, imported) => {
    const { graph } = project({ [path]: source, 'src/app.ts': `import express from 'express'; ${imported} const app=express(); app.use('/api',r); app.use('/v2',r);` })
    const id = routeId(path, 'express', `symbol:${path}#h`, 'GET', '/x', 0)
    expect(graph.edges.filter(e => e.kind === 'framework-router-mounts-route').map(e => [e.source, e.target, e.metadata?.prefix]).sort()).toEqual([['file:src/app.ts', id, '/api'], ['file:src/app.ts', id, '/v2']])
  })

  it('emits only recognized NestJS methods with exact qualified IDs and static composition', () => {
    const { graph, index } = project({ 'src/controller.ts': nest })
    const users = 'symbolq:src%2Fcontroller.ts#class%3AUsersController%402%3A0#getUser#0'
    const admins = 'symbolq:src%2Fcontroller.ts#class%3AAdminController%4013%3A0#getUser#0'
    expect(index.files[0].symbols.filter(s => s.kind === 'method').map(s => s.nodeId)).toEqual([users, 'symbolq:src%2Fcontroller.ts#class%3AUsersController%402%3A0#create#0', admins])
    expect(index.files[0].symbols.find(s => s.nodeId === users)).toMatchObject({ signature: 'async getUser()', location: { line: 5, endLine: 9 } })
    expect(index.files[0].symbols.find(s => s.name === 'create')).toMatchObject({ signature: 'static create()', location: { line: 10, endLine: 11 } })
    const id = routeId('src/controller.ts', 'nestjs', users, 'GET', ':id', 0)
    const node = graph.nodes.find(n => n.id === id)!
    expect(node.routeMetadata).toMatchObject({ controllerId: 'symbol:src/controller.ts#UsersController', controllerPrefix: '/users', composedPath: '/users/:id', observedPath: ':id', handlerId: users, compositionStatus: 'static-source-composition' })
    expect(node.routeMetadata?.syntax).toContain('@UseGuards(AuthGuard)')
    for (const name of ['UseInterceptors', 'UsePipes', 'UseFilters']) expect(node.routeMetadata?.syntax).toContain(`@${name}`)
    expect(graph.edges.find(e => e.source === id && e.kind === 'framework-route-handled-by-symbol')?.target).toBe(users)
    expect(graph.edges.some(e => e.kind === 'framework-router-mounts-route')).toBe(false)
    expect(graph.nodes.find(n => n.symbolName === 'UsersController')?.id).toBe('symbol:src/controller.ts#UsersController')
    expect(JSON.stringify(graph)).not.toMatch(/authenticated|authorized|enforced|injected/)
  })

  it.each(['Get','Post','Put','Patch','Delete','Options','Head','All'])('recognizes aliased NestJS %s and the default empty segment', method => {
    const { graph } = project({ 'src/c.ts': `import {Controller as C, ${method} as M} from '@nestjs/common';\n@C('/a')\nclass A { @M() async run(){} }` })
    const handler = 'symbolq:src%2Fc.ts#class%3AA%402%3A0#run#0'
    const id = routeId('src/c.ts', 'nestjs', handler, method.toUpperCase(), '', 0)
    expect(graph.nodes.find(n => n.id === id)?.routeMetadata).toMatchObject({ handlerId: handler, controllerPrefix: '/a', observedPath: '', composedPath: '/a' })
    expect(graph.edges.find(e => e.kind === 'framework-route-handled-by-symbol')).toMatchObject({ source: id, target: handler })
  })

  it.each([
    "function Controller(x){return x}; function Get(x){return x};",
    "import {Controller,Get} from 'unrelated';",
    "import type {Controller,Get} from '@nestjs/common';",
    "import {Controller,Get} from '@nestjs/common'; Controller=other;",
  ])('does not trust unrelated or mutable NestJS decorators', prefix => {
    const { graph, index } = project({ 'src/c.ts': `${prefix}\n@Controller('/x') class A { @Get() run(){} }` })
    expect(graph.nodes.filter(n => n.kind === 'framework-route')).toEqual([])
    expect(index.files[0].symbols.filter(s => s.kind === 'method')).toEqual([])
  })

  it('retains dynamic NestJS paths as unresolved and overloads as one physical implementation', () => {
    const { graph, index } = project({ 'src/c.ts': "import {Controller,Get} from '@nestjs/common';\n@Controller(dynamic()) class A { @Get('/x') run(){} }\n@Controller('/a') class B {\n run(x:string):void;\n @Get(dynamic()) run(x:any){}\n}" })
    expect(index.files[0].symbols.filter(s => s.kind === 'method')).toHaveLength(2)
    expect(graph.nodes.filter(n => n.kind === 'framework-route').map(n => n.routeMetadata?.pathStatus)).toEqual(['unresolved', 'unresolved'])
    expect(graph.edges.filter(e => e.kind === 'framework-route-handled-by-symbol')).toEqual([])
  })

  it('keeps IDs unique, endpoints valid and serialization deterministic', () => {
    const sources = { 'src/app.ts': express, 'src/controller.ts': nest }
    const a = project(sources).graph
    const b = project(Object.fromEntries(Object.entries(sources).reverse())).graph
    const ids = new Set(a.nodes.map(n => n.id))
    expect(ids.size).toBe(a.nodes.length)
    expect(new Set(a.edges.map(e => e.id)).size).toBe(a.edges.length)
    expect(a.edges.every(e => ids.has(e.source) && ids.has(e.target))).toBe(true)
    expect(normalize(a)).toEqual(normalize(b))
  })

  it('attributes calls from same-line controller methods to their exact physical owners', () => {
    const root = fixture({ 'src/helper.ts': 'export function helper(){}', 'src/c.ts': "import {Controller,Get} from '@nestjs/common'; import {helper} from './helper';\n@Controller('/a') class A { @Get() run(){ helper(); } } @Controller('/b') class B { @Get() run(){ helper(); } }" })
    const result = buildIndex({ repoRoot: root, sourceRoots: ['src'], buildCallGraph: true })
    expect(result.callGraph?.edges.filter(e => e.calleeNodeId === 'symbol:src/helper.ts#helper').map(e => e.callerNodeId)).toEqual(['symbolq:src%2Fc.ts#class%3AA%402%3A0#run#0', 'symbolq:src%2Fc.ts#class%3AB%402%3A56#run#0'])
  })
})

describe('B06 shared retrieval and incremental integration', () => {
  const cli = (args: string[]) => spawnSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), 'src/cli.ts', ...args], { encoding: 'utf8', shell: false, windowsHide: true })
  it('preserves all generic consumers for Express and NestJS without executing target source', async () => {
    const root = fixture({ 'src/app.ts': "throw new Error('MUST NEVER EXECUTE');\n" + express, 'src/c.ts': nest })
    await runIndexCommand({ root, src: ['src'], out: 'index' })
    const idxPath = join(root, 'index')
    const index = JSON.parse(readFileSync(join(idxPath, 'symbol-index.json'), 'utf8'))
    const graph = JSON.parse(readFileSync(join(idxPath, 'code-graph.json'), 'utf8'))
    for (const [framework, query, needle] of [['express', 'express GET /items', "router.get('/items'"], ['nestjs', 'nestjs GET :id', "@Get(':id')"]]) {
      const found = searchIndex({ resolved: readIndexManifest(idxPath), symbolIndex: index, codeGraph: graph, query, limit: 30 }).results
      const route = graph.nodes.find((n: { kind: string; routeMetadata?: { framework?: string } }) => n.kind === 'framework-route' && n.routeMetadata?.framework === framework)
      expect(found.some(r => r.id === route.id && r.kind === 'framework-route')).toBe(true)
      expect(resolveFileNodeTarget(graph, route.id, 4).symbolEndLine).toBeUndefined()
      const ranked = rankCandidateNodes({ status: 'ok', warnings: [], results: [{ id: route.id, nodeId: route.id, kind: 'framework-route', label: route.label, path: route.path, score: 20, matchReasons: [] }] })
      expect(ranked[0]).toMatchObject({ nodeId: route.id, kind: 'framework-route', filePath: route.path })
      const selectedGraph = selectGraphNeighborhood({ codeGraph: graph, focus: { focusNodeId: route.id } as ContextFocus, maxGraphNodes: 10, maxGraphEdges: 10 })
      expect(selectedGraph.nodes.find(n => n.nodeId === route.id)).toMatchObject({ routeMetadata: route.routeMetadata, kind: 'framework-route' })
      expect(selectedGraph.edges.find(e => e.kind === 'framework-route-handled-by-symbol')?.to).toBe(route.routeMetadata.handlerId)
      const evidence = buildEvidenceGroups({ role: 'architecture', candidateFiles: [], candidateNodes: [], focusIntake: { focusFiles: [], focusSymbols: [], unresolvedFocusFiles: [], unresolvedFocusSymbols: [], ambiguousFocusSymbols: [], warnings: [] }, changedSurface: { available: false, diffRequested: false, files: [], symbols: [], conflicts: [], warnings: [] }, requestedEvidenceKinds: [], codeGraph: graph, symbolIndex: index, selectedGraph, repoRoot: root })
      expect(evidence.groups.flatMap(g => g.items).find(item => item.nodeId === route.id)?.metadata).toMatchObject({ framework, nodeKind: 'framework-route', handlerId: route.routeMetadata.handlerId })
      for (const command of ['lookup', 'slice', 'source']) {
        const result = cli([command, '--index', idxPath, '--node', route.id, ...(command === 'source' ? ['--max-lines', '4'] : ['--depth', '1']), '--json'])
        expect(result.status, result.stderr).toBe(0)
        expect(result.stdout).toContain(command === 'source' ? needle : route.routeMetadata.handlerId)
        if (command === 'source') expect(result.stdout).toContain('bounded declaration excerpt')
      }
    }
    const view = cli(['view', '--index', idxPath, '--graph', 'code', '--format', 'dot', '--out', join(root, 'code.dot'), '--json'])
    expect(view.status, view.stderr).toBe(0)
    const dot = readFileSync(join(root, 'code.dot'), 'utf8')
    expect(dot).toContain('framework-route:')
    expect(dot).toContain('nestjs')
    expect(dot).toContain('express')
    const context = cli(['context', '--index', idxPath, '--query', 'express GET /items', '--out', join(root, 'capsule.json'), '--audit-out', join(root, 'audit.json'), '--json'])
    expect(context.status, context.stderr).toBe(0)
    expect(readFileSync(join(root, 'capsule.json'), 'utf8')).toContain('framework-route')
  }, 30000)

  it('rejects B05 cache before no-change reuse, reprojects unchanged routers, and equals full artifacts', async () => {
    const root = fixture({ 'src/router.ts': "import {Router} from 'express'; export const router=Router(); function h(){}; router.get('/items',h);", 'src/app.ts': "import express from 'express'; import {router} from './router'; const app=express(); app.use('/api',router);", 'src/c.ts': nest })
    const options = { root, src: ['src'], out: 'incremental', incremental: true, callGraph: true }
    const oldFingerprint = (input: Parameters<typeof computeConfigFingerprint>[0]) => createHash('sha256').update(JSON.stringify({
      pythonExtractionRevision: 'v1.14.0-b04', jsTsExtractionRevision: 'v1.14.0-b05',
      sourceRoots: [...input.sourceRoots].map(p => p.replace(/\\/g, '/')).sort(), excludePatterns: [...input.excludePatterns].map(v => v.trim()).sort(), callGraphEnabled: input.callGraphEnabled, language: input.language,
      defaultIgnoredDirectoryNames: [...input.defaultIgnoredDirectoryNames].sort(), defaultIgnoredDirectoryPrefixes: [...input.defaultIgnoredDirectoryPrefixes].sort(), defaultFileExcludePatterns: [...input.defaultFileExcludePatterns].sort(),
      androidEvidenceFingerprint: input.androidEvidenceFingerprint, androidGradleEvidenceFingerprint: input.androidGradleEvidenceFingerprint, androidManifestEvidenceFingerprint: input.androidManifestEvidenceFingerprint, androidResourcesEvidenceFingerprint: input.androidResourcesEvidenceFingerprint, androidNavigationXmlEvidenceFingerprint: input.androidNavigationXmlEvidenceFingerprint, androidTestEvidenceFingerprint: input.androidTestEvidenceFingerprint,
    })).digest('hex')
    const spy = vi.spyOn(cacheMetadata, 'computeConfigFingerprint').mockImplementationOnce(oldFingerprint)
    try { await runIndexCommand(options) } finally { spy.mockRestore() }
    const rebuilt = await runIndexCommand(options)
    expect(rebuilt.mode === 'index' && rebuilt.cache.mode).toBe('incremental-full-config-changed')
    await runIndexCommand({ ...options, out: 'before', incremental: false })
    writeFileSync(join(root, 'src/app.ts'), "import express from 'express'; import {router} from './router'; const app=express(); app.use('/v2',router); app.use('/v3',router);")
    const partial = await runIndexCommand(options)
    expect(partial.mode === 'index' && partial.cache.mode).toContain('incremental-partial')
    expect(partial.mode === 'index' && partial.incrementalRefresh?.reusedFileCount).toBeGreaterThanOrEqual(2)
    await runIndexCommand({ ...options, out: 'full', incremental: false })
    for (const artifact of ['symbol-index.json', 'code-graph.json', 'call-graph.json']) expect(normalize(JSON.parse(readFileSync(join(root, 'incremental', artifact), 'utf8')))).toEqual(normalize(JSON.parse(readFileSync(join(root, 'full', artifact), 'utf8'))))
    const graph = JSON.parse(readFileSync(join(root, 'full/code-graph.json'), 'utf8'))
    const id = routeId('src/router.ts', 'express', 'symbol:src/router.ts#h', 'GET', '/items', 0)
    expect(graph.edges.filter((e: { kind: string }) => e.kind === 'framework-router-mounts-route').map((e: { source: string; target: string; metadata: { prefix: string } }) => [e.source, e.target, e.metadata.prefix]).sort()).toEqual([['file:src/app.ts', id, '/v2'], ['file:src/app.ts', id, '/v3']])
    const diff = cli(['graph-diff', '--before', join(root, 'before'), '--after', join(root, 'full'), '--json'])
    expect(diff.status, diff.stderr).toBe(0)
    expect(diff.stdout).toContain('framework-mount:')
    const same = cli(['graph-diff', '--before', join(root, 'incremental'), '--after', join(root, 'full'), '--json'])
    expect(same.status, same.stderr).toBe(0)
    writeFileSync(join(root, 'src/router.ts'), "import {Router} from 'express'; export const router=Router(); function h(){}; router.post('/changed',h);")
    const routerChanged = await runIndexCommand(options)
    expect(routerChanged.mode === 'index' && routerChanged.cache.mode).toContain('incremental-partial')
    await runIndexCommand({ ...options, out: 'full-router-change', incremental: false })
    for (const artifact of ['symbol-index.json', 'code-graph.json', 'call-graph.json']) expect(normalize(JSON.parse(readFileSync(join(root, 'incremental', artifact), 'utf8')))).toEqual(normalize(JSON.parse(readFileSync(join(root, 'full-router-change', artifact), 'utf8'))))
    const changedGraph = JSON.parse(readFileSync(join(root, 'incremental/code-graph.json'), 'utf8'))
    const changedId = routeId('src/router.ts', 'express', 'symbol:src/router.ts#h', 'POST', '/changed', 0)
    expect(changedGraph.edges.filter((e: { kind: string }) => e.kind === 'framework-router-mounts-route').map((e: { source: string; target: string; metadata: { prefix: string } }) => [e.source, e.target, e.metadata.prefix]).sort()).toEqual([['file:src/app.ts', changedId, '/v2'], ['file:src/app.ts', changedId, '/v3']])
    const noop = await runIndexCommand(options)
    expect(noop.mode === 'index' && noop.cache.mode).toBe('incremental-no-change')
  }, 30000)
})
