import { mkdtempSync, readFileSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

const MIXED_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'android', 'mixed-kotlin-java-app')
const tempDirs: string[] = []

function copyFixture(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-context-compat-${label}-`))
  tempDirs.push(root)
  cpSync(MIXED_FIXTURE, root, { recursive: true })
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

describe('Batch 5: context compatibility for mixed Kotlin/Java Android candidates', () => {
  it('selects a Kotlin ViewModel as a relevant candidate/focus for a ViewModel query', () => {
    const root = copyFixture('viewmodel')
    const index = indexInto(root)
    const capsuleOut = join(root, 'out', 'context-capsule.json')
    const auditOut = join(root, 'out', 'retrieval-audit-record.json')

    const result = runCli([
      'context', '--index', index, '--query', 'Find the Android ViewModel and repository involved in user loading',
      '--out', capsuleOut, '--audit-out', auditOut, '--json',
    ])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(result.stdout)

    const allEvidenceText = JSON.stringify(capsule.focus) + JSON.stringify(capsule.candidateFiles ?? capsule.candidates ?? [])
    expect(allEvidenceText).toContain('MainViewModel')

    // The capsule may reference the android-project.json artifact path (a compact
    // ref), but must not inline its full contents (e.g. its `modules` array).
    expect(capsule).not.toHaveProperty('androidProject')
    expect(JSON.stringify(capsule)).not.toContain('"modules"')
    const capsuleFile = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsuleFile).toBeTruthy()
    const auditFile = JSON.parse(readFileSync(auditOut, 'utf8'))
    expect(Array.isArray(auditFile.steps)).toBe(true)
    expect(auditFile.steps.length).toBeGreaterThan(0)
  })

  it('selects a Java Worker as a relevant candidate for a Worker query', () => {
    const root = copyFixture('worker')
    const index = indexInto(root)
    const capsuleOut = join(root, 'out', 'context-capsule.json')

    const result = runCli([
      'context', '--index', index, '--query', 'Find Java Worker source context', '--out', capsuleOut, '--json',
    ])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(result.stdout)
    expect(JSON.stringify(capsule)).toContain('SyncWorker')
  })

  it('keeps the capsule bounded: no raw graph dump and no inlined android-components.json', () => {
    const root = copyFixture('bounded')
    const index = indexInto(root)
    const capsuleOut = join(root, 'out', 'context-capsule.json')

    const result = runCli([
      'context', '--index', index, '--query', 'Find Kotlin Activity source context', '--out', capsuleOut, '--json',
    ])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(result.stdout)
    expect(capsule).not.toHaveProperty('nodes')
    expect(capsule).not.toHaveProperty('edges')
    const serialized = JSON.stringify(capsule)
    expect(serialized.length).toBeLessThan(40000)
  })
})
