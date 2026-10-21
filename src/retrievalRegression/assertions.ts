import * as fs from 'node:fs'
import type { ContextCapsule, RetrievalAuditRecord } from '../context/types.js'
import type {
  AdequacyExpectation,
  ArtifactReferenceExpectation,
  AssertionKind,
  AssertionResult,
  AssertionSeverity,
  AuditStepExpectation,
  CandidateFileExpectation,
  CandidateNodeExpectation,
  CapComplianceExpectation,
  ClassificationSummaryExpectation,
  CommandResultExpectation,
  ConflictExpectation,
  FocusExpectation,
  LookupResultExpectation,
  ModeEffectExpectation,
  NoRawContentExpectation,
  RetrievalRegressionExpectation,
  SelectedGraphExpectation,
  SemanticSummaryExpectation,
  SliceResultExpectation,
  SourceEvidenceExpectation,
  TaskAssertionSummary,
} from './types.js'

export interface ReadJsonResult<T> {
  value: T | null
  error?: string
}

export function readJsonFile<T>(filePath: string | undefined): ReadJsonResult<T> {
  if (!filePath) return { value: null, error: 'artifact path was not provided' }
  if (!fs.existsSync(filePath)) return { value: null, error: `artifact file not found: ${filePath}` }
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return { value: JSON.parse(raw) as T }
  } catch (error) {
    return { value: null, error: `failed to read/parse artifact: ${(error as Error).message}` }
  }
}

export interface AssertionEvidence {
  capsule: ContextCapsule | null
  capsulePath?: string
  capsuleReadError?: string
  audit: RetrievalAuditRecord | null
  auditPath?: string
  auditReadError?: string
  /** Parsed machine-readable stdout of a `search`/`source` execution task. */
  commandResult?: unknown | null
  commandResultPath?: string
  commandResultReadError?: string
}

export function loadAssertionEvidence(options: {
  capsulePath?: string
  auditPath?: string
  commandResultPath?: string
}): AssertionEvidence {
  const capsuleRead = readJsonFile<ContextCapsule>(options.capsulePath)
  const auditRead = readJsonFile<RetrievalAuditRecord>(options.auditPath)
  const commandRead = options.commandResultPath ? readJsonFile<unknown>(options.commandResultPath) : undefined
  return {
    ...(commandRead
      ? {
          commandResult: commandRead.value,
          commandResultPath: options.commandResultPath,
          commandResultReadError: commandRead.error,
        }
      : {}),
    capsule: capsuleRead.value,
    capsulePath: options.capsulePath,
    capsuleReadError: capsuleRead.error,
    audit: auditRead.value,
    auditPath: options.auditPath,
    auditReadError: auditRead.error,
  }
}

function makeResult(options: {
  taskId: string
  kind: AssertionKind
  index: number
  status: AssertionResult['status']
  severity: AssertionSeverity
  message: string
  expectedSummary: string
  actualSummary: string
  evidencePath?: string
  details?: Record<string, unknown>
}): AssertionResult {
  const { taskId, kind, index } = options
  return {
    assertionId: `${taskId}::${kind}[${index}]`,
    kind,
    status: options.status,
    severity: options.severity,
    taskId,
    message: options.message,
    expectedSummary: options.expectedSummary,
    actualSummary: options.actualSummary,
    evidencePath: options.evidencePath,
    details: options.details,
  }
}

function blockedForMissingCapsule(taskId: string, kind: AssertionKind, index: number, evidence: AssertionEvidence): AssertionResult {
  return makeResult({
    taskId,
    kind,
    index,
    status: 'blocked',
    severity: 'required',
    message: `Cannot evaluate ${kind} assertion: context capsule evidence is missing or unreadable.`,
    expectedSummary: 'a readable context-capsule.json',
    actualSummary: evidence.capsuleReadError ?? 'capsule unavailable',
    evidencePath: evidence.capsulePath,
  })
}

function blockedForMissingAudit(taskId: string, kind: AssertionKind, index: number, evidence: AssertionEvidence): AssertionResult {
  return makeResult({
    taskId,
    kind,
    index,
    status: 'blocked',
    severity: 'required',
    message: `Cannot evaluate ${kind} assertion: retrieval audit record evidence is missing or unreadable.`,
    expectedSummary: 'a readable retrieval-audit-record.json',
    actualSummary: evidence.auditReadError ?? 'audit record unavailable',
    evidencePath: evidence.auditPath,
  })
}

// --- Candidate files -------------------------------------------------------

function evaluateCandidateFiles(taskId: string, expectations: CandidateFileExpectation[], evidence: AssertionEvidence): AssertionResult[] {
  const kind: AssertionKind = 'candidateFile'
  if (!evidence.capsule) return expectations.map((_, i) => blockedForMissingCapsule(taskId, kind, i, evidence))

  const candidates = evidence.capsule.candidateFiles ?? []
  return expectations.map((expectation, index) => {
    const required = expectation.required ?? true
    const severity: AssertionSeverity = required ? 'required' : 'warning'
    const topK = expectation.topK ?? candidates.length

    const matchIndex = candidates.findIndex((candidate, rank) => {
      if (rank >= topK) return false
      if (expectation.path && candidate.path !== expectation.path) return false
      if (expectation.pathContains && !candidate.path.includes(expectation.pathContains)) return false
      return Boolean(expectation.path || expectation.pathContains)
    })

    const expectedSummary = describeExpectation(expectation, ['path', 'pathContains', 'topK'])
    const actualSummary =
      matchIndex >= 0
        ? `matched at rank ${matchIndex + 1} (path=${candidates[matchIndex].path})`
        : `no candidate file matched within top ${topK} of ${candidates.length}`

    return makeResult({
      taskId,
      kind,
      index,
      status: matchIndex >= 0 ? 'pass' : 'fail',
      severity,
      message:
        matchIndex >= 0
          ? 'Expected candidate file found within topK.'
          : 'Expected candidate file was not found within topK.',
      expectedSummary,
      actualSummary,
      evidencePath: evidence.capsulePath,
    })
  })
}

// --- Candidate nodes ---------------------------------------------------------

function evaluateCandidateNodes(taskId: string, expectations: CandidateNodeExpectation[], evidence: AssertionEvidence): AssertionResult[] {
  const kind: AssertionKind = 'candidateNode'
  if (!evidence.capsule) return expectations.map((_, i) => blockedForMissingCapsule(taskId, kind, i, evidence))

  const candidates = evidence.capsule.candidateNodes ?? []
  return expectations.map((expectation, index) => {
    const required = expectation.required ?? true
    const severity: AssertionSeverity = required ? 'required' : 'warning'
    const topK = expectation.topK ?? candidates.length

    const matchIndex = candidates.findIndex((candidate, rank) => {
      if (rank >= topK) return false
      if (expectation.nodeId) return candidate.nodeId === expectation.nodeId
      if (expectation.nodeIdContains && !candidate.nodeId.includes(expectation.nodeIdContains)) return false
      if (expectation.symbol && candidate.label !== expectation.symbol) return false
      if (expectation.path && candidate.filePath !== expectation.path) return false
      if (expectation.pathContains && !(candidate.filePath ?? '').includes(expectation.pathContains)) return false
      return Boolean(
        expectation.nodeIdContains || expectation.symbol || expectation.path || expectation.pathContains
      )
    })

    const expectedSummary = describeExpectation(expectation, ['nodeId', 'nodeIdContains', 'symbol', 'path', 'pathContains', 'topK'])
    const actualSummary =
      matchIndex >= 0
        ? `matched at rank ${matchIndex + 1} (nodeId=${candidates[matchIndex].nodeId})`
        : `no candidate node matched within top ${topK} of ${candidates.length}`

    return makeResult({
      taskId,
      kind,
      index,
      status: matchIndex >= 0 ? 'pass' : 'fail',
      severity,
      message:
        matchIndex >= 0
          ? 'Expected candidate node found within topK.'
          : 'Expected candidate node was not found within topK.',
      expectedSummary,
      actualSummary,
      evidencePath: evidence.capsulePath,
    })
  })
}

