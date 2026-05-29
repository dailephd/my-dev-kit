import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from './testCli.js'

let outDir = ''

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-lookup-'))
  const result = runCli(['index', '--root', 'examples/basic-ts', '--src', 'src', '--out', outDir])
  expect(result.status).toBe(0)
})

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

describe('lookup command', () => {
  it('finds a file node and returns edges and neighbors', () => {
    const result = runCli(['lookup', '--index', outDir, '--node', 'file:src/index.ts', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.node.id).toBe('file:src/index.ts')
    expect(Array.isArray(parsed.incomingEdges)).toBe(true)
    expect(Array.isArray(parsed.outgoingEdges)).toBe(true)
    expect(parsed.neighbors.length).toBeGreaterThan(0)
  })

  it('finds a symbol node', () => {
    const result = runCli(['lookup', '--index', outDir, '--node', 'symbol:src/index.ts#describeUser', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.node.kind).toBe('symbol')
  })

  it('depth 0 returns only the node and no expanded neighbors', () => {
    const result = runCli(['lookup', '--index', outDir, '--node', 'file:src/index.ts', '--depth', '0', '--json'])
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).neighbors).toEqual([])
  })

  it('rejects depth greater than 3', () => {
    const result = runCli(['lookup', '--index', outDir, '--node', 'file:src/index.ts', '--depth', '4'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Depth greater than 3 is not supported.')
  })

  it('fails clearly for a missing node', () => {
    const result = runCli(['lookup', '--index', outDir, '--node', 'file:src/missing.ts'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Node not found')
  })
})
