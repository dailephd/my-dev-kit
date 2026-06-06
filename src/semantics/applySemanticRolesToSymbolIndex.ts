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
        const metadata = metadataBySymbolId.get(buildSymbolId(file.path, symbol.name))
        return metadata
          ? {
              ...symbol,
              semanticRoles: metadata.semanticRoles,
              artifactRefs: metadata.artifactRefs,
            }
          : symbol
      }),
    })),
    graph: symbolIndex.graph
      ? {
          ...symbolIndex.graph,
          symbols: symbolIndex.graph.symbols.map((symbol) => {
            const metadata = metadataBySymbolId.get(buildSymbolId(symbol.file, symbol.name))
            return metadata
              ? {
                  ...symbol,
                  semanticRoles: metadata.semanticRoles,
                  artifactRefs: metadata.artifactRefs,
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
