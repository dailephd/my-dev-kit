import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadLookupArtifacts } from '../../src/indexing/loadIndexArtifacts.js'
import { readIndexManifest } from '../../src/indexing/readIndexManifest.js'
import { runCli } from '../lookup/testCli.js'

const tempDirs: string[] = []

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-manifest-registry-'))
  tempDirs.push(root)
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'userTypes.ts'), 'export interface User { id: string; name: string }\n')
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

function indexFixture(root: string): string {
  const result = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
  expect(result.status).toBe(0)
  return join(root, '.my-dev-kit')
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function moveCurrentArtifactsToRegistrySubdir(indexDir: string): void {
  const manifestPath = join(indexDir, 'manifest.json')
  const manifest = readJson<{ artifacts: { symbolIndex: string; codeGraph: string; callGraph: string | null } }>(
    manifestPath
  )
  mkdirSync(join(indexDir, 'registry'), { recursive: true })
  renameSync(join(indexDir, 'symbol-index.json'), join(indexDir, 'registry', 'symbol-index.current.json'))
  renameSync(join(indexDir, 'code-graph.json'), join(indexDir, 'registry', 'code-graph.current.json'))
  manifest.artifacts.symbolIndex = 'registry/symbol-index.current.json'
  manifest.artifacts.codeGraph = 'registry/code-graph.current.json'
  manifest.artifacts.callGraph = null
  writeJson(manifestPath, manifest)
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('manifest artifact registry', () => {
  it('resolves current artifacts from manifest-declared paths and ignores stale root files', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    moveCurrentArtifactsToRegistrySubdir(indexDir)
    writeFileSync(join(indexDir, 'symbol-index.json'), '{ stale symbol index', 'utf8')
    writeFileSync(join(indexDir, 'code-graph.json'), '{ stale code graph', 'utf8')
    writeFileSync(join(indexDir, 'call-graph.json'), '{ stale call graph', 'utf8')
    writeFileSync(join(indexDir, 'user-note.txt'), 'unknown user file\n', 'utf8')

    const resolved = readIndexManifest(indexDir)
    expect(resolved.artifactPaths.symbolIndex).toContain('registry')
    expect(resolved.artifactPaths.codeGraph).toContain('registry')
    expect(resolved.artifactPaths.callGraph).toBeNull()

    const search = runCli(['search', '--index', indexDir, '--query', 'describeUser', '--json'])
    expect(search.status).toBe(0)
    expect(JSON.parse(search.stdout).results.some((item: { id: string }) => item.id.includes('describeUser'))).toBe(true)

    const lookup = runCli(['lookup', '--index', indexDir, '--node', 'file:src/index.ts', '--json'])
    expect(lookup.status).toBe(0)
    expect(JSON.parse(lookup.stdout).artifactPaths.codeGraph).toContain('registry/code-graph.current.json')

    const source = runCli(['source', '--index', indexDir, '--node', 'symbol:src/index.ts#describeUser', '--format', 'json'])
    expect(source.status).toBe(0)
    expect(JSON.parse(source.stdout).symbolName).toBe('describeUser')

    const slice = runCli(['slice', '--index', indexDir, '--node', 'file:src/index.ts', '--json'])
    expect(slice.status).toBe(0)
    expect(JSON.parse(slice.stdout).artifactPaths.codeGraph).toContain('registry/code-graph.current.json')

    const view = runCli(['view', '--index', indexDir, '--format', 'dot', '--out', join(indexDir, 'graph.dot')])
    expect(view.status).toBe(0)
    expect(existsSync(join(indexDir, 'graph.dot'))).toBe(true)
    expect(readFileSync(join(indexDir, 'user-note.txt'), 'utf8')).toBe('unknown user file\n')
  })

  it('does not load stale call-graph.json when manifest does not reference it', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    writeFileSync(join(indexDir, 'call-graph.json'), '{ stale call graph', 'utf8')

    const resolved = readIndexManifest(indexDir)
    expect(resolved.manifest.artifacts.callGraph).toBeNull()
    expect(resolved.artifactPaths.callGraph).toBeNull()
    expect(() => loadLookupArtifacts(indexDir)).not.toThrow()
  })

  it('fails clearly when a required manifest artifact is missing', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    const manifestPath = join(indexDir, 'manifest.json')
    const manifest = readJson<{ artifacts: { codeGraph: string } }>(manifestPath)
    manifest.artifacts.codeGraph = 'missing-code-graph.json'
    writeJson(manifestPath, manifest)

    expect(() => loadLookupArtifacts(indexDir)).toThrow('Missing required code graph artifact')
  })

  it('rejects manifest artifact paths that escape the index directory', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    const manifestPath = join(indexDir, 'manifest.json')
    const manifest = readJson<{ artifacts: { symbolIndex: string } }>(manifestPath)
    manifest.artifacts.symbolIndex = '../symbol-index.json'
    writeJson(manifestPath, manifest)

    expect(() => readIndexManifest(indexDir)).toThrow('escapes the index directory')
  })
})
