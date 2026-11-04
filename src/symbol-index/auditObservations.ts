/**
 * v1.15.0 Batch 2: pure normalization of language-owned source-audit facts.
 *
 * Language adapters attach raw audit facts to their existing extraction result
 * (`ExtractionResult.sourceAudit`) while they already hold the parsed source.
 * `extractAuditObservations` validates and normalizes that evidence into the
 * deterministic payload stored on `FileSummary`. It never parses source with
 * another parser, opens files, runs subprocesses or walks directories.
 *
 * Batch 3 adds the bounded literal families (identifier literals, test
 * observations, fixture references, process observations). `api-client-calls`
 * stays out of scope.
 */

import { createHash } from 'node:crypto'

import { declarationNodeId } from './declarationIdentity.js'
import {
  SOURCE_AUDIT_CAPABILITIES,
  SOURCE_AUDIT_CAPABILITY_STATUSES,
  SOURCE_AUDIT_EXPORT_ORIGINS,
  SOURCE_AUDIT_EXTRACTION_METHODS,
  SOURCE_AUDIT_IMPORT_RESOLUTIONS,
  AUDIT_LITERAL_MAX_CHARS,
  type SourceAuditObservationKind,
  SOURCE_AUDIT_VISIBILITIES,
  type SourceAuditCapability,
  type SourceAuditCapabilityStatus,
  type SourceAuditFact,
  type SourceAuditFactKind,
  type SourceAuditFile,
  type SourceAuditSpan,
} from './auditEvidenceTypes.js'
import type { ExtractionResult } from './symbolExtractor.js'

export interface SourceAuditExtractionPayload {
  jvmPackageName?: string
  facts: SourceAuditFact[]
  capabilities: Record<SourceAuditCapability, SourceAuditCapabilityStatus>
  diagnostics: SourceAuditFile['diagnostics']
}

/** Capabilities a Batch 2 language producer may report as anything other than `unsupported`. */
export const BATCH2_AUDIT_CAPABILITIES = ['declarations', 'imports', 'exports', 'source-ranges'] as const

export const MAX_AUDIT_DIAGNOSTICS = 24
const MAX_NAME_CHARS = 512
const MAX_SPECIFIER_CHARS = 1024
const MAX_IMPORTED_NAMES = 128
const MAX_MESSAGE_CHARS = 240
/** Capabilities a producer may report beyond `unsupported`. api-client-calls is Batch 6. */
export const AUDIT_PRODUCER_CAPABILITIES = [
  ...BATCH2_AUDIT_CAPABILITIES,
  'jvmDeclarations',
  'identifier-literals',
  'test-observations',
  'fixture-references',
  'process-observations',
] as const

type ProducedKind = 'declaration' | 'import' | 'export' | 'identifier-literal' | 'test-observation' | 'fixture-reference' | 'process-observation'
const PRODUCED_KINDS: readonly SourceAuditFactKind[] = ['declaration', 'import', 'export', 'identifier-literal', 'test-observation', 'fixture-reference', 'process-observation']
const KIND_CAPABILITY: Record<ProducedKind, SourceAuditCapability> = {
  declaration: 'declarations',
  import: 'imports',
  export: 'exports',
  'identifier-literal': 'identifier-literals',
  'test-observation': 'test-observations',
  'fixture-reference': 'fixture-references',
  'process-observation': 'process-observations',
}
const LITERAL_FIELDS: readonly (keyof SourceAuditFact)[] = ['name', 'observationKind', 'value', 'valueSha256', 'valueTruncated', 'owningSymbolId']
/** Observation kinds each literal-family fact kind may carry; no other vocabulary exists. */
const OBSERVATION_KINDS: Record<'identifier-literal' | 'test-observation' | 'fixture-reference' | 'process-observation', readonly SourceAuditObservationKind[]> = {
  'identifier-literal': ['registry-id'],
  'test-observation': ['test-title', 'test-modifier-skip', 'test-modifier-only', 'embedded-test-command'],
  'fixture-reference': ['fixture-basename'],
  'process-observation': ['process-invocation', 'process-option', 'newline-split', 'path-separator-split'],
}
/** Kinds whose value is mandatory (the observed literal itself). */
const VALUE_REQUIRED = new Set<SourceAuditFactKind>(['identifier-literal', 'fixture-reference'])

