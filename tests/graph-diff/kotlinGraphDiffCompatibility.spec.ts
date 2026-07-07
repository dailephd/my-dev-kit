import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, cpSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const KOTLIN_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'kotlin', 'basic')
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
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-kotlin-graphdiff-${label}-`))
  tempDirs.push(root)
  cpSync(KOTLIN_FIXTURE, root, { recursive: true })
  return root
}

function indexInto(root: string, out: string) {
  const result = runCli(['index', '--root', root, '--src', 'src', '--out', out, '--json'])
  expect(result.status).toBe(0)
  return join(root, out)
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('graph-diff Kotlin compatibility', () => {
  it('reports an added Kotlin file/symbol node with no Kotlin-specific special-casing needed', () => {
    const root = copyFixture('added')
    const before = indexInto(root, 'before')

    writeFileSync(join(root, 'src', 'Extra.kt'), 'package com.example.models\n\nclass ExtraThing\n')
    const after = indexInto(root, 'after')

    const result = runCli(['graph-diff', '--before', before, '--after', after, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.nodes.added.map((n: { id: string }) => n.id)).toEqual(
      expect.arrayContaining(['file:src/Extra.kt', 'symbol:src/Extra.kt#ExtraThing'])
    )
  })

  it('reports a changed Kotlin symbol node when its declaration line shifts', () => {
    const root = copyFixture('changed')
    const before = indexInto(root, 'before')

    writeFileSync(
      join(root, 'src', 'Extensions.kt'),
      '\npackage com.example.models\n\nfun toSlugRenamed(): String {\n    return ""\n}\n'
    )
    const after = indexInto(root, 'after')

    const result = runCli(['graph-diff', '--before', before, '--after', after, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.nodes.removed.some((n: { id: string }) => n.id === 'symbol:src/Extensions.kt#toSlug')).toBe(true)
    expect(parsed.nodes.added.some((n: { id: string }) => n.id === 'symbol:src/Extensions.kt#toSlugRenamed')).toBe(true)
  })
})
