import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { buildDataModelFromIndex } from '../../src/data-model/index.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function makeTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'mdk-data-model-index-'))
  tempDirs.push(root)
  mkdirSync(join(root, 'src'), { recursive: true })
  return root
}

function write(root: string, relativePath: string, contents: string): void {
  const fullPath = join(root, relativePath)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, contents, 'utf8')
}

describe('buildDataModelFromIndex', () => {
  it('builds in-memory data-model and data-model-graph artifacts from a small indexed TypeScript fixture', async () => {
    const root = makeTempRepo()
    write(root, 'src/models.ts', 'export interface User { id: string; email?: string | null }\nexport type Session = { id: string }\n')

    await runIndexCommand({
      root,
      src: ['src'],
      out: '.my-dev-kit-v1',
    })

    const result = buildDataModelFromIndex({
      indexDir: join(root, '.my-dev-kit-v1'),
    })

    expect(result.candidateFiles).toEqual(['src/models.ts'])
    expect(result.dataModel.entities.map((entity) => entity.name)).toEqual(['Session', 'User'])
    expect(result.dataModel.summary.entityCount).toBe(2)
    expect(result.dataModelGraph.summary.entityNodeCount).toBe(2)
    expect(result.dataModelGraph.summary.fieldNodeCount).toBe(3)
    expect(result.dataModel.entities[0]?.sourceRefs[0]?.filePath).toBe('src/models.ts')
    expect(result.dataModel.relationships).toEqual([])
    expect(existsSync(join(root, '.my-dev-kit-v1', 'data-model.json'))).toBe(false)
    expect(existsSync(join(root, '.my-dev-kit-v1', 'data-model-graph.json'))).toBe(false)
    expect(JSON.parse(readFileSync(join(root, '.my-dev-kit-v1', 'code-graph.json'), 'utf8')).artifactKind).toBe('code-graph')
  })

  it('preserves warnings and remains conservative for mixed supported and unsupported files', async () => {
    const root = makeTempRepo()
    write(root, 'src/models.ts', 'export interface User { id: string }\n')
    write(root, 'src/unsupported.ts', 'export type WrappedUser = Partial<User>\nexport function createUser() { return { id: \"1\" } }\n')

    await runIndexCommand({
      root,
      src: ['src'],
      out: '.my-dev-kit-v1',
    })

    const first = buildDataModelFromIndex({
      indexDir: join(root, '.my-dev-kit-v1'),
    })
    const second = buildDataModelFromIndex({
      indexDir: join(root, '.my-dev-kit-v1'),
    })

    expect(first.dataModel.entities.map((entity) => entity.name)).toEqual(['User'])
    expect(first.warnings.map((warning) => warning.kind)).toEqual([
      'skipped-dynamic-pattern',
      'unsupported-pattern',
    ])
    expect(first.dataModel.relationships).toEqual([])
    expect(second).toEqual(first)
  })

  it('returns valid empty artifacts when the index contains no model-like TypeScript files', async () => {
    const root = makeTempRepo()
    write(root, 'src/index.ts', 'export function add(a: number, b: number) { return a + b }\n')

    await runIndexCommand({
      root,
      src: ['src'],
      out: '.my-dev-kit-v1',
    })

    const result = buildDataModelFromIndex({
      indexDir: join(root, '.my-dev-kit-v1'),
    })

    expect(result.candidateFiles).toEqual([])
    expect(result.dataModel.summary.entityCount).toBe(0)
    expect(result.dataModelGraph.summary.nodeCount).toBe(0)
    expect(result.warnings).toEqual([])
  })

  it('reports missing indexed source files and rejects invalid index artifacts clearly', async () => {
    const root = makeTempRepo()
    write(root, 'src/models.ts', 'export interface User { id: string }\n')

    await runIndexCommand({
      root,
      src: ['src'],
      out: '.my-dev-kit-v1',
    })

    rmSync(join(root, 'src', 'models.ts'))
    const missingResult = buildDataModelFromIndex({
      indexDir: join(root, '.my-dev-kit-v1'),
    })
    expect(missingResult.warnings[0]?.kind).toBe('missing-source')
    expect(missingResult.dataModel.summary.entityCount).toBe(0)

    const badIndexDir = join(root, 'bad-index')
    mkdirSync(badIndexDir, { recursive: true })
    writeFileSync(join(badIndexDir, 'manifest.json'), '{not-json', 'utf8')

    expect(() => buildDataModelFromIndex({ indexDir: badIndexDir })).toThrow('Invalid JSON in')
  })
})
