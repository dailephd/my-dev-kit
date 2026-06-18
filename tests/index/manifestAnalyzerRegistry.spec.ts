import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { IndexManifest } from '../../src/indexing/manifestTypes.js'
import { loadLookupArtifacts } from '../../src/indexing/loadIndexArtifacts.js'
import { readIndexManifest } from '../../src/indexing/readIndexManifest.js'
import { runCli } from '../lookup/testCli.js'

const tempDirs: string[] = []

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-analyzer-manifest-'))
  tempDirs.push(root)
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'types.ts'), 'export interface User { id: string; name: string }\n')
  writeFileSync(
    join(src, 'service.ts'),
    "import type { User } from './types'\nexport function formatUser(user: User): string { return user.name }\n"
  )
  return root
}

function indexFixture(root: string): string {
  const result = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
  expect(result.status).toBe(0)
  return join(root, '.my-dev-kit')
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('manifest analyzer registry', () => {
  it('records analyzer status without claiming lineage ran', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    const manifest = readJson<IndexManifest>(join(indexDir, 'manifest.json'))

    expect(manifest.analyzers?.find((analyzer) => analyzer.id === 'syntax')?.status).toBe('complete')
    expect(manifest.analyzers?.find((analyzer) => analyzer.id === 'call-graph')?.status).toBe('not-run')
    expect(manifest.analyzers?.find((analyzer) => analyzer.id === 'data-model')?.status).toMatch(/complete|partial/)
    expect(manifest.analyzers?.find((analyzer) => analyzer.id === 'model-view-lineage')?.status).toBe('not-run')
    expect(manifest.analyzers?.find((analyzer) => analyzer.id === 'frontend-semantic')?.status).toMatch(/complete|partial/)
    expect(manifest.semanticArtifacts).toMatchObject({
      dataModel: 'data-model.json',
      dataModelGraph: 'data-model-graph.json',
      modelViewLineage: null,
    })
  })

  it('can resolve manifest-referenced semantic artifact paths', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    const manifestPath = join(indexDir, 'manifest.json')
    const manifest = readJson<IndexManifest>(manifestPath)
    writeFileSync(join(indexDir, 'data-model.json'), '{"artifactKind":"my-dev-kit-v1-data-model"}\n')
    writeFileSync(join(indexDir, 'data-model-graph.json'), '{"artifactKind":"my-dev-kit-v1-data-model-graph"}\n')
    writeFileSync(join(indexDir, 'model-view-lineage.json'), '{"artifactKind":"my-dev-kit-v1-model-view-lineage"}\n')
    manifest.semanticArtifacts = {
      ...manifest.semanticArtifacts,
      dataModel: 'data-model.json',
      dataModelGraph: 'data-model-graph.json',
      modelViewLineage: 'model-view-lineage.json',
      frontendSemantic: null,
    }
    writeJson(manifestPath, manifest)

    const resolved = readIndexManifest(indexDir)

    expect(resolved.semanticArtifactPaths.dataModel).toBe(join(indexDir, 'data-model.json'))
    expect(resolved.semanticArtifactPaths.dataModelGraph).toBe(join(indexDir, 'data-model-graph.json'))
    expect(resolved.semanticArtifactPaths.modelViewLineage).toBe(join(indexDir, 'model-view-lineage.json'))
    expect(resolved.semanticArtifactPaths.frontendSemantic).toBeNull()
  })

  it('ignores stale semantic artifacts when manifest does not reference them', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    const manifestPath = join(indexDir, 'manifest.json')
    const manifest = readJson<IndexManifest>(manifestPath)
    manifest.semanticArtifacts = {
      dataModel: null,
      dataModelGraph: null,
      modelViewLineage: null,
      frontendSemantic: null,
    }
    writeJson(manifestPath, manifest)
    writeFileSync(join(indexDir, 'data-model.json'), '{ stale data model', 'utf8')
    writeFileSync(join(indexDir, 'data-model-graph.json'), '{ stale data model graph', 'utf8')
    writeFileSync(join(indexDir, 'model-view-lineage.json'), '{ stale lineage', 'utf8')

    const resolved = readIndexManifest(indexDir)
    expect(resolved.semanticArtifactPaths).toEqual({
      dataModel: null,
      dataModelGraph: null,
      modelViewLineage: null,
      frontendSemantic: null,
    })
    expect(() => loadLookupArtifacts(indexDir)).not.toThrow()
  })

  it('rejects semantic artifact paths that escape the index directory', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    const manifestPath = join(indexDir, 'manifest.json')
    const manifest = readJson<IndexManifest>(manifestPath)
    manifest.semanticArtifacts = {
      dataModel: '../data-model.json',
      dataModelGraph: null,
      modelViewLineage: null,
      frontendSemantic: null,
    }
    writeJson(manifestPath, manifest)

    expect(() => readIndexManifest(indexDir)).toThrow('escapes the index directory')
  })

  it('reads old manifests that do not include analyzer or semantic artifact sections', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    const manifestPath = join(indexDir, 'manifest.json')
    const manifest = readJson<Partial<IndexManifest>>(manifestPath)
    delete manifest.analyzers
    delete manifest.semanticArtifacts
    writeJson(manifestPath, manifest)

    const resolved = readIndexManifest(indexDir)

    expect(resolved.manifest.analyzers).toBeUndefined()
    expect(resolved.semanticArtifactPaths.dataModel).toBeNull()
    expect(existsSync(resolved.artifactPaths.codeGraph)).toBe(true)
  })

  it('keeps existing command consumers working when semantic artifacts are absent', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)

    const search = runCli(['search', '--index', indexDir, '--query', 'formatUser', '--json'])
    const lookup = runCli(['lookup', '--index', indexDir, '--node', 'file:src/service.ts', '--json'])
    const source = runCli(['source', '--index', indexDir, '--node', 'symbol:src/service.ts#formatUser', '--format', 'json'])
    const slice = runCli(['slice', '--index', indexDir, '--node', 'file:src/service.ts', '--json'])
    const view = runCli(['view', '--index', indexDir, '--format', 'dot', '--out', join(indexDir, 'graph.dot')])

    expect(search.status).toBe(0)
    expect(lookup.status).toBe(0)
    expect(source.status).toBe(0)
    expect(slice.status).toBe(0)
    expect(view.status).toBe(0)
  })
})