// --- Focus -------------------------------------------------------------------

function evaluateFocus(taskId: string, expectation: FocusExpectation, evidence: AssertionEvidence): AssertionResult[] {
  const kind: AssertionKind = 'focus'
  if (!evidence.capsule) return [blockedForMissingCapsule(taskId, kind, 0, evidence)]

  const required = expectation.required ?? true
  const severity: AssertionSeverity = required ? 'required' : 'warning'
  const focus = evidence.capsule.focus
  const hasFocus = Boolean(focus.focusNodeId)

  if (!hasFocus) {
    const status = expectation.allowNoFocus ? 'pass' : 'fail'
    return [
      makeResult({
        taskId,
        kind,
        index: 0,
        status,
        severity,
        message: expectation.allowNoFocus ? 'No focus selected, which is allowed.' : 'No focus was selected but a focus was required.',
        expectedSummary: describeExpectation(expectation, ['nodeId', 'nodeIdContains', 'symbol', 'path', 'pathContains', 'allowNoFocus']),
        actualSummary: 'no focus selected',
        evidencePath: evidence.capsulePath,
      }),
    ]
  }

  const matchesExpectation =
    !expectation.nodeId && !expectation.nodeIdContains && !expectation.symbol && !expectation.path && !expectation.pathContains
      ? true
      : Boolean(
          (expectation.nodeId && focus.focusNodeId === expectation.nodeId) ||
            (expectation.nodeIdContains && focus.focusNodeId?.includes(expectation.nodeIdContains)) ||
            (expectation.symbol && focus.focusNodeId?.includes(expectation.symbol)) ||
            (expectation.path && focus.focusFilePath === expectation.path) ||
            (expectation.pathContains && focus.focusFilePath?.includes(expectation.pathContains))
        )

  return [
    makeResult({
      taskId,
      kind,
      index: 0,
      status: matchesExpectation ? 'pass' : 'fail',
      severity,
      message: matchesExpectation ? 'Focus matched expectation.' : 'Focus did not match expectation.',
      expectedSummary: describeExpectation(expectation, ['nodeId', 'nodeIdContains', 'symbol', 'path', 'pathContains', 'allowNoFocus']),
      actualSummary: `focusNodeId=${focus.focusNodeId ?? 'null'}, focusFilePath=${focus.focusFilePath ?? 'null'}, confidence=${focus.confidence}`,
      evidencePath: evidence.capsulePath,
    }),
  ]
}

// --- Selected graph ------------------------------------------------------------

function evaluateSelectedGraph(taskId: string, expectation: SelectedGraphExpectation, evidence: AssertionEvidence): AssertionResult[] {
  const kind: AssertionKind = 'selectedGraph'
  if (!evidence.capsule) return [blockedForMissingCapsule(taskId, kind, 0, evidence)]

  const required = expectation.required ?? true
  const severity: AssertionSeverity = required ? 'required' : 'warning'
  const graph = evidence.capsule.selectedGraph
  const nodeIds = graph.nodes.map((n) => n.nodeId)
  const filePaths = graph.nodes.map((n) => n.filePath).filter((p): p is string => Boolean(p))
  const edgeKinds = graph.edges.map((e) => e.kind)

  const problems: string[] = []

  for (const id of expectation.requiredNodeIds ?? []) {
    if (!nodeIds.includes(id)) problems.push(`missing required node id "${id}"`)
  }
  for (const fragment of expectation.requiredNodeIdContains ?? []) {
    if (!nodeIds.some((id) => id.includes(fragment))) problems.push(`missing node id containing "${fragment}"`)
  }
  for (const file of expectation.requiredFiles ?? []) {
    if (!filePaths.includes(file)) problems.push(`missing required file "${file}"`)
  }
  for (const fragment of expectation.requiredFileContains ?? []) {
    if (!filePaths.some((p) => p.includes(fragment))) problems.push(`missing file containing "${fragment}"`)
  }
  for (const edgeKind of expectation.requiredEdgeKinds ?? []) {
    if (!edgeKinds.includes(edgeKind)) problems.push(`missing required edge kind "${edgeKind}"`)
  }
  for (const file of expectation.forbiddenFiles ?? []) {
    if (filePaths.includes(file)) problems.push(`forbidden file "${file}" is present`)
  }
  for (const fragment of expectation.forbiddenFileContains ?? []) {
    if (filePaths.some((p) => p.includes(fragment))) problems.push(`forbidden file fragment "${fragment}" is present`)
  }
  if (expectation.maxNodes !== undefined && graph.nodes.length > expectation.maxNodes) {
    problems.push(`node count ${graph.nodes.length} exceeds max ${expectation.maxNodes}`)
  }
  if (expectation.maxEdges !== undefined && graph.edges.length > expectation.maxEdges) {
    problems.push(`edge count ${graph.edges.length} exceeds max ${expectation.maxEdges}`)
  }

  return [
    makeResult({
      taskId,
      kind,
      index: 0,
      status: problems.length === 0 ? 'pass' : 'fail',
      severity,
      message: problems.length === 0 ? 'Selected graph evidence satisfied expectations.' : problems.join('; '),
      expectedSummary: describeExpectation(expectation, [
        'requiredNodeIds',
        'requiredNodeIdContains',
        'requiredFiles',
        'requiredFileContains',
        'requiredEdgeKinds',
        'forbiddenFiles',
        'forbiddenFileContains',
        'maxNodes',
        'maxEdges',
      ]),
      actualSummary: `observed ${graph.nodes.length} node(s), ${graph.edges.length} edge(s)`,
      evidencePath: evidence.capsulePath,
    }),
  ]
}

// --- Source evidence -------------------------------------------------------------

function evaluateSourceEvidence(taskId: string, expectation: SourceEvidenceExpectation, evidence: AssertionEvidence): AssertionResult[] {
  const kind: AssertionKind = 'sourceEvidence'
  if (!evidence.capsule) return [blockedForMissingCapsule(taskId, kind, 0, evidence)]

  const required = expectation.required ?? true
  const severity: AssertionSeverity = required ? 'required' : 'warning'
  const slices = evidence.capsule.selectedSource.slices
  const filePaths = slices.map((s) => s.filePath)

  const problems: string[] = []

  if (expectation.noSourceExpected) {
    if (slices.length > 0) problems.push(`expected no source evidence but found ${slices.length} slice(s)`)
  } else {
    for (const file of expectation.requiredFiles ?? []) {
      if (!filePaths.includes(file)) problems.push(`missing required source file "${file}"`)
    }
    for (const fragment of expectation.requiredFileContains ?? []) {
      if (!filePaths.some((p) => p.includes(fragment))) problems.push(`missing source file containing "${fragment}"`)
    }
    if (expectation.minSlices !== undefined && slices.length < expectation.minSlices) {
      problems.push(`slice count ${slices.length} is below minimum ${expectation.minSlices}`)
    }
  }

  for (const file of expectation.forbiddenFiles ?? []) {
    if (filePaths.includes(file)) problems.push(`forbidden source file "${file}" is present`)
  }
  for (const fragment of expectation.forbiddenFileContains ?? []) {
    if (filePaths.some((p) => p.includes(fragment))) problems.push(`forbidden source file fragment "${fragment}" is present`)
  }
  if (expectation.maxSlices !== undefined && slices.length > expectation.maxSlices) {
    problems.push(`slice count ${slices.length} exceeds max ${expectation.maxSlices}`)
  }

  return [
    makeResult({
      taskId,
      kind,
      index: 0,
      status: problems.length === 0 ? 'pass' : 'fail',
      severity,
      message: problems.length === 0 ? 'Source evidence satisfied expectations.' : problems.join('; '),
      expectedSummary: describeExpectation(expectation, [
        'requiredFiles',
        'requiredFileContains',
        'forbiddenFiles',
        'forbiddenFileContains',
        'minSlices',
        'maxSlices',
        'noSourceExpected',
      ]),
      actualSummary: `observed ${slices.length} source slice(s)`,
      evidencePath: evidence.capsulePath,
    }),
  ]
}

