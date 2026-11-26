/**
 * v1.15.0 Batch 0: pure structural validators for the source-audit evidence
 * contract and its lookup page envelopes.
 *
 * These functions never read files, open indexes, hash content, check
 * freshness against a live repository, execute user code, or decide an audit
 * verdict. Structural validity is not proof that an artifact matches a live
 * repository; those responsibilities belong to later batches.
 */

import {
  DYNAMIC_OPERAND_FORMS,
  AUDIT_FACT_PAGE_SIZE,
  AUDIT_INVENTORY_PAGE_SIZE,
  AUDIT_LITERAL_MAX_CHARS,
  SOURCE_AUDIT_ARTIFACT_KIND,
  SOURCE_AUDIT_CAPABILITIES,
  SOURCE_AUDIT_CAPABILITY_STATUSES,
  SOURCE_AUDIT_EXPORT_ORIGINS,
  SOURCE_AUDIT_EXTRACTION_METHODS,
  SOURCE_AUDIT_FACT_KINDS,
  SOURCE_AUDIT_FILE_STATUSES,
  SOURCE_AUDIT_HTTP_CLIENT_KINDS,
  SOURCE_AUDIT_HTTP_METHODS,
  SOURCE_AUDIT_IMPORT_RESOLUTIONS,
  SOURCE_AUDIT_OBSERVATION_KINDS,
  SOURCE_AUDIT_ROLES,
  SOURCE_AUDIT_SCHEMA_VERSION,
  SOURCE_AUDIT_VISIBILITIES,
  compareTestModifierObservations,
  TEST_MODIFIER_PROOF_MAX_BYTES,
  TEST_MODIFIER_PROOF_MAX_OBSERVATIONS,
  TEST_MODIFIER_PROOF_MAX_PATH_BYTES,
  TEST_MODIFIER_PROOF_PROFILE,
  TEST_MODIFIER_PROOF_REASONS,
} from './auditEvidenceTypes.js'
import type {
  SourceAuditCapability,
  SourceAuditEvidenceArtifact,
  SourceAuditFactKind,
  SourceAuditFilePage,
  SourceAuditInventoryPage,
  ExactAuditSpan,
  TestModifierObservation,
} from './auditEvidenceTypes.js'

const ERROR_PREFIX = 'INVALID_SOURCE_AUDIT_EVIDENCE'
const MAX_MESSAGE_CHARS = 240
const MAX_PATH_CHARS = 1024
const MAX_TEXT_CHARS = 4096
const SHA256_PATTERN = /^[0-9a-f]{64}$/

type Obj = Record<string, unknown>

function fail(path: string, reason: string): never {
  throw new Error(`${ERROR_PREFIX}: ${path} ${reason}`.slice(0, MAX_MESSAGE_CHARS))
}

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireObj(value: unknown, path: string): Obj {
  if (!isObj(value)) fail(path, 'must be an object')
  return value
}

function requireClosed(obj: Obj, path: string, allowed: readonly string[], required: readonly string[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, 'is not an allowed field')
  }
  for (const key of required) {
    if (!(key in obj) || obj[key] === undefined) fail(`${path}.${key}`, 'is required')
  }
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'must be an array')
  return value
}

function requireText(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT_CHARS) {
    fail(path, 'must be a non-empty bounded string')
  }
  return value
}

function requireBool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'must be a boolean')
  return value
}

function isNonNegInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function requireNonNegInt(value: unknown, path: string): number {
  if (!isNonNegInt(value)) fail(path, 'must be a nonnegative integer')
  return value
}

function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(path, 'is not an allowed value')
  }
  return value as T
}

function isCanonicalPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_CHARS) return false
  if (value.includes('\\') || value.startsWith('/') || value.endsWith('/') || /^[A-Za-z]:/.test(value)) return false
  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function requirePath(value: unknown, path: string): string {
  if (!isCanonicalPath(value)) fail(path, 'must be a canonical root-relative forward-slash path')
  return value
}

function requireSha(value: unknown, path: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) fail(path, 'must be a lowercase SHA-256 hex string')
  return value
}

function requireNullable<T>(value: unknown, path: string, check: (v: unknown, p: string) => T): T | null {
  return value === null ? null : check(value, path)
}

function requireStringArray(value: unknown, path: string, unique: boolean): string[] {
  const arr = requireArray(value, path)
  const seen = new Set<string>()
  arr.forEach((item, i) => {
    const text = requireText(item, `${path}[${i}]`)
    if (unique) {
      if (seen.has(text)) fail(`${path}[${i}]`, 'is duplicated')
      seen.add(text)
    }
  })
  return arr as string[]
}

function validateSpan(value: unknown, path: string, expectedPath: string): void {
  const span = requireObj(value, path)
  requireClosed(span, path, ['path', 'startLine', 'startColumn', 'endLine', 'endColumn'], [
    'path',
    'startLine',
    'startColumn',
    'endLine',
    'endColumn',
  ])
  if (requirePath(span.path, `${path}.path`) !== expectedPath) fail(`${path}.path`, 'must match the owning file path')
  const startLine = span.startLine
  if (typeof startLine !== 'number' || !Number.isInteger(startLine) || startLine < 1) {
    fail(`${path}.startLine`, 'must be a positive integer')
  }
  const startColumn = requireNullable(span.startColumn, `${path}.startColumn`, requireNonNegInt)
  const endLine = requireNullable(span.endLine, `${path}.endLine`, requireNonNegInt)
  const endColumn = requireNullable(span.endColumn, `${path}.endColumn`, requireNonNegInt)
  if (endLine !== null && endLine < startLine) fail(`${path}.endLine`, 'must not precede startLine')
  if (endColumn !== null && endLine === null) fail(`${path}.endColumn`, 'requires endLine')
  if (endLine === startLine && startColumn !== null && endColumn !== null && endColumn < startColumn) {
    fail(`${path}.endColumn`, 'must not precede startColumn on the same line')
  }
}

// --- facts -----------------------------------------------------------------

const FACT_CAPABILITY: Record<SourceAuditFactKind, SourceAuditCapability> = {
  declaration: 'declarations',
  import: 'imports',
  export: 'exports',
  'identifier-literal': 'identifier-literals',
  'test-observation': 'test-observations',
  'fixture-reference': 'fixture-references',
  'process-observation': 'process-observations',
  'api-client-call': 'api-client-calls',
}

