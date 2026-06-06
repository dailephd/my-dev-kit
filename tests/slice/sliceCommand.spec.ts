import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

let outDir = ''
let sliceOut = ''

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-slice-index-'))
  sliceOut = join(outDir, 'slice.json')
  const result = runCli(['index', '--root', 'examples/basic-ts', '--src', 'src', '--out', outDir])
  expect(result.status).toBe(0)
})

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

describe('slice command', () => {
  it('requires --node', () => {
    const result = runCli(['slice', '--index', outDir])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('requires --node')
  })

  it('fails clearly for missing node', () => {
    const result = runCli(['slice', '--index', outDir, '--node', 'file:missing.ts'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Node not found')
  })

  it('rejects depth greater than 3 and negative depth', () => {
    expect(runCli(['slice', '--index', outDir, '--node', 'file:src/index.ts', '--depth', '4']).status).toBe(2)
    expect(runCli(['slice', '--index', outDir, '--node', 'file:src/index.ts', '--depth', '-1']).status).toBe(2)
  })

  it('writes --out file and prints valid JSON', () => {
    const result = runCli(['slice', '--index', outDir, '--node', 'file:src/index.ts', '--depth', '1', '--out', sliceOut, '--json'])
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).artifactKind).toBe('my-dev-kit-v1-graph-slice')
    expect(existsSync(sliceOut)).toBe(true)
    expect(JSON.parse(readFileSync(sliceOut, 'utf8')).focusNodeId).toBe('file:src/index.ts')
  })

  it('uses indexed artifacts and does not require Graphviz', () => {
    const result = runCli(['slice', '--index', outDir, '--node', 'file:src/index.ts', '--depth', '2', '--direction', 'both', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.summary.nodeCount).toBeGreaterThan(0)
    expect(parsed.artifactPaths.codeGraph).toContain('code-graph.json')
  })

  it('preserves semantic metadata for enriched nodes in JSON output', () => {
    const result = runCli(['slice', '--index', outDir, '--node', 'symbol:src/userTypes.ts#User', '--depth', '0', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    const node = parsed.nodes.find((candidate: { id: string }) => candidate.id === 'symbol:src/userTypes.ts#User')

    expect(node.kind).toBe('symbol')
    expect(node.semanticRoles?.[0]).toMatchObject({
      role: 'data-entity',
      subtype: 'canonical-type',
    })
    expect(node.artifactRefs?.[0]).toMatchObject({
      artifact: 'data-model.json',
      artifactKind: 'data-model',
      id: 'entity:User',
    })
    expect(JSON.stringify(parsed)).not.toContain('"fields"')
    expect(JSON.stringify(parsed)).not.toContain('"relationships"')
  })
})
