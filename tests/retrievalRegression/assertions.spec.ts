import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { evaluateTaskAssertions, loadAssertionEvidence, summarizeAssertions } from '../../src/retrievalRegression/assertions.js'
import { baseAudit, baseCapsule } from './capsuleFixtures.js'
import type { AssertionEvidence } from '../../src/retrievalRegression/assertions.js'
import type { ContextCapsule, RetrievalAuditRecord } from '../../src/context/types.js'

const tempDirs: string[] = []
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function evidenceFor(capsule: ContextCapsule | null, audit: RetrievalAuditRecord | null = baseAudit()): AssertionEvidence {
  const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-assertions-'))
  tempDirs.push(dir)
  const capsulePath = join(dir, 'context-capsule.json')
  const auditPath = join(dir, 'retrieval-audit-record.json')
  if (capsule) writeFileSync(capsulePath, JSON.stringify(capsule), 'utf8')
  if (audit) writeFileSync(auditPath, JSON.stringify(audit), 'utf8')
  return loadAssertionEvidence({
    capsulePath: capsule ? capsulePath : undefined,
    auditPath: audit ? auditPath : undefined,
  })
}

describe('candidate file assertions', () => {
  it('passes when expected file is within topK', () => {
    const capsule = baseCapsule({
      candidateFiles: [
        { path: 'src/models.ts', score: 10, reasons: [], matchedTerms: [], retained: true },
      ],
    })
    const results = evaluateTaskAssertions(
      'task-a',
      { candidateFiles: [{ pathContains: 'models.ts', topK: 3 }] },
      evidenceFor(capsule)
    )
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('pass')
  })

  it('fails when required file is missing', () => {
    const capsule = baseCapsule({
      candidateFiles: [{ path: 'src/other.ts', score: 5, reasons: [], matchedTerms: [], retained: true }],
    })
    const results = evaluateTaskAssertions(
      'task-a',
      { candidateFiles: [{ pathContains: 'models.ts', topK: 3, required: true }] },
      evidenceFor(capsule)
    )
    expect(results[0].status).toBe('fail')
    expect(results[0].severity).toBe('required')
  })
})

describe('candidate node assertions', () => {
  it('supports symbol/path matching', () => {
    const capsule = baseCapsule({
      candidateNodes: [
        { nodeId: 'symbol:src/models.ts#User', kind: 'symbol', label: 'User', filePath: 'src/models.ts', score: 10, reasons: [], matchedTerms: [], retained: true },
      ],
    })
    const results = evaluateTaskAssertions(
      'task-a',
      { candidateNodes: [{ nodeIdContains: 'User', pathContains: 'models.ts', topK: 5 }] },
      evidenceFor(capsule)
    )
    expect(results[0].status).toBe('pass')
  })
})

describe('focus assertions', () => {
  it('passes expected focus', () => {
    const capsule = baseCapsule({
      focus: {
        focusNodeId: 'symbol:src/models.ts#User',
        focusFilePath: 'src/models.ts',
        selectionMode: 'single-best',
        confidence: 'high',
        reasons: [],
        ambiguityNotes: [],
        warnings: [],
      },
    })
    const results = evaluateTaskAssertions('task-a', { focus: { pathContains: 'models.ts' } }, evidenceFor(capsule))
    expect(results[0].status).toBe('pass')
  })

  it('fails missing focus when allowNoFocus is false', () => {
    const capsule = baseCapsule()
    const results = evaluateTaskAssertions('task-a', { focus: { allowNoFocus: false } }, evidenceFor(capsule))
    expect(results[0].status).toBe('fail')
  })

  it('passes missing focus when allowNoFocus is true', () => {
    const capsule = baseCapsule()
    const results = evaluateTaskAssertions('task-a', { focus: { allowNoFocus: true } }, evidenceFor(capsule))
    expect(results[0].status).toBe('pass')
  })
})

describe('selected graph assertions', () => {
  it('passes required evidence', () => {
    const capsule = baseCapsule({
      selectedGraph: {
        nodes: [{ nodeId: 'file:src/models.ts', kind: 'file', label: 'models.ts', filePath: 'src/models.ts', reasons: [] }],
        edges: [],
        omittedNodeCount: 0,
        omittedEdgeCount: 0,
        warnings: [],
      },
    })
    const results = evaluateTaskAssertions(
      'task-a',
      { selectedGraph: { requiredFileContains: ['models.ts'] } },
      evidenceFor(capsule)
    )
    expect(results[0].status).toBe('pass')
  })

  it('fails when caps are exceeded', () => {
    const capsule = baseCapsule({
      selectedGraph: {
        nodes: [
          { nodeId: 'a', kind: 'file', label: 'a', filePath: 'a.ts', reasons: [] },
          { nodeId: 'b', kind: 'file', label: 'b', filePath: 'b.ts', reasons: [] },
        ],
        edges: [],
        omittedNodeCount: 0,
        omittedEdgeCount: 0,
        warnings: [],
      },
    })
    const results = evaluateTaskAssertions('task-a', { selectedGraph: { maxNodes: 1 } }, evidenceFor(capsule))
    expect(results[0].status).toBe('fail')
  })
})