const FACT_COMMON = ['id', 'kind', 'span', 'extractionMethod']
const LITERAL_FIELDS = ['name', 'observationKind', 'value', 'valueSha256', 'valueTruncated', 'owningSymbolId']

const FACT_FIELDS: Record<SourceAuditFactKind, { allowed: string[]; required: string[] }> = {
  declaration: {
    allowed: ['name', 'symbolId', 'declarationKind', 'ownerKey', 'visibility', 'exported', 'exportOrigin', 'owningSymbolId', 'jvmDeclaration'],
    required: ['name', 'declarationKind'],
  },
  import: {
    allowed: ['name', 'sourceSpecifier', 'importedNames', 'importResolution', 'targetPaths', 'owningSymbolId', 'jvmImportTarget'],
    required: ['sourceSpecifier', 'importResolution'],
  },
  export: {
    allowed: ['name', 'symbolId', 'visibility', 'exported', 'exportOrigin', 'sourceSpecifier', 'owningSymbolId'],
    required: ['name', 'exportOrigin'],
  },
  'identifier-literal': { allowed: LITERAL_FIELDS, required: ['value'] },
  'test-observation': { allowed: LITERAL_FIELDS, required: ['observationKind'] },
  'fixture-reference': { allowed: LITERAL_FIELDS, required: ['observationKind', 'value'] },
  'process-observation': { allowed: LITERAL_FIELDS, required: ['observationKind'] },
  'api-client-call': {
    allowed: ['name', 'httpMethod', 'httpClientKind', 'staticUrl', 'owningSymbolId'],
    required: ['httpMethod', 'httpClientKind'],
  },
}

function validateFact(
  value: unknown,
  path: string,
  filePath: string,
  capabilities: Record<string, unknown>,
): Obj {
  const fact = requireObj(value, path)
  if (fact.kind === 'dynamic-import-expression' && 'dynamic-import-expressions' in capabilities) {
    const keys = [...FACT_COMMON, 'operandForm', 'operandSpan']
    requireClosed(fact, path, [...keys, 'literalImportFactId'], keys)
    requireText(fact.id, `${path}.id`)
    validateSpan(fact.span, `${path}.span`, filePath)
    validateSpan(fact.operandSpan, `${path}.operandSpan`, filePath)
    requireOneOf(fact.operandForm, DYNAMIC_OPERAND_FORMS, `${path}.operandForm`)
    if (fact.extractionMethod !== 'typescript-ast') fail(path, 'requires TypeScript AST evidence')
    if (!['complete', 'partial'].includes(String(capabilities['dynamic-import-expressions']))) fail(path, 'requires dynamic-import-expressions coverage')
    if (fact.literalImportFactId !== undefined) {
      requireText(fact.literalImportFactId, `${path}.literalImportFactId`)
      if (fact.operandForm === 'computed') fail(path, 'computed operands cannot link an ordinary import')
    }
    const call = fact.span as Obj
    const operand = fact.operandSpan as Obj
    const compare = (line: unknown, col: unknown, otherLine: unknown, otherCol: unknown) =>
      Number(line) - Number(otherLine) || Number(col) - Number(otherCol)
    if (compare(operand.startLine, operand.startColumn, call.startLine, call.startColumn) <= 0 ||
        (call.endLine !== null && (operand.endLine === null || compare(operand.endLine, operand.endColumn, call.endLine, call.endColumn) > 0))) {
      fail(path, 'operand must be nested in its call')
    }
    return fact
  }
  const kind = requireOneOf(fact.kind, SOURCE_AUDIT_FACT_KINDS, `${path}.kind`)
  const fields = FACT_FIELDS[kind]
  requireClosed(fact, path, [...FACT_COMMON, ...fields.allowed], [...FACT_COMMON, ...fields.required])
  if (kind === 'declaration') {
    if (fact.declarationKind !== 'ambient-module') {
      requireText(fact.symbolId, `${path}.symbolId`)
    } else if (fact.symbolId !== undefined || fact.extractionMethod !== 'typescript-ast') {
      fail(path, 'ambient modules require TypeScript AST evidence without a graph symbol')
    }
  }
  requireText(fact.id, `${path}.id`)
  validateSpan(fact.span, `${path}.span`, filePath)
  requireOneOf(fact.extractionMethod, SOURCE_AUDIT_EXTRACTION_METHODS, `${path}.extractionMethod`)

  const capabilityStatus = capabilities[FACT_CAPABILITY[kind]]
  if (capabilityStatus !== 'complete' && capabilityStatus !== 'partial') {
    fail(path, `kind ${kind} requires its capability to be complete or partial`)
  }

  if (fact.name !== undefined) requireText(fact.name, `${path}.name`)
  if (fact.jvmDeclaration !== undefined) {
    const identity = requireObj(fact.jvmDeclaration, `${path}.jvmDeclaration`)
    requireClosed(identity, `${path}.jvmDeclaration`, ['packageName', 'qualifiedName', 'role'], ['packageName', 'qualifiedName', 'role'])
    validateJvmName(identity.packageName, `${path}.jvmDeclaration.packageName`, true)
    validateJvmName(identity.qualifiedName, `${path}.jvmDeclaration.qualifiedName`)
    requireOneOf(identity.role, ['type', 'kotlin-top-level-function', 'kotlin-top-level-property'], `${path}.jvmDeclaration.role`)
    const prefix = identity.packageName === '' ? '' : `${identity.packageName}.`
    const qualified = identity.qualifiedName as string
    if (!qualified.startsWith(prefix) || qualified.slice(prefix.length).split('.').at(-1) !== fact.name) fail(path, 'JVM declaration identity must match its package and declared name')
    if (fact.ownerKey && qualified.slice(prefix.length).split('.').length < 2) fail(path, 'nested JVM declaration requires its enclosing owner identity')
    if (typeof fact.ownerKey === 'string') {
      const owners = fact.ownerKey.split('/').slice(1).map((part) => part.slice(part.indexOf(':') + 1))
      if (qualified !== [identity.packageName, ...owners, fact.name].filter(Boolean).join('.')) fail(path, 'JVM declaration identity must preserve its exact enclosing owner chain')
    }
    if (!fact.ownerKey && qualified.slice(prefix.length) !== fact.name) fail(path, 'top-level JVM declaration must have no enclosing owner')
    if (identity.role !== 'type' && fact.ownerKey) fail(path, 'Kotlin top-level roles cannot have an enclosing owner')
  }
  if (fact.jvmImportTarget !== undefined) {
    const target = requireObj(fact.jvmImportTarget, `${path}.jvmImportTarget`)
    requireClosed(target, `${path}.jvmImportTarget`, ['kind', 'qualifiedName'], ['kind', 'qualifiedName'])
    requireOneOf(target.kind, ['java-type', 'java-static-owner', 'kotlin-direct', 'unsupported'], `${path}.jvmImportTarget.kind`)
    if (target.qualifiedName !== null) validateJvmName(target.qualifiedName, `${path}.jvmImportTarget.qualifiedName`)
    if (target.kind === 'unsupported' && target.qualifiedName !== null) fail(path, 'unsupported JVM target cannot claim a qualified name')
  }
  if (fact.observationKind !== undefined) {
    requireOneOf(fact.observationKind, SOURCE_AUDIT_OBSERVATION_KINDS, `${path}.observationKind`)
  }
  if (fact.symbolId !== undefined) requireText(fact.symbolId, `${path}.symbolId`)
  if (fact.declarationKind !== undefined) requireText(fact.declarationKind, `${path}.declarationKind`)
  if (fact.ownerKey !== undefined) requireNullable(fact.ownerKey, `${path}.ownerKey`, requireText)
  if (fact.visibility !== undefined) requireOneOf(fact.visibility, SOURCE_AUDIT_VISIBILITIES, `${path}.visibility`)
  if (fact.exported !== undefined) requireNullable(fact.exported, `${path}.exported`, requireBool)
  if (fact.exportOrigin !== undefined) requireOneOf(fact.exportOrigin, SOURCE_AUDIT_EXPORT_ORIGINS, `${path}.exportOrigin`)
  if (fact.sourceSpecifier !== undefined) requireText(fact.sourceSpecifier, `${path}.sourceSpecifier`)
  if (fact.owningSymbolId !== undefined) requireNullable(fact.owningSymbolId, `${path}.owningSymbolId`, requireText)
  if (fact.httpMethod !== undefined) requireOneOf(fact.httpMethod, SOURCE_AUDIT_HTTP_METHODS, `${path}.httpMethod`)
  if (fact.httpClientKind !== undefined) {
    requireOneOf(fact.httpClientKind, SOURCE_AUDIT_HTTP_CLIENT_KINDS, `${path}.httpClientKind`)
  }
  if (fact.staticUrl !== undefined) requireNullable(fact.staticUrl, `${path}.staticUrl`, requireText)
  if (fact.importedNames !== undefined) requireStringArray(fact.importedNames, `${path}.importedNames`, false)
  if (fact.importResolution !== undefined) {
    requireOneOf(fact.importResolution, SOURCE_AUDIT_IMPORT_RESOLUTIONS, `${path}.importResolution`)
  }
  if (fact.targetPaths !== undefined) {
    const targets = requireArray(fact.targetPaths, `${path}.targetPaths`)
    const seen = new Set<string>()
    targets.forEach((target, i) => {
      const p = requirePath(target, `${path}.targetPaths[${i}]`)
      if (seen.has(p)) fail(`${path}.targetPaths[${i}]`, 'is duplicated')
      seen.add(p)
    })
  }
  if (kind === 'import') {
    const resolution = fact.importResolution
    const count = Array.isArray(fact.targetPaths) ? fact.targetPaths.length : 0
    if (resolution === 'resolved-local' && count === 0) fail(`${path}.targetPaths`, 'is required for resolved-local imports')
    if (resolution !== 'resolved-local' && resolution !== 'ambiguous' && count > 0) {
      fail(`${path}.targetPaths`, 'is only allowed for resolved-local or ambiguous imports')
    }
  }

  validateLiteral(fact, path)
  return fact
}

