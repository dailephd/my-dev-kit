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
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-index-'))
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

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('index command', () => {
  it('requires a valid --src', () => {
    const root = createFixture()
    const result = runCli(['index', '--root', root, '--src', 'missing'])

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Source root does not exist or is not a directory: missing')
  })

  it('writes manifest, symbol index, and code graph artifacts', () => {
    const root = createFixture()
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'artifacts'])

    expect(result.status).toBe(0)
    expect(existsSync(join(root, 'artifacts', 'manifest.json'))).toBe(true)
    expect(existsSync(join(root, 'artifacts', 'symbol-index.json'))).toBe(true)
    expect(existsSync(join(root, 'artifacts', 'code-graph.json'))).toBe(true)
  })

  it('respects --out and prints valid JSON with --json', () => {
    const root = createFixture()
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'custom-out', '--json'])

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.outputDir).toContain('custom-out')
    expect(parsed.manifest.artifacts.symbolIndex).toBe('symbol-index.json')
    expect(existsSync(join(root, 'custom-out', 'manifest.json'))).toBe(true)
  })

  it('writes a call graph when --call-graph is requested', () => {
    const root = createFixture()
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'callgraph-out', '--call-graph', '--json'])

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.manifest.callGraphEnabled).toBe(true)
    expect(parsed.manifest.artifacts.callGraph).toBe('call-graph.json')
    expect(existsSync(join(root, 'callgraph-out', 'call-graph.json'))).toBe(true)
  })

  it('skips default generated and dependency directories during indexing', () => {
    const root = createFixture()
    mkdirSync(join(root, 'src', 'node_modules', 'pkg'), { recursive: true })
    mkdirSync(join(root, 'src', '.next'), { recursive: true })
    mkdirSync(join(root, 'src', 'coverage'), { recursive: true })
    mkdirSync(join(root, 'src', '__pycache__'), { recursive: true })
    writeFileSync(join(root, 'src', 'node_modules', 'pkg', 'ignored.ts'), 'export const ignoredNodeModules = 1\n')
    writeFileSync(join(root, 'src', '.next', 'ignored.ts'), 'export const ignoredNext = 1\n')
    writeFileSync(join(root, 'src', 'coverage', 'ignored.ts'), 'export const ignoredCoverage = 1\n')
    writeFileSync(join(root, 'src', '__pycache__', 'ignored.py'), 'def ignored_pycache(): pass\n')

    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'ignored-out', '--json'])

    expect(result.status).toBe(0)
    const symbolIndex = JSON.parse(readFileSync(join(root, 'ignored-out', 'symbol-index.json'), 'utf8'))
    const paths = symbolIndex.files.map((file: { path: string }) => file.path)
    expect(paths.some((filePath: string) => filePath.includes('node_modules'))).toBe(false)
    expect(paths.some((filePath: string) => filePath.includes('.next'))).toBe(false)
    expect(paths.some((filePath: string) => filePath.includes('coverage'))).toBe(false)
    expect(paths.some((filePath: string) => filePath.includes('__pycache__'))).toBe(false)
  })

  it('applies repeated --exclude values by directory name and relative path prefix', () => {
    const root = createFixture()
    mkdirSync(join(root, 'src', 'generated'), { recursive: true })
    mkdirSync(join(root, 'src', 'fixtures'), { recursive: true })
    writeFileSync(join(root, 'src', 'generated', 'ignored.ts'), 'export const ignoredGenerated = 1\n')
    writeFileSync(join(root, 'src', 'fixtures', 'ignored.ts'), 'export const ignoredFixture = 1\n')

    const result = runCli([
      'index',
      '--root',
      root,
      '--src',
      'src',
      '--out',
      'exclude-out',
      '--exclude',
      'generated',
      '--exclude',
      'src\\fixtures',
      '--json',
    ])

    expect(result.status).toBe(0)
    const symbolIndex = JSON.parse(readFileSync(join(root, 'exclude-out', 'symbol-index.json'), 'utf8'))
    const paths = symbolIndex.files.map((file: { path: string }) => file.path)
    expect(paths.some((filePath: string) => filePath.includes('generated'))).toBe(false)
    expect(paths.some((filePath: string) => filePath.includes('fixtures'))).toBe(false)
  })

  it('supports dry-run JSON without writing artifacts', () => {
    const root = createFixture()
    mkdirSync(join(root, 'src', '.next'), { recursive: true })
    writeFileSync(join(root, 'src', '.next', 'ignored.ts'), 'export const ignored = 1\n')

    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'dry-run-out', '--dry-run', '--json'])

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.mode).toBe('dry-run')
    expect(parsed.totalFilesEligibleForIndexing).toBeGreaterThan(0)
    expect(parsed.skippedByDefaultIgnore).toBeGreaterThan(0)
    expect(Array.isArray(parsed.sampleSkippedFiles)).toBe(true)
    expect(existsSync(join(root, 'dry-run-out', 'manifest.json'))).toBe(false)
    expect(existsSync(join(root, 'dry-run-out', 'symbol-index.json'))).toBe(false)
    expect(existsSync(join(root, 'dry-run-out', 'code-graph.json'))).toBe(false)
  })

  it('prints progress to stderr without corrupting JSON stdout', () => {
    const root = createFixture()
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'progress-out', '--progress', '--json'])

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.mode).toBe('index')
    expect(result.stderr).toContain('[my-dev-kit:index]')
  })
})
