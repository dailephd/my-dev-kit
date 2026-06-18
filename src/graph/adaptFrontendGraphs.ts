import type {
  FrontendSemanticArtifact,
  FrontendFileResult,
  ReactFlowRelationshipKind,
  TestBlockCandidate,
  LocatorCandidate,
} from '../frontend/frontendTypes.js'
import { FRONTEND_SEMANTIC_ARTIFACT_KIND } from '../frontend/frontendTypes.js'
import type { RenderableGraph, RenderableGraphEdge, RenderableGraphNode } from './renderableGraphTypes.js'

// Graphs derived from the frontend semantic artifact, not a separate graph file.
export type FrontendGraphSelection = 'react-component' | 'react-flow' | 'react-prop-event-flow' | 'frontend-test'

/** Max nodes before omitting lower-priority entries. */
const MAX_NODES = 300
/** Max characters in a DOT node label. */
const MAX_LABEL = 60

// ---------------------------------------------------------------------------
// react-component graph
// ---------------------------------------------------------------------------

/**
 * Builds a static React component structure graph from the frontend semantic artifact.
 * Nodes: files (box), exported components (box), local components (ellipse), prop types (diamond).
 * Edges: file→component (contains), component→local-component (renders),
 *        component→prop-type (uses-props).
 */
export function adaptReactComponentGraph(artifact: FrontendSemanticArtifact): RenderableGraph {
  validateFrontendArtifact(artifact)

  const nodes: RenderableGraphNode[] = []
  const edges: RenderableGraphEdge[] = []
  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()

  function addNode(node: RenderableGraphNode): void {
    if (nodeIds.has(node.id) || nodes.length >= MAX_NODES) return
    nodes.push(node)
    nodeIds.add(node.id)
  }

  function addEdge(edge: RenderableGraphEdge): void {
    if (edgeIds.has(edge.id)) return
    edges.push(edge)
    edgeIds.add(edge.id)
  }

  for (const file of [...artifact.files].sort(byFilePath)) {
    const hasComponents = file.components.length > 0 || file.localComponents.length > 0
    if (!hasComponents) continue

    const fileId = `file:${file.filePath}`
    addNode({ id: fileId, kind: 'file', label: shortFilePath(file.filePath), shape: 'box' })

    for (const comp of file.components) {
      const compId = `component:${comp.id}`
      addNode({ id: compId, kind: 'component', label: truncate(comp.name), shape: 'box' })
      addEdge({ id: `contains:${comp.id}`, source: fileId, target: compId, kind: 'contains', label: 'contains' })
    }

    for (const local of file.localComponents) {
      const localId = `local:${local.id}`
      addNode({ id: localId, kind: 'local-component', label: truncate(local.name), shape: 'ellipse' })
    }

    for (const propType of file.propTypes) {
      const propId = `prop-type:${propType.id}`
      addNode({ id: propId, kind: 'prop-type', label: truncate(propType.name), shape: 'diamond' })

      for (const compId of propType.usedByComponentIds) {
        const compNodeId = `component:${compId}`
        if (nodeIds.has(compNodeId)) {
          addEdge({ id: `uses-props:${compId}:${propType.id}`, source: compNodeId, target: propId, kind: 'uses-props', label: 'uses-props' })
        }
      }
    }

    // renders-local-component edges from Batch 3 relationships
    for (const rel of file.relationships ?? []) {
      if (rel.kind !== 'react-renders-local-component') continue
      const srcNodeId = `component:${rel.sourceId}`
      const tgtNodeId = `local:${rel.targetId}`
      if (nodeIds.has(srcNodeId) && nodeIds.has(tgtNodeId)) {
        addEdge({ id: rel.id, source: srcNodeId, target: tgtNodeId, kind: 'renders', label: 'renders' })
      }
    }
  }

  return {
    id: 'react-component',
    label: 'ReactComponentGraph',
    nodes: [...nodes].sort(compareById),
    edges: [...edges].sort(compareById),
  }
}

// ---------------------------------------------------------------------------
// react-flow graph
// ---------------------------------------------------------------------------

/**
 * Builds a static React render-flow graph from the frontend semantic artifact.
 * Nodes: components (box), local components (ellipse), hooks (ellipse),
 *        handlers (hexagon), JSX regions (diamond).
 * Edges: from ReactFlowRelationship kinds (Batch 3).
 */
