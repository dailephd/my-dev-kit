import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildDataModelArtifact,
  buildDataModelGraph,
  ensureDataModelArtifactPathInsideOutputDir,
  readDataModelArtifacts,
  writeDataModelArtifacts,
  type NormalizedDataModelRecordSet,
} from '../../src/data-model/index.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function makeTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mdk-data-model-'))
  tempDirs.push(dir)
  return dir
}

function makeArtifacts() {
  const records: NormalizedDataModelRecordSet = {
    entities: [
      {
        name: 'User',
        kind: 'canonical-model',
        sourceRefs: [{ filePath: 'src/models/user.ts', line: 1 }],
        warnings: [],
      },
    ],
    fields: [
      {
        entityName: 'User',
        fieldName: 'id',
        typeText: 'string',
        optional: false,
        nullable: false,
        cardinality: 'one',
        sourceRefs: [{ filePath: 'src/models/user.ts', line: 2 }],
        warnings: [],
      },
    ],
    relationships: [],
    warnings: [],
  }
  const dataModel = buildDataModelArtifact({
    records,
    createdAt: '2026-06-04T00:00:00.000Z',
  })
  const dataModelGraph = buildDataModelGraph({ artifact: dataModel })
  return { dataModel, dataModelGraph }
}

describe('data-model artifact I/O', () => {
  it('writes artifacts, creates the output directory, and returns expected summary counts', () => {
    const dir = join(makeTemp(), 'nested', 'artifacts')
    const { dataModel, dataModelGraph } = makeArtifacts()

    const result = writeDataModelArtifacts({
      outputDir: dir,
      dataModel,
      dataModelGraph,
    })

    expect(existsSync(result.dataModelPath)).toBe(true)
    expect(existsSync(result.dataModelGraphPath)).toBe(true)
    expect(result.entityCount).toBe(1)
    expect(result.fieldCount).toBe(1)
    expect(result.relationshipCount).toBe(0)
    expect(result.graphNodeCount).toBe(2)
    expect(result.graphEdgeCount).toBe(1)
  })

  it('writes parseable JSON and does not write manifest.json or code-graph.json', () => {
    const dir = makeTemp()
    const { dataModel, dataModelGraph } = makeArtifacts()

    const result = writeDataModelArtifacts({
      outputDir: dir,
      dataModel,
      dataModelGraph,
    })

    expect(JSON.parse(readFileSync(result.dataModelPath, 'utf8')).artifactKind).toBe('my-dev-kit-v1-data-model')
    expect(JSON.parse(readFileSync(result.dataModelGraphPath, 'utf8')).artifactKind).toBe('my-dev-kit-v1-data-model-graph')
    expect(existsSync(join(dir, 'manifest.json'))).toBe(false)
    expect(existsSync(join(dir, 'code-graph.json'))).toBe(false)
  })

  it('reads artifacts written by writeDataModelArtifacts', () => {
    const dir = makeTemp()
    const { dataModel, dataModelGraph } = makeArtifacts()

    writeDataModelArtifacts({
      outputDir: dir,
      dataModel,
      dataModelGraph,
    })

    const loaded = readDataModelArtifacts(dir)
    expect(loaded.dataModel).toEqual(dataModel)
    expect(loaded.dataModelGraph).toEqual(dataModelGraph)
  })

  it('fails clearly when data-model.json is missing', () => {
    const dir = makeTemp()
    const { dataModel, dataModelGraph } = makeArtifacts()

    const written = writeDataModelArtifacts({
      outputDir: dir,
      dataModel,
      dataModelGraph,
    })
    unlinkSync(written.dataModelPath)

    expect(() => readDataModelArtifacts(dir)).toThrow('Missing required data-model.json')
  })

  it('fails clearly when data-model-graph.json is missing', () => {
    const dir = makeTemp()
    const { dataModel, dataModelGraph } = makeArtifacts()

    const written = writeDataModelArtifacts({
      outputDir: dir,
      dataModel,
      dataModelGraph,
    })
    unlinkSync(written.dataModelGraphPath)

    expect(() => readDataModelArtifacts(dir)).toThrow('Missing required data-model-graph.json')
  })

  it('fails clearly when JSON is malformed', () => {
    const dir = makeTemp()
    writeFileSync(join(dir, 'data-model.json'), '{not-json', 'utf8')
    writeFileSync(join(dir, 'data-model-graph.json'), '{}', 'utf8')

    expect(() => readDataModelArtifacts(dir)).toThrow('Invalid JSON in data-model.json')
  })

  it('fails clearly when artifact kinds are wrong', () => {
    const dir = makeTemp()
    writeFileSync(join(dir, 'data-model.json'), JSON.stringify({ artifactKind: 'wrong-kind' }), 'utf8')
    writeFileSync(
      join(dir, 'data-model-graph.json'),
      JSON.stringify({ artifactKind: 'my-dev-kit-v1-data-model-graph' }),
      'utf8'
    )

    expect(() => readDataModelArtifacts(dir)).toThrow('artifactKind must be my-dev-kit-v1-data-model')
  })

  it('does not require code-graph.json, manifest.json, or source files', () => {
    const dir = makeTemp()
    const { dataModel, dataModelGraph } = makeArtifacts()

    writeDataModelArtifacts({
      outputDir: dir,
      dataModel,
      dataModelGraph,
    })

    expect(() => readDataModelArtifacts(dir)).not.toThrow()
    expect(existsSync(join(dir, 'code-graph.json'))).toBe(false)
    expect(existsSync(join(dir, 'manifest.json'))).toBe(false)
  })

  it('rejects path traversal attempts through the path helper', () => {
    const dir = makeTemp()
    expect(() => ensureDataModelArtifactPathInsideOutputDir(dir, '../escape.json')).toThrow('escapes the artifact directory')
  })

  it('rejects absolute path escape attempts through the path helper', () => {
    const dir = makeTemp()
    expect(() => ensureDataModelArtifactPathInsideOutputDir(dir, tmpdir())).toThrow('escapes the artifact directory')
  })

  it('supports nested output directories', () => {
    const dir = join(makeTemp(), 'a', 'b', 'c')
    const { dataModel, dataModelGraph } = makeArtifacts()

    const result = writeDataModelArtifacts({
      outputDir: dir,
      dataModel,
      dataModelGraph,
    })

    expect(result.outputDir).toContain('a')
    expect(existsSync(result.dataModelPath)).toBe(true)
  })
})
