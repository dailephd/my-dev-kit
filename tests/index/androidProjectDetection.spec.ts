import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const FIXTURES_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android')
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
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-android-index-${name}-`))
  tempDirs.push(root)
  cpSync(join(FIXTURES_ROOT, name), root, { recursive: true })
  return root
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('index Android project detection', () => {
  it('produces no android-project.json for a non-Android TS fixture and reports analyzer status skipped', () => {
    const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-nonandroid-'))
    tempDirs.push(root)
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1\n')

    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'out', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.androidProjectPath).toBeNull()
    expect(existsSync(join(root, 'out', 'android-project.json'))).toBe(false)
    const analyzer = parsed.analyzers.find((a: { id: string }) => a.id === 'android-project')
    expect(analyzer.status).toBe('skipped')
    expect(analyzer.artifacts).toEqual([])
    // Existing artifacts remain unaffected.
    expect(existsSync(join(root, 'out', 'manifest.json'))).toBe(true)
    expect(existsSync(join(root, 'out', 'symbol-index.json'))).toBe(true)
    expect(existsSync(join(root, 'out', 'code-graph.json'))).toBe(true)
  })

  it('writes android-project.json and registers it in manifest.json for a basic Kotlin app', () => {
    const root = copyFixture('basic-kotlin-app')

    const result = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', 'out', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.androidProjectPath).toContain('android-project.json')
    expect(existsSync(join(root, 'out', 'android-project.json'))).toBe(true)
    const androidProject = JSON.parse(readFileSync(join(root, 'out', 'android-project.json'), 'utf8'))
    expect(androidProject.detected).toBe(true)
    expect(androidProject.confidence).toBe('high')
    expect(androidProject.modules[0].path).toBe('app')
    expect(androidProject.modules[0].type).toBe('app')
    expect(androidProject.modules[0].sourceSets.some((s: { name: string }) => s.name === 'main')).toBe(true)
    expect(androidProject.modules[0].kotlinSourceRoots.length).toBeGreaterThan(0)

    const analyzer = parsed.analyzers.find((a: { id: string }) => a.id === 'android-project')
    expect(analyzer.status).toBe('complete')
    expect(analyzer.artifacts).toEqual([{ name: 'androidProject', path: 'android-project.json', artifactKind: 'my-dev-kit-v1-android-project' }])

    // Kotlin structural indexing (v1.9.0 Batch 2) now indexes .kt files found
    // under --src; this Batch 1 test only asserts that Android *detection*
    // itself does not depend on or interfere with that.
    const symbolIndex = JSON.parse(readFileSync(join(root, 'out', 'symbol-index.json'), 'utf8'))
    expect(symbolIndex.files.some((f: { path: string }) => f.path.endsWith('MainActivity.kt'))).toBe(true)
  })

  it('detects a library module', () => {
    const root = copyFixture('multi-module-app')

    const result = runCli(['index', '--root', root, '--src', 'library/src/main', '--out', 'out', '--json'])
    expect(result.status).toBe(0)

    const androidProject = JSON.parse(readFileSync(join(root, 'out', 'android-project.json'), 'utf8'))
    const libraryModule = androidProject.modules.find((m: { path: string }) => m.path === 'library')
    expect(libraryModule.type).toBe('library')
  })

  it('detects both modules in a multi-module app/library project', () => {
    const root = copyFixture('multi-module-app')

    const result = runCli(['index', '--root', root, '--src', 'app/src/main', '--src', 'library/src/main', '--out', 'out', '--json'])
    expect(result.status).toBe(0)

    const androidProject = JSON.parse(readFileSync(join(root, 'out', 'android-project.json'), 'utf8'))
    expect(androidProject.modules.map((m: { path: string }) => m.path)).toEqual(['app', 'library'])
    expect(androidProject.summary).toEqual({ moduleCount: 2, appModuleCount: 1, libraryModuleCount: 1, unknownModuleCount: 0 })
  })

  it('detects main and test source sets', () => {
    const root = copyFixture('basic-kotlin-app')

    const result = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', 'out', '--json'])
    expect(result.status).toBe(0)

    const androidProject = JSON.parse(readFileSync(join(root, 'out', 'android-project.json'), 'utf8'))
    expect(androidProject.modules[0].sourceSets.map((s: { name: string }) => s.name)).toEqual(['main', 'test'])
  })

  it('ignores generated build-output directories during --src discovery', () => {
    const root = copyFixture('generated-build-output')

    const result = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', 'out', '--json'])
    expect(result.status).toBe(0)

    // Prove app/build/... never reaches discovery, ahead of Batch 2 Kotlin indexing.
    const dryRun = runCli(['index', '--root', root, '--src', 'app', '--out', 'out-dry', '--dry-run', '--json'])
    expect(dryRun.status).toBe(0)
    const parsed = JSON.parse(dryRun.stdout)
    expect(parsed.sampleIndexedFiles.some((p: string) => p.includes('build'))).toBe(false)
    expect(parsed.skippedByDefaultIgnore).toBeGreaterThan(0)
    expect(
      parsed.sampleSkippedFiles.some((f: { path: string; reason: string }) => f.path.endsWith('app/build') && f.reason === 'default-ignore')
    ).toBe(true)
  })

  it('removes a stale android-project.json when the project root no longer has Android evidence on a later run', () => {
    const root = copyFixture('basic-kotlin-app')
    const first = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', 'out', '--json'])
    expect(first.status).toBe(0)
    expect(existsSync(join(root, 'out', 'android-project.json'))).toBe(true)

    // Android evidence lives at the project root (Gradle files), not under
    // --src, so removing it from the root — not --src — is what must trigger
    // stale-artifact cleanup on the next run into the same --out.
    rmSync(join(root, 'settings.gradle.kts'), { force: true })
    rmSync(join(root, 'app', 'build.gradle.kts'), { force: true })
    mkdirSync(join(root, 'plain-src'), { recursive: true })
    writeFileSync(join(root, 'plain-src', 'index.ts'), 'export const x = 1\n')

    const second = runCli(['index', '--root', root, '--src', 'plain-src', '--out', 'out', '--json'])
    expect(second.status).toBe(0)
    const parsed = JSON.parse(second.stdout)
    expect(parsed.androidProjectPath).toBeNull()
    expect(existsSync(join(root, 'out', 'android-project.json'))).toBe(false)
  })

  it('is unaffected by --call-graph for TS/JS/Python source', () => {
    const root = copyFixture('basic-kotlin-app')
    mkdirSync(join(root, 'app', 'tools'), { recursive: true })
    writeFileSync(join(root, 'app', 'tools', 'helper.ts'), 'export function helper(): number { return 1 }\n')

    const result = runCli(['index', '--root', root, '--src', 'app/tools', '--out', 'out', '--call-graph', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.callGraphPath).toBeTruthy()
    expect(parsed.androidProjectPath).toBeTruthy()
  })
})
