import { createHash } from 'node:crypto'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as ts from 'typescript'
import { auditSpanAt, parseTypeScriptSource } from '../symbol-index/symbolExtractor.js'
import type { SourceAuditSpan } from '../symbol-index/auditEvidenceTypes.js'
import { readAuthenticatedAuditBytes } from '../source/readAuthenticatedAuditBytes.js'
import { readSourceAuditEvidence, SourceAuditEvidenceError } from './readSourceAuditEvidence.js'
import { resolveAuditImportTarget, resolveAuditTargetCandidates, type AuditImportTargetProof } from './resolveAuditImportTarget.js'
import { enumerateJsTsCandidatePaths } from '../languages/typescript/adapter.js'

type Gap = 'UNSUPPORTED_EXPRESSION' | 'UNKNOWN_RUNTIME_VALUE' | 'UNQUALIFIED_BINDING' |
  'UNSUPPORTED_PATH_OPERATION' | 'PATH_IDENTITY_UNCERTAIN' | 'INCOMPLETE_REFERENCE_PROFILE' |
  'DOMAIN_LIMIT_EXCEEDED' | 'QUERY_BUDGET_EXCEEDED'
class DomainGap extends Error {
  constructor(readonly reason: Gap) { super(reason) }
}
type Role = 'operand' | 'binding' | 'operation' | 'guard'
type Premise = { type: 'source-span'; filePath: string; contentSha256: string; span: SourceAuditSpan; role: Role }
type Resolution = Pick<AuditImportTargetProof, 'status' | 'candidatePaths' | 'selectionComplete' | 'reasonCode'> & {
  candidateEnumerationComplete: boolean
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

/** Evaluate only syntactic forms grounded in the authenticated origin. */
function evaluateOperand(sf: ts.SourceFile, root: ts.Expression, add: (node: ts.Node, role: Role) => void): string[] {
  const bindings = new Map<string, ts.VariableDeclaration>()
  const operations = new Map<string, { declaration: ts.Identifier; operation: string }>()
  const identifiers = new Map<string, ts.Identifier[]>()
  let references = 0
  let hasDynamicScope = false
  const census = (node: ts.Node): void => {
    if (ts.isWithStatement(node) || ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) && node.expression.text === 'eval') hasDynamicScope = true
    if (ts.isIdentifier(node)) {
      const list = identifiers.get(node.text) ?? []
      list.push(node)
      identifiers.set(node.text, list)
    }
    ts.forEachChild(node, census)
  }
  census(sf)
  if (hasDynamicScope) throw new DomainGap('UNQUALIFIED_BINDING')
  for (const statement of sf.statements) {
    if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) bindings.set(declaration.name.text, declaration)
      }
    }
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly) continue
    const module = statement.moduleSpecifier.text
    if (!['node:path', 'path', 'node:url', 'url'].includes(module)) continue
    const named = statement.importClause?.namedBindings
    const isPath = module.endsWith('path')
    const addOperation = (declaration: ts.Identifier, operation: string) => operations.set(declaration.text, { declaration, operation })
    if (isPath && statement.importClause?.name) addOperation(statement.importClause.name, 'path')
    if (named && ts.isNamespaceImport(named)) addOperation(named.name, isPath ? 'path' : 'url')
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        if (element.isTypeOnly) continue
        const name = (element.propertyName ?? element.name).text
        if (isPath && name === 'join' || !isPath && name === 'pathToFileURL') addOperation(element.name, name)
      }
    }
  }
  const bounded = (values: Iterable<string>): string[] => {
    const unique = new Set<string>()
    for (const value of values) {
      if (Buffer.byteLength(value, 'utf8') > 4096) throw new DomainGap('DOMAIN_LIMIT_EXCEEDED')
      unique.add(value)
      if (unique.size > 64) throw new DomainGap('DOMAIN_LIMIT_EXCEEDED')
    }
    return [...unique]
  }
  function combine(left: string[], right: string[], apply: (a: string, b: string) => string): string[] {
    const result = new Set<string>()
    for (const a of left) for (const b of right) {
      const value = apply(a, b)
      if (Buffer.byteLength(value, 'utf8') > 4096) throw new DomainGap('DOMAIN_LIMIT_EXCEEDED')
      result.add(value)
      if (result.size > 64) throw new DomainGap('DOMAIN_LIMIT_EXCEEDED')
    }
    return [...result]
  }
  function qualifiedOperation(node: ts.Expression, operation: 'join' | 'pathToFileURL'): boolean {
    const name = ts.isIdentifier(node) ? node : ts.isPropertyAccessExpression(node) && node.name.text === operation &&
      ts.isIdentifier(node.expression) ? node.expression : undefined
    if (!name) return false
    const binding = operations.get(name.text)
    if (!binding || (ts.isIdentifier(node) ? binding.operation !== operation :
      binding.operation !== (operation === 'join' ? 'path' : 'url'))) return false
    const uses = identifiers.get(name.text) ?? []
    if (uses.some(use => {
      if (use === binding.declaration) return false
      if (binding.operation === operation) return !ts.isCallExpression(use.parent) || use.parent.expression !== use
      const access = use.parent
      return !ts.isPropertyAccessExpression(access) || access.expression !== use || access.name.text !== operation ||
        !ts.isCallExpression(access.parent) || access.parent.expression !== access
    })) return false
    add(binding.declaration, 'binding')
    return true
  }
  function visit(node: ts.Expression, depth: number): string[] {
    if (depth > 32) throw new DomainGap('DOMAIN_LIMIT_EXCEEDED')
    if (ts.isParenthesizedExpression(node)) return visit(node.expression, depth + 1)
    if (ts.isStringLiteralLike(node)) return bounded([node.text])
    if (ts.isIdentifier(node)) {
      if (++references > 16) throw new DomainGap('DOMAIN_LIMIT_EXCEEDED')
      const declaration = bindings.get(node.text)
      if (!declaration?.initializer || declaration.end >= node.getStart(sf)) throw new DomainGap('UNQUALIFIED_BINDING')
      if ((identifiers.get(node.text) ?? []).some(use => {
        if (use === declaration.name) return false
        const parent = use.parent
        return ts.isVariableDeclaration(parent) && parent.name === use ||
          ts.isParameter(parent) || ts.isBindingElement(parent) || ts.isImportClause(parent) ||
          ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent) ||
          (ts.isFunctionLike(parent) || ts.isClassLike(parent)) && parent.name === use ||
          ts.isBinaryExpression(parent) && parent.left === use && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
            parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment ||
          ts.isPrefixUnaryExpression(parent) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator) ||
          ts.isPostfixUnaryExpression(parent)
      })) throw new DomainGap('UNQUALIFIED_BINDING')
      add(declaration, 'binding')
      return visit(declaration.initializer, depth + 1)
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return combine(visit(node.left, depth + 1), visit(node.right, depth + 1), (a, b) => a + b)
    }
    if (ts.isTemplateExpression(node)) {
      let values = bounded([node.head.text])
      for (const span of node.templateSpans) values = combine(values, visit(span.expression, depth + 1), (a, b) => a + b + span.literal.text)
      return values
    }
    if (ts.isConditionalExpression(node)) {
      add(node.condition, 'guard')
      if (node.condition.kind === ts.SyntaxKind.TrueKeyword) return visit(node.whenTrue, depth + 1)
      if (node.condition.kind === ts.SyntaxKind.FalseKeyword) return visit(node.whenFalse, depth + 1)
      return bounded([...visit(node.whenTrue, depth + 1), ...visit(node.whenFalse, depth + 1)])
    }
    if (ts.isCallExpression(node) && qualifiedOperation(node.expression, 'join') && node.arguments.length > 0) {
      add(node, 'operation')
      let values = ['']
      for (const arg of node.arguments) values = combine(values, visit(arg, depth + 1), (a, b) => path.join(a, b))
      return values
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'href' && ts.isCallExpression(node.expression) &&
        node.expression.arguments.length === 1) {
      const call = node.expression
      if (!qualifiedOperation(call.expression, 'pathToFileURL')) throw new DomainGap('UNSUPPORTED_PATH_OPERATION')
      add(node, 'operation')
      return bounded(visit(call.arguments[0]!, depth + 1).map(value => {
        if (!path.isAbsolute(value) || process.platform === 'win32' && !/^[A-Za-z]:[\\/]/.test(value)) throw new DomainGap('UNKNOWN_RUNTIME_VALUE')
        return pathToFileURL(value).href
      }))
    }
    throw new DomainGap('UNSUPPORTED_EXPRESSION')
  }
  return visit(root, 0)
}

