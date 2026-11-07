import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
// Qualification is an internal executable JS harness, not a production TS API.
// @ts-ignore No declaration file is published for internal qualification scripts.
import { calculateMetrics, matches, qualify, approvedRoot } from '../../scripts/qualification/v115ApiRelationshipQualification.mjs'

describe('source-grounded API relationship qualification', () => {
  let result: any
  beforeAll(async () => { result = await qualify(resolve(approvedRoot)) })

  it('executes every independently annotated source case through authentic indexes', () => {
    const truth = JSON.parse(readFileSync('tests/fixtures/api-relationships/v1/qualification/expected-facts.json', 'utf8'))
    expect(result.classifications.map((c: any) => c.id).sort()).toEqual(truth.facts.map((c: any) => c.id).sort())
    expect(result.groundTruthCases).toBe(66)
    expect(result.failures).toEqual([])
    expect(result.unexpected).toEqual([])
  })
  it('retains all uncertainty and unsupported boundaries without resolved promotion', () => {
    expect(result.uncertainty).toEqual({ cases: 15, correct: 15, falseResolved: [] })
  })
  it('measures returned impact recall without hiding bounded omissions', () => {
    const m = result.metrics['Source-change impact candidates']
    expect(m).toMatchObject({ truePositives: 8, falsePositives: 0, falseNegatives: 2, precision: 1, recall: 0.8, recallDenominator: 10 })
    const omitted = result.classifications.filter((c: any) => c.result === 'FN')
    expect(omitted.map((c: any) => c.id)).toEqual(['B4-058', 'B4-060'])
    expect(omitted.every((c: any) => c.boundedOmission && c.omittedIds.length)).toBe(true)
    expect(result.impact.projection.summary).toMatchObject({ availableImpactCount: 73, returnedImpactCount: 64, truncated: true, complete: false })
  })
  it('checks real extraction repeatability, witness integrity, bounds and invalid inputs', () => {
    expect(result.checks.length).toBeGreaterThan(30)
    expect(result.checks.filter((c: any) => !c.pass)).toEqual([])
    expect(result.checks.some((c: any) => c.id === 'producer-repeat')).toBe(true)
    expect(result.checks.some((c: any) => c.id === 'selected-universe-omission')).toBe(true)
  })
  it('uses independently supplied counts in both metric denominators', () => {
    expect(calculateMetrics(3, 1, 2)).toMatchObject({ precision: 0.75, recall: 0.6, precisionDenominator: 4, recallDenominator: 5 })
  })
  it('reports undefined precision and recall as null', () => {
    expect(calculateMetrics(0, 0, 0)).toMatchObject({ precision: null, recall: null })
    expect(calculateMetrics(0, 2, 0)).toMatchObject({ precision: 0, recall: null })
    expect(calculateMetrics(0, 0, 2)).toMatchObject({ precision: null, recall: 0 })
  })
  it('rejects a wrong declaration even when its display name is the same', () => {
    const artifact = { nodes: [{ id: 'entity', symbolId: 'symbol:src/model.ts#User' }], relationships: [] }
    expect(matches({ target: 'symbol:src/decoy.ts#User' }, { target: 'entity', witnesses: [] }, artifact)).toBe(false)
    expect(matches({ target: 'symbol:src/model.ts#User' }, { target: 'entity', witnesses: [] }, artifact)).toBe(true)
  })
  it('matches an effective mount only through the exact endpoint association', () => {
    const artifact = { nodes: [{ id: 'route', value: '/users' }], relationships: [{ kind: 'api-endpoint-handled-by', source: 'route', path: '/api/users' }] }
    expect(matches({ targetPath: '/api/users' }, { target: 'route', witnesses: [] }, artifact)).toBe(true)
    expect(matches({ targetPath: '/other/users' }, { target: 'route', witnesses: [] }, artifact)).toBe(false)
    expect(matches({ targetPath: '/api/users' }, { target: 'different-route', witnesses: [] }, artifact)).toBe(false)
  })
  it('keeps method and path case exact in qualification matching', () => {
    const artifact = { nodes: [], relationships: [] }
    expect(matches({ method: 'POST', path: '/users' }, { method: 'GET', path: '/users', witnesses: [] }, artifact)).toBe(false)
    expect(matches({ method: 'GET', path: '/Users' }, { method: 'GET', path: '/users', witnesses: [] }, artifact)).toBe(false)
  })
})
