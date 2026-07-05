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
  ConflictExpectation,
  FocusExpectation,
  ModeEffectExpectation,
  NoRawContentExpectation,
  RetrievalRegressionExpectation,
  SelectedGraphExpectation,
  SemanticSummaryExpectation,
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
}

export function loadAssertionEvidence(options: { capsulePath?: string; auditPath?: string }): AssertionEvidence {
  const capsuleRead = readJsonFile<ContextCapsule>(options.capsulePath)
  const auditRead = readJsonFile<RetrievalAuditRecord>(options.auditPath)
  return {
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
  const adequacy = evidence.capsule.contextAdequacy
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
