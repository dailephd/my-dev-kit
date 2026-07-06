import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
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

function createSide(root: string, name: string): string {
  const side = join(root, name)
  const src = join(side, 'src')
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
  return side
}

function indexSide(root: string): string {
  const out = join(root, '.my-dev-kit')
  const result = runCli(['index', '--root', root, '--src', 'src', '--out', out, '--json'])
  expect(result.status).toBe(0)
  return out
}

function runGraphDiff(before: string, after: string, extraArgs: string[] = []) {
  return runCli(['graph-diff', '--before', before, '--after', after, '--json', ...extraArgs])
}

function createFixturePair(root: string): { beforeOut: string; afterOut: string; beforeRoot: string; afterRoot: string } {
  const beforeRoot = createSide(root, 'before')
  const afterRoot = createSide(root, 'after')
  return { beforeOut: indexSide(beforeRoot), afterOut: indexSide(afterRoot), beforeRoot, afterRoot }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-graph-diff-'))
  tempDirs.push(root)
  return root
}

describe('graph-diff', () => {
  it('reports no differences for identical indexes', () => {
    const root = createTempRoot()
    const { beforeOut, afterOut } = createFixturePair(root)

    const result = runGraphDiff(beforeOut, afterOut)
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.summary).toEqual({
      nodesAdded: 0,
      nodesRemoved: 0,
      nodesChanged: 0,
      edgesAdded: 0,
      edgesRemoved: 0,
      edgesChanged: 0,
      filesAdded: 0,
      filesRemoved: 0,
      filesChanged: 0,
      symbolsAdded: 0,
      symbolsRemoved: 0,
      symbolsChanged: 0,
    })
    expect(parsed.nodes.added).toEqual([])
    expect(parsed.edges.added).toEqual([])
  })

  it('reports added file and symbol nodes/edges for an added-file fixture', () => {
    const root = createTempRoot()
    const { beforeOut, afterRoot, afterOut: staleAfterOut } = createFixturePair(root)
    writeFileSync(join(afterRoot, 'src', 'extra.ts'), 'export function extra(): number { return 1 }\n')
    const afterOut = indexSide(afterRoot)
    expect(afterOut).toBe(staleAfterOut)

    const result = runGraphDiff(beforeOut, afterOut)
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.summary.nodesAdded).toBe(2)
    expect(parsed.nodes.added.map((n: { id: string }) => n.id)).toEqual(['file:src/extra.ts', 'symbol:src/extra.ts#extra'])
    expect(parsed.edges.added.map((e: { id: string }) => e.id)).toEqual([
      'file:src/extra.ts--defines-->symbol:src/extra.ts#extra',
      'file:src/extra.ts--exports-->symbol:src/extra.ts#extra',
    ])
    expect(parsed.symbolIndex.filesAdded).toEqual(['src/extra.ts'])
    expect(parsed.symbolIndex.symbolsAdded).toEqual(['symbol:src/extra.ts#extra'])
  }, 60000)

  it('reports removed file and symbol nodes/edges for a removed-file fixture', () => {
    const root = createTempRoot()
    const beforeRoot = createSide(root, 'before')
    writeFileSync(join(beforeRoot, 'src', 'extra.ts'), 'export function extra(): number { return 1 }\n')
    const beforeOut = indexSide(beforeRoot)
    const afterRoot = createSide(root, 'after')
    const afterOut = indexSide(afterRoot)

    const result = runGraphDiff(beforeOut, afterOut)
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.summary.nodesRemoved).toBe(2)
    expect(parsed.nodes.removed.map((n: { id: string }) => n.id)).toEqual(['file:src/extra.ts', 'symbol:src/extra.ts#extra'])
    expect(parsed.edges.removed.map((e: { id: string }) => e.id)).toEqual([
      'file:src/extra.ts--defines-->symbol:src/extra.ts#extra',
      'file:src/extra.ts--exports-->symbol:src/extra.ts#extra',
    ])
    expect(parsed.symbolIndex.filesRemoved).toEqual(['src/extra.ts'])
  })

  it('reports a changed node when a symbol location/signature changes', () => {
    const root = createTempRoot()
    const beforeRoot = createSide(root, 'before')
    const beforeOut = indexSide(beforeRoot)
    const afterRoot = createSide(root, 'after')
    writeFileSync(
      join(afterRoot, 'src', 'userService.ts'),
      "import type { User } from './userTypes'\n\nexport function formatUser(user: User): string { return user.name }\n"
    )
    const afterOut = indexSide(afterRoot)

    const result = runGraphDiff(beforeOut, afterOut)
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    const changedSymbolNode = parsed.nodes.changed.find((n: { id: string }) => n.id === 'symbol:src/userService.ts#formatUser')
    expect(changedSymbolNode).toBeTruthy()
    expect(changedSymbolNode.changedFields).toContain('line')
  })

  it('reports added and removed edges for a changed import/dependency fixture', () => {
    const root = createTempRoot()
    const beforeRoot = createSide(root, 'before')
    const beforeOut = indexSide(beforeRoot)
    const afterRoot = createSide(root, 'after')
    writeFileSync(
      join(afterRoot, 'src', 'index.ts'),
      "export function describeUser(): string { return 'no deps' }\n"
    )
    const afterOut = indexSide(afterRoot)

    const result = runGraphDiff(beforeOut, afterOut)
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.edges.removed.map((e: { id: string }) => e.id)).toEqual(
      expect.arrayContaining([
        'file:src/index.ts--imports-->file:src/userService.ts',
        'file:src/index.ts--imports-->file:src/userTypes.ts',
      ])
    )
  })

  it('reports symbol-index unavailable gracefully when symbol-index.json is missing from one side', () => {
    const root = createTempRoot()
    const { beforeOut, afterOut } = createFixturePair(root)
    rmSync(join(afterOut, 'symbol-index.json'))

    const result = runGraphDiff(beforeOut, afterOut)
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.symbolIndex.available).toBe(false)
    expect(parsed.warnings.some((w: string) => w.includes('symbol-index.json'))).toBe(true)
  })

  it('reports a classification diff when present on both sides', () => {
    const root = createTempRoot()
    const { beforeOut, afterOut } = createFixturePair(root)

    const result = runGraphDiff(beforeOut, afterOut)
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.classification.available).toBe('both')
    expect(parsed.classification.added).toEqual([])
    expect(parsed.classification.removed).toEqual([])
  })

  it('reports classification presence difference and does not crash when classification is absent from one side', () => {
    const root = createTempRoot()
    const { beforeOut, afterOut } = createFixturePair(root)
    rmSync(join(afterOut, 'classification.json'), { force: true })

    const result = runGraphDiff(beforeOut, afterOut)
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.classification.available).toBe('before-only')
    expect(parsed.classification.added).toEqual([])
    expect(parsed.classification.removed).toEqual([])
    expect(parsed.warnings.some((w: string) => w.includes('classification.json'))).toBe(true)
  })

  it('handles a semantic artifact present on both sides', () => {
    const root = createTempRoot()
    const { beforeOut, afterOut } = createFixturePair(root)

    const result = runGraphDiff(beforeOut, afterOut)
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.semanticArtifacts.dataModel.available).toBe('both')
    expect(parsed.semanticArtifacts.dataModel.changedFields).toEqual([])
  })

  it('handles a missing optional semantic artifact gracefully (present on only one side)', () => {
    const root = createTempRoot()
    const { beforeOut, afterOut } = createFixturePair(root)
    rmSync(join(afterOut, 'frontend-semantic.json'), { force: true })
    rmSync(join(afterOut, 'frontend-reachability.json'), { force: true })

    const result = runGraphDiff(beforeOut, afterOut)
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.semanticArtifacts.frontendSemantic.available).toBe('before-only')
    expect(parsed.semanticArtifacts.frontendSemantic.changedFields).toEqual([])
    expect(parsed.warnings.some((w: string) => w.includes('frontend-semantic.json'))).toBe(true)
  })

  it('fails clearly for a missing --before directory', () => {
    const root = createTempRoot()
    const { afterOut } = createFixturePair(root)

    const result = runGraphDiff(join(root, 'does-not-exist'), afterOut)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Missing index manifest')
  })

  it('fails clearly for a missing --after directory', () => {
    const root = createTempRoot()
    const { beforeOut } = createFixturePair(root)

    const result = runGraphDiff(beforeOut, join(root, 'does-not-exist'))
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Missing index manifest')
  })

  it('fails clearly for a malformed manifest.json', () => {
    const root = createTempRoot()
    const { afterOut } = createFixturePair(root)
    const badDir = join(root, 'bad-index')
    mkdirSync(badDir, { recursive: true })
    writeFileSync(join(badDir, 'manifest.json'), 'not json')

    const result = runGraphDiff(badDir, afterOut)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Invalid JSON')
  })

  it('fails clearly when required flags are missing', () => {
    const result = runCli(['graph-diff', '--json'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('requires both --before')
  })

  it('produces deterministic JSON output across repeated runs', () => {
    const root = createTempRoot()
    const { beforeOut, afterRoot } = createFixturePair(root)
    writeFileSync(join(afterRoot, 'src', 'extra.ts'), 'export function extra(): number { return 1 }\n')
    const afterOut = indexSide(afterRoot)

    const first = runGraphDiff(beforeOut, afterOut)
    const second = runGraphDiff(beforeOut, afterOut)
    expect(first.status).toBe(0)
    expect(second.status).toBe(0)

    const stripVolatile = (raw: string) => JSON.parse(raw)
    const firstParsed = stripVolatile(first.stdout)
    const secondParsed = stripVolatile(second.stdout)
    expect(firstParsed).toEqual(secondParsed)
  }, 60000)

  it('does not modify either input index directory', () => {
    const root = createTempRoot()
    const { beforeOut, afterOut } = createFixturePair(root)
    const beforeManifestBefore = readFileSync(join(beforeOut, 'manifest.json'), 'utf8')
    const afterManifestBefore = readFileSync(join(afterOut, 'manifest.json'), 'utf8')
    const beforeMtime = statSync(join(beforeOut, 'manifest.json')).mtimeMs

    runGraphDiff(beforeOut, afterOut)

    expect(readFileSync(join(beforeOut, 'manifest.json'), 'utf8')).toBe(beforeManifestBefore)
    expect(readFileSync(join(afterOut, 'manifest.json'), 'utf8')).toBe(afterManifestBefore)
    expect(statSync(join(beforeOut, 'manifest.json')).mtimeMs).toBe(beforeMtime)
  })

  it('lists --before, --after, and --json in help output', () => {
    const result = runCli(['graph-diff', '--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('--before <index-dir>')
    expect(result.stdout).toContain('--after <index-dir>')
    expect(result.stdout).toContain('--json')
  })
})
