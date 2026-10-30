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
import { extractFromSource } from './symbolExtractor.js'
import { assignDeclarationIdentities } from './declarationIdentity.js'
import { resolveJsTsCandidates } from '../languages/typescript/adapter.js'
import { type CallGraph, type CallGraphEdge, SCHEMA_VERSION } from './types.js'
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

  // Resolve declarations within each selected module; names are never global.
  const extractions = new Map(files.map(f => {
    const result = extractFromSource(f.filePath, f.sourceText)
    result.symbols = assignDeclarationIdentities(f.filePath, result.symbols)
    return [f.filePath, result] as const
  }))

  for (const { filePath, sourceText } of files) {
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      /\.tsx$/i.test(filePath) ? ts.ScriptKind.TSX : /\.jsx$/i.test(filePath) ? ts.ScriptKind.JSX : /\.(js|cjs)$/i.test(filePath) ? ts.ScriptKind.JS : ts.ScriptKind.TS
    )

    // Every candidate starts with the importing file's observed binding.
    const extraction = extractions.get(filePath)!
    const importedNames = new Map<string, { file: string; name: string; nodeId?: string }>()
    for (const binding of extraction.importBindings ?? []) {
      if (!binding.localName || binding.resolutionStatus === 'unresolved') continue
      const targets = resolveJsTsCandidates(binding.sourceSpecifier, filePath, [...extractions.keys()])
      if (targets.length !== 1) continue
      const target = extractions.get(targets[0])!
      const names = binding.wildcard === true ? [binding.localName, ...target.exports.map(n => binding.localName + '.' + n)] : [binding.localName]
      const targetSf = ts.createSourceFile(targets[0], files.find(f => f.filePath === targets[0])!.sourceText, ts.ScriptTarget.Latest, true)
      for (const local of names) {
        const exported = local.includes('.') ? local.slice(local.indexOf('.') + 1) : binding.wildcard === true ? null : binding.importedName
        const cjs = target.commonJsExports?.filter(f => (f.exportedName === exported || exported === 'default' && f.exportedName === null) && f.resolutionStatus === 'resolved-local') ?? []
        let name = cjs.length === 1 ? cjs[0].bindingName : exported
        let localExport = false
        for (const statement of targetSf.statements) {
          if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
            const alias = statement.exportClause.elements.filter(e => e.name.text === exported && !e.isTypeOnly)
            if (alias.length === 1) { name = alias[0].propertyName?.text ?? alias[0].name.text; localExport = true }
          }
        }
        const directExport = (s: import('./types.js').SymbolDefinition) => targetSf.statements.some(statement =>
          ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) &&
          !ts.isExportDeclaration(statement) && (ts.isVariableStatement(statement)
            ? statement.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === s.name && targetSf.getLineAndCharacterOfPosition(d.getStart(targetSf)).line + 1 === s.location.line)
            : targetSf.getLineAndCharacterOfPosition(statement.getStart(targetSf)).line + 1 === s.location.line))
        let matches = target.symbols.filter(s => s.name === name && s.kind !== 'type' && s.kind !== 'interface' && (cjs.length === 1 || localExport || directExport(s)))
        if (exported === 'default' && cjs.length === 0) {
          const defaults = targetSf.statements.filter(n => ts.canHaveModifiers(n) && ts.getModifiers(n)?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword))
          if (defaults.length === 1) matches = target.symbols.filter(s => s.exported && s.location.line === targetSf.getLineAndCharacterOfPosition(defaults[0].getStart(targetSf)).line + 1)
          const assignments = targetSf.statements.filter((n): n is ts.ExportAssignment => ts.isExportAssignment(n) && !n.isExportEquals)
          if (defaults.length === 0 && assignments.length === 1 && ts.isIdentifier(assignments[0].expression)) {
            const defaultName = assignments[0].expression.text
            matches = target.symbols.filter(s => s.name === defaultName && s.kind !== 'type' && s.kind !== 'interface')
          }
        }
        if (matches.length === 1) importedNames.set(local, { file: targets[0], name: matches[0].name, nodeId: matches[0].nodeId })
      }
    }
    extractEdges(sourceFile, filePath, importedNames, edges, extraction.symbols)
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
  importedNames: Map<string, { file: string; name: string; nodeId?: string }>,
  edges: CallGraphEdge[],
  symbols: import('./types.js').SymbolDefinition[]
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
        const base = calleeName.split('.')[0]
        const shadowed = hasLocalShadow(node, base, sourceFile)
        const target = shadowed ? undefined : importedNames.get(calleeName)
        const calleeFile = target?.file ?? null
        const callers = symbols.filter(s => s.name === activeCaller.name && s.location.line === activeCaller.line && (!activeCaller.qualifiedName || s.qualifiedName === activeCaller.qualifiedName))
        edges.push({
          caller: {
            file: activeCaller.file,
            name: activeCaller.name,
            line: activeCaller.line,
          },
          ...(callers.length === 1 ? { callerNodeId: callers[0].nodeId } : {}),
          ...(target?.nodeId ? { calleeNodeId: target.nodeId } : {}),
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
  qualifiedName?: string
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
    const cls = node.parent
    return { file: filePath, name: ownerName, line: lineOf(node), ...(ts.isClassDeclaration(cls) && cls.name ? { qualifiedName: `${cls.name.text}.${node.name.text}` } : {}) }
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

/** A conservative lexical guard: declarations or writes in any enclosing scope block imported resolution. */
function hasLocalShadow(call: ts.Node, name: string, sf: ts.SourceFile): boolean {
  const hasName = (n: ts.BindingName): boolean => ts.isIdentifier(n) ? n.text === name : n.elements.some(e => !ts.isOmittedExpression(e) && hasName(e.name))
  for (let scope: ts.Node | undefined = call.parent; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope) && !ts.isFunctionLike(scope) && !ts.isCatchClause(scope)) continue
    let blocked = false
    function scan(n: ts.Node): void {
      if (n !== scope && ts.isFunctionLike(n)) {
        if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) && n.name?.text === name) blocked = true
        return
      }
      if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n)) && hasName(n.name)) {
        // The original require declaration is the binding, rather than a shadow.
        const originalRequire = scope === sf && ts.isVariableDeclaration(n) && n.initializer && ts.isCallExpression(n.initializer) && ts.isIdentifier(n.initializer.expression) && n.initializer.expression.text === 'require'
        if (originalRequire) return
        if (!originalRequire) blocked = true
      }
      if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.initializer) && n.initializer.text === name) blocked = true
      if (ts.isClassDeclaration(n) && n.name?.text === name) blocked = true
      if (ts.isImportClause(n) && n.isTypeOnly && (n.name?.text === name || n.namedBindings?.getText(sf).includes(name))) blocked = true
      if (ts.isImportSpecifier(n) && n.isTypeOnly && n.name.text === name) blocked = true
      if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(n.left) && n.left.text === name) blocked = true
      const rootName = (e: ts.Node): string | undefined => ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e) ? rootName(e.expression) : undefined
      if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment && rootName(n.left) === name) blocked = true
      if (ts.isDeleteExpression(n) && rootName(n.expression) === name) blocked = true
      if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(n.right) && n.right.text === name) blocked = true
      if ((ts.isPostfixUnaryExpression(n) || ts.isPrefixUnaryExpression(n)) && rootName(n.operand) === name) blocked = true
      if ((ts.isPostfixUnaryExpression(n) || ts.isPrefixUnaryExpression(n)) && ts.isIdentifier(n.operand) && n.operand.text === name) blocked = true
      ts.forEachChild(n, scan)
    }
    scan(scope)
    if (blocked) return true
  }
  return false
}
