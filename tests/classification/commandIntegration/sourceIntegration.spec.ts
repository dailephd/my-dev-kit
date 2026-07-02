import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../../lookup/testCli.js'

const tempDirs: string[] = []

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-source-classification-'))
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

describe('source classification integration', () => {
  it('includes classification metadata for a classified symbol target (--node)', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)

    const result = runCli([
      'source',
      '--index',
      indexDir,
      '--node',
      'symbol:src/models.ts#User',
      '--max-lines',
      '80',
      '--format',
      'json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.classificationRoles).toEqual([expect.objectContaining({ role: 'canonical-type' })])
    expect(parsed.classificationRefs).toEqual([expect.objectContaining({ artifact: 'classification.json' })])
    expect(parsed.classificationSummary).toMatchObject({
      classifications: [expect.objectContaining({ role: 'canonical-type' })],
      editGuidance: expect.any(String),
      readiness: expect.any(String),
      uncertainty: expect.any(String),
    })
  })

  it('includes classification metadata for a classified symbol target (--file/--symbol)', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)

    const result = runCli([
      'source',
      '--index',
      indexDir,
      '--file',
      'src/models.ts',
      '--symbol',
      'User',
      '--max-lines',
      '80',
      '--format',
      'json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.classificationRoles).toEqual([expect.objectContaining({ role: 'canonical-type' })])
  })

  it('default plain console output includes a concise classification edit-guidance note', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)

    const result = runCli(['source', '--index', indexDir, '--node', 'symbol:src/models.ts#User', '--max-lines', '80'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Classification edit guidance:')
  })

  it('line-range retrieval still works and classification fields are simply absent (no symbol target)', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)

    const result = runCli([
      'source',
      '--index',
      indexDir,
      '--file',
      'src/models.ts',
      '--start',
      '1',
      '--end',
      '2',
      '--max-lines',
      '80',
      '--format',
      'json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.classificationRoles).toBeUndefined()
  })

  it('degrades gracefully when classification.json is missing', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    rmSync(join(indexDir, 'classification.json'))

    const result = runCli([
      'source',
      '--index',
      indexDir,
      '--node',
      'symbol:src/models.ts#User',
      '--max-lines',
      '80',
      '--format',
      'json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.classificationSummary).toBeNull()
    // Compact fields still present (live on the node/symbol object itself, not classification.json).
    expect(parsed.classificationRoles).toEqual([expect.objectContaining({ role: 'canonical-type' })])
  })

  it('existing semantic metadata propagation (semanticRoles/artifactRefs/evidenceRefs) remains compatible', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)

    const result = runCli([
      'source',
      '--index',
      indexDir,
      '--node',
      'symbol:src/models.ts#User',
      '--max-lines',
      '80',
      '--format',
      'json',
    ])
    const parsed = JSON.parse(result.stdout)

    expect(parsed.semanticRoles?.[0]).toMatchObject({ role: 'data-entity', subtype: 'canonical-type' })
    expect(parsed.evidenceRefs?.length).toBeGreaterThanOrEqual(1)
  })
})
