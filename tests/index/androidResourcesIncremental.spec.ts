import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, cpSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const FIXTURES_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android-resources')
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
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-android-resources-incr-${name}-`))
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

describe('android-resources.json manifest registration and stale cleanup', () => {
  it('a full index run generates android-resources.json and registers it in manifest.json', () => {
    const root = copyFixture('basic-app')
    const result = runIndex(root, 'out')

    expect(result.androidResourcesPath).toBeTruthy()
    expect(existsSync(join(root, 'out', 'android-resources.json'))).toBe(true)

    const manifest = readArtifact(root, 'out', 'manifest.json')
    const analyzer = manifest.analyzers.find((a: { id: string }) => a.id === 'android-resources')
    expect(analyzer).toBeTruthy()
    expect(analyzer.status).toBe('complete')
    expect(analyzer.artifacts[0].path).toBe('android-resources.json')

    const androidResources = readArtifact(root, 'out', 'android-resources.json')
    expect(androidResources.detected).toBe(true)
    expect(androidResources.valueDefinitions.length).toBeGreaterThan(0)

    // Upstream artifacts remain correct alongside the new one.
    expect(existsSync(join(root, 'out', 'android-project.json'))).toBe(true)
    expect(existsSync(join(root, 'out', 'android-gradle.json'))).toBe(true)
    expect(existsSync(join(root, 'out', 'android-manifest.json'))).toBe(true)
  })

  it('an Android module without any resource directory does not register a misleading artifact', () => {
    const root = copyFixture('no-resources-app')
    const r = runCli(['index', '--root', root, '--src', 'app', '--out', 'out', '--json'])
    expect(r.status).toBe(0)
    const parsed = JSON.parse(r.stdout)

    expect(parsed.androidResourcesPath).toBeNull()
    expect(existsSync(join(root, 'out', 'android-resources.json'))).toBe(false)
    const manifest = readArtifact(root, 'out', 'manifest.json')
    const analyzer = manifest.analyzers.find((a: { id: string }) => a.id === 'android-resources')
    expect(analyzer?.status).toBe('skipped')
    expect(analyzer?.artifacts).toEqual([])
  })

  it('removing all resource directories removes the stale android-resources.json and its manifest entry', () => {
    const root = copyFixture('basic-app')
    runIndex(root, 'out')
    expect(existsSync(join(root, 'out', 'android-resources.json'))).toBe(true)

    rmSync(join(root, 'app', 'src', 'main', 'res'), { recursive: true, force: true })

    const result = runIndex(root, 'out')
    expect(result.androidResourcesPath).toBeNull()
    expect(existsSync(join(root, 'out', 'android-resources.json'))).toBe(false)

    const manifest = readArtifact(root, 'out', 'manifest.json')
    const analyzer = manifest.analyzers.find((a: { id: string }) => a.id === 'android-resources')
    expect(analyzer?.status).toBe('skipped')
  })

  it('a malformed values XML file does not crash indexing and produces a bounded analyzer warning', () => {
    const root = copyFixture('malformed-resource-app')
    const result = runIndex(root, 'out')

    expect(result.androidResourcesPath).toBeTruthy()
    const manifest = readArtifact(root, 'out', 'manifest.json')
    const analyzer = manifest.analyzers.find((a: { id: string }) => a.id === 'android-resources')
    expect(analyzer?.status).toBe('partial')
    expect(analyzer?.warningCount).toBeGreaterThan(0)

    const androidResources = readArtifact(root, 'out', 'android-resources.json')
    expect(androidResources.resourceFiles[0].parsingStatus).toBe('malformed')

    // Other artifacts remain intact despite the malformed resource file.
    expect(existsSync(join(root, 'out', 'android-project.json'))).toBe(true)
    expect(existsSync(join(root, 'out', 'symbol-index.json'))).toBe(true)
  })
})

describe('android-resources.json incremental indexing integration', () => {
  it('initial --incremental run produces android-resources.json', () => {
    const root = copyFixture('basic-app')
    const result = runIncremental(root, 'out')

    expect(result.cache.mode).toBe('incremental-full-initial')
    expect(result.androidResourcesPath).toBeTruthy()
  })

  it('second --incremental run with no changes reuses output and keeps android-resources.json correct', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-no-change')
    const androidResources = readArtifact(root, 'out', 'android-resources.json')
    expect(androidResources.detected).toBe(true)
  })

  it('modifying a values resource invalidates the cache and refreshes android-resources.json', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    writeFileSync(
      join(root, 'app', 'src', 'main', 'res', 'values', 'strings.xml'),
      '<resources><string name="app_name">Changed Name</string></resources>\n'
    )

    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-full-config-changed')
    const androidResources = readArtifact(root, 'out', 'android-resources.json')
    expect(androidResources.valueDefinitions.some((d: { rawValue: string }) => d.rawValue === 'Changed Name')).toBe(true)
  })

  it('adding a new layout invalidates the cache and adds a layout record', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    writeFileSync(
      join(root, 'app', 'src', 'main', 'res', 'layout', 'second_screen.xml'),
      '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" />\n'
    )

    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-full-config-changed')
    const androidResources = readArtifact(root, 'out', 'android-resources.json')
    expect(androidResources.layouts).toHaveLength(2)
  })

  it('deleting a layout invalidates the cache and removes its record', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    unlinkSync(join(root, 'app', 'src', 'main', 'res', 'layout', 'activity_main.xml'))
    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-full-config-changed')
    const androidResources = readArtifact(root, 'out', 'android-resources.json')
    expect(androidResources.layouts).toEqual([])
  })

  it('adding a new qualified resource directory invalidates the cache', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    mkdirSync(join(root, 'app', 'src', 'main', 'res', 'values-fr'), { recursive: true })
    writeFileSync(join(root, 'app', 'src', 'main', 'res', 'values-fr', 'strings.xml'), '<resources><string name="app_name">App Francais</string></resources>\n')

    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-full-config-changed')
    const androidResources = readArtifact(root, 'out', 'android-resources.json')
    expect(androidResources.resourceDirectories.some((d: { rawDirectoryName: string }) => d.rawDirectoryName === 'values-fr')).toBe(true)
  })

  it('deleting a qualified resource directory invalidates the cache', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    rmSync(join(root, 'app', 'src', 'main', 'res', 'values-es'), { recursive: true, force: true })
    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-full-config-changed')
    const androidResources = readArtifact(root, 'out', 'android-resources.json')
    expect(androidResources.resourceDirectories.some((d: { rawDirectoryName: string }) => d.rawDirectoryName === 'values-es')).toBe(false)
  })

  it('a binary drawable/mipmap resource change invalidates the cache', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    writeFileSync(join(root, 'app', 'src', 'main', 'res', 'mipmap-xxhdpi', 'ic_launcher.png'), 'changed-placeholder-content\n')

    const second = runIncremental(root, 'out')
    expect(second.cache.mode).toBe('incremental-full-config-changed')
  })

  it('a network-security XML change invalidates the cache and refreshes specialized records', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    writeFileSync(
      join(root, 'app', 'src', 'main', 'res', 'xml', 'network_security_config.xml'),
      '<network-security-config><base-config cleartextTrafficPermitted="true" /></network-security-config>\n'
    )

    const second = runIncremental(root, 'out')
    expect(second.cache.mode).toBe('incremental-full-config-changed')
    const androidResources = readArtifact(root, 'out', 'android-resources.json')
    const baseConfig = androidResources.networkSecurityRecords.find((r: { kind: string }) => r.kind === 'base-config')
    expect(baseConfig.attributes.cleartextTrafficPermitted).toBe('true')
  })

  it('changing the custom Gradle resource-directory path invalidates discovery', () => {
    const root = copyFixture('custom-res-dir-app')
    const runCustom = () => {
      const r = runCli(['index', '--root', root, '--src', 'app', '--out', 'out', '--incremental', '--json'])
      expect(r.status).toBe(0)
      return JSON.parse(r.stdout)
    }
    runCustom()
    const before = readArtifact(root, 'out', 'android-resources.json')
    expect(before.resourceDirectories[0].path).toBe('app/custom/myres/values')

    mkdirSync(join(root, 'app', 'custom2', 'myres2', 'values'), { recursive: true })
    writeFileSync(
      join(root, 'app', 'custom2', 'myres2', 'values', 'strings.xml'),
      readFileSync(join(root, 'app', 'custom', 'myres', 'values', 'strings.xml'), 'utf8')
    )
    writeFileSync(
      join(root, 'app', 'build.gradle.kts'),
      [
        'plugins { id("com.android.application") }',
        'android {',
        '  namespace = "com.example.customres"',
        '  compileSdk = 34',
        '  sourceSets { main { res.srcDirs("custom2/myres2") } }',
        '}',
      ].join('\n')
    )

    const second = runCustom()
    expect(second.cache.mode).toBe('incremental-full-config-changed')
    const after = readArtifact(root, 'out', 'android-resources.json')
    expect(after.resourceDirectories[0].path).toBe('app/custom2/myres2/values')
  })

  it('--reset-cache forces a fresh full rebuild that still produces a correct android-resources.json', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    const result = runIndex(root, 'out', ['--incremental', '--reset-cache'])

    expect(result.cache.mode).toBe('incremental-full-initial')
    const androidResources = readArtifact(root, 'out', 'android-resources.json')
    expect(androidResources.detected).toBe(true)
  })

  it('produces equivalent android-resources.json content between a full run and an incremental run', () => {
    const rootFull = copyFixture('basic-app')
    const rootIncremental = copyFixture('basic-app')

    runIndex(rootFull, 'out')
    runIncremental(rootIncremental, 'out')

    const normalize = (artifact: Record<string, unknown>) => ({ ...artifact, createdAt: 'NORMALIZED', projectRoot: 'NORMALIZED' })
    const fullArtifact = normalize(readArtifact(rootFull, 'out', 'android-resources.json'))
    const incrementalArtifact = normalize(readArtifact(rootIncremental, 'out', 'android-resources.json'))

    expect(fullArtifact).toEqual(incrementalArtifact)
  })
})
