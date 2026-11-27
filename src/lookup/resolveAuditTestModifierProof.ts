import { createHash } from 'node:crypto'
import ts from 'typescript'
import {
  AUDIT_CONTENT_MAX_BYTES,
  compareTestModifierObservations,
  TEST_MODIFIER_PROOF_MAX_BYTES,
  TEST_MODIFIER_PROOF_MAX_OBSERVATIONS,
  TEST_MODIFIER_PROOF_MAX_PATH_BYTES,
  TEST_MODIFIER_PROOF_PROFILE,
  type SourceAuditEvidenceArtifact,
  type SourceAuditFile,
  type TestModifierObservation,
  type TestModifierProof,
  type TestModifierProofReason,
  type TestModifierRunnerBinding,
} from '../symbol-index/auditEvidenceTypes.js'
import {
  auditSpanAt,
  collectAuditDeclarationCounts,
  createSourceBindingChecker,
  DIRECT_TEST_IMPORT_MODULES,
  hasParseErrors,
  inspectDirectTestModifierCall,
  parseTypeScriptSource,
  TEST_FUNCTIONS,
} from '../symbol-index/symbolExtractor.js'
import type { AuditImportTargetProof } from './resolveAuditImportTarget.js'

const PLAYWRIGHT = '@playwright/test'
const RUNNER_METHODS = new Set([
  'afterAll', 'afterEach', 'beforeAll', 'beforeEach', 'describe', 'fail', 'fixme', 'info', 'only', 'setTimeout', 'skip',
  'slow', 'step', 'use',
])
const RUNNER_METHOD_PATHS = new Set([
  'describe.configure', 'describe.fixme', 'describe.parallel', 'describe.serial', 'describe.skip', 'step.skip',
])

type ResolveImportTarget = (artifact: SourceAuditEvidenceArtifact, importFactId: string) => AuditImportTargetProof
type ReadWrapper = (file: SourceAuditFile) => Buffer
type NamedImport = { statement: ts.ImportDeclaration; binding: ts.ImportSpecifier; specifier: string }

export function isTestModifierProofSource(file: Omit<SourceAuditFile, 'facts'>): boolean {
  return (file.language === 'typescript' || file.language === 'javascript') &&
    (file.status === 'parsed' || file.status === 'partial') && file.contentSha256 !== null &&
    file.sizeBytes !== null && file.sizeBytes <= AUDIT_CONTENT_MAX_BYTES &&
    Buffer.byteLength(file.path) <= TEST_MODIFIER_PROOF_MAX_PATH_BYTES
}

function parseSource(path: string, bytes: Buffer): ts.SourceFile | undefined {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return undefined
  }
  const sf = parseTypeScriptSource(path, text)
  return hasParseErrors(sf) ? undefined : sf
}

function sourceSpan(sf: ts.SourceFile, node: ts.Node) {
  return auditSpanAt(sf, sf.fileName, node.getStart(sf), node.getEnd(), true)
}

function moduleDeclarationCounts(sf: ts.SourceFile): Map<string, number> {
  return collectAuditDeclarationCounts(sf, true, identifier => {
    let declaration = identifier.parent
    while (ts.isBindingElement(declaration) || ts.isArrayBindingPattern(declaration) || ts.isObjectBindingPattern(declaration)) {
      declaration = declaration.parent
    }
    if (ts.isVariableDeclaration(declaration)) {
      const list = declaration.parent
      if (!ts.isVariableDeclarationList(list)) return false
      if (list.flags & ts.NodeFlags.BlockScoped) return ts.isVariableStatement(list.parent) && list.parent.parent === sf
      // A var inside a block still competes in the module scope.
      for (let scope: ts.Node = list.parent; scope !== sf; scope = scope.parent) {
        if (ts.isFunctionLike(scope) || ts.isModuleBlock(scope) || ts.isClassStaticBlockDeclaration(scope)) return false
      }
      return true
    }
    if (ts.isImportSpecifier(declaration)) return declaration.parent.parent.parent.parent === sf
    if (ts.isNamespaceImport(declaration)) return declaration.parent.parent.parent === sf
    if (ts.isImportClause(declaration)) return declaration.parent.parent === sf
    return declaration.parent === sf
  })
}

