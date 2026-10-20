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
  type ImportBinding,
  type JSDocMetadata,
  type CommonJsExportFact,
} from './types.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result of extracting symbols from one source file. */
export interface ExtractionResult {
  commonJsExports?: CommonJsExportFact[]
  pythonOrmFacts?: import('./types.js').PythonOrmFact[]
  frameworkRouteFacts?: import('./types.js').FrameworkRouteFact[]
  importBindings?: ImportBinding[]
  warnings?: string[]
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
      : filePath.endsWith('.jsx')
        ? ts.ScriptKind.JSX
        : ts.ScriptKind.JS

  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind
  )

  const lineCount = sourceText.split('\n').length
  // Parser recovery cannot prove an exact declaration end, so a file with
  // syntax diagnostics receives no generic end-line metadata.
  const endLineLimit = hasParseErrors(sourceFile) ? null : lineCount
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
      exportAllSpecifiers,
      endLineLimit
    )
  })

  const warnings: string[] = []
  const importBindings: ImportBinding[] = []
  const commonJsExports: CommonJsExportFact[] = []
  extractDocumentation(sourceFile, filePath, symbols, warnings, endLineLimit)
  extractModuleEvidence(sourceFile, symbols, imports, exports, importBindings, commonJsExports, warnings)

  return {
    importBindings,
    commonJsExports,
    ...(warnings.length ? { warnings } : {}),
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
  exportAllSpecifiers: string[],
  endLineLimit: number | null
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
      location: locationOf(node, sourceFile, filePath, endLineLimit),
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
      location: locationOf(node, sourceFile, filePath, endLineLimit),
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
      location: locationOf(node, sourceFile, filePath, endLineLimit),
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
      location: locationOf(node, sourceFile, filePath, endLineLimit),
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
      location: locationOf(node, sourceFile, filePath, endLineLimit),
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
          location: locationOf(decl, sourceFile, filePath, endLineLimit),
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
 *
 * `endLine` is the 1-based inclusive line of the node's last character, taken
 * from the parser's declaration end offset (exclusive, so `end - 1` is the last
 * character). It is omitted when `endLineLimit` is null (the file has parse
 * diagnostics) or the range is not a valid span within `endLineLimit` lines.
 */
function locationOf(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
  endLineLimit: number | null
): SymbolLocation {
  const start = node.getStart(sourceFile)
  const { line } = sourceFile.getLineAndCharacterOfPosition(start)
  const location: SymbolLocation = { file: filePath, line: line + 1 }

  const end = node.getEnd()
  if (endLineLimit !== null && end > start) {
    const { line: lastLine } = sourceFile.getLineAndCharacterOfPosition(end - 1)
    const endLine = lastLine + 1
    if (
      Number.isInteger(endLine) &&
      endLine >= location.line &&
      endLine <= endLineLimit
    ) {
      location.endLine = endLine
    }
  }
  return location
}

/**
 * True when the parser reported syntax diagnostics for the file.
 * `parseDiagnostics` is not part of the public `ts.SourceFile` typings, so it
 * is read defensively; an unreadable value counts as untrusted.
 */
