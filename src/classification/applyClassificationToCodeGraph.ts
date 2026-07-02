import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { CompactClassificationMetadata } from './buildClassificationRefsBySymbolId.js'

/** Mirrors applySemanticRolesToCodeGraph exactly: map-by-id, 'symbol'-kind nodes only. */
export function applyClassificationToCodeGraph(
  codeGraph: CodeGraph,
  metadataBySymbolId: ReadonlyMap<string, CompactClassificationMetadata>
): CodeGraph {
  return {
    ...codeGraph,
    nodes: codeGraph.nodes.map((node) => {
      if (node.kind !== 'symbol') return node
      const metadata = metadataBySymbolId.get(node.id)
      return metadata
        ? {
            ...node,
            classificationRoles: metadata.classificationRoles,
            classificationRefs: metadata.classificationRefs,
          }
        : node
    }),
  }
}
