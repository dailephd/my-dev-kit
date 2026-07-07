import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const KOTLIN_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'kotlin', 'basic')
const ANDROID_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'android', 'basic-kotlin-app')
const GENERATED_BUILD_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'android', 'generated-build-output')
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

function copyFixture(source: string, label: string): string {
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-kotlin-${label}-`))
  tempDirs.push(root)
  cpSync(source, root, { recursive: true })
  return root
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('Kotlin structural indexing', () => {
  it('writes Kotlin symbols into symbol-index.json', () => {
    const root = copyFixture(KOTLIN_FIXTURE, 'basic')
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'out', '--json'])
    expect(result.status).toBe(0)

    const symbolIndex = JSON.parse(readFileSync(join(root, 'out', 'symbol-index.json'), 'utf8'))
    const modelsFile = symbolIndex.files.find((f: { path: string }) => f.path === 'src/Models.kt')
    expect(modelsFile.language).toBe('kotlin')
    const names = modelsFile.symbols.map((s: { name: string }) => s.name)
    expect(names).toEqual(
      expect.arrayContaining(['User', 'Result', 'Repository', 'Registry', 'Status', 'UserService', 'state', 'observeUsers'])
    )
    const byName = Object.fromEntries(modelsFile.symbols.map((s: { name: string; kind: string }) => [s.name, s.kind]))
    expect(byName.User).toBe('class')
    expect(byName.Repository).toBe('interface')
    expect(byName.Registry).toBe('object')
    expect(byName.Status).toBe('enum')

    const extensionsFile = symbolIndex.files.find((f: { path: string }) => f.path === 'src/Extensions.kt')
    const extNames = extensionsFile.symbols.map((s: { name: string }) => s.name)
    expect(extNames).toEqual(expect.arrayContaining(['toSlug', 'fetchUser']))
  })

  it('writes Kotlin file/symbol nodes into code-graph.json', () => {
    const root = copyFixture(KOTLIN_FIXTURE, 'basic')
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'out', '--json'])
    expect(result.status).toBe(0)

    const codeGraph = JSON.parse(readFileSync(join(root, 'out', 'code-graph.json'), 'utf8'))
    expect(codeGraph.nodes.some((n: { id: string }) => n.id === 'file:src/Models.kt')).toBe(true)
    expect(codeGraph.nodes.some((n: { id: string }) => n.id === 'symbol:src/Models.kt#User')).toBe(true)
    const userNode = codeGraph.nodes.find((n: { id: string }) => n.id === 'symbol:src/Models.kt#User')
    expect(userNode.symbolKind).toBe('class')
    expect(
      codeGraph.edges.some(
        (e: { source: string; target: string; kind: string }) =>
          e.source === 'file:src/Models.kt' && e.target === 'symbol:src/Models.kt#User' && e.kind === 'defines'
      )
    ).toBe(true)
  })

  it('search finds Kotlin symbol names', () => {
    const root = copyFixture(KOTLIN_FIXTURE, 'basic')
    runCli(['index', '--root', root, '--src', 'src', '--out', 'out', '--json'])

    const result = runCli(['search', '--index', join(root, 'out'), '--query', 'UserService', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.results.some((r: { nodeId: string }) => r.nodeId === 'symbol:src/Models.kt#UserService')).toBe(true)
  })

  it('lookup works for a Kotlin symbol node', () => {
    const root = copyFixture(KOTLIN_FIXTURE, 'basic')
    runCli(['index', '--root', root, '--src', 'src', '--out', 'out', '--json'])

    const result = runCli(['lookup', '--index', join(root, 'out'), '--node', 'symbol:src/Models.kt#UserService', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('found')
    expect(parsed.node.symbolKind).toBe('class')
  })

  it('source retrieves Kotlin symbol source by node', () => {
    const root = copyFixture(KOTLIN_FIXTURE, 'basic')
    runCli(['index', '--root', root, '--src', 'src', '--out', 'out', '--json'])

    const result = runCli(['source', '--index', join(root, 'out'), '--node', 'symbol:src/Models.kt#UserService', '--format', 'numbered'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('class UserService')
  })

  it('slice includes the Kotlin symbol neighborhood', () => {
    const root = copyFixture(KOTLIN_FIXTURE, 'basic')
    runCli(['index', '--root', root, '--src', 'src', '--out', 'out', '--json'])

    const result = runCli([
      'slice',
      '--index',
      join(root, 'out'),
      '--node',
      'symbol:src/Models.kt#UserService',
      '--depth',
      '1',
      '--json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.nodes.some((n: { id: string }) => n.id === 'file:src/Models.kt')).toBe(true)
  })

  it('keeps the Android detection artifact present alongside Kotlin symbol indexing', () => {
    const root = copyFixture(ANDROID_FIXTURE, 'android-app')
    const result = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', 'out', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.androidProjectPath).toBeTruthy()
    const androidProject = JSON.parse(readFileSync(join(root, 'out', 'android-project.json'), 'utf8'))
    expect(androidProject.detected).toBe(true)
    expect(androidProject.modules[0].type).toBe('app')

    const symbolIndex = JSON.parse(readFileSync(join(root, 'out', 'symbol-index.json'), 'utf8'))
    expect(symbolIndex.files.some((f: { path: string }) => f.path.endsWith('MainActivity.kt'))).toBe(true)
  })

  it('ignores .kt files under a generated build-output directory', () => {
    const root = copyFixture(GENERATED_BUILD_FIXTURE, 'generated')
    const result = runCli(['index', '--root', root, '--src', 'app', '--out', 'out', '--json'])
    expect(result.status).toBe(0)

    const symbolIndex = JSON.parse(readFileSync(join(root, 'out', 'symbol-index.json'), 'utf8'))
    expect(symbolIndex.files.some((f: { path: string }) => f.path.includes('GeneratedStray'))).toBe(false)
    expect(symbolIndex.files.some((f: { path: string }) => f.path.endsWith('MainActivity.kt'))).toBe(true)
  })
})
