import type { SymbolIndex } from '../symbol-index/types.js'
import type { CompactClassificationMetadata } from './buildClassificationRefsBySymbolId.js'

/** Mirrors applySemanticRolesToSymbolIndex exactly: map-by-id over files[].symbols[] and graph.symbols[]. */
export function applyClassificationToSymbolIndex(
  symbolIndex: SymbolIndex,
  metadataBySymbolId: ReadonlyMap<string, CompactClassificationMetadata>
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
              classificationRoles: metadata.classificationRoles,
              classificationRefs: metadata.classificationRefs,
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
                  classificationRoles: metadata.classificationRoles,
                  classificationRefs: metadata.classificationRefs,
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