describe('source evidence assertions', () => {
  it('passes required file assertion', () => {
    const capsule = baseCapsule({
      selectedSource: {
        slices: [
          {
            id: 's1',
            kind: 'symbol',
            filePath: 'src/models.ts',
            startLine: 1,
            endLine: 5,
            reason: 'primary focus node',
            sourceRetrievalMethod: 'symbol',
            includedBy: 'primary-focus',
            truncated: false,
            continuationUsed: false,
            localExpansionUsed: false,
            warnings: [],
          },
        ],
        omittedSliceCount: 0,
        totalSelectedLines: 5,
        maxSourceSlices: 8,
        warnings: [],
        skipped: [],
      },
    })
    const results = evaluateTaskAssertions(
      'task-a',
      { sourceEvidence: { requiredFileContains: ['models.ts'], minSlices: 1 } },
      evidenceFor(capsule)
    )
    expect(results[0].status).toBe('pass')
  })

  it('passes noSourceExpected assertion when there is no source evidence', () => {
    const capsule = baseCapsule()
    const results = evaluateTaskAssertions('task-a', { sourceEvidence: { noSourceExpected: true } }, evidenceFor(capsule))
    expect(results[0].status).toBe('pass')
  })

  it('fails noSourceExpected assertion when source slices exist', () => {
    const capsule = baseCapsule({
      selectedSource: {
        slices: [
          {
            id: 's1',
            kind: 'symbol',
            filePath: 'src/models.ts',
            startLine: 1,
            endLine: 5,
            reason: 'primary focus node',
            sourceRetrievalMethod: 'symbol',
            includedBy: 'primary-focus',
            truncated: false,
            continuationUsed: false,
            localExpansionUsed: false,
            warnings: [],
          },
        ],
        omittedSliceCount: 0,
        totalSelectedLines: 5,
        maxSourceSlices: 8,
        warnings: [],
        skipped: [],
      },
    })
    const results = evaluateTaskAssertions('task-a', { sourceEvidence: { noSourceExpected: true } }, evidenceFor(capsule))
    expect(results[0].status).toBe('fail')
  })
})

describe('semantic summary assertions', () => {
  it('passes when required and available', () => {
    const capsule = baseCapsule({
      semanticSummary: {
        available: true,
        roles: [{ role: 'data-entity', subtype: 'canonical-type', confidence: 'explicit', source: 'analyzer', artifactRefs: [], evidenceRefs: [], warnings: [] }],
        artifactRefs: [],
        evidenceRefs: [],
        summariesByNode: {},
        summariesByFile: {},
        warnings: [],
      },
    })
    const results = evaluateTaskAssertions('task-a', { semanticSummary: { requiredRoles: ['data-entity'] } }, evidenceFor(capsule))
    expect(results[0].status).toBe('pass')
  })

  it('passes unavailable when allowUnavailable is true', () => {
    const capsule = baseCapsule()
    const results = evaluateTaskAssertions('task-a', { semanticSummary: { allowUnavailable: true } }, evidenceFor(capsule))
    expect(results[0].status).toBe('pass')
  })

  it('fails when required and unavailable', () => {
    const capsule = baseCapsule()
    const results = evaluateTaskAssertions('task-a', { semanticSummary: { required: true, allowUnavailable: false } }, evidenceFor(capsule))
    expect(results[0].status).toBe('fail')
  })
})

describe('classification summary assertions', () => {
  it('passes when required and available', () => {
    const capsule = baseCapsule({
      classificationSummary: {
        available: true,
        classificationArtifactPath: 'index/classification.json',
        roles: [{ role: 'canonical-type', subtype: null, confidence: 'certain' }],
        refs: [],
        editGuidance: ['inspect-before-edit'],
        readiness: [],
        riskLabels: [],
        uncertainty: [],
        summariesByNode: {},
        summariesByFile: {},
        warnings: [],
      },
    })
    const results = evaluateTaskAssertions(
      'task-a',
      { classificationSummary: { requiredCategories: ['canonical-type'], requiredEditGuidance: ['inspect-before-edit'] } },
      evidenceFor(capsule)
    )
    expect(results[0].status).toBe('pass')
  })

  it('passes unavailable when allowed', () => {
    const capsule = baseCapsule()
    const results = evaluateTaskAssertions('task-a', { classificationSummary: { allowUnavailable: true } }, evidenceFor(capsule))
    expect(results[0].status).toBe('pass')
  })
})

describe('artifact reference assertions', () => {
  it('passes when expected references are present', () => {
    const capsule = baseCapsule({
      artifactReferenceSummary: [
        { artifactKind: 'symbolIndex', artifactPath: 'index/symbol-index.json', available: true, reason: 'r', warnings: [] },
      ],
    })
    const results = evaluateTaskAssertions('task-a', { artifactReferences: { requiredKinds: ['symbolIndex'] } }, evidenceFor(capsule))
    expect(results[0].status).toBe('pass')
  })
})

