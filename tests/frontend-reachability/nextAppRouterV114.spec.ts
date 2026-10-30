import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { runFrontendAnalyzer } from '../../src/frontend/frontendAnalyzer.js'
import { runFrontendReachabilityAnalyzer } from '../../src/frontend-reachability/runFrontendReachabilityAnalyzer.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'
import { allocateV114OutputDir } from '../helpers/v114OutputRoot.js'

const base = allocateV114OutputDir('next-app-router-v114')
function fixture(files: Record<string, string>) {
  fs.mkdirSync(base, { recursive: true })
  const root = fs.mkdtempSync(path.join(base, 'next-'))
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), content)
  }
  const index = { files: Object.keys(files).filter((p) => /\.[jt]sx?$/.test(p)).map((p) => ({ path: p })) } as SymbolIndex
  const frontend = runFrontendAnalyzer({ symbolIndex: index, repoRoot: root, createdAt: 'fixed' }).artifact
  return { root, frontend, artifact: runFrontendReachabilityAnalyzer({ frontendArtifact: frontend, repoRoot: root, createdAt: 'fixed' }).artifact }
}
const page = 'export default function Page() { return <main data-testid="main">Hello</main> }'

describe('B07 bounded Next App Router', () => {
  it.each([
    ['app/page.tsx', '/', []],
    ['app/about/page.tsx', '/about', ['static']],
    ['src/app/dashboard/page.jsx', '/dashboard', ['static']],
    ['app/(marketing)/about/page.tsx', '/about', ['static']],
    ['app/blog/[slug]/page.tsx', '/blog/[slug]', ['static', 'dynamic']],
    ['app/shop/[...slug]/page.tsx', '/shop/[...slug]', ['static', 'catch-all']],
    ['app/shop/[[...slug]]/page.tsx', '/shop/[[...slug]]', ['static', 'optional-catch-all']],
    ['app/plain/page.js', '/plain', ['static']],
    ['src/app/plain/page.ts', '/plain', ['static']],
  ])('%s retains independent source convention evidence', (file, pattern, kinds) => {
    const { artifact, frontend } = fixture({ [file]: page })
    const route = artifact.routes[0]
    expect(route.id).toBe(`route:${pattern}`)
    expect(route.path).toBe(pattern)
    expect(route.declarations?.[0]).toMatchObject({ pattern, convention: 'app-page', status: 'supported', segmentKinds: kinds, sourceRef: { filePath: file } })
    expect(route.componentIds).toEqual(file.endsWith('.ts') ? [] : [frontend.files[0].components[0].id])
    expect(artifact.edges.some((e) => e.kind === 'route-serves-component')).toBe(!file.endsWith('.ts'))
    if (pattern.includes('[')) expect(route.warnings.some((w) => w.kind === 'dynamic-route')).toBe(true)
    expect(JSON.stringify(route)).not.toMatch(/authenticated|prerendered|server-rendered|passed/)
  })
  it.each(['layout', 'template', 'loading', 'error', 'not-found', 'default', 'metadata', 'config'])('%s is not a page', (name) => {
    expect(fixture({ [`app/${name}.tsx`]: page }).artifact.routes).toEqual([])
  })
  it.each(['app/_private/page.tsx', 'app/%5Fprivate/page.tsx', 'other/app/page.tsx'])('excludes %s', (file) => {
    expect(fixture({ [file]: page }).artifact.routes).toEqual([])
  })
  it.each(['app/@modal/page.tsx', 'app/(.)photo/page.tsx', 'app/(..)/photo/page.tsx'])('marks %s unsupported without component edges', (file) => {
    const { artifact } = fixture({ [file]: page })
    expect(artifact.routes[0].declarations?.[0].status).toBe('unsupported')
    expect(artifact.routes[0].warnings.some((w) => w.kind === 'unsupported-pattern')).toBe(true)
    expect(artifact.edges.filter((e) => e.kind === 'route-serves-component' || e.kind === 'route-reaches-ui')).toEqual([])
  })
  it('retains conflicting grouped pages without choosing ownership', () => {
    const { artifact } = fixture({ 'app/(marketing)/about/page.tsx': page, 'app/(shop)/about/page.tsx': page })
    expect(artifact.routes).toHaveLength(1)
    expect(artifact.routes[0].declarations?.map((d) => d.sourceRef.filePath)).toEqual(['app/(marketing)/about/page.tsx', 'app/(shop)/about/page.tsx'])
    expect(artifact.routes[0].componentIds).toEqual([])
    expect(artifact.routes[0].warnings.some((w) => w.kind === 'ambiguous-component-ownership')).toBe(true)
    expect(artifact.edges.filter((e) => e.kind === 'route-serves-component')).toEqual([])
  })
  it('observes exported HTTP implementations without creating a component', () => {
    const { artifact } = fixture({ 'app/api/items/route.ts': 'export async function GET() { return [] }; export const POST = () => 1; function DELETE(){}; export const PUT = runtime(); export { DELETE }; throw new Error("never execute")' })
    const route = artifact.routes[0]
    expect(route.kind).toBe('route-definition')
    expect(route.declarations?.[0]).toMatchObject({ convention: 'app-route-handler', methods: [{ method: 'GET', sourceRef: { filePath: 'app/api/items/route.ts', line: 1 } }, { method: 'POST' }] })
    expect(route.componentIds).toEqual([])
    expect(artifact.edges.filter((e) => e.kind === 'route-serves-component' || e.kind === 'route-reaches-ui')).toEqual([])
  })
  it('does not fabricate methods for unresolved exports', () => {
    const { artifact } = fixture({ 'app/api/route.js': 'export const GET = runtime(); export default function Route() { return <p/> }' })
    expect(artifact.routes[0].declarations?.[0].methods).toEqual([])
    expect(artifact.routes[0].componentIds).toEqual([])
    expect(artifact.routes[0].warnings.some((w) => w.kind === 'partial-extraction')).toBe(true)
  })
  it.each(['route.tsx','route.jsx'])('does not infer an HTTP convention from %s', (name) => {
    const {artifact} = fixture({[`app/api/${name}`]:'export function GET(){}'})
    expect(artifact.routes).toEqual([])
  })
  it('does not mistake a default export for a named HTTP export', () => {
    const { artifact } = fixture({ 'app/api/route.ts': 'export default function GET(){}' })
    expect(artifact.routes[0].declarations?.[0].methods).toEqual([])
    expect(artifact.routes[0].declarations?.[0].status).toBe('partial')
  })
  it('bounds observed HTTP declarations and labels incomplete evidence', () => {
    const { artifact, frontend } = fixture({ 'app/api/route.ts': 'export function GET(){};'.repeat(40) })
    expect(frontend.files[0].routeHandlerMethods).toHaveLength(32)
    expect(frontend.files[0].routeHandlerMethodsTruncated).toBe(true)
    expect(artifact.routes[0].declarations?.[0].methods).toHaveLength(32)
    expect(artifact.routes[0].declarations?.[0].status).toBe('partial')
    expect(artifact.routes[0].warnings.some((w) => w.kind === 'partial-extraction')).toBe(true)
  })
  it('does not choose an unrelated named component as page default', () => {
    const { artifact } = fixture({ 'app/page.tsx': 'export function Helper(){return <div/>}; export default runtime()' })
    expect(artifact.routes[0].componentIds).toEqual([])
  })
  it('preserves page, handler, navigation, and test provenance independently', () => {
    const { artifact } = fixture({ 'app/about/page.tsx': page, 'app/about/route.ts': 'export function GET(){}', 'src/Nav.tsx': 'export function Nav(){return <a href="/about">About</a>}', 'tests/nav.spec.ts': 'import {test} from "@playwright/test"; test("nav", async({page})=>{await page.goto("/about")})' })
    expect(artifact.routes).toHaveLength(1)
    expect(artifact.routes[0].id).toBe('route:/about')
    expect(artifact.routes[0].declarations?.map((d) => d.kind).sort()).toEqual(['link-target', 'page', 'route-definition', 'test-mentioned-route'].sort())
    expect(artifact.routes[0].testEvidenceRefs).toEqual([])
    expect(artifact.routes[0].declarations?.find((d) => d.convention === 'app-route-handler')?.componentId).toBeNull()
    expect(artifact.routes[0].componentIds).toHaveLength(1)
    expect(artifact.edges.filter((e) => e.kind === 'route-serves-component').map((e) => e.evidenceRefs.map((r) => r.filePath))).toEqual([['app/about/page.tsx']])
  })
  it('preserves Pages Router and JSX historical IDs', () => {
    const { artifact } = fixture({ 'pages/home/index.tsx': page, 'src/Nav.tsx': 'export function Nav(){return <a href="/login">Login</a>}' })
    expect(artifact.routes.map((r) => r.id)).toEqual(['route:/home', 'route:/login'])
  })
  it('bounds declarations, conflicts, methods and patterns with explicit truncation', () => {
    const files: Record<string, string> = {}
    for (let n = 0; n < 40; n++) files[`app/(group${n})/page.tsx`] = page
    const { artifact } = fixture(files)
    expect(artifact.routes[0].declarations).toHaveLength(32)
    expect(artifact.routes[0].sourceRefs).toHaveLength(32)
    expect(artifact.routes[0].declarationsTruncated).toBe(true)
    expect(artifact.routes[0].componentIds).toEqual([])
    expect(artifact.routes[0].warnings.find((w) => w.kind === 'ambiguous-component-ownership')?.message.match(/app\//g)).toHaveLength(20)
    const long = fixture({ [`app/${'segment/'.repeat(40)}/page.tsx`]: page }).artifact.routes[0]
    expect(long.path.length).toBe(256)
    expect(long.declarations?.[0].status).toBe('partial')
  })
  it('rebuilds full/incremental frontend artifacts with no stale test or route attribution', async () => {
    const { root } = fixture({ 'app/page.tsx': page, 'app/about/page.tsx': page, 'app/api/route.ts': 'export function GET(){}', 'tests/nav.spec.ts': 'import {test} from "@playwright/test"; test("nav", async({page})=>{await page.goto("/about")})', 'outside/app/page.tsx': page, 'app/schema.prisma': 'model User { id Int }', 'app/node_modules/ignored/page.tsx': page })
    const options = { root, src: ['app', 'tests'], out: 'inc', incremental: true }
    await runIndexCommand(options)
    const read = (out: string, file: string) => JSON.parse(fs.readFileSync(path.join(root, out, file), 'utf8'))
    const before = read('inc', 'frontend-reachability.json')
    expect(before.routes.map((r: {path:string}) => r.path)).toEqual(['/', '/about', '/api'])
    expect(before.routes.find((r: {path:string}) => r.path === '/about').testEvidenceRefs).toHaveLength(1)
    expect(read('inc', 'symbol-index.json').files.some((f: {path:string}) => f.path.endsWith('.prisma'))).toBe(false)
    fs.writeFileSync(path.join(root, 'app/api/route.ts'), 'export function POST(){}')
    fs.writeFileSync(path.join(root, 'app/page.tsx'), 'export const value=1')
    fs.writeFileSync(path.join(root, 'tests/nav.spec.ts'), 'import {test} from "@playwright/test"; test("nav", async({page})=>{await page.goto(variable)})')
    const changed = await runIndexCommand(options)
    expect(changed.mode === 'index' && changed.cache.mode).toBe('incremental-partial')
    await runIndexCommand({ ...options, out: 'full', incremental: false })
    for (const file of ['frontend-semantic.json', 'frontend-reachability.json']) {
      const a = read('inc', file), b = read('full', file)
      delete a.createdAt; delete b.createdAt; delete a.generatedAt; delete b.generatedAt
      expect(a).toEqual(b)
    }
    const after = read('inc', 'frontend-reachability.json')
    expect(after.routes.find((r: {path:string}) => r.path === '/').testEvidenceRefs).toEqual([])
    expect(after.routes.find((r: {path:string}) => r.path === '/').componentIds).toEqual([])
    expect(after.routes.find((r: {path:string}) => r.path === '/about').componentIds).toHaveLength(1)
    expect(after.routes.find((r: {path:string}) => r.path === '/about').testEvidenceRefs).toEqual([])
    expect(after.routes.find((r: {path:string}) => r.path === '/api').declarations[0].methods.map((m: {method:string}) => m.method)).toEqual(['POST'])
    const unchanged = await runIndexCommand(options)
    expect(unchanged.mode === 'index' && unchanged.cache.mode).toBe('incremental-no-change')
  })
})
