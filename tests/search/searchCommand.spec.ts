import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli, tsxCliPath } from '../lookup/testCli.js'

let outDir = ''

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-search-'))
  const result = runCli(['index', '--root', 'examples/basic-ts', '--src', 'src', '--out', outDir])
  expect(result.status).toBe(0)
})

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
  rmSync(join(process.cwd(), 'examples/basic-ts/.my-dev-kit'), { recursive: true, force: true })
  rmSync(join(process.cwd(), 'examples/basic-ts/.my-dev-kit-v1'), { recursive: true, force: true })
})

describe('search command', () => {
  it('requires --query', () => {
    const result = runCli(['search', '--index', outDir])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('requires --query')
  })

  it('uses default --index when run from a fixture root', () => {
    const index = runCli(['index', '--root', 'examples/basic-ts', '--src', 'src'])
    expect(index.status).toBe(0)

    const result = runCliFrom(join(process.cwd(), 'examples/basic-ts'), ['search', '--query', 'describeUser', '--json'])
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).results.some((item: { id: string }) => item.id.includes('describeUser'))).toBe(true)
  })

  it('--json prints parseable JSON', () => {
    const result = runCli(['search', '--index', outDir, '--query', 'index', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.artifactKind).toBe('my-dev-kit-v1-search-result')
    expect(Array.isArray(parsed.results)).toBe(true)
  })

  it('--limit works', () => {
    const result = runCli(['search', '--index', outDir, '--query', 'user', '--limit', '2', '--json'])
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).results.length).toBeLessThanOrEqual(2)
  })

  it('invalid --limit fails', () => {
    const result = runCli(['search', '--index', outDir, '--query', 'user', '--limit', '0'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--limit must be a positive integer')
  })

  it('missing index directory fails clearly', () => {
    const result = runCli(['search', '--index', join(outDir, 'missing'), '--query', 'user'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Missing index manifest')
  })

  it('finds file and symbol results in the basic TypeScript example', () => {
    const fileSearch = runCli(['search', '--index', outDir, '--query', 'index', '--json'])
    expect(fileSearch.status).toBe(0)
    expect(JSON.parse(fileSearch.stdout).results.some((item: { kind: string }) => item.kind === 'file')).toBe(true)

    const symbolSearch = runCli(['search', '--index', outDir, '--query', 'service', '--json'])
    expect(symbolSearch.status).toBe(0)
    expect(JSON.parse(symbolSearch.stdout).results.some((item: { kind: string }) => item.kind === 'symbol')).toBe(true)
  })
})

function runCliFrom(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [tsxCliPath(), join(process.cwd(), 'src/cli.ts'), ...args], {
    cwd,
    encoding: 'utf8',
    shell: false,
  })
}
