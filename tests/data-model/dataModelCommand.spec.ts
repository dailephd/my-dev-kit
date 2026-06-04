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
  const root = mkdtempSync(join(tmpdir(), 'mdk-data-model-command-'))
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

describe('data-model command', () => {
  it('appears in top-level help and shows command flags in help output', () => {
    const topLevel = runCli(['--help'])
    const commandHelp = runCli(['data-model', '--help'])

    expect(topLevel.status).toBe(0)
    expect(topLevel.stdout).toContain('data-model')
    expect(topLevel.stdout).toContain('index')
    expect(commandHelp.status).toBe(0)
    expect(commandHelp.stdout).toContain('--index <dir>')
    expect(commandHelp.stdout).toContain('--out <dir>')
    expect(commandHelp.stdout).toContain('--json')
    expect(commandHelp.stdout).toContain('--entity <name-or-id>')
    expect(commandHelp.stdout).toContain('--field <entity.field>')
    expect(commandHelp.stdout).toContain('--trace-view [entity]')
  })

  it('fails clearly when --index is missing or both lookup flags are provided', () => {
    const missingIndex = runCli(['data-model'])
    const conflicting = runCli(['data-model', '--index', '.my-dev-kit-v1', '--entity', 'User', '--field', 'User.id'])

    expect(missingIndex.status).toBe(2)
    expect(missingIndex.stderr).toContain('The data-model command requires --index <dir>.')
    expect(conflicting.status).toBe(2)
    expect(conflicting.stderr).toContain('accepts either --entity or --field')
  })

  it('writes data-model artifacts and returns a compact JSON summary', async () => {
    const root = makeTempRepo()
    write(root, 'src/models.ts', 'export interface User { id: string; email?: string | null }\n')
    const indexDir = await buildIndexFixture(root)
    const outDir = join(root, 'data-model-out')

    const result = runCli(['data-model', '--index', indexDir, '--out', outDir, '--json'])

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('ok')
    expect(parsed.mode).toBe('generate')
    expect(parsed.entityCount).toBe(1)
    expect(parsed.fieldCount).toBe(2)
    expect(existsSync(join(outDir, 'data-model.json'))).toBe(true)
    expect(existsSync(join(outDir, 'data-model-graph.json'))).toBe(true)
    expect(existsSync(join(outDir, 'code-graph.json'))).toBe(false)
    expect(existsSync(join(outDir, 'model-view-lineage.json'))).toBe(false)
  })

  it('fails clearly for missing or invalid index paths', () => {
    const missing = runCli(['data-model', '--index', 'missing-dir', '--json'])
    const root = makeTempRepo()
    const invalidIndexDir = join(root, 'invalid-index')
    mkdirSync(invalidIndexDir, { recursive: true })
    writeFileSync(join(invalidIndexDir, 'manifest.json'), '{not-json', 'utf8')

    const invalid = runCli(['data-model', '--index', invalidIndexDir, '--json'])

    expect(missing.status).toBe(2)
    expect(missing.stderr).toContain('Missing index manifest')
    expect(invalid.status).toBe(2)
    expect(invalid.stderr).toContain('Invalid JSON in')
  })

  it('includes warning counts when unsupported patterns exist', async () => {
    const root = makeTempRepo()
    write(root, 'src/models.ts', 'export type WrappedUser = Partial<User>\nexport interface User { id: string }\n')
    const indexDir = await buildIndexFixture(root)

    const result = runCli(['data-model', '--index', indexDir, '--json'])
    const parsed = JSON.parse(result.stdout)

    expect(parsed.warningCount).toBeGreaterThan(0)
    expect(Array.isArray(parsed.warnings)).toBe(true)
  })

  it('supports exact entity lookup and exact field lookup from existing data-model artifacts', async () => {
    const root = makeTempRepo()
    write(root, 'src/models.ts', 'export interface User { id: string; email?: string | null }\n')
    const indexDir = await buildIndexFixture(root)

    const generate = runCli(['data-model', '--index', indexDir, '--json'])
    expect(generate.status).toBe(0)

    const entityResult = runCli(['data-model', '--index', indexDir, '--entity', 'User', '--json'])
    const fieldResult = runCli(['data-model', '--index', indexDir, '--field', 'User.email', '--json'])

    expect(entityResult.status).toBe(0)
    expect(JSON.parse(entityResult.stdout)).toMatchObject({
      status: 'ok',
      mode: 'entity',
      entity: { name: 'User' },
    })

    expect(fieldResult.status).toBe(0)
    expect(JSON.parse(fieldResult.stdout)).toMatchObject({
      status: 'ok',
      mode: 'field',
      entity: { name: 'User' },
      field: { name: 'email' },
    })
  })

  it('fails clearly when lookup artifacts or lookup targets are missing, and rejects malformed field selectors', async () => {
    const root = makeTempRepo()
    write(root, 'src/models.ts', 'export interface User { id: string }\n')
    const indexDir = await buildIndexFixture(root)

    const missingArtifacts = runCli(['data-model', '--index', indexDir, '--entity', 'User', '--json'])
    expect(missingArtifacts.status).toBe(2)
    expect(missingArtifacts.stderr).toContain('Missing required data-model.json')

    const generate = runCli(['data-model', '--index', indexDir, '--json'])
    expect(generate.status).toBe(0)

    const missingEntity = runCli(['data-model', '--index', indexDir, '--entity', 'Missing', '--json'])
    const missingField = runCli(['data-model', '--index', indexDir, '--field', 'User.email', '--json'])
    const malformedField = runCli(['data-model', '--index', indexDir, '--field', 'User', '--json'])

    expect(missingEntity.status).toBe(2)
    expect(missingEntity.stderr).toContain('Entity not found')
    expect(missingField.status).toBe(2)
    expect(missingField.stderr).toContain('Field not found: User.email')
    expect(malformedField.status).toBe(2)
    expect(malformedField.stderr).toContain('Field selector must use exact format Entity.field.')
  })

  it('does not implement fuzzy search in lookup mode', async () => {
    const root = makeTempRepo()
    write(root, 'src/models.ts', 'export interface User { id: string }\n')
    const indexDir = await buildIndexFixture(root)
    expect(runCli(['data-model', '--index', indexDir, '--json']).status).toBe(0)

    const fuzzyLike = runCli(['data-model', '--index', indexDir, '--entity', 'Use', '--json'])
    expect(fuzzyLike.status).toBe(2)
    expect(fuzzyLike.stderr).toContain('Entity not found: Use')
  })

  it('generation mode does not modify index artifacts and lookup mode reads existing artifacts', async () => {
    const root = makeTempRepo()
    write(root, 'src/models.ts', 'export interface User { id: string }\n')
    const indexDir = await buildIndexFixture(root)
    const beforeCodeGraph = readFileSync(join(indexDir, 'code-graph.json'), 'utf8')

    const generate = runCli(['data-model', '--index', indexDir, '--json'])
    expect(generate.status).toBe(0)
    expect(readFileSync(join(indexDir, 'code-graph.json'), 'utf8')).toBe(beforeCodeGraph)

    const lookup = runCli(['data-model', '--index', indexDir, '--entity', 'User', '--json'])
    expect(lookup.status).toBe(0)
    expect(existsSync(join(indexDir, 'model-view-lineage.json'))).toBe(false)
  })
})
