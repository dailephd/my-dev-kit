import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../../lookup/testCli.js'

const tempDirs: string[] = []

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-missing-classification-'))
  tempDirs.push(root)
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'models.ts'), 'export interface User {\n  id: string\n}\n')
  return root
}

/** Simulates an older index (pre-v1.5) or a classification analyzer that produced no artifact. */
function indexWithoutClassification(root: string): string {
  const result = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
  expect(result.status).toBe(0)
  const indexDir = join(root, '.my-dev-kit')
  rmSync(join(indexDir, 'classification.json'))
  return indexDir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('missing classification artifact graceful degradation (INV-004)', () => {
  it('search does not crash and returns valid JSON without classification.json', () => {
    const root = createFixture()
    const indexDir = indexWithoutClassification(root)

    const result = runCli(['search', '--index', indexDir, '--query', 'User', '--limit', '10', '--json'])
    expect(result.status).toBe(0)
    expect(() => JSON.parse(result.stdout)).not.toThrow()
  })

  it('lookup does not crash and returns valid JSON without classification.json', () => {
    const root = createFixture()
    const indexDir = indexWithoutClassification(root)

    const result = runCli(['lookup', '--index', indexDir, '--node', 'symbol:src/models.ts#User', '--depth', '1', '--json'])
    expect(result.status).toBe(0)
    expect(() => JSON.parse(result.stdout)).not.toThrow()
  })

  it('lookup --resolve-classification returns null (not an error) without classification.json', () => {
    const root = createFixture()
    const indexDir = indexWithoutClassification(root)

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
  })

  it('slice does not crash and returns valid JSON without classification.json', () => {
    const root = createFixture()
    const indexDir = indexWithoutClassification(root)

    const result = runCli([
      'slice',
      '--index',
      indexDir,
      '--node',
      'symbol:src/models.ts#User',
      '--depth',
      '1',
      '--direction',
      'both',
      '--json',
    ])
    expect(result.status).toBe(0)
    expect(() => JSON.parse(result.stdout)).not.toThrow()
  })

  it('source does not crash and reports classificationSummary as null without classification.json', () => {
    const root = createFixture()
    const indexDir = indexWithoutClassification(root)

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
  })

  it('manifest.json still references the classification analyzer even though the file is gone (stale-registry scenario)', () => {
    // This confirms the resolver's fs.existsSync guard, not just an absent manifest entry.
    const root = createFixture()
    const indexDir = indexWithoutClassification(root)
    const manifest = JSON.parse(readFileSync(join(indexDir, 'manifest.json'), 'utf8'))
    const analyzer = manifest.analyzers.find((entry: { id: string }) => entry.id === 'classification')
    expect(analyzer.artifacts[0].path).toBe('classification.json')

    const result = runCli(['lookup', '--index', indexDir, '--node', 'symbol:src/models.ts#User', '--depth', '1', '--json'])
    expect(result.status).toBe(0)
  })
})