/**
 * Bounds an exact observed literal. At most AUDIT_LITERAL_MAX_CHARS characters keep the exact value;
 * longer literals expose no prefix: value null, SHA-256 of the exact original, valueTruncated true.
 */
export function boundedAuditLiteral(raw: string): Pick<SourceAuditFact, 'value' | 'valueSha256' | 'valueTruncated'> {
  if (raw.length <= AUDIT_LITERAL_MAX_CHARS) return { value: raw }
  return { value: null, valueSha256: createHash('sha256').update(raw, 'utf8').digest('hex'), valueTruncated: true }
}

const ALLOWED_FIELDS: Record<ProducedKind, readonly (keyof SourceAuditFact)[]> = {
  'identifier-literal': LITERAL_FIELDS,
  'test-observation': LITERAL_FIELDS,
  'fixture-reference': LITERAL_FIELDS,
  'process-observation': LITERAL_FIELDS,
  declaration: ['name', 'symbolId', 'declarationKind', 'ownerKey', 'visibility', 'exported', 'exportOrigin', 'owningSymbolId', 'jvmDeclaration'],
  import: ['name', 'sourceSpecifier', 'importedNames', 'importResolution', 'targetPaths', 'owningSymbolId', 'jvmImportTarget'],
  export: ['name', 'symbolId', 'visibility', 'exported', 'exportOrigin', 'sourceSpecifier', 'owningSymbolId'],
}

/** Capability map with every key set to one status. */
export function auditCapabilityMap(status: SourceAuditCapabilityStatus): Record<SourceAuditCapability, SourceAuditCapabilityStatus> {
  const capabilities = {} as Record<SourceAuditCapability, SourceAuditCapabilityStatus>
  for (const capability of SOURCE_AUDIT_CAPABILITIES) capabilities[capability] = status
  return capabilities
}

/** Payload for a producer that could not establish any Batch 2 capability. */
export function failedAuditPayload(code: string, message: string): SourceAuditExtractionPayload {
  const capabilities = auditCapabilityMap('unsupported')
  for (const capability of BATCH2_AUDIT_CAPABILITIES) capabilities[capability] = 'failed'
  return { facts: [], capabilities, diagnostics: [{ code, message: message.slice(0, MAX_MESSAGE_CHARS), span: null }] }
}

