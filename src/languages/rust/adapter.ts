import type { LanguageAdapter, ExtractionResult } from '../types.js'
import { withRustTree } from './parser.js'
import { extractRustSyntax } from './syntaxFacts.js'

export class RustAdapter implements LanguageAdapter {
  readonly extensions = ['.rs'] as const
  readonly supportsCallGraph = false
  extractFromSource(filePath: string, sourceText: string): ExtractionResult {
    return withRustTree(filePath, sourceText, tree => extractRustSyntax(filePath, sourceText, tree))
  }
  /** B08 preserves syntax only. Cargo/modules and Rust graph resolution belong to B09/B10. */
  resolveImportToFile(): null { return null }
}