function validateLiteral(fact: Obj, path: string): void {
  const { value, valueSha256, valueTruncated } = fact
  if (value !== undefined) requireNullable(value, `${path}.value`, (v, p) => {
    if (typeof v !== 'string') fail(p, 'must be a string or null')
    return v
  })
  if (valueSha256 !== undefined) requireSha(valueSha256, `${path}.valueSha256`)
  if (valueTruncated !== undefined) requireBool(valueTruncated, `${path}.valueTruncated`)
  if (valueTruncated === true) {
    // A known oversized literal exposes no prefix: value is null and valueSha256 identifies the exact original.
    if (value !== null) fail(`${path}.value`, 'must be null when valueTruncated is true (no prefix is exposed)')
    if (valueSha256 === undefined) fail(`${path}.valueSha256`, 'is required when valueTruncated is true')
    return
  }
  if (valueTruncated !== undefined && value === undefined) fail(`${path}.value`, 'is required when valueTruncated is set')
  if (typeof value === 'string' && value.length > AUDIT_LITERAL_MAX_CHARS) {
    fail(`${path}.value`, `exceeds ${AUDIT_LITERAL_MAX_CHARS} characters without valueTruncated`)
  }
}

function compareFacts(a: Obj, b: Obj): number {
  const sa = a.span as Obj
  const sb = b.span as Obj
  const line = (sa.startLine as number) - (sb.startLine as number)
  if (line !== 0) return line
  const col = ((sa.startColumn as number | null) ?? -1) - ((sb.startColumn as number | null) ?? -1)
  if (col !== 0) return col
  const ia = a.id as string
  const ib = b.id as string
  return ia < ib ? -1 : ia > ib ? 1 : 0
}

function validateFacts(value: unknown, path: string, filePath: string, capabilities: Record<string, unknown>): Obj[] {
  const arr = requireArray(value, path)
  const facts = arr.map((item, i) => validateFact(item, `${path}[${i}]`, filePath, capabilities))
  for (let i = 1; i < facts.length; i++) {
    if (compareFacts(facts[i - 1] as Obj, facts[i] as Obj) >= 0) {
      fail(`${path}[${i}]`, 'is out of order or duplicated (expected ascending line, column, id)')
    }
  }
  return facts
}

