/**
 * Combined incremental/stale-evidence and determinism gate for the canonical
 * v1.10.0 Android integration fixture (v1.10.0 Batch 7). Covers a
 * representative high-value subset of the full incremental matrix plus the
 * two dedicated closures Batch 6 explicitly deferred: resource-deletion
 * stale retrieval and component-rename stale retrieval.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, cpSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CANONICAL_FIXTURE_ROOT } from './androidV110CombinedFixture.spec.js'

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

function copyFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-v110-incr-'))
  tempDirs.push(root)
  cpSync(CANONICAL_FIXTURE_ROOT, root, { recursive: true })
  return root
}

function runIndex(root: string, out: string, extra: string[] = []) {
  const result = runCli([
    'index', '--root', root, '--src', 'app/src/main', '--src', 'core/src/main',
    '--out', out, '--json', ...extra,
  ])
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout)
}

function runIncremental(root: string, out: string) {
  return runIndex(root, out, ['--incremental'])
}

function readArtifact(root: string, out: string, filename: string) {
  return JSON.parse(readFileSync(join(root, out, filename), 'utf8'))
}

function androidGraphSubset(root: string, out: string) {
  const graph = readArtifact(root, out, 'code-graph.json')
  return {
    nodes: graph.nodes.filter((n: { kind: string }) => String(n.kind).startsWith('android-')),
    edges: graph.edges.filter((e: { kind: string }) => String(e.kind).startsWith('manifest-') || String(e.kind).startsWith('navigation-') || String(e.kind).startsWith('component-') || String(e.kind).startsWith('resource-') || String(e.kind).startsWith('source-references') || e.kind === 'module-contains-source-set' || e.kind === 'compose-route-resolves-to-screen'),
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('resource-deletion stale retrieval (Batch 6 closure)', () => {
  it('a deleted resource definition disappears from search/graph after incremental re-index, and unrelated resources remain', () => {
    const root = copyFixture()
    const out = 'out'
    runIncremental(root, out)

    const before = runCli(['search', '--index', join(root, out), '--resource', 'string/app_name', '--json'])
    expect(JSON.parse(before.stdout).results.length).toBe(2)
    const beforeSlice = runCli(['slice', '--index', join(root, out), '--android-component', 'com.example.combined.MainActivity', '--depth', '2', '--json'])
    expect(JSON.parse(beforeSlice.stdout).nodes.some((n: any) => n.label === 'string/app_name')).toBe(true)

    // Delete the default values/strings.xml (removing one of the two app_name candidates).
    writeFileSync(join(root, 'app/src/main/res/values/strings.xml'), '<resources></resources>\n')

    runIncremental(root, out)

    const after = JSON.parse(runCli(['search', '--index', join(root, out), '--resource', 'string/app_name', '--json']).stdout)
    expect(after.results.length).toBe(1)
    expect(after.results[0].path).toBe('app/src/main/res/values-es/strings.xml')

    // an unrelated resource remains searchable
    const unrelated = JSON.parse(runCli(['search', '--index', join(root, out), '--resource', 'color/brand_primary', '--json']).stdout)
    expect(unrelated.results.length).toBe(2)

    const rootFull = copyFixture()
    writeFileSync(join(rootFull, 'app/src/main/res/values/strings.xml'), '<resources></resources>\n')
    runIndex(rootFull, 'out')
    const incrementalSubset = androidGraphSubset(root, out)
    const fullSubset = androidGraphSubset(rootFull, 'out')
    expect(incrementalSubset.nodes.map((n: any) => n.id).sort()).toEqual(fullSubset.nodes.map((n: any) => n.id).sort())
  })
})

describe('component-rename stale retrieval (Batch 6 closure)', () => {
  it('a renamed manifest component and source class: old name no longer resolves, new name resolves, edges refresh', () => {
    const root = copyFixture()
    const out = 'out'
    runIncremental(root, out)

    const before = JSON.parse(runCli(['lookup', '--index', join(root, out), '--android-component', 'com.example.combined.SyncService', '--json']).stdout)
    expect(before.status).toBe('found')

    const manifestPath = join(root, 'app/src/main/AndroidManifest.xml')
    const manifestContent = readFileSync(manifestPath, 'utf8').replace(/\.SyncService/g, '.RenamedSyncService')
    writeFileSync(manifestPath, manifestContent)

    const kotlinPath = join(root, 'app/src/main/kotlin/com/example/combined/MainActivity.kt')
    const kotlinContent = readFileSync(kotlinPath, 'utf8').replace('class SyncService', 'class RenamedSyncService')
    writeFileSync(kotlinPath, kotlinContent)

    runIncremental(root, out)

    const oldLookup = JSON.parse(runCli(['lookup', '--index', join(root, out), '--android-component', 'com.example.combined.SyncService', '--json']).stdout)
    expect(oldLookup.status).toBe('not-found')

    const newLookup = JSON.parse(runCli(['lookup', '--index', join(root, out), '--android-component', 'com.example.combined.RenamedSyncService', '--json']).stdout)
    expect(newLookup.status).toBe('found')
    expect(newLookup.detail.sourceClassCandidates).toEqual([
      'symbol:app/src/main/kotlin/com/example/combined/MainActivity.kt#RenamedSyncService',
    ])

    const graph = readArtifact(root, out, 'code-graph.json')
    const staleEdges = graph.edges.filter(
      (e: { kind: string; target: string }) =>
        e.kind === 'manifest-component-resolves-to-source' && e.target === 'symbol:app/src/main/kotlin/com/example/combined/MainActivity.kt#SyncService'
    )
    expect(staleEdges).toEqual([])

    const rootFull = copyFixture()
    writeFileSync(join(rootFull, 'app/src/main/AndroidManifest.xml'), manifestContent)
    writeFileSync(join(rootFull, 'app/src/main/kotlin/com/example/combined/MainActivity.kt'), kotlinContent)
    runIndex(rootFull, 'out')
    expect(androidGraphSubset(root, out).nodes.map((n: any) => n.id).sort()).toEqual(
      androidGraphSubset(rootFull, 'out').nodes.map((n: any) => n.id).sort()
    )
  })
})

describe('route rename stale retrieval', () => {
  it('renaming an XML destination route: old route gone, new route found', () => {
    const root = copyFixture()
    const out = 'out'
    runIncremental(root, out)
    expect(JSON.parse(runCli(['search', '--index', join(root, out), '--android-route', 'home', '--json']).stdout).results.length).toBe(1)

    const navPath = join(root, 'app/src/main/res/navigation/nav_graph.xml')
    writeFileSync(navPath, readFileSync(navPath, 'utf8').replace('route="home"', 'route="home_v2"'))

    runIncremental(root, out)
    expect(JSON.parse(runCli(['search', '--index', join(root, out), '--android-route', 'home', '--json']).stdout).results).toEqual([])
    expect(JSON.parse(runCli(['search', '--index', join(root, out), '--android-route', 'home_v2', '--json']).stdout).results.length).toBe(1)
  })
})

describe('permission removal stale retrieval', () => {
  it('removing a declared permission: no longer searchable, unrelated permission remains', () => {
    const root = copyFixture()
    const out = 'out'
    runIncremental(root, out)
    expect(JSON.parse(runCli(['search', '--index', join(root, out), '--permission', 'android.permission.READ_CONTACTS', '--json']).stdout).results.length).toBe(1)

    const manifestPath = join(root, 'app/src/main/AndroidManifest.xml')
    writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8').replace(/<uses-permission-sdk-23[^/]*\/>\n?/, ''))

    runIncremental(root, out)
    expect(JSON.parse(runCli(['search', '--index', join(root, out), '--permission', 'android.permission.READ_CONTACTS', '--json']).stdout).results).toEqual([])
    expect(JSON.parse(runCli(['search', '--index', join(root, out), '--permission', 'android.permission.INTERNET', '--json']).stdout).results.length).toBe(1)
  })
})

describe('navigation action target change', () => {
  it('changing an action target refreshes navigation-action-targets-destination', () => {
    const root = copyFixture()
    const out = 'out'
    runIncremental(root, out)
    const before = readArtifact(root, out, 'code-graph.json')
    const beforeTargets = before.edges.filter((e: { kind: string; source: string }) => e.kind === 'navigation-action-targets-destination' && e.source.includes('action_home_to_details'))
    expect(beforeTargets.length).toBe(1)
    expect(beforeTargets[0].target).toContain('detailsFragment')

    const navPath = join(root, 'app/src/main/res/navigation/nav_graph.xml')
    writeFileSync(navPath, readFileSync(navPath, 'utf8').replace('app:destination="@id/detailsFragment"\n            app:popUpTo', 'app:destination="@id/nestedHome"\n            app:popUpTo'))

    runIncremental(root, out)
    const after = readArtifact(root, out, 'code-graph.json')
    const afterTargets = after.edges.filter((e: { kind: string; source: string }) => e.kind === 'navigation-action-targets-destination' && e.source.includes('action_home_to_details'))
    expect(afterTargets.length).toBe(1)
    expect(afterTargets[0].target).toContain('nestedHome')
  })
})

describe('reset-cache and no-change incremental behavior', () => {
  it('a no-change incremental run reuses output; --reset-cache forces a fresh rebuild', () => {
    const root = copyFixture()
    const out = 'out'
    const first = runIncremental(root, out)
    expect(first.cache.mode).toBe('incremental-full-initial')

    const second = runIncremental(root, out)
    expect(second.cache.mode).toBe('incremental-no-change')

    const reset = runIndex(root, out, ['--incremental', '--reset-cache'])
    expect(reset.cache.mode).toBe('incremental-full-initial')
  })
})

describe('full versus incremental equivalence', () => {
  it('produces equivalent Android artifacts and code-graph Android subset between full and incremental runs', () => {
    const rootFull = copyFixture()
    const rootIncremental = copyFixture()
    runIndex(rootFull, 'out')
    runIncremental(rootIncremental, 'out')

    for (const artifact of ['android-project.json', 'android-gradle.json', 'android-manifest.json', 'android-resources.json', 'android-navigation.json']) {
      const normalize = (a: Record<string, unknown>) => ({ ...a, createdAt: 'NORMALIZED', projectRoot: 'NORMALIZED' })
      expect(normalize(readArtifact(rootFull, 'out', artifact))).toEqual(normalize(readArtifact(rootIncremental, 'out', artifact)))
    }
    expect(androidGraphSubset(rootFull, 'out')).toEqual(androidGraphSubset(rootIncremental, 'out'))
  })
})

describe('determinism gate', () => {
  it('two clean full indexes of the same fixture produce identical Android artifacts and graph subset', () => {
    const rootA = copyFixture()
    const rootB = copyFixture()
    runIndex(rootA, 'out')
    runIndex(rootB, 'out')

    for (const artifact of ['android-project.json', 'android-gradle.json', 'android-manifest.json', 'android-resources.json', 'android-navigation.json']) {
      const normalize = (a: Record<string, unknown>) => ({ ...a, createdAt: 'NORMALIZED', projectRoot: 'NORMALIZED' })
      expect(normalize(readArtifact(rootA, 'out', artifact))).toEqual(normalize(readArtifact(rootB, 'out', artifact)))
    }
    expect(androidGraphSubset(rootA, 'out')).toEqual(androidGraphSubset(rootB, 'out'))

    const searchA = JSON.parse(runCli(['search', '--index', join(rootA, 'out'), '--android-route', 'home', '--json']).stdout)
    const searchB = JSON.parse(runCli(['search', '--index', join(rootB, 'out'), '--android-route', 'home', '--json']).stdout)
    expect(searchA.results).toEqual(searchB.results)
  })
})