/** Deterministic artifact-wide fact identity: no timestamps, output paths, random values or absolute paths. */
export function auditFactId(path: string, kind: SourceAuditFactKind, line: number, column: number | null, ordinal: number): string {
  return `audit-fact:${encodeURIComponent(path)}#${encodeURIComponent(kind)}#${line}#${column === null ? 'u' : column}#${ordinal}`
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function isInt(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

interface Counters {
  dropped: Map<string, number>
  adjusted: Map<string, number>
  downgraded: Set<SourceAuditCapability>
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function normalizeSpan(span: unknown, filePath: string, lines: readonly string[], counters: Counters): SourceAuditSpan | null {
  if (typeof span !== 'object' || span === null) return null
  const raw = span as Partial<SourceAuditSpan>
  if (raw.path !== filePath) return null
  if (!isInt(raw.startLine, 1) || raw.startLine > lines.length) return null
  const startLine = raw.startLine
  const lineLength = (line: number): number => (lines[line - 1] ?? '').replace(/\r$/, '').length
  let startColumn: number | null = null
  if (raw.startColumn !== null && raw.startColumn !== undefined) {
    if (isInt(raw.startColumn, 0) && raw.startColumn <= lineLength(startLine)) startColumn = raw.startColumn
    else bump(counters.adjusted, 'start-column-discarded')
  }
  let endLine: number | null = null
  let endColumn: number | null = null
  if (raw.endLine !== null && raw.endLine !== undefined) {
    if (isInt(raw.endLine, startLine) && raw.endLine <= lines.length) {
      endLine = raw.endLine
      if (raw.endColumn !== null && raw.endColumn !== undefined) {
        const sameLineBefore = endLine === startLine && startColumn !== null && (raw.endColumn as number) < startColumn
        if (isInt(raw.endColumn, 0) && raw.endColumn <= lineLength(endLine) && !sameLineBefore) endColumn = raw.endColumn
        else bump(counters.adjusted, 'end-column-discarded')
      }
    } else {
      bump(counters.adjusted, 'end-range-discarded')
    }
  }
  return { path: filePath, startLine, startColumn, endLine, endColumn }
}

interface Pending {
  fact: SourceAuditFact
  index: number
}

function matchSymbol(fact: SourceAuditFact, extraction: ExtractionResult): { nodeId: string; ownerKey: string | null } | 'none' | 'ambiguous' {
  let matches = extraction.symbols.filter(
    (symbol) => symbol.name === fact.name && symbol.location.line === fact.span.startLine && (fact.declarationKind === undefined || symbol.kind === fact.declarationKind),
  )
  if (matches.length > 1 && fact.ownerKey !== undefined) {
    matches = matches.filter((symbol) => (symbol.ownerKey ?? null) === (fact.ownerKey ?? null))
  }
  if (matches.length === 0) return 'none'
  if (matches.length > 1) return 'ambiguous'
  const symbol = matches[0]!
  return { nodeId: declarationNodeId(fact.span.path, symbol), ownerKey: symbol.ownerKey ?? null }
}

/**
 * Normalizes language-produced audit facts. Pure: consumes only the supplied
 * path, source text and existing extraction result.
 */
export function extractAuditObservations(filePath: string, sourceText: string, extraction: ExtractionResult): SourceAuditExtractionPayload {
  const raw = extraction.sourceAudit
  if (!raw) {
    return {
      facts: [],
      capabilities: auditCapabilityMap('unsupported'),
      diagnostics: [{ code: 'source-audit-evidence-unavailable', message: 'The language adapter produced no source-audit evidence for this file.', span: null }],
    }
  }

  const lines = sourceText.split('\n')
  const counters: Counters = { dropped: new Map(), adjusted: new Map(), downgraded: new Set() }
  const capabilities = auditCapabilityMap('unsupported')
  for (const capability of AUDIT_PRODUCER_CAPABILITIES) {
    const status = raw.capabilities?.[capability]
    capabilities[capability] = isOneOf(status, SOURCE_AUDIT_CAPABILITY_STATUSES) ? status : 'unsupported'
  }

  const pending: Pending[] = []
  const droppedKinds = new Set<SourceAuditCapability>()
  const drop = (reason: string, kind: unknown): void => {
    bump(counters.dropped, reason)
    if (isOneOf(kind, PRODUCED_KINDS)) droppedKinds.add(KIND_CAPABILITY[kind as ProducedKind])
    droppedKinds.add('source-ranges')
  }

  ;(raw.facts ?? []).forEach((candidate, index) => {
    if (typeof candidate !== 'object' || candidate === null) return drop('malformed-fact', undefined)
    const kind = candidate.kind
    if (!isOneOf(kind, PRODUCED_KINDS)) return drop('unsupported-fact-kind', undefined)
    if (!isOneOf(candidate.extractionMethod, SOURCE_AUDIT_EXTRACTION_METHODS)) return drop('invalid-extraction-method', kind)
    const span = normalizeSpan(candidate.span, filePath, lines, counters)
    if (!span) return drop('invalid-span', kind)

    const fact: SourceAuditFact = { id: '', kind, span, extractionMethod: candidate.extractionMethod }
    for (const key of ALLOWED_FIELDS[kind as ProducedKind]) {
      const value = candidate[key]
      if (value !== undefined) (fact as unknown as Record<string, unknown>)[key] = value
    }

    if (fact.name !== undefined && (typeof fact.name !== 'string' || fact.name.length === 0 || fact.name.length > MAX_NAME_CHARS)) {
      return drop('invalid-name', kind)
    }
    if (fact.visibility !== undefined && !isOneOf(fact.visibility, SOURCE_AUDIT_VISIBILITIES)) return drop('invalid-visibility', kind)
    if (fact.exportOrigin !== undefined && !isOneOf(fact.exportOrigin, SOURCE_AUDIT_EXPORT_ORIGINS)) return drop('invalid-export-origin', kind)
    if (fact.sourceSpecifier !== undefined && (typeof fact.sourceSpecifier !== 'string' || fact.sourceSpecifier.length === 0 || fact.sourceSpecifier.length > MAX_SPECIFIER_CHARS)) {
      return drop('invalid-specifier', kind)
    }
    if (fact.importedNames !== undefined) {
      if (!Array.isArray(fact.importedNames)) return drop('invalid-imported-names', kind)
      const names = fact.importedNames.filter((name) => typeof name === 'string' && name.length > 0 && name.length <= MAX_NAME_CHARS)
      if (names.length !== fact.importedNames.length || names.length > MAX_IMPORTED_NAMES) {
        bump(counters.adjusted, 'imported-names-truncated')
        counters.downgraded.add('imports')
      }
      fact.importedNames = names.slice(0, MAX_IMPORTED_NAMES)
    }
    // Local resolution is derived later from the selected inventory; producers never assert it.
    delete fact.targetPaths

    if (kind === 'declaration') {
      if (!fact.name || !fact.declarationKind) return drop('incomplete-declaration', kind)
      if (!fact.symbolId) {
        const match = matchSymbol(fact, extraction)
        if (match === 'none' || match === 'ambiguous') return drop(match === 'none' ? 'declaration-without-symbol' : 'ambiguous-declaration-symbol', kind)
        fact.symbolId = match.nodeId
        if (fact.ownerKey === undefined) fact.ownerKey = match.ownerKey
      } else if (fact.ownerKey === undefined) {
        fact.ownerKey = null
      }
    } else if (kind === 'import') {
      if (!fact.sourceSpecifier) return drop('incomplete-import', kind)
      if (!isOneOf(fact.importResolution, SOURCE_AUDIT_IMPORT_RESOLUTIONS) || fact.importResolution === 'resolved-local') fact.importResolution = 'observed'
    } else if (kind === 'export') {
      if (!fact.name) return drop('incomplete-export', kind)
      if (!fact.exportOrigin) fact.exportOrigin = 'unknown'
      if (fact.symbolId === '' || fact.symbolId === undefined) {
        delete fact.symbolId
        const match = matchSymbol({ ...fact, declarationKind: undefined }, extraction)
        if (match !== 'none' && match !== 'ambiguous') fact.symbolId = match.nodeId
      }
    }
    else {
      // Literal families: observation kind must belong to the fact kind; the producer supplies only the exact raw value.
      const allowedKinds = OBSERVATION_KINDS[kind as keyof typeof OBSERVATION_KINDS]
      if (!isOneOf(fact.observationKind, allowedKinds)) return drop('invalid-observation-kind', kind)
      const rawValue = candidate.value
      delete fact.value
      delete fact.valueSha256
      delete fact.valueTruncated
      if (rawValue !== undefined) {
        // null or non-string input is never an established literal; an oversized one is hashed by this owner.
        if (typeof rawValue !== 'string') return drop('invalid-literal-value', kind)
        Object.assign(fact, boundedAuditLiteral(rawValue))
      } else if (VALUE_REQUIRED.has(kind)) {
        return drop('missing-literal-value', kind)
      }
    }
    pending.push({ fact, index })
  })

  // Deterministic ordering: ordinals come from a content-based total order, never from timestamps or iteration luck.
  pending.sort((a, b) => {
    const sa = a.fact.span
    const sb = b.fact.span
    return (
      sa.startLine - sb.startLine ||
      (sa.startColumn ?? -1) - (sb.startColumn ?? -1) ||
      compareText(a.fact.kind, b.fact.kind) ||
      compareText(a.fact.name ?? '', b.fact.name ?? '') ||
      compareText(a.fact.declarationKind ?? '', b.fact.declarationKind ?? '') ||
      compareText(a.fact.sourceSpecifier ?? '', b.fact.sourceSpecifier ?? '') ||
      compareText(a.fact.observationKind ?? '', b.fact.observationKind ?? '') ||
      compareText(a.fact.value ?? '', b.fact.value ?? '') ||
      a.index - b.index
    )
  })
  const ordinals = new Map<string, number>()
  for (const { fact } of pending) {
    const key = `${fact.kind}\u0000${fact.span.startLine}\u0000${fact.span.startColumn ?? 'u'}`
    const ordinal = ordinals.get(key) ?? 0
    ordinals.set(key, ordinal + 1)
    fact.id = auditFactId(filePath, fact.kind, fact.span.startLine, fact.span.startColumn, ordinal)
  }
  const facts = pending.map((entry) => entry.fact)
  // The artifact validator orders facts by (line, column with unknown first, id).
  facts.sort(
    (a, b) =>
      a.span.startLine - b.span.startLine || (a.span.startColumn ?? -1) - (b.span.startColumn ?? -1) || compareText(a.id, b.id),
  )

  // Reconcile capability claims with the facts actually retained.
  const diagnostics: SourceAuditFile['diagnostics'] = []
  for (const entry of raw.diagnostics ?? []) {
    if (typeof entry?.code !== 'string' || entry.code.length === 0 || typeof entry.message !== 'string') continue
    const span = entry.span === null ? null : normalizeSpan(entry.span, filePath, lines, counters)
    diagnostics.push({ code: entry.code.slice(0, 64), message: entry.message.slice(0, MAX_MESSAGE_CHARS), span })
  }
  const downgrade = (capability: SourceAuditCapability): void => {
    if (capabilities[capability] === 'complete') capabilities[capability] = 'partial'
  }
  for (const capability of droppedKinds) downgrade(capability)
  if (droppedKinds.has('declarations') || counters.downgraded.has('declarations')) downgrade('jvmDeclarations')
  if (capabilities.jvmDeclarations === 'complete' && facts.some((fact) => fact.kind === 'declaration' && !fact.jvmDeclaration)) downgrade('jvmDeclarations')
  for (const capability of counters.downgraded) downgrade(capability)
  for (const kind of PRODUCED_KINDS as readonly ProducedKind[]) {
    const capability = KIND_CAPABILITY[kind]
    if (facts.some((fact) => fact.kind === kind) && capabilities[capability] !== 'complete' && capabilities[capability] !== 'partial') {
      capabilities[capability] = 'partial'
      diagnostics.push({ code: 'capability-raised-to-partial', message: `Facts of kind ${kind} exist, so ${capability} cannot be ${raw.capabilities?.[capability] ?? 'unsupported'}.`, span: null })
    }
  }
  if (capabilities['source-ranges'] === 'complete' && facts.some((fact) => fact.span.startColumn === null || fact.span.endLine === null || fact.span.endColumn === null)) {
    capabilities['source-ranges'] = 'partial'
    diagnostics.push({ code: 'source-ranges-incomplete', message: 'At least one retained fact lacks an exact start column or end range.', span: null })
  }
  for (const [reason, count] of [...counters.dropped].sort(([a], [b]) => compareText(a, b))) {
    diagnostics.push({ code: 'audit-fact-dropped', message: `${count} fact(s) dropped: ${reason}.`, span: null })
  }
  for (const [reason, count] of [...counters.adjusted].sort(([a], [b]) => compareText(a, b))) {
    diagnostics.push({ code: 'audit-span-adjusted', message: `${count} adjustment(s): ${reason}.`, span: null })
  }
  if (diagnostics.length > MAX_AUDIT_DIAGNOSTICS) {
    downgrade('jvmDeclarations')
    const kept = diagnostics.slice(0, MAX_AUDIT_DIAGNOSTICS - 1)
    kept.push({ code: 'diagnostics-truncated', message: `${diagnostics.length - kept.length} further diagnostic(s) omitted.`, span: null })
    return { facts, capabilities, diagnostics: kept, ...(typeof raw.jvmPackageName === 'string' ? { jvmPackageName: raw.jvmPackageName } : {}) }
  }
  return { facts, capabilities, diagnostics, ...(typeof raw.jvmPackageName === 'string' ? { jvmPackageName: raw.jvmPackageName } : {}) }
}
