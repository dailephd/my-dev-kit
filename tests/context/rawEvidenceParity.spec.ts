import { describe, expect, it } from 'vitest'
import {
  assertRawEvidenceParity,
  findRawEvidenceParityIssues,
  RAW_EVIDENCE_PARITY_ERROR_CODE,
  type RawEvidenceParityField,
} from '../../src/context/rawEvidenceParity.js'
import type { ContextCapsule, RetrievalAuditRecord } from '../../src/context/types.js'

function matchingPair(): { capsule: ContextCapsule; audit: RetrievalAuditRecord } {
  const shared = {
    schemaVersion: '1.0.0',
    tool: { name: 'my-dev-kit', version: '1.10.2' },
    request: {
      originalQuery: 'identity',
      normalizedQuery: 'identity',
      mode: 'feature-add',
      requestedOutputPath: 'C:/repo/capsule.json',
      role: 'implementation',
      requestFilePath: 'C:/repo/request.json',
    },
    contextAdequacy: { status: 'context sufficient with listed assumptions' },
    roleContext: { role: 'implementation' },
    responsibilityMappings: { mappings: [], truncated: false },
    roleAdequacy: { status: 'context sufficient with listed assumptions' },
    freshness: {
      state: 'fresh',
      comparedIdentities: [
        { label: 'activeIndexPath', value: 'C:/repo/after' },
        { label: 'beforeIndexPath', value: 'C:/repo/before' },
        { label: 'afterIndexPath', value: 'C:/repo/after' },
      ],
    },
    budget: { limits: [] },
    truncation: { truncated: false, records: [] },
    fullFileFallback: { used: 0 },
    provenance: [{ id: 'prov-1' }],
    roleConditionCoverage: [
      {
        conditionId: 'implementation.selected-owner',
        role: 'implementation',
        required: true,
        evidenceGroupIds: ['implementation-owners'],
        witnessPolicy: 'at-least-one',
        requiredWitnessCount: 1,
        availableWitnessCount: 2,
        retainedWitnessCount: 1,
        retainedWitnessIds: ['symbol:src/owner.ts#Owner'],
        conditionSatisfied: true,
        lostRequiredCondition: false,
        lossReason: null,
        evaluationOrder: 10,
      },
    ],
  }
  const index = {
    indexPath: 'C:/repo/after',
    manifestPath: 'C:/repo/after/manifest.json',
    manifestSchemaVersion: '1.0.0',
    projectRoot: 'C:/repo',
  }

  return {
    capsule: { ...structuredClone(shared), index: { ...index, artifactRefs: [] } } as unknown as ContextCapsule,
    audit: { ...structuredClone(shared), index: { ...index } } as unknown as RetrievalAuditRecord,
  }
}

function expectOnlyMismatch(
  mutate: (capsule: ContextCapsule, audit: RetrievalAuditRecord) => void,
  field: RawEvidenceParityField
): void {
  const { capsule, audit } = matchingPair()
  mutate(capsule, audit)
  expect(findRawEvidenceParityIssues(capsule, audit).map((issue) => issue.field)).toEqual([field])
}

describe('raw evidence producer parity', () => {
  it('accepts a fully matching current pair', () => {
    const { capsule, audit } = matchingPair()
    expect(findRawEvidenceParityIssues(capsule, audit)).toEqual([])
    expect(() => assertRawEvidenceParity(capsule, audit)).not.toThrow()
  })

  it('rejects wrong repository, active index, and after-index pairs', () => {
    expectOnlyMismatch((_capsule, audit) => {
      audit.index.projectRoot = 'C:/other'
    }, 'index.projectRoot')
    expectOnlyMismatch((_capsule, audit) => {
      audit.index.indexPath = 'C:/repo/other-index'
    }, 'index.indexPath')
    expectOnlyMismatch((_capsule, audit) => {
      audit.freshness = {
        ...audit.freshness,
        comparedIdentities: audit.freshness.comparedIdentities.map((identity) =>
          identity.label === 'afterIndexPath' ? { ...identity, value: 'C:/repo/other-after' } : identity
        ),
      }
    }, 'freshness')
  })

  it.each([
    ['contextAdequacy', (audit: RetrievalAuditRecord) => { audit.contextAdequacy = { ...audit.contextAdequacy, summary: 'different' } }],
    ['roleConditionCoverage', (audit: RetrievalAuditRecord) => { audit.roleConditionCoverage = [] }],
    ['responsibilityMappings', (audit: RetrievalAuditRecord) => { audit.responsibilityMappings = { ...audit.responsibilityMappings, truncated: true } }],
    ['roleAdequacy', (audit: RetrievalAuditRecord) => { audit.roleAdequacy = { ...audit.roleAdequacy, freshnessImpact: true } }],
    ['freshness', (audit: RetrievalAuditRecord) => { audit.freshness = { ...audit.freshness, state: 'stale' } }],
    ['truncation', (audit: RetrievalAuditRecord) => { audit.truncation = { ...audit.truncation, truncated: true } }],
    ['fullFileFallback', (audit: RetrievalAuditRecord) => { audit.fullFileFallback = { ...audit.fullFileFallback, used: 1 } }],
    ['provenance', (audit: RetrievalAuditRecord) => { audit.provenance = [] }],
  ] as const)('rejects a contradictory %s summary', (field, mutate) => {
    expectOnlyMismatch((_capsule, audit) => mutate(audit), field)
  })

  it('keeps issue ordering deterministic and emits an actionable contract code', () => {
    const { capsule, audit } = matchingPair()
    audit.index.projectRoot = 'C:/other'
    audit.freshness = { ...audit.freshness, state: 'stale' }
    audit.provenance = []

    expect(findRawEvidenceParityIssues(capsule, audit).map((issue) => issue.field)).toEqual([
      'index.projectRoot',
      'freshness',
      'provenance',
    ])
    expect(() => assertRawEvidenceParity(capsule, audit)).toThrow(
      new RegExp(`${RAW_EVIDENCE_PARITY_ERROR_CODE}.*index\\.projectRoot, freshness, provenance`)
    )
  })

  it('does not invent identity for a legacy audit and classifies the absence as a mismatch', () => {
    const { capsule, audit } = matchingPair()
    delete audit.index.projectRoot
    delete audit.index.manifestSchemaVersion

    expect(audit.index.projectRoot).toBeUndefined()
    expect(findRawEvidenceParityIssues(capsule, audit).map((issue) => issue.field)).toEqual([
      'index.manifestSchemaVersion',
      'index.projectRoot',
    ])
  })

  it('keeps a both-absent legacy condition-coverage field compatible without hiding one-sided absence', () => {
    const { capsule, audit } = matchingPair()
    delete capsule.roleConditionCoverage
    delete audit.roleConditionCoverage
    expect(findRawEvidenceParityIssues(capsule, audit)).toEqual([])

    audit.roleConditionCoverage = []
    expect(findRawEvidenceParityIssues(capsule, audit).map((issue) => issue.field)).toEqual([
      'roleConditionCoverage',
    ])
  })
})
