import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../../lookup/testCli.js'

const tempDirs: string[] = []

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-search-classification-'))
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

describe('search classification integration', () => {
  it('result entries include a compact classification summary for classified targets', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)

    const result = runCli(['search', '--index', indexDir, '--query', 'User', '--limit', '10', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    const userItem = parsed.results.find((item: { id: string }) => item.id === 'symbol:src/models.ts#User')
    expect(userItem.classificationRoles).toEqual([
      expect.objectContaining({ role: 'canonical-type', editGuidance: expect.any(String) }),
    ])
    expect(userItem.classificationRefs).toEqual([expect.objectContaining({ artifact: 'classification.json' })])
  })

  it('matches classification role/edit-guidance terms as searchable fields', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)

    const result = runCli(['search', '--index', indexDir, '--query', 'canonical-type', '--limit', '10', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.results.some((item: { id: string }) => item.id === 'symbol:src/models.ts#User')).toBe(true)
  })

  it('remains stable and returns valid JSON when classification.json is missing', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    rmSync(join(indexDir, 'classification.json'))

    const result = runCli(['search', '--index', indexDir, '--query', 'User', '--limit', '10', '--json'])
    expect(result.status).toBe(0)
    expect(() => JSON.parse(result.stdout)).not.toThrow()
  })

  it('existing semantic search behavior remains unaffected (semanticRoles still present)', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)

    const result = runCli(['search', '--index', indexDir, '--query', 'User', '--limit', '10', '--json'])
    const parsed = JSON.parse(result.stdout)
    const userItem = parsed.results.find((item: { id: string }) => item.id === 'symbol:src/models.ts#User')

    expect(userItem.semanticRoles?.[0]).toMatchObject({ role: 'data-entity', subtype: 'canonical-type' })
  })
})
