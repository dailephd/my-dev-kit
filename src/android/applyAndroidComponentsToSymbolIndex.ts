import type { SymbolIndex } from '../symbol-index/types.js'
import type { CompactAndroidComponentMetadata } from './androidComponentTypes.js'

/** Mirrors applyClassificationToSymbolIndex exactly: map-by-id over files[].symbols[] and graph.symbols[]. */
export function applyAndroidComponentsToSymbolIndex(
  symbolIndex: SymbolIndex,
  metadataBySymbolId: ReadonlyMap<string, CompactAndroidComponentMetadata>
): SymbolIndex {
  if (metadataBySymbolId.size === 0) return symbolIndex

  return {
    ...symbolIndex,
    files: symbolIndex.files.map((file) => ({
      ...file,
      symbols: file.symbols.map((symbol) => {
        const metadata = metadataBySymbolId.get(buildSymbolId(file.path, symbol.name))
        return metadata
          ? {
              ...symbol,
              androidComponentRoles: metadata.androidComponentRoles,
              androidComponentRefs: metadata.androidComponentRefs,
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
                  androidComponentRoles: metadata.androidComponentRoles,
                  androidComponentRefs: metadata.androidComponentRefs,
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
