import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from '../graph/codeGraphTypes.js'
import { deepEqual, sortByString } from './diffUtils.js'
import type {
  ChangedEdgeEntry,
  ChangedNodeEntry,
  CompactEdgeRef,
  CompactNodeRef,
  GraphDiffEdgesSection,
  GraphDiffNodesSection,
} from './types.js'

/**
 * Node identity is `node.id` — already a stable, content-derived string
 * (`file:<path>`, `symbol:<path>#<name>`) per the Batch 3 stable-ID
 * guarantee, so no new identity scheme is introduced here.
 */
export function buildNodeDiff(beforeNodes: CodeGraphNode[], afterNodes: CodeGraphNode[]): GraphDiffNodesSection {
  const beforeById = new Map(beforeNodes.map((node) => [node.id, node]))
  const afterById = new Map(afterNodes.map((node) => [node.id, node]))

  const added: CompactNodeRef[] = []
  const changed: ChangedNodeEntry[] = []

  for (const [id, afterNode] of afterById) {
    const beforeNode = beforeById.get(id)
    if (!beforeNode) {
      added.push(toNodeRef(afterNode))
      continue
    }
    const changedFields = diffObjectFields(beforeNode as unknown as Record<string, unknown>, afterNode as unknown as Record<string, unknown>)
    if (changedFields.length > 0) {
      changed.push({
        id,
        kind: afterNode.kind,
        changedFields,
        before: pickFields(beforeNode as unknown as Record<string, unknown>, changedFields),
        after: pickFields(afterNode as unknown as Record<string, unknown>, changedFields),
      })
    }
  }

  const removed: CompactNodeRef[] = []
  for (const [id, beforeNode] of beforeById) {
    if (!afterById.has(id)) removed.push(toNodeRef(beforeNode))
  }

  return {
    added: sortByString(added, (node) => node.id),
    removed: sortByString(removed, (node) => node.id),
    changed: sortByString(changed, (node) => node.id),
  }
}

/**
 * Edge identity is `edge.id` — already deterministically derived from
 * `source`/`kind`/`target` (plus call line for `calls` edges), so a matching
 * id always means the same logical edge; any remaining field differences
 * (`label`, `metadata`, `sourceRef`) are genuine metadata changes.
 */
export function buildEdgeDiff(beforeEdges: CodeGraphEdge[], afterEdges: CodeGraphEdge[]): GraphDiffEdgesSection {
  const beforeById = new Map(beforeEdges.map((edge) => [edge.id, edge]))
  const afterById = new Map(afterEdges.map((edge) => [edge.id, edge]))

  const added: CompactEdgeRef[] = []
  const changed: ChangedEdgeEntry[] = []

  for (const [id, afterEdge] of afterById) {
    const beforeEdge = beforeById.get(id)
    if (!beforeEdge) {
      added.push(toEdgeRef(afterEdge))
      continue
    }
    const changedFields = diffObjectFields(beforeEdge as unknown as Record<string, unknown>, afterEdge as unknown as Record<string, unknown>)
    if (changedFields.length > 0) {
      changed.push({
        id,
        source: afterEdge.source,
        target: afterEdge.target,
        kind: afterEdge.kind,
        changedFields,
        before: pickFields(beforeEdge as unknown as Record<string, unknown>, changedFields),
        after: pickFields(afterEdge as unknown as Record<string, unknown>, changedFields),
      })
    }
  }

  const removed: CompactEdgeRef[] = []
  for (const [id, beforeEdge] of beforeById) {
    if (!afterById.has(id)) removed.push(toEdgeRef(beforeEdge))
  }

  return {
    added: sortByString(added, (edge) => edge.id),
    removed: sortByString(removed, (edge) => edge.id),
    changed: sortByString(changed, (edge) => edge.id),
  }
}

export function buildCodeGraphDiff(before: CodeGraph, after: CodeGraph) {
  return {
    nodes: buildNodeDiff(before.nodes, after.nodes),
    edges: buildEdgeDiff(before.edges, after.edges),
  }
}

function toNodeRef(node: CodeGraphNode): CompactNodeRef {
  return { id: node.id, kind: node.kind, label: node.label }
}

function toEdgeRef(edge: CodeGraphEdge): CompactEdgeRef {
  return { id: edge.id, source: edge.source, target: edge.target, kind: edge.kind }
}

/** Compares every own field except `id` (the identity key), sorted by field name. */
function diffObjectFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)])
  fields.delete('id')
  const changed: string[] = []
  for (const field of fields) {
    if (!deepEqual(before[field], after[field])) changed.push(field)
  }
  return changed.sort()
}

function pickFields(record: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {}
  for (const field of fields) {
    if (record[field] !== undefined) picked[field] = record[field]
  }
  return picked
}
