import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../../lookup/testCli.js'

const tempDirs: string[] = []

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-lookup-classification-'))
  tempDirs.push(root)
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'models.ts'), 'export interface User {\n  id: string\n}\n')
  return root
}

function indexFixture(root: string): string {
  const result = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
  expect(result.status).toBe(0)
  return join(root, '.my-dev-kit')
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('lookup classification integration', () => {
  it('node output includes classificationRoles/classificationRefs for a classified node', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)

    const result = runCli(['lookup', '--index', indexDir, '--node', 'symbol:src/models.ts#User', '--depth', '1', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.classificationRoles).toEqual([
      expect.objectContaining({ role: 'canonical-type' }),
    ])
    expect(parsed.classificationRefs).toEqual([expect.objectContaining({ artifact: 'classification.json' })])
    expect(parsed.node.classificationRoles).toEqual(parsed.classificationRoles)
  })

  it('--resolve-classification resolves the full ClassificationEntry detail', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)

    const result = runCli([
      'lookup',
      '--index',
      indexDir,
      '--node',
      'symbol:src/models.ts#User',
      '--depth',
      '1',
      '--resolve-classification',
      '--json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.classificationDetail).toMatchObject({
      targetId: 'symbol:src/models.ts#User',
      targetKind: 'symbol',
      classifications: [expect.objectContaining({ role: 'canonical-type' })],
    })
    expect(parsed.classificationDetail.evidence.length).toBeGreaterThanOrEqual(1)
  })

  it('without --resolve-classification, classificationDetail is not present', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)

    const result = runCli(['lookup', '--index', indexDir, '--node', 'symbol:src/models.ts#User', '--depth', '1', '--json'])
    const parsed = JSON.parse(result.stdout)

    expect(parsed.classificationDetail).toBeUndefined()
  })

  it('degrades gracefully for an index without a classification artifact', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    rmSync(join(indexDir, 'classification.json'))

    const result = runCli([
      'lookup',
      '--index',
      indexDir,
      '--node',
      'symbol:src/models.ts#User',
      '--depth',
      '1',
      '--resolve-classification',
      '--json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.classificationDetail).toBeNull()
    // Compact fields survive independently since they live on the node object itself, not classification.json.
    expect(parsed.classificationRoles).toEqual([expect.objectContaining({ role: 'canonical-type' })])
  })

  it('existing semanticRoles/artifactRefs/evidenceRefs lookup behavior remains compatible', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)

    const result = runCli(['lookup', '--index', indexDir, '--node', 'symbol:src/models.ts#User', '--depth', '1', '--json'])
    const parsed = JSON.parse(result.stdout)

    expect(parsed.semanticRoles?.[0]).toMatchObject({ role: 'data-entity', subtype: 'canonical-type' })
    expect(parsed.artifactRefs?.[0]?.artifact).toBe('data-model.json')
  })
})