// --- Semantic summary --------------------------------------------------------------

function evaluateSemanticSummary(taskId: string, expectation: SemanticSummaryExpectation, evidence: AssertionEvidence): AssertionResult[] {
  const kind: AssertionKind = 'semanticSummary'
  if (!evidence.capsule) return [blockedForMissingCapsule(taskId, kind, 0, evidence)]

  const required = expectation.required ?? true
  const severity: AssertionSeverity = required ? 'required' : 'warning'
  const summary = evidence.capsule.semanticSummary

  if (!summary.available) {
    const status = expectation.allowUnavailable ? 'pass' : required ? 'fail' : 'pass'
    return [
      makeResult({
        taskId,
        kind,
        index: 0,
        status,
        severity,
        message: expectation.allowUnavailable
          ? 'Semantic summary unavailable, which is allowed.'
          : 'Semantic summary unavailable but was required.',
        expectedSummary: describeExpectation(expectation, ['requiredRoles', 'requiredArtifactKinds', 'requiredArtifactPathContains', 'allowUnavailable']),
        actualSummary: 'available=false',
        evidencePath: evidence.capsulePath,
      }),
    ]
  }

  const problems: string[] = []
  const roles = summary.roles.map((r) => r.role)
  for (const role of expectation.requiredRoles ?? []) {
    if (!roles.includes(role as (typeof roles)[number])) problems.push(`missing required semantic role "${role}"`)
  }
  const artifactKinds = summary.artifactRefs.map((r) => r.artifactKind)
  for (const artifactKind of expectation.requiredArtifactKinds ?? []) {
    if (!artifactKinds.includes(artifactKind as (typeof artifactKinds)[number])) problems.push(`missing required artifact kind "${artifactKind}"`)
  }
  const artifactPaths = summary.artifactRefs.map((r) => r.path).filter((p): p is string => Boolean(p))
  for (const fragment of expectation.requiredArtifactPathContains ?? []) {
    if (!artifactPaths.some((p) => p.includes(fragment))) problems.push(`missing artifact path containing "${fragment}"`)
  }

  return [
    makeResult({
      taskId,
      kind,
      index: 0,
      status: problems.length === 0 ? 'pass' : 'fail',
      severity,
      message: problems.length === 0 ? 'Semantic summary satisfied expectations.' : problems.join('; '),
      expectedSummary: describeExpectation(expectation, ['requiredRoles', 'requiredArtifactKinds', 'requiredArtifactPathContains', 'allowUnavailable']),
      actualSummary: `roles=[${roles.join(', ')}]`,
      evidencePath: evidence.capsulePath,
    }),
  ]
}

// --- Classification summary --------------------------------------------------------------

function evaluateClassificationSummary(
  taskId: string,
  expectation: ClassificationSummaryExpectation,
  evidence: AssertionEvidence
): AssertionResult[] {
  const kind: AssertionKind = 'classificationSummary'
  if (!evidence.capsule) return [blockedForMissingCapsule(taskId, kind, 0, evidence)]

  const required = expectation.required ?? true
  const severity: AssertionSeverity = required ? 'required' : 'warning'
  const summary = evidence.capsule.classificationSummary

  if (!summary.available) {
    const status = expectation.allowUnavailable ? 'pass' : required ? 'fail' : 'pass'
    return [
      makeResult({
        taskId,
        kind,
        index: 0,
        status,
        severity,
        message: expectation.allowUnavailable
          ? 'Classification summary unavailable, which is allowed.'
          : 'Classification summary unavailable but was required.',
        expectedSummary: describeExpectation(expectation, ['requiredCategories', 'requiredEditGuidance', 'requiredRiskLabels', 'allowUnavailable']),
        actualSummary: 'available=false',
        evidencePath: evidence.capsulePath,
      }),
    ]
  }

  const problems: string[] = []
  const categories = summary.roles.map((r) => r.role)
  for (const category of expectation.requiredCategories ?? []) {
    if (!categories.includes(category as (typeof categories)[number])) problems.push(`missing required classification category "${category}"`)
  }
  for (const guidance of expectation.requiredEditGuidance ?? []) {
    if (!summary.editGuidance.includes(guidance as (typeof summary.editGuidance)[number])) {
      problems.push(`missing required edit guidance "${guidance}"`)
    }
  }
  for (const risk of expectation.requiredRiskLabels ?? []) {
    if (!summary.riskLabels.includes(risk as (typeof summary.riskLabels)[number])) problems.push(`missing required risk label "${risk}"`)
  }

  return [
    makeResult({
      taskId,
      kind,
      index: 0,
      status: problems.length === 0 ? 'pass' : 'fail',
      severity,
      message: problems.length === 0 ? 'Classification summary satisfied expectations.' : problems.join('; '),
      expectedSummary: describeExpectation(expectation, ['requiredCategories', 'requiredEditGuidance', 'requiredRiskLabels', 'allowUnavailable']),
      actualSummary: `categories=[${categories.join(', ')}], editGuidance=[${summary.editGuidance.join(', ')}]`,
      evidencePath: evidence.capsulePath,
    }),
  ]
}

// --- Artifact references --------------------------------------------------------------

function evaluateArtifactReferences(taskId: string, expectation: ArtifactReferenceExpectation, evidence: AssertionEvidence): AssertionResult[] {
  const kind: AssertionKind = 'artifactReferences'
  if (!evidence.capsule) return [blockedForMissingCapsule(taskId, kind, 0, evidence)]

  const required = expectation.required ?? true
  const severity: AssertionSeverity = required ? 'required' : 'warning'
  const refs = evidence.capsule.artifactReferenceSummary
  const availableRefs = refs.filter((r) => r.available)

  if (availableRefs.length === 0 && !expectation.allowUnavailable) {
    return [
      makeResult({
        taskId,
        kind,
        index: 0,
        status: 'fail',
        severity,
        message: 'No available artifact references found but at least one was required.',
        expectedSummary: describeExpectation(expectation, ['requiredKinds', 'requiredPathContains', 'allowUnavailable']),
        actualSummary: 'no available artifact references',
        evidencePath: evidence.capsulePath,
      }),
    ]
  }

  const problems: string[] = []
  const kinds = availableRefs.map((r) => r.artifactKind)
  for (const requiredKind of expectation.requiredKinds ?? []) {
    if (!kinds.includes(requiredKind)) problems.push(`missing required artifact kind "${requiredKind}"`)
  }
  const paths = availableRefs.map((r) => r.artifactPath).filter((p): p is string => Boolean(p))
  for (const fragment of expectation.requiredPathContains ?? []) {
    if (!paths.some((p) => p.includes(fragment))) problems.push(`missing artifact path containing "${fragment}"`)
  }

  return [
    makeResult({
      taskId,
      kind,
      index: 0,
      status: problems.length === 0 ? 'pass' : 'fail',
      severity,
      message: problems.length === 0 ? 'Artifact reference summary satisfied expectations.' : problems.join('; '),
      expectedSummary: describeExpectation(expectation, ['requiredKinds', 'requiredPathContains', 'allowUnavailable']),
      actualSummary: `available kinds=[${kinds.join(', ')}]`,
      evidencePath: evidence.capsulePath,
    }),
  ]
}

// --- Conflicts --------------------------------------------------------------

