import type {
  FrontendFileResult,
  FrontendSemanticArtifact,
  FrontendSourceRef,
} from '../frontend/index.js'
import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from './codeGraphTypes.js'

export function addFrontendRelationshipsToCodeGraph(
  graph: CodeGraph,
  frontend: FrontendSemanticArtifact | null | undefined
): CodeGraph {
  if (!frontend || frontend.files.length === 0) return graph

  const nodes = [...graph.nodes]
  const edges = [...graph.edges]
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edgeIds = new Set(edges.map((edge) => edge.id))

  for (const file of frontend.files) {
    const factIndex = buildFactIndex(file, nodeIds)
    for (const node of factIndex.nodes) {
      if (nodeIds.has(node.id)) continue
      nodes.push(node)
      nodeIds.add(node.id)
    }

    for (const relationship of file.relationships ?? []) {
      const source = factIndex.nodeIdFor(relationship.sourceId, relationship.ownerComponentId)
      const target = relationship.targetId ? factIndex.nodeIdFor(relationship.targetId, relationship.ownerComponentId) : null
      if (!source || !target) continue

      const edge: CodeGraphEdge = {
        id: relationship.id,
        source,
        target,
        kind: relationship.kind,
        label: relationship.propName ?? relationship.kind,
        sourceRef: relationship.sourceRef,
        metadata: {
          ...(relationship.metadata ?? {}),
          frontendRelationshipId: relationship.id,
          ownerComponentId: relationship.ownerComponentId ?? null,
          propName: relationship.propName ?? null,
          valueSummary: relationship.valueSummary ?? null,
        },
      }
      if (edgeIds.has(edge.id)) continue
      edges.push(edge)
      edgeIds.add(edge.id)
    }
  }

  sortById(nodes)
  sortById(edges)

  return {
    ...graph,
    nodes,
    edges,
    summary: {
      ...graph.summary,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      fileNodeCount: nodes.filter((node) => node.kind === 'file').length,
      symbolNodeCount: nodes.filter((node) => node.kind === 'symbol').length,
    },
  }
}

function buildFactIndex(file: FrontendFileResult, existingNodeIds: Set<string>): {
  nodes: CodeGraphNode[]
  nodeIdFor: (frontendId: string, ownerComponentId?: string | null) => string
} {
  const nodes: CodeGraphNode[] = []
  const idMap = new Map<string, string>()
  const componentNameById = new Map<string, string>()

  for (const component of file.components) {
    componentNameById.set(component.id, component.name)
    const symbolId = `symbol:${file.filePath}#${component.name}`
    const nodeId = existingNodeIds.has(symbolId) ? symbolId : frontendNodeId(component.id)
    idMap.set(component.id, nodeId)
    if (!existingNodeIds.has(nodeId)) {
      nodes.push(frontendNode(nodeId, component.name, 'react-component', component.id, component.sourceRef))
    }
  }

  for (const component of file.localComponents) {
    componentNameById.set(component.id, component.name)
    const nodeId = frontendNodeId(component.id)
    idMap.set(component.id, nodeId)
    nodes.push(frontendNode(nodeId, component.name, 'local-react-component', component.id, component.sourceRef))
  }

  for (const propType of file.propTypes) {
    const nodeId = frontendNodeId(propType.id)
    idMap.set(propType.id, nodeId)
    nodes.push(frontendNode(nodeId, propType.name, 'prop-type', propType.id, propType.sourceRef))
  }

  for (const hook of file.hooks) {
    const label = hook.stateVarName ? `${hook.hookName}:${hook.stateVarName}` : hook.hookName
    const nodeId = frontendNodeId(hook.id)
    idMap.set(hook.id, nodeId)
    nodes.push(frontendNode(nodeId, label, 'react-hook', hook.id, hook.sourceRef))
  }

  for (const region of file.jsxRegions) {
    const nodeId = frontendNodeId(region.id)
    idMap.set(region.id, nodeId)
    nodes.push(frontendNode(nodeId, region.conditionText ? `${region.kind}:${region.conditionText}` : region.kind, 'jsx-region', region.id, region.sourceRef))
  }

  for (const handler of file.eventHandlers) {
    const nodeId = frontendNodeId(handler.id)
    idMap.set(handler.id, nodeId)
    nodes.push(frontendNode(nodeId, handler.name ?? handler.eventAttr ?? handler.kind, 'event-handler', handler.id, handler.sourceRef))
  }

  return {
    nodes,
    nodeIdFor(frontendId: string, ownerComponentId?: string | null): string {
      const known = idMap.get(frontendId)
      if (known) return known
      const ownerName = ownerComponentId ? componentNameById.get(ownerComponentId) : null
      const nodeId = frontendNodeId(frontendId)
      if (!idMap.has(frontendId)) {
        idMap.set(frontendId, nodeId)
        nodes.push(frontendNode(nodeId, labelForSyntheticFact(frontendId, ownerName), syntheticFactKind(frontendId), frontendId, null))
      }
      return nodeId
    },
  }
}

function frontendNode(id: string, label: string, factKind: string, frontendId: string, sourceRef: FrontendSourceRef | null): CodeGraphNode {
  return {
    id,
    kind: 'frontend-fact',
    label,
    path: sourceRef?.filePath,
    line: sourceRef?.line,
    frontendFactKind: factKind,
    frontendId,
    sourceRef: sourceRef ?? undefined,
  }
}

function frontendNodeId(frontendId: string): string {
  return `frontend:${frontendId}`
}

function syntheticFactKind(frontendId: string): string {
  if (frontendId.includes(':prop:')) return 'prop-reference'
  if (frontendId.includes(':helper:')) return 'helper-function'
  if (frontendId.includes(':state:')) return 'state-variable'
  if (frontendId.includes(':setter:')) return 'state-setter'
  return 'react-flow-fact'
}

function labelForSyntheticFact(frontendId: string, ownerName: string | null | undefined): string {
  const prop = frontendId.match(/:prop:([^#]+)$/)?.[1]
  if (prop) return ownerName ? `${ownerName}.${prop}` : prop
  const helper = frontendId.match(/:helper:([^#]+)$/)?.[1]
  if (helper) return helper
  return frontendId.split('#').at(-1) ?? frontendId
}

function sortById<T extends { id: string }>(items: T[]): void {
  items.sort((a, b) => a.id.localeCompare(b.id))
}
