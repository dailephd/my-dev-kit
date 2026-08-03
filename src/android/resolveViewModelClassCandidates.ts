import type { SymbolIndex } from '../symbol-index/types.js'

/**
 * v1.12.0 Batch 4: extracted from `buildAndroidArtifactRelationships.ts`'s
 * existing `composable-references-viewmodel` edge construction (v1.11.0
 * Batch 3) into a shared helper, reused unchanged so `composable-references-
 * viewmodel` and the new Batch 4 `candidateViewModelSymbolIds`/
 * `compose-state-reads-viewmodel` edge all resolve a ViewModel type
 * reference to indexed class symbols identically - exact simple class name
 * only, never fuzzy, never case-folded, never suffix-matched.
 */
export function resolveViewModelClassCandidates(typeText: string, symbolIndex: SymbolIndex): string[] {
  const bare = typeText.trim().replace(/[?]$/, '')
  const simpleName = bare.includes('.') ? bare.slice(bare.lastIndexOf('.') + 1) : bare
  if (!/^[A-Za-z_]\w*$/.test(simpleName)) return []
  const results: string[] = []
  for (const file of symbolIndex.files) {
    if (file.language !== 'kotlin' && file.language !== 'java') continue
    for (const symbol of file.symbols) {
      if (symbol.name === simpleName && symbol.kind === 'class') {
        results.push(`symbol:${file.path}#${symbol.name}`)
      }
    }
  }
  return [...new Set(results)].sort()
}