// --- files -----------------------------------------------------------------

type FileMode = 'full' | 'inventory' | 'file-page'

const FILE_BASE_KEYS = [
  'path',
  'language',
  'role',
  'status',
  'contentSha256',
  'sizeBytes',
  'lineCount',
  'analyzerId',
  'capabilities',
  'warnings',
]

function validateJvmName(value: unknown, path: string, allowDefault = false): void {
  if (typeof value !== 'string' || !(allowDefault && value === '') && !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(value)) fail(path, 'must be a qualified JVM identifier')
}

function validateFileRecord(value: unknown, path: string, mode: FileMode, feature = false): Obj {
  const file = requireObj(value, path)
  const extra = mode === 'full' ? ['facts', 'diagnostics'] : mode === 'file-page' ? ['diagnostics'] : []
  requireClosed(file, path, [...FILE_BASE_KEYS, ...extra, 'jvmPackageName', ...(feature ? ['ambientClassification'] : [])], [...FILE_BASE_KEYS, ...extra])
  if (file.jvmPackageName !== undefined) validateJvmName(file.jvmPackageName, `${path}.jvmPackageName`, true)
  const filePath = requirePath(file.path, `${path}.path`)
  requireText(file.language, `${path}.language`)
  requireOneOf(file.role, SOURCE_AUDIT_ROLES, `${path}.role`)
  const status = requireOneOf(file.status, SOURCE_AUDIT_FILE_STATUSES, `${path}.status`)
  requireNullable(file.contentSha256, `${path}.contentSha256`, requireSha)
  requireNullable(file.sizeBytes, `${path}.sizeBytes`, requireNonNegInt)
  requireNullable(file.lineCount, `${path}.lineCount`, requireNonNegInt)
  requireNullable(file.analyzerId, `${path}.analyzerId`, requireText)

  const capabilities = requireObj(file.capabilities, `${path}.capabilities`)
  const capabilityKeys = feature ? [...SOURCE_AUDIT_CAPABILITIES, 'dynamic-import-expressions'] : SOURCE_AUDIT_CAPABILITIES
  requireClosed(capabilities, `${path}.capabilities`, feature ? [...capabilityKeys, 'direct-test-modifiers'] : capabilityKeys, capabilityKeys)
  if (capabilities['direct-test-modifiers'] !== undefined) {
    const modifier = requireOneOf(capabilities['direct-test-modifiers'], ['complete', 'partial'] as const, path)
    if (!feature || !['typescript', 'javascript'].includes(String(file.language)) || file.analyzerId !== 'typescript-ast' ||
        (modifier === 'complete' && (status !== 'parsed' || typeof file.contentSha256 !== 'string' ||
          !['complete', 'partial'].includes(String(capabilities['test-observations']))))) fail(path, 'invalid direct-test-modifiers proof')
  }
  for (const capability of capabilityKeys) {
    const capabilityStatus = requireOneOf(
      capabilities[capability],
      SOURCE_AUDIT_CAPABILITY_STATUSES,
      `${path}.capabilities.${capability}`,
    )
    if (capabilityStatus === 'complete' && status !== 'parsed' && status !== 'partial') {
      fail(`${path}.capabilities.${capability}`, `cannot be complete for a ${status} file`)
    }
  }

  if (file.ambientClassification !== undefined) {
    const a = requireObj(file.ambientClassification, `${path}.ambientClassification`)
    const keys = ['profile', 'contentSha256', 'scope', 'outcome', 'witnessFactIds', 'reasonCode']
    requireClosed(a, path, keys, keys)
    if (a.profile !== 'typescript-ambient-stub-v1' || a.scope !== 'entire-file' || file.language !== 'typescript') fail(path, 'invalid ambient classification profile')
    requireSha(a.contentSha256, `${path}.ambientClassification.contentSha256`)
    if (a.contentSha256 !== file.contentSha256) fail(path, 'ambient classification hash mismatch')
    const outcome = requireOneOf(a.outcome, ['proven-ambient-only', 'not-ambient-only', 'undetermined'] as const, path)
    const ids = requireArray(a.witnessFactIds, path).map(id => requireText(id, path))
    if (new Set(ids).size !== ids.length) fail(path, 'duplicate ambient witness')
    if (outcome === 'proven-ambient-only') {
      if (a.reasonCode !== null || ids.length === 0 || status !== 'parsed' || capabilities.declarations !== 'complete') fail(path, 'invalid ambient proof')
    } else {
      if (ids.length > 0) fail(path, 'unproven classification cannot claim witnesses')
      requireOneOf(a.reasonCode, outcome === 'not-ambient-only'
        ? ['EXECUTABLE_SYNTAX_PRESENT'] as const : ['UNSUPPORTED_AMBIENT_PROFILE', 'PARSE_UNCERTAINTY'] as const, path)
    }
  }
  requireStringArray(file.warnings, `${path}.warnings`, false)
  if (capabilities.jvmDeclarations === 'complete') {
    if (!/\.(java|kt)$/i.test(filePath) || file.jvmPackageName === undefined || capabilities.declarations !== 'complete') fail(path, 'complete JVM declarations require an ordinary JVM file, known package and complete declarations')
  }

  if (mode !== 'inventory') {
    requireArray(file.diagnostics, `${path}.diagnostics`).forEach((entry, i) => {
      const dp = `${path}.diagnostics[${i}]`
      const diag = requireObj(entry, dp)
      requireClosed(diag, dp, ['code', 'message', 'span'], ['code', 'message', 'span'])
      requireText(diag.code, `${dp}.code`)
      requireText(diag.message, `${dp}.message`)
      if (diag.span !== null) validateSpan(diag.span, `${dp}.span`, filePath)
    })
  }
  if (mode === 'full' && (status === 'failed' || status === 'skipped' || status === 'unsupported')) {
    if (requireArray(file.facts, `${path}.facts`).length > 0) fail(`${path}.facts`, `must be empty for a ${status} file`)
  }
  return file
}

// --- coverage --------------------------------------------------------------

type Coverage = SourceAuditEvidenceArtifact['coverage']

