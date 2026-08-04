import * as fs from 'node:fs'
import * as path from 'node:path'
import { toForwardSlash } from '../io/pathUtils.js'
import {
  CONTEXT_CAPSULE_MODES,
  CONTEXT_REQUEST_SCHEMA_SUPPORTED_MAJOR,
  CONTEXT_ROLES,
  REQUESTED_EVIDENCE_KINDS,
  type ContextCapsuleLimits,
  type ContextCapsuleMode,
  type ContextRequest,
  type ContextRequestLimits,
  type ContextRole,
  type RequestedEvidenceKind,
} from './types.js'

/**
 * All deferred (not-yet-operational) ContextRequest field names, sorted.
 * A field is deferred if it was supplied and validated but is not consumed by
 * retrieval yet.
 *
 * v1.10.1 Batch 2 operationalizes focusFiles, focusSymbols, changedFiles,
 * changedSymbols, beforeIndex, afterIndex, and requestedEvidenceKinds (see
 * roleCandidates.ts/focusResolution.ts/changedSurface.ts) — they are removed
 * from this list. v1.10.1 Batch 4 operationalizes `limits` (budget/truncation
 * reporting, `contextBudget.ts`) and `testResponsibilityRefs` (responsibility
 * mapping, `responsibilityMapping.ts`) — they are removed too. Only
 * `upstreamArtifactRefs` remains deferred (grounded structured resolution of
 * upstream artifact references is out of Batch 4 scope).
 */
const DEFERRED_FIELD_NAMES = ['upstreamArtifactRefs'] as const

export interface LoadedContextRequest {
  request: ContextRequest
  sourcePath: string
}

