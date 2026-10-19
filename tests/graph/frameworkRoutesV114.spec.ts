import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { PythonAdapter } from '../../src/languages/python/adapter.js'
import { buildCodeGraph } from '../../src/graph/buildCodeGraph.js'
import { buildFrameworkRoutes } from '../../src/graph/buildFrameworkRoutes.js'
import { resolveFileNodeTarget } from '../../src/lookup/resolveSourceTarget.js'
import { rankCandidateNodes } from '../../src/context/candidateRanking.js'
import { selectGraphNeighborhood } from '../../src/context/graphSelection.js'
import { buildEvidenceGroups } from '../../src/context/evidenceGroups.js'
import { searchIndex } from '../../src/search/searchIndex.js'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { readIndexManifest } from '../../src/indexing/readIndexManifest.js'
import { buildPartialSymbolIndex } from '../../src/indexing/partialRebuild.js'
import { buildIndex } from '../../src/symbol-index/builder.js'
import type { FileSummary, SymbolIndex } from '../../src/symbol-index/types.js'
import type { ContextFocus } from '../../src/context/types.js'

const adapter = new PythonAdapter()
const routeSource = `from fastapi import APIRouter as Router
router = Router(prefix='/items')
@router.get('/{item_id}', dependencies=[security()])
async def item(item_id: int): return item_id
@router.post('/new')
def create(): pass
`
const mountsSource = `from fastapi import FastAPI
from pkg.routes import router as items
app = FastAPI()
app.include_router(items, prefix='/v1')
app.include_router(items, prefix='/v2')
`
function index(sources: Record<string, string>): SymbolIndex {
  const files: FileSummary[] = Object.entries(sources).map(([path, source]) => ({ ...adapter.extractFromSource(path, source), path, hasCallGraphEntries: false }))
  return { schemaVersion: '3', buildTime: '2026-01-01T00:00:00.000Z', repoRoot: '.', sourceRoots: ['.'], fileCount: files.length, symbolCount: files.reduce((n, f) => n + f.symbols.length, 0), files }
}
function graph(sources: Record<string, string>) {
  const idx = index(sources)
  return buildFrameworkRoutes(buildCodeGraph({ symbolIndex: idx }), idx.files)
}
function fixture(sources: Record<string, string>) {
  const base = resolve('.my-dev-kit-workflow/tmp/v1.14.0-b04-20261019/tests')
  mkdirSync(base, { recursive: true })
  const root = mkdtempSync(join(base, 'framework-'))
  for (const [file, text] of Object.entries(sources)) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  return root
}