function validateCoverage(value: unknown, path: string): Coverage {
  const coverage = requireObj(value, path)
  const keys = [
    'selectedFileCount',
    'recordedFileCount',
    'unreadableFileCount',
    'excludedPathCount',
    'unsupportedFileCount',
    'inventoryComplete',
    'exclusionsAreExplicit',
  ]
  requireClosed(coverage, path, keys, keys)
  const selected = requireNonNegInt(coverage.selectedFileCount, `${path}.selectedFileCount`)
  const recorded = requireNonNegInt(coverage.recordedFileCount, `${path}.recordedFileCount`)
  const unreadable = requireNonNegInt(coverage.unreadableFileCount, `${path}.unreadableFileCount`)
  requireNonNegInt(coverage.excludedPathCount, `${path}.excludedPathCount`)
  const unsupported = requireNonNegInt(coverage.unsupportedFileCount, `${path}.unsupportedFileCount`)
  const complete = requireBool(coverage.inventoryComplete, `${path}.inventoryComplete`)
  requireBool(coverage.exclusionsAreExplicit, `${path}.exclusionsAreExplicit`)
  if (recorded > selected) fail(`${path}.recordedFileCount`, 'must not exceed selectedFileCount')
  if (unreadable > recorded) fail(`${path}.unreadableFileCount`, 'must not exceed recordedFileCount')
  if (unsupported > recorded) fail(`${path}.unsupportedFileCount`, 'must not exceed recordedFileCount')
  if (complete && recorded !== selected) {
    fail(`${path}.inventoryComplete`, 'cannot be true unless recordedFileCount equals selectedFileCount')
  }
  return coverage as unknown as Coverage
}

// --- artifact --------------------------------------------------------------

export function validateSourceAuditEvidence(value: unknown): asserts value is SourceAuditEvidenceArtifact {
  const root = requireObj(value, '$')
  requireClosed(root, '$', ['artifactKind', 'schemaVersion', 'producer', 'source', 'coverage', 'files'], [
    'artifactKind',
    'schemaVersion',
    'producer',
    'source',
    'coverage',
    'files',
  ])
  if (root.artifactKind !== SOURCE_AUDIT_ARTIFACT_KIND) fail('$.artifactKind', 'must equal the source-audit artifact kind')
  if (root.schemaVersion !== SOURCE_AUDIT_SCHEMA_VERSION && root.schemaVersion !== '1.2.0') fail('$.schemaVersion', 'must equal the source-audit schema version')

  const producer = requireObj(root.producer, '$.producer')
  requireClosed(producer, '$.producer', ['packageName', 'packageVersion'], ['packageName', 'packageVersion'])
  if (producer.packageName !== '@dailephd/my-dev-kit') fail('$.producer.packageName', 'must be @dailephd/my-dev-kit')
  requireText(producer.packageVersion, '$.producer.packageVersion')

  const source = requireObj(root.source, '$.source')
  const sourceKeys = [
    'projectRoot',
    'sourceRoots',
    'excludes',
    'symbolIndexSchemaVersion',
    'codeGraphSchemaVersion',
    'selectionFingerprint',
    'snapshotId',
  ]
  requireClosed(source, '$.source', sourceKeys, sourceKeys)
  requireText(source.projectRoot, '$.source.projectRoot')
  requireArray(source.sourceRoots, '$.source.sourceRoots').forEach((root, i) => {
    if (root !== '.') requirePath(root, `$.source.sourceRoots[${i}]`)
  })
  const excludes = requireStringArray(source.excludes, '$.source.excludes', false)
  if (source.symbolIndexSchemaVersion !== '3') fail('$.source.symbolIndexSchemaVersion', 'must equal "3"')
  if (source.codeGraphSchemaVersion !== '1.1.0') fail('$.source.codeGraphSchemaVersion', 'must equal "1.1.0"')
  requireSha(source.selectionFingerprint, '$.source.selectionFingerprint')
  requireSha(source.snapshotId, '$.source.snapshotId')

  const coverage = validateCoverage(root.coverage, '$.coverage')

  const files = requireArray(root.files, '$.files')
  const seenFactIds = new Set<string>()
  let unsupported = 0
  let failed = 0
  let previousPath: string | null = null
  files.forEach((entry, i) => {
    const path = `$.files[${i}]`
    const file = validateFileRecord(entry, path, 'full', root.schemaVersion === '1.2.0')
    const filePath = file.path as string
    if (previousPath !== null && filePath <= previousPath) {
      fail(`${path}.path`, filePath === previousPath ? 'is duplicated' : 'is out of order (expected ascending path)')
    }
    previousPath = filePath
    if (file.status === 'unsupported') unsupported++
    if (file.status === 'failed') failed++
    const facts = validateFacts(file.facts, `${path}.facts`, filePath, file.capabilities as Obj)
    const byId = new Map(facts.map(fact => [fact.id, fact]))
    for (const fact of facts) {
      if (fact.literalImportFactId === undefined) continue
      const linked = byId.get(fact.literalImportFactId)
      if (linked?.kind !== 'import' || JSON.stringify(linked.span) !== JSON.stringify(fact.span)) fail(path, 'invalid expression/import linkage')
    }
    const ambient = file.ambientClassification as Obj | undefined
    if (ambient && (ambient.witnessFactIds as string[]).some(id => {
      const witness = byId.get(id)
      return witness?.kind !== 'declaration' || witness.declarationKind !== 'ambient-module'
    })) fail(path, 'ambient witness is not an ambient declaration')
    for (const fact of facts) {
      if (fact.jvmDeclaration !== undefined) {
        const identity = fact.jvmDeclaration as Obj
        if (identity.packageName !== file.jvmPackageName || !/\.(java|kt)$/i.test(filePath)) fail(path, 'JVM declaration package must match its ordinary source file')
        if (file.language === 'java' && identity.role !== 'type') fail(path, 'Java declarations must use type role')
        if (identity.role === 'kotlin-top-level-function' && fact.declarationKind !== 'function' || identity.role === 'kotlin-top-level-property' && fact.declarationKind !== 'const' && fact.declarationKind !== 'variable') fail(path, 'JVM declaration role contradicts its declaration kind')
        if (fact.ownerKey && !(fact.ownerKey as string).startsWith(`${file.language}/`)) fail(path, 'JVM enclosing owner reference must belong to its language')
      }
      if (fact.jvmImportTarget !== undefined) {
        const target = fact.jvmImportTarget as Obj
        if (!/\.(java|kt|kts)$/i.test(filePath) || file.language === 'java' && target.kind === 'kotlin-direct' || file.language === 'kotlin' && (target.kind === 'java-type' || target.kind === 'java-static-owner')) fail(path, 'JVM import target kind contradicts its source language')
        if (target.qualifiedName !== null && target.kind !== 'unsupported') {
          const specifier = fact.sourceSpecifier as string
          if (target.kind === 'java-static-owner' ? !specifier.startsWith(`${target.qualifiedName}.`) || specifier.slice((target.qualifiedName as string).length + 1).includes('.') : specifier !== target.qualifiedName) fail(path, 'JVM target identity contradicts its import fact')
        }
      }
      if ((file.capabilities as Obj).jvmDeclarations === 'complete' && fact.kind === 'declaration' && !fact.jvmDeclaration) fail(path, 'complete JVM declaration extraction cannot omit declaration identity')
    }
    for (const fact of facts) {
      const id = fact.id as string
      if (seenFactIds.has(id)) fail(`${path}.facts`, 'contains a fact id duplicated across the artifact')
      seenFactIds.add(id)
    }
  })

  if (coverage.recordedFileCount !== files.length) fail('$.coverage.recordedFileCount', 'must equal the number of file records')
  if (coverage.unsupportedFileCount !== unsupported) {
    fail('$.coverage.unsupportedFileCount', 'must equal the number of unsupported file records')
  }
  if (coverage.unreadableFileCount > failed) fail('$.coverage.unreadableFileCount', 'requires a failed record for each unreadable file')
  if (coverage.exclusionsAreExplicit && coverage.excludedPathCount > 0 && excludes.length === 0) {
    fail('$.coverage.exclusionsAreExplicit', 'cannot be true with excluded paths and no recorded excludes')
  }
}

