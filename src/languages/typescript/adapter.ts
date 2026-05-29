import * as path from 'node:path'
import { extractFromSource } from '../../symbol-index/symbolExtractor.js'
import { extractTypeScriptCallGraphEdges } from '../../symbol-index/graphBuilder.js'
import { toForwardSlash } from '../../io/pathUtils.js'
import type { LanguageAdapter, ExtractionResult, SourceFileInput } from '../types.js'
import type { CallGraphEdge } from '../../symbol-index/types.js'

export class TypeScriptAdapter implements LanguageAdapter {
  readonly extensions = ['.ts', '.tsx', '.js', '.jsx'] as const
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
    if (!specifier.startsWith('.')) return null
    const fromDir = toForwardSlash(path.dirname(importingFile))
    const base = toForwardSlash(path.join(fromDir, specifier))
    const knownSet = new Set(knownFiles)

    if (knownSet.has(base)) return base

    for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
      const candidate = base + ext
      if (knownSet.has(candidate)) return candidate
    }

    for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
      const candidate = base + '/index' + ext
      if (knownSet.has(candidate)) return candidate
    }

    return null
  }
}