function namedImports(sf: ts.SourceFile): NamedImport[] {
  const imports: NamedImport[] = []
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const clause = statement.importClause
    if (!clause || clause.isTypeOnly || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue
    for (const binding of clause.namedBindings.elements) {
      if (!binding.isTypeOnly) imports.push({ statement, binding, specifier: statement.moduleSpecifier.text })
    }
  }
  return imports
}

function importedName(entry: NamedImport): string {
  return (entry.binding.propertyName ?? entry.binding.name).text
}

function isPlaywrightTest(entry: NamedImport): boolean {
  return entry.specifier === PLAYWRIGHT && importedName(entry) === 'test'
}

function identifierSymbol(checker: ts.TypeChecker, identifier: ts.Identifier): ts.Symbol | undefined {
  const parent = identifier.parent
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === identifier) {
    return checker.getShorthandAssignmentValueSymbol(parent)
  }
  if (ts.isExportSpecifier(parent) && (parent.propertyName ?? parent.name) === identifier) {
    return checker.getExportSpecifierLocalTargetSymbol(parent)
  }
  return checker.getSymbolAtLocation(identifier)
}

function walk(sf: ts.SourceFile, visit: (node: ts.Node) => void): void {
  const nodes: ts.Node[] = [sf]
  while (nodes.length) {
    const node = nodes.pop()!
    visit(node)
    const start = nodes.length
    ts.forEachChild(node, child => { nodes.push(child) })
    // The stack visits children in source order without recursive user-controlled depth.
    for (let left = start, right = nodes.length - 1; left < right; left++, right--) {
      const child = nodes[left]!
      nodes[left] = nodes[right]!
      nodes[right] = child
    }
  }
}

function isDynamicScope(node: ts.Node): boolean {
  if (ts.isWithStatement(node)) return true
  if (!ts.isCallExpression(node)) return false
  let callee: ts.Expression = node.expression
  while (ts.isParenthesizedExpression(callee)) callee = callee.expression
  return ts.isIdentifier(callee) && callee.text === 'eval'
}

function isJsxTag(identifier: ts.Identifier): boolean {
  const parent = identifier.parent
  return (ts.isJsxOpeningElement(parent) || ts.isJsxClosingElement(parent) || ts.isJsxSelfClosingElement(parent)) &&
    parent.tagName === identifier
}

function mayReferenceGlobal(identifier: ts.Identifier): boolean {
  const parent = identifier.parent
  if (ts.isShorthandPropertyAssignment(parent)) return parent.name === identifier
  if ('name' in parent && parent.name === identifier || 'propertyName' in parent && parent.propertyName === identifier ||
      'label' in parent && parent.label === identifier) return false
  return ts.isExpression(identifier)
}

/** Distinguish calls on the runner from writes, taking aliases, and passing the object away. */
function runnerUse(identifier: ts.Identifier): 'allowed' | 'unsupported' | 'unresolved' {
  let node: ts.Node = identifier
  const members: string[] = []
  let unsupportedAccess = false
  while (node.parent) {
    const parent: ts.Node = node.parent
    if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
      members.push(parent.name.text)
      unsupportedAccess ||= !!parent.questionDotToken
    } else if (ts.isElementAccessExpression(parent) && parent.expression === node) {
      unsupportedAccess = true
    } else if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) ||
        ts.isSatisfiesExpression(parent) || ts.isNonNullExpression(parent) || ts.isTypeAssertionExpression(parent)) {
      unsupportedAccess = true
    } else if (ts.isCallExpression(parent) && parent.expression === node) {
      if (unsupportedAccess || parent.questionDotToken) return 'unsupported'
      if (members.length === 0 || (members.length === 1 && RUNNER_METHODS.has(members[0]!))) return 'allowed'
      if (members.some(member => member === 'skip' || member === 'only')) return 'unsupported'
      return RUNNER_METHOD_PATHS.has(members.join('.')) ? 'allowed' : 'unresolved'
    } else {
      break
    }
    node = parent
  }
  return 'unresolved'
}

