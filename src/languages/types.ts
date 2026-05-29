import type { CallGraphEdge } from '../symbol-index/types.js'
import type { ExtractionResult } from '../symbol-index/symbolExtractor.js'

export type { ExtractionResult }

/** Input descriptor for one source file to analyze. */
export interface SourceFileInput {
  /** File path relative to the repo root (forward slashes). */
  filePath: string
  /** UTF-8 content of the file. */
  sourceText: string
}

/**
 * Adapter interface for a source language supported by the indexing pipeline.
 *
 * Each adapter is responsible for:
 *  1. Declaring which file extensions it handles.
 *  2. Extracting symbols, imports, and exports from source text.
 *  3. Resolving a recorded import specifier back to a local indexed file path.
 *  4. Optionally extracting call-graph edges for its own language.
 *
 * Resolution semantics differ by language:
 *  - TypeScript/JavaScript uses relative `./` specifiers resolved against the
 *    indexed file set with extension probing.
 *  - Python uses dotted module names resolved via a module-path map built from
 *    the indexed file set.
 *
 * If a specifier cannot be resolved to a known local file (e.g. it is an
 * external package), `resolveImportToFile` returns null.
 */
export interface LanguageAdapter {
  /** File extensions handled by this adapter, including the leading dot. */
  readonly extensions: readonly string[]

  /** Whether this adapter supports call-graph extraction. */
  readonly supportsCallGraph: boolean

  /**
   * Extract symbols, imports, and exports from a source file.
   *
   * @param filePath   Path of the file relative to the repo root (forward slashes).
   * @param sourceText UTF-8 source content.
   */
  extractFromSource(filePath: string, sourceText: string): ExtractionResult

  /**
   * Extract call-graph edges from source files handled by this adapter.
   *
   * Implementations must be static only: they must not execute user source.
   * This method is called only when supportsCallGraph is true and the index
   * command was run with --call-graph.
   */
  extractCallGraphEdges?(files: readonly SourceFileInput[]): CallGraphEdge[]

  /**
   * Resolve an import specifier (as stored in FileSummary.imports) to the
   * relative path of a local indexed file.
   *
   * @param specifier    Import specifier string as returned by extractFromSource.
   * @param importingFile Relative path of the file that contains the import.
   * @param knownFiles   All indexed file paths (relative to repo root, forward slashes).
   * @returns Relative path of the resolved file, or null if unresolvable.
   */
  resolveImportToFile(
    specifier: string,
    importingFile: string,
    knownFiles: readonly string[]
  ): string | null
}