describe('conflict expectation behavior', () => {
  it('passes matching status/count', () => {
    const capsule = baseCapsule({ conflicts: { status: 'none', conflicts: [], warnings: [] } })
    const results = evaluateTaskAssertions('task-a', { conflicts: { expectedStatus: 'none', allowNone: true } }, evidenceFor(capsule))
    expect(results[0].status).toBe('pass')
  })

  it('fails when conflict is not allowed but present', () => {
    const capsule = baseCapsule({
      conflicts: {
        status: 'conflict',
        conflicts: [
          {
            id: 'c1',
            status: 'conflict',
            reason: 'r',
            evidenceRefs: [],
            affectedFiles: [],
            affectedNodes: [],
            candidates: [],
            recommendedNextAction: 'inspect',
          },
        ],
        warnings: [],
      },
    })
    const results = evaluateTaskAssertions('task-a', { conflicts: { allowNone: true } }, evidenceFor(capsule))
    expect(results[0].status).toBe('fail')
  })
})

describe('mode effect expectation behavior', () => {
  it('passes when mode and effects match', () => {
    const capsule = baseCapsule({
      modeEffects: { mode: 'feature-add', applied: true, effects: [{ candidateId: 'x', adjustment: 3, reasons: ['mode feature-add: preferred'] }], warnings: [] },
    })
    const results = evaluateTaskAssertions(
      'task-a',
      { modeEffects: { expectedMode: 'feature-add', requireModeEffect: true } },
      evidenceFor(capsule)
    )
    expect(results[0].status).toBe('pass')
  })

  it('fails when mode effect is required but absent', () => {
    const capsule = baseCapsule({ modeEffects: { mode: 'feature-add', applied: false, effects: [], warnings: [] } })
    const results = evaluateTaskAssertions('task-a', { modeEffects: { requireModeEffect: true } }, evidenceFor(capsule))
    expect(results[0].status).toBe('fail')
  })
})

describe('audit step assertions', () => {
  it('passes required step assertion', () => {
    const audit = baseAudit({
      steps: [
        { id: 'step-validate-inputs', kind: 'validate-inputs', description: 'd', inputs: {}, outputs: {}, status: 'ok', warnings: [] },
        { id: 'step-run-search', kind: 'run-search', description: 'd', inputs: {}, outputs: {}, status: 'ok', warnings: [] },
      ],
    })
    const results = evaluateTaskAssertions(
      'task-a',
      { auditSteps: { requiredStepIds: ['step-validate-inputs'] } },
      evidenceFor(baseCapsule(), audit)
    )
    expect(results[0].status).toBe('pass')
  })

  it('passes ordered step assertion when in order', () => {
    const audit = baseAudit({
      steps: [
        { id: 'a', kind: 'validate-inputs', description: 'd', inputs: {}, outputs: {}, status: 'ok', warnings: [] },
        { id: 'b', kind: 'run-search', description: 'd', inputs: {}, outputs: {}, status: 'ok', warnings: [] },
      ],
    })
    const results = evaluateTaskAssertions(
      'task-a',
      { auditSteps: { requiredOrderedStepIds: ['a', 'b'] } },
      evidenceFor(baseCapsule(), audit)
    )
    expect(results[0].status).toBe('pass')
  })

  it('fails ordered step assertion when out of order', () => {
    const audit = baseAudit({
      steps: [
        { id: 'a', kind: 'validate-inputs', description: 'd', inputs: {}, outputs: {}, status: 'ok', warnings: [] },
        { id: 'b', kind: 'run-search', description: 'd', inputs: {}, outputs: {}, status: 'ok', warnings: [] },
      ],
    })
    const results = evaluateTaskAssertions(
      'task-a',
      { auditSteps: { requiredOrderedStepIds: ['b', 'a'] } },
      evidenceFor(baseCapsule(), audit)
    )
    expect(results[0].status).toBe('fail')
  })

  it('fails unique step assertion when duplicates exist', () => {
    const audit = baseAudit({
      steps: [
        { id: 'a', kind: 'validate-inputs', description: 'd', inputs: {}, outputs: {}, status: 'ok', warnings: [] },
        { id: 'a', kind: 'validate-inputs', description: 'd', inputs: {}, outputs: {}, status: 'ok', warnings: [] },
      ],
    })
    const results = evaluateTaskAssertions(
      'task-a',
      { auditSteps: { requireUniqueStepIds: true } },
      evidenceFor(baseCapsule(), audit)
    )
    const uniquenessResult = results.find((r) => r.kind === 'auditStepUniqueness')
    expect(uniquenessResult?.status).toBe('fail')
  })
})

describe('no raw content assertion', () => {
  it('passes when no forbidden indicators are found', () => {
    const capsule = baseCapsule()
    const results = evaluateTaskAssertions('task-a', { noRawContent: { enabled: true } }, evidenceFor(capsule))
    expect(results[0].status).toBe('pass')
  })

  it('does not print matched raw content in the failure message', () => {
    const capsule = baseCapsule() as unknown as Record<string, unknown>
    capsule.rawSource = 'x'.repeat(5000)
    const results = evaluateTaskAssertions(
      'task-a',
      { noRawContent: { enabled: true, forbiddenKeys: ['rawSource'] } },
      evidenceFor(capsule as unknown as ContextCapsule)
    )
    expect(results[0].status).toBe('fail')
    expect(results[0].message).not.toContain('x'.repeat(5000))
    expect(results[0].actualSummary).not.toContain('x'.repeat(5000))
  })
})

