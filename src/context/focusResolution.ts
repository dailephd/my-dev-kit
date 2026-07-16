import { toForwardSlash } from '../io/pathUtils.js'
import type { CodeGraph, CodeGraphNode } from '../graph/codeGraphTypes.js'
import type { SymbolIndex } from '../symbol-index/types.js'
import type { ContextFocusIntake, FocusFileResolution, FocusSymbolResolution } from './types.js'

const STABLE_ID_PATTERN = /^symbol:.+#.+$/

function normalizeInputPath(value: string): string {
  return toForwardSlash(value).replace(/^\.\//, '')
}

/**
 * Resolves `focusFiles` against the active index's symbol index, and
 * `focusSymbols` against the active index's code graph. Additive, read-only:
 * consumes the same `SymbolIndex`/`CodeGraph` artifacts already loaded by
 * `contextCommand.ts` — no second index, no second graph traversal.
 */
export function resolveFocusIntake(options: {
  focusFiles: string[]
  focusSymbols: string[]
  symbolIndex: SymbolIndex
  codeGraph: CodeGraph
}): ContextFocusIntake {
  const { focusFiles, symbolIndex, codeGraph } = options
  const focusSymbols = options.focusSymbols

  const filesByPath = new Map(symbolIndex.files.map((file) => [normalizeInputPath(file.path), file]))

  const fileResolutions: FocusFileResolution[] = []
  const unresolvedFocusFiles: string[] = []
  for (const rawPath of focusFiles) {
    const normalized = normalizeInputPath(rawPath)
    const match = filesByPath.get(normalized)
    if (!match) {
      fileResolutions.push({ path: rawPath, resolved: false, matchedFilePaths: [], containedSymbolIds: [] })
      unresolvedFocusFiles.push(rawPath)
      continue
    }
    const containedSymbolIds = match.symbols.map((symbol) => `symbol:${match.path}#${symbol.name}`).sort()
    fileResolutions.push({
      path: rawPath,
      resolved: true,
      matchedFilePaths: [match.path],
      containedSymbolIds,
    })
  }

  const symbolNodesByExactId = new Map<string, CodeGraphNode>()
  const symbolNodesBySimpleName = new Map<string, CodeGraphNode[]>()
  for (const node of codeGraph.nodes) {
    if (node.kind !== 'symbol') continue
    symbolNodesByExactId.set(node.id, node)
    const simpleName = node.symbolName ?? node.label
    if (!simpleName) continue
    const bucket = symbolNodesBySimpleName.get(simpleName)
    if (bucket) bucket.push(node)
    else symbolNodesBySimpleName.set(simpleName, [node])
  }

  const symbolResolutions: FocusSymbolResolution[] = []
  const unresolvedFocusSymbols: string[] = []
  const ambiguousFocusSymbols: string[] = []
  for (const rawSymbol of focusSymbols) {
    if (STABLE_ID_PATTERN.test(rawSymbol)) {
      const exact = symbolNodesByExactId.get(rawSymbol)
      if (exact) {
        symbolResolutions.push({ symbol: rawSymbol, resolved: true, ambiguous: false, matchedNodeIds: [exact.id] })
      } else {
        symbolResolutions.push({ symbol: rawSymbol, resolved: false, ambiguous: false, matchedNodeIds: [] })
        unresolvedFocusSymbols.push(rawSymbol)
      }
      continue
    }

    const candidates = (symbolNodesBySimpleName.get(rawSymbol) ?? []).map((node) => node.id).sort()
    if (candidates.length === 0) {
      symbolResolutions.push({ symbol: rawSymbol, resolved: false, ambiguous: false, matchedNodeIds: [] })
      unresolvedFocusSymbols.push(rawSymbol)
    } else if (candidates.length === 1) {
      symbolResolutions.push({ symbol: rawSymbol, resolved: true, ambiguous: false, matchedNodeIds: candidates })
    } else {
      symbolResolutions.push({ symbol: rawSymbol, resolved: false, ambiguous: true, matchedNodeIds: candidates })
      ambiguousFocusSymbols.push(rawSymbol)
    }
  }

  const warnings: string[] = []
  for (const unresolved of unresolvedFocusFiles) {
    warnings.push(`focusFiles entry "${unresolved}" did not match any indexed file; no candidates were added for it.`)
  }
  for (const unresolved of unresolvedFocusSymbols) {
    warnings.push(`focusSymbols entry "${unresolved}" did not match any indexed symbol; no candidates were added for it.`)
  }
  for (const ambiguous of ambiguousFocusSymbols) {
    warnings.push(`focusSymbols entry "${ambiguous}" matched more than one symbol; ambiguity was preserved and no candidate was auto-selected.`)
  }

  return {
    focusFiles: fileResolutions,
    focusSymbols: symbolResolutions,
    unresolvedFocusFiles: [...unresolvedFocusFiles].sort(),
    unresolvedFocusSymbols: [...unresolvedFocusSymbols].sort(),
    ambiguousFocusSymbols: [...ambiguousFocusSymbols].sort(),
    warnings,
  }
}
