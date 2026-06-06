import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { SemanticMetadataForSymbol } from './buildSemanticRolesFromDataModel.js'

export function applySemanticRolesToCodeGraph(
  codeGraph: CodeGraph,
  metadataBySymbolId: ReadonlyMap<string, SemanticMetadataForSymbol>
): CodeGraph {
  return {
    ...codeGraph,
    nodes: codeGraph.nodes.map((node) => {
      if (node.kind !== 'symbol') return node
      const metadata = metadataBySymbolId.get(node.id)
      return metadata
        ? {
            ...node,
            semanticRoles: metadata.semanticRoles,
            artifactRefs: metadata.artifactRefs,
          }
        : node
    }),
  }
}