function evaluateConflicts(taskId: string, expectation: ConflictExpectation, evidence: AssertionEvidence): AssertionResult[] {
  const kind: AssertionKind = 'conflicts'
  if (!evidence.capsule) return [blockedForMissingCapsule(taskId, kind, 0, evidence)]

  const required = expectation.required ?? true
  const severity: AssertionSeverity = required ? 'required' : 'warning'
  const conflicts = evidence.capsule.conflicts

  const problems: string[] = []
  if (expectation.expectedStatus && conflicts.status !== expectation.expectedStatus) {
    problems.push(`expected status "${expectation.expectedStatus}" but observed "${conflicts.status}"`)
  }
  if (expectation.expectedCount !== undefined && conflicts.conflicts.length !== expectation.expectedCount) {
    problems.push(`expected conflict count ${expectation.expectedCount} but observed ${conflicts.conflicts.length}`)
  }
  if (expectation.allowNone === false && conflicts.status === 'none') {
    problems.push('conflict was expected but none was present')
  }
  if (expectation.allowNone === true && conflicts.status !== 'none' && !expectation.expectedStatus) {
    problems.push(`expected no conflicts but observed status "${conflicts.status}"`)
  }
  for (const type of expectation.requiredTypes ?? []) {
    if (!conflicts.conflicts.some((c) => c.status === type)) problems.push(`missing required conflict type "${type}"`)
  }

  return [
    makeResult({
      taskId,
      kind,
      index: 0,
      status: problems.length === 0 ? 'pass' : 'fail',
      severity,
      message: problems.length === 0 ? 'Conflict evidence satisfied expectations.' : problems.join('; '),
      expectedSummary: describeExpectation(expectation, ['expectedStatus', 'expectedCount', 'requiredTypes', 'allowNone']),
      actualSummary: `status=${conflicts.status}, count=${conflicts.conflicts.length}`,
      evidencePath: evidence.capsulePath,
    }),
  ]
}

// --- Mode effects --------------------------------------------------------------

function evaluateModeEffects(taskId: string, expectation: ModeEffectExpectation, evidence: AssertionEvidence): AssertionResult[] {
  const kind: AssertionKind = 'modeEffects'
  if (!evidence.capsule) return [blockedForMissingCapsule(taskId, kind, 0, evidence)]

  const required = expectation.required ?? true
  const severity: AssertionSeverity = required ? 'required' : 'warning'
  const modeEffects = evidence.capsule.modeEffects

  const problems: string[] = []
  if (expectation.expectedMode && modeEffects.mode !== expectation.expectedMode) {
    problems.push(`expected mode "${expectation.expectedMode}" but observed "${modeEffects.mode}"`)
  }
  if (expectation.requireModeEffect && modeEffects.effects.length === 0) {
    problems.push('expected at least one mode effect but observed none')
  }
  for (const effectKind of expectation.requiredEffectKinds ?? []) {
    if (!modeEffects.effects.some((e) => e.reasons.some((r) => r.includes(effectKind)))) {
      problems.push(`missing required mode effect kind "${effectKind}"`)
    }
  }

  return [
    makeResult({
      taskId,
      kind,
      index: 0,
      status: problems.length === 0 ? 'pass' : 'fail',
      severity,
      message: problems.length === 0 ? 'Mode effect evidence satisfied expectations.' : problems.join('; '),
      expectedSummary: describeExpectation(expectation, ['expectedMode', 'requireModeEffect', 'requiredEffectKinds']),
      actualSummary: `mode=${modeEffects.mode}, effectCount=${modeEffects.effects.length}`,
      evidencePath: evidence.capsulePath,
    }),
  ]
}

// --- Audit steps --------------------------------------------------------------

function evaluateAuditSteps(taskId: string, expectation: AuditStepExpectation, evidence: AssertionEvidence): AssertionResult[] {
  const kind: AssertionKind = 'auditSteps'
  const uniquenessKind: AssertionKind = 'auditStepUniqueness'
  if (!evidence.audit) {
    return [blockedForMissingAudit(taskId, kind, 0, evidence), blockedForMissingAudit(taskId, uniquenessKind, 1, evidence)]
  }

  const required = expectation.required ?? true
  const severity: AssertionSeverity = required ? 'required' : 'warning'
  const steps = evidence.audit.steps
  const stepIds = steps.map((s) => s.id)

  const problems: string[] = []
  for (const id of expectation.requiredStepIds ?? []) {
    if (!stepIds.includes(id)) problems.push(`missing required step id "${id}"`)
  }
  for (const id of expectation.forbiddenStepIds ?? []) {
    if (stepIds.includes(id)) problems.push(`forbidden step id "${id}" is present`)
  }
  if (expectation.requiredOrderedStepIds && expectation.requiredOrderedStepIds.length > 0) {
    const indices = expectation.requiredOrderedStepIds.map((id) => stepIds.indexOf(id))
    if (indices.some((i) => i === -1)) {
      problems.push('one or more ordered step ids were missing')
    } else {
      for (let i = 1; i < indices.length; i++) {
        if (indices[i] < indices[i - 1]) {
          problems.push('required ordered step ids were out of order')
          break
        }
      }
    }
  }
  if (expectation.expectedStepCount !== undefined && steps.length !== expectation.expectedStepCount) {
    problems.push(`expected exactly ${expectation.expectedStepCount} step(s) but observed ${steps.length}`)
  }
  if (expectation.minStepCount !== undefined && steps.length < expectation.minStepCount) {
    problems.push(`step count ${steps.length} is below minimum ${expectation.minStepCount}`)
  }
  if (expectation.maxStepCount !== undefined && steps.length > expectation.maxStepCount) {
    problems.push(`step count ${steps.length} exceeds max ${expectation.maxStepCount}`)
  }

  const results: AssertionResult[] = [
    makeResult({
      taskId,
      kind,
      index: 0,
      status: problems.length === 0 ? 'pass' : 'fail',
      severity,
      message: problems.length === 0 ? 'Audit step evidence satisfied expectations.' : problems.join('; '),
      expectedSummary: describeExpectation(expectation, [
        'requiredStepIds',
        'requiredOrderedStepIds',
        'expectedStepCount',
        'minStepCount',
        'maxStepCount',
        'forbiddenStepIds',
      ]),
      actualSummary: `observed ${steps.length} step(s)`,
      evidencePath: evidence.auditPath,
    }),
  ]

  if (expectation.requireUniqueStepIds) {
    const duplicates = stepIds.filter((id, i) => stepIds.indexOf(id) !== i)
    const uniqueDuplicates = Array.from(new Set(duplicates))
    results.push(
      makeResult({
        taskId,
        kind: uniquenessKind,
        index: 1,
        status: uniqueDuplicates.length === 0 ? 'pass' : 'fail',
        severity,
        message: uniqueDuplicates.length === 0 ? 'All audit step ids are unique.' : `duplicate step id(s): ${uniqueDuplicates.join(', ')}`,
        expectedSummary: 'all audit step ids are unique',
        actualSummary: `${stepIds.length} step id(s), ${uniqueDuplicates.length} duplicate(s)`,
        evidencePath: evidence.auditPath,
      })
    )
  }

  return results
}

// --- No raw content --------------------------------------------------------------

const DEFAULT_FORBIDDEN_KEYS = ['sourceText', 'rawLines', 'rawSource', 'rawGraph', 'rawCapsule', 'rawAudit']

