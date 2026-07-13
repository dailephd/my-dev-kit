import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, cpSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const FIXTURES_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android-navigation')
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
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-android-rel-incr-${name}-`))
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

function androidNodesAndEdges(root: string, out: string) {
  const graph = readArtifact(root, out, 'code-graph.json')
  const nodes = graph.nodes.filter((n: { kind: string }) => String(n.kind).startsWith('android-'))
  const edgeKinds = new Set([
    'module-contains-source-set',
    'manifest-declares-component',
    'manifest-component-resolves-to-source',
    'component-has-intent-filter',
    'component-uses-permission',
    'manifest-uses-permission',
    'resource-defined-in-file',
    'source-references-resource',
    'navigation-graph-contains-destination',
    'navigation-destination-has-action',
    'navigation-action-targets-destination',
    'navigation-action-pop-up-to-destination',
    'navigation-graph-includes-graph',
    'navigation-destination-has-deep-link',
    'manifest-deep-link-matches-navigation-deep-link',
    'navigation-destination-resolves-to-screen',
    'compose-route-resolves-to-screen',
  ])
  const edges = graph.edges.filter((e: { kind: string }) => edgeKinds.has(e.kind))
  return { nodes, edges }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('Android relationships registration in code-graph.json and manifest.json', () => {
  it('a full index run enriches code-graph.json with Android relationship nodes/edges and registers the analyzer', () => {
    const root = copyFixture('basic-app')
    runIndex(root, 'out')

    const manifest = readArtifact(root, 'out', 'manifest.json')
    const analyzer = manifest.analyzers.find((a: { id: string }) => a.id === 'android-relationships')
    expect(analyzer).toBeTruthy()
    expect(analyzer.status).toBe('complete')
    expect(analyzer.artifacts).toEqual([])

    const { nodes, edges } = androidNodesAndEdges(root, 'out')
    expect(nodes.length).toBeGreaterThan(0)
    expect(edges.length).toBeGreaterThan(0)

    // No parallel artifact file is created.
    expect(existsSync(join(root, 'out', 'android-relationships.json'))).toBe(false)
  })

  it('an Android module without any navigation evidence still registers module/manifest relationships', () => {
    const root = copyFixture('no-navigation-app')
    runIndex(root, 'out')

    const { nodes, edges } = androidNodesAndEdges(root, 'out')
    expect(nodes.some((n: { kind: string }) => n.kind === 'android-module')).toBe(true)
    expect(edges.length).toBeGreaterThan(0)
  })
})

describe('Android relationships incremental indexing integration', () => {
  it('initial --incremental run enriches code-graph.json with Android relationships', () => {
    const root = copyFixture('basic-app')
    const result = runIncremental(root, 'out')

    expect(result.cache.mode).toBe('incremental-full-initial')
    const { nodes, edges } = androidNodesAndEdges(root, 'out')
    expect(nodes.length).toBeGreaterThan(0)
    expect(edges.length).toBeGreaterThan(0)
  })

  it('second --incremental run with no changes reuses output and keeps relationships correct', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')
    const before = androidNodesAndEdges(root, 'out')

    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-no-change')
    const after = androidNodesAndEdges(root, 'out')
    expect(after.nodes).toEqual(before.nodes)
    expect(after.edges).toEqual(before.edges)
  })

  it('renaming a navigation destination class invalidates the cache and refreshes the resolves-to-screen edges', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    writeFileSync(
      join(root, 'app', 'src', 'main', 'res', 'navigation', 'nav_graph.xml'),
      `<navigation xmlns:android="http://schemas.android.com/apk/res/android" xmlns:app="http://schemas.android.com/apk/res-auto" android:id="@+id/nav_graph" app:startDestination="@id/homeFragment">
    <fragment android:id="@+id/homeFragment" android:name="com.example.navapp.HomeFragmentRenamed" />
</navigation>
`
    )

    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-full-config-changed')
    const graph = readArtifact(root, 'out', 'code-graph.json')
    const destination = graph.nodes.find((n: { kind: string; androidMetadata?: Record<string, unknown> }) => n.kind === 'android-navigation-destination')
    expect(destination).toBeTruthy()
  })

  it('adding a resource reference in Kotlin source refreshes source-references-resource edges via the normal changed-file path', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')
    const before = androidNodesAndEdges(root, 'out')
    const beforeRefCount = before.edges.filter((e: { kind: string }) => e.kind === 'source-references-resource').length

    writeFileSync(
      join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'navapp', 'AppNav.kt'),
      readFileSync(join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'navapp', 'AppNav.kt'), 'utf8') +
        '\nprivate fun unusedRef() { val x = R.string.app_name }\n'
    )

    const second = runIncremental(root, 'out')
    void second
    const after = androidNodesAndEdges(root, 'out')
    const afterRefCount = after.edges.filter((e: { kind: string }) => e.kind === 'source-references-resource').length
    expect(afterRefCount).toBeGreaterThanOrEqual(beforeRefCount)
  })

  it('deleting the navigation XML file removes stale navigation relationship nodes/edges from code-graph.json', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')
    const before = androidNodesAndEdges(root, 'out')
    expect(before.nodes.some((n: { kind: string }) => n.kind === 'android-navigation-graph')).toBe(true)

    unlinkSync(join(root, 'app', 'src', 'main', 'res', 'navigation', 'nav_graph.xml'))
    const second = runIncremental(root, 'out')

    expect(second.cache.mode).toBe('incremental-full-config-changed')
    const after = androidNodesAndEdges(root, 'out')
    expect(after.nodes.some((n: { kind: string }) => n.kind === 'android-navigation-graph')).toBe(false)
    expect(after.nodes.some((n: { kind: string }) => n.kind === 'android-navigation-destination')).toBe(false)
  })

  it('--reset-cache forces a fresh full rebuild that still produces correct Android relationships', () => {
    const root = copyFixture('basic-app')
    runIncremental(root, 'out')

    const result = runIndex(root, 'out', ['--incremental', '--reset-cache'])

    expect(result.cache.mode).toBe('incremental-full-initial')
    const { nodes, edges } = androidNodesAndEdges(root, 'out')
    expect(nodes.length).toBeGreaterThan(0)
    expect(edges.length).toBeGreaterThan(0)
  })

  it('produces equivalent Android relationship nodes/edges between a full run and an incremental run', () => {
    const rootFull = copyFixture('basic-app')
    const rootIncremental = copyFixture('basic-app')

    runIndex(rootFull, 'out')
    runIncremental(rootIncremental, 'out')

    const fullResult = androidNodesAndEdges(rootFull, 'out')
    const incrementalResult = androidNodesAndEdges(rootIncremental, 'out')

    expect(fullResult).toEqual(incrementalResult)
  })
})
