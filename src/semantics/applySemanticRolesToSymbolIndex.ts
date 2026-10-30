import type { SymbolIndex } from '../symbol-index/types.js'
import type { SemanticMetadataForSymbol } from './buildSemanticRolesFromDataModel.js'

export function applySemanticRolesToSymbolIndex(
  symbolIndex: SymbolIndex,
  metadataBySymbolId: ReadonlyMap<string, SemanticMetadataForSymbol>
): SymbolIndex {
  return {
    ...symbolIndex,
    files: symbolIndex.files.map((file) => ({
      ...file,
      symbols: file.symbols.map((symbol) => {
        const metadata = metadataBySymbolId.get(symbol.nodeId ?? buildSymbolId(file.path, symbol.name))
        return metadata
          ? {
              ...symbol,
              semanticRoles: [...(symbol.semanticRoles ?? []).filter(role => role.source !== 'python-orm-analyzer' && role.source !== 'typescript-model-analyzer'), ...metadata.semanticRoles],
              artifactRefs: [...new Map([...(symbol.artifactRefs ?? []), ...metadata.artifactRefs].map(ref => [`${ref.artifact}#${ref.id}`, ref])).values()],
            }
          : symbol
      }),
    })),
    graph: symbolIndex.graph
      ? {
          ...symbolIndex.graph,
          symbols: symbolIndex.graph.symbols.map((symbol) => {
            const metadata = metadataBySymbolId.get(symbol.nodeId ?? buildSymbolId(symbol.file, symbol.name))
            return metadata
              ? {
                  ...symbol,
                  semanticRoles: [...(symbol.semanticRoles ?? []).filter(role => role.source !== 'python-orm-analyzer' && role.source !== 'typescript-model-analyzer'), ...metadata.semanticRoles],
                  artifactRefs: [...new Map([...(symbol.artifactRefs ?? []), ...metadata.artifactRefs].map(ref => [`${ref.artifact}#${ref.id}`, ref])).values()],
                }
              : symbol
          }),
        }
      : undefined,
  }
}

function buildSymbolId(filePath: string, symbolName: string): string {
  return `symbol:${filePath}#${symbolName}`
}