describe('cap compliance assertions', () => {
  it('passes when within caps', () => {
    const capsule = baseCapsule({ candidateFiles: [{ path: 'a.ts', score: 1, reasons: [], matchedTerms: [], retained: true }] })
    const results = evaluateTaskAssertions('task-a', { caps: { maxCandidateFiles: 5 } }, evidenceFor(capsule))
    expect(results[0].status).toBe('pass')
  })

  it('fails when exceeded', () => {
    const capsule = baseCapsule({
      candidateFiles: [
        { path: 'a.ts', score: 1, reasons: [], matchedTerms: [], retained: true },
        { path: 'b.ts', score: 1, reasons: [], matchedTerms: [], retained: true },
      ],
    })
    const results = evaluateTaskAssertions('task-a', { caps: { maxCandidateFiles: 1 } }, evidenceFor(capsule))
    expect(results[0].status).toBe('fail')
  })
})

describe('adequacy assertions', () => {
  it('passes matching status', () => {
    const capsule = baseCapsule()
    const results = evaluateTaskAssertions(
      'task-a',
      { adequacy: { allowedStatuses: ['context sufficient with listed assumptions'] } },
      evidenceFor(capsule)
    )
    expect(results[0].status).toBe('pass')
  })

  it('fails insufficient when not allowed', () => {
    const capsule = baseCapsule({
      contextAdequacy: {
        status: 'context insufficient and more retrieval required',
        summary: 's',
        assumptions: [],
        gaps: [],
      },
    })
    const results = evaluateTaskAssertions('task-a', { adequacy: { allowInsufficient: false } }, evidenceFor(capsule))
    expect(results[0].status).toBe('fail')
  })
})

describe('missing evidence handling', () => {
  it('marks assertions blocked when capsule is missing', () => {
    const evidence = loadAssertionEvidence({ capsulePath: undefined, auditPath: undefined })
    const results = evaluateTaskAssertions('task-a', { focus: { allowNoFocus: true } }, evidence)
    expect(results[0].status).toBe('blocked')
  })
})

describe('summarizeAssertions', () => {
  it('aggregates status/severity counts', () => {
    const capsule = baseCapsule()
    const results = evaluateTaskAssertions(
      'task-a',
      {
        focus: { allowNoFocus: false },
        adequacy: { allowedStatuses: ['context sufficient with listed assumptions'] },
      },
      evidenceFor(capsule)
    )
    const summary = summarizeAssertions(results)
    expect(summary.total).toBe(2)
    expect(summary.passed + summary.failed + summary.blocked + summary.skipped).toBe(2)
  })
})

describe('commandResult assertions', () => {
  function commandEvidence(payload: unknown | string | null): AssertionEvidence {
    const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-command-assertions-'))
    tempDirs.push(dir)
    const resultPath = join(dir, 'command-stdout.json')
    if (payload !== null) writeFileSync(resultPath, typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf8')
    return loadAssertionEvidence({ commandResultPath: resultPath })
  }

  const searchResult = { results: [{ id: 'file:a.ts' }, { id: 'file:b.ts' }, { id: 'file:c.ts' }] }
  const sourceResult = {
    mode: 'symbol',
    startLine: 1,
    endLine: 8,
    lineCount: 8,
    content: 'export function longSymbol() {\n  return 1\n}',
    continuationCursor: { nextStartLine: 9, symbolBoundaryKnown: true, reason: 'window-capped', eof: false },
  }

  it('passes required search ids within topK', () => {
    const results = evaluateTaskAssertions('t', { commandResult: { requiredResultIds: ['file:b.ts'], topK: 2 } }, commandEvidence(searchResult))
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ kind: 'commandResult', status: 'pass', severity: 'required' })
  })

  it('fails (REGRESSION-grade) when a required id is outside topK', () => {
    const results = evaluateTaskAssertions('t', { commandResult: { requiredResultIds: ['file:c.ts'], topK: 2 } }, commandEvidence(searchResult))
    expect(results[0]).toMatchObject({ status: 'fail', severity: 'required' })
    expect(results[0].message).toContain('file:c.ts')
  })

  it('passes a fully matching source result including cursor fields', () => {
    const results = evaluateTaskAssertions(
      't',
      {
        commandResult: {
          expectedMode: 'symbol',
          expectedStartLine: 1,
          expectedEndLine: 8,
          expectedLineCount: 8,
          requiredContent: ['longSymbol'],
          forbiddenContent: ['sentinel'],
          continuation: 'present',
          symbolBoundaryKnown: true,
          nextStartLine: 9,
          continuationReason: 'window-capped',
        },
      },
      commandEvidence(sourceResult)
    )
    expect(results[0].status).toBe('pass')
  })

  it('fails on forbidden content, wrong lines and unexpected cursor', () => {
    const results = evaluateTaskAssertions(
      't',
      { commandResult: { expectedEndLine: 9, forbiddenContent: ['longSymbol'], continuation: 'absent' } },
      commandEvidence(sourceResult)
    )
    expect(results[0].status).toBe('fail')
    expect(results[0].message).toContain('expected endLine 9')
    expect(results[0].message).toContain('forbidden content')
    expect(results[0].message).toContain('expected continuation absent')
  })

  it('fails cursor-field expectations when no cursor was returned', () => {
    const { continuationCursor: _cursor, ...noCursor } = sourceResult
    const results = evaluateTaskAssertions('t', { commandResult: { nextStartLine: 9 } }, commandEvidence(noCursor))
    expect(results[0].status).toBe('fail')
    expect(results[0].message).toContain('no continuation cursor')
  })

  it('is blocked for missing, malformed, or wrong-shape evidence', () => {
    const expectation = { commandResult: { requiredResultIds: ['a'] } }
    expect(evaluateTaskAssertions('t', expectation, commandEvidence(null))[0].status).toBe('blocked')
    expect(evaluateTaskAssertions('t', expectation, commandEvidence('{not json'))[0].status).toBe('blocked')
    expect(evaluateTaskAssertions('t', expectation, commandEvidence({ content: 'x' }))[0].status).toBe('blocked')
    expect(
      evaluateTaskAssertions('t', { commandResult: { expectedStartLine: 1 } }, commandEvidence({ results: [] }))[0].status
    ).toBe('blocked')
  })
})

