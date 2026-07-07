import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, cpSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const KOTLIN_ANDROID_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'android', 'basic-kotlin-app')
const JAVA_ANDROID_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'android', 'basic-java-app')
const GENERATED_BUILD_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'android', 'generated-build-output')
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
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-android-components-incr-${label}-`))
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

describe('Android component role incremental compatibility', () => {
  it('initial --incremental run generates android-components.json', () => {
    const root = copyFixture(KOTLIN_ANDROID_FIXTURE, 'initial')
    const result = runIncremental(root, 'app/src/main')

    expect(result.cache.mode).toBe('incremental-full-initial')
    const components = JSON.parse(readFileSync(join(root, 'out', 'android-components.json'), 'utf8'))
    expect(components.components.some((c: { symbolName: string }) => c.symbolName === 'MainActivity')).toBe(true)
  })

  it('second run with no changes reports no-change and keeps roles stable', () => {
    const root = copyFixture(KOTLIN_ANDROID_FIXTURE, 'nochange')
    runIncremental(root, 'app/src/main')

    const second = runIncremental(root, 'app/src/main')
    expect(second.cache.mode).toBe('incremental-no-change')
    const components = JSON.parse(readFileSync(join(root, 'out', 'android-components.json'), 'utf8'))
    expect(components.components.some((c: { symbolName: string }) => c.symbolName === 'MainActivity')).toBe(true)
  })

  it('a changed Kotlin file updates role detection', () => {
    const root = copyFixture(KOTLIN_ANDROID_FIXTURE, 'changed-kt')
    runIncremental(root, 'app/src/main')

    writeFileSync(
      join(root, 'app/src/main/kotlin/com/example/UserRepository.kt'),
      'package com.example\n\nclass PlainRenamedClass {\n}\n'
    )
    const second = runIncremental(root, 'app/src/main')
    expect(second.cache.mode).toBe('incremental-partial')

    const components = JSON.parse(readFileSync(join(root, 'out', 'android-components.json'), 'utf8'))
    // The old symbol name is gone; the new symbol name is picked up under the
    // same file (which still carries a path-based 'repository' hint, so it
    // still gets a role, just via 'path' evidence rather than 'name').
    expect(components.components.some((c: { symbolName: string }) => c.symbolName === 'UserRepository')).toBe(false)
    const renamed = components.components.find((c: { symbolName: string }) => c.symbolName === 'PlainRenamedClass')
    expect(renamed?.evidence.map((e: { kind: string }) => e.kind)).toEqual(['path'])
  })

  it('a changed Java file updates role detection (confidence downgrades once the strong evidence is removed)', () => {
    const root = copyFixture(JAVA_ANDROID_FIXTURE, 'changed-java')
    runIncremental(root, 'app/src/main')
    const firstComponents = JSON.parse(readFileSync(join(root, 'out', 'android-components.json'), 'utf8'))
    expect(firstComponents.components.find((c: { symbolName: string }) => c.symbolName === 'SyncWorker').confidence).toBe('high')

    writeFileSync(
      join(root, 'app/src/main/java/com/example/SyncWorker.java'),
      'package com.example;\n\npublic class SyncWorker {\n}\n'
    )
    const second = runIncremental(root, 'app/src/main')
    expect(second.cache.mode).toBe('incremental-partial')

    const components = JSON.parse(readFileSync(join(root, 'out', 'android-components.json'), 'utf8'))
    const worker = components.components.find((c: { symbolName: string }) => c.symbolName === 'SyncWorker')
    expect(worker.confidence).toBe('low')
  })

  it('an added role-bearing file appears after incremental reindex', () => {
    const root = copyFixture(KOTLIN_ANDROID_FIXTURE, 'added')
    runIncremental(root, 'app/src/main')

    writeFileSync(
      join(root, 'app/src/main/kotlin/com/example/SettingsActivity.kt'),
      'package com.example\n\nimport androidx.appcompat.app.AppCompatActivity\n\nclass SettingsActivity : AppCompatActivity() {\n}\n'
    )
    const second = runIncremental(root, 'app/src/main')
    expect(second.cache.mode).toBe('incremental-partial')

    const components = JSON.parse(readFileSync(join(root, 'out', 'android-components.json'), 'utf8'))
    const added = components.components.find((c: { symbolName: string }) => c.symbolName === 'SettingsActivity')
    expect(added?.role).toBe('activity')
    expect(added?.confidence).toBe('high')
  })

  it('a removed role-bearing file disappears after incremental reindex', () => {
    const root = copyFixture(KOTLIN_ANDROID_FIXTURE, 'removed')
    runIncremental(root, 'app/src/main')

    unlinkSync(join(root, 'app/src/main/kotlin/com/example/MainViewModel.kt'))
    const second = runIncremental(root, 'app/src/main')
    expect(second.cache.mode).toBe('incremental-partial')

    const components = JSON.parse(readFileSync(join(root, 'out', 'android-components.json'), 'utf8'))
    expect(components.components.some((c: { symbolName: string }) => c.symbolName === 'MainViewModel')).toBe(false)
  })

  it('generated/build files do not create component roles (only the legitimate main-source-set file may)', () => {
    const root = copyFixture(GENERATED_BUILD_FIXTURE, 'generated')
    const result = runIncremental(root, 'app')
    expect(result.cache.mode).toBe('incremental-full-initial')

    const components = JSON.parse(readFileSync(join(root, 'out', 'android-components.json'), 'utf8'))
    expect(components.components.every((c: { filePath: string }) => !c.filePath.includes('/build/'))).toBe(true)
    expect(components.components.some((c: { symbolName: string }) => c.symbolName === 'GeneratedStray')).toBe(false)
  })

  it('Batch 1 androidEvidenceFingerprint remains compatible with component-role detection', () => {
    const root = copyFixture(KOTLIN_ANDROID_FIXTURE, 'fingerprint')
    runIncremental(root, 'app/src/main')

    writeFileSync(
      join(root, 'app', 'build.gradle.kts'),
      'plugins {\n    id("com.android.library")\n    id("org.jetbrains.kotlin.android")\n}\n'
    )
    const second = runIncremental(root, 'app/src/main')
    expect(second.cache.mode).toBe('incremental-full-config-changed')

    const androidProject = JSON.parse(readFileSync(join(root, 'out', 'android-project.json'), 'utf8'))
    expect(androidProject.modules[0].type).toBe('library')
    const components = JSON.parse(readFileSync(join(root, 'out', 'android-components.json'), 'utf8'))
    expect(components.components.some((c: { symbolName: string }) => c.symbolName === 'MainActivity')).toBe(true)
  })
})
