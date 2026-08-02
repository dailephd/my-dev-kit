import { mkdtempSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'compose-retrieval', 'basic-app')
const tempDirs: string[] = []

function copyFixture(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-compose-context-${label}-`))
  tempDirs.push(root)
  cpSync(FIXTURE, root, { recursive: true })
  return root
}

function indexInto(root: string, out = 'out') {
  const result = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', out, '--json'])
  expect(result.status).toBe(0)
  return join(root, out)
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('v1.11.0 Batch 4: generic context integration for projected Compose evidence', () => {
  // TST-501
  it('selects a Compose composable as relevant context for a composable-shaped query, without a new context flag', () => {
    const root = copyFixture('composable-query')
    const index = indexInto(root)
    const capsuleOut = join(root, 'out', 'context-capsule.json')
    const auditOut = join(root, 'out', 'retrieval-audit-record.json')

    const result = runCli([
      'context',
      '--index',
      index,
      '--query',
      'Find the HomeScreen composable that shows the login button',
      '--out',
      capsuleOut,
      '--audit-out',
      auditOut,
      '--json',
    ])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(result.stdout)
    expect(JSON.stringify(capsule)).toContain('HomeScreen')

    // Bounded: no raw android-compose-semantic.json artifact dump inlined into the capsule.
    expect(capsule).not.toHaveProperty('androidComposeSemantic')
    expect(JSON.stringify(capsule)).not.toContain('"declarations"')
    expect(JSON.stringify(capsule)).not.toContain('"stateFacts"')
  })

  // TST-502
  it('remains fully compatible with an index built before Compose evidence existed (no Compose graph nodes)', () => {
    const root = copyFixture('non-compose-query')
    // Reuse the same fixture but query for something unrelated to Compose entirely,
    // to exercise the same context pipeline without relying on any Compose node.
    const index = indexInto(root)
    const capsuleOut = join(root, 'out', 'context-capsule.json')
    const result = runCli(['context', '--index', index, '--query', 'unrelated arbitrary text', '--out', capsuleOut, '--json'])
    expect(result.status).toBe(0)
    expect(() => JSON.parse(result.stdout)).not.toThrow()
  })
})