function evaluateNoRawContent(taskId: string, expectation: NoRawContentExpectation, evidence: AssertionEvidence): AssertionResult[] {
  const kind: AssertionKind = 'noRawContent'
  if (!expectation.enabled) return []

  const forbiddenKeys = expectation.forbiddenKeys ?? DEFAULT_FORBIDDEN_KEYS
  const forbiddenPatterns = (expectation.forbiddenPatterns ?? []).map((p) => new RegExp(p))

  const problems: string[] = []
  const checkText = (label: string, text: string | undefined) => {
    if (!text) return
    for (const key of forbiddenKeys) {
      if (text.includes(`"${key}"`)) problems.push(`${label} contains forbidden key "${key}"`)
    }
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(text)) problems.push(`${label} matched a forbidden pattern`)
    }
  }

  const capsuleText = evidence.capsule ? JSON.stringify(evidence.capsule) : undefined
  const auditText = evidence.audit ? JSON.stringify(evidence.audit) : undefined
  checkText('context capsule', capsuleText)
  checkText('retrieval audit record', auditText)

  return [
    makeResult({
      taskId,
      kind,
      index: 0,
      status: problems.length === 0 ? 'pass' : 'fail',
      severity: 'required',
      message: problems.length === 0 ? 'No forbidden raw content indicators found.' : 'Forbidden raw content indicator(s) found.',
      expectedSummary: `no occurrences of forbidden keys [${forbiddenKeys.join(', ')}] or patterns`,
      actualSummary: problems.length === 0 ? 'none found' : `${problems.length} indicator(s) found`,
      evidencePath: evidence.capsulePath,
    }),
  ]
}

// --- Cap compliance --------------------------------------------------------------

function evaluateCapCompliance(taskId: string, expectation: CapComplianceExpectation, evidence: AssertionEvidence): AssertionResult[] {
  const kind: AssertionKind = 'capCompliance'
  if (!evidence.capsule) return [blockedForMissingCapsule(taskId, kind, 0, evidence)]

  const capsule = evidence.capsule
  const problems: string[] = []
  const observed = {
    candidateFiles: capsule.candidateFiles.length,
    candidateNodes: capsule.candidateNodes.length,
    sourceSlices: capsule.selectedSource.slices.length,
    graphNodes: capsule.selectedGraph.nodes.length,
    graphEdges: capsule.selectedGraph.edges.length,
  }

  if (expectation.maxCandidateFiles !== undefined && observed.candidateFiles > expectation.maxCandidateFiles) {
    problems.push(`candidateFiles ${observed.candidateFiles} exceeds max ${expectation.maxCandidateFiles}`)
  }
  if (expectation.maxCandidateNodes !== undefined && observed.candidateNodes > expectation.maxCandidateNodes) {
    problems.push(`candidateNodes ${observed.candidateNodes} exceeds max ${expectation.maxCandidateNodes}`)
  }
  if (expectation.maxSourceSlices !== undefined && observed.sourceSlices > expectation.maxSourceSlices) {
    problems.push(`sourceSlices ${observed.sourceSlices} exceeds max ${expectation.maxSourceSlices}`)
  }
  if (expectation.maxGraphNodes !== undefined && observed.graphNodes > expectation.maxGraphNodes) {
    problems.push(`graphNodes ${observed.graphNodes} exceeds max ${expectation.maxGraphNodes}`)
  }
  if (expectation.maxGraphEdges !== undefined && observed.graphEdges > expectation.maxGraphEdges) {
    problems.push(`graphEdges ${observed.graphEdges} exceeds max ${expectation.maxGraphEdges}`)
  }

  return [
    makeResult({
      taskId,
      kind,
      index: 0,
      status: problems.length === 0 ? 'pass' : 'fail',
      severity: 'required',
      message: problems.length === 0 ? 'Observed counts are within configured caps.' : problems.join('; '),
      expectedSummary: describeExpectation(expectation, ['maxCandidateFiles', 'maxCandidateNodes', 'maxSourceSlices', 'maxGraphNodes', 'maxGraphEdges']),
      actualSummary: `candidateFiles=${observed.candidateFiles}, candidateNodes=${observed.candidateNodes}, sourceSlices=${observed.sourceSlices}, graphNodes=${observed.graphNodes}, graphEdges=${observed.graphEdges}`,
      evidencePath: evidence.capsulePath,
    }),
  ]
}

// --- Adequacy --------------------------------------------------------------

function evaluateAdequacy(taskId: string, expectation: AdequacyExpectation, evidence: AssertionEvidence): AssertionResult[] {
  const kind: AssertionKind = 'adequacy'
  if (!evidence.capsule) return [blockedForMissingCapsule(taskId, kind, 0, evidence)]

  const required = expectation.required ?? true
  const severity: AssertionSeverity = required ? 'required' : 'warning'
  const declaredRole = evidence.capsule.request?.role
  if (declaredRole && (!evidence.capsule.roleAdequacy || evidence.capsule.roleAdequacy.role !== declaredRole)) {
    return [makeResult({ taskId, kind, index: 0, status: 'blocked', severity, message: 'Declared context role has no matching role-adequacy evidence.', expectedSummary: `role=${declaredRole}`, actualSummary: 'role adequacy missing or mismatched', evidencePath: evidence.capsulePath })]
  }
  const adequacy = declaredRole ? evidence.capsule.roleAdequacy : evidence.capsule.contextAdequacy
  const status = adequacy.status

  const problems: string[] = []
  if (expectation.expectedStatus && status !== expectation.expectedStatus) {
    problems.push(`expected adequacy status "${expectation.expectedStatus}" but observed "${status}"`)
  }
  if (expectation.allowedStatuses && expectation.allowedStatuses.length > 0 && !expectation.allowedStatuses.includes(status)) {
    problems.push(`adequacy status "${status}" is not one of the allowed statuses [${expectation.allowedStatuses.join(', ')}]`)
  }
  const isInsufficient = status === 'context insufficient and more retrieval required'
  const isConflict = status === 'context conflict found and user or upstream stage decision required'
  const isAssumptions = status === 'context sufficient with listed assumptions'
  if (isInsufficient && expectation.allowInsufficient === false) problems.push('adequacy status indicates insufficient context, which is not allowed')
  if (isConflict && expectation.allowConflict === false) problems.push('adequacy status indicates conflict, which is not allowed')
  if (isAssumptions && expectation.allowAssumptions === false) problems.push('adequacy status indicates assumptions, which is not allowed')

  return [
    makeResult({
      taskId,
      kind,
      index: 0,
      status: problems.length === 0 ? 'pass' : 'fail',
      severity,
      message: problems.length === 0 ? 'Context adequacy satisfied expectations.' : problems.join('; '),
      expectedSummary: describeExpectation(expectation, ['expectedStatus', 'allowedStatuses', 'allowAssumptions', 'allowConflict', 'allowInsufficient']),
      actualSummary: `status=${status}`,
      evidencePath: evidence.capsulePath,
    }),
  ]
}

// --- Command result (search / source execution tasks) ------------------------------

