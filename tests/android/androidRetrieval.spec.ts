import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadAndroidGraphData,
  resolveAndroidRouteCandidates,
  resolveAndroidPermissionCandidates,
  parseResourceSelector,
  resolveAndroidResourceCandidates,
  resolveAndroidComponentCandidates,
  resolveAndroidSelectorMode,
  buildAndroidSearchResult,
  buildAndroidComponentLookupResult,
} from '../../src/android/index.js'

const FIXTURES_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android-retrieval')
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

function buildIndex(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-retrieval-unit-'))
  tempDirs.push(root)
  cpSync(join(FIXTURES_ROOT, 'combined-app'), root, { recursive: true })
  const out = join(root, 'out')
  const result = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', out, '--json'])
  expect(result.status).toBe(0)
  return out
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('parseResourceSelector', () => {
  it('parses a canonical type/name selector', () => {
    expect(parseResourceSelector('string/app_name')).toEqual({ type: 'string', name: 'app_name' })
  })
  it('strips a leading @ prefix', () => {
    expect(parseResourceSelector('@string/app_name')).toEqual({ type: 'string', name: 'app_name' })
  })
  it('treats a bare name as type-less', () => {
    expect(parseResourceSelector('app_name')).toEqual({ type: null, name: 'app_name' })
  })
})

describe('resolveAndroidSelectorMode', () => {
  it('returns null when no selector flags are present', () => {
    expect(resolveAndroidSelectorMode({})).toBeNull()
  })
  it('resolves a single selector flag', () => {
    expect(resolveAndroidSelectorMode({ androidRoute: 'home' })).toEqual({ mode: 'android-route', query: 'home' })
  })
  it('rejects combining two Android selector flags', () => {
    expect(() => resolveAndroidSelectorMode({ androidRoute: 'home', permission: 'x' })).toThrow(/mutually exclusive/)
  })
})

describe('loadAndroidGraphData', () => {
  it('loads the code graph and extracts the android-* node subset', () => {
    const indexDir = buildIndex()
    const graphData = loadAndroidGraphData(indexDir)
    expect(graphData.androidNodes.length).toBeGreaterThan(0)
    expect(graphData.androidNodes.every((n) => n.kind.startsWith('android-'))).toBe(true)
  })

  it('throws the existing missing-index error for a nonexistent directory', () => {
    expect(() => loadAndroidGraphData('/definitely/not/a/real/dir')).toThrow()
  })
})

describe('resolveAndroidRouteCandidates', () => {
  it('matches the XML destination route exactly', () => {
    const graphData = loadAndroidGraphData(buildIndex())
    const candidates = resolveAndroidRouteCandidates(graphData, 'home')
    expect(candidates.length).toBe(1)
    expect(candidates[0]!.matchKind).toBe('xml-destination-route')
  })

  it('is case-sensitive', () => {
    const graphData = loadAndroidGraphData(buildIndex())
    expect(resolveAndroidRouteCandidates(graphData, 'Home')).toEqual([])
    expect(resolveAndroidRouteCandidates(graphData, 'HOME')).toEqual([])
  })

  it('does not match a path-prefixed or parameterized variant of the same route', () => {
    const graphData = loadAndroidGraphData(buildIndex())
    expect(resolveAndroidRouteCandidates(graphData, '/home')).toEqual([])
    expect(resolveAndroidRouteCandidates(graphData, 'home/{id}')).toEqual([])
  })
})

describe('resolveAndroidPermissionCandidates', () => {
  it('distinguishes declared-permission from permission-reference', () => {
    const graphData = loadAndroidGraphData(buildIndex())
    const declared = resolveAndroidPermissionCandidates(graphData, 'com.example.combined.permission.CUSTOM_ACCESS')
    expect(declared.length).toBe(1)
    expect(declared[0]!.matchKind).toBe('declared-permission')

    const framework = resolveAndroidPermissionCandidates(graphData, 'android.permission.INTERNET')
    expect(framework.length).toBe(1)
    expect(framework[0]!.matchKind).toBe('permission-reference')
  })
})

describe('resolveAndroidResourceCandidates', () => {
  it('preserves every qualified duplicate for a canonical key', () => {
    const graphData = loadAndroidGraphData(buildIndex())
    const candidates = resolveAndroidResourceCandidates(graphData, 'string/app_name')
    expect(candidates.length).toBe(2)
    expect(new Set(candidates.map((c) => c.path))).toEqual(
      new Set(['app/src/main/res/values/strings.xml', 'app/src/main/res/values-es/strings.xml'])
    )
  })

  it('preserves multi-type ambiguity for a bare name', () => {
    const graphData = loadAndroidGraphData(buildIndex())
    const candidates = resolveAndroidResourceCandidates(graphData, 'icon')
    expect(candidates.map((c) => c.resourceType).sort()).toEqual(['drawable', 'mipmap'])
  })
})

describe('resolveAndroidComponentCandidates', () => {
  it('matches an exact FQCN uniquely and carries source-class candidates', () => {
    const graphData = loadAndroidGraphData(buildIndex())
    const candidates = resolveAndroidComponentCandidates(graphData, 'com.example.combined.MainActivity')
    expect(candidates.length).toBe(1)
    expect(candidates[0]!.matchKind).toBe('resolved-fqcn')
    expect(candidates[0]!.sourceClassCandidates).toEqual([
      'symbol:app/src/main/kotlin/com/example/combined/MainActivity.kt#MainActivity',
    ])
  })

  it('preserves simple-name ambiguity across packages without fuzzy narrowing', () => {
    const graphData = loadAndroidGraphData(buildIndex())
    const candidates = resolveAndroidComponentCandidates(graphData, 'MainActivity')
    expect(candidates.length).toBe(2)
  })
})

describe('buildAndroidSearchResult determinism', () => {
  it('produces the same result across repeated calls against the same graph data', () => {
    const graphData = loadAndroidGraphData(buildIndex())
    const first = buildAndroidSearchResult(graphData, 'android-route', 'home')
    const second = buildAndroidSearchResult(graphData, 'android-route', 'home')
    expect(first).toEqual(second)
  })
})

describe('buildAndroidComponentLookupResult', () => {
  it('never selects a winner among ambiguous candidates', () => {
    const graphData = loadAndroidGraphData(buildIndex())
    const result = buildAndroidComponentLookupResult(graphData, 'MainActivity')
    expect(result.status).toBe('ambiguous')
    expect(result.detail).toBeNull()
    expect(result.candidates.length).toBe(2)
  })
})

describe('stale retrieval after re-index', () => {
  it('a renamed route is no longer searchable and the new route becomes searchable', () => {
    const indexDir = buildIndex()
    const root = join(indexDir, '..')

    let graphData = loadAndroidGraphData(indexDir)
    expect(resolveAndroidRouteCandidates(graphData, 'home').length).toBe(1)

    const navPath = join(root, 'app/src/main/res/navigation/nav_graph.xml')
    const content = require('node:fs').readFileSync(navPath, 'utf8').replace('route="home"', 'route="home_renamed"')
    require('node:fs').writeFileSync(navPath, content)

    const reindex = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', indexDir, '--json'])
    expect(reindex.status).toBe(0)

    graphData = loadAndroidGraphData(indexDir)
    expect(resolveAndroidRouteCandidates(graphData, 'home').length).toBe(0)
    expect(resolveAndroidRouteCandidates(graphData, 'home_renamed').length).toBe(1)
  })

  it('a removed permission is no longer searchable after re-index', () => {
    const indexDir = buildIndex()
    const root = join(indexDir, '..')

    let graphData = loadAndroidGraphData(indexDir)
    expect(resolveAndroidPermissionCandidates(graphData, 'com.example.combined.permission.CUSTOM_ACCESS').length).toBe(1)

    const manifestPath = join(root, 'app/src/main/AndroidManifest.xml')
    const fs = require('node:fs')
    // Strip every reference to the permission (declaration, uses-permission, and every
    // component attribute that names it - android:permission/readPermission/writePermission)
    // so the permission is fully removed rather than merely losing its local declaration
    // (which would still leave it as a searchable external permission-reference node).
    const content = fs
      .readFileSync(manifestPath, 'utf8')
      .replace(/<permission android:name="com\.example\.combined\.permission\.CUSTOM_ACCESS" android:protectionLevel="signature" \/>\n?/, '')
      .replace(/<uses-permission android:name="com\.example\.combined\.permission\.CUSTOM_ACCESS" \/>\n?/, '')
      .replace(/\s*android:permission="com\.example\.combined\.permission\.CUSTOM_ACCESS"/g, '')
      .replace(/\s*android:readPermission="com\.example\.combined\.permission\.CUSTOM_ACCESS"/g, '')
      .replace(/\s*android:writePermission="com\.example\.combined\.permission\.CUSTOM_ACCESS"/g, '')
    fs.writeFileSync(manifestPath, content)

    const reindex = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', indexDir, '--json'])
    expect(reindex.status).toBe(0)

    graphData = loadAndroidGraphData(indexDir)
    expect(resolveAndroidPermissionCandidates(graphData, 'com.example.combined.permission.CUSTOM_ACCESS').length).toBe(0)
  })

  it('full and incremental indexing produce equivalent Android retrieval results', () => {
    const rootA = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-retrieval-full-'))
    const rootB = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-retrieval-incr-'))
    tempDirs.push(rootA, rootB)
    cpSync(join(FIXTURES_ROOT, 'combined-app'), rootA, { recursive: true })
    cpSync(join(FIXTURES_ROOT, 'combined-app'), rootB, { recursive: true })

    const outA = join(rootA, 'out')
    const outB = join(rootB, 'out')
    expect(runCli(['index', '--root', rootA, '--src', 'app/src/main', '--out', outA, '--json']).status).toBe(0)
    expect(runCli(['index', '--root', rootB, '--src', 'app/src/main', '--out', outB, '--json', '--incremental']).status).toBe(0)

    const graphA = loadAndroidGraphData(outA)
    const graphB = loadAndroidGraphData(outB)
    const normalize = (nodes: typeof graphA.androidNodes) => nodes.map((n) => ({ ...n }))
    expect(normalize(graphA.androidNodes)).toEqual(normalize(graphB.androidNodes))
    expect(resolveAndroidRouteCandidates(graphA, 'home')).toEqual(resolveAndroidRouteCandidates(graphB, 'home'))
  })
})
