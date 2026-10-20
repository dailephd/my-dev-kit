import * as path from 'node:path'
import { extractFromSource } from '../../symbol-index/symbolExtractor.js'
import { extractTypeScriptCallGraphEdges } from '../../symbol-index/graphBuilder.js'
import { toForwardSlash } from '../../io/pathUtils.js'
import type { LanguageAdapter, ExtractionResult, SourceFileInput } from '../types.js'
import type { CallGraphEdge } from '../../symbol-index/types.js'

export class TypeScriptAdapter implements LanguageAdapter {
  readonly extensions = ['.ts', '.tsx', '.js', '.jsx', '.cjs'] as const
  readonly supportsCallGraph = true

  extractFromSource(filePath: string, sourceText: string): ExtractionResult {
    return extractFromSource(filePath, sourceText)
  }

  extractCallGraphEdges(files: readonly SourceFileInput[]): CallGraphEdge[] {
    return extractTypeScriptCallGraphEdges(files)
  }

  resolveImportToFile(
    specifier: string,
    importingFile: string,
    knownFiles: readonly string[]
  ): string | null {
    const candidates = resolveJsTsCandidates(specifier, importingFile, knownFiles)
    return candidates.length === 1 ? candidates[0] : null
  }
}

/** Selected source files only; probe order is never evidence of uniqueness. */
export function resolveJsTsCandidates(specifier: string, importingFile: string, knownFiles: readonly string[]): string[] {
  if (!specifier.startsWith('.')) return []
  const base = toForwardSlash(path.join(path.dirname(importingFile), specifier))
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.cjs']
  const known = new Set(knownFiles.filter(file => extensions.includes(path.extname(file).toLowerCase())))
  if (known.has(base)) return [base]
  const ext = path.extname(base).toLowerCase()
  const candidates = ext === '.js' ? [base.slice(0, -3) + '.ts', base.slice(0, -3) + '.tsx']
    : ext === '.jsx' ? [base.slice(0, -4) + '.tsx']
    : ext ? []
    : ['.ts', '.tsx', '.js', '.jsx', '.cjs'].flatMap(e => [base + e, base + '/index' + e])
  return [...new Set(candidates.filter(p => known.has(p)))].sort()
}
