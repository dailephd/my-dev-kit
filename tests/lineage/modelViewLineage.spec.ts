import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import {
  buildDataModelFromIndex,
  type DataModelArtifact,
} from '../../src/data-model/index.js'
import { buildModelViewLineage } from '../../src/lineage/index.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function makeTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'mdk-lineage-'))
  tempDirs.push(root)
  mkdirSync(join(root, 'src'), { recursive: true })
  return root
}

function copyFixture(root: string, fixtureName: string): void {
  const source = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'lineage', 'model-view-basic', fixtureName), 'utf8')
  writeFileSync(join(root, 'src', fixtureName), source, 'utf8')
}

async function buildIndexedDataModel(root: string): Promise<{ indexDir: string; dataModel: DataModelArtifact }> {
  await runIndexCommand({
    root,
    src: ['src'],
    out: '.my-dev-kit-v1',
  })
  const indexDir = join(root, '.my-dev-kit-v1')
  const built = buildDataModelFromIndex({ indexDir })
  return { indexDir, dataModel: built.dataModel }
}

describe('buildModelViewLineage', () => {
  it('builds an empty lineage artifact for an empty data model', () => {
    const emptyDataModel: DataModelArtifact = {
      artifactKind: 'my-dev-kit-v1-data-model',
      schemaVersion: '1.1.0',
      createdAt: '2026-06-04T00:00:00.000Z',
      entities: [],
      relationships: [],
      warnings: [],
      summary: {
        entityCount: 0,
        fieldCount: 0,
        relationshipCount: 0,
        warningCount: 0,
      },
    }

    const result = buildModelViewLineage({
      dataModel: emptyDataModel,
      sourceFiles: [],
    })

    expect(result.artifact.summary.nodeCount).toBe(0)
    expect(result.artifact.summary.edgeCount).toBe(0)
  })

  it('traces direct transformation usage, derived view-model fields, component props, and direct rendered fields', async () => {
    const root = makeTempRepo()
    copyFixture(root, 'supported.tsx')
    const { indexDir, dataModel } = await buildIndexedDataModel(root)
    const original = JSON.parse(JSON.stringify(dataModel))

    const result = buildModelViewLineage({
      dataModel,
      indexDir,
    })

    expect(result.artifact.nodes.some((node) => node.kind === 'transformation' && node.label === 'buildUserViewModel')).toBe(true)
    expect(result.artifact.nodes.some((node) => node.kind === 'view-model' && node.label === 'buildUserViewModel.email')).toBe(true)
    expect(result.artifact.nodes.some((node) => node.kind === 'component-prop' && node.label === 'UserCard.email')).toBe(true)
    expect(result.artifact.nodes.some((node) => node.kind === 'rendered-field' && node.label.includes('userViewModel.displayName'))).toBe(true)
    expect(result.artifact.edges.some((edge) => edge.kind === 'reads-field')).toBe(true)
    expect(result.artifact.edges.some((edge) => edge.kind === 'creates-view-model')).toBe(true)
    expect(result.artifact.edges.some((edge) => edge.kind === 'passes-prop')).toBe(true)
    expect(result.artifact.edges.some((edge) => edge.kind === 'renders-field')).toBe(true)
    expect(result.artifact.nodes.flatMap((node) => node.evidenceRefs).every((ref) => !!ref.filePath)).toBe(true)
    expect(result.artifact.warnings).toEqual([])
    expect(dataModel).toEqual(original)
  })

  it('emits warnings for dynamic property access and unresolved spread props without guessed edges', async () => {
    const dynamicRoot = makeTempRepo()
    copyFixture(dynamicRoot, 'dynamic.tsx')
    const dynamicBuilt = await buildIndexedDataModel(dynamicRoot)
    const dynamicResult = buildModelViewLineage({
      dataModel: dynamicBuilt.dataModel,
      indexDir: dynamicBuilt.indexDir,
    })

    expect(dynamicResult.artifact.warnings.some((warning) => warning.kind === 'skipped-dynamic-pattern')).toBe(true)
    expect(dynamicResult.artifact.edges.some((edge) => edge.kind === 'passes-prop')).toBe(false)

    const spreadRoot = makeTempRepo()
    copyFixture(spreadRoot, 'spread.tsx')
    const spreadBuilt = await buildIndexedDataModel(spreadRoot)
    const spreadResult = buildModelViewLineage({
      dataModel: spreadBuilt.dataModel,
      indexDir: spreadBuilt.indexDir,
    })

    expect(spreadResult.artifact.warnings.some((warning) => warning.kind === 'partial-lineage')).toBe(true)
    expect(spreadResult.artifact.edges.some((edge) => edge.kind === 'passes-prop')).toBe(false)
  })

  it('remains deterministic and does not claim route-level or runtime-only lineage', async () => {
    const root = makeTempRepo()
    copyFixture(root, 'supported.tsx')
    const { indexDir, dataModel } = await buildIndexedDataModel(root)

    const first = buildModelViewLineage({
      dataModel,
      indexDir,
    })
    const second = buildModelViewLineage({
      dataModel,
      indexDir,
    })

    expect(second).toEqual(first)
    expect(first.artifact.nodes.some((node) => node.label.toLowerCase().includes('route'))).toBe(false)
    expect(first.artifact.nodes.some((node) => node.label.toLowerCase().includes('runtime'))).toBe(false)
  })
})