export function adaptReactFlowGraph(artifact: FrontendSemanticArtifact): RenderableGraph {
  validateFrontendArtifact(artifact)

  const nodes: RenderableGraphNode[] = []
  const edges: RenderableGraphEdge[] = []
  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()

  function addNode(node: RenderableGraphNode): void {
    if (nodeIds.has(node.id) || nodes.length >= MAX_NODES) return
    nodes.push(node)
    nodeIds.add(node.id)
  }

  function addEdge(edge: RenderableGraphEdge): void {
    if (edgeIds.has(edge.id)) return
    edges.push(edge)
    edgeIds.add(edge.id)
  }

  for (const file of [...artifact.files].sort(byFilePath)) {
    const hasFlow = hasFlowContent(file)
    if (!hasFlow) continue

    // Build fact ID → node ID mapping for this file
    const idMap = buildFlowIdMap(file, nodeIds, addNode)

    for (const rel of file.relationships ?? []) {
      const srcNodeId = idMap.get(rel.sourceId)
      const tgtNodeId = rel.targetId ? idMap.get(rel.targetId) : undefined
      if (!srcNodeId) continue
      // Edges without a target are not meaningful in DOT
      if (!tgtNodeId) continue
      const label = flowEdgeLabel(rel.kind, rel.propName)
      addEdge({ id: rel.id, source: srcNodeId, target: tgtNodeId, kind: rel.kind, label })
    }
  }

  return {
    id: 'react-flow',
    label: 'ReactFlowGraph',
    nodes: [...nodes].sort(compareById),
    edges: [...edges].sort(compareById),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildFlowIdMap(
  file: FrontendFileResult,
  nodeIds: Set<string>,
  addNode: (n: RenderableGraphNode) => void,
): Map<string, string> {
  const idMap = new Map<string, string>()

  for (const comp of file.components) {
    const nodeId = `component:${comp.id}`
    idMap.set(comp.id, nodeId)
    addNode({ id: nodeId, kind: 'component', label: truncate(comp.name), shape: 'box' })
  }

  for (const local of file.localComponents) {
    const nodeId = `local:${local.id}`
    idMap.set(local.id, nodeId)
    addNode({ id: nodeId, kind: 'local-component', label: truncate(local.name), shape: 'ellipse' })
  }

  for (const hook of file.hooks) {
    const nodeId = `hook:${hook.id}`
    const label = hook.stateVarName
      ? truncate(`${hook.hookName}:${hook.stateVarName}`)
      : truncate(hook.hookName)
    idMap.set(hook.id, nodeId)
    addNode({ id: nodeId, kind: 'hook', label, shape: 'ellipse' })
  }

  for (const handler of file.eventHandlers) {
    const nodeId = `handler:${handler.id}`
    const label = truncate(handler.name ?? handler.eventAttr ?? handler.kind)
    idMap.set(handler.id, nodeId)
    addNode({ id: nodeId, kind: 'handler', label, shape: 'hexagon' })
  }

  for (const region of file.jsxRegions) {
    const nodeId = `jsx:${region.id}`
    const label = region.conditionText
      ? truncate(`${region.kind}:${region.conditionText}`)
      : region.kind
    idMap.set(region.id, nodeId)
    addNode({ id: nodeId, kind: 'jsx-region', label, shape: 'diamond' })
  }

  // Synthetic facts referenced in relationships (state variables, setters, helpers, props)
  for (const rel of file.relationships ?? []) {
    for (const factId of [rel.sourceId, rel.targetId].filter(Boolean) as string[]) {
      if (!idMap.has(factId)) {
        const nodeId = `flow-fact:${factId}`
        idMap.set(factId, nodeId)
        addNode({ id: nodeId, kind: 'flow-fact', label: truncate(syntheticLabel(factId, rel.propName)), shape: 'oval' })
      }
    }
  }

  return idMap
}

function hasFlowContent(file: FrontendFileResult): boolean {
  return (
    file.components.length > 0 ||
    file.localComponents.length > 0 ||
    file.hooks.length > 0 ||
    file.eventHandlers.length > 0 ||
    (file.relationships?.length ?? 0) > 0
  )
}

function flowEdgeLabel(kind: ReactFlowRelationshipKind, propName?: string | null): string {
  const names: Record<ReactFlowRelationshipKind, string> = {
    'react-renders-local-component': 'renders',
    'react-passes-prop': propName ? `passes:${propName}` : 'passes-prop',
    'react-passes-callback-prop': propName ? `callback:${propName}` : 'passes-callback',
    'react-callback-invoked-by-child': 'invokes-callback',
    'react-event-uses-handler': 'event→handler',
    'react-handler-reads-state': 'reads-state',
    'react-handler-sets-state': 'sets-state',
    'react-state-controls-jsx-branch': 'controls-branch',
    'react-helper-computes-prop': 'computes-prop',
    'react-prop-reference': 'prop-ref',
  }
  return names[kind] ?? kind
}

function syntheticLabel(frontendId: string, propName?: string | null): string {
  if (propName) return propName
  const parts = frontendId.split(':')
  return parts.at(-1) ?? frontendId
}

export function validateFrontendArtifact(artifact: unknown): asserts artifact is FrontendSemanticArtifact {
  if (!artifact || typeof artifact !== 'object') {
    throw new Error('Invalid frontend-semantic.json: expected an object.')
  }
  const a = artifact as Record<string, unknown>
  if (a.artifactKind !== FRONTEND_SEMANTIC_ARTIFACT_KIND) {
    throw new Error(
      `Invalid frontend-semantic.json: artifactKind must be ${FRONTEND_SEMANTIC_ARTIFACT_KIND}, got "${String(a.artifactKind)}".`,
    )
  }
  if (!Array.isArray(a.files)) {
    throw new Error('Invalid frontend-semantic.json: files must be an array.')
  }
}

function truncate(label: string): string {
  if (label.length <= MAX_LABEL) return label
  return `${label.slice(0, MAX_LABEL - 1)}…`
}

function shortFilePath(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/')
  // Keep at most the last 3 segments for readability
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : filePath
}

function byFilePath(a: FrontendFileResult, b: FrontendFileResult): number {
  return a.filePath.localeCompare(b.filePath)
}

function compareById<T extends { id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id)
}

// ---------------------------------------------------------------------------
// react-prop-event-flow graph
// ---------------------------------------------------------------------------

/**
 * Builds a static prop/event-flow graph from the frontend semantic artifact.
 * Focuses on parent→child prop passing, callback flow, and handler→state edges.
 * Nodes: components (box), local components (ellipse), prop/state facts (oval).
 * Edges: from ReactFlowRelationship kinds focused on prop/event/state flow.
 */
export function adaptReactPropEventFlowGraph(artifact: FrontendSemanticArtifact): RenderableGraph {
  validateFrontendArtifact(artifact)

  const PROP_EVENT_KINDS: Set<ReactFlowRelationshipKind> = new Set([
    'react-renders-local-component',
    'react-passes-prop',
    'react-passes-callback-prop',
    'react-callback-invoked-by-child',
    'react-event-uses-handler',
    'react-handler-reads-state',
    'react-handler-sets-state',
    'react-state-controls-jsx-branch',
    'react-helper-computes-prop',
    'react-prop-reference',
  ])

  const nodes: RenderableGraphNode[] = []
  const edges: RenderableGraphEdge[] = []
  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()

  function addNode(node: RenderableGraphNode): void {
    if (nodeIds.has(node.id) || nodes.length >= MAX_NODES) return
    nodes.push(node)
    nodeIds.add(node.id)
  }

  function addEdge(edge: RenderableGraphEdge): void {
    if (edgeIds.has(edge.id)) return
    edges.push(edge)
    edgeIds.add(edge.id)
  }

  for (const file of [...artifact.files].sort(byFilePath)) {
    const propEventRels = (file.relationships ?? []).filter((r) => PROP_EVENT_KINDS.has(r.kind))
    if (propEventRels.length === 0 && file.components.length === 0) continue

    const idMap = buildFlowIdMap(file, nodeIds, addNode)

    for (const rel of propEventRels) {
      const srcNodeId = idMap.get(rel.sourceId)
      const tgtNodeId = rel.targetId ? idMap.get(rel.targetId) : undefined
      if (!srcNodeId || !tgtNodeId) continue
      const label = flowEdgeLabel(rel.kind, rel.propName)
      addEdge({ id: rel.id, source: srcNodeId, target: tgtNodeId, kind: rel.kind, label })
    }
  }

  return {
    id: 'react-prop-event-flow',
    label: 'ReactPropEventFlow',
    nodes: [...nodes].sort(compareById),
    edges: [...edges].sort(compareById),
  }
}

// ---------------------------------------------------------------------------
// frontend-test graph
// ---------------------------------------------------------------------------

/** Graph safety limit for test blocks. */
const MAX_TEST_BLOCKS = 200

/**
 * Builds a static frontend test structure graph from the frontend semantic artifact.
 * Nodes: test file (box), describe (box), test/it (ellipse), setup (oval),
 *        locator (diamond), route string (oval).
 * Edges: file→describe, describe→test, describe→setup, test→locator,
 *        test→route.
 */
export function adaptFrontendTestGraph(artifact: FrontendSemanticArtifact): RenderableGraph {
  validateFrontendArtifact(artifact)

  const nodes: RenderableGraphNode[] = []
  const edges: RenderableGraphEdge[] = []
  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()
  let testBlockCount = 0

  function addNode(node: RenderableGraphNode): void {
    if (nodeIds.has(node.id)) return
    nodes.push(node)
    nodeIds.add(node.id)
  }

  function addEdge(edge: RenderableGraphEdge): void {
    if (edgeIds.has(edge.id)) return
    edges.push(edge)
    edgeIds.add(edge.id)
  }

  for (const file of [...artifact.files].sort(byFilePath)) {
    if (!file.isTestFile || file.testBlocks.length === 0) continue

    const fileId = `test-file:${file.filePath}`
    addNode({ id: fileId, kind: 'test-file', label: shortFilePath(file.filePath), shape: 'box' })

    const blockById = new Map<string, TestBlockCandidate>()
    for (const block of file.testBlocks) {
      blockById.set(block.id, block)
    }

    for (const block of [...file.testBlocks].sort((a, b) => a.id.localeCompare(b.id))) {
      if (testBlockCount >= MAX_TEST_BLOCKS) break
      testBlockCount++

      const blockId = `test-block:${block.id}`
      const blockLabel = testBlockLabel(block)
      const blockShape = testBlockShape(block.kind)
      addNode({ id: blockId, kind: block.kind, label: blockLabel, shape: blockShape })

      const parentNodeId = block.parentId ? `test-block:${block.parentId}` : fileId
      const edgeId = `edge:${parentNodeId}→${blockId}`
      const edgeKind = block.parentId ? 'contains' : 'file-contains'
      addEdge({ id: edgeId, source: parentNodeId, target: blockId, kind: edgeKind, label: edgeKind })
    }

    // Locator nodes — grouped under each test block
    for (const locator of [...file.locators].sort((a, b) => a.id.localeCompare(b.id))) {
      if (!locator.value) continue
      const locId = `locator:${locator.id}`
      const locLabel = truncate(`${locator.kind}:${locator.value}`)
      addNode({ id: locId, kind: 'locator', label: locLabel, shape: 'diamond' })

      const ownerNodeId = locator.testBlockId ? `test-block:${locator.testBlockId}` : fileId
      if (nodeIds.has(ownerNodeId)) {
        addEdge({ id: `loc-edge:${locator.id}`, source: ownerNodeId, target: locId, kind: 'uses-locator', label: 'uses-locator' })
      }
    }

    // Route strings — shown as lightweight oval nodes attached to their test block
    for (const route of [...file.routeStrings].sort((a, b) => a.id.localeCompare(b.id))) {
      const routeId = `route:${route.id}`
      addNode({ id: routeId, kind: 'route-string', label: truncate(route.value), shape: 'oval' })

      const ownerNodeId = route.testBlockId ? `test-block:${route.testBlockId}` : fileId
      if (nodeIds.has(ownerNodeId)) {
        addEdge({ id: `route-edge:${route.id}`, source: ownerNodeId, target: routeId, kind: 'mentions-route', label: 'mentions-route' })
      }
    }
  }

  return {
    id: 'frontend-test',
    label: 'FrontendTestGraph',
    nodes: [...nodes].sort(compareById),
    edges: [...edges].sort(compareById),
  }
}

function testBlockLabel(block: TestBlockCandidate): string {
  const kind = block.kind
  const title = block.title ? truncate(block.title) : kind
  const mod = block.modifier ? `.${block.modifier}` : ''
  return `${kind}${mod}: ${title}`
}

function testBlockShape(kind: TestBlockCandidate['kind']): string {
  if (kind === 'describe') return 'box'
  if (kind === 'test' || kind === 'it') return 'ellipse'
  return 'oval'
}