/** Reads, parses, and structurally validates a `--request <path>` JSON file. */
export function loadContextRequestFile(requestPathInput: string): LoadedContextRequest {
  const resolvedPath = path.resolve(requestPathInput)
  const displayPath = toForwardSlash(resolvedPath)

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Missing context request file: ${displayPath}`)
  }

  let raw: string
  try {
    raw = fs.readFileSync(resolvedPath, 'utf8')
  } catch (error) {
    throw new Error(`Failed to read context request file ${displayPath}: ${(error as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid JSON in context request file ${displayPath}: ${(error as Error).message}`)
  }

  const request = validateContextRequestShape(parsed, displayPath)
  return { request, sourcePath: displayPath }
}

function validateContextRequestShape(value: unknown, displayPath: string): ContextRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid context request shape in ${displayPath}: expected a JSON object.`)
  }
  const obj = value as Record<string, unknown>

  const schemaVersion = obj.schemaVersion
  if (typeof schemaVersion !== 'string' || schemaVersion.trim() === '') {
    throw new Error(`Missing required field "schemaVersion" in context request file ${displayPath}.`)
  }
  const major = Number.parseInt(schemaVersion.split('.')[0] ?? '', 10)
  if (!Number.isInteger(major) || major !== CONTEXT_REQUEST_SCHEMA_SUPPORTED_MAJOR) {
    throw new Error(
      `Unsupported context request schema version "${schemaVersion}" in ${displayPath}: supplied major ${schemaVersion.split('.')[0] ?? schemaVersion}, supported major ${CONTEXT_REQUEST_SCHEMA_SUPPORTED_MAJOR}.`
    )
  }

  const query = obj.query
  if (typeof query !== 'string' || query.trim() === '') {
    throw new Error(`Missing required field "query" in context request file ${displayPath}.`)
  }

  const result: ContextRequest = { schemaVersion, query }

  if (obj.role !== undefined) {
    if (typeof obj.role !== 'string' || !CONTEXT_ROLES.includes(obj.role as ContextRole)) {
      throw new Error(
        `Unknown role "${String(obj.role)}" in context request file ${displayPath}. Expected one of: ${CONTEXT_ROLES.join(', ')}.`
      )
    }
    result.role = obj.role as ContextRole
  }

  if (obj.mode !== undefined) {
    if (typeof obj.mode !== 'string' || !CONTEXT_CAPSULE_MODES.includes(obj.mode as ContextCapsuleMode)) {
      throw new Error(
        `Invalid "mode" in context request file ${displayPath}: "${String(obj.mode)}". Expected one of: ${CONTEXT_CAPSULE_MODES.join(', ')}.`
      )
    }
    result.mode = obj.mode as ContextCapsuleMode
  }

  for (const field of ['index', 'root', 'beforeIndex', 'afterIndex', 'output', 'auditOutput'] as const) {
    const fieldValue = obj[field]
    if (fieldValue === undefined) continue
    if (typeof fieldValue !== 'string' || fieldValue.trim() === '') {
      throw new Error(`Invalid "${field}" in context request file ${displayPath}: expected a non-empty string.`)
    }
    result[field] = fieldValue
  }

  for (const field of [
    'focusFiles',
    'focusSymbols',
    'changedFiles',
    'changedSymbols',
    'upstreamArtifactRefs',
    'testResponsibilityRefs',
  ] as const) {
    const fieldValue = obj[field]
    if (fieldValue === undefined) continue
    result[field] = validateStringArray(fieldValue, field, displayPath)
  }

  if (obj.requestedEvidenceKinds !== undefined) {
    const kinds = validateStringArray(obj.requestedEvidenceKinds, 'requestedEvidenceKinds', displayPath)
    for (const kind of kinds) {
      if (!REQUESTED_EVIDENCE_KINDS.includes(kind as RequestedEvidenceKind)) {
        throw new Error(
          `Unknown requestedEvidenceKinds entry "${kind}" in context request file ${displayPath}. Expected one of: ${REQUESTED_EVIDENCE_KINDS.join(', ')}.`
        )
      }
    }
    result.requestedEvidenceKinds = dedupeSorted(kinds) as RequestedEvidenceKind[]
  }

  if (obj.limits !== undefined) {
    result.limits = validateLimits(obj.limits, displayPath)
  }

  if (obj.index !== undefined && obj.root !== undefined) {
    const rootImpliedIndex = path.resolve(String(obj.root), '.my-dev-kit')
    if (path.resolve(String(obj.index)) !== rootImpliedIndex) {
      throw new Error(
        `Conflicting "index" and "root" in context request file ${displayPath}: root implies index "${toForwardSlash(rootImpliedIndex)}" but index is "${toForwardSlash(path.resolve(String(obj.index)))}".`
      )
    }
  }

  // dedupe+sort collection fields for deterministic normalization. `testResponsibilityRefs`
  // is deliberately excluded (v1.10.3 Batch 3, F-004): sorting+deduping it here would
  // discard duplicate-ID and first-occurrence-order information before it ever reaches
  // `responsibilityMapping.ts`, which already has its own first-occurrence-preserving
  // dedup + duplicate-ID diagnostic (`dedupeResponsibilityInputs`) that depends on
  // seeing the caller's original sequence, duplicates included.
  for (const field of ['focusFiles', 'focusSymbols', 'changedFiles', 'changedSymbols', 'upstreamArtifactRefs'] as const) {
    const fieldValue = result[field]
    if (fieldValue) result[field] = dedupeSorted(fieldValue)
  }

  return result
}

function validateStringArray(value: unknown, field: string, displayPath: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
    throw new Error(`Invalid "${field}" in context request file ${displayPath}: expected an array of non-empty strings.`)
  }
  return value as string[]
}

