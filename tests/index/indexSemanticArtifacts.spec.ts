import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DataModelArtifact } from '../../src/data-model/types.js'
import type { IndexManifest } from '../../src/indexing/manifestTypes.js'
import { runCli } from '../lookup/testCli.js'

const tempDirs: string[] = []

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-index-semantic-artifacts-'))
  tempDirs.push(root)
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(
    join(src, 'models.ts'),
    [
      'export interface User {',
      '  id: string',
      '  name: string',
      '}',
      '',
      'export type UserSummary = Pick<User, "id" | "name">',
      '',
    ].join('\n')
  )
  writeFileSync(
    join(src, 'service.ts'),
    "import type { User } from './models'\nexport function formatUser(user: User): string { return user.name }\n"
  )
  return root
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('index semantic artifacts', () => {
  it('generates data-model artifacts from the primary index workflow', () => {
    const root = createFixture()
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
    expect(result.status).toBe(0)
    const indexDir = join(root, '.my-dev-kit')

    expect(existsSync(join(indexDir, 'data-model.json'))).toBe(true)
    expect(existsSync(join(indexDir, 'data-model-graph.json'))).toBe(true)

    const dataModel = readJson<DataModelArtifact>(join(indexDir, 'data-model.json'))
    expect(dataModel.entities.some((entity) => entity.id === 'entity:User')).toBe(true)
    expect(dataModel.summary.entityCount).toBeGreaterThanOrEqual(1)
  })

  it('records semantic artifact refs and analyzer status in manifest and JSON output', () => {
    const root = createFixture()
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
    expect(result.status).toBe(0)
    const indexDir = join(root, '.my-dev-kit')
    const output = JSON.parse(result.stdout) as {
      semanticArtifacts: { dataModelPath: string | null; dataModelGraphPath: string | null; modelViewLineagePath: string | null; frontendSemanticPath: string | null }
      analyzers: IndexManifest['analyzers']
    }
    const manifest = readJson<IndexManifest>(join(indexDir, 'manifest.json'))

    expect(manifest.semanticArtifacts).toMatchObject({
      dataModel: 'data-model.json',
      dataModelGraph: 'data-model-graph.json',
      modelViewLineage: null,
    })
    expect(manifest.analyzers?.find((analyzer) => analyzer.id === 'data-model')?.status).toMatch(/complete|partial/)
    expect(manifest.analyzers?.find((analyzer) => analyzer.id === 'model-view-lineage')?.status).toBe('not-run')
    expect(output.semanticArtifacts.dataModelPath).toContain('.my-dev-kit')
    expect(output.semanticArtifacts.dataModelGraphPath).toContain('.my-dev-kit')
    expect(output.semanticArtifacts.modelViewLineagePath).toBeNull()
    expect(output.analyzers?.find((analyzer) => analyzer.id === 'data-model')?.artifacts?.map((artifact) => artifact.path)).toEqual([
      'data-model.json',
      'data-model-graph.json',
    ])
  })

  it('does not write semantic artifacts during dry-run', () => {
    const root = createFixture()
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--dry-run', '--json'])

    expect(result.status).toBe(0)
    expect(existsSync(join(root, '.my-dev-kit', 'data-model.json'))).toBe(false)
    expect(existsSync(join(root, '.my-dev-kit', 'data-model-graph.json'))).toBe(false)
  })

  it('refreshes stale data-model artifacts during repeated indexing', () => {
    const root = createFixture()
    const first = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
    expect(first.status).toBe(0)
    const indexDir = join(root, '.my-dev-kit')
    writeFileSync(join(indexDir, 'data-model.json'), '{ stale data model', 'utf8')
    writeFileSync(join(indexDir, 'data-model-graph.json'), '{ stale data model graph', 'utf8')

    const second = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
    expect(second.status).toBe(0)

    const dataModel = readJson<DataModelArtifact>(join(indexDir, 'data-model.json'))
    expect(dataModel.artifactKind).toBe('my-dev-kit-v1-data-model')
    expect(JSON.parse(second.stdout).managedArtifacts.removed).toEqual(
      expect.arrayContaining(['data-model.json', 'data-model-graph.json'])
    )
  })

  it('keeps the focused data-model command compatible', () => {
    const root = createFixture()
    const index = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
    expect(index.status).toBe(0)

    const result = runCli(['data-model', '--index', join(root, '.my-dev-kit'), '--json'])
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'ok',
      mode: 'generate',
      entityCount: expect.any(Number),
    })
  })
})