function evaluateCommandResult(taskId: string, expectation: CommandResultExpectation, evidence: AssertionEvidence): AssertionResult[] {
  const kind: AssertionKind = 'commandResult'
  const severity: AssertionSeverity = (expectation.required ?? true) ? 'required' : 'warning'
  const expectedSummary = describeExpectation(expectation, [
    'requiredResultIds',
    'topK',
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
  ])

  const result = evidence.commandResult
  if (result === undefined || result === null || typeof result !== 'object' || Array.isArray(result)) {
    return [
      makeResult({
        taskId,
        kind,
        index: 0,
        status: 'blocked',
        severity: 'required',
        message: 'Cannot evaluate commandResult assertion: command JSON result is missing or unreadable.',
        expectedSummary: 'a readable command JSON result',
        actualSummary: evidence.commandResultReadError ?? 'command result unavailable',
        evidencePath: evidence.commandResultPath,
      }),
    ]
  }

  const json = result as Record<string, unknown>

  if (expectation.lookup !== undefined || expectation.slice !== undefined) {
    const nested = expectation.lookup ?? expectation.slice!
    const outcome = expectation.lookup !== undefined ? evaluateLookupExpectation(expectation.lookup, json) : evaluateSliceExpectation(expectation.slice!, json)
    const nestedSummary = describeExpectation(nested, Object.keys(nested) as Array<keyof typeof nested>)
    return [buildCommandAssertion(taskId, severity, nestedSummary, outcome, evidence)]
  }

  const problems: string[] = []
  const blocked: string[] = []
  const observed: string[] = []

  if (expectation.requiredResultIds !== undefined) {
    if (!Array.isArray(json.results)) {
      blocked.push('search result JSON has no "results" array')
    } else {
      const ids = (json.results as Array<{ id?: unknown }>).map((entry) => (typeof entry?.id === 'string' ? entry.id : ''))
      const window = expectation.topK !== undefined ? ids.slice(0, expectation.topK) : ids
      observed.push(`resultIds=${JSON.stringify(window)}`)
      for (const id of expectation.requiredResultIds) {
        if (!window.includes(id)) {
          problems.push(`required result id "${id}" not found${expectation.topK !== undefined ? ` in top ${expectation.topK}` : ''}`)
        }
      }
    }
  }

  const sourceFieldsRequested =
    expectation.expectedMode !== undefined ||
    expectation.expectedStartLine !== undefined ||
    expectation.expectedEndLine !== undefined ||
    expectation.expectedLineCount !== undefined ||
    expectation.requiredContent !== undefined ||
    expectation.forbiddenContent !== undefined ||
    expectation.continuation !== undefined ||
    expectation.symbolBoundaryKnown !== undefined ||
    expectation.nextStartLine !== undefined ||
    expectation.continuationReason !== undefined

  if (sourceFieldsRequested) {
    if (typeof json.content !== 'string') {
      blocked.push('source result JSON has no string "content"')
    } else {
      const compare = (label: string, expected: unknown, actual: unknown): void => {
        if (expected === undefined) return
        observed.push(`${label}=${JSON.stringify(actual)}`)
        if (actual !== expected) problems.push(`expected ${label} ${JSON.stringify(expected)} but observed ${JSON.stringify(actual)}`)
      }
      compare('mode', expectation.expectedMode, json.mode)
      compare('startLine', expectation.expectedStartLine, json.startLine)
      compare('endLine', expectation.expectedEndLine, json.endLine)
      compare('lineCount', expectation.expectedLineCount, json.lineCount)

      for (const needle of expectation.requiredContent ?? []) {
        if (!json.content.includes(needle)) problems.push(`required content ${JSON.stringify(needle)} not found`)
      }
      for (const needle of expectation.forbiddenContent ?? []) {
        if (json.content.includes(needle)) problems.push(`forbidden content ${JSON.stringify(needle)} was returned`)
      }

      const cursor =
        json.continuationCursor && typeof json.continuationCursor === 'object'
          ? (json.continuationCursor as Record<string, unknown>)
          : null
      observed.push(`continuation=${cursor ? 'present' : 'absent'}`)
      if (expectation.continuation !== undefined && expectation.continuation !== (cursor ? 'present' : 'absent')) {
        problems.push(`expected continuation ${expectation.continuation} but cursor was ${cursor ? 'present' : 'absent'}`)
      }
      const cursorFields: Array<[string, unknown, unknown]> = [
        ['symbolBoundaryKnown', expectation.symbolBoundaryKnown, cursor?.symbolBoundaryKnown],
        ['nextStartLine', expectation.nextStartLine, cursor?.nextStartLine],
        ['continuationReason', expectation.continuationReason, cursor?.reason],
      ]
      for (const [label, expected, actual] of cursorFields) {
        if (expected === undefined) continue
        if (!cursor) {
          problems.push(`expected ${label} ${JSON.stringify(expected)} but no continuation cursor was returned`)
        } else if (actual !== expected) {
          problems.push(`expected ${label} ${JSON.stringify(expected)} but observed ${JSON.stringify(actual)}`)
        } else {
          observed.push(`${label}=${JSON.stringify(actual)}`)
        }
      }
    }
  }

  if (blocked.length > 0) {
    return [
      makeResult({
        taskId,
        kind,
        index: 0,
        status: 'blocked',
        severity: 'required',
        message: `Cannot evaluate commandResult assertion: ${blocked.join('; ')}.`,
        expectedSummary,
        actualSummary: 'result shape unavailable for the requested fields',
        evidencePath: evidence.commandResultPath,
      }),
    ]
  }

  return [
    makeResult({
      taskId,
      kind,
      index: 0,
      status: problems.length === 0 ? 'pass' : 'fail',
      severity,
      message: problems.length === 0 ? 'Command result satisfied expectations.' : problems.join('; '),
      expectedSummary,
      actualSummary: observed.length > 0 ? observed.join(', ') : 'no observable fields',
      evidencePath: evidence.commandResultPath,
    }),
  ]
}

// --- Lookup / slice command results ------------------------------------------------

interface CommandEvaluation {
  problems: string[]
  blocked: string[]
  observed: string[]
}

