import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, cpSync, writeFileSync } from 'node:fs'
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
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-android-incr-${name}-`))
  tempDirs.push(root)
  cpSync(join(FIXTURES_ROOT, name), root, { recursive: true })
  return root
}

function runIncremental(root: string, out: string) {
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

describe('Android project detection + incremental indexing compatibility', () => {
  it('initial --incremental run on an Android fixture detects the project', () => {
    const root = copyFixture('basic-kotlin-app')

    const result = runIncremental(root, 'out')

    expect(result.cache.mode).toBe('incremental-full-initial')
    expect(result.androidProjectPath).toBeTruthy()
  })

  it('second --incremental run with no changes reports no-change and keeps android-project.json correct', () => {
    const root = copyFixture('basic-kotlin-app')
    runIncremental(root, 'out')

    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-no-change')
    const androidProject = JSON.parse(readFileSync(join(root, 'out', 'android-project.json'), 'utf8'))
    expect(androidProject.detected).toBe(true)
    expect(androidProject.modules[0].type).toBe('app')
  })

  it('editing build.gradle.kts to change the plugin invalidates the cache and rewrites android-project.json', () => {
    const root = copyFixture('basic-kotlin-app')
    runIncremental(root, 'out')

    writeFileSync(
      join(root, 'app', 'build.gradle.kts'),
      'plugins {\n    id("com.android.library")\n    id("org.jetbrains.kotlin.android")\n}\n'
    )

    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-full-config-changed')
    expect(second.cache.invalidationReason).toContain('Android')
    const androidProject = JSON.parse(readFileSync(join(root, 'out', 'android-project.json'), 'utf8'))
    expect(androidProject.modules[0].type).toBe('library')
  })

  it('editing settings.gradle.kts to add a module invalidates the cache', () => {
    const root = copyFixture('basic-kotlin-app')
    runIncremental(root, 'out')

    writeFileSync(join(root, 'settings.gradle.kts'), 'rootProject.name = "basic-kotlin-app"\ninclude(":app")\ninclude(":feature")\n')

    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-full-config-changed')
  })

  it('editing an unrelated --src TS file does not falsely report an Android config change', () => {
    const root = copyFixture('basic-kotlin-app')
    writeFileSync(join(root, 'app', 'src', 'main', 'kotlin', 'extra.ts'), 'export const x = 1\n')
    runIncremental(root, 'out')

    writeFileSync(join(root, 'app', 'src', 'main', 'kotlin', 'extra.ts'), 'export const x = 2\n')
    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-partial')
    expect(second.cache.changedFileSummary.changedCount).toBe(1)
  })

  it('cache-metadata.json never lists a path under a build/ directory', () => {
    const root = copyFixture('generated-build-output')
    runIncremental(root, 'out')

    const cacheMetadata = JSON.parse(readFileSync(join(root, 'out', 'cache-metadata.json'), 'utf8'))
    expect(cacheMetadata.files.some((f: { path: string }) => f.path.includes('/build/'))).toBe(false)
  })
})