function validateLimits(value: unknown, displayPath: string): ContextRequestLimits {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid "limits" in context request file ${displayPath}: expected an object.`)
  }
  const obj = value as Record<string, unknown>
  const allowedKeys = [
    'candidates',
    'graphDepth',
    'files',
    'symbols',
    'sourceRanges',
    'sourceLinesPerRange',
    'characters',
    'evidenceGroupEntries',
    'fullFileFallbacks',
    'responsibilityMappings',
  ] as const
  const result: ContextRequestLimits = {}
  for (const key of allowedKeys) {
    const fieldValue = obj[key]
    if (fieldValue === undefined) continue
    const minimum = key === 'evidenceGroupEntries' ? 1 : 0
    if (typeof fieldValue !== 'number' || !Number.isInteger(fieldValue) || fieldValue < minimum) {
      throw new Error(
        `Invalid limits.${key} in context request file ${displayPath}: expected a ${minimum === 1 ? 'positive' : 'non-negative'} integer, got ${JSON.stringify(fieldValue)}.`
      )
    }
    result[key] = fieldValue
  }
  const unknownKeys = Object.keys(obj).filter((key) => !(allowedKeys as readonly string[]).includes(key))
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown limits field(s) in context request file ${displayPath}: ${unknownKeys.sort().join(', ')}.`)
  }
  return result
}

function dedupeSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
}

export function normalizeQueryForComparison(query: string): string {
  return query.trim().replace(/\s+/g, ' ')
}

function normalizePathForComparison(value: string): string {
  return toForwardSlash(path.resolve(value))
}

/** A resolved scalar value plus how it was determined, for deterministic diagnostics. */
interface ResolvedScalar<T> {
  value: T | undefined
  source: 'cli' | 'request-file' | 'equivalent-duplicate' | 'default' | 'none'
}

function resolveScalar<T>(options: {
  field: string
  cliValue: T | undefined
  cliExplicit: boolean
  fileValue: T | undefined
  requestFilePath: string
  equivalent: (a: T, b: T) => boolean
  describe: (value: T) => string
}): ResolvedScalar<T> {
  const { field, cliValue, cliExplicit, fileValue, requestFilePath, equivalent, describe } = options

  if (fileValue === undefined) {
    return { value: cliValue, source: cliExplicit ? 'cli' : 'default' }
  }
  if (!cliExplicit) {
    return { value: fileValue, source: 'request-file' }
  }
  if (cliValue === undefined) {
    return { value: fileValue, source: 'request-file' }
  }
  if (equivalent(cliValue, fileValue)) {
    return { value: cliValue, source: 'equivalent-duplicate' }
  }
  throw new Error(
    `Conflicting ${field}: --${field} provided "${describe(cliValue)}" but the request file ${requestFilePath} provided "${describe(fileValue)}". Provide only one, or make the values equivalent.`
  )
}

export interface ContextCommandCliInput {
  query?: string
  queryExplicit: boolean
  index: string
  indexExplicit: boolean
  mode: string
  modeExplicit: boolean
  role?: string
  roleExplicit: boolean
  out?: string
  outExplicit: boolean
  auditOut?: string
  auditOutExplicit: boolean
}

export interface NormalizedContextRequest {
  query: string
  index: string
  mode: ContextCapsuleMode
  role: ContextRole | null
  out: string
  auditOut?: string
  limits: ContextCapsuleLimits
  requestFilePath: string | null
  focusFiles: string[]
  focusSymbols: string[]
  changedFiles: string[]
  changedSymbols: string[]
  upstreamArtifactRefs: string[]
  testResponsibilityRefs: string[]
  requestedEvidenceKinds: RequestedEvidenceKind[]
  requestLimits: ContextRequestLimits | null
  beforeIndex: string | null
  afterIndex: string | null
  deferredFields: string[]
  warnings: string[]
}