describe('B04 FastAPI framework route graph', () => {
  it('projects exact handlers, independent encoded route identity and distinct cross-file mount evidence', () => {
    const g = graph({ 'pkg/routes.py': routeSource, 'app.py': mountsSource })
    const routes = g.nodes.filter(n => n.kind === 'framework-route')
    expect(routes).toHaveLength(2)
    const route = routes.find(n => n.label.startsWith('GET'))!
    const handler = 'symbol:pkg/routes.py#item'
    expect(route.id).toBe('framework-route:' + ['pkg/routes.py', 'fastapi', handler, 'GET', '/{item_id}'].map(encodeURIComponent).join('#') + '#0')
    expect(route.routeMetadata).toMatchObject({ framework: 'fastapi', method: 'GET', observedPath: '/{item_id}', routerPrefix: '/items', line: 3, handlerId: handler, pathStatus: 'static' })
    expect(g.edges.find(e => e.source === route.id && e.kind === 'framework-route-handled-by-symbol')?.target).toBe(handler)
    expect(g.edges.find(e => e.source === route.id && e.kind === 'framework-route-defined-in-file')?.target).toBe('file:pkg/routes.py')
    const mounts = g.edges.filter(e => e.target === route.id && e.kind === 'framework-router-mounts-route')
    expect(mounts.map(e => [e.source, e.metadata?.prefix]).sort()).toEqual([['file:app.py', '/v1/items'], ['file:app.py', '/v2/items']])
    expect(mounts[0].id).not.toBe(mounts[1].id)
    expect(JSON.stringify(g)).not.toContain('authenticated')
    const ids = new Set(g.nodes.map(n => n.id))
    expect(ids.size).toBe(g.nodes.length)
    expect(new Set(g.edges.map(e => e.id)).size).toBe(g.edges.length)
    expect(g.edges.every(e => ids.has(e.source) && ids.has(e.target))).toBe(true)
    const reordered = graph({ 'app.py': mountsSource, 'pkg/routes.py': routeSource })
    expect({ ...g, createdAt: '' }).toEqual({ ...reordered, createdAt: '' })
  })

  it.each([
    "from fastapi import FastAPI\nimport pkg.routes\napp = FastAPI()\napp.include_router(pkg.router)\n",
    "from fastapi import FastAPI\napp = FastAPI()\napp.include_router(items, prefix=runtime())\nfrom pkg.routes import router as items\n",
    "from fastapi import FastAPI\nfrom pkg.routes import router as items\nfrom other import router as items\napp = FastAPI()\napp.include_router(items)\n",
    "from fastapi import FastAPI\nfrom pkg.routes import router as items\napp = FastAPI()\nif FLAG:\n    app.include_router(items)\n",
  ])('does not project unsupported mounts', source => {
    expect(graph({ 'pkg/routes.py': routeSource, 'app.py': source }).edges.filter(e => e.kind === 'framework-router-mounts-route')).toEqual([])
  })

  it.each(['import pkg.routes', 'import pkg.routes as routes'])('uses the exact imported module qualifier', imported => {
    const target = imported.endsWith(' as routes') ? 'routes.router' : 'pkg.routes.router'
    const g = graph({ 'pkg/routes.py': routeSource, 'app.py': `from fastapi import FastAPI\n${imported}\napp=FastAPI()\napp.include_router(${target})\n` })
    const mounts = g.edges.filter(e => e.kind === 'framework-router-mounts-route')
    expect(mounts).toHaveLength(2)
    expect(mounts.every(e => e.source === 'file:app.py' && g.nodes.find(n => n.id === e.target)?.path === 'pkg/routes.py')).toBe(true)
  })

  it.each([
    'class FastAPI: pass\napp = FastAPI()\n@app.get("/fake")\ndef fake(): pass\n',
    'if FLAG:\n    from fastapi import FastAPI\napp = FastAPI()\n@app.get("/fake")\ndef fake(): pass\n',
    'from fastapi import FastAPI\nFastAPI = replacement\napp = FastAPI()\n@app.get("/fake")\ndef fake(): pass\n',
    'from fastapi import *\napp = FastAPI()\n@app.get("/fake")\ndef fake(): pass\n',
    'def invalid(:\n',
  ])('does not fabricate routes without verified framework ownership', source => {
    const g = graph({ 'negative.py': source })
    expect(g.nodes.filter(n => n.kind === 'framework-route')).toEqual([])
    expect(g.edges.filter(e => e.kind.startsWith('framework-'))).toEqual([])
  })

  it('does not infer route or mount ownership after namespace/receiver mutation', () => {
    const g = graph({ 'pkg/routes.py': routeSource, 'app.py': "from fastapi import FastAPI\nimport pkg.routes as routes\napp=FastAPI()\nroutes.router=unknown\napp.include_router(routes.router)\n" })
    expect(g.edges.filter(e => e.kind === 'framework-router-mounts-route')).toEqual([])
    const mutated = graph({ 'app.py': "from fastapi import FastAPI\napp=FastAPI()\napp.get=unknown\n@app.get('/x')\ndef x(): pass\n" })
    expect(mutated.nodes.filter(n => n.kind === 'framework-route')).toEqual([])
  })

  it('retains dynamic and conditional uncertainty without speculative handlers or mounts', () => {
    const g = graph({ 'dynamic.py': `from fastapi import APIRouter, FastAPI
router = APIRouter(prefix=runtime())
app = FastAPI()
@router.get(runtime())
def dynamic(): pass
if FLAG:
    @app.get('/conditional')
    def conditional(): pass
app.include_router(router)
` })
    expect(g.nodes.filter(n => n.kind === 'framework-route')).toHaveLength(2)
    expect(g.nodes.filter(n => n.kind === 'framework-route').every(n => n.routeMetadata?.pathStatus === 'unresolved')).toBe(true)
    expect(g.edges.filter(e => e.kind === 'framework-route-handled-by-symbol' || e.kind === 'framework-router-mounts-route')).toEqual([])
  })

  it('rejects missing/forged handler identity while retaining the observed declaration', () => {
    const idx = index({ 'r.py': routeSource })
    idx.files[0].frameworkRouteFacts!.find(f => f.kind === 'route')!.handlerId = 'symbol:elsewhere.py#item'
    const g = buildFrameworkRoutes(buildCodeGraph({ symbolIndex: idx }), idx.files)
    const route = g.nodes.find(n => n.kind === 'framework-route' && n.label.startsWith('GET'))!
    expect(g.edges.filter(e => e.source === route.id && e.kind === 'framework-route-handled-by-symbol')).toEqual([])
  })

  it('preserves route kind, bounded source and exact neighborhood handler relationships', () => {
    const g = graph({ 'pkg/routes.py': routeSource })
    const route = g.nodes.find(n => n.kind === 'framework-route')!
    const target = resolveFileNodeTarget(g, route.id, 4)
    expect(target).toMatchObject({ nodeId: route.id, startLine: route.line, endLine: route.line! + 3 })
    expect(target.symbolEndLine).toBeUndefined()
    const ranked = rankCandidateNodes({ status: 'ok', warnings: [], results: [{ id: route.id, nodeId: route.id, kind: 'framework-route', label: route.label, path: route.path, score: 20, matchReasons: [] }] })
    expect(ranked[0]).toMatchObject({ nodeId: route.id, kind: 'framework-route', filePath: route.path })
    const selected = selectGraphNeighborhood({ codeGraph: g, focus: { focusNodeId: route.id } as ContextFocus, maxGraphNodes: 10, maxGraphEdges: 10 })
    expect(selected.nodes.find(n => n.nodeId === route.id)).toMatchObject({ kind: 'framework-route', label: route.label })
    expect(selected.edges.find(e => e.kind === 'framework-route-handled-by-symbol')?.to).toBe(route.routeMetadata?.handlerId)
    expect(selected.nodes.find(n => n.nodeId === route.id)).toMatchObject({ routeMetadata: route.routeMetadata })
  })

  it('persists search/source evidence and proves full/incremental parity with unchanged cross-file facts', async () => {
    const root = fixture({ 'src/pkg/routes.py': routeSource, 'src/app.py': mountsSource, 'src/models.py': "from django.db import models\nclass User(models.Model):\n    name = models.CharField(max_length=20)\n", 'src/guard.py': "raise RuntimeError('must never execute')\n" })
    const options = { root, src: ['src'], out: 'incremental', incremental: true }
    await runIndexCommand(options)
    writeFileSync(join(root, 'src/app.py'), mountsSource.replace('/v2', '/v3'))
    const partial = await runIndexCommand(options)
    expect(partial.mode === 'index' && partial.cache.mode).toContain('incremental-partial')
    await runIndexCommand({ ...options, out: 'full', incremental: false })
    for (const artifact of ['symbol-index.json', 'code-graph.json', 'data-model.json', 'data-model-graph.json']) {
      const a = JSON.parse(readFileSync(join(root, 'incremental', artifact), 'utf8'))
      const b = JSON.parse(readFileSync(join(root, 'full', artifact), 'utf8'))
      delete a.createdAt; delete b.createdAt; delete a.buildTime; delete b.buildTime
      expect(a).toEqual(b)
    }
    const idx = JSON.parse(readFileSync(join(root, 'full/symbol-index.json'), 'utf8'))
    const g = JSON.parse(readFileSync(join(root, 'full/code-graph.json'), 'utf8'))
    const found = searchIndex({ resolved: readIndexManifest(join(root, 'full')), symbolIndex: idx, codeGraph: g, query: 'GET item_id', limit: 30 }).results
    expect(found.some(r => r.kind === 'framework-route' && r.label === 'GET /{item_id}')).toBe(true)
    const route = g.nodes.find((n: { kind: string; label: string }) => n.kind === 'framework-route' && n.label.startsWith('GET'))
    const source = spawnSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), 'src/cli.ts', 'source', '--index', join(root, 'full'), '--node', route.id, '--max-lines', '4', '--format', 'json'], { encoding: 'utf8', shell: false })
    expect(source.status).toBe(0)
    expect(source.stdout).toContain('@router.get')
    expect(source.stdout).toContain('bounded declaration excerpt')
    const legacy = buildIndex({ repoRoot: root, sourceRoots: ['src'] })
    for (const f of legacy.index.files) { delete f.pythonOrmFacts; delete f.frameworkRouteFacts }
    const refreshed = buildPartialSymbolIndex({ repoRoot: root, sourceRoots: ['src'], buildCallGraph: false, discoveryFiles: legacy.discovery.files, unchangedPaths: new Set(legacy.index.files.map(f => f.path)), previousFileSummariesByPath: new Map(legacy.index.files.map(f => [f.path, f])), previousCacheEntriesByPath: new Map() })
    expect(refreshed.reusedPaths).toEqual([])
    expect(refreshed.index.files.every(f => f.pythonOrmFacts !== undefined && f.frameworkRouteFacts !== undefined)).toBe(true)
  })

  it('retains grounded route metadata in existing context evidence groups', () => {
    const sources = { 'pkg/routes.py': routeSource }
    const idx = index(sources)
    const g = graph(sources)
    const route = g.nodes.find(n => n.kind === 'framework-route')!
    const selectedGraph = selectGraphNeighborhood({ codeGraph: g, focus: { focusNodeId: route.id } as ContextFocus, maxGraphNodes: 10, maxGraphEdges: 10 })
    const result = buildEvidenceGroups({ role: 'architecture', candidateFiles: [], candidateNodes: [], focusIntake: { focusFiles: [], focusSymbols: [], unresolvedFocusFiles: [], unresolvedFocusSymbols: [], ambiguousFocusSymbols: [], warnings: [] }, changedSurface: { available: false, diffRequested: false, files: [], symbols: [], conflicts: [], warnings: [] }, requestedEvidenceKinds: [], codeGraph: g, symbolIndex: idx, selectedGraph, repoRoot: resolve('.') })
    const item = result.groups.flatMap(group => group.items).find(item => item.nodeId === route.id)!
    expect(item.metadata).toMatchObject({ nodeKind: 'framework-route', framework: 'fastapi', method: route.routeMetadata?.method, observedPath: route.routeMetadata?.observedPath, handlerId: route.routeMetadata?.handlerId })
  })
})
