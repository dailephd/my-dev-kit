import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'

// Shape of the Lab witness that made `index --src src/evaluation` and `--src src` fail with
// "Invalid framework route graph identity or endpoint.": one barrel file re-exporting the same target
// through `export type *`, `export {…} from` and an import. The fixture is generated; Lab is never read.
const tempDirs: string[] = []
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

const BARREL = [
  'export type * from "./manifestTypes.js";',
  'export type * from "./validateManifest.js";',
  'export { isSafe, validate } from "./validateManifest.js";',
  'export type * from "./verifyHashes.js";',
  'export { verify } from "./verifyHashes.js";',
  'export * from "./plain.js";',
  'export { plain } from "./plain.js";',
  'import { plain } from "./plain.js";',
  'export const usesPlain = plain;',
].join('\n') + '\n'

const FILES: Record<string, string> = {
  'src/evaluation/index.ts': BARREL,
  'src/evaluation/manifestTypes.ts': 'export interface Manifest { id: string }\n',
  'src/evaluation/validateManifest.ts': 'export function isSafe(): boolean { return true }\nexport function validate(): void {}\nexport type Validation = { ok: boolean }\n',
  'src/evaluation/verifyHashes.ts': 'export function verify(): void {}\nexport type Verified = boolean\n',
  'src/evaluation/plain.ts': 'export const plain = 1\n',
  'src/app/routes.py': "from fastapi import APIRouter\nrouter = APIRouter(prefix='/items')\n@router.get('/{item_id}')\nasync def item(item_id: int): return item_id\n",
  'src/consumer.ts': 'import { usesPlain } from "./evaluation/index.js"\nexport const c = usesPlain\n',
}

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v115-lab-root-index-'))
  tempDirs.push(root)
  for (const [rel, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), content)
  }
  return root
}
function listTree(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).replace(/\\/g, '/'))
    .sort()
}
const digest = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const readGraph = (out: string): CodeGraph => JSON.parse(readFileSync(join(out, 'code-graph.json'), 'utf8'))

describe('v1.15.0 KIT-FACTS-01 Lab-shaped source root indexing', () => {
  for (const src of [['src/evaluation'], ['src']]) {
    it(`indexes source root ${src.join(',')} with unique edge identities and valid endpoints`, async () => {
      const root = makeProject()
      const out = mkdtempSync(join(tmpdir(), 'my-dev-kit-v115-lab-root-out-'))
      tempDirs.push(out)
      const before = listTree(root)
      await runIndexCommand({ root, src, out })

      const graph = readGraph(out)
      const nodeIds = new Set(graph.nodes.map((node) => node.id))
      expect(nodeIds.size).toBe(graph.nodes.length)
      expect(new Set(graph.edges.map((edge) => edge.id)).size).toBe(graph.edges.length)
      expect(graph.edges.every((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))).toBe(true)

      const barrel = 'file:src/evaluation/index.ts'
      const edgesTo = (target: string) => graph.edges.filter((edge) => edge.source === barrel && edge.target === `file:src/evaluation/${target}`)
      // Every statement kind to the same target survives as its own edge; none is silently dropped.
      expect(edgesTo('validateManifest.ts').map((edge) => edge.label).sort()).toEqual(['export-all', 're-export'])
      expect(edgesTo('plain.ts').map((edge) => edge.label).sort()).toEqual(['export-all', 'import', 're-export'])
      expect(edgesTo('manifestTypes.ts').map((edge) => edge.id)).toEqual([`${barrel}--imports-->file:src/evaluation/manifestTypes.ts`])
      // Pairs that also have an import keep the historical identity on the import edge.
      const consumerEdge = graph.edges.find((edge) => edge.source === 'file:src/consumer.ts' && edge.label === 'import')
      if (src.includes('src')) expect(consumerEdge?.id).toBe('file:src/consumer.ts--imports-->file:src/evaluation/index.ts')

      // Generated output stays out of the inspected target.
      expect(listTree(root)).toEqual(before)
    }, 60_000)
  }

  it('keeps the historical import identity and does not drop a valid framework route', async () => {
    const root = makeProject()
    const out = mkdtempSync(join(tmpdir(), 'my-dev-kit-v115-lab-root-out-'))
    tempDirs.push(out)
    await runIndexCommand({ root, src: ['src'], out })
    const graph = readGraph(out)
    const importEdge = graph.edges.find((edge) => edge.source === 'file:src/evaluation/index.ts' && edge.target === 'file:src/evaluation/plain.ts' && edge.label === 'import')
    expect(importEdge?.id).toBe('file:src/evaluation/index.ts--imports-->file:src/evaluation/plain.ts')
    expect(graph.edges.filter((edge) => edge.id.endsWith('#re-export') || edge.id.endsWith('#export-all')).length).toBeGreaterThan(0)
    const routes = graph.nodes.filter((node) => node.kind === 'framework-route')
    expect(routes).toHaveLength(1)
    expect(graph.edges.some((edge) => edge.source === routes[0].id && edge.kind === 'framework-route-handled-by-symbol')).toBe(true)
  }, 60_000)

  it('produces byte-identical graph artifacts on repeated runs and never writes into the target', async () => {
    const root = makeProject()
    const treeBefore = new Map(listTree(root).map((path) => [path, digest(join(root, path))]))
    const outs = [0, 1].map(() => {
      const out = mkdtempSync(join(tmpdir(), 'my-dev-kit-v115-lab-root-out-'))
      tempDirs.push(out)
      return out
    })
    for (const out of outs) await runIndexCommand({ root, src: ['src'], out })
    const stable = (out: string) => { const { createdAt: _createdAt, ...rest } = readGraph(out) as CodeGraph & { createdAt?: string }; return JSON.stringify(rest) }
    expect(stable(outs[0])).toBe(stable(outs[1]))
    expect(digest(join(outs[0], 'source-audit-evidence.json'))).toBe(digest(join(outs[1], 'source-audit-evidence.json')))
    const treeAfter = new Map(listTree(root).map((path) => [path, digest(join(root, path))]))
    expect([...treeAfter]).toEqual([...treeBefore])
  }, 120_000)

  it('keeps validation active: a graph with duplicate framework-route node identities is still rejected', async () => {
    const { buildFrameworkRoutes } = await import('../../src/graph/buildFrameworkRoutes.js')
    const graph = { nodes: [{ id: 'file:a', kind: 'file', label: 'a' }, { id: 'file:a', kind: 'file', label: 'a' }], edges: [], summary: { nodeCount: 2, edgeCount: 0 } } as unknown as CodeGraph
    expect(() => buildFrameworkRoutes(graph, [])).toThrow('Invalid framework route graph identity or endpoint.')
    const dangling = { nodes: [{ id: 'file:a', kind: 'file', label: 'a' }], edges: [{ id: 'e', source: 'file:a', target: 'file:missing', kind: 'imports' }], summary: { nodeCount: 1, edgeCount: 1 } } as unknown as CodeGraph
    expect(() => buildFrameworkRoutes(dangling, [])).toThrow('Invalid framework route graph identity or endpoint.')
  })
})
