import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

let outDir = ''

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-source-semantic-'))
  const result = runCli(['index', '--root', 'examples/basic-ts', '--src', 'src', '--out', outDir])
  expect(result.status).toBe(0)
})

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

describe('source semantic metadata', () => {
  it('includes compact semantic evidence refs for an enriched symbol node in JSON output', () => {
    const result = runCli(['source', '--index', outDir, '--node', 'symbol:src/userTypes.ts#User', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.mode).toBe('node')
    expect(parsed.symbolName).toBe('User')
    expect(parsed.content).toContain('export interface User')
    expect(parsed.semanticRoles?.[0]).toMatchObject({
      role: 'data-entity',
      subtype: 'canonical-type',
    })
    expect(parsed.artifactRefs?.[0]).toMatchObject({
      artifact: 'data-model.json',
      artifactKind: 'data-model',
      id: 'entity:User',
    })
    expect(parsed.evidenceRefs?.[0]).toMatchObject({
      filePath: 'src/userTypes.ts',
      symbolId: 'symbol:src/userTypes.ts#User',
      line: 1,
    })
    expect(JSON.stringify(parsed)).not.toContain('"fields"')
    expect(JSON.stringify(parsed)).not.toContain('"relationships"')
  })

  it('keeps source output compatible for source without semantic metadata', () => {
    const result = runCli(['source', '--index', outDir, '--file', 'src/index.ts', '--symbol', 'describeUser', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.symbolName).toBe('describeUser')
    expect(parsed.semanticRoles).toBeUndefined()
    expect(parsed.artifactRefs).toBeUndefined()
    expect(parsed.evidenceRefs).toBeUndefined()
  })
})
