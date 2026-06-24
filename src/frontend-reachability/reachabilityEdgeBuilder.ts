import type {
  ReachabilityConfidence,
  ReachabilityEdge,
  ReachabilityEdgeKind,
  ReachabilityEvidenceRef,
  RouteFact,
  StorageKeyFact,
  UiReachabilityFact,
} from './types.js'

export interface BuildReachabilityEdgesOptions {
  routes: RouteFact[]
  storageKeys: StorageKeyFact[]
  uiReachability: UiReachabilityFact[]
}

/**
 * Builds ReachabilityEdge[] from the three fact arrays, and populates
 * UiReachabilityFact.gateStorageKeyIds / .gateRouteIds in place.
 */
export function buildReachabilityEdges(options: BuildReachabilityEdgesOptions): ReachabilityEdge[] {
  const { routes, storageKeys, uiReachability } = options
  const edges = new Map<string, ReachabilityEdge>()

  // route-serves-component
  for (const route of routes) {
    for (const componentId of route.componentIds) {
      addEdge(edges, 'route-serves-component', route.id, componentId, route.confidence, route.sourceRefs)
    }
  }

  // component-uses-storage
  for (const sk of storageKeys) {
    for (const componentId of sk.componentIds) {
      addEdge(edges, 'component-uses-storage', componentId, sk.id, sk.confidence, sk.sourceRefs)
    }
  }

  // component-renders-ui
  for (const ui of uiReachability) {
    if (ui.componentId) {
      addEdge(edges, 'component-renders-ui', ui.componentId, ui.id, ui.confidence, [ui.sourceRef])
    }
  }

  // storage-gates-ui (uses already-populated gateStorageKeyIds from the UI extractor)
  for (const ui of uiReachability) {
    for (const skId of ui.gateStorageKeyIds) {
      addEdge(edges, 'storage-gates-ui', skId, ui.id, ui.confidence, [ui.sourceRef])
    }
  }

  // route-reaches-ui (transitive: route → component → ui); also populate ui.gateRouteIds
  const routesByComponent = new Map<string, string[]>()
  for (const route of routes) {
    for (const componentId of route.componentIds) {
      const existing = routesByComponent.get(componentId) ?? []
      existing.push(route.id)
      routesByComponent.set(componentId, existing)
    }
  }
  for (const ui of uiReachability) {
    const routeIds = ui.componentId ? routesByComponent.get(ui.componentId) ?? [] : []
    for (const routeId of routeIds) {
      if (!ui.gateRouteIds.includes(routeId)) ui.gateRouteIds.push(routeId)
      addEdge(edges, 'route-reaches-ui', routeId, ui.id, 'medium', [ui.sourceRef])
    }
  }

  // test-covers-ui
  for (const ui of uiReachability) {
    for (const te of ui.testEvidenceRefs) {
      const source = te.testBlockId ?? te.filePath
      const evidenceRef: ReachabilityEvidenceRef = { filePath: te.filePath, line: te.line }
      addEdge(edges, 'test-covers-ui', source, ui.id, 'high', [evidenceRef])
    }
  }

  return [...edges.values()].sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) || a.source.localeCompare(b.source) || a.target.localeCompare(b.target)
  )
}

function addEdge(
  edges: Map<string, ReachabilityEdge>,
  kind: ReachabilityEdgeKind,
  source: string,
  target: string,
  confidence: ReachabilityConfidence,
  evidenceRefs: ReachabilityEvidenceRef[]
): void {
  const id = `${source}--${kind}-->${target}`
  if (edges.has(id)) return
  edges.set(id, { id, kind, source, target, confidence, evidenceRefs })
}