function buildCommandAssertion(
  taskId: string,
  severity: AssertionSeverity,
  expectedSummary: string,
  outcome: CommandEvaluation,
  evidence: AssertionEvidence
): AssertionResult {
  if (outcome.blocked.length > 0) {
    return makeResult({
      taskId,
      kind: 'commandResult',
      index: 0,
      status: 'blocked',
      severity: 'required',
      message: `Cannot evaluate commandResult assertion: ${outcome.blocked.join('; ')}.`,
      expectedSummary,
      actualSummary: 'result shape unavailable for the requested fields',
      evidencePath: evidence.commandResultPath,
    })
  }
  return makeResult({
    taskId,
    kind: 'commandResult',
    index: 0,
    status: outcome.problems.length === 0 ? 'pass' : 'fail',
    severity,
    message: outcome.problems.length === 0 ? 'Command result satisfied expectations.' : outcome.problems.join('; '),
    expectedSummary,
    actualSummary: outcome.observed.length > 0 ? outcome.observed.join(', ') : 'no observable fields',
    evidencePath: evidence.commandResultPath,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Reads `candidates[].graphNodeId` from an Android selector response; undefined when malformed. */
function readCandidateIds(candidates: unknown): string[] | undefined {
  if (!Array.isArray(candidates)) return undefined
  const ids: string[] = []
  for (const candidate of candidates) {
    if (!isRecord(candidate) || typeof candidate.graphNodeId !== 'string' || candidate.graphNodeId.length === 0) return undefined
    ids.push(candidate.graphNodeId)
  }
  return ids
}

function checkCandidateExpectations(
  expectation: { requiredCandidateIds?: string[]; forbiddenCandidateIds?: string[]; expectedCandidateCount?: number },
  candidateIds: string[],
  problems: string[],
  observed: string[]
): void {
  observed.push(`candidateCount=${candidateIds.length}`)
  if (expectation.requiredCandidateIds !== undefined || expectation.forbiddenCandidateIds !== undefined) {
    observed.push(`candidateIds=${JSON.stringify(candidateIds)}`)
  }
  for (const id of expectation.requiredCandidateIds ?? []) {
    if (!candidateIds.includes(id)) problems.push(`required candidate "${id}" not found`)
  }
  for (const id of expectation.forbiddenCandidateIds ?? []) {
    if (candidateIds.includes(id)) problems.push(`forbidden candidate "${id}" was returned`)
  }
  if (expectation.expectedCandidateCount !== undefined && expectation.expectedCandidateCount !== candidateIds.length) {
    problems.push(`expected ${expectation.expectedCandidateCount} candidate(s) but observed ${candidateIds.length}`)
  }
}

const ANDROID_LOOKUP_KIND = 'my-dev-kit-v1-android-component-lookup-result'
const ANDROID_LOOKUP_STATUSES = ['found', 'ambiguous', 'not-found']

function evaluateLookupExpectation(expectation: LookupResultExpectation, json: Record<string, unknown>): CommandEvaluation {
  const evaluation: CommandEvaluation = { problems: [], blocked: [], observed: [] }
  const { problems, blocked, observed } = evaluation

  const genericNode = isRecord(json.node) ? json.node : undefined
  const isAndroid = json.artifactKind === ANDROID_LOOKUP_KIND

  let status: string
  let nodeId: string | undefined
  let nodeKind: string | undefined
  let candidateIds: string[] | undefined

  if (isAndroid) {
    if (typeof json.status !== 'string' || !ANDROID_LOOKUP_STATUSES.includes(json.status)) {
      blocked.push('Android lookup result has no valid "status"')
      return evaluation
    }
    status = json.status
    candidateIds = readCandidateIds(json.candidates)
    if (candidateIds === undefined) {
      blocked.push('Android lookup result has no valid "candidates" array')
      return evaluation
    }
    const detail = json.detail
    if (status === 'found') {
      if (!isRecord(detail) || typeof detail.graphNodeId !== 'string') {
        blocked.push('Android lookup "found" result has no detail.graphNodeId')
        return evaluation
      }
      nodeId = detail.graphNodeId
    } else if (detail !== null && detail !== undefined) {
      blocked.push(`Android lookup "${status}" result unexpectedly carries a selected detail`)
      return evaluation
    }
    if (status === 'not-found' && candidateIds.length > 0) {
      blocked.push('Android lookup "not-found" result unexpectedly carries candidates')
      return evaluation
    }
    if (status === 'ambiguous' && candidateIds.length < 2) {
      blocked.push('Android lookup "ambiguous" result has fewer than two candidates')
      return evaluation
    }
  } else if (genericNode && json.status === 'found' && typeof genericNode.id === 'string' && typeof genericNode.kind === 'string') {
    status = 'found'
    nodeId = genericNode.id
    nodeKind = genericNode.kind
  } else {
    blocked.push('lookup result is neither a generic node lookup (status "found" with node.id/node.kind) nor an Android component lookup')
    return evaluation
  }

  observed.push(`status=${JSON.stringify(status)}`)
  if (nodeId !== undefined) observed.push(`nodeId=${JSON.stringify(nodeId)}`)
  if (nodeKind !== undefined) observed.push(`nodeKind=${JSON.stringify(nodeKind)}`)

  if (expectation.expectedStatus !== undefined && expectation.expectedStatus !== status) {
    problems.push(`expected status ${JSON.stringify(expectation.expectedStatus)} but observed ${JSON.stringify(status)}`)
  }
  if (expectation.expectedNodeId !== undefined) {
    if (nodeId === undefined) problems.push(`expected node "${expectation.expectedNodeId}" but no node was selected (status ${status})`)
    else if (nodeId !== expectation.expectedNodeId) problems.push(`expected node "${expectation.expectedNodeId}" but observed "${nodeId}"`)
  }
  if (expectation.expectedNodeKind !== undefined) {
    if (nodeKind === undefined) blocked.push('node kind is not reported by Android component lookup results')
    else if (nodeKind !== expectation.expectedNodeKind) problems.push(`expected node kind "${expectation.expectedNodeKind}" but observed "${nodeKind}"`)
  }

  const candidateFieldsRequested =
    expectation.requiredCandidateIds !== undefined || expectation.forbiddenCandidateIds !== undefined || expectation.expectedCandidateCount !== undefined
  if (candidateFieldsRequested) {
    if (candidateIds === undefined) blocked.push('generic node lookup results do not carry candidates')
    else checkCandidateExpectations(expectation, candidateIds, problems, observed)
  }
  return evaluation
}

interface SliceGraphView {
  nodeIds: Set<string>
  nodeKinds: Set<string>
  edgeKinds: Set<string>
  edgeKeys: Set<string>
  nodeCount: number
  edgeCount: number
}

const edgeKey = (source: string, kind: string, target: string): string => JSON.stringify([source, kind, target])

/** Validates an ordinary graph slice: unique node/edge ids and edges whose endpoints are returned nodes. Returns a problem string when malformed. */
function readSliceGraph(json: Record<string, unknown>): SliceGraphView | string {
  const nodes = json.nodes
  const edges = json.edges
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return 'graph slice has no "nodes"/"edges" arrays'
  const nodeIds = new Set<string>()
  const nodeKinds = new Set<string>()
  for (const node of nodes) {
    if (!isRecord(node) || typeof node.id !== 'string' || node.id.length === 0 || typeof node.kind !== 'string') {
      return 'graph slice contains a node without string "id"/"kind"'
    }
    if (nodeIds.has(node.id)) return `graph slice contains duplicate node id "${node.id}"`
    nodeIds.add(node.id)
    nodeKinds.add(node.kind)
  }
  const edgeIds = new Set<string>()
  const edgeKinds = new Set<string>()
  const edgeKeys = new Set<string>()
  for (const edge of edges) {
    if (
      !isRecord(edge) ||
      typeof edge.id !== 'string' ||
      edge.id.length === 0 ||
      typeof edge.source !== 'string' ||
      typeof edge.target !== 'string' ||
      typeof edge.kind !== 'string'
    ) {
      return 'graph slice contains an edge without string "id"/"source"/"target"/"kind"'
    }
    if (edgeIds.has(edge.id)) return `graph slice contains duplicate edge id "${edge.id}"`
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return `graph slice edge "${edge.id}" references an endpoint that is not a returned node`
    }
    edgeIds.add(edge.id)
    edgeKinds.add(edge.kind)
    edgeKeys.add(edgeKey(edge.source, edge.kind, edge.target))
  }
  return { nodeIds, nodeKinds, edgeKinds, edgeKeys, nodeCount: nodes.length, edgeCount: edges.length }
}

function readSliceSummary(json: Record<string, unknown>, field: 'androidDataFlow' | 'androidTests', countKeys: string[]): Record<string, unknown> | undefined {
  const summary = json[field]
  if (!isRecord(summary) || summary.requested !== true || typeof summary.truncated !== 'boolean') return undefined
  for (const key of countKeys) {
    const count = summary[key]
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return undefined
  }
  return summary
}

function evaluateSliceExpectation(expectation: SliceResultExpectation, json: Record<string, unknown>): CommandEvaluation {
  const evaluation: CommandEvaluation = { problems: [], blocked: [], observed: [] }
  const { problems, blocked, observed } = evaluation

  const graphEvidenceRequested =
    expectation.requiredNodeIds !== undefined ||
    expectation.forbiddenNodeIds !== undefined ||
    expectation.requiredNodeKinds !== undefined ||
    expectation.requiredEdgeKinds !== undefined ||
    expectation.requiredEdges !== undefined ||
    expectation.forbiddenEdges !== undefined ||
    expectation.connectedPaths !== undefined ||
    expectation.maxNodes !== undefined ||
    expectation.maxEdges !== undefined ||
    expectation.expectedDataFlowTruncated !== undefined ||
    expectation.requireAndroidTests !== undefined

  let graph: SliceGraphView | undefined
  let status: string
  let candidateIds: string[] | undefined

  if (Array.isArray(json.nodes) || Array.isArray(json.edges)) {
    const read = readSliceGraph(json)
    if (typeof read === 'string') {
      blocked.push(read)
      return evaluation
    }
    graph = read
    status = 'ok'
  } else if (json.status === 'ambiguous' || json.status === 'not-found') {
    status = json.status
    candidateIds = readCandidateIds(json.candidates)
    if (candidateIds === undefined) {
      blocked.push('Android slice result has no valid "candidates" array')
      return evaluation
    }
    if (status === 'not-found' && candidateIds.length > 0) {
      blocked.push('Android slice "not-found" result unexpectedly carries candidates')
      return evaluation
    }
    if (status === 'ambiguous' && candidateIds.length < 2) {
      blocked.push('Android slice "ambiguous" result has fewer than two candidates')
      return evaluation
    }
  } else {
    blocked.push('slice result is neither a graph slice (nodes/edges) nor an Android selector "ambiguous"/"not-found" result')
    return evaluation
  }

  observed.push(`status=${JSON.stringify(status)}`)
  const expectedStatus = expectation.expectedStatus ?? (graphEvidenceRequested ? 'ok' : undefined)
  if (expectedStatus !== undefined && expectedStatus !== status) {
    problems.push(
      graph === undefined && graphEvidenceRequested
        ? `expected graph evidence (status "ok") but the Android selector returned "${status}" with no graph`
        : `expected status ${JSON.stringify(expectedStatus)} but observed ${JSON.stringify(status)}`
    )
  }

  if (candidateIds !== undefined) {
    const candidateFieldsRequested = expectation.requiredCandidateIds !== undefined || expectation.expectedCandidateCount !== undefined
    if (candidateFieldsRequested) checkCandidateExpectations(expectation, candidateIds, problems, observed)
    else observed.push(`candidateCount=${candidateIds.length}`)
    return evaluation
  }
  if (!graph) return evaluation

  observed.push(`nodeCount=${graph.nodeCount}`, `edgeCount=${graph.edgeCount}`)
  for (const id of expectation.requiredNodeIds ?? []) {
    if (!graph.nodeIds.has(id)) problems.push(`required node "${id}" not found`)
  }
  for (const id of expectation.forbiddenNodeIds ?? []) {
    if (graph.nodeIds.has(id)) problems.push(`forbidden node "${id}" was returned`)
  }
  for (const kind of expectation.requiredNodeKinds ?? []) {
    if (!graph.nodeKinds.has(kind)) problems.push(`required node kind "${kind}" not found`)
  }
  for (const kind of expectation.requiredEdgeKinds ?? []) {
    if (!graph.edgeKinds.has(kind)) problems.push(`required edge kind "${kind}" not found`)
  }
  for (const edge of expectation.requiredEdges ?? []) {
    if (!graph.edgeKeys.has(edgeKey(edge.source, edge.kind, edge.target))) {
      problems.push(`required edge ${edge.source} --${edge.kind}--> ${edge.target} not found`)
    }
  }
  for (const edge of expectation.forbiddenEdges ?? []) {
    if (graph.edgeKeys.has(edgeKey(edge.source, edge.kind, edge.target))) {
      problems.push(`forbidden edge ${edge.source} --${edge.kind}--> ${edge.target} was returned`)
    }
  }
  const view = graph
  for (const [pathIndex, path] of (expectation.connectedPaths ?? []).entries()) {
    const label = `connected path #${pathIndex + 1}`
    const missingNodes = path.nodeIds.filter((id) => !view.nodeIds.has(id))
    if (missingNodes.length > 0) {
      problems.push(`${label} is broken: node(s) ${missingNodes.map((id) => `"${id}"`).join(', ')} not returned`)
      continue
    }
    for (let i = 0; i < path.edgeKinds.length; i++) {
      const from = path.nodeIds[i]!
      const to = path.nodeIds[i + 1]!
      const kind = path.edgeKinds[i]!
      if (!view.edgeKeys.has(edgeKey(from, kind, to))) {
        problems.push(`${label} is broken at step ${i + 1}: no edge ${from} --${kind}--> ${to}`)
        break
      }
    }
  }
  if (expectation.maxNodes !== undefined && graph.nodeCount > expectation.maxNodes) {
    problems.push(`node count ${graph.nodeCount} exceeds maxNodes ${expectation.maxNodes}`)
  }
  if (expectation.maxEdges !== undefined && graph.edgeCount > expectation.maxEdges) {
    problems.push(`edge count ${graph.edgeCount} exceeds maxEdges ${expectation.maxEdges}`)
  }

  if (expectation.expectedDataFlowTruncated !== undefined) {
    const summary = readSliceSummary(json, 'androidDataFlow', ['addedNodeCount', 'addedEdgeCount'])
    if (!summary) blocked.push('slice result has no valid "androidDataFlow" summary (was --include-data-flow requested?)')
    else {
      observed.push(`dataFlowTruncated=${JSON.stringify(summary.truncated)}`)
      if (summary.truncated !== expectation.expectedDataFlowTruncated) {
        problems.push(`expected androidDataFlow.truncated ${expectation.expectedDataFlowTruncated} but observed ${String(summary.truncated)}`)
      }
    }
  }
  if (expectation.requireAndroidTests === true) {
    const summary = readSliceSummary(json, 'androidTests', ['productionSeedCount', 'relatedTestMethodCount', 'addedNodeCount', 'addedEdgeCount'])
    if (!summary) blocked.push('slice result has no valid "androidTests" summary (was --include-tests requested?)')
    else {
      observed.push(`relatedTestMethodCount=${String(summary.relatedTestMethodCount)}`)
      if (summary.relatedTestMethodCount === 0) problems.push('androidTests summary reports no related test methods')
    }
  }
  return evaluation
}

// --- shared helpers --------------------------------------------------------------

function describeExpectation<T extends object>(expectation: T, keys: (keyof T)[]): string {
  const record = expectation as Record<string, unknown>
  const parts = keys
    .filter((key) => record[key as string] !== undefined)
    .map((key) => `${String(key)}=${JSON.stringify(record[key as string])}`)
  return parts.length > 0 ? parts.join(', ') : 'no constraints configured'
}

export function evaluateTaskAssertions(
  taskId: string,
  expectations: RetrievalRegressionExpectation | undefined,
  evidence: AssertionEvidence
): AssertionResult[] {
  if (!expectations) return []

  const results: AssertionResult[] = []

  if (expectations.candidateFiles) results.push(...evaluateCandidateFiles(taskId, expectations.candidateFiles, evidence))
  if (expectations.candidateNodes) results.push(...evaluateCandidateNodes(taskId, expectations.candidateNodes, evidence))
  if (expectations.focus) results.push(...evaluateFocus(taskId, expectations.focus, evidence))
  if (expectations.selectedGraph) results.push(...evaluateSelectedGraph(taskId, expectations.selectedGraph, evidence))
  if (expectations.sourceEvidence) results.push(...evaluateSourceEvidence(taskId, expectations.sourceEvidence, evidence))
  if (expectations.semanticSummary) results.push(...evaluateSemanticSummary(taskId, expectations.semanticSummary, evidence))
  if (expectations.classificationSummary) results.push(...evaluateClassificationSummary(taskId, expectations.classificationSummary, evidence))
  if (expectations.artifactReferences) results.push(...evaluateArtifactReferences(taskId, expectations.artifactReferences, evidence))
  if (expectations.conflicts) results.push(...evaluateConflicts(taskId, expectations.conflicts, evidence))
  if (expectations.modeEffects) results.push(...evaluateModeEffects(taskId, expectations.modeEffects, evidence))
  if (expectations.auditSteps) results.push(...evaluateAuditSteps(taskId, expectations.auditSteps, evidence))
  if (expectations.noRawContent) results.push(...evaluateNoRawContent(taskId, expectations.noRawContent, evidence))
  if (expectations.caps) results.push(...evaluateCapCompliance(taskId, expectations.caps, evidence))
  if (expectations.adequacy) results.push(...evaluateAdequacy(taskId, expectations.adequacy, evidence))
  if (expectations.commandResult) results.push(...evaluateCommandResult(taskId, expectations.commandResult, evidence))

  return results
}

export function summarizeAssertions(results: AssertionResult[]): TaskAssertionSummary {
  return {
    total: results.length,
    passed: results.filter((r) => r.status === 'pass').length,
    failed: results.filter((r) => r.status === 'fail').length,
    blocked: results.filter((r) => r.status === 'blocked').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    requiredFailed: results.filter((r) => r.status === 'fail' && r.severity === 'required').length,
    warningFailed: results.filter((r) => r.status === 'fail' && r.severity === 'warning').length,
  }
}
