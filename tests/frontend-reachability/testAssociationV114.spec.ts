import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { runFrontendAnalyzer } from '../../src/frontend/frontendAnalyzer.js'
import { runFrontendReachabilityAnalyzer } from '../../src/frontend-reachability/runFrontendReachabilityAnalyzer.js'
import { discoverTestInfrastructure } from '../../src/context/testInfrastructureDiscovery.js'
import { declarationNodeId, qualifiedDeclarationId } from '../../src/symbol-index/declarationIdentity.js'
import { buildReachabilityLookupResult } from '../../src/frontend-reachability/buildReachabilityLookupResult.js'
import { buildReachabilitySliceResult } from '../../src/frontend-reachability/buildReachabilitySliceResult.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'

const base = path.resolve('.my-dev-kit-workflow/tmp/v1.14.0-b07-20261020/tests')
function fixture(files: Record<string, string>) {
  fs.mkdirSync(base, { recursive: true })
  const root = fs.mkdtempSync(path.join(base, 'association-'))
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), content)
  }
  const index = { files: Object.keys(files).map((p) => ({ path: p })) } as SymbolIndex
  const frontend = runFrontendAnalyzer({ symbolIndex: index, repoRoot: root, createdAt: 'fixed' }).artifact
  const artifact = runFrontendReachabilityAnalyzer({ frontendArtifact: frontend, repoRoot: root, createdAt: 'fixed' }).artifact
  return { root, frontend, artifact }
}
const page = 'export default function Page(){return <main data-testid="login">Login</main>}'
const nav = (body: string) => `import {test,expect} from '@playwright/test'; test('login', async({page})=>{${body}})`
async function indexed(files: Record<string, string>) {
  const f = fixture(files)
  await runIndexCommand({ root: f.root, src: ['src', 'tests'], out: 'index' })
  const index: SymbolIndex = JSON.parse(fs.readFileSync(path.join(f.root, 'index/symbol-index.json'), 'utf8'))
  return { ...f, index }
}
function related(root: string, index: SymbolIndex, symbols: string[] = [], files: string[] = []) {
  return discoverTestInfrastructure({ repoRoot: root, symbolIndex: index, role: 'test-implementation', requestedEvidenceKinds: [], filesOfInterest: files, symbolsOfInterest: symbols })
}

