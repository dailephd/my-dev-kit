/**
 * v1.15.0 Batch 0: pure structural validators for static API relationship
 * evidence and the additive graph-diff API contract-change section.
 *
 * No URL routing, source parsing, API execution or graph construction happens
 * here, and structural validity says nothing about runtime reachability or
 * authorization.
 */

import { MAX_API_CONTRACT_CHANGES } from '../graph-diff/types.js'
import type { ApiContractChangeSection } from '../graph-diff/types.js'
import { API_CLIENT_KINDS, API_HTTP_METHODS, API_RESOLUTION_STATUSES } from './apiContractTypes.js'
import type { ApiClientCallEvidence, ApiUnresolvedEvidence } from './apiContractTypes.js'

const ERROR_PREFIX = 'INVALID_API_CONTRACT_EVIDENCE'
const MAX_MESSAGE_CHARS = 240
const MAX_PATH_CHARS = 1024
const MAX_ID_CHARS = 1024
const MAX_URL_CHARS = 2048
const MAX_ARRAY_ITEMS = 1000
const REASON_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

type Obj = Record<string, unknown>

function fail(path: string, reason: string): never {
  throw new Error(`${ERROR_PREFIX}: ${path} ${reason}`.slice(0, MAX_MESSAGE_CHARS))
}

function requireObj(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'must be an object')
  return value as Obj
}

function requireClosed(obj: Obj, path: string, keys: readonly string[]): void {
  for (const key of Object.keys(obj)) {
    if (!keys.includes(key)) fail(`${path}.${key}`, 'is not an allowed field')
  }
  for (const key of keys) {
    if (!(key in obj) || obj[key] === undefined) fail(`${path}.${key}`, 'is required')
  }
}

function requireId(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_CHARS) {
    fail(path, 'must be a non-empty bounded identifier')
  }
  return value
}

function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) fail(path, 'is not an allowed value')
  return value as T
}

function requirePath(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_PATH_CHARS ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    /^[A-Za-z]:/.test(value) ||
    !value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  ) {
    fail(path, 'must be a canonical root-relative forward-slash path')
  }
  return value
}

function requireInt(value: unknown, path: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    fail(path, min === 1 ? 'must be a positive integer' : 'must be a nonnegative integer')
  }
  return value
}

function requireNullableUrl(value: unknown, path: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_CHARS) {
    fail(path, 'must be null or a non-empty bounded string')
  }
  return value
}

function requireUniqueIds(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ITEMS) fail(path, 'must be a bounded array')
  const seen = new Set<string>()
  value.forEach((item, i) => {
    const id = requireId(item, `${path}[${i}]`)
    if (seen.has(id)) fail(`${path}[${i}]`, 'is duplicated')
    seen.add(id)
  })
  return value as string[]
}

export function validateApiClientCallEvidence(value: unknown): asserts value is ApiClientCallEvidence {
  const call = requireObj(value, '$')
  requireClosed(call, '$', [
    'id',
    'filePath',
    'startLine',
    'startColumn',
    'owningSymbolId',
    'method',
    'observedUrl',
    'staticPath',
    'clientKind',
    'resolutionStatus',
    'sourceFactId',
  ])
  requireId(call.id, '$.id')
  requirePath(call.filePath, '$.filePath')
  requireInt(call.startLine, '$.startLine', 1)
  requireInt(call.startColumn, '$.startColumn', 0)
  if (call.owningSymbolId !== null) requireId(call.owningSymbolId, '$.owningSymbolId')
  const method = requireOneOf(call.method, API_HTTP_METHODS, '$.method')
  requireNullableUrl(call.observedUrl, '$.observedUrl')
  const staticPath = requireNullableUrl(call.staticPath, '$.staticPath')
  requireOneOf(call.clientKind, API_CLIENT_KINDS, '$.clientKind')
  const status = requireOneOf(call.resolutionStatus, API_RESOLUTION_STATUSES, '$.resolutionStatus')
  requireId(call.sourceFactId, '$.sourceFactId')

  if (status === 'resolved-static') {
    if (staticPath === null) fail('$.staticPath', 'is required for a resolved-static call')
    if (!staticPath.startsWith('/')) fail('$.staticPath', 'must start with "/" for a resolved-static call')
    if (method === 'UNKNOWN') fail('$.method', 'must be known for a resolved-static call')
  }
  // A dynamic call has no complete static path. An unsupported call may keep a path only when the exact
  // complete path was actually established; other statuses preserve a known exact path.
  if (status === 'dynamic' && staticPath !== null) {
    fail('$.staticPath', 'must be null for a dynamic call')
  }
}

