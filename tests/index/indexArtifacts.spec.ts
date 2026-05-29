import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let root = ''

function runCli(args: string[]) {
  return spawnSync(process.execPath, [tsxCliPath(), 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
  })
}

function tsxCliPath(): string {
  return join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-artifacts-'))
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'types.ts'), 'export interface User { id: string; name: string }\n')
  writeFileSync(
    join(src, 'service.ts'),
    "import type { User } from './types'\nexport function formatUser(user: User): string { return user.name }\n"
  )
  writeFileSync(
    join(src, 'index.ts'),
    "import { formatUser } from './service'\nimport type { User } from './types'\nexport function describeUser(user: User): string { return formatUser(user) }\n"
  )

  const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'artifacts'])
  expect(result.status).toBe(0)
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

function readJson(relativePath: string): any {
  return JSON.parse(readFileSync(join(root, 'artifacts', relativePath), 'utf8'))
}

describe('index artifacts', () => {
  it('manifest records expected contract fields', () => {
    const manifest = readJson('manifest.json')

    expect(manifest.artifactKind).toBe('my-dev-kit-v1-manifest')
    expect(manifest.projectRoot).toContain(root.replace(/\\/g, '/'))
    expect(manifest.sourceRoots).toEqual(['src'])
    expect(manifest.artifacts.symbolIndex).toBe('symbol-index.json')
    expect(manifest.artifacts.codeGraph).toBe('code-graph.json')
  })

  it('symbol-index.json has the expected top-level shape', () => {
    const symbolIndex = readJson('symbol-index.json')

    expect(symbolIndex.schemaVersion).toBe('2')
    expect(symbolIndex.fileCount).toBeGreaterThanOrEqual(2)
    expect(Array.isArray(symbolIndex.files)).toBe(true)
    expect(symbolIndex.graph).toBeDefined()
  })

  it('code-graph.json has deterministic file and symbol node IDs', () => {
    const codeGraph = readJson('code-graph.json')
    const nodeIds = codeGraph.nodes.map((node: { id: string }) => node.id)

    expect(codeGraph.artifactKind).toBe('code-graph')
    expect(nodeIds).toContain('file:src/index.ts')
    expect(nodeIds).toContain('file:src/service.ts')
    expect(nodeIds).toContain('symbol:src/index.ts#describeUser')
  })

  it('code-graph.json includes file nodes and at least one import edge', () => {
    const codeGraph = readJson('code-graph.json')

    expect(codeGraph.nodes.some((node: { kind: string }) => node.kind === 'file')).toBe(true)
    expect(codeGraph.edges.some((edge: { kind: string }) => edge.kind === 'imports')).toBe(true)
  })
})
