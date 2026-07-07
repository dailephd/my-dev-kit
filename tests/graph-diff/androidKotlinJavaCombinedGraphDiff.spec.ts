import { mkdtempSync, rmSync, cpSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

const MIXED_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'android', 'mixed-kotlin-java-app')
const tempDirs: string[] = []

function copyFixture(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-combined-graphdiff-${label}-`))
  tempDirs.push(root)
  cpSync(MIXED_FIXTURE, root, { recursive: true })
  return root
}

function indexInto(root: string, out: string) {
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

describe('Batch 5: graph-diff compatibility with mixed Kotlin/Java Android artifacts', () => {
  it('does not crash with android-project.json and android-components.json present on both sides', () => {
    const root = copyFixture('present')
    const before = indexInto(root, 'before')
    const after = indexInto(root, 'after')

    const result = runCli(['graph-diff', '--before', before, '--after', after, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed).not.toHaveProperty('androidComponents')
    expect(parsed).not.toHaveProperty('androidProject')
  })

  it('reports an added Java node and a changed Kotlin node together', () => {
    const root = copyFixture('mixed-change')
    const before = indexInto(root, 'before')

    writeFileSync(
      join(root, 'app/src/main/kotlin/com/example/MainActivity.kt'),
      'package com.example\n\nclass MainActivity {\n}\n'
    )
    writeFileSync(
      join(root, 'app/src/main/java/com/example/ExampleReceiver.java'),
      'package com.example;\n\nimport android.content.BroadcastReceiver;\n\npublic class ExampleReceiver extends BroadcastReceiver {\n}\n'
    )
    const after = indexInto(root, 'after')

    const result = runCli(['graph-diff', '--before', before, '--after', after, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    const addedIds: string[] = parsed.nodes.added.map((entry: { id: string }) => entry.id)
    expect(addedIds).toContain('symbol:app/src/main/java/com/example/ExampleReceiver.java#ExampleReceiver')

    const changedIds: string[] = parsed.nodes.changed.map((entry: { id: string }) => entry.id)
    expect(changedIds).toContain('symbol:app/src/main/kotlin/com/example/MainActivity.kt#MainActivity')
  })

  it('reports changed node metadata when Android role metadata changes on a Java node', () => {
    const root = copyFixture('role-change')
    const before = indexInto(root, 'before')

    writeFileSync(
      join(root, 'app/src/main/java/com/example/SyncWorker.java'),
      'package com.example;\n\npublic class SyncWorker {\n}\n'
    )
    const after = indexInto(root, 'after')

    const result = runCli(['graph-diff', '--before', before, '--after', after, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    const changedIds: string[] = parsed.nodes.changed.map((entry: { id: string }) => entry.id)
    expect(changedIds).toContain('symbol:app/src/main/java/com/example/SyncWorker.java#SyncWorker')
  })
})
