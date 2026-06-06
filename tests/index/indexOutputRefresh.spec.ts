import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-index-refresh-'))
  tempDirs.push(root)
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'helper.ts'), 'export function helper(): string { return "one" }\n')
  writeFileSync(join(src, 'index.ts'), "import { helper } from './helper'\nexport function run(): string { return helper() }\n")
  return root
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('index output refresh', () => {
  it('uses .my-dev-kit as the stable default output directory', () => {
    const root = createFixture()

    const result = runCli(['index', '--root', root, '--src', 'src', '--json'])

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.outputDir).toContain('.my-dev-kit')
    expect(existsSync(join(root, '.my-dev-kit', 'manifest.json'))).toBe(true)
  })

  it('refreshes managed artifacts when indexing the same output directory twice', () => {
    const root = createFixture()
    const outDir = join(root, '.my-dev-kit')

    const first = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
    expect(first.status).toBe(0)
    const firstSymbolIndex = readJson<{ symbolCount: number }>(join(outDir, 'symbol-index.json'))

    writeFileSync(join(root, 'src', 'second.ts'), 'export const second = 2\n')

    const second = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
    expect(second.status).toBe(0)
    const secondSymbolIndex = readJson<{ symbolCount: number; files: Array<{ path: string }> }>(
      join(outDir, 'symbol-index.json')
    )

    expect(secondSymbolIndex.symbolCount).toBeGreaterThan(firstSymbolIndex.symbolCount)
    expect(secondSymbolIndex.files.some((file) => file.path === 'src/second.ts')).toBe(true)
  })

  it('preserves custom output directories', () => {
    const root = createFixture()

    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'custom-artifacts', '--json'])

    expect(result.status).toBe(0)
    expect(existsSync(join(root, 'custom-artifacts', 'manifest.json'))).toBe(true)
    expect(existsSync(join(root, '.my-dev-kit', 'manifest.json'))).toBe(false)
  })

  it('preserves unknown files and folders inside the output directory', () => {
    const root = createFixture()
    const outDir = join(root, '.my-dev-kit')
    mkdirSync(join(outDir, 'notes'), { recursive: true })
    writeFileSync(join(outDir, 'user-note.txt'), 'keep me\n')
    writeFileSync(join(outDir, 'notes', 'audit.txt'), 'keep folder\n')

    const result = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])

    expect(result.status).toBe(0)
    expect(readFileSync(join(outDir, 'user-note.txt'), 'utf8')).toBe('keep me\n')
    expect(readFileSync(join(outDir, 'notes', 'audit.txt'), 'utf8')).toBe('keep folder\n')
  })

  it('removes stale call-graph.json when the next run does not request a call graph', () => {
    const root = createFixture()
    const outDir = join(root, '.my-dev-kit')

    const withCallGraph = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--call-graph', '--json'])
    expect(withCallGraph.status).toBe(0)
    expect(existsSync(join(outDir, 'call-graph.json'))).toBe(true)

    const withoutCallGraph = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
    expect(withoutCallGraph.status).toBe(0)
    const parsed = JSON.parse(withoutCallGraph.stdout)
    const manifest = readJson<{ artifacts: { callGraph: string | null } }>(join(outDir, 'manifest.json'))

    expect(existsSync(join(outDir, 'call-graph.json'))).toBe(false)
    expect(manifest.artifacts.callGraph).toBeNull()
    expect(parsed.callGraphPath).toBeNull()
    expect(parsed.managedArtifacts.removed).toContain('call-graph.json')
  })

  it('does not write or clean artifacts in dry-run mode', () => {
    const root = createFixture()
    const outDir = join(root, 'dry-run-out')
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'manifest.json'), 'old manifest\n')
    writeFileSync(join(outDir, 'call-graph.json'), 'old call graph\n')

    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'dry-run-out', '--dry-run', '--json'])

    expect(result.status).toBe(0)
    expect(readFileSync(join(outDir, 'manifest.json'), 'utf8')).toBe('old manifest\n')
    expect(readFileSync(join(outDir, 'call-graph.json'), 'utf8')).toBe('old call graph\n')
  })
})