function hasParseErrors(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (sourceFile as { parseDiagnostics?: readonly unknown[] })
    .parseDiagnostics
  return !Array.isArray(diagnostics) || diagnostics.length > 0
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

function extractDocumentation(sf: ts.SourceFile, file: string, symbols: SymbolDefinition[], warnings: string[], endLimit: number | null): void {
  const supported = new Set(['param', 'returns', 'return', 'type', 'typedef', 'property', 'template', 'deprecated'])
  const seen = new Set<ts.JSDocTag>()
  function metadata(tags: readonly ts.JSDocTag[]): JSDocMetadata[] {
    const entries: JSDocMetadata[] = []
    function add(tag: ts.JSDocTag): void {
      if (seen.has(tag)) return
      seen.add(tag)
      const name = tag.tagName.text
      const typed = tag as ts.JSDocTag & { name?: ts.Node; typeExpression?: ts.Node; typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> }
      let status: JSDocMetadata['status'] = supported.has(name) ? 'syntax-only' : 'unsupported'
      const cap = (s: string | undefined, limit: number) => {
        if (s && s.length > limit) { status = 'partial'; return s.slice(0, limit) }
        return s
      }
      const typeNode = typed.typeExpression
      let type = typeNode && ts.isJSDocTypeExpression(typeNode) ? typeNode.type.getText(sf) : undefined
      if (typeNode && ts.isJSDocTypeLiteral(typeNode) && typed.name) {
        // The compiler replaces an Object typedef's type expression with a
        // JSDocTypeLiteral containing properties. Reparse only its AST-proven
        // header to retain the original documented spelling and array form.
        const header = '/** ' + sf.text.slice(tag.getStart(sf), typed.name.end) + ' */'
        const isolated = ts.createSourceFile('documentation.js', header, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
        const original = ts.getJSDocTags(isolated.endOfFileToken)[0] as ts.JSDocTypedefTag | undefined
        if (original?.typeExpression && ts.isJSDocTypeExpression(original.typeExpression)) type = original.typeExpression.type.getText(isolated)
      }
      if (typeNode && !type?.trim()) status = 'unsupported'
      if (endLimit === null) status = 'partial'
      const comment = typeof tag.comment === 'string' ? tag.comment : tag.comment?.map(p => p.text).join('')
      const parameterName = cap(typed.name?.getText(sf) ?? typed.typeParameters?.map(p => p.name.text).join(', '), 128)
      const typeExpression = cap(type, 512)
      const textSummary = cap(comment?.trim(), 160)
      if (['param', 'property', 'typedef'].includes(name) && !parameterName) status = 'unsupported'
      const entry: JSDocMetadata = {
        tagName: cap(name, 128)!,
        ...(parameterName ? { parameterName } : {}),
        ...(typeExpression ? { typeExpression } : {}),
        ...(textSummary ? { textSummary } : {}),
        startLine: sf.getLineAndCharacterOfPosition(tag.getStart(sf)).line + 1,
        endLine: sf.getLineAndCharacterOfPosition(Math.max(tag.pos, tag.end - 1)).line + 1,
        status,
      }
      entries.push(entry)
      if (typeNode && ts.isJSDocTypeLiteral(typeNode)) {
        for (const property of typeNode.jsDocPropertyTags ?? []) add(property)
      }
    }
    tags.forEach(add)
    if (entries.length > 24) {
      entries.length = 24
      entries[23].status = 'partial'
      warnings.push('JSDoc entry limit (24) reached; documentation is partial.')
    }
    for (const e of entries) if (e.status !== 'syntax-only') warnings.push(`JSDoc @${e.tagName} at line ${e.startLine}: ${e.status}.`)
    return entries
  }
  for (const statement of [...sf.statements, sf.endOfFileToken]) {
    const tags = ts.getJSDocTags(statement)
    if (!tags.length) continue
    const docs = metadata(tags)
    const line = sf.getLineAndCharacterOfPosition(statement.getStart(sf)).line + 1
    const targets = ts.isVariableStatement(statement)
      ? symbols.filter(s => statement.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === s.name && s.location.line === sf.getLineAndCharacterOfPosition(d.getStart(sf)).line + 1))
      : symbols.filter(s => s.location.line === line)
    for (const target of targets) target.declarationMetadata = { ...target.declarationMetadata, jsdoc: docs }
    for (const tag of tags) {
      if (!ts.isJSDocTypedefTag(tag) || !tag.fullName || !ts.isIdentifier(tag.fullName)) continue
      // The AST name and span establish a documentation declaration, not a runtime binding.
      const name = tag.fullName.text
      if (name.length > 128 || endLimit === null) { warnings.push('Unsupported or truncated JSDoc typedef declaration.'); continue }
      symbols.push({ name, kind: 'type', exported: false,
        // Documentation declarations occupy a distinct identity scope so a
        // same-named value keeps its pre-existing legacy or qualified identity.
        ownerKey: 'jsdoc/typedef',
        location: locationOf(tag, sf, file, endLimit), signature: tag.getText(sf).slice(0, 120),
        declarationMetadata: { jsdoc: docs },
      })
    }
  }
}

/** Conservative file-wide rejection of shadowed or reassigned Node globals. */
function extractModuleEvidence(sf: ts.SourceFile, symbols: SymbolDefinition[], imports: string[], exports: string[], bindings: ImportBinding[], facts: CommonJsExportFact[], warnings: string[]): void {
  const shadowed = new Set<string>()
  const mutated = new Set<string>()
  let unsupportedExportMutation = false
  let wholeModuleAssignments = 0
  const exportReceiver = (n: ts.Node): boolean => ts.isIdentifier(n) && n.text === 'exports' || ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'module' && n.name.text === 'exports'
  const exportRoot = (n: ts.Node): boolean => exportReceiver(n) || (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && exportRoot(n.expression)
  const bindNames = (n: ts.BindingName): string[] => ts.isIdentifier(n) ? [n.text] : n.elements.flatMap(e => ts.isOmittedExpression(e) ? [] : bindNames(e.name))
  function scan(n: ts.Node): void {
    if (ts.isElementAccessExpression(n) && exportRoot(n.expression)) unsupportedExportMutation = true
    if (ts.isDeleteExpression(n) && exportRoot(n.expression)) unsupportedExportMutation = true
    if (ts.isVariableDeclaration(n) && n.initializer && exportReceiver(n.initializer)) unsupportedExportMutation = true
    if (ts.isCallExpression(n) && n.arguments.some(exportReceiver)) unsupportedExportMutation = true
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment && exportReceiver(n.right)) unsupportedExportMutation = true
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment && n.operatorToken.kind !== ts.SyntaxKind.EqualsToken && exportRoot(n.left)) unsupportedExportMutation = true
    if ((ts.isPostfixUnaryExpression(n) || ts.isPrefixUnaryExpression(n)) && exportRoot(n.operand)) unsupportedExportMutation = true
    if (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n)) bindNames(n.name).forEach(x => shadowed.add(x))
    if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.name) shadowed.add(n.name.text)
    if (ts.isImportClause(n) && n.name) shadowed.add(n.name.text)
    if (ts.isImportSpecifier(n) || ts.isNamespaceImport(n)) shadowed.add(n.name.text)
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(n.left)) mutated.add(n.left.text)
    if ((ts.isPostfixUnaryExpression(n) || ts.isPrefixUnaryExpression(n)) && ts.isIdentifier(n.operand)) mutated.add(n.operand.text)
    ts.forEachChild(n, scan)
  }
  scan(sf)
  const span = (n: ts.Node) => ({ startLine: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, endLine: sf.getLineAndCharacterOfPosition(n.end - 1).line + 1 })
  const binding = (n: ts.Node, localName: string, importedName: string, sourceSpecifier: string, syntaxKind: 'esm' | 'commonjs', wholeModule = false) => {
    bindings.push({ localName, importedName, sourceSpecifier, syntaxKind, ...(wholeModule ? { wildcard: true } : {}), ...span(n), resolutionStatus: mutated.has(localName) ? 'unresolved' : 'observed' })
  }
  const literalRequire = (n: ts.Node | undefined): string | undefined => {
    if (!n || !ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || n.expression.text !== 'require') return
    if (shadowed.has('require') || mutated.has('require') || n.arguments.length !== 1 || !ts.isStringLiteral(n.arguments[0])) {
      warnings.push(`Unsupported require at line ${span(n).startLine}.`); return
    }
    return n.arguments[0].text
  }
  for (const n of sf.statements) {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const spec = n.moduleSpecifier.text
      const clause = n.importClause
      if (!clause) binding(n, '', '', spec, 'esm')
      if (clause?.name) binding(n, clause.name.text, 'default', spec, 'esm')
      const named = clause?.namedBindings
      if (named && ts.isNamespaceImport(named)) binding(n, named.name.text, '*', spec, 'esm', true)
      if (named && ts.isNamedImports(named)) for (const el of named.elements) binding(n, el.name.text, el.propertyName?.text ?? el.name.text, spec, 'esm')
    }
    if (ts.isVariableStatement(n)) for (const d of n.declarationList.declarations) {
      const spec = literalRequire(d.initializer)
      if (spec === undefined) continue
      imports.push(spec)
      if (ts.isIdentifier(d.name)) binding(d, d.name.text, '*', spec, 'commonjs', true)
      else if (ts.isObjectBindingPattern(d.name)) for (const el of d.name.elements) {
        if (!el.dotDotDotToken && !el.initializer && ts.isIdentifier(el.name) && (!el.propertyName || ts.isIdentifier(el.propertyName) || ts.isStringLiteral(el.propertyName))) binding(el, el.name.text, el.propertyName?.getText(sf).replace(/^['"]|['"]$/g, '') ?? el.name.text, spec, 'commonjs')
      }
    }
    if (ts.isExpressionStatement(n)) {
      const spec = literalRequire(n.expression)
      if (spec !== undefined) { imports.push(spec); binding(n, '', '', spec, 'commonjs') }
    }
  }
  const isModule = (n: ts.Node): boolean => ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'module' && n.name.text === 'exports'
  function visit(n: ts.Node): void {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = n.left
      let kind: CommonJsExportFact['assignmentKind'] | undefined
      let name: string | null = null
      let global = ''
      if (isModule(left)) { kind = 'module-exports'; global = 'module' }
      else if (ts.isPropertyAccessExpression(left)) {
        if (ts.isIdentifier(left.expression) && left.expression.text === 'exports') { kind = 'exports-member'; global = 'exports'; name = left.name.text }
        else if (isModule(left.expression)) { kind = 'module-exports-member'; global = 'module'; name = left.name.text }
      }
      if (kind) {
        if (kind === 'module-exports') wholeModuleAssignments++
        const unconditional = ts.isExpressionStatement(n.parent) && ts.isSourceFile(n.parent.parent)
        const safe = unconditional && !shadowed.has(global) && !mutated.has(global)
        const add = (exportedName: string | null, rhs: ts.Node) => facts.push({ exportedName, ...(ts.isIdentifier(rhs) ? { bindingName: rhs.text } : {}), assignmentKind: kind!, ...span(n), resolutionStatus: safe ? 'observed' : 'unresolved', ...(!safe ? { reason: 'Conditional or shadowed CommonJS assignment.' } : {}) })
        if (name === null && ts.isObjectLiteralExpression(n.right)) {
          for (const p of n.right.properties) {
            if (ts.isShorthandPropertyAssignment(p)) add(p.name.text, p.name)
            else if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) add(p.name.text, p.initializer)
            else { unsupportedExportMutation = true; warnings.push(`Unsupported CommonJS export member at line ${span(p).startLine}.`) }
          }
        } else add(name, n.right)
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  for (const fact of facts) {
    if (unsupportedExportMutation) { fact.resolutionStatus = 'unresolved'; fact.reason = 'Unsupported CommonJS mutation or alias.'; continue }
    if (wholeModuleAssignments > 1 || wholeModuleAssignments && facts.some(f => f.assignmentKind === 'exports-member')) {
      fact.resolutionStatus = 'ambiguous'; fact.reason = 'Competing whole-module assignments or stale exports alias.'; continue
    }
    const competing = facts.filter(f => f.exportedName === fact.exportedName || f.exportedName === null || fact.exportedName === null)
    if (competing.length > 1) { fact.resolutionStatus = 'ambiguous'; fact.reason = 'Competing CommonJS assignments.'; continue }
    if (fact.resolutionStatus !== 'observed' || !fact.bindingName) continue
    const matches = symbols.filter(s => s.name === fact.bindingName && s.kind !== 'type' && !s.ownerKey)
    if (matches.length === 1 && !mutated.has(fact.bindingName)) {
      fact.resolutionStatus = 'resolved-local'
      matches[0].exported = true
      exports.push(fact.exportedName ?? fact.bindingName)
    } else { fact.resolutionStatus = matches.length > 1 ? 'ambiguous' : 'unresolved'; fact.reason = 'No unique immutable local declaration.' }
  }
}
