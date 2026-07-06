import type { FileSummary, SymbolIndex } from '../symbol-index/types.js'
import { deepEqual } from './diffUtils.js'
import type { SymbolIndexDiffSection } from './types.js'

/**
 * Compact companion to the code-graph node diff: path/symbol-id lists only,
 * no per-file or per-symbol payloads (the code-graph "changed nodes" section
 * already carries field-level detail for symbol nodes).
 *
 * Symbol identity mirrors the code-graph convention (`symbol:<path>#<name>`)
 * so the two sections stay directly comparable.
 */
export function buildSymbolIndexDiff(before: SymbolIndex | null, after: SymbolIndex | null): SymbolIndexDiffSection {
  if (!before || !after) {
    return {
      available: false,
      filesAdded: [],
      filesRemoved: [],
      filesChanged: [],
      symbolsAdded: [],
      symbolsRemoved: [],
      symbolsChanged: [],
    }
  }

  const beforeFiles = new Map(before.files.map((file) => [file.path, file]))
  const afterFiles = new Map(after.files.map((file) => [file.path, file]))

  const filesAdded: string[] = []
  const filesChanged: string[] = []
  for (const [filePath, afterFile] of afterFiles) {
    const beforeFile = beforeFiles.get(filePath)
    if (!beforeFile) {
      filesAdded.push(filePath)
    } else if (!deepEqual(beforeFile, afterFile)) {
      filesChanged.push(filePath)
    }
  }
  const filesRemoved: string[] = []
  for (const filePath of beforeFiles.keys()) {
    if (!afterFiles.has(filePath)) filesRemoved.push(filePath)
  }

  const beforeSymbols = flattenSymbols(before.files)
  const afterSymbols = flattenSymbols(after.files)

  const symbolsAdded: string[] = []
  const symbolsChanged: string[] = []
  for (const [symbolId, afterSymbol] of afterSymbols) {
    const beforeSymbol = beforeSymbols.get(symbolId)
    if (!beforeSymbol) {
      symbolsAdded.push(symbolId)
    } else if (!deepEqual(beforeSymbol, afterSymbol)) {
      symbolsChanged.push(symbolId)
    }
  }
  const symbolsRemoved: string[] = []
  for (const symbolId of beforeSymbols.keys()) {
    if (!afterSymbols.has(symbolId)) symbolsRemoved.push(symbolId)
  }

  return {
    available: true,
    filesAdded: filesAdded.sort(),
    filesRemoved: filesRemoved.sort(),
    filesChanged: filesChanged.sort(),
    symbolsAdded: symbolsAdded.sort(),
    symbolsRemoved: symbolsRemoved.sort(),
    symbolsChanged: symbolsChanged.sort(),
  }
}

function flattenSymbols(files: FileSummary[]): Map<string, FileSummary['symbols'][number]> {
  const bySymbolId = new Map<string, FileSummary['symbols'][number]>()
  for (const file of files) {
    for (const symbol of file.symbols) {
      bySymbolId.set(`symbol:${file.path}#${symbol.name}`, symbol)
    }
  }
  return bySymbolId
}