describe('B07 static frontend associations', () => {
  it('associates a literal goto and a unique UI locator with an exact test block', () => {
    const { artifact, frontend } = fixture({ 'app/login/page.tsx': page, 'tests/navigation.spec.ts': nav('await page.goto("/login"); await page.getByTestId("login").click()') })
    const block = frontend.files.find((f) => f.isTestFile)!.testBlocks[0]
    expect(block.framework).toBe('playwright')
    expect(artifact.routes[0].testEvidenceRefs).toEqual([expect.objectContaining({ filePath: 'tests/navigation.spec.ts', testBlockId: block.id, locatorKind: 'goto', locatorValue: '/login' })])
    const ui = artifact.uiReachability.find((u) => u.markerKind === 'data-testid')!
    expect(ui.testEvidenceRefs[0]).toMatchObject({ testBlockId: block.id, locatorKind: 'getByTestId', testFramework: 'playwright' })
    expect(artifact.edges.some((e) => e.kind === 'test-covers-ui' && e.source === block.id && e.target === ui.id)).toBe(true)
    expect(JSON.stringify(artifact)).not.toMatch(/testPassed|executed|authenticated/)
    const lookup = buildReachabilityLookupResult(artifact, 'route', '/login')
    expect(lookup.facts[0]).toMatchObject({ declarations: [{ convention: 'app-page' }, { kind: 'test-mentioned-route' }], testEvidenceRefs: [expect.objectContaining({ testBlockId: block.id })] })
    const slice = buildReachabilitySliceResult(artifact, 'route', '/login', { includeTests: true })
    expect(slice.facts.routes[0]).toMatchObject({ testEvidenceRefs: [expect.objectContaining({ testBlockId: block.id })] })
  })
  it.each(['await page.goto(target)', 'await page.goto(`/login/${id}`)', 'expect("/login")', 'await other.goto("/login")'])('does not invent route association from %s', (body) => {
    expect(fixture({ 'app/login/page.tsx': page, 'tests/navigation.spec.ts': nav(body) }).artifact.routes.find((r) => r.path === '/login')!.testEvidenceRefs).toEqual([])
  })
  it('does not bind a concrete URL to a dynamic pattern', () => {
    const { artifact } = fixture({ 'app/blog/[slug]/page.tsx': page, 'tests/navigation.spec.ts': nav('await page.goto("/blog/123")') })
    expect(artifact.routes.find((r) => r.path === '/blog/[slug]')!.testEvidenceRefs).toEqual([])
    expect(artifact.routes.find((r) => r.path === '/blog/123')!.componentIds).toEqual([])
  })
  it('preserves historical goto syntax facts and subsequent frontend IDs', () => {
    const {frontend,artifact} = fixture({ 'app/login/page.tsx':page, 'tests/navigation.spec.ts':nav('await other.goto("/login"); await page.goto("/login")')+'; test("second",async({page})=>{await page.getByTestId("login").click()})' })
    const file = frontend.files.find((f) => f.isTestFile)!
    expect(file.routeStrings.map((r) => r.id)).toEqual(['route:tests/navigation.spec.ts#2','route:tests/navigation.spec.ts#3'])
    expect(file.routeStrings.map((r) => r.evidenceKind)).toEqual([undefined,'literal-goto'])
    expect(file.testBlocks.map((b) => b.id)).toEqual(['testblock:tests/navigation.spec.ts#1','testblock:tests/navigation.spec.ts#4'])
    expect(file.locators[0].id).toBe('locator:tests/navigation.spec.ts#5')
    expect(artifact.routes[0].testEvidenceRefs).toHaveLength(1)
  })
  it('keeps ambiguous marker evidence unlinked', () => {
    const { artifact } = fixture({ 'app/a/page.tsx': page, 'app/b/page.tsx': page, 'tests/navigation.spec.ts': nav('await page.getByTestId("login").click()') })
    expect(artifact.uiReachability.filter((u) => u.markerKind === 'data-testid').every((u) => u.testEvidenceRefs.length === 0 && u.warnings.some((w) => w.kind === 'ambiguous-component-ownership'))).toBe(true)
    expect(artifact.edges.filter((e) => e.kind === 'test-covers-ui')).toEqual([])
  })
  it('does not bind dynamic locators or setup fixtures to test blocks', () => {
    const { artifact } = fixture({ 'app/login/page.tsx': page, 'tests/navigation.spec.ts': nav('await page.getByTestId(marker).click()') + '; test.beforeEach(async({page})=>{await page.goto("/login")})' })
    expect(artifact.routes[0].testEvidenceRefs).toEqual([])
    expect(artifact.edges.filter((e) => e.kind === 'test-covers-ui')).toEqual([])
  })
  it('preserves React component, props, hooks, handlers, strings and local flow', () => {
    const { frontend } = fixture({ 'src/Panel.tsx': 'import {useState} from "react"; interface Props { title: string }; function Child({title}:Props){return <span>{title}</span>}; export function Panel({title}:Props){const [open,setOpen]=useState(false); function toggle(){setOpen(!open)}; return <button aria-label="Toggle" onClick={toggle}><Child title={title}/>{open && <b>Open</b>}</button>}' })
    const f = frontend.files[0]
    expect(f.components.map((c) => c.name)).toContain('Panel')
    expect(f.propTypes.map((p) => p.name)).toContain('Props')
    expect(f.hooks.some((h) => h.kind === 'useState')).toBe(true)
    expect(f.eventHandlers.length).toBeGreaterThan(0)
    expect(f.uiStrings.some((s) => s.value === 'Toggle')).toBe(true)
    expect(f.relationships.length).toBeGreaterThan(0)
  })
  it('bounds locator and route evidence explicitly', () => {
    const files: Record<string,string> = { 'app/login/page.tsx': page }
    for (let n=0;n<40;n++) files[`tests/t${n}.spec.ts`] = nav('await page.goto("/login"); await page.getByTestId("login").click()')
    const { artifact } = fixture(files)
    expect(artifact.routes[0].declarationsTruncated).toBe(true)
    const ui = artifact.uiReachability.find((u) => u.markerKind === 'data-testid')!
    expect(ui.testEvidenceRefs).toHaveLength(32)
    expect(ui.warnings.some((w) => w.kind === 'partial-extraction')).toBe(true)
  })
  it('records Vitest unique file and imported symbol evidence with exact IDs', async () => {
    const { root, index, frontend } = await indexed({ 'src/helper.ts': 'export function helper(){return 1}', 'tests/helper.test.ts': 'import {it} from "vitest"; import {helper as local} from "../src/helper"; it("works",()=>local())' })
    expect(frontend.files.find((f) => f.isTestFile)!.testBlocks[0].framework).toBe('vitest')
    const symbol = index.files.find((f) => f.path === 'src/helper.ts')!.symbols.find((s) => s.name === 'helper')!
    const exact = declarationNodeId('src/helper.ts', symbol)
    const result = related(root, index, [exact])
    expect(result.relatedTests.items[0]).toMatchObject({ path: 'tests/helper.test.ts', relationship: 'references-selected-production-symbol', basis: exact })
    const fileResult = related(root, index, [], ['src/helper.ts'])
    expect(fileResult.relatedTests.items[0].relationship).toBe('imports-selected-production-file')
  })
  it('preserves a qualified declaration ID and never substitutes a same-named member', async () => {
    const { root, index } = await indexed({ 'src/helper.ts': 'export function helper(){}', 'tests/helper.test.ts': 'import {helper} from "../src/helper"' })
    const symbol = index.files.find((f) => f.path === 'src/helper.ts')!.symbols[0]
    symbol.nodeId = qualifiedDeclarationId('src/helper.ts', '', 'helper', 0)
    expect(related(root, index, [symbol.nodeId]).relatedTests.items[0].basis).toBe('symbolq:src%2Fhelper.ts##helper#0')
    symbol.ownerKey = 'class:Other@1:0'; symbol.qualifiedName = 'Other.helper'; symbol.nodeId = qualifiedDeclarationId('src/helper.ts', symbol.ownerKey, 'helper', 0)
    delete symbol.qualifiedName
    const result = related(root, index, [symbol.nodeId])
    expect(result.relatedTests.items[0].relationship).toBe('imports-selected-production-file')
    expect(result.relatedTests.items[0].basis).toBe('src/helper.ts')
  })
  it.each(['import "../src/helper"', 'import helper from "../src/helper"'])('keeps %s file-related without fabricating an imported name', async (test) => {
    const {root,index} = await indexed({ 'src/helper.ts': 'export function helper(){}', 'tests/helper.test.ts': test })
    const result = related(root,index,['symbol:src/helper.ts#helper'])
    expect(result.relatedTests.items[0]).toMatchObject({ relationship:'imports-selected-production-file', basis:'src/helper.ts' })
  })
  it.each(['const x = import("../src/helper")', 'import {helper} from "../src/other"', '/* import {helper} from "../src/helper" */', '`import {helper} from "../src/helper"`'])('does not infer an imported symbol from %s', async (test) => {
    const { root, index } = await indexed({ 'src/helper.ts': 'export function helper(){}', 'src/other.ts': 'export function helper(){}', 'tests/helper.test.ts': test })
    expect(related(root, index, ['symbol:src/helper.ts#helper']).relatedTests.items).toEqual([])
  })
  it('does not choose among ambiguous extensionless physical sources', async () => {
    const { root, index } = await indexed({ 'src/helper.ts': 'export function helper(){}', 'src/helper.tsx': 'export function helper(){}', 'tests/helper.test.ts': 'import {helper} from "../src/helper"' })
    expect(related(root, index, ['symbol:src/helper.ts#helper'], ['src/helper.ts']).relatedTests.items).toEqual([])
  })
  it('does not choose among ambiguous NodeNext fallbacks', async () => {
    const { root, index } = await indexed({ 'src/helper.ts': 'export function helper(){}', 'src/helper.tsx': 'export function helper(){}', 'tests/helper.test.ts': 'import {helper} from "../src/helper.js"' })
    expect(related(root, index, ['symbol:src/helper.ts#helper'], ['src/helper.ts']).relatedTests.items).toEqual([])
  })
  it('keeps imports without a unique symbol at file granularity and preserves bounds', async () => {
    const tests: Record<string,string> = {}
    for (let n=0;n<21;n++) tests[`tests/t${n}.test.ts`] = 'import * as helpers from "../src/helper"'
    const { root, index } = await indexed({ 'src/helper.ts': 'export function helper(){}', ...tests })
    const r = discoverTestInfrastructure({ repoRoot: root, symbolIndex: index, role: 'test-implementation', requestedEvidenceKinds: [], filesOfInterest: [], symbolsOfInterest: ['symbol:src/helper.ts#helper'] })
    expect(r.relatedTests.items).toHaveLength(20)
    expect(r.relatedTests.items[0].relationship).toBe('imports-selected-production-file')
    expect(r.relatedTests.truncated).toBe(true)
  })
  it('invalidates a real B06 configuration fingerprint without changing cache schema', async () => {
    const { root } = fixture({ 'src/helper.ts': 'export const value=1', 'tests/helper.test.ts': 'import {value} from "../src/helper"' })
    const options = {root, src:['src','tests'], out:'index', incremental:true}
    const original = JSON.stringify
    let b06Fingerprint = ''
    JSON.stringify = ((value: unknown, ...args: unknown[]) => {
      if (value && typeof value === 'object' && 'frontendFrameworkRevision' in value) {
        const {frontendFrameworkRevision, ...b06} = value as Record<string, unknown>
        expect(frontendFrameworkRevision).toBe('v1.14.0-b07')
        b06Fingerprint = createHash('sha256').update(original(b06)).digest('hex')
      }
      return original(value, ...(args as []))
    }) as typeof JSON.stringify
    try { await runIndexCommand(options) } finally { JSON.stringify = original }
    const cachePath = path.join(root, 'index/cache-metadata.json')
    const cache = JSON.parse(fs.readFileSync(cachePath,'utf8'))
    expect(cache.cacheSchemaVersion).toBe('1.3.0')
    expect(b06Fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(cache.configFingerprint).not.toBe(b06Fingerprint)
    cache.configFingerprint = b06Fingerprint
    fs.writeFileSync(cachePath,JSON.stringify(cache))
    const result = await runIndexCommand(options)
    expect(result.mode === 'index' && result.cache.mode).toBe('incremental-full-config-changed')
  })
})
