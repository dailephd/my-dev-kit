import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MODEL_VIEW_LINEAGE_ARTIFACT_KIND,
  MODEL_VIEW_LINEAGE_SCHEMA_VERSION,
  ensureModelViewLineagePathInsideOutputDir,
  readModelViewLineage,
  writeModelViewLineage,
  type ModelViewLineageArtifact,
} from '../../src/lineage/index.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function makeTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mdk-lineage-io-'))
  tempDirs.push(dir)
  return dir
}

function makeArtifact(): ModelViewLineageArtifact {
  return {
    artifactKind: MODEL_VIEW_LINEAGE_ARTIFACT_KIND,
    schemaVersion: MODEL_VIEW_LINEAGE_SCHEMA_VERSION,
    createdAt: '2026-06-04T00:00:00.000Z',
    nodes: [{
      id: 'lineage:data-field:field:User.email',
      kind: 'data-field',
      label: 'User.email',
      confidence: 'explicit',
      dataModelEntityId: 'entity:User',
      dataModelFieldId: 'field:User.email',
      evidenceRefs: [{ filePath: 'src/models.ts', dataModelFieldId: 'field:User.email', line: 2 }],
      warnings: [],
    }],
    edges: [],
    warnings: [],
    summary: {
      nodeCount: 1,
      edgeCount: 0,
      evidenceCount: 1,
      warningCount: 0,
    },
  }
}

describe('model-view-lineage artifact I/O', () => {
  it('writes and reads model-view-lineage.json', () => {
    const dir = makeTemp()
    const artifact = makeArtifact()
    const written = writeModelViewLineage({
      outputDir: dir,
      lineage: artifact,
    })

    expect(existsSync(written.modelViewLineagePath)).toBe(true)
    const loaded = readModelViewLineage(dir)
    expect(loaded.lineage).toEqual(artifact)
  })

  it('rejects missing, malformed, or wrong-kind lineage artifacts', () => {
    const dir = makeTemp()
    expect(() => readModelViewLineage(dir)).toThrow('Missing required model-view-lineage.json')

    writeFileSync(join(dir, 'model-view-lineage.json'), '{not-json', 'utf8')
    expect(() => readModelViewLineage(dir)).toThrow('Invalid JSON in model-view-lineage.json')

    writeFileSync(join(dir, 'model-view-lineage.json'), JSON.stringify({ artifactKind: 'wrong-kind' }), 'utf8')
    expect(() => readModelViewLineage(dir)).toThrow(`artifactKind must be ${MODEL_VIEW_LINEAGE_ARTIFACT_KIND}`)
  })

  it('enforces path containment', () => {
    const dir = makeTemp()
    expect(() => ensureModelViewLineagePathInsideOutputDir(dir, '../escape.json')).toThrow('escapes the artifact directory')
  })
})
