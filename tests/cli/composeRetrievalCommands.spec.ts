import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const FIXTURES_ROOT = join(process.cwd(), 'tests', 'fixtures', 'compose-retrieval')
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
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-compose-retrieval-${name}-`))
  tempDirs.push(root)
  cpSync(join(FIXTURES_ROOT, name), root, { recursive: true })
  return root
}

function indexInto(root: string, out = 'out') {
  const result = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', out, '--json'])
  expect(result.status).toBe(0)
  return join(root, out)
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('source --composable', () => {
  it('returns bounded source for a uniquely-resolved composable', () => {
    const root = copyFixture('basic-app')
    const indexDir = indexInto(root)
    const result = runCli(['source', '--index', indexDir, '--composable', 'ChildScreen', '--format', 'json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('ok')
    expect(parsed.result.androidMetadata.factKind).toBe('composable')
    expect(parsed.result.slice.content).toContain('ChildScreen')
  })

  it('returns not-found for a nonexistent composable', () => {
    const root = copyFixture('basic-app')
    const indexDir = indexInto(root)
    const result = runCli(['source', '--index', indexDir, '--composable', 'DoesNotExist', '--format', 'json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('not-found')
  })

  it('rejects --composable combined with --node', () => {
    const root = copyFixture('basic-app')
    const indexDir = indexInto(root)
    const result = runCli(['source', '--index', indexDir, '--composable', 'HomeScreen', '--node', 'file:x'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('--composable')
  })
})

describe('source --composable --include-compose-tree', () => {
  it('includes the root and its direct + transitive children, deterministic across two runs', () => {
    const root = copyFixture('basic-app')
    const indexDir = indexInto(root)
    const args = [
      'source',
      '--index',
      indexDir,
      '--composable',
      'HomeScreen',
      '--include-compose-tree',
      '--max-bundle-lines',
      '200',
      '--max-blocks',
      '10',
      '--format',
      'json',
    ]
    const result1 = runCli(args)
    const result2 = runCli(args)
    expect(result1.status).toBe(0)
    const parsed1 = JSON.parse(result1.stdout)
    const parsed2 = JSON.parse(result2.stdout)
    expect(parsed1.status).toBe('ok')
    expect(parsed1.tree.rootComposable.name).toBe('HomeScreen')
    const blockOwners = parsed1.tree.includedBlocks.map((b: { owner: string }) => b.owner)
    expect(blockOwners[0]).toBe('HomeScreen')
    expect(blockOwners).toContain('ChildScreen')
    expect(parsed1).toEqual(parsed2)
  })

  it('requires --composable', () => {
    const root = copyFixture('basic-app')
    const indexDir = indexInto(root)
    const result = runCli(['source', '--index', indexDir, '--include-compose-tree', '--format', 'json'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('--include-compose-tree')
  })
})

describe('source --android-ui', () => {
  it('finds an exact visible-text match', () => {
    const root = copyFixture('basic-app')
    const indexDir = indexInto(root)
    const result = runCli(['source', '--index', indexDir, '--android-ui', 'Welcome back', '--format', 'json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('ok')
    expect(parsed.result.androidMetadata.factKind).toBe('visible-text')
  })

  it('finds an exact string-resource key match', () => {
    const root = copyFixture('basic-app')
    const indexDir = indexInto(root)
    const result = runCli(['source', '--index', indexDir, '--android-ui', 'greeting', '--format', 'json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('ok')
    expect(parsed.result.androidMetadata.factKind).toBe('string-resource')
  })

  it('returns not-found for text that does not appear verbatim', () => {
    const root = copyFixture('basic-app')
    const indexDir = indexInto(root)
    const result = runCli(['source', '--index', indexDir, '--android-ui', 'nonexistent text', '--format', 'json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('not-found')
  })
})

describe('source --test-tag', () => {
  it('finds a resolved test tag exactly', () => {
    const root = copyFixture('basic-app')
    const indexDir = indexInto(root)
    const result = runCli(['source', '--index', indexDir, '--test-tag', 'login_button', '--format', 'json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('ok')
    expect(parsed.result.androidMetadata.resolvedValue).toBe('login_button')
  })

  it('returns not-found for a nonexistent tag', () => {
    const root = copyFixture('basic-app')
    const indexDir = indexInto(root)
    const result = runCli(['source', '--index', indexDir, '--test-tag', 'nope', '--format', 'json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('not-found')
  })
})

describe('slice --composable', () => {
  it('slices around a uniquely-resolved composable using the existing graph engine', () => {
    const root = copyFixture('basic-app')
    const indexDir = indexInto(root)
    const result = runCli(['slice', '--index', indexDir, '--composable', 'HomeScreen', '--depth', '1', '--direction', 'both', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.androidSelector.mode).toBe('composable')
    expect(parsed.nodes.some((n: { kind: string }) => n.kind === 'android-composable')).toBe(true)
    expect(parsed.edges.some((e: { kind: string }) => e.kind === 'composable-has-fact')).toBe(true)
  })

  it('extends reachability with --include-viewmodel', () => {
    const root = copyFixture('basic-app')
    const indexDir = indexInto(root)
    const result = runCli([
      'slice',
      '--index',
      indexDir,
      '--composable',
      'HomeScreen',
      '--include-viewmodel',
      '--depth',
      '1',
      '--direction',
      'both',
      '--json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.edges.some((e: { kind: string }) => e.kind === 'composable-references-viewmodel')).toBe(true)
  })

  it('extends reachability with --include-navigation', () => {
    const root = copyFixture('basic-app')
    const indexDir = indexInto(root)
    const result = runCli([
      'slice',
      '--index',
      indexDir,
      '--composable',
      'HomeScreen',
      '--include-navigation',
      '--depth',
      '1',
      '--direction',
      'both',
      '--json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.edges.some((e: { kind: string }) => e.kind === 'click-handler-contains-navigation-call' || e.kind === 'compose-navigation-targets-route')).toBe(true)
  })

  it('rejects --include-viewmodel without --composable', () => {
    const root = copyFixture('basic-app')
    const indexDir = indexInto(root)
    const result = runCli(['slice', '--index', indexDir, '--node', 'file:x', '--include-viewmodel', '--json'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('--include-viewmodel')
  })
})

describe('search --composable / --test-tag / --android-ui', () => {
  it('finds a composable by exact name', () => {
    const root = copyFixture('basic-app')
    const indexDir = indexInto(root)
    const result = runCli(['search', '--index', indexDir, '--composable', 'HomeScreen', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('ok')
    expect(parsed.results).toHaveLength(1)
    expect(parsed.results[0].kind).toBe('android-composable')
  })

  it('finds a resolved test tag', () => {
    const root = copyFixture('basic-app')
    const indexDir = indexInto(root)
    const result = runCli(['search', '--index', indexDir, '--test-tag', 'login_button', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.results).toHaveLength(1)
  })

  it('rejects --composable combined with --query', () => {
    const root = copyFixture('basic-app')
    const indexDir = indexInto(root)
    const result = runCli(['search', '--index', indexDir, '--composable', 'HomeScreen', '--query', 'x'])
    expect(result.status).not.toBe(0)
  })

  it('also discovers composable evidence through generic keyword search', () => {
    const root = copyFixture('basic-app')
    const indexDir = indexInto(root)
    const result = runCli(['search', '--index', indexDir, '--query', 'HomeScreen', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.results.some((r: { kind: string }) => r.kind === 'android-composable')).toBe(true)
  })
})

describe('lookup --node for a projected Compose node', () => {
  it('returns the code-graph node with compact metadata and edges, no raw artifact payload', () => {
    const root = copyFixture('basic-app')
    const indexDir = indexInto(root)
    const searchResult = runCli(['search', '--index', indexDir, '--composable', 'HomeScreen', '--json'])
    const nodeId = JSON.parse(searchResult.stdout).results[0].graphNodeId
    const result = runCli(['lookup', '--index', indexDir, '--node', nodeId, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.node.id).toBe(nodeId)
    expect(parsed.node.androidMetadata.factKind).toBe('composable')
    expect(Array.isArray(parsed.incomingEdges) || Array.isArray(parsed.outgoingEdges) || Array.isArray(parsed.neighbors)).toBe(true)
    expect(parsed).not.toHaveProperty('declarations')
    expect(parsed).not.toHaveProperty('stateFacts')
  })
})