// --- pages -----------------------------------------------------------------

const ENVELOPE_KEYS = ['schemaVersion', 'snapshotId', 'pageIndex', 'pageSize', 'totalItems', 'totalPages', 'nextPageIndex']

/** Validates the shared envelope and returns the expected item count for this page. */
function validateEnvelope(page: Obj, path: string, expectedPageSize: number): number {
  if (page.schemaVersion !== SOURCE_AUDIT_SCHEMA_VERSION && page.schemaVersion !== '1.2.0') fail(`${path}.schemaVersion`, 'must equal the source-audit schema version')
  requireSha(page.snapshotId, `${path}.snapshotId`)
  const pageIndex = requireNonNegInt(page.pageIndex, `${path}.pageIndex`)
  const pageSize = requireNonNegInt(page.pageSize, `${path}.pageSize`)
  const totalItems = requireNonNegInt(page.totalItems, `${path}.totalItems`)
  const totalPages = requireNonNegInt(page.totalPages, `${path}.totalPages`)
  if (pageSize !== expectedPageSize) fail(`${path}.pageSize`, `must equal ${expectedPageSize}`)
  const expectedTotalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  if (totalPages !== expectedTotalPages) fail(`${path}.totalPages`, `must equal ${expectedTotalPages}`)
  if (pageIndex >= totalPages) fail(`${path}.pageIndex`, 'must be less than totalPages')
  const expectedNext = pageIndex + 1 < totalPages ? pageIndex + 1 : null
  if (page.nextPageIndex !== expectedNext) fail(`${path}.nextPageIndex`, 'must be null only on the terminal page')
  return Math.min(pageSize, Math.max(0, totalItems - pageIndex * pageSize))
}

export function validateSourceAuditInventoryPage(value: unknown): asserts value is SourceAuditInventoryPage {
  const page = requireObj(value, '$')
  const keys = [...ENVELOPE_KEYS, 'mode', 'coverage', 'files']
  requireClosed(page, '$', keys, keys)
  if (page.mode !== 'audit-files') fail('$.mode', 'must equal "audit-files"')
  const expectedItems = validateEnvelope(page, '$', AUDIT_INVENTORY_PAGE_SIZE)
  const coverage = validateCoverage(page.coverage, '$.coverage')
  if (page.totalItems !== coverage.recordedFileCount) fail('$.totalItems', 'must equal coverage.recordedFileCount')
  const files = requireArray(page.files, '$.files')
  if (files.length !== expectedItems) fail('$.files', `must contain exactly ${expectedItems} items for this page`)
  let previousPath: string | null = null
  files.forEach((entry, i) => {
    const file = validateFileRecord(entry, `$.files[${i}]`, 'inventory', page.schemaVersion === '1.2.0')
    const filePath = file.path as string
    if (previousPath !== null && filePath <= previousPath) {
      fail(`$.files[${i}].path`, filePath === previousPath ? 'is duplicated' : 'is out of order (expected ascending path)')
    }
    previousPath = filePath
  })
}

export function validateSourceAuditFilePage(value: unknown): asserts value is SourceAuditFilePage {
  const page = requireObj(value, '$')
  const keys = [...ENVELOPE_KEYS, 'mode', 'status', 'file', 'facts']
  requireClosed(page, '$', [...keys, 'testModifierProof'], keys)
  if (page.mode !== 'audit-file') fail('$.mode', 'must equal "audit-file"')
  const status = requireOneOf(page.status, ['found', 'not-selected'] as const, '$.status')
  const expectedItems = validateEnvelope(page, '$', AUDIT_FACT_PAGE_SIZE)
  const facts = requireArray(page.facts, '$.facts')
  const hasModifierProof = Object.hasOwn(page, 'testModifierProof')
  if (hasModifierProof && (status !== 'found' || page.schemaVersion !== '1.2.0' || page.pageIndex !== 0)) {
    fail('$.testModifierProof', 'is allowed only on a found schema 1.2.0 first page')
  }

  if (status === 'not-selected') {
    if (page.file !== null) fail('$.file', 'must be null for a not-selected result')
    if (facts.length !== 0) fail('$.facts', 'must be empty for a not-selected result')
    if (page.totalItems !== 0) fail('$.totalItems', 'must be 0 for a not-selected result')
    return
  }

  if (page.file === null) fail('$.file', 'is required for a found result')
  const file = validateFileRecord(page.file, '$.file', 'file-page', page.schemaVersion === '1.2.0')
  if (facts.length !== expectedItems) fail('$.facts', `must contain exactly ${expectedItems} items for this page`)
  const pageFacts = validateFacts(facts, '$.facts', file.path as string, file.capabilities as Obj)
  if (file.status === 'failed' || file.status === 'skipped' || file.status === 'unsupported') {
    if (pageFacts.length > 0 || page.totalItems !== 0) fail('$.facts', `must be empty for a ${file.status as string} file`)
  }
  if (hasModifierProof) validateTestModifierProof(page.testModifierProof, page, file)
}

