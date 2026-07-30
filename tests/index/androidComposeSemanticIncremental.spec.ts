import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, cpSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const FIXTURES_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android-compose-semantic')
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

function copyFixture(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-compose-semantic-incr-${name}-`))
  tempDirs.push(root)
  cpSync(join(FIXTURES_ROOT, name), root, { recursive: true })
  return root
}

function runIndex(root: string, out: string, extra: string[] = []) {
  const result = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', out, '--json', ...extra])
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout)
}

function runIncremental(root: string, out: string) {
  return runIndex(root, out, ['--incremental'])
}

function readArtifact(root: string, out: string, filename: string) {
  return JSON.parse(readFileSync(join(root, out, filename), 'utf8'))
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('android-compose-semantic.json manifest registration and stale cleanup', () => {
  // TST-022
  it('a full index run generates android-compose-semantic.json and registers it in manifest.json', () => {
    const root = copyFixture('basic-app')
    const result = runIndex(root, 'out')

    expect(result.androidComposeSemanticPath).toBeTruthy()
    expect(existsSync(join(root, 'out', 'android-compose-semantic.json'))).toBe(true)

    const manifest = readArtifact(root, 'out', 'manifest.json')
    const analyzer = manifest.analyzers.find((a: { id: string }) => a.id === 'android-compose-semantic')
    expect(analyzer).toBeTruthy()
    expect(analyzer.status).toBe('complete')
    expect(analyzer.artifacts[0].path).toBe('android-compose-semantic.json')

    const artifact = readArtifact(root, 'out', 'android-compose-semantic.json')
    expect(artifact.detected).toBe(true)
    expect(artifact.declarations.length).toBeGreaterThan(0)
    const names = artifact.declarations.map((d: { name: string }) => d.name)
    expect(names).toEqual(expect.arrayContaining(['HomeScreen', 'Greeting', 'HomeScreenPreview']))
    expect(names).not.toContain('helperNotComposable')

    // No Batch 2-6 fields appear on this greenfield artifact.
    expect(artifact).not.toHaveProperty('stateReferences')
    expect(artifact).not.toHaveProperty('effects')
    expect(artifact).not.toHaveProperty('viewModelReferences')

    // Existing Android navigation artifact behavior is unaffected.
    expect(existsSync(join(root, 'out', 'android-navigation.json'))).toBe(false)
    const navAnalyzer = manifest.analyzers.find((a: { id: string }) => a.id === 'android-navigation')
    expect(navAnalyzer?.status).toBe('skipped')
  })

  // TST-021
  it('an Android project with no supported Compose declarations does not register a misleading artifact', () => {
    const root = copyFixture('no-compose-app')
    const result = runIndex(root, 'out')

    expect(result.androidComposeSemanticPath).toBeNull()
    expect(existsSync(join(root, 'out', 'android-compose-semantic.json'))).toBe(false)
    const manifest = readArtifact(root, 'out', 'manifest.json')
    const analyzer = manifest.analyzers.find((a: { id: string }) => a.id === 'android-compose-semantic')
    expect(analyzer?.status).toBe('skipped')
    expect(analyzer?.artifacts).toEqual([])
  })

  // TST-027
  it('removing the last supported Compose declaration removes the stale artifact', () => {
    const root = copyFixture('basic-app')
    runIndex(root, 'out')
    expect(existsSync(join(root, 'out', 'android-compose-semantic.json'))).toBe(true)

    writeFileSync(
      join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'Screens.kt'),
      'package com.example\n\nprivate fun helperNotComposable(): Int = 1\n'
    )

    const result = runIndex(root, 'out')
    expect(result.androidComposeSemanticPath).toBeNull()
    expect(existsSync(join(root, 'out', 'android-compose-semantic.json'))).toBe(false)
    const manifest = readArtifact(root, 'out', 'manifest.json')
    expect(manifest.analyzers.find((a: { id: string }) => a.id === 'android-compose-semantic')?.status).toBe('skipped')
  })
})

describe('android-compose-semantic.json incremental indexing integration', () => {
  // TST-025 (initial)
  it('initial --incremental run produces android-compose-semantic.json', () => {
    const root = copyFixture('basic-app')
    const result = runIncremental(root, 'out')

    expect(result.cache.mode).toBe('incremental-full-initial')
    expect(result.androidComposeSemanticPath).toBeTruthy()
  })

  // TST-028
  it('second --incremental run with only a no-op re-run keeps android-compose-semantic.json correct', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-no-change')
    const artifact = readArtifact(root, 'out', 'android-compose-semantic.json')
    expect(artifact.detected).toBe(true)
  })

  // TST-025 (add)
  it('adding a new Compose declaration invalidates via the normal Kotlin changed-file path and refreshes the artifact', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')
    const before = readArtifact(root, 'out', 'android-compose-semantic.json')
    const beforeCount = before.declarations.length

    writeFileSync(
      join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'Extra.kt'),
      'package com.example\n\nimport androidx.compose.runtime.Composable\n\n@Composable\nfun ExtraScreen() {}\n'
    )

    runIncremental(root, 'out')
    const after = readArtifact(root, 'out', 'android-compose-semantic.json')
    expect(after.declarations.length).toBeGreaterThan(beforeCount)
    expect(after.declarations.some((d: { name: string }) => d.name === 'ExtraScreen')).toBe(true)
  })

  // TST-026 (change)
  it('changing a Compose declaration body invalidates and refreshes its recorded evidence', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    writeFileSync(
      join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'Screens.kt'),
      `package com.example

import androidx.compose.runtime.Composable

@Composable
fun HomeScreen() {
    Scaffold {
        Greeting()
        Column {}
    }
}

@Composable
fun Greeting() {
    Text("hi")
}
`
    )

    runIncremental(root, 'out')
    const after = readArtifact(root, 'out', 'android-compose-semantic.json')
    const homeScreen = after.declarations.find((d: { name: string }) => d.name === 'HomeScreen')
    const kinds = homeScreen.structuralRegions.map((r: { kind: string }) => r.kind).sort()
    expect(kinds).toEqual(['Column', 'Scaffold'])
  })

  // TST-027 (incremental removal path)
  it('deleting the file with the only Compose declarations refreshes the artifact to absent', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    unlinkSync(join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'Screens.kt'))
    const second = runIncremental(root, 'out')

    expect(second.androidComposeSemanticPath).toBeNull()
    expect(existsSync(join(root, 'out', 'android-compose-semantic.json'))).toBe(false)
  })

  // TST-023 / android-navigation ownership preserved
  it('produces equivalent android-compose-semantic.json content between a full run and an incremental run', () => {
    const rootFull = copyFixture('basic-app')
    const rootIncremental = copyFixture('basic-app')

    runIndex(rootFull, 'out')
    runIncremental(rootIncremental, 'out')

    const normalize = (artifact: Record<string, unknown>) => ({ ...artifact, createdAt: 'NORMALIZED', projectRoot: 'NORMALIZED' })
    const fullArtifact = normalize(readArtifact(rootFull, 'out', 'android-compose-semantic.json'))
    const incrementalArtifact = normalize(readArtifact(rootIncremental, 'out', 'android-compose-semantic.json'))

    expect(fullArtifact).toEqual(incrementalArtifact)
  })

  // TST-029 old manifest compatibility
  it('old manifests without an android-compose-semantic analyzer entry remain readable via the incremental no-op fast path', () => {
    const root = copyFixture('no-compose-app')
    const first = runIncremental(root, 'out')
    expect(first.androidComposeSemanticPath).toBeNull()

    const manifestPath = join(root, 'out', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.analyzers = manifest.analyzers.filter((a: { id: string }) => a.id !== 'android-compose-semantic')
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    const second = runIncremental(root, 'out')
    expect(second.androidComposeSemanticPath).toBeNull()
  })
})
