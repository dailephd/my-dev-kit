import { describe, expect, it } from 'vitest'
import {
  adaptRouteGraph,
  adaptBrowserStorageGraph,
  adaptUiReachabilityGraph,
} from '../../src/graph/adaptFrontendReachabilityGraphs.js'
import { buildRenderableDotGraph } from '../../src/graph/buildRenderableDotGraph.js'
import { buildConsumerFixture } from '../frontend-reachability/consumerFixture.js'

describe('reachability graph views', () => {
  it('adaptRouteGraph produces route and component nodes with serves edges', () => {
    const graph = adaptRouteGraph(buildConsumerFixture())
    expect(graph.id).toBe('route')
    expect(graph.nodes.some((n) => n.kind === 'route' && n.label === '/dashboard')).toBe(true)
    expect(graph.nodes.some((n) => n.kind === 'component')).toBe(true)
    expect(graph.edges.some((e) => e.kind === 'route-serves-component')).toBe(true)
    expect(graph.edges.length).toBeGreaterThan(0)
  })

  it('adaptBrowserStorageGraph produces storage and component nodes', () => {
    const graph = adaptBrowserStorageGraph(buildConsumerFixture())
    expect(graph.id).toBe('browser-storage')
    expect(graph.nodes.some((n) => n.kind === 'storage-key' && n.label === 'localStorage:auth_token')).toBe(true)
    expect(graph.edges.some((e) => e.kind === 'component-uses-storage')).toBe(true)
    expect(graph.edges.some((e) => e.kind === 'storage-gates-ui')).toBe(true)
  })

  it('adaptUiReachabilityGraph keeps only connected nodes and cross-domain edges', () => {
    const graph = adaptUiReachabilityGraph(buildConsumerFixture())
    expect(graph.id).toBe('ui-reachability')
    expect(graph.nodes.some((n) => n.kind === 'ui-marker')).toBe(true)
    const edgeKinds = new Set(graph.edges.map((e) => e.kind))
    expect(edgeKinds.has('route-reaches-ui')).toBe(true)
    expect(edgeKinds.has('component-renders-ui')).toBe(true)
    // Every node must be referenced by at least one edge.
    const referenced = new Set(graph.edges.flatMap((e) => [e.source, e.target]))
    for (const node of graph.nodes) {
      expect(referenced.has(node.id)).toBe(true)
    }
  })

  it('renders valid DOT with quoted node ids containing colons and slashes', () => {
    const graph = adaptRouteGraph(buildConsumerFixture())
    const dot = buildRenderableDotGraph(graph, { edgeStyle: 'semantic' })
    expect(dot).toContain('digraph')
    expect(dot).toContain('"route:/dashboard"')
  })

  it('rejects an artifact with the wrong artifactKind', () => {
    const bad = { artifactKind: 'wrong', routes: [], storageKeys: [], uiReachability: [], edges: [] }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => adaptRouteGraph(bad as any)).toThrow(/artifactKind/)
  })
})