function requireModifierPath(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.includes('\0') || value.includes('\\') || /^[A-Za-z]:/.test(value) ||
      Buffer.byteLength(value) > TEST_MODIFIER_PROOF_MAX_PATH_BYTES ||
      value.split('/').some(part => part === '' || part === '.' || part === '..')) {
    fail(path, 'must be a bounded canonical path')
  }
  return value
}

function requireExactModifierSpan(value: unknown, path: string, file: string): ExactAuditSpan {
  validateSpan(value, path, file)
  const span = value as ExactAuditSpan
  if (span.startColumn === null || span.endLine === null || span.endColumn === null ||
      (span.startLine === span.endLine && span.startColumn === span.endColumn)) fail(path, 'must be an exact nonempty span')
  return span
}

function containsModifierSpan(outer: ExactAuditSpan, inner: ExactAuditSpan): boolean {
  return (outer.startLine < inner.startLine || outer.startLine === inner.startLine && outer.startColumn <= inner.startColumn) &&
    (outer.endLine > inner.endLine || outer.endLine === inner.endLine && outer.endColumn >= inner.endColumn)
}

function validateTestModifierProof(value: unknown, page: Obj, file: Obj): void {
  const path = '$.testModifierProof'
  if ((file.language !== 'typescript' && file.language !== 'javascript') ||
      (file.status !== 'parsed' && file.status !== 'partial')) fail(path, 'requires an eligible JS/TS file')
  const proof = requireObj(value, path)
  const keys = ['schemaVersion', 'profile', 'snapshotId', 'selectionFingerprint', 'selectedDomainDigest',
    'originFile', 'originContentSha256', 'coverage', 'runnerBinding', 'observations', 'reasonCodes']
  requireClosed(proof, path, keys, keys)
  if (proof.schemaVersion !== '1.0.0' || proof.profile !== TEST_MODIFIER_PROOF_PROFILE) fail(path, 'has an unsupported schema or profile')
  const origin = requireModifierPath(proof.originFile, path + '.originFile')
  requireSha(proof.selectionFingerprint, path + '.selectionFingerprint')
  requireSha(proof.selectedDomainDigest, path + '.selectedDomainDigest')
  if (proof.snapshotId !== page.snapshotId || origin !== file.path ||
      requireSha(proof.originContentSha256, path + '.originContentSha256') !== file.contentSha256) fail(path, 'must bind to the page file')
  const coverage = requireOneOf(proof.coverage, ['complete', 'partial'], path + '.coverage')
  if (coverage === 'complete' && file.status !== 'parsed') fail(path + '.coverage', 'requires a parsed file for complete coverage')
  const reasons = requireArray(proof.reasonCodes, path + '.reasonCodes')
  if (reasons.length > TEST_MODIFIER_PROOF_REASONS.length || (reasons.length === 0) !== (coverage === 'complete')) {
    fail(path + '.reasonCodes', 'must agree with coverage and respect the reason budget')
  }
  let previousReason = ''
  for (const reason of reasons) {
    const code = requireOneOf(reason, TEST_MODIFIER_PROOF_REASONS, path + '.reasonCodes')
    if (code <= previousReason) fail(path + '.reasonCodes', 'must be unique and sorted')
    previousReason = code
  }

  const runnerPath = path + '.runnerBinding'
  const runner = requireObj(proof.runnerBinding, runnerPath)
  const runnerKeys = ['kind', 'localName', 'bindingSpan', 'baseLocalName', 'baseImportSpan', 'extensionSpan', 'wrapper']
  requireClosed(runner, runnerPath, runnerKeys, runnerKeys)
  const kind = requireOneOf(runner.kind, ['direct-playwright', 'local-extended-playwright', 'imported-extended-playwright'], runnerPath + '.kind')
  if (runner.localName !== 'test' || typeof runner.baseLocalName !== 'string' || !runner.baseLocalName) fail(runnerPath, 'has an invalid binding name')
  const binding = requireExactModifierSpan(runner.bindingSpan, runnerPath + '.bindingSpan', origin)
  const basePath = kind === 'imported-extended-playwright' ? validateModifierWrapper(runner.wrapper, proof, origin) : origin
  if (kind !== 'imported-extended-playwright' && runner.wrapper !== null) fail(runnerPath + '.wrapper', 'must be null for an origin binding')
  const base = requireExactModifierSpan(runner.baseImportSpan, runnerPath + '.baseImportSpan', basePath)
  if (kind === 'direct-playwright') {
    if (runner.baseLocalName !== 'test' || runner.extensionSpan !== null ||
        !containsModifierSpan(base, binding) || !containsModifierSpan(binding, base)) fail(runnerPath, 'has inconsistent direct binding spans')
  } else {
    const extension = requireExactModifierSpan(runner.extensionSpan, runnerPath + '.extensionSpan', basePath)
    const declaration = kind === 'local-extended-playwright' ? binding :
      (runner.wrapper as { exportBindingSpan: ExactAuditSpan }).exportBindingSpan
    if (!containsModifierSpan(declaration, extension)) fail(runnerPath + '.extensionSpan', 'must be inside its variable declaration')
  }

  const observations = requireArray(proof.observations, path + '.observations')
  if (observations.length > TEST_MODIFIER_PROOF_MAX_OBSERVATIONS) fail(path + '.observations', 'exceeds the observation budget')
  let previous: TestModifierObservation | undefined
  for (const [index, item] of observations.entries()) {
    const at = `${path}.observations[${index}]`
    const observation = requireObj(item, at)
    const keys = ['modifier', 'calleeSpan', 'callSpan']
    requireClosed(observation, at, keys, keys)
    const modifier = requireOneOf(observation.modifier, ['skip', 'only'] as const, at + '.modifier')
    const calleeSpan = requireExactModifierSpan(observation.calleeSpan, at + '.calleeSpan', origin)
    const callSpan = requireExactModifierSpan(observation.callSpan, at + '.callSpan', origin)
    if (!containsModifierSpan(callSpan, calleeSpan)) fail(at + '.calleeSpan', 'must be contained within the call')
    const current = { modifier, calleeSpan, callSpan }
    if (previous && compareTestModifierObservations(previous, current) >= 0) fail(at, 'must have a unique, sorted identity')
    previous = current
  }
  if (Buffer.byteLength(JSON.stringify(value)) > TEST_MODIFIER_PROOF_MAX_BYTES) fail(path, 'exceeds the serialized proof budget')
}

