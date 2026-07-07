import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const JAVA_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'java', 'basic')
const KOTLIN_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'kotlin', 'basic')
const ANDROID_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'android', 'basic-java-app')
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
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-java-${label}-`))
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

describe('Java structural indexing', () => {
  it('writes Java symbols into symbol-index.json', () => {
    const root = copyFixture(JAVA_FIXTURE, 'basic')
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'out', '--json'])
    expect(result.status).toBe(0)

    const symbolIndex = JSON.parse(readFileSync(join(root, 'out', 'symbol-index.json'), 'utf8'))
    const modelsFile = symbolIndex.files.find((f: { path: string }) => f.path === 'src/Models.java')
    expect(modelsFile.language).toBe('java')
    const byName = Object.fromEntries(modelsFile.symbols.map((s: { name: string; kind: string }) => [s.name, s.kind]))
    expect(byName.User).toBe('class')
    expect(byName.Result).toBe('interface')
    expect(byName.Repository).toBe('interface')
    expect(byName.UserService).toBe('class')
    expect(byName.Status).toBe('enum')
    expect(byName.Important).toBe('interface')

    const extrasFile = symbolIndex.files.find((f: { path: string }) => f.path === 'src/Extras.java')
    expect(extrasFile.symbols.map((s: { name: string }) => s.name)).toEqual(
      expect.arrayContaining(['BaseWidget', 'ExtendedWidget'])
    )
  })

  it('writes Java file and symbol nodes into code-graph.json', () => {
    const root = copyFixture(JAVA_FIXTURE, 'basic')
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'out', '--json'])
    expect(result.status).toBe(0)

    const codeGraph = JSON.parse(readFileSync(join(root, 'out', 'code-graph.json'), 'utf8'))
    expect(codeGraph.nodes.some((n: { id: string }) => n.id === 'file:src/Models.java')).toBe(true)
    const userNode = codeGraph.nodes.find((n: { id: string }) => n.id === 'symbol:src/Models.java#User')
    expect(userNode).toBeTruthy()
    expect(userNode.symbolKind).toBe('class')
    expect(
      codeGraph.edges.some(
        (e: { source: string; target: string; kind: string }) =>
          e.source === 'file:src/Models.java' && e.target === 'symbol:src/Models.java#User' && e.kind === 'defines'
      )
    ).toBe(true)
  })

  it('search finds Java symbol names', () => {
    const root = copyFixture(JAVA_FIXTURE, 'basic')
    runCli(['index', '--root', root, '--src', 'src', '--out', 'out', '--json'])

    const result = runCli(['search', '--index', join(root, 'out'), '--query', 'UserService', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.results.some((r: { nodeId: string }) => r.nodeId === 'symbol:src/Models.java#UserService')).toBe(true)
  })

  it('lookup works for a Java symbol node', () => {
    const root = copyFixture(JAVA_FIXTURE, 'basic')
    runCli(['index', '--root', root, '--src', 'src', '--out', 'out', '--json'])

    const result = runCli(['lookup', '--index', join(root, 'out'), '--node', 'symbol:src/Models.java#UserService', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('found')
    expect(parsed.node.symbolKind).toBe('class')
  })

  it('source retrieves Java symbol source by node', () => {
    const root = copyFixture(JAVA_FIXTURE, 'basic')
    runCli(['index', '--root', root, '--src', 'src', '--out', 'out', '--json'])

    const result = runCli(['source', '--index', join(root, 'out'), '--node', 'symbol:src/Models.java#UserService', '--format', 'numbered'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('UserService')
  })

  it('slice includes the Java symbol neighborhood', () => {
    const root = copyFixture(JAVA_FIXTURE, 'basic')
    runCli(['index', '--root', root, '--src', 'src', '--out', 'out', '--json'])

    const result = runCli(['slice', '--index', join(root, 'out'), '--node', 'symbol:src/Models.java#UserService', '--depth', '1', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.nodes.some((n: { id: string }) => n.id === 'file:src/Models.java')).toBe(true)
  })

  it('has both android-project.json and Java symbols for the basic-java-app Android fixture', () => {
    const root = copyFixture(ANDROID_FIXTURE, 'android-app')
    const result = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', 'out', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.androidProjectPath).toBeTruthy()
    const androidProject = JSON.parse(readFileSync(join(root, 'out', 'android-project.json'), 'utf8'))
    expect(androidProject.detected).toBe(true)
    expect(androidProject.modules[0].type).toBe('app')

    const symbolIndex = JSON.parse(readFileSync(join(root, 'out', 'symbol-index.json'), 'utf8'))
    expect(symbolIndex.files.some((f: { path: string }) => f.path.endsWith('MainActivity.java'))).toBe(true)
    expect(symbolIndex.files.some((f: { path: string }) => f.path.endsWith('ExampleRepository.java'))).toBe(true)
  })

  it('still indexes the Kotlin Batch 2 fixture correctly (Java addition does not regress Kotlin)', () => {
    const root = copyFixture(KOTLIN_FIXTURE, 'kotlin-regress')
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', 'out', '--json'])
    expect(result.status).toBe(0)

    const symbolIndex = JSON.parse(readFileSync(join(root, 'out', 'symbol-index.json'), 'utf8'))
    const modelsFile = symbolIndex.files.find((f: { path: string }) => f.path === 'src/Models.kt')
    expect(modelsFile.language).toBe('kotlin')
    expect(modelsFile.symbols.some((s: { name: string }) => s.name === 'User')).toBe(true)
  })

  it('ignores .java files under a generated build-output directory', () => {
    const root = copyFixture(GENERATED_BUILD_FIXTURE, 'generated')
    const result = runCli(['index', '--root', root, '--src', 'app', '--out', 'out', '--json'])
    expect(result.status).toBe(0)

    const symbolIndex = JSON.parse(readFileSync(join(root, 'out', 'symbol-index.json'), 'utf8'))
    expect(symbolIndex.files.some((f: { path: string }) => f.path.includes('Generated.java'))).toBe(false)
    expect(symbolIndex.files.some((f: { path: string }) => f.path.endsWith('MainActivity.kt'))).toBe(true)
  })
})
