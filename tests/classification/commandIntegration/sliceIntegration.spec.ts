import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../../lookup/testCli.js'

const tempDirs: string[] = []

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-slice-classification-'))
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

describe('slice classification integration', () => {
  it('TST-052 (resolved): slice preserves classificationRoles/classificationRefs on classified nodes', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)

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
    const parsed = JSON.parse(result.stdout)

    const userNode = parsed.nodes.find((node: { id: string }) => node.id === 'symbol:src/models.ts#User')
    expect(userNode.classificationRoles).toEqual([expect.objectContaining({ role: 'canonical-type' })])
    expect(userNode.classificationRefs).toEqual([expect.objectContaining({ artifact: 'classification.json' })])
  })

  it('does not duplicate the entire detailed classification artifact in slice output', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)

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
    const parsed = JSON.parse(result.stdout)
    const userNode = parsed.nodes.find((node: { id: string }) => node.id === 'symbol:src/models.ts#User')

    // Only the compact ClassificationRoleRef projection (role/editGuidance/readiness/
    // uncertainty) is present - no `evidence`, `sourceRefs`, or `reason` fields from
    // the full ClassificationEntry/ClassificationRole shapes used in classification.json.
    expect(userNode.classificationRoles[0]).toEqual({
      role: 'canonical-type',
      editGuidance: 'inspect-before-edit',
      readiness: 'ready',
      uncertainty: 'certain',
    })
    expect(userNode).not.toHaveProperty('classificationEvidence')
    expect(userNode).not.toHaveProperty('classificationEntries')
  })

  it('slice output remains deterministic across repeated runs', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)

    const first = runCli([
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
    const second = runCli([
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

    const firstParsed = JSON.parse(first.stdout)
    const secondParsed = JSON.parse(second.stdout)
    expect(secondParsed.nodes).toEqual(firstParsed.nodes)
  })

  it('existing semantic metadata preservation (semanticRoles/artifactRefs) remains compatible', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)

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
    const parsed = JSON.parse(result.stdout)
    const userNode = parsed.nodes.find((node: { id: string }) => node.id === 'symbol:src/models.ts#User')

    expect(userNode.semanticRoles?.[0]).toMatchObject({ role: 'data-entity', subtype: 'canonical-type' })
  })

  it('degrades gracefully for an index without a classification artifact', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    rmSync(join(indexDir, 'classification.json'))

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
})