function extendedRunner(
  sf: ts.SourceFile, imports: NamedImport[], declared: Map<string, number>, checker: ts.TypeChecker, requireExport: boolean,
): { declaration: ts.VariableDeclaration; base: NamedImport; initializer: ts.CallExpression; receiver: ts.Identifier } | undefined {
  if (declared.get('test') !== 1) return undefined
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.BlockScoped) !== ts.NodeFlags.Const ||
        statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword) ||
        (requireExport && !statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))) continue
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'test' || !initializer ||
          !ts.isCallExpression(initializer) || initializer.questionDotToken || !ts.isPropertyAccessExpression(initializer.expression) ||
          initializer.expression.questionDotToken || initializer.expression.name.text !== 'extend') continue
      const receiver = initializer.expression.expression
      if (!ts.isIdentifier(receiver) || declared.get(receiver.text) !== 1) continue
      const baseImports = imports.filter(isPlaywrightTest)
      const base = baseImports.find(entry => entry.binding.name.text === receiver.text)
      if (!base) continue
      const baseSymbol = checker.getSymbolAtLocation(base.binding.name)
      const runnerSymbol = checker.getSymbolAtLocation(declaration.name)
      if (!baseSymbol || !runnerSymbol || identifierSymbol(checker, receiver) !== baseSymbol ||
          baseSymbol.declarations?.length !== 1 || runnerSymbol.declarations?.length !== 1) continue
      const baseBindings = new Set(baseImports.map(entry => entry.binding.name))
      const baseSymbols = new Set(Array.from(baseBindings, name => checker.getSymbolAtLocation(name)).filter(Boolean))
      const baseNames = new Set(Array.from(baseBindings, name => name.text))
      let qualified = true
      walk(sf, node => {
        if (isDynamicScope(node) || (requireExport && ts.isExportAssignment(node) && node.isExportEquals)) qualified = false
        if (requireExport && ts.isExportSpecifier(node) && node.name.text === 'test') qualified = false
        if (!ts.isIdentifier(node) || node === receiver || baseBindings.has(node) || node === declaration.name ||
            ts.isPartOfTypeNode(node) || isJsxTag(node)) return
        if (requireExport && (node.text === 'exports' || node.text === 'module') && !identifierSymbol(checker, node)) {
          // A mixed CommonJS export can replace the declared module export.
          if (mayReferenceGlobal(node)) qualified = false
        }
        if (baseNames.has(node.text) && baseSymbols.has(identifierSymbol(checker, node)) && runnerUse(node) === 'unresolved') qualified = false
        if (requireExport && node.text === 'test' && identifierSymbol(checker, node) === runnerSymbol &&
            runnerUse(node) === 'unresolved') qualified = false
      })
      if (qualified) return { declaration, base, initializer, receiver }
    }
  }
  return undefined
}

function importedRunner(
  artifact: SourceAuditEvidenceArtifact, origin: SourceAuditFile, sf: ts.SourceFile, entry: NamedImport,
  readWrapper: ReadWrapper, resolveImportTarget: ResolveImportTarget,
): TestModifierRunnerBinding | undefined {
  const span = sourceSpan(sf, entry.statement)
  const facts = origin.facts.filter(fact => fact.kind === 'import' && fact.extractionMethod === 'typescript-ast' &&
    fact.sourceSpecifier === entry.specifier && fact.importedNames?.includes('test') &&
    fact.span.path === span.path && fact.span.startLine === span.startLine && fact.span.startColumn === span.startColumn &&
    fact.span.endLine === span.endLine && fact.span.endColumn === span.endColumn)
  if (facts.length !== 1) return undefined
  const importTargetProof = resolveImportTarget(artifact, facts[0]!.id)
  const reference = importTargetProof.sourceReferenceProof
  const target = reference?.qualifiedReference
  if (!reference?.candidateEnumerationComplete || !target || target.targetPath === origin.path) return undefined
  const wrapper = artifact.files.find(file => file.path === target.targetPath)
  if (!wrapper || wrapper.status !== 'parsed' || !isTestModifierProofSource(wrapper) ||
      wrapper.contentSha256 !== target.targetContentSha256) return undefined
  const wrapperSource = parseSource(wrapper.path, readWrapper(wrapper))
  if (!wrapperSource) return undefined
  const extended = extendedRunner(wrapperSource, namedImports(wrapperSource), moduleDeclarationCounts(wrapperSource),
    createSourceBindingChecker(wrapperSource), true)
  if (!extended) return undefined
  return {
    kind: 'imported-extended-playwright', localName: 'test', bindingSpan: sourceSpan(sf, entry.binding),
    baseLocalName: extended.base.binding.name.text, baseImportSpan: sourceSpan(wrapperSource, extended.base.binding),
    extensionSpan: sourceSpan(wrapperSource, extended.initializer),
    wrapper: {
      path: wrapper.path, contentSha256: target.targetContentSha256,
      exportBindingSpan: sourceSpan(wrapperSource, extended.declaration), importTargetProof,
    },
  }
}