function comparableSpecifier(value: string, root: string, origin: string): string | null {
  if (/[?#%\0]/.test(value) && !value.startsWith('file:')) return null
  if (!value.startsWith('file:') && !path.isAbsolute(value)) {
    return value.includes('\\') ? null : value
  }
  let absolute: string
  try {
    const url = value.startsWith('file:') ? new URL(value) : null
    if (url && (url.host || url.search || url.hash)) return null
    absolute = url ? fileURLToPath(url) : value
  } catch {
    return null
  }
  const relative = path.relative(path.dirname(path.join(root, origin)), absolute)
  if (path.isAbsolute(relative) || /[?#%]/.test(relative)) return null
  const originRelative = relative.split(path.sep).join('/')
  return originRelative.startsWith('../') ? originRelative : './' + originRelative
}

export function resolveAuditImportDomain(indexDir: string, id: string) {
  const artifact = readSourceAuditEvidence(indexDir)
  if (artifact.schemaVersion !== '1.2.0') throw new SourceAuditEvidenceError('AUDIT_EVIDENCE_INVALID', 'Import-domain proof requires audit schema 1.2.0.')
  const file = artifact.files.find(entry => entry.facts.some(fact => fact.id === id))
  const fact = file?.facts.find(entry => entry.id === id)
  if (!file || !fact) throw new SourceAuditEvidenceError('AUDIT_FACT_NOT_FOUND', 'Expression fact is absent from the selected snapshot.')
  if (fact.kind !== 'dynamic-import-expression' || !fact.operandSpan || !file.contentSha256) {
    throw new SourceAuditEvidenceError('AUDIT_FACT_NOT_IMPORT', 'Expected an authenticated dynamic import expression fact.')
  }
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readAuthenticatedAuditBytes(artifact, file))
  const digest = hash(JSON.stringify(artifact.files.map(entry => entry.path).sort()))
  const base = {
    schemaVersion: '1.0.0', mode: 'audit-import-domain', snapshotId: artifact.source.snapshotId,
    selectionFingerprint: artifact.source.selectionFingerprint, originFile: file.path, originContentSha256: file.contentSha256,
    importExpressionFactId: id, resolverProfile: 'js-ts-dynamic-import-v1', pathIdentityProfile: 'selected-source-path-v1',
    resolutionPlatform: process.platform === 'win32' ? 'win32' : 'posix', selectedDomainDigest: digest,
  } as const
  const incomplete = (reasonCode: Gap) => ({
    ...base, outcome: 'indeterminate', operandAlternatives: [], domainComplete: false, premiseRefs: [],
    qualifiedPositiveWitnesses: [], disjointProof: null, reasonCode,
  })
  if (file.capabilities['dynamic-import-expressions'] !== 'complete') return incomplete('INCOMPLETE_REFERENCE_PROFILE')
  const sf = parseTypeScriptSource(file.path, text)
  let operand: ts.Expression | undefined
  const find = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        JSON.stringify(auditSpanAt(sf, file.path, node.getStart(sf), node.end, true)) === JSON.stringify(fact.span)) operand = node.arguments[0]
    if (!operand) ts.forEachChild(node, find)
  }
  find(sf)
  if (!operand || JSON.stringify(auditSpanAt(sf, file.path, operand.getStart(sf), operand.end, true)) !== JSON.stringify(fact.operandSpan)) {
    throw new SourceAuditEvidenceError('AUDIT_EVIDENCE_INVALID', 'Recorded call and operand do not match authenticated source.')
  }
  const premiseRefs: Premise[] = []
  const add = (node: ts.Node, role: Role) => {
    const span = auditSpanAt(sf, file.path, node.getStart(sf), node.end, true)
    if (premiseRefs.some(ref => ref.span.startLine === span.startLine && ref.span.startColumn === span.startColumn && ref.role === role)) return
    if (premiseRefs.length === 256) throw new DomainGap('QUERY_BUDGET_EXCEEDED')
    premiseRefs.push({ type: 'source-span', filePath: file.path, contentSha256: file.contentSha256!, span, role })
  }
  try {
    add(operand, 'operand')
    const values = evaluateOperand(sf, operand, add)
    const premiseIndexes = premiseRefs.map((_, i) => i)
    const selectionComplete = artifact.coverage.inventoryComplete && artifact.coverage.exclusionsAreExplicit
    const operandAlternatives = values.map((specifier, alternativeIndex) => {
      const comparable = comparableSpecifier(specifier, artifact.source.projectRoot, file.path)
      let resolution: Resolution
      if (!comparable) {
        resolution = { status: 'indeterminate', candidatePaths: [], selectionComplete,
          reasonCode: 'PATH_IDENTITY_UNCERTAIN', candidateEnumerationComplete: false }
      } else {
        const upper = enumerateJsTsCandidatePaths(comparable, file.path)
        resolution = resolveAuditTargetCandidates(artifact, file, comparable, [], (status, candidates, reasonCode) => {
          const candidateEnumerationComplete = upper !== null && !['RESOLVER_FAILED', 'CANDIDATE_ESCAPES_PROJECT_ROOT'].includes(reasonCode)
          return { status, candidatePaths: [...new Set(candidateEnumerationComplete ? upper! : candidates)].sort(),
            selectionComplete, reasonCode, candidateEnumerationComplete }
        })
      }
      return { alternativeIndex, specifier, premiseIndexes, resolution }
    })
    const paths = operandAlternatives.flatMap(item => item.resolution.candidatePaths)
    if (paths.length > 256) return incomplete('QUERY_BUDGET_EXCEEDED')
    const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value
    const selected = new Set(artifact.files.map(entry => normalize(entry.path)))
    const disjoint = paths.length > 0 && operandAlternatives.every(({ resolution }) =>
      resolution.status === 'proven-missing' && resolution.candidateEnumerationComplete) &&
      paths.every(candidate => !selected.has(normalize(candidate)) &&
        candidate.split('/').every(segment => !/[ .]$/.test(segment) && !segment.includes(':')))
    const qualifiedPositiveWitnesses = []
    if (fact.literalImportFactId) {
      const linked = file.facts.find(entry => entry.id === fact.literalImportFactId)
      if (values.length !== 1 || linked?.sourceSpecifier !== values[0]) {
        throw new SourceAuditEvidenceError('AUDIT_EVIDENCE_INVALID', 'Linked literal import contradicts its authenticated operand.')
      }
      const targetProof = resolveAuditImportTarget(indexDir, fact.literalImportFactId)
      if (targetProof.snapshotId !== base.snapshotId) throw new SourceAuditEvidenceError('AUDIT_EVIDENCE_INVALID', 'Target proof snapshot changed.')
      if (targetProof.status === 'present' && targetProof.candidatePaths.length === 1) {
        const target = artifact.files.find(entry => entry.path === targetProof.candidatePaths[0])
        if (target?.contentSha256) qualifiedPositiveWitnesses.push({
          importFactId: fact.literalImportFactId, targetPath: target.path, targetContentSha256: target.contentSha256, targetProof,
        })
      }
    }
    const result = {
      ...base, outcome: disjoint ? 'disjoint-selected-domain' : 'finite', operandAlternatives, domainComplete: true,
      premiseRefs, qualifiedPositiveWitnesses,
      disjointProof: disjoint ? { rule: 'fixed-normalized-path-v1', values: [...new Set(paths)].sort(), premiseIndexes } : null,
      reasonCode: null,
    }
    return Buffer.byteLength(JSON.stringify(result), 'utf8') <= 1048576 ? result : incomplete('QUERY_BUDGET_EXCEEDED')
  } catch (error) {
    if (error instanceof DomainGap) return incomplete(error.reason)
    throw error
  }
}
