import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { runCli } from '../lookup/testCli.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function makeTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'mdk-lineage-command-'))
  tempDirs.push(root)
  mkdirSync(join(root, 'src'), { recursive: true })
  return root
}

function write(root: string, relativePath: string, contents: string): void {
  const fullPath = join(root, relativePath)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, contents, 'utf8')
}

async function buildIndexFixture(root: string): Promise<string> {
  await runIndexCommand({
    root,
    src: ['src'],
    out: '.my-dev-kit-v1',
  })
  return join(root, '.my-dev-kit-v1')
}

describe('data-model trace-view command behavior', () => {
  it('returns compact entity trace JSON and writes model-view-lineage.json', async () => {
    const root = makeTempRepo()
    write(root, 'src/supported.tsx', readFixture('supported.tsx'))
    const indexDir = await buildIndexFixture(root)
    const outDir = join(root, 'trace-out')

    const result = runCli(['data-model', '--index', indexDir, '--out', outDir, '--trace-view', 'User', '--json'])
    expect(result.status).toBe(0)

    const parsed = JSON.parse(result.stdout)
    expect(parsed).toMatchObject({
      status: 'ok',
      mode: 'trace-entity',
      entity: { name: 'User' },
    })
    expect(parsed.lineageNodeCount).toBeGreaterThan(0)
    expect(parsed.lineageEdgeCount).toBeGreaterThan(0)
    expect(existsSync(join(outDir, 'model-view-lineage.json'))).toBe(true)
    expect(existsSync(join(outDir, 'code-graph.json'))).toBe(false)
  })

  it('returns compact field trace JSON for supported cases', async () => {
    const root = makeTempRepo()
    write(root, 'src/supported.tsx', readFixture('supported.tsx'))
    const indexDir = await buildIndexFixture(root)
    const outDir = join(root, 'trace-out')

    const result = runCli(['data-model', '--index', indexDir, '--out', outDir, '--field', 'User.email', '--trace-view', '--json'])
    expect(result.status).toBe(0)

    const parsed = JSON.parse(result.stdout)
    expect(parsed).toMatchObject({
      status: 'ok',
      mode: 'trace-field',
      entity: { name: 'User' },
      field: { name: 'email' },
    })
    expect(parsed.lineageNodeCount).toBeGreaterThan(0)
    expect(parsed.lineageEdgeCount).toBeGreaterThan(0)
  })

  it('returns warnings for unsupported lineage instead of guessed edges', async () => {
    const root = makeTempRepo()
    write(root, 'src/dynamic.tsx', readFixture('dynamic.tsx'))
    const indexDir = await buildIndexFixture(root)
    const outDir = join(root, 'trace-out')

    const result = runCli(['data-model', '--index', indexDir, '--out', outDir, '--trace-view', 'User', '--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.status).toBe(0)
    expect(parsed.warningCount).toBeGreaterThan(0)
    expect(parsed.warnings.some((warning: { kind: string }) => warning.kind === 'skipped-dynamic-pattern')).toBe(true)
  })

  it('fails clearly for missing entities, missing fields, malformed field selectors, and conflicting trace flags', async () => {
    const root = makeTempRepo()
    write(root, 'src/supported.tsx', readFixture('supported.tsx'))
    const indexDir = await buildIndexFixture(root)

    const missingEntity = runCli(['data-model', '--index', indexDir, '--trace-view', 'Missing', '--json'])
    const missingField = runCli(['data-model', '--index', indexDir, '--field', 'User.missing', '--trace-view', '--json'])
    const malformedField = runCli(['data-model', '--index', indexDir, '--field', 'User', '--trace-view', '--json'])
    const conflicting = runCli(['data-model', '--index', indexDir, '--entity', 'User', '--trace-view', 'User', '--json'])

    expect(missingEntity.status).toBe(2)
    expect(missingEntity.stderr).toContain('Entity not found: Missing')
    expect(missingField.status).toBe(2)
    expect(missingField.stderr).toContain('Field not found: User.missing')
    expect(malformedField.status).toBe(2)
    expect(malformedField.stderr).toContain('Field selector must use exact format Entity.field.')
    expect(conflicting.status).toBe(2)
    expect(conflicting.stderr).toContain('cannot combine --entity with --trace-view')
  })

  it('does not require Graphviz and existing generation and lookup behavior still work', async () => {
    const root = makeTempRepo()
    write(root, 'src/supported.tsx', readFixture('supported.tsx'))
    const indexDir = await buildIndexFixture(root)

    const generate = runCli(['data-model', '--index', indexDir, '--json'])
    const entityLookup = runCli(['data-model', '--index', indexDir, '--entity', 'User', '--json'])
    const fieldLookup = runCli(['data-model', '--index', indexDir, '--field', 'User.email', '--json'])

    expect(generate.status).toBe(0)
    expect(entityLookup.status).toBe(0)
    expect(fieldLookup.status).toBe(0)
  })
})

function readFixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests', 'fixtures', 'lineage', 'model-view-basic', name), 'utf8')
}