function modifierObservations(
  sf: ts.SourceFile, origin: SourceAuditFile, binding: ts.Identifier, checker: ts.TypeChecker, symbol: ts.Symbol,
  imports: NamedImport[], declared: Map<string, number>, reasons: Set<TestModifierProofReason>,
  runnerKind: TestModifierRunnerBinding['kind'], extensionReceiver?: ts.Identifier,
): TestModifierObservation[] {
  const legacyImports = new Map(imports.filter(entry => !entry.binding.propertyName && DIRECT_TEST_IMPORT_MODULES.has(entry.specifier))
    .map(entry => [entry.binding.name.text, checker.getSymbolAtLocation(entry.binding.name)]))
  const aliases = new Map(imports.filter(entry => importedName(entry) === 'test' && entry.binding.name.text !== 'test')
    .map(entry => [entry.binding.name.text, { ...entry, symbol: checker.getSymbolAtLocation(entry.binding.name) }]))
  const legacyIdentity = (name: string, modifier: string, span: TestModifierObservation['calleeSpan']) =>
    `${name}:${modifier}:${span.startLine}:${span.startColumn}:${span.endLine}:${span.endColumn}`
  const legacyObservations = new Set(origin.facts.flatMap(fact => {
    const span = fact.span
    if (fact.kind !== 'test-observation' || fact.extractionMethod !== 'typescript-ast' || !fact.name ||
        !fact.observationKind?.startsWith('test-modifier-') ||
        span.startColumn === null || span.endLine === null || span.endColumn === null) return []
    return [legacyIdentity(fact.name, fact.observationKind.slice('test-modifier-'.length), {
      ...span, startColumn: span.startColumn, endLine: span.endLine, endColumn: span.endColumn,
    })]
  }))
  const observations: TestModifierObservation[] = []
  let unsafeRunnerUse = false
  const isRunner = (identifier: ts.Identifier): boolean => identifier.text === 'test' && identifierSymbol(checker, identifier) === symbol
  const isLegacyRunner = (identifier: ts.Identifier): boolean => {
    if (!TEST_FUNCTIONS.has(identifier.text)) return false
    const local = identifierSymbol(checker, identifier)
    return declared.get(identifier.text) === undefined && !local ||
      declared.get(identifier.text) === 1 && !!local && legacyImports.get(identifier.text) === local
  }
  walk(sf, node => {
    if (isDynamicScope(node)) unsafeRunnerUse = true
    if (ts.isIdentifier(node) && node !== binding && !ts.isPartOfTypeNode(node) && !isJsxTag(node)) {
      if (isRunner(node)) {
        const use = runnerUse(node)
        if (use === 'unresolved') unsafeRunnerUse = true
        if (use === 'unsupported') reasons.add('UNSUPPORTED_MODIFIER_FORM')
      } else if (mayReferenceGlobal(node) && isLegacyRunner(node)) {
        const parent = node.parent
        const otherMember = ts.isPropertyAccessExpression(parent) && parent.expression === node &&
          parent.name.text !== 'skip' && parent.name.text !== 'only'
        if (!otherMember && runnerUse(node) === 'unresolved') reasons.add('UNRESOLVED_BINDING_USE')
      }
      const alias = aliases.get(node.text)
      if (alias?.symbol && node !== alias.binding.name && node !== extensionReceiver &&
          identifierSymbol(checker, node) === alias.symbol && runnerUse(node) === 'unresolved') {
        if (runnerKind === 'direct-playwright' && isPlaywrightTest(alias)) unsafeRunnerUse = true
        else reasons.add('UNRESOLVED_BINDING_USE')
      }
    }
    if (!ts.isCallExpression(node)) return
    const site = inspectDirectTestModifierCall(node)
    if (!site || (!TEST_FUNCTIONS.has(site.root.text) && !aliases.has(site.root.text))) return
    if (!site.modifier) {
      reasons.add('UNSUPPORTED_MODIFIER_FORM')
      return
    }
    if (!isRunner(site.root)) {
      if (!isLegacyRunner(site.root)) reasons.add('UNQUALIFIED_RUNNER_BINDING')
      else if (!legacyObservations.has(legacyIdentity(site.root.text, site.modifier, sourceSpan(sf, node.expression)))) {
        reasons.add('INCOMPLETE_SOURCE_ANALYSIS')
      }
      return
    }
    if ((ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent) ||
        ts.isCallExpression(node.parent)) && node.parent.expression === node) {
      reasons.add('UNSUPPORTED_MODIFIER_FORM')
      return
    }
    if (observations.length === TEST_MODIFIER_PROOF_MAX_OBSERVATIONS) {
      reasons.add('PROOF_BUDGET_EXCEEDED')
      return
    }
    observations.push({ modifier: site.modifier, calleeSpan: sourceSpan(sf, node.expression), callSpan: sourceSpan(sf, node) })
  })
  if (unsafeRunnerUse) {
    reasons.add('UNRESOLVED_BINDING_USE')
    return []
  }
  return observations.sort(compareTestModifierObservations)
}

