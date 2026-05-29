/**
 * Optional call-graph builder.
 *
 * Performs a best-effort static analysis of call relationships between named
 * functions across the scanned source files. Does not require type-checking —
 * callee file resolution uses heuristics (import map lookup) and falls back to
 * null for external or unresolvable callees.
 *
 * This module is kept separate from the main builder so that call-graph
 * construction can be disabled without affecting the main symbol-index output.
 */

import * as ts from 'typescript'
import * as path from 'path'
import { type CallGraph, type CallGraphEdge, SCHEMA_VERSION } from './types.js'
import { toForwardSlash as normalizePath } from '../io/pathUtils.js'
import type { SourceFileInput } from '../languages/types.js'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds a call-graph artifact from the given source files.
 *
 * Analysis is purely syntactic: call expressions within function/method bodies
 * are recorded as edges. Callee file is resolved by matching the callee name
 * against the import map of the calling file; otherwise null.
 *
 * @param files  Source files to analyze.
 */
export function buildCallGraph(files: SourceFileInput[]): CallGraph {
  const buildTime = new Date().toISOString()
  return createCallGraph(extractTypeScriptCallGraphEdges(files), buildTime)
}

export function createCallGraph(
  edges: CallGraphEdge[],
  buildTime = new Date().toISOString()
): CallGraph {
  return {
    schemaVersion: SCHEMA_VERSION,
    buildTime,
    edgeCount: edges.length,
    edges,
  }
}

export function extractTypeScriptCallGraphEdges(
  files: readonly SourceFileInput[]
): CallGraphEdge[] {
  const edges: CallGraphEdge[] = []

  // Build a name → file map from all known top-level exported names so we
  // can resolve local callees to their source files.
  const exportMap = buildExportMap(files)

  for (const { filePath, sourceText } of files) {
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true
    )

    // Build an import specifier → absolute-ish file path map for this file
    const importedNames = buildImportedNameMap(sourceFile, filePath, exportMap)

    extractEdges(sourceFile, filePath, importedNames, edges)
  }

  return edges
}

// ---------------------------------------------------------------------------
// Edge extraction
// ---------------------------------------------------------------------------

/**
 * Walks the AST of one source file and appends call edges into `edges`.
 * Each top-level function/method acts as the caller context.
 */
function extractEdges(
  sourceFile: ts.SourceFile,
  filePath: string,
  importedNames: Map<string, string | null>,
  edges: CallGraphEdge[]
): void {
  function walk(node: ts.Node, currentCaller: CallerContext | null): void {
    // Entering a new named function — update caller context
    const newCaller = resolveCaller(node, sourceFile, filePath, currentCaller)
    const activeCaller = newCaller ?? currentCaller

    // Record call expression edges
    if (ts.isCallExpression(node) && activeCaller) {
      const calleeName = calleeNameOf(node.expression)
      if (calleeName && calleeName !== '<computed>') {
        const callLine =
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1
        const calleeFile = resolveCalleeFile(calleeName, importedNames)
        edges.push({
          caller: {
            file: activeCaller.file,
            name: activeCaller.name,
            line: activeCaller.line,
          },
          callee: { file: calleeFile, name: calleeName },
          callLine,
        })
      }
    }

    ts.forEachChild(node, (child) => walk(child, activeCaller))
  }

  walk(sourceFile, null)
}

interface CallerContext {
  file: string
  name: string
  line: number
}

