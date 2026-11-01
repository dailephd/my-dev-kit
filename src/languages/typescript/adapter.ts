import * as path from 'node:path'
import { extractFromSource } from '../../symbol-index/symbolExtractor.js'
import { extractTypeScriptCallGraphEdges } from '../../symbol-index/graphBuilder.js'
import { toForwardSlash } from '../../io/pathUtils.js'
import type { LanguageAdapter, ExtractionResult, SourceFileInput } from '../types.js'
import type { CallGraphEdge } from '../../symbol-index/types.js'
import { ConfiguredImportResolver } from './configuredImportResolver.js'

export class TypeScriptAdapter implements LanguageAdapter {
  private readonly configured?: ConfiguredImportResolver
  constructor(repoRoot?: string) {
    if (repoRoot) this.configured = new ConfiguredImportResolver(repoRoot)
  }
  readonly extensions = ['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mts', '.cts'] as const
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
    const candidates = this.resolveCandidates(specifier, importingFile, knownFiles)
    return candidates.length === 1 ? candidates[0] : null
  }

  resolveCandidates(specifier: string, importingFile: string, knownFiles: readonly string[]): string[] {
    return specifier.startsWith('.') ? resolveJsTsCandidates(specifier, importingFile, knownFiles)
      : this.configured?.resolve(specifier, importingFile, knownFiles, resolveJsTsCandidates) ?? []
  }

  resolutionDiagnostic(specifier: string, importingFile: string): string | undefined {
    return this.configured?.diagnostic(specifier, importingFile)
  }
}

const JS_TS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mts', '.cts']

/** Alternate source paths a relative specifier may denote besides the literal path (pure path arithmetic). */
function jsTsAlternates(base: string): string[] {
  const ext = path.extname(base).toLowerCase()
  return ext === '.js' ? [base.slice(0, -3) + '.ts', base.slice(0, -3) + '.tsx']
    : ext === '.jsx' ? [base.slice(0, -4) + '.tsx']
    : ext === '.mjs' ? [base.slice(0, -4) + '.mts']
    : ext === '.cjs' ? [base.slice(0, -4) + '.cts']
    : ext ? []
    : JS_TS_EXTENSIONS.flatMap(e => [base + e, base + '/index' + e])
}

/**
 * Every project-relative path resolveJsTsCandidates could return for a relative specifier, whether or not
 * the file exists. Null when the specifier is not relative or its extension shape is outside the supported
 * resolution (for example data files), so a caller cannot mistake an unsupported shape for a complete set.
 * Paths may begin with ".." when the specifier leaves the project root; callers must reject those.
 */
export function enumerateJsTsCandidatePaths(specifier: string, importingFile: string): string[] | null {
  if (!specifier.startsWith('.')) return null
  const base = toForwardSlash(path.posix.normalize(toForwardSlash(path.join(path.dirname(importingFile), specifier))))
  const ext = path.extname(base).toLowerCase()
  const resolvable = ext === '' || ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'].includes(ext)
  if (!resolvable) return null
  // The literal path is a candidate only when it names a resolvable source file (an extensionless
  // specifier may denote a directory, which is not a source candidate).
  const literal = JS_TS_EXTENSIONS.includes(ext) ? [base] : []
  return [...new Set([...literal, ...jsTsAlternates(base)])].sort()
}

/** Selected source files only; probe order is never evidence of uniqueness. */
export function resolveJsTsCandidates(specifier: string, importingFile: string, knownFiles: readonly string[]): string[] {
  if (!specifier.startsWith('.')) return []
  const base = toForwardSlash(path.join(path.dirname(importingFile), specifier))
  const known = new Set(knownFiles.filter(file => JS_TS_EXTENSIONS.includes(path.extname(file).toLowerCase())))
  if (known.has(base)) return [base]
  return [...new Set(jsTsAlternates(base).filter(p => known.has(p)))].sort()
}
