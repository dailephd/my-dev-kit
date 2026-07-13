import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, cpSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const FIXTURES_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android-manifest')
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
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-android-manifest-incr-${name}-`))
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

describe('android-manifest.json manifest registration and stale cleanup', () => {
  it('a full index run generates android-manifest.json and registers it in manifest.json', () => {
    const root = copyFixture('basic-app')
    const result = runIndex(root, 'out')

    expect(result.androidManifestPath).toBeTruthy()
    expect(existsSync(join(root, 'out', 'android-manifest.json'))).toBe(true)

    const manifest = readArtifact(root, 'out', 'manifest.json')
    const analyzer = manifest.analyzers.find((a: { id: string }) => a.id === 'android-manifest')
    expect(analyzer).toBeTruthy()
    expect(analyzer.status).toBe('complete')
    expect(analyzer.artifacts[0].path).toBe('android-manifest.json')

    const androidManifest = readArtifact(root, 'out', 'android-manifest.json')
    expect(androidManifest.detected).toBe(true)
    expect(androidManifest.components).toHaveLength(1)

    // Upstream artifacts remain correct alongside the new one.
    expect(existsSync(join(root, 'out', 'android-project.json'))).toBe(true)
    expect(existsSync(join(root, 'out', 'android-gradle.json'))).toBe(true)
  })

  it('an Android module without any manifest file does not register a misleading artifact', () => {
    const root = copyFixture('no-manifest-app')
    const r = runCli(['index', '--root', root, '--src', 'app', '--out', 'out', '--json'])
    expect(r.status).toBe(0)
    const parsed = JSON.parse(r.stdout)

    expect(parsed.androidManifestPath).toBeNull()
    expect(existsSync(join(root, 'out', 'android-manifest.json'))).toBe(false)
    const manifest = readArtifact(root, 'out', 'manifest.json')
    const analyzer = manifest.analyzers.find((a: { id: string }) => a.id === 'android-manifest')
    expect(analyzer?.status).toBe('skipped')
    expect(analyzer?.artifacts).toEqual([])
  })

  it('removing the only manifest file removes the stale android-manifest.json and its manifest entry', () => {
    const root = copyFixture('basic-app')
    runIndex(root, 'out')
    expect(existsSync(join(root, 'out', 'android-manifest.json'))).toBe(true)

    unlinkSync(join(root, 'app', 'src', 'main', 'AndroidManifest.xml'))

    const result = runIndex(root, 'out')
    expect(result.androidManifestPath).toBeNull()
    expect(existsSync(join(root, 'out', 'android-manifest.json'))).toBe(false)

    const manifest = readArtifact(root, 'out', 'manifest.json')
    const analyzer = manifest.analyzers.find((a: { id: string }) => a.id === 'android-manifest')
    expect(analyzer?.status).toBe('skipped')
  })

  it('a malformed manifest does not crash indexing and produces a bounded analyzer warning', () => {
    const root = copyFixture('malformed-manifest-app')
    const result = runIndex(root, 'out')

    expect(result.androidManifestPath).toBeTruthy()
    const manifest = readArtifact(root, 'out', 'manifest.json')
    const analyzer = manifest.analyzers.find((a: { id: string }) => a.id === 'android-manifest')
    expect(analyzer?.status).toBe('partial')
    expect(analyzer?.warningCount).toBeGreaterThan(0)

    const androidManifest = readArtifact(root, 'out', 'android-manifest.json')
    expect(androidManifest.manifests[0].parsingStatus).toBe('malformed')

    // Other artifacts remain intact despite the malformed manifest.
    expect(existsSync(join(root, 'out', 'android-project.json'))).toBe(true)
    expect(existsSync(join(root, 'out', 'symbol-index.json'))).toBe(true)
  })
})

describe('android-manifest.json incremental indexing integration', () => {
  it('initial --incremental run produces android-manifest.json', () => {
    const root = copyFixture('basic-app')
    const result = runIncremental(root, 'out')

    expect(result.cache.mode).toBe('incremental-full-initial')
    expect(result.androidManifestPath).toBeTruthy()
  })

  it('second --incremental run with no changes reuses output and keeps android-manifest.json correct', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-no-change')
    const androidManifest = readArtifact(root, 'out', 'android-manifest.json')
    expect(androidManifest.detected).toBe(true)
    expect(androidManifest.components[0].kind).toBe('activity')
  })

  it('editing the manifest (e.g. changing exported) invalidates the cache and refreshes android-manifest.json', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    writeFileSync(
      join(root, 'app', 'src', 'main', 'AndroidManifest.xml'),
      [
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
        '  <application>',
        '    <activity android:name=".MainActivity" android:exported="false" />',
        '  </application>',
        '</manifest>',
      ].join('\n')
    )

    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-full-config-changed')
    const androidManifest = readArtifact(root, 'out', 'android-manifest.json')
    expect(androidManifest.components[0].exported).toBe('false')
  })

  it('adding a new manifest file invalidates the cache and adds a record', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    mkdirSync(join(root, 'app', 'src', 'debug'), { recursive: true })
    writeFileSync(
      join(root, 'app', 'src', 'debug', 'AndroidManifest.xml'),
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:debuggable="true" /></manifest>\n'
    )

    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-full-config-changed')
    const androidManifest = readArtifact(root, 'out', 'android-manifest.json')
    expect(androidManifest.manifests).toHaveLength(2)
  })

  it('deleting the manifest file invalidates the cache and removes the stale artifact', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    unlinkSync(join(root, 'app', 'src', 'main', 'AndroidManifest.xml'))
    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-full-config-changed')
    expect(second.androidManifestPath).toBeNull()
    expect(existsSync(join(root, 'out', 'android-manifest.json'))).toBe(false)
  })

  it('changing the Gradle namespace invalidates the cache and updates resolved component names', () => {
    const root = copyFixture('basic-app')
    // Use a dot-prefixed name so resolution depends on namespace/package evidence.
    writeFileSync(
      join(root, 'app', 'src', 'main', 'AndroidManifest.xml'),
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><activity android:name=".MainActivity" /></application></manifest>\n'
    )
    runIncremental(root, 'out')
    const before = readArtifact(root, 'out', 'android-manifest.json')
    expect(before.components[0].resolvedName.resolved).toBe('com.example.basicapp.MainActivity')

    writeFileSync(
      join(root, 'app', 'build.gradle.kts'),
      [
        'plugins { id("com.android.application") }',
        'android {',
        '  namespace = "com.example.renamed"',
        '  compileSdk = 34',
        '  defaultConfig { applicationId = "com.example.renamed"; minSdk = 24; targetSdk = 34 }',
        '}',
      ].join('\n')
    )

    const second = runIncremental(root, 'out')
    expect(second.cache.mode).toBe('incremental-full-config-changed')
    const after = readArtifact(root, 'out', 'android-manifest.json')
    expect(after.components[0].resolvedName.resolved).toBe('com.example.renamed.MainActivity')
  })

  it('changing the custom Gradle manifest path invalidates discovery', () => {
    const root = copyFixture('custom-manifest-path-app')
    const runCustom = () => {
      const r = runCli(['index', '--root', root, '--src', 'app', '--out', 'out', '--incremental', '--json'])
      expect(r.status).toBe(0)
      return JSON.parse(r.stdout)
    }
    runCustom()
    const before = readArtifact(root, 'out', 'android-manifest.json')
    expect(before.manifests[0].path).toBe('app/custom/CustomManifest.xml')

    const manifestText = readFileSync(join(root, 'app', 'custom', 'CustomManifest.xml'), 'utf8')
    mkdirSync(join(root, 'app', 'custom2'), { recursive: true })
    writeFileSync(join(root, 'app', 'custom2', 'CustomManifest2.xml'), manifestText)
    writeFileSync(
      join(root, 'app', 'build.gradle.kts'),
      [
        'plugins { id("com.android.application") }',
        'android {',
        '  namespace = "com.example.custompath"',
        '  compileSdk = 34',
        '  defaultConfig { applicationId = "com.example.custompath"; minSdk = 24; targetSdk = 34 }',
        '  sourceSets { main { manifest.srcFile("custom2/CustomManifest2.xml") } }',
        '}',
      ].join('\n')
    )

    const second = runCustom()
    expect(second.cache.mode).toBe('incremental-full-config-changed')
    const after = readArtifact(root, 'out', 'android-manifest.json')
    expect(after.manifests[0].path).toBe('app/custom2/CustomManifest2.xml')
  })

  it('--reset-cache forces a fresh full rebuild that still produces a correct android-manifest.json', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    const result = runIndex(root, 'out', ['--incremental', '--reset-cache'])

    expect(result.cache.mode).toBe('incremental-full-initial')
    const androidManifest = readArtifact(root, 'out', 'android-manifest.json')
    expect(androidManifest.detected).toBe(true)
  })

  it('produces equivalent android-manifest.json content between a full run and an incremental run', () => {
    const rootFull = copyFixture('component-complete-app')
    const rootIncremental = copyFixture('component-complete-app')

    runIndex(rootFull, 'out')
    runIncremental(rootIncremental, 'out')

    const normalize = (artifact: Record<string, unknown>) => ({ ...artifact, createdAt: 'NORMALIZED', projectRoot: 'NORMALIZED' })
    const fullArtifact = normalize(readArtifact(rootFull, 'out', 'android-manifest.json'))
    const incrementalArtifact = normalize(readArtifact(rootIncremental, 'out', 'android-manifest.json'))

    expect(fullArtifact).toEqual(incrementalArtifact)
  })
})