export function validateApiUnresolvedEvidence(value: unknown): asserts value is ApiUnresolvedEvidence {
  const evidence = requireObj(value, '$')
  requireClosed(evidence, '$', ['subjectId', 'status', 'reasonCode', 'candidateNodeIds', 'sourceFactIds'])
  requireId(evidence.subjectId, '$.subjectId')
  if (evidence.status === 'resolved-static') fail('$.status', 'must describe an unresolved state')
  const status = requireOneOf(evidence.status, API_RESOLUTION_STATUSES, '$.status')
  if (typeof evidence.reasonCode !== 'string' || !REASON_CODE_PATTERN.test(evidence.reasonCode)) {
    fail('$.reasonCode', 'must be a short lowercase kebab-case code')
  }
  const candidates = requireUniqueIds(evidence.candidateNodeIds, '$.candidateNodeIds')
  requireUniqueIds(evidence.sourceFactIds, '$.sourceFactIds')
  // sourceFactIds may be empty: some unresolved observations cannot be tied to a confidently identified fact.
  // An ambiguous result may retain fewer than two candidates; no candidates are invented to satisfy a count.
  if ((status === 'dynamic' || status === 'unsupported') && candidates.length > 0) {
    fail('$.candidateNodeIds', `must be empty for a ${status} subject`)
  }
}

const CHANGE_KINDS = ['route', 'client-call', 'schema', 'data-field', 'relationship'] as const
const CHANGE_TYPES = ['added', 'removed', 'changed', 'unresolved'] as const
const CERTAINTIES = ['explicit-static', 'partial', 'unknown'] as const
const AVAILABILITIES = ['both', 'before-only', 'after-only', 'neither'] as const

function validateSourceRef(value: unknown, path: string): void {
  const ref = requireObj(value, path)
  const allowed = ['filePath', 'line', 'endLine', 'column', 'symbolId']
  for (const key of Object.keys(ref)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, 'is not an allowed field')
  }
  for (const key of ['filePath', 'line', 'endLine']) {
    if (ref[key] === undefined) fail(`${path}.${key}`, 'is required')
  }
  requirePath(ref.filePath, `${path}.filePath`)
  const line = requireInt(ref.line, `${path}.line`, 1)
  const endLine = requireInt(ref.endLine, `${path}.endLine`, 1)
  if (endLine < line) fail(`${path}.endLine`, 'must not precede line')
  if (ref.column !== undefined && ref.column !== null) requireInt(ref.column, `${path}.column`, 0)
  if (ref.symbolId !== undefined && ref.symbolId !== null) requireId(ref.symbolId, `${path}.symbolId`)
}

/**
 * Validates an ApiContractChangeSection. Not enumerated by the frozen
 * contract text but required so the contract-change fixtures are exercised by
 * real validator code; it only checks structure, counts and the result cap.
 */
export function validateApiContractChangeSection(value: unknown): asserts value is ApiContractChangeSection {
  const section = requireObj(value, '$')
  requireClosed(section, '$', [
    'available',
    'complete',
    'totalChanges',
    'returnedChanges',
    'omittedChanges',
    'changes',
    'warnings',
  ])
  const available = requireOneOf(section.available, AVAILABILITIES, '$.available')
  if (typeof section.complete !== 'boolean') fail('$.complete', 'must be a boolean')
  const total = requireInt(section.totalChanges, '$.totalChanges', 0)
  const returned = requireInt(section.returnedChanges, '$.returnedChanges', 0)
  const omitted = requireInt(section.omittedChanges, '$.omittedChanges', 0)
  if (!Array.isArray(section.changes)) fail('$.changes', 'must be an array')
  if (section.changes.length > MAX_API_CONTRACT_CHANGES) {
    fail('$.changes', `must not exceed ${MAX_API_CONTRACT_CHANGES} entries`)
  }
  if (returned !== section.changes.length) fail('$.returnedChanges', 'must equal the number of changes')
  if (returned > total) fail('$.returnedChanges', 'must not exceed totalChanges')
  if (omitted !== total - returned) fail('$.omittedChanges', 'must equal totalChanges minus returnedChanges')
  if (section.complete && (omitted !== 0 || available !== 'both')) {
    fail('$.complete', 'cannot be true with omitted changes or one-sided artifacts')
  }
  if (!Array.isArray(section.warnings) || section.warnings.some((w) => typeof w !== 'string')) {
    fail('$.warnings', 'must be an array of strings')
  }
  section.changes.forEach((entry: unknown, i: number) => {
    const path = `$.changes[${i}]`
    const change = requireObj(entry, path)
    requireClosed(change, path, ['kind', 'change', 'subjectId', 'affectedNodeIds', 'sourceRefs', 'certainty'])
    requireOneOf(change.kind, CHANGE_KINDS, `${path}.kind`)
    const type = requireOneOf(change.change, CHANGE_TYPES, `${path}.change`)
    requireId(change.subjectId, `${path}.subjectId`)
    requireUniqueIds(change.affectedNodeIds, `${path}.affectedNodeIds`)
    if (!Array.isArray(change.sourceRefs)) fail(`${path}.sourceRefs`, 'must be an array')
    change.sourceRefs.forEach((ref: unknown, j: number) => validateSourceRef(ref, `${path}.sourceRefs[${j}]`))
    const certainty = requireOneOf(change.certainty, CERTAINTIES, `${path}.certainty`)
    if (type === 'unresolved' && certainty === 'explicit-static') {
      fail(`${path}.certainty`, 'cannot be explicit-static for an unresolved change')
    }
  })
}
