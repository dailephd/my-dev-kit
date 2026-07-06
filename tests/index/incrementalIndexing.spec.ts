import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

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

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-incremental-'))
  tempDirs.push(root)
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'userTypes.ts'), "export interface User { id: string; name: string }\n")
  writeFileSync(
    join(src, 'userService.ts'),
    "import type { User } from './userTypes'\nexport function formatUser(user: User): string { return user.name }\n"
  )
  writeFileSync(
    join(src, 'index.ts'),
    "import { formatUser } from './userService'\nimport type { User } from './userTypes'\nexport function describeUser(user: User): string { return formatUser(user) }\n"
  )
  return root
}

function runIncremental(root: string, extraArgs: string[] = []) {
  const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'cache-out', '--incremental', '--json', ...extraArgs])
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout)
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('index --incremental', () => {
  it('performs an initial full build and writes cache metadata on the first run', () => {
    const root = createFixture()
    const parsed = runIncremental(root)

    expect(parsed.cache.requested).toBe(true)
    expect(parsed.cache.mode).toBe('incremental-full-initial')
    expect(parsed.cache.changedFileSummary).toBeNull()
    expect(existsSync(join(root, 'cache-out', 'cache-metadata.json'))).toBe(true)
    expect(parsed.manifest.indexMode).toBe('incremental')
    expect(parsed.manifest.cacheMode).toBe('incremental-full-initial')
  })

  it('detects no changes on a second run with no source edits', () => {
    const root = createFixture()
    runIncremental(root)
    const second = runIncremental(root)

    expect(second.cache.mode).toBe('incremental-no-change')
    expect(second.cache.changedFileSummary).toEqual({
      addedCount: 0,
      changedCount: 0,
      removedCount: 0,
      unchangedCount: 3,
      addedSample: [],
      changedSample: [],
      removedSample: [],
    })
  })

  it('detects a changed file', () => {
    const root = createFixture()
    runIncremental(root)
    writeFileSync(join(root, 'src', 'index.ts'), "export function describeUser(): string { return 'changed' }\n")

    const second = runIncremental(root)

    expect(second.cache.mode).toBe('incremental-partial')
    expect(second.cache.changedFileSummary.changedCount).toBe(1)
    expect(second.cache.changedFileSummary.changedSample).toEqual(['src/index.ts'])
    expect(second.cache.changedFileSummary.addedCount).toBe(0)
    expect(second.cache.changedFileSummary.removedCount).toBe(0)
  })

  it('detects an added file', () => {
    const root = createFixture()
    runIncremental(root)
    writeFileSync(join(root, 'src', 'newFile.ts'), 'export const added = 1\n')

    const second = runIncremental(root)

    expect(second.cache.mode).toBe('incremental-partial')
    expect(second.cache.changedFileSummary.addedCount).toBe(1)
    expect(second.cache.changedFileSummary.addedSample).toEqual(['src/newFile.ts'])
  })

  it('detects a removed file', () => {
    const root = createFixture()
    runIncremental(root)
    rmSync(join(root, 'src', 'userTypes.ts'))
    writeFileSync(
      join(root, 'src', 'userService.ts'),
      'export function formatUser(user: { name: string }): string { return user.name }\n'
    )
    writeFileSync(
      join(root, 'src', 'index.ts'),
      "import { formatUser } from './userService'\nexport function describeUser(user: { name: string }): string { return formatUser(user) }\n"
    )

    const second = runIncremental(root)

    expect(second.cache.mode).toBe('incremental-partial')
    expect(second.cache.changedFileSummary.removedCount).toBe(1)
    expect(second.cache.changedFileSummary.removedSample).toEqual(['src/userTypes.ts'])
  })

  it('invalidates the cache when --exclude changes', () => {
    const root = createFixture()
    mkdirSync(join(root, 'src', 'ignored-by-exclude'), { recursive: true })
    writeFileSync(join(root, 'src', 'ignored-by-exclude', 'file.ts'), 'export const x = 1\n')
    runIncremental(root)

    const second = runIncremental(root, ['--exclude', 'ignored-by-exclude'])

    expect(second.cache.mode).toBe('incremental-full-config-changed')
    expect(second.cache.invalidationReason).toContain('configuration changed')
    expect(second.cache.changedFileSummary).toBeNull()
  })

  it('invalidates the cache when the source roots change', () => {
    const root = createFixture()
    mkdirSync(join(root, 'other-src'), { recursive: true })
    writeFileSync(join(root, 'other-src', 'other.ts'), 'export const other = 1\n')
    runIncremental(root)

    const result = runCli([
      'index',
      '--root',
      root,
      '--src',
      'src',
      '--src',
      'other-src',
      '--out',
      'cache-out',
      '--incremental',
      '--json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.cache.mode).toBe('incremental-full-config-changed')
  })

  it('reports incremental-full-cache-incompatible for a corrupt cache file', () => {
    const root = createFixture()
    runIncremental(root)
    writeFileSync(join(root, 'cache-out', 'cache-metadata.json'), '{ not valid json')

    const second = runIncremental(root)

    expect(second.cache.mode).toBe('incremental-full-cache-incompatible')
    expect(second.cache.invalidationReason).toBeTruthy()
  })

  it('keeps preflightWarnings present alongside incremental cache reporting', () => {
    const root = createFixture()
    const parsed = runIncremental(root)

    expect(Array.isArray(parsed.preflightWarnings)).toBe(true)
  })

  it('does not index its own cache-metadata.json or .my-dev-kit output directory', () => {
    const root = createFixture()
    runIncremental(root)
    const second = runIncremental(root)

    const symbolIndex = JSON.parse(readFileSync(join(root, 'cache-out', 'symbol-index.json'), 'utf8'))
    const paths = symbolIndex.files.map((file: { path: string }) => file.path)
    expect(paths.some((filePath: string) => filePath.includes('cache-metadata'))).toBe(false)
    expect(second.cache.mode).toBe('incremental-no-change')
  })

  it('produces deterministic cache metadata file ordering across runs with no changes', () => {
    const root = createFixture()
    runIncremental(root)
    const cacheContentsFirst = readFileSync(join(root, 'cache-out', 'cache-metadata.json'), 'utf8')
    const parsedFirst = JSON.parse(cacheContentsFirst)
    const paths = parsedFirst.files.map((f: { path: string }) => f.path)
    const sortedPaths = [...paths].sort()
    expect(paths).toEqual(sortedPaths)
  })
})

describe('index --reset-cache', () => {
  it('removes existing cache metadata without touching normal artifacts', () => {
    const root = createFixture()
    runIncremental(root)
    expect(existsSync(join(root, 'cache-out', 'cache-metadata.json'))).toBe(true)

    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'cache-out', '--reset-cache', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.cacheReset).toEqual({
      requested: true,
      existed: true,
      path: expect.stringContaining('cache-metadata.json'),
    })
    expect(existsSync(join(root, 'cache-out', 'cache-metadata.json'))).toBe(false)
    expect(existsSync(join(root, 'cache-out', 'manifest.json'))).toBe(true)
    expect(existsSync(join(root, 'cache-out', 'symbol-index.json'))).toBe(true)
  })

  it('succeeds when no cache metadata exists', () => {
    const root = createFixture()

    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'cache-out', '--reset-cache', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.cacheReset).toEqual({
      requested: true,
      existed: false,
      path: expect.stringContaining('cache-metadata.json'),
    })
  })

  it('resets then performs a safe initial incremental run when combined with --incremental', () => {
    const root = createFixture()
    runIncremental(root)

    const result = runCli([
      'index',
      '--root',
      root,
      '--src',
      'src',
      '--out',
      'cache-out',
      '--reset-cache',
      '--incremental',
      '--json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.cacheReset.existed).toBe(true)
    expect(parsed.cache.requested).toBe(true)
    expect(parsed.cache.mode).toBe('incremental-full-initial')
  })
})

describe('index (non-incremental) with cache-related fields', () => {
  it('reports mode full and does not write cache metadata', () => {
    const root = createFixture()
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'plain-out', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.cache).toEqual({
      requested: false,
      mode: 'full',
      cacheMetadataPath: expect.stringContaining('cache-metadata.json'),
      invalidationReason: null,
      changedFileSummary: null,
      partialRebuildFallbackArtifacts: [],
    })
    expect(parsed.cacheReset).toBeNull()
    expect(existsSync(join(root, 'plain-out', 'cache-metadata.json'))).toBe(false)
    expect(parsed.manifest.indexMode).toBe('full')
  })

  it('still supports --dry-run writing no normal artifacts', () => {
    const root = createFixture()
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'dry-out', '--dry-run', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.mode).toBe('dry-run')
    expect(existsSync(join(root, 'dry-out', 'manifest.json'))).toBe(false)
    expect(existsSync(join(root, 'dry-out', 'cache-metadata.json'))).toBe(false)
  })

  it('still keeps --progress JSON stdout parseable', () => {
    const root = createFixture()
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'progress-out', '--incremental', '--progress', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.mode).toBe('index')
    expect(result.stderr).toContain('[my-dev-kit:index]')
  })
})
