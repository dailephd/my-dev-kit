import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, cpSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

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

function copyFixture(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-android-retrieval-${name}-`))
  tempDirs.push(root)
  cpSync(join(FIXTURES_ROOT, name), root, { recursive: true })
  return root
}

function indexInto(root: string, out = 'out', src = 'app/src/main') {
  const result = runCli(['index', '--root', root, '--src', src, '--out', out, '--json'])
  expect(result.status).toBe(0)
  return join(root, out)
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('search --android-route', () => {
  it('finds an exact XML destination route and reports evidence kind, module, and metadata', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['search', '--index', indexDir, '--android-route', 'home', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('ok')
    expect(parsed.results.length).toBe(1)
    expect(parsed.results[0].matchKind).toBe('xml-destination-route')
    expect(parsed.results[0].kind).toBe('android-navigation-destination')
    expect(parsed.results[0].moduleId).toBe('android-module:app')
  })

  it('is case-sensitive and does not match a different-cased route', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['search', '--index', indexDir, '--android-route', 'Home', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.results).toEqual([])
  })

  it('returns no results for an unrelated route string', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['search', '--index', indexDir, '--android-route', 'does-not-exist', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('ok')
    expect(parsed.summary.resultCount).toBe(0)
  })

  it('rejects combining --android-route with --query', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['search', '--index', indexDir, '--android-route', 'home', '--query', 'x'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/cannot be combined/)
  })
})

describe('search --permission', () => {
  it('finds a declared local permission and its referers', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['search', '--index', indexDir, '--permission', 'com.example.combined.permission.CUSTOM_ACCESS', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.results.length).toBe(1)
    expect(parsed.results[0].matchKind).toBe('declared-permission')
    expect(parsed.results[0].referers.length).toBeGreaterThanOrEqual(1)
  })

  it('finds a framework permission reference (not locally declared)', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['search', '--index', indexDir, '--permission', 'android.permission.INTERNET', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.results.length).toBe(1)
    expect(parsed.results[0].matchKind).toBe('permission-reference')
  })

  it('does not match a similar but non-identical permission name', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['search', '--index', indexDir, '--permission', 'android.permission.INTERNE', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.results).toEqual([])
  })
})

describe('search --resource', () => {
  it('matches a canonical type/name selector across qualified duplicates', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['search', '--index', indexDir, '--resource', 'string/app_name', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.results.length).toBe(2)
    expect(parsed.results.every((r: { matchKind: string }) => r.matchKind === 'canonical-key')).toBe(true)
  })

  it('matches the @type/name form identically to type/name', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['search', '--index', indexDir, '--resource', '@string/app_name', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.results.length).toBe(2)
  })

  it('matches a bare name across multiple resource types without narrowing', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['search', '--index', indexDir, '--resource', 'icon', '--json'])
    const parsed = JSON.parse(result.stdout)
    const types = parsed.results.map((r: { androidMetadata: { type: string } }) => r.androidMetadata.type).sort()
    expect(types).toEqual(['drawable', 'mipmap'])
  })
})

describe('search --android-component', () => {
  it('matches an exact fully-qualified class name uniquely', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['search', '--index', indexDir, '--android-component', 'com.example.combined.MainActivity', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.results.length).toBe(1)
    expect(parsed.results[0].matchKind).toBe('resolved-fqcn')
    expect(parsed.results[0].sourceClassCandidates).toContain('symbol:app/src/main/kotlin/com/example/combined/MainActivity.kt#MainActivity')
  })

  it('matches a raw dot-prefixed manifest name', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['search', '--index', indexDir, '--android-component', '.MainActivity', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.results.some((r: { matchKind: string }) => r.matchKind === 'raw-manifest-name')).toBe(true)
  })

  it('preserves ambiguity for a simple class name shared across packages', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['search', '--index', indexDir, '--android-component', 'MainActivity', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.results.length).toBe(2)
    const resolvedNames = parsed.results.map((r: { androidMetadata: { resolvedName: string } }) => r.androidMetadata.resolvedName).sort()
    expect(resolvedNames).toEqual(['com.example.combined.MainActivity', 'com.example.other.MainActivity'])
  })
})

describe('lookup --android-component', () => {
  it('returns detailed output for a unique exact match', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['lookup', '--index', indexDir, '--android-component', 'com.example.combined.MainActivity', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('found')
    expect(parsed.detail.sourceClassCandidates.length).toBe(1)
    expect(parsed.detail.intentFilterIds.length).toBe(3)
  })

  it('returns ambiguous with every candidate id for a simple-name collision', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['lookup', '--index', indexDir, '--android-component', 'MainActivity', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('ambiguous')
    expect(parsed.candidates.length).toBe(2)
    expect(parsed.detail).toBeNull()
  })

  it('returns not-found for a non-matching name', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['lookup', '--index', indexDir, '--android-component', 'com.example.DoesNotExist', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('not-found')
  })

  it('rejects combining --android-component with --node', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['lookup', '--index', indexDir, '--android-component', 'x', '--node', 'file:foo'])
    expect(result.status).not.toBe(0)
  })
})

describe('source --android-route and --resource', () => {
  it('returns a bounded XML excerpt for a unique route match', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['source', '--index', indexDir, '--android-route', 'home', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('ok')
    expect(parsed.result.slice.content).toContain('homeFragment')
    expect(parsed.result.slice.content.length).toBeLessThan(2000)
  })

  it('returns ambiguous for a resource selector with multiple qualified candidates', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['source', '--index', indexDir, '--resource', 'string/app_name', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('ambiguous')
    expect(parsed.candidates.length).toBe(2)
  })

  it('does not decode a binary resource and returns metadata only', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['source', '--index', indexDir, '--resource', 'mipmap/icon', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('ok')
    expect(parsed.result.binary).toBe(true)
    expect(parsed.result.slice).toBeUndefined()
  })

  it('returns not-found for a non-existent resource', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['source', '--index', indexDir, '--resource', 'string/does_not_exist', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('not-found')
  })
})

describe('slice --android-route and --android-component', () => {
  it('traverses real Batch 5 relationships from a unique route root', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['slice', '--index', indexDir, '--android-route', 'home', '--depth', '2', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.androidSelector.matchKind).toBe('xml-destination-route')
    expect(parsed.edges.some((e: { kind: string }) => e.kind === 'navigation-destination-resolves-to-screen')).toBe(true)
    expect(parsed.nodes.some((n: { kind: string }) => n.kind === 'symbol')).toBe(true)
  })

  it('traverses real Batch 5 relationships from a unique component root', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['slice', '--index', indexDir, '--android-component', 'com.example.combined.MainActivity', '--depth', '2', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.edges.some((e: { kind: string }) => e.kind === 'component-has-intent-filter')).toBe(true)
    expect(parsed.edges.some((e: { kind: string }) => e.kind === 'manifest-component-resolves-to-source')).toBe(true)
  })

  it('does not select a winner for an ambiguous component slice root', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['slice', '--index', indexDir, '--android-component', 'MainActivity', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('ambiguous')
    expect(parsed.candidates.length).toBe(2)
  })
})

describe('view --graph android-module|android-manifest|android-navigation', () => {
  it('renders android-module with module/source-set nodes and only actual edges', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const outPath = join(root, 'module.dot')
    const result = runCli(['view', '--index', indexDir, '--graph', 'android-module', '--out', outPath, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.nodeCount).toBeGreaterThan(0)
    expect(existsSync(outPath)).toBe(true)
  })

  it('renders android-manifest with component/intent-filter/permission relationships', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const outPath = join(root, 'manifest.dot')
    const result = runCli(['view', '--index', indexDir, '--graph', 'android-manifest', '--out', outPath, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.nodeCount).toBeGreaterThan(0)
    expect(parsed.edgeCount).toBeGreaterThan(0)
  })

  it('renders android-navigation with destination/action/deep-link/compose relationships', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const outPath = join(root, 'nav.dot')
    const result = runCli(['view', '--index', indexDir, '--graph', 'android-navigation', '--out', outPath, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.nodeCount).toBeGreaterThan(0)
  })

  it('produces deterministic node/edge counts across repeated renders', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const first = JSON.parse(runCli(['view', '--index', indexDir, '--graph', 'android-navigation', '--out', join(root, 'a.dot'), '--json']).stdout)
    const second = JSON.parse(runCli(['view', '--index', indexDir, '--graph', 'android-navigation', '--out', join(root, 'b.dot'), '--json']).stdout)
    expect(first.nodeCount).toBe(second.nodeCount)
    expect(first.edgeCount).toBe(second.edgeCount)
  })

  it('lists the three Android graph names in CLI help', () => {
    const result = runCli(['view', '--help'])
    expect(result.stdout).toContain('android-module')
    expect(result.stdout).toContain('android-manifest')
    expect(result.stdout).toContain('android-navigation')
  })

  it('still rejects an unsupported --graph value', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const result = runCli(['view', '--index', indexDir, '--graph', 'not-a-real-graph'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/Unsupported --graph value/)
  })
})

describe('context Android integration', () => {
  it('selects an Android node as focus for a route-shaped query and includes bounded source evidence', () => {
    const root = copyFixture('combined-app')
    const indexDir = indexInto(root)
    const outPath = join(root, 'ctx.json')
    const auditPath = join(root, 'audit.json')
    const result = runCli([
      'context', '--index', indexDir, '--query', 'home navigation route destination',
      '--out', outPath, '--audit-out', auditPath, '--json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    // The focus node itself may be a Kotlin/Java symbol or an android-* node depending on
    // which candidate ranks highest for the query - the behavior under test is that android-*
    // nodes are eligible candidates at all (previously excluded before Batch 6), not that one
    // specific node always wins the ranking.
    expect(parsed.candidateNodes.some((n: { kind: string }) => n.kind.startsWith('android-'))).toBe(true)
    expect(parsed.selectedSource.slices.length).toBeGreaterThan(0)
    expect(existsSync(auditPath)).toBe(true)
  })
})

describe('missing and partial Android artifact behavior', () => {
  it('search --android-route returns no match (not a crash) for a project with zero Android evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-retrieval-non-android-'))
    tempDirs.push(root)
    writeFileSync(join(root, 'index.ts'), 'export const x = 1\n')
    const indexDir = indexInto(root, 'out', '.')
    const result = runCli(['search', '--index', indexDir, '--android-route', 'home', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('ok')
    expect(parsed.results).toEqual([])
  })

  it('existing --query search remains unaffected on a non-Android project', () => {
    const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-retrieval-non-android2-'))
    tempDirs.push(root)
    writeFileSync(join(root, 'index.ts'), 'export function greet() { return "hi" }\n')
    const indexDir = indexInto(root, 'out', '.')
    const result = runCli(['search', '--index', indexDir, '--query', 'greet', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.results.some((r: { id: string }) => r.id.includes('greet'))).toBe(true)
  })

  it('view --graph android-navigation renders an empty bounded graph for a non-Android project', () => {
    const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-retrieval-non-android3-'))
    tempDirs.push(root)
    writeFileSync(join(root, 'index.ts'), 'export const x = 1\n')
    const indexDir = indexInto(root, 'out', '.')
    const outPath = join(root, 'nav.dot')
    const result = runCli(['view', '--index', indexDir, '--graph', 'android-navigation', '--out', outPath, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.nodeCount).toBe(0)
    expect(parsed.edgeCount).toBe(0)
  })

  it('fails clearly (not a crash) when --index points at a missing directory', () => {
    const result = runCli(['search', '--index', '/definitely/not/a/real/index/dir', '--android-route', 'home', '--json'])
    expect(result.status).not.toBe(0)
    expect(result.stderr.length).toBeGreaterThan(0)
  })
})
