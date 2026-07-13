import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, cpSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const FIXTURES_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android-gradle')
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
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-android-gradle-incr-${name}-`))
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

describe('android-gradle.json manifest registration and stale cleanup', () => {
  it('a full index run generates android-gradle.json and registers it in manifest.json', () => {
    const root = copyFixture('groovy-single-module-app')
    const result = runIndex(root, 'out')

    expect(result.androidGradlePath).toBeTruthy()
    expect(existsSync(join(root, 'out', 'android-gradle.json'))).toBe(true)

    const manifest = readArtifact(root, 'out', 'manifest.json')
    const analyzer = manifest.analyzers.find((a: { id: string }) => a.id === 'android-gradle')
    expect(analyzer).toBeTruthy()
    expect(analyzer.status).toBe('complete')
    expect(analyzer.artifacts[0].path).toBe('android-gradle.json')

    const gradleArtifact = readArtifact(root, 'out', 'android-gradle.json')
    expect(gradleArtifact.detected).toBe(true)
    expect(gradleArtifact.modules).toHaveLength(1)
  })

  it('a non-Android Gradle project does not register a misleading android-gradle analyzer artifact', () => {
    const root = copyFixture('non-android-gradle-project')
    const r = runCli(['index', '--root', root, '--src', 'lib', '--out', 'out', '--json'])
    expect(r.status).toBe(0)
    const result = JSON.parse(r.stdout)

    expect(result.androidGradlePath).toBeTruthy()
    const gradleArtifact = readArtifact(root, 'out', 'android-gradle.json')
    expect(gradleArtifact.modules.every((m: { android: unknown }) => m.android === null)).toBe(true)
  })

  it('removing all Gradle evidence removes the stale android-gradle.json and its manifest entry', () => {
    const root = copyFixture('groovy-single-module-app')
    runIndex(root, 'out')
    expect(existsSync(join(root, 'out', 'android-gradle.json'))).toBe(true)

    unlinkSync(join(root, 'app', 'build.gradle'))
    unlinkSync(join(root, 'settings.gradle'))

    const result = runIndex(root, 'out')
    expect(result.androidGradlePath).toBeNull()
    expect(existsSync(join(root, 'out', 'android-gradle.json'))).toBe(false)

    const manifest = readArtifact(root, 'out', 'manifest.json')
    const analyzer = manifest.analyzers.find((a: { id: string }) => a.id === 'android-gradle')
    expect(analyzer?.status).toBe('skipped')
    expect(analyzer?.artifacts).toEqual([])
  })
})

describe('android-gradle.json incremental indexing integration', () => {
  it('initial --incremental run produces android-gradle.json', () => {
    const root = copyFixture('groovy-single-module-app')
    const result = runIncremental(root, 'out')

    expect(result.cache.mode).toBe('incremental-full-initial')
    expect(result.androidGradlePath).toBeTruthy()
  })

  it('second --incremental run with no changes reuses output and keeps android-gradle.json correct', () => {
    const root = copyFixture('groovy-single-module-app')
    runIncremental(root, 'out')

    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-no-change')
    const gradleArtifact = readArtifact(root, 'out', 'android-gradle.json')
    expect(gradleArtifact.detected).toBe(true)
    expect(gradleArtifact.modules[0].moduleType).toBe('app')
  })

  it('editing build.gradle (e.g. adding a dependency) invalidates the cache and refreshes android-gradle.json', () => {
    const root = copyFixture('groovy-single-module-app')
    runIncremental(root, 'out')

    writeFileSync(
      join(root, 'app', 'build.gradle'),
      [
        "plugins { id 'com.android.application' }",
        "android { namespace 'com.example.groovyapp'; compileSdk 34 }",
        'dependencies {',
        "  implementation 'com.squareup.retrofit2:retrofit:2.11.0'",
        '}',
      ].join('\n')
    )

    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-full-config-changed')
    const gradleArtifact = readArtifact(root, 'out', 'android-gradle.json')
    expect(gradleArtifact.modules[0].dependencies.some((d: { artifact: string }) => d.artifact === 'retrofit')).toBe(true)
  })

  it('editing settings.gradle to add a module invalidates the cache', () => {
    const root = copyFixture('groovy-single-module-app')
    runIncremental(root, 'out')

    writeFileSync(join(root, 'settings.gradle'), "rootProject.name = 'groovy-single-module-app'\ninclude ':app', ':extra'\n")

    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-full-config-changed')
  })

  it('deleting build.gradle refreshes android-gradle.json to drop its detailed Gradle evidence for that module', () => {
    const root = copyFixture('groovy-single-module-app')
    runIncremental(root, 'out')

    unlinkSync(join(root, 'app', 'build.gradle'))
    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-full-config-changed')
    const gradleArtifact = readArtifact(root, 'out', 'android-gradle.json')
    // The module is still detected (its AndroidManifest.xml still exists per v1.9.0 detection),
    // but with no build file to source detailed evidence from — conservative degradation, not an invented value.
    expect(gradleArtifact.modules).toHaveLength(1)
    expect(gradleArtifact.modules[0].buildFile).toBeNull()
    expect(gradleArtifact.modules[0].android).toBeNull()
    expect(gradleArtifact.modules[0].warnings).toContain('Module "app" has no readable build file for detailed Gradle evidence.')
  })

  it('--reset-cache forces a fresh full rebuild that still produces a correct android-gradle.json', () => {
    const root = copyFixture('groovy-single-module-app')
    runIncremental(root, 'out')

    const result = runIndex(root, 'out', ['--incremental', '--reset-cache'])

    expect(result.cache.mode).toBe('incremental-full-initial')
    const gradleArtifact = readArtifact(root, 'out', 'android-gradle.json')
    expect(gradleArtifact.detected).toBe(true)
  })

  it('produces equivalent android-gradle.json content between a full run and an incremental run', () => {
    const rootFull = copyFixture('multi-module-app')
    const rootIncremental = copyFixture('multi-module-app')

    runIndex(rootFull, 'out')
    runIncremental(rootIncremental, 'out')

    const normalize = (artifact: Record<string, unknown>) => ({ ...artifact, createdAt: 'NORMALIZED', projectRoot: 'NORMALIZED' })
    const fullArtifact = normalize(readArtifact(rootFull, 'out', 'android-gradle.json'))
    const incrementalArtifact = normalize(readArtifact(rootIncremental, 'out', 'android-gradle.json'))

    expect(fullArtifact).toEqual(incrementalArtifact)
  })
})
