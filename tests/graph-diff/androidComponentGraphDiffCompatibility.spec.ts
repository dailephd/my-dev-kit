import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, cpSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const KOTLIN_ANDROID_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'android', 'basic-kotlin-app')
const tempDirs: string[] = []

function runCli(args: string[]) {
  return spawnSync(process.execPath, [tsxCliPath(), 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
  })
}

function tsxCliPath(): string {
  return join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
}

function copyFixture(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-android-components-graphdiff-${label}-`))
  tempDirs.push(root)
  cpSync(KOTLIN_ANDROID_FIXTURE, root, { recursive: true })
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

describe('graph-diff Android component-role compatibility', () => {
  it('does not crash with android-components.json present and reports no dedicated Android-component section', () => {
    const root = copyFixture('present')
    const before = indexInto(root, 'before')
    const after = indexInto(root, 'after')

    const result = runCli(['graph-diff', '--before', before, '--after', after, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed).not.toHaveProperty('androidComponents')
  })

  it('reports a role-bearing symbol node as changed when its androidComponentRoles metadata changes', () => {
    const root = copyFixture('changed-role')
    const before = indexInto(root, 'before')

    writeFileSync(
      join(root, 'app/src/main/kotlin/com/example/MainViewModel.kt'),
      'package com.example\n\nclass MainViewModel {\n}\n'
    )
    const after = indexInto(root, 'after')

    const result = runCli(['graph-diff', '--before', before, '--after', after, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    const changedIds: string[] = parsed.nodes.changed.map((entry: { id: string }) => entry.id)
    expect(changedIds).toContain('symbol:app/src/main/kotlin/com/example/MainViewModel.kt#MainViewModel')
  })
})