export function resolveAuditTestModifierProof(
  artifact: SourceAuditEvidenceArtifact, origin: SourceAuditFile, bytes: Buffer,
  readWrapper: ReadWrapper, resolveImportTarget: ResolveImportTarget,
): TestModifierProof | undefined {
  const sf = parseSource(origin.path, bytes)
  if (!sf) return undefined
  const imports = namedImports(sf)
  const entry = imports.find(item => item.binding.name.text === 'test' && importedName(item) === 'test')
  if (entry && DIRECT_TEST_IMPORT_MODULES.has(entry.specifier)) return undefined
  if (!entry && !imports.some(isPlaywrightTest)) return undefined
  const moduleDeclared = moduleDeclarationCounts(sf)
  if (moduleDeclared.get('test') !== 1) return undefined
  const checker = createSourceBindingChecker(sf)

  let runnerBinding: TestModifierRunnerBinding | undefined
  let identifier: ts.Identifier
  let extensionReceiver: ts.Identifier | undefined
  if (entry) {
    identifier = entry.binding.name
    if (entry.specifier === PLAYWRIGHT) {
      const span = sourceSpan(sf, entry.binding)
      runnerBinding = {
        kind: 'direct-playwright', localName: 'test', bindingSpan: span, baseLocalName: 'test', baseImportSpan: span,
        extensionSpan: null, wrapper: null,
      }
    } else {
      runnerBinding = importedRunner(artifact, origin, sf, entry, readWrapper, resolveImportTarget)
    }
  } else {
    const extended = extendedRunner(sf, imports, moduleDeclared, checker, false)
    if (!extended || !ts.isIdentifier(extended.declaration.name)) return undefined
    identifier = extended.declaration.name
    extensionReceiver = extended.receiver
    runnerBinding = {
      kind: 'local-extended-playwright', localName: 'test', bindingSpan: sourceSpan(sf, extended.declaration),
      baseLocalName: extended.base.binding.name.text, baseImportSpan: sourceSpan(sf, extended.base.binding),
      extensionSpan: sourceSpan(sf, extended.initializer), wrapper: null,
    }
  }
  if (!runnerBinding || !origin.contentSha256) return undefined
  const symbol = checker.getSymbolAtLocation(identifier)
  if (!symbol || symbol.declarations?.length !== 1) return undefined
  const reasons = new Set<TestModifierProofReason>()
  // The walk qualifies every relevant modifier from authenticated bytes and
  // requires an exact retained fact for each independently modeled legacy site.
  // The shared diagnostic cap also covers unrelated analysis families.
  if (origin.status !== 'parsed') {
    reasons.add('INCOMPLETE_SOURCE_ANALYSIS')
  }
  const observations = modifierObservations(sf, origin, identifier, checker, symbol, imports,
    collectAuditDeclarationCounts(sf, true), reasons, runnerBinding.kind, extensionReceiver)
  const proof: TestModifierProof = {
    schemaVersion: '1.0.0', profile: TEST_MODIFIER_PROOF_PROFILE,
    snapshotId: artifact.source.snapshotId, selectionFingerprint: artifact.source.selectionFingerprint,
    selectedDomainDigest: createHash('sha256').update(JSON.stringify(artifact.files.map(file => file.path).sort())).digest('hex'),
    originFile: origin.path, originContentSha256: origin.contentSha256,
    coverage: reasons.size ? 'partial' : 'complete', runnerBinding, observations, reasonCodes: [...reasons].sort(),
  }
  if (Buffer.byteLength(JSON.stringify(proof)) <= TEST_MODIFIER_PROOF_MAX_BYTES) return proof
  return undefined
}
