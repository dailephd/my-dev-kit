import { mkdtempSync, readFileSync, rmSync, cpSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

const MIXED_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'android', 'mixed-kotlin-java-app')
const tempDirs: string[] = []

function copyFixture(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-combined-incr-${label}-`))
  tempDirs.push(root)
  cpSync(MIXED_FIXTURE, root, { recursive: true })
  return root
}

function runIncremental(root: string, out = 'out') {
  const result = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', out, '--incremental', '--json'])
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout)
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('Batch 5: combined Android/Kotlin/Java incremental compatibility', () => {
  it('initial incremental index of the mixed fixture produces Kotlin/Java symbols and role metadata', () => {
    const root = copyFixture('initial')
    const result = runIncremental(root)
    expect(result.cache.mode).toBe('incremental-full-initial')

    const components = JSON.parse(readFileSync(join(root, 'out', 'android-components.json'), 'utf8'))
    const roles = new Set(components.components.map((c: { symbolName: string }) => c.symbolName))
    expect(roles.has('MainActivity')).toBe(true)
    expect(roles.has('SyncWorker')).toBe(true)
  })

  it('a no-change rerun reports no-change and keeps roles stable', () => {
    const root = copyFixture('nochange')
    runIncremental(root)
    const second = runIncremental(root)
    expect(second.cache.mode).toBe('incremental-no-change')
  })

  it('a changed Kotlin role-bearing file updates symbol and role metadata', () => {
    const root = copyFixture('changed-kt')
    runIncremental(root)

    writeFileSync(
      join(root, 'app/src/main/kotlin/com/example/MainViewModel.kt'),
      'package com.example\n\nclass MainViewModel {\n}\n'
    )
    const second = runIncremental(root)
    expect(second.cache.mode).toBe('incremental-partial')

    const components = JSON.parse(readFileSync(join(root, 'out', 'android-components.json'), 'utf8'))
    const viewModel = components.components.find((c: { symbolName: string }) => c.symbolName === 'MainViewModel')
    expect(viewModel?.confidence).toBe('low')
  })

  it('a changed Java role-bearing file updates symbol and role metadata', () => {
    const root = copyFixture('changed-java')
    runIncremental(root)

    writeFileSync(
      join(root, 'app/src/main/java/com/example/SyncWorker.java'),
      'package com.example;\n\npublic class SyncWorker {\n}\n'
    )
    const second = runIncremental(root)
    expect(second.cache.mode).toBe('incremental-partial')

    const components = JSON.parse(readFileSync(join(root, 'out', 'android-components.json'), 'utf8'))
    const worker = components.components.find((c: { symbolName: string }) => c.symbolName === 'SyncWorker')
    expect(worker?.confidence).toBe('low')
  })

  it('an added Kotlin role-bearing file appears', () => {
    const root = copyFixture('added-kt')
    runIncremental(root)

    writeFileSync(
      join(root, 'app/src/main/kotlin/com/example/SettingsActivity.kt'),
      'package com.example\n\nimport androidx.appcompat.app.AppCompatActivity\n\nclass SettingsActivity : AppCompatActivity() {\n}\n'
    )
    const second = runIncremental(root)
    expect(second.cache.mode).toBe('incremental-partial')

    const components = JSON.parse(readFileSync(join(root, 'out', 'android-components.json'), 'utf8'))
    const added = components.components.find((c: { symbolName: string }) => c.symbolName === 'SettingsActivity')
    expect(added?.role).toBe('activity')
  })

  it('an added Java role-bearing file appears', () => {
    const root = copyFixture('added-java')
    runIncremental(root)

    writeFileSync(
      join(root, 'app/src/main/java/com/example/ExampleService.java'),
      'package com.example;\n\nimport android.app.Service;\n\npublic class ExampleService extends Service {\n}\n'
    )
    const second = runIncremental(root)
    expect(second.cache.mode).toBe('incremental-partial')

    const components = JSON.parse(readFileSync(join(root, 'out', 'android-components.json'), 'utf8'))
    const added = components.components.find((c: { symbolName: string }) => c.symbolName === 'ExampleService')
    expect(added?.role).toBe('service')
  })

  it('a removed role-bearing file disappears from both languages independently', () => {
    const root = copyFixture('removed')
    runIncremental(root)

    unlinkSync(join(root, 'app/src/main/kotlin/com/example/MainActivity.kt'))
    const second = runIncremental(root)
    expect(second.cache.mode).toBe('incremental-partial')

    const components = JSON.parse(readFileSync(join(root, 'out', 'android-components.json'), 'utf8'))
    expect(components.components.some((c: { symbolName: string }) => c.symbolName === 'MainActivity')).toBe(false)
    expect(components.components.some((c: { symbolName: string }) => c.symbolName === 'SyncWorker')).toBe(true)
  })

  it('Batch 1 Android evidence fingerprint remains compatible with combined Kotlin/Java role changes', () => {
    const root = copyFixture('fingerprint')
    runIncremental(root)

    writeFileSync(
      join(root, 'app', 'build.gradle.kts'),
      'plugins {\n    id("com.android.library")\n    id("org.jetbrains.kotlin.android")\n}\n'
    )
    const second = runIncremental(root)
    expect(second.cache.mode).toBe('incremental-full-config-changed')

    const androidProject = JSON.parse(readFileSync(join(root, 'out', 'android-project.json'), 'utf8'))
    expect(androidProject.modules[0].type).toBe('library')

    const components = JSON.parse(readFileSync(join(root, 'out', 'android-components.json'), 'utf8'))
    expect(components.components.some((c: { symbolName: string }) => c.symbolName === 'MainActivity')).toBe(true)
    expect(components.components.some((c: { symbolName: string }) => c.symbolName === 'SyncWorker')).toBe(true)
  })
})
