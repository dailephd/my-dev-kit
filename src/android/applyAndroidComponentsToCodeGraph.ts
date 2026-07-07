import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { CompactAndroidComponentMetadata } from './androidComponentTypes.js'

/** Mirrors applyClassificationToCodeGraph exactly: map-by-id, 'symbol'-kind nodes only. */
export function applyAndroidComponentsToCodeGraph(
  codeGraph: CodeGraph,
  metadataBySymbolId: ReadonlyMap<string, CompactAndroidComponentMetadata>
): CodeGraph {
  if (metadataBySymbolId.size === 0) return codeGraph

  return {
    ...codeGraph,
    nodes: codeGraph.nodes.map((node) => {
      if (node.kind !== 'symbol') return node
      const metadata = metadataBySymbolId.get(node.id)
      return metadata
        ? {
            ...node,
            androidComponentRoles: metadata.androidComponentRoles,
            androidComponentRefs: metadata.androidComponentRefs,
          }
        : node
    }),
  }
}