function validateModifierWrapper(value: unknown, proof: Obj, origin: string): string {
  const path = '$.testModifierProof.runnerBinding.wrapper'
  const wrapper = requireObj(value, path)
  const keys = ['path', 'contentSha256', 'exportBindingSpan', 'importTargetProof']
  requireClosed(wrapper, path, keys, keys)
  const source = requireModifierPath(wrapper.path, path + '.path')
  if (source === origin) fail(path + '.path', 'must identify a distinct selected file')
  const hash = requireSha(wrapper.contentSha256, path + '.contentSha256')
  requireExactModifierSpan(wrapper.exportBindingSpan, path + '.exportBindingSpan', source)

  // Check the positive JS/TS subset of the ordinary envelope embedded here.
  // Live candidate and premise qualification remains with the ordinary resolver.
  const ordinaryPath = path + '.importTargetProof'
  const referencePath = ordinaryPath + '.sourceReferenceProof'
  const ordinary = requireObj(wrapper.importTargetProof, ordinaryPath)
  const ordinaryKeys = ['schemaVersion', 'mode', 'snapshotId', 'importFactId', 'originFile', 'sourceSpecifier',
    'status', 'candidatePaths', 'selectionComplete', 'reasonCode', 'sourceReferenceProof']
  requireClosed(ordinary, ordinaryPath, ordinaryKeys, ordinaryKeys)
  const reference = requireObj(ordinary.sourceReferenceProof, referencePath)
  const referenceKeys = ['schemaVersion', 'profile', 'pathIdentityProfile', 'snapshotId', 'selectionFingerprint',
    'selectedDomainDigest', 'originFile', 'originContentSha256', 'importFactId', 'sourceSpecifier', 'resolutionPlatform',
    'candidateEnumerationComplete', 'candidateDomain', 'qualifiedReference', 'premiseRefs', 'reasonCode']
  requireClosed(reference, referencePath, referenceKeys, referenceKeys)
  const target = requireObj(reference.qualifiedReference, referencePath + '.qualifiedReference')
  const targetKeys = ['targetPath', 'targetContentSha256', 'referenceKind']
  requireClosed(target, referencePath + '.qualifiedReference', targetKeys, targetKeys)
  if (ordinary.schemaVersion !== '1.1.0' || ordinary.mode !== 'audit-import-target' ||
      ordinary.snapshotId !== proof.snapshotId || ordinary.originFile !== origin || ordinary.selectionComplete !== true ||
      reference.schemaVersion !== '1.0.0' || reference.profile !== 'js-ts-selected-source-reference-v1' ||
      reference.pathIdentityProfile !== 'selected-source-path-v1' || reference.snapshotId !== proof.snapshotId ||
      reference.selectionFingerprint !== proof.selectionFingerprint || reference.selectedDomainDigest !== proof.selectedDomainDigest ||
      reference.originFile !== origin || reference.originContentSha256 !== proof.originContentSha256 ||
      reference.importFactId !== requireText(ordinary.importFactId, ordinaryPath + '.importFactId') ||
      reference.sourceSpecifier !== requireText(ordinary.sourceSpecifier, ordinaryPath + '.sourceSpecifier') ||
      reference.candidateEnumerationComplete !== true || reference.reasonCode !== null ||
      target.targetPath !== source || target.targetContentSha256 !== hash || target.referenceKind !== 'selected-source-reference') {
    fail(ordinaryPath, 'must qualify the exact wrapper and origin identities')
  }
  requireOneOf(ordinary.status, ['present', 'proven-missing', 'outside-selected-roots', 'indeterminate'], ordinaryPath + '.status')
  requireText(ordinary.reasonCode, ordinaryPath + '.reasonCode')
  for (const candidate of requireArray(ordinary.candidatePaths, ordinaryPath + '.candidatePaths')) {
    requireModifierPath(candidate, ordinaryPath + '.candidatePaths')
  }
  requireOneOf(reference.resolutionPlatform, ['win32', 'posix'], referencePath + '.resolutionPlatform')
  const domain = requireArray(reference.candidateDomain, referencePath + '.candidateDomain')
  for (const candidate of domain) requireModifierPath(candidate, referencePath + '.candidateDomain')
  if (!domain.includes(source)) fail(referencePath + '.candidateDomain', 'must contain the qualified wrapper')
  let hasWrapperPremise = false
  for (const value of requireArray(reference.premiseRefs, referencePath + '.premiseRefs')) {
    const at = referencePath + '.premiseRefs'
    const premise = requireObj(value, at)
    const keys = ['role', 'path', 'state', 'contentSha256']
    requireClosed(premise, at, keys, keys)
    const role = requireOneOf(premise.role, ['config', 'package-metadata', 'candidate', 'path'], at + '.role')
    const premisePath = requireModifierPath(premise.path, at + '.path')
    const state = requireOneOf(premise.state, ['absent', 'file', 'directory'], at + '.state')
    if (state === 'file') requireSha(premise.contentSha256, at + '.contentSha256')
    else if (premise.contentSha256 !== null) fail(at + '.contentSha256', 'must be null for a non-file premise')
    if (role === 'candidate' && premisePath === source && state === 'file' && premise.contentSha256 === hash) hasWrapperPremise = true
  }
  if (!hasWrapperPremise) fail(referencePath + '.premiseRefs', 'must include the exact selected wrapper bytes')
  return source
}
