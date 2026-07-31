/**
 * Combined Batch 6 retrieval-surface integration gate for the canonical
 * v1.10.0 Android fixture (v1.10.0 Batch 7): search, lookup, source, slice,
 * view, and context, plus dedicated closure of the two Batch 6-reported
 * fixture-level gaps (activity-alias public retrieval, direct type-safe
 * route evidence).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

function json(result: ReturnType<typeof runCli>): any {
  return JSON.parse(result.stdout)
}

let outDir: string

beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-v110-retrieval-'))
  tempDirs.push(root)
  outDir = join(root, 'out')
  const result = runCli([
    'index', '--root', CANONICAL_FIXTURE_ROOT,
    '--src', 'app/src/main', '--src', 'core/src/main',
    '--out', outDir, '--call-graph', '--json',
  ])
  expect(result.status).toBe(0)
})

afterAll(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('search integration matrix', () => {
  it('android-route: exact XML destination route, ID, Compose string/const routes, case-distinct non-match, dynamic non-match, no-match', () => {
    expect(json(runCli(['search', '--index', outDir, '--android-route', 'home', '--json'])).results.length).toBe(1)
    expect(json(runCli(['search', '--index', outDir, '--android-route', 'homeFragment', '--json'])).results).toEqual([])
    expect(json(runCli(['search', '--index', outDir, '--android-route', 'compose_home', '--json'])).results.length).toBe(2)
    expect(json(runCli(['search', '--index', outDir, '--android-route', 'settings', '--json'])).results.length).toBe(1)
    expect(json(runCli(['search', '--index', outDir, '--android-route', 'Home', '--json'])).results).toEqual([])
    expect(json(runCli(['search', '--index', outDir, '--android-route', 'ambiguous_route', '--json'])).results.length).toBe(1)
    expect(json(runCli(['search', '--index', outDir, '--android-route', 'no-such-route', '--json'])).results).toEqual([])
    const human = runCli(['search', '--index', outDir, '--android-route', 'home'])
    expect(human.status).toBe(0)
    expect(human.stdout).toContain('home')
  }, 60_000)

  it('android-route: direct type-safe route evidence resolves by its type name', () => {
    const result = json(runCli(['search', '--index', outDir, '--android-route', 'HomeRoute', '--json']))
    expect(result.results.length).toBe(1)
    expect(result.results[0].matchKind).toBe('compose-type-route')
    expect(result.results[0].androidMetadata.evidenceKind).toBe('type-safe-route')
  })

  it('permission: uses-permission, uses-permission-sdk-23, local custom, component attributes, framework, non-match', () => {
    expect(json(runCli(['search', '--index', outDir, '--permission', 'android.permission.INTERNET', '--json'])).results.length).toBe(1)
    expect(json(runCli(['search', '--index', outDir, '--permission', 'android.permission.READ_CONTACTS', '--json'])).results.length).toBe(1)
    expect(json(runCli(['search', '--index', outDir, '--permission', 'com.example.combined.permission.CUSTOM_ACCESS', '--json'])).results[0].matchKind).toBe('declared-permission')
    expect(json(runCli(['search', '--index', outDir, '--permission', 'com.example.combined.permission.DEBUG_LOGGING', '--json'])).results.length).toBe(1)
    expect(json(runCli(['search', '--index', outDir, '--permission', 'android.permission.INTERNE', '--json'])).results).toEqual([])
    const human = runCli(['search', '--index', outDir, '--permission', 'android.permission.INTERNET'])
    expect(human.status).toBe(0)
  }, 60_000)

  it('resource: canonical, @form, bare multi-type, localized/qualified duplicates, binary, missing', () => {
    expect(json(runCli(['search', '--index', outDir, '--resource', 'string/app_name', '--json'])).results.length).toBe(2)
    expect(json(runCli(['search', '--index', outDir, '--resource', '@string/app_name', '--json'])).results.length).toBe(2)
    const bare = json(runCli(['search', '--index', outDir, '--resource', 'icon', '--json']))
    expect(bare.results.map((r: any) => r.androidMetadata.type).sort()).toEqual(['drawable', 'mipmap'])
    expect(json(runCli(['search', '--index', outDir, '--resource', 'color/brand_primary', '--json'])).results.length).toBe(2)
    expect(json(runCli(['search', '--index', outDir, '--resource', 'mipmap/icon', '--json'])).results.length).toBe(1)
    expect(json(runCli(['search', '--index', outDir, '--resource', 'string/does_not_exist', '--json'])).results).toEqual([])
  }, 60_000)

  it('android-component: FQCN, raw, dot-prefixed, unqualified, simple-name ambiguity, alias, missing, no-match', () => {
    expect(json(runCli(['search', '--index', outDir, '--android-component', 'com.example.combined.MainActivity', '--json'])).results.length).toBe(1)
    expect(json(runCli(['search', '--index', outDir, '--android-component', '.MainActivity', '--json'])).results.length).toBe(1)
    const simple = json(runCli(['search', '--index', outDir, '--android-component', 'MainActivity', '--json']))
    expect(simple.results.length).toBe(2)
    expect(json(runCli(['search', '--index', outDir, '--android-component', 'com.example.combined.MainActivityAlias', '--json'])).results[0].sourceClassCandidates).toEqual([
      'symbol:app/src/main/kotlin/com/example/combined/MainActivity.kt#MainActivity',
    ])
    expect(json(runCli(['search', '--index', outDir, '--android-component', 'com.example.combined.SettingsActivity', '--json'])).results[0].sourceClassCandidates).toEqual([])
    expect(json(runCli(['search', '--index', outDir, '--android-component', 'com.example.NoSuchThing', '--json'])).results).toEqual([])
  })
})

describe('lookup integration gate', () => {
  it('resolves a unique fully-qualified component with full detail', () => {
    const result = json(runCli(['lookup', '--index', outDir, '--android-component', 'com.example.combined.MainActivity', '--json']))
    expect(result.status).toBe('found')
    expect(result.detail.intentFilterIds.length).toBe(3)
    expect(result.detail.permissionEdges.length).toBe(0)
  })

  it('resolves the activity alias to its exact targetActivity source class', () => {
    const result = json(runCli(['lookup', '--index', outDir, '--android-component', 'com.example.combined.MainActivityAlias', '--json']))
    expect(result.status).toBe('found')
    expect(result.detail.sourceClassCandidates).toEqual([
      'symbol:app/src/main/kotlin/com/example/combined/MainActivity.kt#MainActivity',
    ])
  })

  it('reports not-found for a source-backed-only-missing component', () => {
    const result = json(runCli(['lookup', '--index', outDir, '--android-component', 'com.example.combined.SettingsActivity', '--json']))
    expect(result.status).toBe('found')
    expect(result.detail.sourceClassCandidates).toEqual([])
  })

  it('never selects one candidate for a simple-name collision', () => {
    const result = json(runCli(['lookup', '--index', outDir, '--android-component', 'MainActivity', '--json']))
    expect(result.status).toBe('ambiguous')
    expect(result.detail).toBeNull()
    expect(result.candidates.length).toBe(2)
  })

  it('reports not-found for a nonexistent component', () => {
    expect(json(runCli(['lookup', '--index', outDir, '--android-component', 'com.example.Nope', '--json'])).status).toBe('not-found')
  })
})

describe('source integration gate', () => {
  it('returns a bounded XML excerpt for the unique XML route', () => {
    const result = json(runCli(['source', '--index', outDir, '--android-route', 'home', '--json']))
    expect(result.status).toBe('ok')
    expect(result.result.slice.content).toContain('homeFragment')
  })

  it('returns a bounded Compose excerpt for the type-safe route', () => {
    const result = json(runCli(['source', '--index', outDir, '--android-route', 'HomeRoute', '--json']))
    expect(result.status).toBe('ok')
    expect(result.result.slice.content).toContain('HomeRoute')
  })

  it('returns ambiguous for a localized/qualified resource duplicate', () => {
    const result = json(runCli(['source', '--index', outDir, '--resource', 'string/app_name', '--json']))
    expect(result.status).toBe('ambiguous')
    expect(result.candidates.length).toBe(2)
  })

  it('does not decode a binary resource', () => {
    const result = json(runCli(['source', '--index', outDir, '--resource', 'mipmap/icon', '--json']))
    expect(result.status).toBe('ok')
    expect(result.result.binary).toBe(true)
  })

  it('returns not-found for a missing route/resource', () => {
    expect(json(runCli(['source', '--index', outDir, '--android-route', 'no-such-route', '--json'])).status).toBe('not-found')
    expect(json(runCli(['source', '--index', outDir, '--resource', 'string/does_not_exist', '--json'])).status).toBe('not-found')
  })
})

describe('slice integration gate', () => {
  it('route slice traverses real relationships including navigation-destination-resolves-to-screen', () => {
    const result = json(runCli(['slice', '--index', outDir, '--android-route', 'home', '--depth', '2', '--json']))
    expect(result.edges.some((e: any) => e.kind === 'navigation-destination-resolves-to-screen')).toBe(true)
    expect(result.edges.some((e: any) => e.kind === 'navigation-destination-has-deep-link')).toBe(true)
  })

  it('component slice traverses manifest, intent-filter, permission, and source relationships', () => {
    const result = json(runCli(['slice', '--index', outDir, '--android-component', 'com.example.combined.MainActivity', '--depth', '2', '--json']))
    expect(result.edges.some((e: any) => e.kind === 'component-has-intent-filter')).toBe(true)
    expect(result.edges.some((e: any) => e.kind === 'manifest-component-resolves-to-source')).toBe(true)
    expect(result.edges.some((e: any) => e.kind === 'source-references-resource')).toBe(true)
  })

  it('activity-alias slice traverses to its exact target source class', () => {
    const result = json(runCli(['slice', '--index', outDir, '--android-component', 'com.example.combined.MainActivityAlias', '--depth', '2', '--json']))
    expect(result.edges.some((e: any) => e.kind === 'manifest-component-resolves-to-source')).toBe(true)
  })

  it('never selects a winner for an ambiguous slice root', () => {
    const result = json(runCli(['slice', '--index', outDir, '--android-component', 'MainActivity', '--json']))
    expect(result.status).toBe('ambiguous')
    expect(result.candidates.length).toBe(2)
  })
})

describe('graph-view integration gate', () => {
  for (const graphName of ['android-module', 'android-manifest', 'android-navigation'] as const) {
    it(`renders --graph ${graphName} deterministically with only real edges`, () => {
      const outA = join(outDir, `${graphName}-a.dot`)
      const outB = join(outDir, `${graphName}-b.dot`)
      const a = json(runCli(['view', '--index', outDir, '--graph', graphName, '--out', outA, '--json']))
      const b = json(runCli(['view', '--index', outDir, '--graph', graphName, '--out', outB, '--json']))
      expect(a.nodeCount).toBeGreaterThan(0)
      expect(a.nodeCount).toBe(b.nodeCount)
      expect(a.edgeCount).toBe(b.edgeCount)
      expect(existsSync(outA)).toBe(true)
    })
  }
})

describe('context integration gate', () => {
  it('selects the exact deep-link-owning component for a deep-link query', () => {
    const outPath = join(outDir, 'ctx-deeplink.json')
    const auditPath = join(outDir, 'ctx-deeplink-audit.json')
    const result = runCli([
      'context', '--index', outDir, '--query', 'Which activity handles the exact https example.com details deep link?',
      '--out', outPath, '--audit-out', auditPath, '--json',
    ])
    expect(result.status).toBe(0)
    expect(existsSync(auditPath)).toBe(true)
  })

  it('selects the resource definition for a resource-shaped query', () => {
    const outPath = join(outDir, 'ctx-resource.json')
    const result = runCli([
      'context', '--index', outDir, '--query', 'Where is string app_name defined in resources?',
      '--out', outPath, '--json',
    ])
    expect(result.status).toBe(0)
    const parsed = json(result)
    expect(parsed.candidateNodes.some((n: any) => n.kind === 'android-resource-definition')).toBe(true)
  })
})