describe('lookup commandResult assertions', () => {
  function commandEvidence(payload: unknown | string): AssertionEvidence {
    const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-lookup-assertions-'))
    tempDirs.push(dir)
    const resultPath = join(dir, 'lookup-stdout.json')
    writeFileSync(resultPath, typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf8')
    return loadAssertionEvidence({ commandResultPath: resultPath })
  }
  const run = (lookup: Record<string, unknown>, payload: unknown | string, extra: Record<string, unknown> = {}) =>
    evaluateTaskAssertions('t', { commandResult: { lookup, ...extra } }, commandEvidence(payload))[0]!

  const generic = { status: 'found', nodeId: 'file:a.ts', depth: 1, node: { id: 'file:a.ts', kind: 'file', label: 'a.ts' }, incomingEdges: [], outgoingEdges: [], neighbors: [], warnings: [] }
  const androidBase = { artifactKind: 'my-dev-kit-v1-android-component-lookup-result', version: '1.0.0', query: 'MainActivity', warnings: [] }
  const androidFound = { ...androidBase, status: 'found', detail: { graphNodeId: 'android:main', componentKind: 'activity' }, candidates: [] }
  const androidAmbiguous = {
    ...androidBase,
    status: 'ambiguous',
    detail: null,
    candidates: [{ graphNodeId: 'android:main', matchKind: 'simple-name', kind: 'android-manifest-component' }, { graphNodeId: 'android:other', matchKind: 'simple-name', kind: 'android-manifest-component' }],
  }
  const androidNotFound = { ...androidBase, status: 'not-found', detail: null, candidates: [] }

  it('passes a found generic node by identity and kind', () => {
    const result = run({ expectedStatus: 'found', expectedNodeId: 'file:a.ts', expectedNodeKind: 'file' }, generic)
    expect(result).toMatchObject({ kind: 'commandResult', status: 'pass', severity: 'required' })
    expect(result.actualSummary).toContain('nodeKind="file"')
  })

  it('fails a wrong generic node id and a wrong node kind', () => {
    expect(run({ expectedNodeId: 'file:b.ts' }, generic)).toMatchObject({ status: 'fail' })
    const wrongKind = run({ expectedNodeKind: 'symbol' }, generic)
    expect(wrongKind.status).toBe('fail')
    expect(wrongKind.message).toContain('expected node kind "symbol" but observed "file"')
  })

  it('passes an exact Android component and fails a different selected node', () => {
    expect(run({ expectedStatus: 'found', expectedNodeId: 'android:main' }, androidFound).status).toBe('pass')
    expect(run({ expectedNodeId: 'android:other' }, androidFound).status).toBe('fail')
  })

  it('passes an explicitly expected ambiguity and preserves every candidate', () => {
    const result = run(
      { expectedStatus: 'ambiguous', requiredCandidateIds: ['android:main', 'android:other'], forbiddenCandidateIds: ['android:third'], expectedCandidateCount: 2 },
      androidAmbiguous
    )
    expect(result.status).toBe('pass')
    expect(result.actualSummary).toContain('candidateCount=2')
  })

  it('regresses when ambiguity was expected but a unique winner was returned', () => {
    const result = run({ expectedStatus: 'ambiguous', requiredCandidateIds: ['android:main'] }, androidFound)
    expect(result.status).toBe('fail')
    expect(result.message).toContain('expected status "ambiguous" but observed "found"')
  })

  it('regresses on missing/forbidden candidates and a wrong candidate count', () => {
    const result = run({ expectedStatus: 'ambiguous', requiredCandidateIds: ['android:missing'], forbiddenCandidateIds: ['android:other'], expectedCandidateCount: 3 }, androidAmbiguous)
    expect(result.status).toBe('fail')
    expect(result.message).toContain('required candidate "android:missing" not found')
    expect(result.message).toContain('forbidden candidate "android:other" was returned')
    expect(result.message).toContain('expected 3 candidate(s) but observed 2')
  })

  it('does not accept an arbitrary detail for an expected node when the result is ambiguous', () => {
    const result = run({ expectedNodeId: 'android:main' }, androidAmbiguous)
    expect(result.status).toBe('fail')
    expect(result.message).toContain('no node was selected')
  })

  it('verifies explicit absence for not-found and regresses when a candidate appears', () => {
    expect(run({ expectedStatus: 'not-found' }, androidNotFound).status).toBe('pass')
    expect(run({ expectedStatus: 'not-found' }, androidFound).status).toBe('fail')
    expect(run({ expectedStatus: 'not-found' }, androidAmbiguous).status).toBe('fail')
  })

  it('blocks malformed or contradictory lookup results instead of passing them', () => {
    expect(run({ expectedNodeId: 'file:a.ts' }, '{ not json').status).toBe('blocked')
    expect(run({ expectedNodeId: 'file:a.ts' }, { status: 'found' }).status).toBe('blocked')
    expect(run({ expectedNodeId: 'file:a.ts' }, { status: 'found', node: { id: 'file:a.ts' } }).status).toBe('blocked')
    expect(run({ expectedStatus: 'found' }, { ...androidFound, detail: null }).status).toBe('blocked')
    expect(run({ expectedStatus: 'ambiguous' }, { ...androidAmbiguous, detail: { graphNodeId: 'android:main' } }).status).toBe('blocked')
    expect(run({ expectedStatus: 'ambiguous' }, { ...androidAmbiguous, candidates: [{ id: 'x' }] }).status).toBe('blocked')
    expect(run({ expectedStatus: 'ambiguous' }, { ...androidAmbiguous, candidates: androidAmbiguous.candidates.slice(0, 1) }).status).toBe('blocked')
    expect(run({ expectedStatus: 'not-found' }, { ...androidNotFound, candidates: androidAmbiguous.candidates }).status).toBe('blocked')
    expect(run({ requiredCandidateIds: ['x'] }, generic).status).toBe('blocked')
    expect(run({ expectedNodeKind: 'file' }, androidFound).status).toBe('blocked')
    expect(run({ expectedNodeId: 'x' }, [1, 2]).status).toBe('blocked')
  })

  it('downgrades a failed lookup to a warning only when the task is not required', () => {
    const optional = run({ expectedNodeId: 'file:b.ts' }, generic, { required: false })
    expect(optional).toMatchObject({ status: 'fail', severity: 'warning' })
    const blockedOptional = run({ expectedNodeId: 'file:b.ts' }, 'not json', { required: false })
    expect(blockedOptional).toMatchObject({ status: 'blocked', severity: 'required' })
  })
})

describe('slice commandResult assertions', () => {
  function commandEvidence(payload: unknown | string): AssertionEvidence {
    const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-slice-assertions-'))
    tempDirs.push(dir)
    const resultPath = join(dir, 'slice-stdout.json')
    writeFileSync(resultPath, typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf8')
    return loadAssertionEvidence({ commandResultPath: resultPath })
  }
  const run = (slice: Record<string, unknown>, payload: unknown | string, extra: Record<string, unknown> = {}) =>
    evaluateTaskAssertions('t', { commandResult: { slice, ...extra } }, commandEvidence(payload))[0]!

  const node = (id: string, kind = 'symbol') => ({ id, kind, label: id })
  const edge = (source: string, kind: string, target: string, id = `${source}|${kind}|${target}`) => ({ id, source, target, kind })
  const graph = (nodes: unknown[], edges: unknown[], extra: Record<string, unknown> = {}) => ({
    artifactKind: 'my-dev-kit-v1-graph-slice',
    focusNodeId: 'A',
    nodes,
    edges,
    summary: { nodeCount: nodes.length, edgeCount: edges.length },
    warnings: [],
    ...extra,
  })
  // A -x-> B -y-> C ; D is returned but unrelated. X -x-> Y is a second, disconnected pair.
  const chain = graph(
    [node('A', 'screen'), node('B'), node('C', 'dao'), node('D'), node('X'), node('Y')],
    [edge('A', 'x', 'B'), edge('B', 'y', 'C'), edge('X', 'x', 'Y'), edge('C', 'z', 'D')]
  )

  it('passes required and forbidden node identities and kinds', () => {
    const result = run({ requiredNodeIds: ['A', 'C'], forbiddenNodeIds: ['Z'], requiredNodeKinds: ['screen', 'dao'] }, chain)
    expect(result.status).toBe('pass')
    expect(result.actualSummary).toContain('nodeCount=6')
  })

  it('regresses on a missing required node, a forbidden node and a missing node kind', () => {
    const result = run({ requiredNodeIds: ['Q'], forbiddenNodeIds: ['D'], requiredNodeKinds: ['viewmodel'] }, chain)
    expect(result.status).toBe('fail')
    expect(result.message).toContain('required node "Q" not found')
    expect(result.message).toContain('forbidden node "D" was returned')
    expect(result.message).toContain('required node kind "viewmodel" not found')
  })

  it('requires edge kinds and exact edges by source, kind and target', () => {
    expect(run({ requiredEdgeKinds: ['x', 'y'], requiredEdges: [{ source: 'A', kind: 'x', target: 'B' }] }, chain).status).toBe('pass')
    const wrongEndpoints = run({ requiredEdges: [{ source: 'A', kind: 'y', target: 'C' }] }, chain)
    expect(wrongEndpoints.status).toBe('fail')
    expect(wrongEndpoints.message).toContain('required edge A --y--> C not found')
    expect(run({ requiredEdgeKinds: ['missing'] }, chain).status).toBe('fail')
  })

  it('treats a reversed edge as a different edge', () => {
    expect(run({ requiredEdges: [{ source: 'B', kind: 'x', target: 'A' }] }, chain).status).toBe('fail')
    expect(run({ forbiddenEdges: [{ source: 'B', kind: 'x', target: 'A' }] }, chain).status).toBe('pass')
    expect(run({ connectedPaths: [{ nodeIds: ['B', 'A'], edgeKinds: ['x'] }] }, chain).status).toBe('fail')
  })

  it('regresses when a forbidden exact edge is present', () => {
    const result = run({ forbiddenEdges: [{ source: 'B', kind: 'y', target: 'C' }] }, chain)
    expect(result.status).toBe('fail')
    expect(result.message).toContain('forbidden edge B --y--> C was returned')
  })

  it('passes a connected multi-edge path', () => {
    expect(run({ connectedPaths: [{ nodeIds: ['A', 'B', 'C', 'D'], edgeKinds: ['x', 'y', 'z'] }] }, chain).status).toBe('pass')
  })

  it('fails a disconnected path even when each edge kind exists elsewhere in the graph', () => {
    // Both edge kinds and all nodes exist, but x does not leave B and y does not leave Y.
    const result = run({ connectedPaths: [{ nodeIds: ['X', 'Y', 'C'], edgeKinds: ['x', 'y'] }] }, chain)
    expect(result.status).toBe('fail')
    expect(result.message).toContain('connected path #1 is broken at step 2: no edge Y --y--> C')
    expect(run({ requiredEdgeKinds: ['x', 'y'] }, chain).status).toBe('pass')
  })

  it('fails a path whose intermediate node is not returned or whose edge kind is wrong', () => {
    const missingMiddle = graph([node('A'), node('C')], [edge('A', 'x', 'C')])
    const missing = run({ connectedPaths: [{ nodeIds: ['A', 'B', 'C'], edgeKinds: ['x', 'y'] }] }, missingMiddle)
    expect(missing.status).toBe('fail')
    expect(missing.message).toContain('node(s) "B" not returned')
    expect(run({ connectedPaths: [{ nodeIds: ['A', 'B'], edgeKinds: ['y'] }] }, chain).status).toBe('fail')
  })

  it('does not infer a transitive edge for a skipped intermediate node', () => {
    expect(run({ connectedPaths: [{ nodeIds: ['A', 'C'], edgeKinds: ['y'] }] }, chain).status).toBe('fail')
  })

  it('enforces node and edge bounds', () => {
    expect(run({ maxNodes: 6, maxEdges: 4 }, chain).status).toBe('pass')
    const result = run({ maxNodes: 5, maxEdges: 3 }, chain)
    expect(result.status).toBe('fail')
    expect(result.message).toContain('node count 6 exceeds maxNodes 5')
    expect(result.message).toContain('edge count 4 exceeds maxEdges 3')
  })

  it('blocks a malformed graph: duplicates, dangling edges and invalid entries', () => {
    expect(run({ requiredNodeIds: ['A'] }, graph([node('A'), node('A')], [])).status).toBe('blocked')
    expect(run({ requiredNodeIds: ['A'] }, graph([node('A'), node('B')], [edge('A', 'x', 'B', 'e1'), edge('A', 'x', 'B', 'e1')])).status).toBe('blocked')
    expect(run({ requiredNodeIds: ['A'] }, graph([node('A')], [edge('A', 'x', 'Missing')])).status).toBe('blocked')
    expect(run({ requiredNodeIds: ['A'] }, graph([{ id: 'A' }], [])).status).toBe('blocked')
    expect(run({ requiredNodeIds: ['A'] }, graph([node('A')], [{ id: 'e', source: 'A', kind: 'x' }])).status).toBe('blocked')
    expect(run({ requiredNodeIds: ['A'] }, { nodes: [node('A')] }).status).toBe('blocked')
  })

  it('treats distinct edge ids with the same endpoints and kind as one relationship, not a duplicate entry', () => {
    const parallel = graph([node('A'), node('B')], [edge('A', 'x', 'B', 'e1'), edge('A', 'x', 'B', 'e2')])
    expect(run({ requiredEdges: [{ source: 'A', kind: 'x', target: 'B' }], maxEdges: 2 }, parallel).status).toBe('pass')
  })

  it('blocks missing graph evidence and unreadable output instead of passing', () => {
    expect(run({ requiredNodeIds: ['A'] }, '{ broken').status).toBe('blocked')
    expect(run({ requiredNodeIds: ['A'] }, {}).status).toBe('blocked')
    expect(run({ requiredNodeIds: ['A'] }, { status: 'weird' }).status).toBe('blocked')
    expect(run({ requiredNodeIds: ['A'] }, []).status).toBe('blocked')
  })

  const sliceBase = { artifactKind: 'my-dev-kit-v1-android-slice-result', version: '1.0.0', mode: 'android-route', query: 'home', warnings: [] }
  const ambiguous = { ...sliceBase, status: 'ambiguous', candidates: [{ graphNodeId: 'R1', matchKind: 'exact', kind: 'android-compose-route' }, { graphNodeId: 'R2', matchKind: 'exact', kind: 'android-compose-route' }] }
  const notFound = { ...sliceBase, status: 'not-found', candidates: [] }

  it('passes a valid Android selector ambiguity and not-found when explicitly expected', () => {
    expect(run({ expectedStatus: 'ambiguous', requiredCandidateIds: ['R1', 'R2'], expectedCandidateCount: 2 }, ambiguous).status).toBe('pass')
    expect(run({ expectedStatus: 'not-found' }, notFound).status).toBe('pass')
  })

  it('regresses when an ambiguous or not-found response is returned where graph evidence is required', () => {
    const amb = run({ requiredNodeIds: ['A'] }, ambiguous)
    expect(amb.status).toBe('fail')
    expect(amb.message).toContain('Android selector returned "ambiguous" with no graph')
    expect(run({ forbiddenNodeIds: ['Z'] }, notFound).status).toBe('fail')
    expect(run({ connectedPaths: [{ nodeIds: ['A', 'B'], edgeKinds: ['x'] }] }, ambiguous).status).toBe('fail')
  })

  it('regresses when ambiguity or absence was expected but a graph was returned', () => {
    expect(run({ expectedStatus: 'ambiguous' }, chain).status).toBe('fail')
    expect(run({ expectedStatus: 'not-found' }, chain).status).toBe('fail')
    expect(run({ expectedStatus: 'ok' }, chain).status).toBe('pass')
    expect(run({ expectedStatus: 'ok' }, ambiguous).status).toBe('fail')
  })

  it('checks candidate counts and required candidates for an Android ambiguity', () => {
    const result = run({ expectedStatus: 'ambiguous', requiredCandidateIds: ['R9'], expectedCandidateCount: 3 }, ambiguous)
    expect(result.status).toBe('fail')
    expect(result.message).toContain('required candidate "R9" not found')
    expect(result.message).toContain('expected 3 candidate(s) but observed 2')
  })

  it('blocks malformed Android selector outcomes', () => {
    expect(run({ expectedStatus: 'ambiguous' }, { ...ambiguous, candidates: 'R1' }).status).toBe('blocked')
    expect(run({ expectedStatus: 'ambiguous' }, { ...ambiguous, candidates: [{ kind: 'x' }] }).status).toBe('blocked')
    expect(run({ expectedStatus: 'ambiguous' }, { ...ambiguous, candidates: ambiguous.candidates.slice(0, 1) }).status).toBe('blocked')
    expect(run({ expectedStatus: 'not-found' }, { ...notFound, candidates: ambiguous.candidates }).status).toBe('blocked')
  })

  const dataFlow = (truncated: unknown) => ({ requested: true, seedNodeCount: 1, maxDepth: 3, allowedEdgeKinds: [], addedNodeCount: 2, addedEdgeCount: 2, truncated })
  const tests = (related: number, truncated = false) => ({ requested: true, productionSeedCount: 2, relatedTestMethodCount: related, addedNodeCount: 1, addedEdgeCount: 1, truncated })

  it('compares the androidDataFlow truncated state and blocks when the summary is absent or invalid', () => {
    expect(run({ expectedDataFlowTruncated: false }, { ...chain, androidDataFlow: dataFlow(false) }).status).toBe('pass')
    expect(run({ expectedDataFlowTruncated: true }, { ...chain, androidDataFlow: dataFlow(true) }).status).toBe('pass')
    const mismatch = run({ expectedDataFlowTruncated: false }, { ...chain, androidDataFlow: dataFlow(true) })
    expect(mismatch.status).toBe('fail')
    expect(mismatch.message).toContain('expected androidDataFlow.truncated false but observed true')
    expect(run({ expectedDataFlowTruncated: false }, chain).status).toBe('blocked')
    expect(run({ expectedDataFlowTruncated: false }, { ...chain, androidDataFlow: dataFlow('no') }).status).toBe('blocked')
    expect(run({ expectedDataFlowTruncated: false }, { ...chain, androidDataFlow: { ...dataFlow(false), requested: false } }).status).toBe('blocked')
  })

  it('requires a valid requested androidTests summary with related tests, and never infers execution from it', () => {
    const ok = run({ requireAndroidTests: true }, { ...chain, androidTests: tests(2) })
    expect(ok.status).toBe('pass')
    expect(ok.actualSummary).toContain('relatedTestMethodCount=2')
    expect(run({ requireAndroidTests: true }, { ...chain, androidTests: tests(0) }).status).toBe('fail')
    expect(run({ requireAndroidTests: true }, chain).status).toBe('blocked')
    expect(run({ requireAndroidTests: true }, { ...chain, androidTests: { requested: true } }).status).toBe('blocked')
    expect(run({ requireAndroidTests: true }, { ...chain, androidTests: { ...tests(1), requested: false } }).status).toBe('blocked')
  })

  it('keeps required severity unless the task opts into a warning, and never downgrades a block', () => {
    expect(run({ requiredNodeIds: ['Q'] }, chain)).toMatchObject({ status: 'fail', severity: 'required' })
    expect(run({ requiredNodeIds: ['Q'] }, chain, { required: false })).toMatchObject({ status: 'fail', severity: 'warning' })
    expect(run({ requiredNodeIds: ['Q'] }, '{', { required: false })).toMatchObject({ status: 'blocked', severity: 'required' })
  })

  it('does not embed graph payloads in the assertion result', () => {
    const result = run({ requiredNodeIds: ['A'] }, chain)
    expect(JSON.stringify(result).length).toBeLessThan(800)
    expect(result.actualSummary).not.toContain('"label"')
  })
})
