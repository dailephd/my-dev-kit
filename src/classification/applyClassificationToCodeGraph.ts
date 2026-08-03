import type { CodeGraph, CodeGraphNodeKind } from '../graph/codeGraphTypes.js'
import type { CompactClassificationMetadata } from './buildClassificationRefsBySymbolId.js'

/**
 * Mirrors applySemanticRolesToCodeGraph exactly: map-by-id, restricted to
 * `eligibleKinds` (default `['symbol']`, preserving pre-v1.12.0 behavior).
 * v1.12.0 Batch 1 reuses this for `['android-project', 'android-module']`
 * to project compact Android graph-node classifications.
 */
export function applyClassificationToCodeGraph(
  codeGraph: CodeGraph,
  metadataById: ReadonlyMap<string, CompactClassificationMetadata>,
  eligibleKinds: readonly CodeGraphNodeKind[] = ['symbol']
): CodeGraph {
  const eligible = new Set<CodeGraphNodeKind>(eligibleKinds)
  return {
    ...codeGraph,
    nodes: codeGraph.nodes.map((node) => {
      if (!eligible.has(node.kind)) return node
      const metadata = metadataById.get(node.id)
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
