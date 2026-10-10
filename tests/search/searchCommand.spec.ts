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

describe('search command --intent', () => {
  const stripTimestamp = (stdout: string) => {
    const parsed = JSON.parse(stdout)
    delete parsed.createdAt
    return parsed
  }

  it('explicit relevance intent matches omitted intent apart from the timestamp', () => {
    const omitted = runCli(['search', '--index', outDir, '--query', 'user', '--json'])
    const explicit = runCli(['search', '--index', outDir, '--query', 'user', '--intent', 'relevance', '--json'])
    expect(omitted.status).toBe(0)
    expect(explicit.status).toBe(0)
    expect(stripTimestamp(explicit.stdout)).toEqual(stripTimestamp(omitted.stdout))
    expect(stripTimestamp(omitted.stdout)).not.toHaveProperty('intent')
    expect(JSON.parse(omitted.stdout).results.every((item: object) => !('ownership' in item))).toBe(true)

    const omittedText = runCli(['search', '--index', outDir, '--query', 'user'])
    const explicitText = runCli(['search', '--index', outDir, '--query', 'user', '--intent', 'relevance'])
    expect(explicitText.stdout).toBe(omittedText.stdout)
    expect(omittedText.stdout).not.toContain('Intent:')
  })

  it('ownership intent returns intent metadata and per-result ownership evidence', () => {
    const relevance = JSON.parse(runCli(['search', '--index', outDir, '--query', 'user', '--limit', '100', '--json']).stdout)
    const result = runCli(['search', '--index', outDir, '--query', 'user', '--intent', 'ownership', '--limit', '100', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.artifactKind).toBe('my-dev-kit-v1-search-result')
    expect(parsed.version).toBe('1.0.0')
    expect(parsed.intent).toBe('ownership')
    expect(parsed.results.length).toBe(relevance.results.length)
    const scores = new Map<string, number>(relevance.results.map((item: { id: string; score: number }) => [item.id, item.score]))
    for (const item of parsed.results) {
      expect(['direct-owner', 'production-candidate', 'supporting-evidence']).toContain(item.ownership.tier)
      expect(item.ownership.lexicalScore).toBe(item.score)
      expect(item.score).toBe(scores.get(item.id))
      expect(Array.isArray(item.ownership.evidence)).toBe(true)
    }
  })

  it('ownership text output identifies the intent', () => {
    const result = runCli(['search', '--index', outDir, '--query', 'user', '--intent', 'ownership'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Intent: ownership')
    expect(result.stdout).toContain('   ownership: ')
  })

  it('ownership intent honors --limit validation', () => {
    const ok = runCli(['search', '--index', outDir, '--query', 'user', '--intent', 'ownership', '--limit', '2', '--json'])
    expect(ok.status).toBe(0)
    expect(JSON.parse(ok.stdout).results.length).toBeLessThanOrEqual(2)
    const bad = runCli(['search', '--index', outDir, '--query', 'user', '--intent', 'ownership', '--limit', '101'])
    expect(bad.status).toBe(2)
    expect(bad.stderr).toContain('--limit must be 100 or less')
  })

  it('rejects unknown and empty intent values', () => {
    const unknown = runCli(['search', '--index', outDir, '--query', 'user', '--intent', 'owner'])
    expect(unknown.status).toBe(2)
    expect(unknown.stderr).toContain('Invalid --intent value "owner"')
    const empty = runCli(['search', '--index', outDir, '--query', 'user', '--intent', ''])
    expect(empty.status).toBe(2)
    expect(empty.stderr).toContain('Invalid --intent value ""')
  })

  it('rejects intent without --query', () => {
    const result = runCli(['search', '--index', outDir, '--intent', 'ownership'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--intent requires --query')
  })

  it.each([
    ['--route', '/home'],
    ['--storage-key', 'draft.v1'],
    ['--ui', 'save-button'],
    ['--android-route', 'home'],
    ['--permission', 'android.permission.INTERNET'],
    ['--resource', 'string/app_name'],
    ['--android-component', 'MainActivity'],
    ['--composable', 'HomeScreen'],
    ['--test-tag', 'login_button'],
    ['--android-ui', 'Save'],
    ['--android-role', 'view-model'],
  ])('rejects intent combined with %s', (flag, value) => {
    const withQuery = runCli(['search', '--index', outDir, '--query', 'user', '--intent', 'ownership', flag, value])
    expect(withQuery.status).toBe(2)
    expect(withQuery.stderr).toContain('--intent is valid only with --query')
    const withoutQuery = runCli(['search', '--index', outDir, '--intent', 'ownership', flag, value])
    expect(withoutQuery.status).toBe(2)
    expect(withoutQuery.stderr).toContain('--intent is valid only with --query')
  })
})

function runCliFrom(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [tsxCliPath(), join(process.cwd(), 'src/cli.ts'), ...args], {
    cwd,
    encoding: 'utf8',
    shell: false,
  })
}
