import * as fs from 'node:fs'
import type { RetrievalRegressionMode, RetrievalRegressionSuiteConfig, RetrievalRegressionTask } from './types.js'

const VALID_MODES: RetrievalRegressionMode[] = ['general', 'feature-add', 'subsystem']
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
const CAP_KEYS = ['maxCandidateFiles', 'maxSourceSlices', 'maxGraphNodes', 'maxGraphEdges'] as const

export function loadRetrievalRegressionConfig(configPath: string): RetrievalRegressionSuiteConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Retrieval regression config not found: ${configPath}`)
  }

  const raw = fs.readFileSync(configPath, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid JSON in retrieval regression config ${configPath}: ${(error as Error).message}`)
  }

  validateRetrievalRegressionConfig(parsed, configPath)
  return parsed as RetrievalRegressionSuiteConfig
}

export function validateRetrievalRegressionConfig(value: unknown, configPath: string): asserts value is RetrievalRegressionSuiteConfig {
  const problems: string[] = []

  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid retrieval regression config ${configPath}: expected an object.`)
  }

  const config = value as Record<string, unknown>

  if (!config.schemaVersion || typeof config.schemaVersion !== 'string') {
    problems.push('schemaVersion is required and must be a string')
  }
  if (!config.suiteId || typeof config.suiteId !== 'string') {
    problems.push('suiteId is required and must be a string')
  }

  if (!Array.isArray(config.tasks)) {
    problems.push('tasks must be an array')
  } else {
    const seenIds = new Set<string>()
    config.tasks.forEach((rawTask, index) => {
      const label = `tasks[${index}]`
      const task = rawTask as Partial<RetrievalRegressionTask>

      if (!task || typeof task !== 'object') {
        problems.push(`${label} must be an object`)
        return
      }

      if (!task.id || typeof task.id !== 'string') {
        problems.push(`${label}.id is required and must be a string`)
      } else {
        if (!SAFE_ID_PATTERN.test(task.id)) {
          problems.push(`${label}.id "${task.id}" must be safe for file paths (letters, digits, hyphen, underscore only)`)
        }
        if (seenIds.has(task.id)) {
          problems.push(`Duplicate task id: "${task.id}"`)
        }
        seenIds.add(task.id)
      }

      const idLabel = task.id ? `id=${task.id}` : label

      if (task.skip) {
        if (!task.skipReason || typeof task.skipReason !== 'string') {
          problems.push(`${label} (${idLabel}) has skip:true and requires skipReason`)
        }
      } else if (!task.query || typeof task.query !== 'string') {
        const executionKind = (task.execution as { kind?: unknown } | undefined)?.kind
        if (executionKind !== 'source' && executionKind !== 'lookup' && executionKind !== 'slice') {
          problems.push(`${label} (${idLabel}) requires "query" unless skip is true`)
        }
      }

      validateExecutionAndCommandResult(task as Record<string, unknown>, label, problems)

      if (task.mode !== undefined && !VALID_MODES.includes(task.mode as RetrievalRegressionMode)) {
        problems.push(`${label}.mode "${String(task.mode)}" is invalid. Expected one of: ${VALID_MODES.join(', ')}.`)
      }

      if (task.caps !== undefined) {
        if (typeof task.caps !== 'object' || task.caps === null) {
          problems.push(`${label}.caps must be an object`)
        } else {
          for (const key of CAP_KEYS) {
            const capValue = (task.caps as Record<string, unknown>)[key]
            if (capValue === undefined) continue
            if (!Number.isInteger(capValue) || (capValue as number) <= 0) {
              problems.push(`${label}.caps.${key} must be a positive integer`)
            }
          }
        }
      }

      if (task.sourceRoots !== undefined && !Array.isArray(task.sourceRoots)) {
        problems.push(`${label}.sourceRoots must be an array`)
      }
    })
  }

  if (problems.length > 0) {
    throw new Error(`Invalid retrieval regression config ${configPath}:\n- ${problems.join('\n- ')}`)
  }
}

const EXECUTION_KINDS = ['context', 'search', 'source', 'lookup', 'slice']
const SEARCH_INTENTS = ['relevance', 'ownership']
const SEARCH_EXECUTION_KEYS = ['kind', 'intent', 'limit']
const LOOKUP_EXECUTION_KEYS = ['kind', 'node', 'androidComponent', 'depth', 'resolveClassification']
const LOOKUP_SELECTOR_KEYS = ['node', 'androidComponent']
const SLICE_EXECUTION_KEYS = [
  'kind',
  'node',
  'androidRoute',
  'androidComponent',
  'composable',
  'depth',
  'direction',
  'includeViewmodel',
  'includeNavigation',
  'includeDataFlow',
  'includeTests',
]
const SLICE_SELECTOR_KEYS = ['node', 'androidRoute', 'androidComponent', 'composable']
const SLICE_DIRECTIONS = ['both', 'incoming', 'outgoing']
const LOOKUP_STATUSES = ['found', 'ambiguous', 'not-found']
const SLICE_STATUSES = ['ok', 'ambiguous', 'not-found']
const LOOKUP_EXPECTATION_KEYS = [
  'expectedStatus',
  'expectedNodeId',
  'expectedNodeKind',
  'requiredCandidateIds',
  'forbiddenCandidateIds',
  'expectedCandidateCount',
]
const SLICE_EXPECTATION_KEYS = [
  'expectedStatus',
  'requiredNodeIds',
  'forbiddenNodeIds',
  'requiredNodeKinds',
  'requiredEdgeKinds',
  'requiredEdges',
  'forbiddenEdges',
  'connectedPaths',
  'maxNodes',
  'maxEdges',
  'requiredCandidateIds',
  'expectedCandidateCount',
  'expectedDataFlowTruncated',
  'requireAndroidTests',
]
/** Slice expectations that need an actual returned graph and so cannot accompany an ambiguous/not-found status. */
const SLICE_GRAPH_EVIDENCE_KEYS = [
  'requiredNodeIds',
  'forbiddenNodeIds',
  'requiredNodeKinds',
  'requiredEdgeKinds',
  'requiredEdges',
  'forbiddenEdges',
  'connectedPaths',
  'maxNodes',
  'maxEdges',
  'expectedDataFlowTruncated',
  'requireAndroidTests',
]
const SOURCE_EXECUTION_KEYS = ['kind', 'file', 'symbol', 'node', 'maxLines', 'continue', 'continueFrom']
const CONTINUATION_REASONS = ['symbol-end-unknown', 'max-lines-reached', 'window-capped', 'eof']
const SEARCH_COMMAND_KEYS = ['requiredResultIds', 'topK', 'required']
const SOURCE_COMMAND_KEYS = [
  'expectedMode',
  'expectedStartLine',
  'expectedEndLine',
  'expectedLineCount',
  'requiredContent',
  'forbiddenContent',
  'continuation',
  'symbolBoundaryKnown',
  'nextStartLine',
  'continuationReason',
  'required',
]
/** Expectation kinds that read the context capsule/audit and therefore only apply to context execution. */
const CONTEXT_ONLY_EXPECTATION_KEYS = [
  'candidateFiles',
  'candidateNodes',
  'focus',
  'selectedGraph',
  'sourceEvidence',
  'semanticSummary',
  'classificationSummary',
  'artifactReferences',
  'conflicts',
  'modeEffects',
  'auditSteps',
  'noRawContent',
  'caps',
  'adequacy',
]

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString)
}

function validateExecutionAndCommandResult(task: Record<string, unknown>, label: string, problems: string[]): void {
  const execution = task.execution
  let kind: 'context' | 'search' | 'source' | 'lookup' | 'slice' = 'context'
  let executionRecord: Record<string, unknown> = {}

  if (execution !== undefined) {
    if (!execution || typeof execution !== 'object' || Array.isArray(execution)) {
      problems.push(`${label}.execution must be an object`)
      return
    }
    const record = execution as Record<string, unknown>
    if (typeof record.kind !== 'string' || !EXECUTION_KINDS.includes(record.kind)) {
      problems.push(`${label}.execution.kind must be one of: ${EXECUTION_KINDS.join(', ')}`)
      return
    }
    kind = record.kind as typeof kind
    executionRecord = record

    if (kind === 'context') {
      for (const key of Object.keys(record)) {
        if (key !== 'kind') problems.push(`${label}.execution.${key} is not valid for kind "context"`)
      }
    } else if (kind === 'search') {
      for (const key of Object.keys(record)) {
        if (!SEARCH_EXECUTION_KEYS.includes(key)) problems.push(`${label}.execution.${key} is not valid for kind "search"`)
      }
      if (record.intent !== undefined && (typeof record.intent !== 'string' || !SEARCH_INTENTS.includes(record.intent))) {
        problems.push(`${label}.execution.intent must be one of: ${SEARCH_INTENTS.join(', ')}`)
      }
      if (record.limit !== undefined && !(isPositiveInteger(record.limit) && record.limit <= 100)) {
        problems.push(`${label}.execution.limit must be an integer from 1 through 100`)
      }
    } else if (kind === 'lookup') {
      validateLookupExecution(record, label, problems)
    } else if (kind === 'slice') {
      validateSliceExecution(record, label, problems)
    } else {
      for (const key of Object.keys(record)) {
        if (!SOURCE_EXECUTION_KEYS.includes(key)) problems.push(`${label}.execution.${key} is not valid for kind "source"`)
      }
      for (const key of ['file', 'symbol', 'node'] as const) {
        if (record[key] !== undefined && !isNonEmptyString(record[key])) {
          problems.push(`${label}.execution.${key} must be a non-empty string`)
        }
      }
      const hasFile = record.file !== undefined
      const hasSymbol = record.symbol !== undefined
      const hasNode = record.node !== undefined
      if (hasNode && (hasFile || hasSymbol)) {
        problems.push(`${label}.execution must use exactly one selector: node, or file with symbol`)
      } else if (!hasNode && !(hasFile && hasSymbol)) {
        problems.push(`${label}.execution must use exactly one selector: node, or file with symbol`)
      }
      if (record.maxLines !== undefined && !isPositiveInteger(record.maxLines)) {
        problems.push(`${label}.execution.maxLines must be a positive integer`)
      }
      if (record.continue !== undefined && typeof record.continue !== 'boolean') {
        problems.push(`${label}.execution.continue must be a boolean`)
      }
      if (record.continueFrom !== undefined) {
        if (!isPositiveInteger(record.continueFrom)) {
          problems.push(`${label}.execution.continueFrom must be a positive integer`)
        }
        if (!(hasFile && hasSymbol) || hasNode) {
          problems.push(`${label}.execution.continueFrom is only valid with file plus symbol`)
        }
      }
      if (record.continue === true && record.continueFrom !== undefined) {
        problems.push(`${label}.execution.continue and continueFrom are mutually exclusive`)
      }
    }
  }

  if (kind !== 'context') {
    for (const key of ['mode', 'caps', 'noSource']) {
      if (task[key] !== undefined) problems.push(`${label}.${key} is only valid for context execution`)
    }
  }

  const expectations = task.expectations
  if (expectations === undefined) return
  if (!expectations || typeof expectations !== 'object' || Array.isArray(expectations)) {
    problems.push(`${label}.expectations must be an object`)
    return
  }
  const expectationRecord = expectations as Record<string, unknown>

  if (kind !== 'context') {
    for (const key of CONTEXT_ONLY_EXPECTATION_KEYS) {
      if (expectationRecord[key] !== undefined) {
        problems.push(`${label}.expectations.${key} is only valid for context execution`)
      }
    }
  }

  const commandResult = expectationRecord.commandResult
  if (commandResult === undefined) return
  if (kind === 'context') {
    problems.push(`${label}.expectations.commandResult is only valid for search, source, lookup or slice execution`)
    return
  }
  if (!commandResult || typeof commandResult !== 'object' || Array.isArray(commandResult)) {
    problems.push(`${label}.expectations.commandResult must be an object`)
    return
  }
  const expectation = commandResult as Record<string, unknown>
  if (kind === 'lookup' || kind === 'slice') {
    validateLookupSliceCommandResult(kind, expectation, executionRecord, label, problems)
    return
  }
  const allowed = kind === 'search' ? SEARCH_COMMAND_KEYS : SOURCE_COMMAND_KEYS
  for (const key of Object.keys(expectation)) {
    if (!allowed.includes(key)) {
      problems.push(`${label}.expectations.commandResult.${key} is not valid for ${kind} execution`)
    }
  }

  if (expectation.requiredResultIds !== undefined && !isStringArray(expectation.requiredResultIds)) {
    problems.push(`${label}.expectations.commandResult.requiredResultIds must be a non-empty array of non-empty strings`)
  }
  if (expectation.topK !== undefined) {
    if (!isPositiveInteger(expectation.topK)) {
      problems.push(`${label}.expectations.commandResult.topK must be a positive integer`)
    }
    if (expectation.requiredResultIds === undefined) {
      problems.push(`${label}.expectations.commandResult.topK requires requiredResultIds`)
    }
  }
  if (expectation.expectedMode !== undefined && !isNonEmptyString(expectation.expectedMode)) {
    problems.push(`${label}.expectations.commandResult.expectedMode must be a non-empty string`)
  }
  for (const key of ['expectedStartLine', 'expectedEndLine', 'nextStartLine']) {
    if (expectation[key] !== undefined && !isPositiveInteger(expectation[key])) {
      problems.push(`${label}.expectations.commandResult.${key} must be a positive integer`)
    }
  }
  if (
    expectation.expectedLineCount !== undefined &&
    !(typeof expectation.expectedLineCount === 'number' && Number.isInteger(expectation.expectedLineCount) && expectation.expectedLineCount >= 0)
  ) {
    problems.push(`${label}.expectations.commandResult.expectedLineCount must be a non-negative integer`)
  }
  for (const key of ['requiredContent', 'forbiddenContent']) {
    if (expectation[key] !== undefined && !isStringArray(expectation[key])) {
      problems.push(`${label}.expectations.commandResult.${key} must be a non-empty array of non-empty strings`)
    }
  }
  if (expectation.continuation !== undefined && expectation.continuation !== 'present' && expectation.continuation !== 'absent') {
    problems.push(`${label}.expectations.commandResult.continuation must be "present" or "absent"`)
  }
  if (expectation.symbolBoundaryKnown !== undefined && typeof expectation.symbolBoundaryKnown !== 'boolean') {
    problems.push(`${label}.expectations.commandResult.symbolBoundaryKnown must be a boolean`)
  }
  if (
    expectation.continuationReason !== undefined &&
    !(typeof expectation.continuationReason === 'string' && CONTINUATION_REASONS.includes(expectation.continuationReason))
  ) {
    problems.push(`${label}.expectations.commandResult.continuationReason must be one of: ${CONTINUATION_REASONS.join(', ')}`)
  }
  if (expectation.required !== undefined && typeof expectation.required !== 'boolean') {
    problems.push(`${label}.expectations.commandResult.required must be a boolean`)
  }
  const cursorFieldRequested =
    expectation.symbolBoundaryKnown !== undefined ||
    expectation.nextStartLine !== undefined ||
    expectation.continuationReason !== undefined
  if (cursorFieldRequested && expectation.continuation === 'absent') {
    problems.push(`${label}.expectations.commandResult cursor fields cannot be combined with continuation "absent"`)
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function checkBooleanFields(record: Record<string, unknown>, keys: string[], prefix: string, problems: string[]): void {
  for (const key of keys) {
    if (record[key] !== undefined && typeof record[key] !== 'boolean') problems.push(`${prefix}.${key} must be a boolean`)
  }
}

function validateDepth(record: Record<string, unknown>, label: string, problems: string[]): void {
  if (record.depth !== undefined && !(isNonNegativeInteger(record.depth) && record.depth <= 3)) {
    problems.push(`${label}.execution.depth must be an integer from 0 through 3`)
  }
}

/** Requires exactly one non-empty selector; returns it, or undefined when the selector set is invalid. */
function validateSelectors(record: Record<string, unknown>, selectorKeys: string[], label: string, problems: string[]): string | undefined {
  for (const key of selectorKeys) {
    if (record[key] !== undefined && !isNonEmptyString(record[key])) {
      problems.push(`${label}.execution.${key} must be a non-empty string`)
    }
  }
  const present = selectorKeys.filter((key) => record[key] !== undefined)
  if (present.length !== 1) {
    problems.push(`${label}.execution must use exactly one selector: ${selectorKeys.join(', ')}`)
    return undefined
  }
  return present[0]
}

function validateLookupExecution(record: Record<string, unknown>, label: string, problems: string[]): void {
  for (const key of Object.keys(record)) {
    if (!LOOKUP_EXECUTION_KEYS.includes(key)) problems.push(`${label}.execution.${key} is not valid for kind "lookup"`)
  }
  const selector = validateSelectors(record, LOOKUP_SELECTOR_KEYS, label, problems)
  validateDepth(record, label, problems)
  checkBooleanFields(record, ['resolveClassification'], `${label}.execution`, problems)
  if (record.resolveClassification !== undefined && selector !== 'node') {
    problems.push(`${label}.execution.resolveClassification is only valid with node`)
  }
}

function validateSliceExecution(record: Record<string, unknown>, label: string, problems: string[]): void {
  for (const key of Object.keys(record)) {
    if (!SLICE_EXECUTION_KEYS.includes(key)) problems.push(`${label}.execution.${key} is not valid for kind "slice"`)
  }
  const selector = validateSelectors(record, SLICE_SELECTOR_KEYS, label, problems)
  validateDepth(record, label, problems)
  if (record.direction !== undefined && !(typeof record.direction === 'string' && SLICE_DIRECTIONS.includes(record.direction))) {
    problems.push(`${label}.execution.direction must be one of: ${SLICE_DIRECTIONS.join(', ')}`)
  }
  checkBooleanFields(record, ['includeViewmodel', 'includeNavigation', 'includeDataFlow', 'includeTests'], `${label}.execution`, problems)
  for (const key of ['includeViewmodel', 'includeNavigation']) {
    if (record[key] !== undefined && selector !== 'composable') {
      problems.push(`${label}.execution.${key} is only valid with composable`)
    }
  }
}

function validateEdgeList(value: unknown, field: string, problems: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    problems.push(`${field} must be a non-empty array of {source, kind, target} objects`)
    return
  }
  value.forEach((entry, index) => {
    const at = `${field}[${index}]`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`${at} must be an object with source, kind and target`)
      return
    }
    const record = entry as Record<string, unknown>
    for (const key of Object.keys(record)) {
      if (!['source', 'kind', 'target'].includes(key)) problems.push(`${at}.${key} is not valid; expected only source, kind and target`)
    }
    for (const key of ['source', 'kind', 'target']) {
      if (!isNonEmptyString(record[key])) problems.push(`${at}.${key} must be a non-empty string`)
    }
  })
}

function validateConnectedPaths(value: unknown, field: string, problems: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    problems.push(`${field} must be a non-empty array of {nodeIds, edgeKinds} objects`)
    return
  }
  value.forEach((entry, index) => {
    const at = `${field}[${index}]`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`${at} must be an object with nodeIds and edgeKinds`)
      return
    }
    const record = entry as Record<string, unknown>
    for (const key of Object.keys(record)) {
      if (!['nodeIds', 'edgeKinds'].includes(key)) problems.push(`${at}.${key} is not valid; expected only nodeIds and edgeKinds`)
    }
    const nodeIdsOk = isStringArray(record.nodeIds) && record.nodeIds.length >= 2
    const edgeKindsOk = isStringArray(record.edgeKinds)
    if (!nodeIdsOk) problems.push(`${at}.nodeIds must be an array of at least two non-empty strings`)
    if (!edgeKindsOk) problems.push(`${at}.edgeKinds must be a non-empty array of non-empty strings`)
    if (nodeIdsOk && edgeKindsOk && (record.edgeKinds as string[]).length !== (record.nodeIds as string[]).length - 1) {
      problems.push(`${at}.edgeKinds length must equal nodeIds length minus one`)
    }
  })
}

/**
 * Validates `commandResult` for `lookup`/`slice` execution: only the matching nested object (plus `required`)
 * is allowed, and field combinations are checked against the execution selector and expected status.
 */
function validateLookupSliceCommandResult(
  kind: 'lookup' | 'slice',
  commandResult: Record<string, unknown>,
  execution: Record<string, unknown>,
  label: string,
  problems: string[]
): void {
  const prefix = `${label}.expectations.commandResult`
  const other = kind === 'lookup' ? 'slice' : 'lookup'
  for (const key of Object.keys(commandResult)) {
    if (key !== kind && key !== 'required') {
      problems.push(`${prefix}.${key} is not valid for ${kind} execution (use ${prefix}.${kind})`)
    }
  }
  if (commandResult[other] !== undefined) problems.push(`${prefix}.${other} is only valid for ${other} execution`)
  if (commandResult.required !== undefined && typeof commandResult.required !== 'boolean') {
    problems.push(`${prefix}.required must be a boolean`)
  }

  const nested = commandResult[kind]
  if (nested === undefined) {
    problems.push(`${prefix}.${kind} is required for ${kind} execution`)
    return
  }
  const at = `${prefix}.${kind}`
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    problems.push(`${at} must be an object`)
    return
  }
  const expectation = nested as Record<string, unknown>
  const allowed = kind === 'lookup' ? LOOKUP_EXPECTATION_KEYS : SLICE_EXPECTATION_KEYS
  for (const key of Object.keys(expectation)) {
    if (!allowed.includes(key)) problems.push(`${at}.${key} is not valid for ${kind} expectations`)
  }
  if (Object.keys(expectation).length === 0) {
    problems.push(`${at} must not be empty`)
    return
  }

  const statuses = kind === 'lookup' ? LOOKUP_STATUSES : SLICE_STATUSES
  if (expectation.expectedStatus !== undefined && !(typeof expectation.expectedStatus === 'string' && statuses.includes(expectation.expectedStatus))) {
    problems.push(`${at}.expectedStatus must be one of: ${statuses.join(', ')}`)
  }
  const status = typeof expectation.expectedStatus === 'string' ? expectation.expectedStatus : undefined

  for (const key of ['expectedNodeId', 'expectedNodeKind']) {
    if (expectation[key] !== undefined && !isNonEmptyString(expectation[key])) problems.push(`${at}.${key} must be a non-empty string`)
  }
  for (const key of ['requiredCandidateIds', 'forbiddenCandidateIds', 'requiredNodeIds', 'forbiddenNodeIds', 'requiredNodeKinds', 'requiredEdgeKinds']) {
    if (expectation[key] !== undefined && !isStringArray(expectation[key])) {
      problems.push(`${at}.${key} must be a non-empty array of non-empty strings`)
    }
  }
  if (expectation.expectedCandidateCount !== undefined && !isNonNegativeInteger(expectation.expectedCandidateCount)) {
    problems.push(`${at}.expectedCandidateCount must be a non-negative integer`)
  }
  for (const key of ['maxNodes', 'maxEdges']) {
    if (expectation[key] !== undefined && !isPositiveInteger(expectation[key])) problems.push(`${at}.${key} must be a positive integer`)
  }
  checkBooleanFields(expectation, ['expectedDataFlowTruncated', 'requireAndroidTests'], at, problems)
  if (expectation.requireAndroidTests === false) problems.push(`${at}.requireAndroidTests must be true when present`)
  if (expectation.requiredEdges !== undefined) validateEdgeList(expectation.requiredEdges, `${at}.requiredEdges`, problems)
  if (expectation.forbiddenEdges !== undefined) validateEdgeList(expectation.forbiddenEdges, `${at}.forbiddenEdges`, problems)
  if (expectation.connectedPaths !== undefined) validateConnectedPaths(expectation.connectedPaths, `${at}.connectedPaths`, problems)

  if (kind === 'lookup') {
    if (execution.node !== undefined) {
      if (status !== undefined && status !== 'found') problems.push(`${at}.expectedStatus must be "found" for node lookup`)
      for (const key of ['requiredCandidateIds', 'forbiddenCandidateIds', 'expectedCandidateCount']) {
        if (expectation[key] !== undefined) problems.push(`${at}.${key} is only valid with androidComponent lookup`)
      }
      return
    }
    if (expectation.expectedNodeKind !== undefined) problems.push(`${at}.expectedNodeKind is only valid with node lookup`)
    if (expectation.expectedNodeId !== undefined && status !== undefined && status !== 'found') {
      problems.push(`${at}.expectedNodeId is only valid with expectedStatus "found"`)
    }
    for (const key of ['requiredCandidateIds', 'forbiddenCandidateIds', 'expectedCandidateCount']) {
      if (expectation[key] !== undefined && status !== 'ambiguous') problems.push(`${at}.${key} requires expectedStatus "ambiguous"`)
    }
    return
  }

  if (status === 'ambiguous' || status === 'not-found') {
    if (execution.node !== undefined) problems.push(`${at}.expectedStatus "${status}" is not possible with a node slice`)
    for (const key of SLICE_GRAPH_EVIDENCE_KEYS) {
      if (expectation[key] !== undefined) problems.push(`${at}.${key} requires graph evidence and cannot be combined with expectedStatus "${status}"`)
    }
  }
  for (const key of ['requiredCandidateIds', 'expectedCandidateCount']) {
    if (expectation[key] !== undefined && status !== 'ambiguous') problems.push(`${at}.${key} requires expectedStatus "ambiguous"`)
  }
  if (expectation.expectedDataFlowTruncated !== undefined && execution.includeDataFlow !== true) {
    problems.push(`${at}.expectedDataFlowTruncated requires execution.includeDataFlow true`)
  }
  if (expectation.requireAndroidTests !== undefined && execution.includeTests !== true) {
    problems.push(`${at}.requireAndroidTests requires execution.includeTests true`)
  }
}
