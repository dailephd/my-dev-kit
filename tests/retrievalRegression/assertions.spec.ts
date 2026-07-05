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
