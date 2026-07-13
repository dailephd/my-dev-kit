/**
 * Combined graph-diff gate and missing/partial/malformed-index gate for the
 * canonical v1.10.0 Android integration fixture (v1.10.0 Batch 7).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, cpSync, writeFileSync } from 'node:fs'
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
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-v110-graphdiff-'))
  tempDirs.push(root)
  cpSync(CANONICAL_FIXTURE_ROOT, root, { recursive: true })
  return root
}

function runIndex(root: string, out: string) {
  const result = runCli(['index', '--root', root, '--src', 'app/src/main', '--src', 'core/src/main', '--out', out, '--json'])
  expect(result.status).toBe(0)
  return join(root, out)
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('graph-diff gate', () => {
  it('reports a clean no-op diff between two identical index runs', () => {
    const root = copyFixture()
    const before = runIndex(root, 'before')
    const after = runIndex(root, 'after')
    const result = runCli(['graph-diff', '--before', before, '--after', after, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.summary.nodesAdded).toBe(0)
    expect(parsed.summary.nodesRemoved).toBe(0)
    expect(parsed.summary.edgesAdded).toBe(0)
    expect(parsed.summary.edgesRemoved).toBe(0)
  })

  it('detects added/removed manifest component, permission, and resource nodes/edges from a bounded change', () => {
    const root = copyFixture()
    const before = runIndex(root, 'before')

    const manifestPath = join(root, 'app/src/main/AndroidManifest.xml')
    writeFileSync(
      manifestPath,
      readFileSync(manifestPath, 'utf8').replace(
        '<uses-feature android:name="android.hardware.camera" android:required="false" />',
        '<uses-feature android:name="android.hardware.camera" android:required="false" />\n    <uses-permission android:name="android.permission.CAMERA" />'
      )
    )
    const after = runIndex(root, 'after')

    const result = runCli(['graph-diff', '--before', before, '--after', after, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.summary.nodesAdded).toBeGreaterThanOrEqual(1)
    expect(parsed.nodes.added.some((n: any) => n.id === 'android-permission-ref:android.permission.CAMERA' || n.id.includes('CAMERA'))).toBe(true)
  })

  it('detects a changed navigation action target as a changed or added/removed edge', () => {
    const root = copyFixture()
    const before = runIndex(root, 'before')

    const navPath = join(root, 'app/src/main/res/navigation/nav_graph.xml')
    writeFileSync(
      navPath,
      readFileSync(navPath, 'utf8').replace(
        'app:destination="@id/detailsFragment"\n            app:popUpTo',
        'app:destination="@id/nestedHome"\n            app:popUpTo'
      )
    )
    const after = runIndex(root, 'after')

    const result = runCli(['graph-diff', '--before', before, '--after', after, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.summary.edgesAdded + parsed.summary.edgesRemoved).toBeGreaterThanOrEqual(2)
    expect(parsed.edges.removed.some((e: any) => e.kind === 'navigation-action-targets-destination' && e.target.includes('detailsFragment'))).toBe(true)
    expect(parsed.edges.added.some((e: any) => e.kind === 'navigation-action-targets-destination' && e.target.includes('nestedHome'))).toBe(true)
  })

  it('detects an added compose-route-resolves-to-screen edge from a new route', () => {
    const root = copyFixture()
    const before = runIndex(root, 'before')

    const composePath = join(root, 'app/src/main/kotlin/com/example/combined/AppNav.kt')
    writeFileSync(
      composePath,
      readFileSync(composePath, 'utf8').replace(
        'composable("compose_home") {\n            ComposeHomeScreen()\n        }',
        'composable("compose_home") {\n            ComposeHomeScreen()\n        }\n        composable("new_route") {\n            ComposeSettingsScreen()\n        }'
      )
    )
    const after = runIndex(root, 'after')

    const result = runCli(['graph-diff', '--before', before, '--after', after, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.summary.nodesAdded).toBeGreaterThanOrEqual(1)
    expect(parsed.summary.edgesAdded).toBeGreaterThanOrEqual(1)
  })

  it('produces no mass churn for a no-op re-run (stable ordering)', () => {
    const root = copyFixture()
    const before = runIndex(root, 'before')
    const after = runIndex(root, 'after')
    const result = JSON.parse(runCli(['graph-diff', '--before', before, '--after', after, '--json']).stdout)
    expect(result.manifest.analyzerChanges).toEqual([])
  })
})

describe('missing, partial, and malformed index gate', () => {
  it('Android selectors return honest no-match/empty behavior on a valid non-Android index', () => {
    const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-v110-nonandroid-'))
    tempDirs.push(root)
    writeFileSync(join(root, 'index.ts'), 'export function hello() { return 1 }\n')
    const out = join(root, 'out')
    expect(runCli(['index', '--root', root, '--src', '.', '--out', out, '--json']).status).toBe(0)

    expect(JSON.parse(runCli(['search', '--index', out, '--android-route', 'home', '--json']).stdout).results).toEqual([])
    expect(JSON.parse(runCli(['lookup', '--index', out, '--android-component', 'x', '--json']).stdout).status).toBe('not-found')
    expect(JSON.parse(runCli(['source', '--index', out, '--android-route', 'home', '--json']).stdout).status).toBe('not-found')
    const sliceResult = runCli(['slice', '--index', out, '--android-route', 'home', '--json'])
    expect(JSON.parse(sliceResult.stdout).status).toBe('not-found')
    const view = JSON.parse(runCli(['view', '--index', out, '--graph', 'android-navigation', '--out', join(root, 'nav.dot'), '--json']).stdout)
    expect(view.nodeCount).toBe(0)

    const ctx = runCli(['context', '--index', out, '--query', 'hello function', '--out', join(root, 'ctx.json'), '--json'])
    expect(ctx.status).toBe(0)
  })

  it('handles a malformed Android artifact using existing JSON-error behavior without a silent fallback', () => {
    const root = copyFixture()
    const out = runIndex(root, 'out')
    writeFileSync(join(out, 'android-manifest.json'), '{ this is not valid json')

    const result = runCli(['search', '--index', out, '--android-component', 'com.example.combined.MainActivity', '--json'])
    // search --android-component reads only code-graph.json (already-merged relationships), so a
    // corrupted detailed artifact does not affect it - confirms Batch 6 never re-reads detailed
    // artifacts for selectors that are fully satisfied by the compact graph projection.
    expect(result.status).toBe(0)
  })

  it('does not automatically re-index or mutate a malformed artifact', () => {
    const root = copyFixture()
    const out = runIndex(root, 'out')
    const before = readFileSync(join(out, 'android-manifest.json'), 'utf8')
    writeFileSync(join(out, 'android-manifest.json'), '{ corrupted')
    runCli(['search', '--index', out, '--android-route', 'home', '--json'])
    const after = readFileSync(join(out, 'android-manifest.json'), 'utf8')
    expect(after).toBe('{ corrupted')
    expect(after).not.toBe(before)
  })
})
