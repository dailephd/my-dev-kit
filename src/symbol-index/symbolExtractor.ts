/**
 * TypeScript/JavaScript symbol extractor.
 *
 * Uses the TypeScript compiler API (ts.createSourceFile) to walk the AST of a
 * source file and extract:
 * - import module specifiers
 * - exported symbol names
 * - named symbol definitions (functions, classes, interfaces, types, enums,
 *   top-level const/variable declarations)
 *
 * Does not perform type-checking. Works on source text alone.
 * Suitable for indexing TypeScript and JavaScript files without a project setup.
 */

import * as ts from 'typescript'
import * as path from 'path'
import {
  type SymbolDefinition,
  type SymbolKind,
  type SymbolLocation,
  type SourceLanguage,
} from './types.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result of extracting symbols from one source file. */
export interface ExtractionResult {
  language: SourceLanguage
  lineCount: number
  imports: string[]
  exports: string[]
  symbols: SymbolDefinition[]
  /** Raw module specifiers from named re-export declarations (`export { X } from "..."`). */
  reExportSpecifiers: string[]
  /** Raw module specifiers from export-all declarations (`export * from "..."`). */
  exportAllSpecifiers: string[]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extracts symbols, imports, and exports from the given source text.
 *
 * @param filePath    Path of the file, used only for computing relative
 *                    SymbolLocation.file values. Must be relative to repo root.
 * @param sourceText  UTF-8 content of the source file.
 */
export function extractFromSource(
  filePath: string,
  sourceText: string
): ExtractionResult {
  const language = languageOf(filePath)
  const scriptKind =
    language === 'typescript'
      ? filePath.endsWith('.tsx')
        ? ts.ScriptKind.TSX
        : ts.ScriptKind.TS
      : ts.ScriptKind.JS

  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind
  )

  const lineCount = sourceText.split('\n').length
  const imports: string[] = []
  const exports: string[] = []
  const symbols: SymbolDefinition[] = []
  const reExportSpecifiers: string[] = []
  const exportAllSpecifiers: string[] = []

  ts.forEachChild(sourceFile, (node) => {
    visitTopLevel(
      node,
      sourceFile,
      filePath,
      imports,
      exports,
      symbols,
      reExportSpecifiers,
      exportAllSpecifiers
    )
  })

  return {
    language,
    lineCount,
    imports: dedup(imports),
    exports: dedup(exports),
    symbols,
    reExportSpecifiers: dedup(reExportSpecifiers),
    exportAllSpecifiers: dedup(exportAllSpecifiers),
  }
}

// ---------------------------------------------------------------------------
// AST visitors
// ---------------------------------------------------------------------------

function visitTopLevel(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
  imports: string[],
  exports: string[],
  symbols: SymbolDefinition[],
  reExportSpecifiers: string[],
  exportAllSpecifiers: string[]
): void {
  // Import declarations
  if (ts.isImportDeclaration(node)) {
    const specifier = (node.moduleSpecifier as ts.StringLiteral).text
    imports.push(specifier)
    return
  }

  // Export declarations:
  //   export { Foo } from './foo'    → named re-export
  //   export * from './foo'          → export-all
  //   export { Foo }                 → local re-export (no specifier — not a dep edge)
  if (ts.isExportDeclaration(node)) {
    const specifier = node.moduleSpecifier
      ? (node.moduleSpecifier as ts.StringLiteral).text
      : null

    if (node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const el of node.exportClause.elements) {
        exports.push(el.name.text)
      }
      if (specifier) reExportSpecifiers.push(specifier)
    } else if (!node.exportClause && specifier) {
      // export * from '...'
      exportAllSpecifiers.push(specifier)
    }
    return
  }

  // Function declarations
  if (ts.isFunctionDeclaration(node) && node.name) {
    const name = node.name.text
    const exp = hasExportKeyword(node)
    if (exp) exports.push(name)
    symbols.push({
      name,
      kind: 'function',
      location: locationOf(node, sourceFile, filePath),
      exported: exp,
      signature: briefSignature(node, sourceFile),
    })
    return
  }

  // Class declarations
  if (ts.isClassDeclaration(node) && node.name) {
    const name = node.name.text
    const exp = hasExportKeyword(node)
    if (exp) exports.push(name)
    symbols.push({
      name,
      kind: 'class',
      location: locationOf(node, sourceFile, filePath),
      exported: exp,
      signature: briefSignature(node, sourceFile),
    })
    return
  }

  // Interface declarations
  if (ts.isInterfaceDeclaration(node)) {
    const name = node.name.text
    const exp = hasExportKeyword(node)
    if (exp) exports.push(name)
    symbols.push({
      name,
      kind: 'interface',
      location: locationOf(node, sourceFile, filePath),
      exported: exp,
      signature: briefSignature(node, sourceFile),
    })
    return
  }

  // Type alias declarations
  if (ts.isTypeAliasDeclaration(node)) {
    const name = node.name.text
    const exp = hasExportKeyword(node)
    if (exp) exports.push(name)
    symbols.push({
      name,
      kind: 'type',
      location: locationOf(node, sourceFile, filePath),
      exported: exp,
      signature: briefSignature(node, sourceFile),
    })
    return
  }

  // Enum declarations
  if (ts.isEnumDeclaration(node)) {
    const name = node.name.text
    const exp = hasExportKeyword(node)
    if (exp) exports.push(name)
    symbols.push({
      name,
      kind: 'enum',
      location: locationOf(node, sourceFile, filePath),
      exported: exp,
      signature: briefSignature(node, sourceFile),
    })
    return
  }

  // Variable statements: const foo = ..., let bar = ..., var baz = ...
  if (ts.isVariableStatement(node)) {
    const exp = hasExportKeyword(node)
    const isConst = !!(node.declarationList.flags & ts.NodeFlags.Const)
    const kind: SymbolKind = isConst ? 'const' : 'variable'

    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) {
        const name = decl.name.text
        if (exp) exports.push(name)
        symbols.push({
          name,
          kind,
          location: locationOf(decl, sourceFile, filePath),
          exported: exp,
          signature: briefSignature(node, sourceFile),
        })
      }
    }
    return
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the node has an `export` keyword in its modifiers.
 * Works for TypeScript 4.8+ and 5.x by directly inspecting the modifiers array.
 */
function hasExportKeyword(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

/**
 * Returns a SymbolLocation for the given node.
 * Line is 1-based; file is the provided filePath.
 */
function locationOf(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string
): SymbolLocation {
  const { line } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile)
  )
  return { file: filePath, line: line + 1 }
}

/**
 * Returns the first line of the node's source text, trimmed and capped at 120
 * characters. Intended as a compact, human-readable signature for the index.
 */
function briefSignature(node: ts.Node, sourceFile: ts.SourceFile): string {
  const text = node.getText(sourceFile)
  const firstLine = text.split('\n')[0].trim()
  return firstLine.length > 120 ? firstLine.slice(0, 117) + '...' : firstLine
}

/**
 * Determines the source language from the file extension.
 */
function languageOf(filePath: string): SourceLanguage {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.ts' || ext === '.tsx') return 'typescript'
  return 'javascript'
}

/**
 * Deduplicates a string array, preserving first-occurrence order.
 */
function dedup(arr: string[]): string[] {
  return [...new Set(arr)]
}