/** If `node` is a named function/method/arrow-with-name, returns a new CallerContext. */
function resolveCaller(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
  parent: CallerContext | null
): CallerContext | null {
  const lineOf = (n: ts.Node) =>
    sourceFile.getLineAndCharacterOfPosition(n.getStart(sourceFile)).line + 1

  if (ts.isFunctionDeclaration(node) && node.name) {
    return { file: filePath, name: node.name.text, line: lineOf(node) }
  }

  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
    const ownerName = parent?.name
      ? `${parent.name}.${node.name.text}`
      : node.name.text
    return { file: filePath, name: ownerName, line: lineOf(node) }
  }

  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    // Arrow functions assigned to a const/let declaration
    if (
      node.parent &&
      ts.isVariableDeclaration(node.parent) &&
      ts.isIdentifier(node.parent.name)
    ) {
      return { file: filePath, name: node.parent.name.text, line: lineOf(node) }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Callee resolution helpers
// ---------------------------------------------------------------------------

/**
 * Attempts to extract a readable callee name from a call expression's `expression`.
 * Returns '<computed>' for dynamic/complex expressions.
 */
function calleeNameOf(expr: ts.LeftHandSideExpression): string {
  if (ts.isIdentifier(expr)) return expr.text
  if (ts.isPropertyAccessExpression(expr)) {
    return calleeNameOf(expr.expression) + '.' + expr.name.text
  }
  return '<computed>'
}

/**
 * Looks up the callee name in the import-name map.
 * Returns the file path of the callee's definition, or null if unresolvable.
 */
function resolveCalleeFile(
  calleeName: string,
  importedNames: Map<string, string | null>
): string | null {
  // Direct match
  if (importedNames.has(calleeName)) return importedNames.get(calleeName)!
  // Match by first segment (e.g. "obj.method" → look up "obj")
  const base = calleeName.split('.')[0]
  if (importedNames.has(base)) return importedNames.get(base)!
  return null
}

// ---------------------------------------------------------------------------
// Export map and import-name map builders
// ---------------------------------------------------------------------------

/**
 * Builds a map from exported name → source file path across all input files.
 * Used to resolve local callees to their defining files.
 */
function buildExportMap(files: readonly SourceFileInput[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const { filePath, sourceText } of files) {
    const sf = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true
    )
    ts.forEachChild(sf, (node) => {
      if (hasExportKeyword(node)) {
        const name = declaredName(node)
        if (name) map.set(name, filePath)
      }
      if (
        ts.isExportDeclaration(node) &&
        node.exportClause &&
        ts.isNamedExports(node.exportClause)
      ) {
        for (const el of node.exportClause.elements) {
          map.set(el.name.text, filePath)
        }
      }
    })
  }
  return map
}

/**
 * Builds a map from imported name → resolved file path for one source file.
 * For relative imports, resolves against the file's own path.
 * For non-relative imports (packages), maps to null.
 */
function buildImportedNameMap(
  sourceFile: ts.SourceFile,
  filePath: string,
  exportMap: Map<string, string>
): Map<string, string | null> {
  const map = new Map<string, string | null>()
  const fileDir = path.dirname(filePath)

  ts.forEachChild(sourceFile, (node) => {
    if (!ts.isImportDeclaration(node)) return
    const specifier = (node.moduleSpecifier as ts.StringLiteral).text

    // Only handle relative imports for file resolution
    const resolvedPath = specifier.startsWith('.')
      ? normalizePath(path.join(fileDir, specifier))
      : null

    if (!node.importClause) return
    const clause = node.importClause

    // Default import: import Foo from './foo'
    if (clause.name) {
      map.set(clause.name.text, resolvedPath ?? null)
    }

    // Named imports: import { Foo, Bar } from './foo'
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        // Try to resolve via export map first
        const resolvedViaExport =
          exportMap.get(el.name.text) ?? resolvedPath ?? null
        map.set(el.name.text, resolvedViaExport)
      }
    }

    // Namespace import: import * as ts from 'typescript'
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      map.set(clause.namedBindings.name.text, resolvedPath ?? null)
    }
  })

  return map
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function hasExportKeyword(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

function declaredName(node: ts.Node): string | null {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  ) {
    return node.name?.text ?? null
  }
  if (ts.isVariableStatement(node)) {
    const first = node.declarationList.declarations[0]
    if (first && ts.isIdentifier(first.name)) return first.name.text
  }
  return null
}
