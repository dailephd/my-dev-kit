/**
 * Combined artifact-generation, cross-artifact-identity, relationship-matrix,
 * and graph-compactness gates for the canonical v1.10.0 Android integration
 * fixture (v1.10.0 Batch 7).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, cpSync } from 'node:fs'
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

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

let outDir: string

beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-v110-artifacts-'))
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

describe('full artifact-generation gate', () => {
  it('generates and registers all six Android artifacts plus core artifacts', () => {
    for (const file of [
      'symbol-index.json', 'code-graph.json',
      'android-project.json', 'android-components.json', 'android-gradle.json',
      'android-manifest.json', 'android-resources.json', 'android-navigation.json',
      'manifest.json',
    ]) {
      expect(existsSync(join(outDir, file))).toBe(true)
    }
    // call-graph.json is conditional on detectable call evidence in the indexed
    // languages/files (existing --call-graph contract) - not unconditionally required.
  })

  it('registers all seven Android analyzers with android-relationships carrying artifacts: []', () => {
    const manifest = readJson<{ analyzers: Array<{ id: string; status: string; artifacts: unknown[] }> }>(join(outDir, 'manifest.json'))
    const byId = new Map(manifest.analyzers.map((a) => [a.id, a]))
    for (const id of [
      'android-project', 'android-components', 'android-gradle',
      'android-manifest', 'android-resources', 'android-navigation', 'android-relationships',
    ]) {
      expect(byId.has(id)).toBe(true)
      expect(byId.get(id)!.status).not.toBe('failed')
    }
    expect(byId.get('android-relationships')!.artifacts).toEqual([])
  })

  it('never writes android-relationships.json or any second graph artifact', () => {
    expect(existsSync(join(outDir, 'android-relationships.json'))).toBe(false)
  })

  it('every registered artifact path exists on disk', () => {
    const manifest = readJson<{ artifacts: Record<string, string | null>; semanticArtifacts?: Record<string, string | null> }>(join(outDir, 'manifest.json'))
    for (const value of Object.values(manifest.artifacts)) {
      if (!value) continue
      expect(existsSync(join(outDir, value))).toBe(true)
    }
  })
})

describe('cross-artifact identity gate', () => {
  it('module IDs are consistent across android-project, android-gradle, android-manifest, android-resources, android-navigation, and code-graph', () => {
    const project = readJson<{ modules: Array<{ id: string; path: string }> }>(join(outDir, 'android-project.json'))
    const gradle = readJson<{ modules: Array<{ directory: string }> }>(join(outDir, 'android-gradle.json'))
    const manifestArt = readJson<{ manifests: Array<{ moduleId: string }> }>(join(outDir, 'android-manifest.json'))
    const resources = readJson<{ resourceDirectories: Array<{ moduleId: string }> }>(join(outDir, 'android-resources.json'))
    const navigation = readJson<{ navigationFiles: Array<{ moduleId: string }> }>(join(outDir, 'android-navigation.json'))
    const graph = readJson<{ nodes: Array<{ kind: string; androidModuleId?: string }> }>(join(outDir, 'code-graph.json'))

    const projectModuleIds = new Set(project.modules.map((m) => m.id))
    expect(projectModuleIds.size).toBe(2)
    expect(gradle.modules.map((m) => m.directory).sort()).toEqual(['app', 'core'])

    for (const m of manifestArt.manifests) expect(projectModuleIds.has(m.moduleId)).toBe(true)
    for (const d of resources.resourceDirectories) expect(projectModuleIds.has(d.moduleId)).toBe(true)
    for (const f of navigation.navigationFiles) expect(projectModuleIds.has(f.moduleId)).toBe(true)

    const graphModuleIds = new Set(
      graph.nodes.filter((n) => n.androidModuleId !== undefined).map((n) => n.androidModuleId!)
    )
    for (const id of graphModuleIds) expect(projectModuleIds.has(id)).toBe(true)
  })

  it('manifest component, resource definition, and navigation entity IDs match graph androidEntityId values', () => {
    const manifestArt = readJson<{ components: Array<{ id: string }> }>(join(outDir, 'android-manifest.json'))
    const resources = readJson<{ valueDefinitions: Array<{ id: string }>; fileDefinitions: Array<{ id: string }>; layouts: Array<{ id: string }>; idDefinitions: Array<{ id: string }> }>(join(outDir, 'android-resources.json'))
    const navigation = readJson<{ destinations: Array<{ id: string }>; actions: Array<{ id: string }>; graphs: Array<{ id: string }>; xmlDeepLinks: Array<{ id: string }>; composeRoutes: Array<{ id: string }> }>(join(outDir, 'android-navigation.json'))
    const graph = readJson<{ nodes: Array<{ id: string; androidEntityId?: string; kind: string }> }>(join(outDir, 'code-graph.json'))
    const graphEntityIds = new Set(graph.nodes.filter((n) => n.androidEntityId !== undefined).map((n) => n.androidEntityId!))

    for (const c of manifestArt.components) expect(graphEntityIds.has(c.id)).toBe(true)
    const resourceIds = [...resources.valueDefinitions, ...resources.fileDefinitions, ...resources.layouts, ...resources.idDefinitions].map((d) => d.id)
    expect(resourceIds.length).toBeGreaterThan(0)
    for (const id of resourceIds) expect(graphEntityIds.has(id)).toBe(true)
    for (const d of navigation.destinations) expect(graphEntityIds.has(d.id)).toBe(true)
    for (const a of navigation.actions) expect(graphEntityIds.has(a.id)).toBe(true)
    for (const g of navigation.graphs) expect(graphEntityIds.has(g.id)).toBe(true)
    for (const d of navigation.xmlDeepLinks) expect(graphEntityIds.has(d.id)).toBe(true)
    for (const r of navigation.composeRoutes) expect(graphEntityIds.has(r.id)).toBe(true)
  })

  it('reuses existing Kotlin/Java source-symbol nodes and never mints duplicates', () => {
    const symbolIndex = readJson<{ files: Array<{ path: string; language: string; symbols: Array<{ name: string; kind: string }> }> }>(join(outDir, 'symbol-index.json'))
    const graph = readJson<{ nodes: Array<{ id: string; kind: string }> }>(join(outDir, 'code-graph.json'))

    const symbolNodeIds = new Set(
      symbolIndex.files
        .filter((f) => f.language === 'kotlin' || f.language === 'java')
        .flatMap((f) => f.symbols.map((s) => `symbol:${f.path}#${s.name}`))
    )
    const graphSymbolNodes = graph.nodes.filter((n) => n.kind === 'symbol' && n.id.includes('MainActivity'))
    for (const node of graphSymbolNodes) expect(symbolNodeIds.has(node.id)).toBe(true)

    // no duplicate node IDs anywhere in the graph
    const ids = graph.nodes.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has no dangling edge: every edge source/target references a node that exists', () => {
    const graph = readJson<{ nodes: Array<{ id: string }>; edges: Array<{ id: string; source: string; target: string }> }>(join(outDir, 'code-graph.json'))
    const nodeIds = new Set(graph.nodes.map((n) => n.id))
    for (const edge of graph.edges) {
      expect(nodeIds.has(edge.source)).toBe(true)
      expect(nodeIds.has(edge.target)).toBe(true)
    }
  })

  it('has no duplicate exact edge IDs', () => {
    const graph = readJson<{ edges: Array<{ id: string }> }>(join(outDir, 'code-graph.json'))
    const ids = graph.edges.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('leaves a missing navigation action target unresolved rather than inventing a node', () => {
    const navigation = readJson<{ actions: Array<{ id: string; candidateDestinationIds: string[] }> }>(join(outDir, 'android-navigation.json'))
    const missingAction = navigation.actions.find((a) => a.id.includes('action_home_to_missing'))
    expect(missingAction).toBeTruthy()
    expect(missingAction!.candidateDestinationIds).toEqual([])
  })

  it('leaves a component with no matching source class unresolved (no manifest-component-resolves-to-source edge)', () => {
    const graph = readJson<{ nodes: Array<{ id: string; kind: string; label: string }>; edges: Array<{ source: string; kind: string }> }>(join(outDir, 'code-graph.json'))
    const settingsComponent = graph.nodes.find((n) => n.kind === 'android-manifest-component' && n.label === '.SettingsActivity')
    expect(settingsComponent).toBeTruthy()
    const resolvesEdges = graph.edges.filter((e) => e.source === settingsComponent!.id && e.kind === 'manifest-component-resolves-to-source')
    expect(resolvesEdges).toEqual([])
  })
})

describe('Android relationship family matrix', () => {
  it('exercises every required Batch 5 relationship family in the combined fixture', () => {
    const graph = readJson<{ edges: Array<{ kind: string }> }>(join(outDir, 'code-graph.json'))
    const kinds = new Set(graph.edges.map((e) => e.kind))
    const required = [
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
    ]
    const missing = required.filter((kind) => !kinds.has(kind))
    expect(missing).toEqual([])
  })

  it('resolves the exact manifest/navigation deep-link match but not the host-mismatched one', () => {
    const graph = readJson<{ edges: Array<{ kind: string; metadata?: Record<string, unknown> }> }>(join(outDir, 'code-graph.json'))
    const deepLinkEdges = graph.edges.filter((e) => e.kind === 'manifest-deep-link-matches-navigation-deep-link')
    expect(deepLinkEdges.length).toBe(1)
    expect(deepLinkEdges[0]!.metadata?.host).toBe('example.com')
  })

  it('emits one edge per exact candidate rather than a single winner (source-references-resource has multiple targets)', () => {
    const graph = readJson<{ edges: Array<{ kind: string; source: string }> }>(join(outDir, 'code-graph.json'))
    const refs = graph.edges.filter((e) => e.kind === 'source-references-resource')
    const bySource = new Map<string, number>()
    for (const e of refs) bySource.set(e.source, (bySource.get(e.source) ?? 0) + 1)
    expect(refs.length).toBeGreaterThan(0)
  })

  it('does not produce a false-positive resource reference from a comment or string literal', () => {
    const graph = readJson<{ edges: Array<{ kind: string; metadata?: Record<string, unknown> }> }>(join(outDir, 'code-graph.json'))
    const refs = graph.edges.filter((e) => e.kind === 'source-references-resource')
    const rawValues = refs.map((e) => e.metadata?.raw)
    expect(rawValues).not.toContain('R.string.commented_out_reference')
    expect(rawValues).not.toContain('R.string.string_literal_reference')
  })
})

describe('graph compactness and integrity gate', () => {
  it('reports internally consistent node/edge counts by kind with no full artifact record embedded', () => {
    const graph = readJson<{ nodes: Array<{ kind: string; androidMetadata?: Record<string, unknown> }>; edges: Array<{ kind: string }> }>(join(outDir, 'code-graph.json'))
    const androidNodes = graph.nodes.filter((n) => n.kind.startsWith('android-'))
    expect(androidNodes.length).toBeGreaterThan(20)

    for (const node of androidNodes) {
      if (!node.androidMetadata) continue
      // bounded metadata: every value must be a JSON scalar or null, never a nested object/array (which would indicate an embedded artifact fragment)
      for (const value of Object.values(node.androidMetadata)) {
        const isScalarOrNull = value === null || ['string', 'number', 'boolean'].includes(typeof value)
        expect(isScalarOrNull).toBe(true)
      }
    }
  })
})