export function normalizeContextRequest(options: {
  cli: ContextCommandCliInput
  limits: ContextCapsuleLimits
  loaded: LoadedContextRequest | null
}): NormalizedContextRequest {
  const { cli, limits, loaded } = options
  const file = loaded?.request ?? null
  const requestFilePath = loaded?.sourcePath ?? null

  const fileIndex = file ? (file.index ?? (file.root ? path.resolve(file.root, '.my-dev-kit') : undefined)) : undefined

  const query = resolveScalar<string>({
    field: 'query',
    cliValue: cli.query,
    cliExplicit: cli.queryExplicit,
    fileValue: file?.query,
    requestFilePath: requestFilePath ?? '',
    equivalent: (a, b) => normalizeQueryForComparison(a) === normalizeQueryForComparison(b),
    describe: (v) => v,
  })

  const index = resolveScalar<string>({
    field: 'index',
    cliValue: cli.index,
    cliExplicit: cli.indexExplicit,
    fileValue: fileIndex,
    requestFilePath: requestFilePath ?? '',
    equivalent: (a, b) => normalizePathForComparison(a) === normalizePathForComparison(b),
    describe: (v) => v,
  })

  const mode = resolveScalar<string>({
    field: 'mode',
    cliValue: cli.mode,
    cliExplicit: cli.modeExplicit,
    fileValue: file?.mode,
    requestFilePath: requestFilePath ?? '',
    equivalent: (a, b) => a === b,
    describe: (v) => v,
  })

  const role = resolveScalar<string>({
    field: 'role',
    cliValue: cli.role,
    cliExplicit: cli.roleExplicit,
    fileValue: file?.role,
    requestFilePath: requestFilePath ?? '',
    equivalent: (a, b) => a === b,
    describe: (v) => v,
  })

  const out = resolveScalar<string>({
    field: 'out',
    cliValue: cli.out,
    cliExplicit: cli.outExplicit,
    fileValue: file?.output,
    requestFilePath: requestFilePath ?? '',
    equivalent: (a, b) => normalizePathForComparison(a) === normalizePathForComparison(b),
    describe: (v) => v,
  })

  const auditOut = resolveScalar<string>({
    field: 'audit-out',
    cliValue: cli.auditOut,
    cliExplicit: cli.auditOutExplicit,
    fileValue: file?.auditOutput,
    requestFilePath: requestFilePath ?? '',
    equivalent: (a, b) => normalizePathForComparison(a) === normalizePathForComparison(b),
    describe: (v) => v,
  })

  if (!query.value || query.value.trim() === '') {
    throw new Error('The context command requires --query <text> (or a "query" field in --request).')
  }
  if (!out.value) {
    throw new Error('The context command requires --out <path> (or an "output" field in --request).')
  }
  if (!CONTEXT_CAPSULE_MODES.includes(mode.value as ContextCapsuleMode)) {
    throw new Error(`Invalid --mode "${mode.value}". Expected one of: ${CONTEXT_CAPSULE_MODES.join(', ')}.`)
  }
  if (role.value !== undefined && !CONTEXT_ROLES.includes(role.value as ContextRole)) {
    throw new Error(`Invalid --role "${role.value}". Expected one of: ${CONTEXT_ROLES.join(', ')}.`)
  }

  const deferredFields: string[] = []
  const warnings: string[] = []
  if (file) {
    for (const field of DEFERRED_FIELD_NAMES) {
      if (file[field] !== undefined) {
        deferredFields.push(field)
        warnings.push(
          `Deferred field "${field}" from ${requestFilePath} was accepted and structurally validated but is not yet operational in v1.10.1 Batch 1; it does not affect retrieval.`
        )
      }
    }
  }
  deferredFields.sort((a, b) => a.localeCompare(b))

  return {
    query: query.value,
    index: index.value ?? cli.index,
    mode: mode.value as ContextCapsuleMode,
    role: (role.value as ContextRole | undefined) ?? null,
    out: out.value,
    auditOut: auditOut.value,
    limits,
    requestFilePath,
    focusFiles: file?.focusFiles ?? [],
    focusSymbols: file?.focusSymbols ?? [],
    changedFiles: file?.changedFiles ?? [],
    changedSymbols: file?.changedSymbols ?? [],
    upstreamArtifactRefs: file?.upstreamArtifactRefs ?? [],
    testResponsibilityRefs: file?.testResponsibilityRefs ?? [],
    requestedEvidenceKinds: file?.requestedEvidenceKinds ?? [],
    requestLimits: file?.limits ?? null,
    beforeIndex: file?.beforeIndex ?? null,
    afterIndex: file?.afterIndex ?? null,
    deferredFields,
    warnings,
  }
}
