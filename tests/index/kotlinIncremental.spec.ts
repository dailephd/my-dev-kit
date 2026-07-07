import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, cpSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const KOTLIN_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'kotlin', 'basic')
const ANDROID_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'android', 'basic-kotlin-app')
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

function copyFixture(source: string, label: string): string {
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-kotlin-incr-${label}-`))
  tempDirs.push(root)
  cpSync(source, root, { recursive: true })
  return root
}

function runIncremental(root: string, src: string, out = 'out') {
  const result = runCli(['index', '--root', root, '--src', src, '--out', out, '--incremental', '--json'])
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout)
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('Kotlin indexing + incremental compatibility', () => {
  it('initial --incremental run indexes Kotlin files', () => {
    const root = copyFixture(KOTLIN_FIXTURE, 'initial')
    const result = runIncremental(root, 'src')

    expect(result.cache.mode).toBe('incremental-full-initial')
    const symbolIndex = JSON.parse(readFileSync(join(root, 'out', 'symbol-index.json'), 'utf8'))
    expect(symbolIndex.files.some((f: { path: string }) => f.path === 'src/Models.kt')).toBe(true)
  })

  it('second run with no changes reports no-change', () => {
    const root = copyFixture(KOTLIN_FIXTURE, 'nochange')
    runIncremental(root, 'src')

    const second = runIncremental(root, 'src')
    expect(second.cache.mode).toBe('incremental-no-change')
  })

  it('a changed Kotlin file updates symbol-index/code-graph', () => {
    const root = copyFixture(KOTLIN_FIXTURE, 'changed')
    runIncremental(root, 'src')

    writeFileSync(join(root, 'src', 'Extensions.kt'), 'package com.example.models\n\nfun renamedSlug(): String = ""\n')
    const second = runIncremental(root, 'src')

    expect(second.cache.mode).toBe('incremental-partial')
    const symbolIndex = JSON.parse(readFileSync(join(root, 'out', 'symbol-index.json'), 'utf8'))
    const extFile = symbolIndex.files.find((f: { path: string }) => f.path === 'src/Extensions.kt')
    expect(extFile.symbols.map((s: { name: string }) => s.name)).toEqual(['renamedSlug'])
  })

  it('an added Kotlin file appears after incremental reindex', () => {
    const root = copyFixture(KOTLIN_FIXTURE, 'added')
    runIncremental(root, 'src')

    writeFileSync(join(root, 'src', 'Extra.kt'), 'package com.example.models\n\nclass ExtraThing\n')
    const second = runIncremental(root, 'src')

    expect(second.cache.mode).toBe('incremental-partial')
    const symbolIndex = JSON.parse(readFileSync(join(root, 'out', 'symbol-index.json'), 'utf8'))
    expect(symbolIndex.files.some((f: { path: string }) => f.path === 'src/Extra.kt')).toBe(true)
    const codeGraph = JSON.parse(readFileSync(join(root, 'out', 'code-graph.json'), 'utf8'))
    expect(codeGraph.nodes.some((n: { id: string }) => n.id === 'symbol:src/Extra.kt#ExtraThing')).toBe(true)
  })

  it('a removed Kotlin file disappears after incremental reindex', () => {
    const root = copyFixture(KOTLIN_FIXTURE, 'removed')
    runIncremental(root, 'src')

    unlinkSync(join(root, 'src', 'Extensions.kt'))
    const second = runIncremental(root, 'src')

    expect(second.cache.mode).toBe('incremental-partial')
    const symbolIndex = JSON.parse(readFileSync(join(root, 'out', 'symbol-index.json'), 'utf8'))
    expect(symbolIndex.files.some((f: { path: string }) => f.path === 'src/Extensions.kt')).toBe(false)
    const codeGraph = JSON.parse(readFileSync(join(root, 'out', 'code-graph.json'), 'utf8'))
    expect(codeGraph.nodes.some((n: { id: string }) => n.id === 'file:src/Extensions.kt')).toBe(false)
  })

  it('generated/build Kotlin files stay ignored across incremental runs', () => {
    const root = copyFixture(join(process.cwd(), 'tests', 'fixtures', 'android', 'generated-build-output'), 'generated-incr')
    const first = runIncremental(root, 'app')
    expect(first.cache.mode).toBe('incremental-full-initial')

    const cacheMetadata = JSON.parse(readFileSync(join(root, 'out', 'cache-metadata.json'), 'utf8'))
    expect(cacheMetadata.files.some((f: { path: string }) => f.path.includes('/build/'))).toBe(false)

    const second = runIncremental(root, 'app')
    expect(second.cache.mode).toBe('incremental-no-change')
  })

  it('Android evidence fingerprint from Batch 1 still works alongside Kotlin indexing', () => {
    const root = copyFixture(ANDROID_FIXTURE, 'android-fingerprint')
    runIncremental(root, 'app/src/main')

    writeFileSync(
      join(root, 'app', 'build.gradle.kts'),
      'plugins {\n    id("com.android.library")\n    id("org.jetbrains.kotlin.android")\n}\n'
    )
    const second = runIncremental(root, 'app/src/main')

    expect(second.cache.mode).toBe('incremental-full-config-changed')
    const androidProject = JSON.parse(readFileSync(join(root, 'out', 'android-project.json'), 'utf8'))
    expect(androidProject.modules[0].type).toBe('library')
    // Kotlin symbol indexing is unaffected by the Android-evidence-driven full rebuild.
    const symbolIndex = JSON.parse(readFileSync(join(root, 'out', 'symbol-index.json'), 'utf8'))
    expect(symbolIndex.files.some((f: { path: string }) => f.path.endsWith('MainActivity.kt'))).toBe(true)
  })
})
