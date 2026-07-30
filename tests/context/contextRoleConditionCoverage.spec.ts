import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  evaluateRoleConditionCoverage,
  type RoleConditionCoverageEvidenceGroup,
} from '../../src/context/roleConditionCoverage.js'
import { findRawEvidenceParityIssues } from '../../src/context/rawEvidenceParity.js'
import type {
  ContextCapsule,
  EvidenceItemRef,
  RetrievalAuditRecord,
  RoleConditionCoverage,
} from '../../src/context/types.js'
import { runCli } from '../lookup/testCli.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function evidence(id: string, path = 'src/evidence.ts'): EvidenceItemRef {
  return {
    id,
    itemKind: id.startsWith('symbol:') ? 'symbol' : 'file',
    path,
    nodeId: id.startsWith('symbol:') ? id : undefined,
    relationship: 'qualified-condition-witness',
    basis: 'focused condition-coverage test',
    provenance: 'test-fixture',
  }
}

function group(
  groupId: string,
  availableItems: readonly EvidenceItemRef[],
  retainedItems: readonly EvidenceItemRef[]
): RoleConditionCoverageEvidenceGroup {
  return { groupId, availableItems, retainedItems }
}

function evaluate(evidenceGroups: readonly RoleConditionCoverageEvidenceGroup[]): RoleConditionCoverage[] {
  return evaluateRoleConditionCoverage({ role: 'implementation', evidenceGroups })
}

function findCondition(
  coverage: readonly RoleConditionCoverage[],
  conditionId: RoleConditionCoverage['conditionId']
): RoleConditionCoverage {
  const condition = coverage.find((entry) => entry.conditionId === conditionId)
  if (!condition) throw new Error(`condition ${conditionId} not found`)
  return condition
}

describe('role condition coverage contract', () => {
  it('retains owner coverage when surplus adequate owner candidates are omitted', () => {
    const ownerA = evidence('symbol:src/owner.ts#OwnerA', 'src/owner.ts')
    const ownerB = evidence('symbol:src/owner.ts#OwnerB', 'src/owner.ts')
    const owner = findCondition(
      evaluate([group('implementation-owners', [ownerA, ownerB], [ownerB])]),
      'implementation.selected-owner'
    )

    expect(owner).toMatchObject({
      requiredWitnessCount: 1,
      availableWitnessCount: 2,
      retainedWitnessCount: 1,
      conditionSatisfied: true,
      lostRequiredCondition: false,
      lossReason: null,
    })
  })

  it('retains contract coverage when surplus adequate contract candidates are omitted', () => {
    const contractA = evidence('symbol:src/contracts.ts#ContractA', 'src/contracts.ts')
    const contractB = evidence('symbol:src/contracts.ts#ContractB', 'src/contracts.ts')
    const contract = findCondition(
      evaluate([group('implementation-contracts', [contractA, contractB], [contractA])]),
      'implementation.required-contract'
    )

    expect(contract).toMatchObject({
      requiredWitnessCount: 1,
      availableWitnessCount: 2,
      retainedWitnessCount: 1,
      conditionSatisfied: true,
      lostRequiredCondition: false,
      lossReason: null,
    })
  })

  it('reports loss when bounded allocation omits the last adequate required witness', () => {
    const owner = evidence('symbol:src/owner.ts#Owner', 'src/owner.ts')
    const condition = findCondition(
      evaluate([group('implementation-owners', [owner], [])]),
      'implementation.selected-owner'
    )

    expect(condition.conditionSatisfied).toBe(false)
    expect(condition.lostRequiredCondition).toBe(true)
    expect(condition.lossReason).toBe('bounded-allocation-omitted-required-witnesses')
  })

  it('does not report allocation loss when no adequate candidate existed', () => {
    const condition = findCondition(
      evaluate([group('implementation-owners', [], [])]),
      'implementation.selected-owner'
    )

    expect(condition.availableWitnessCount).toBe(0)
    expect(condition.conditionSatisfied).toBe(false)
    expect(condition.lostRequiredCondition).toBe(false)
    expect(condition.lossReason).toBeNull()
  })

  it('does not turn overflow unrelated to a defined condition into required-condition loss', () => {
    const overflow = [evidence('symbol:src/optional.ts#A'), evidence('symbol:src/optional.ts#B')]
    const coverage = evaluate([group('implementation-optional-support', overflow, [])])

    expect(coverage.every((condition) => condition.lostRequiredCondition === false)).toBe(true)
  })

  it('does not infer a required compatibility condition from compatibility-surface overflow', () => {
    const compatibility = [
      evidence('symbol:src/public.ts#PublicA', 'src/public.ts'),
      evidence('symbol:src/public.ts#PublicB', 'src/public.ts'),
    ]
    const coverage = evaluate([
      group('implementation-compatibility-surfaces', compatibility, [compatibility[0]]),
    ])

    expect(coverage.map((condition) => condition.conditionId)).toEqual([
      'implementation.selected-owner',
      'implementation.required-contract',
    ])
    expect(coverage.every((condition) => condition.lostRequiredCondition === false)).toBe(true)
  })

  it('orders conditions and retained witness identities deterministically', () => {
    const ownerA = evidence('symbol:src/owner.ts#A', 'src/owner.ts')
    const ownerB = evidence('symbol:src/owner.ts#B', 'src/owner.ts')
    const contractA = evidence('symbol:src/contracts.ts#A', 'src/contracts.ts')
    const contractB = evidence('symbol:src/contracts.ts#B', 'src/contracts.ts')
    const first = evaluate([
      group('implementation-contracts', [contractB, contractA], [contractB, contractA]),
      group('implementation-owners', [ownerB, ownerA], [ownerB, ownerA]),
    ])
    const second = evaluate([
      group('implementation-owners', [ownerA, ownerB], [ownerA, ownerB]),
      group('implementation-contracts', [contractA, contractB], [contractA, contractB]),
    ])

    expect(first).toEqual(second)
    expect(first.map((condition) => condition.conditionId)).toEqual([
      'implementation.selected-owner',
      'implementation.required-contract',
    ])
    expect(first[0].retainedWitnessIds).toEqual([
      'symbol:src/owner.ts#A',
      'symbol:src/owner.ts#B',
    ])
  })

  it('uses canonical evidence IDs rather than paths or ranking positions as witness identity', () => {
    const owner = evidence('symbol:src/owner.ts#CanonicalOwner', 'src/owner.ts')
    const condition = findCondition(
      evaluate([group('implementation-owners', [owner], [owner])]),
      'implementation.selected-owner'
    )

    expect(condition.retainedWitnessIds).toEqual(['symbol:src/owner.ts#CanonicalOwner'])
    expect(condition.retainedWitnessIds).not.toContain('src/owner.ts')
  })

  it('serializes identical shared condition coverage in the capsule and audit', () => {
    const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-role-condition-coverage-'))
    tempDirs.push(root)
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(
      join(src, 'widgetRegistry.ts'),
      [
        'export interface WidgetContract { id: string }',
        'export function resolveWidget(id: string): WidgetContract {',
        '  return { id }',
        '}',
        '',
      ].join('\n')
    )

    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut, '--call-graph']).status).toBe(0)
    const capsulePath = join(root, 'capsule.json')
    const auditPath = join(root, 'audit.json')
    const requestPath = join(root, 'request.json')
    writeFileSync(
      requestPath,
      JSON.stringify({
        schemaVersion: '1.0.0',
        role: 'implementation',
        query: 'Locate the widget registry owner and WidgetContract',
        index: indexOut,
        focusFiles: ['src/widgetRegistry.ts'],
        output: capsulePath,
        auditOutput: auditPath,
      })
    )

    expect(runCli(['context', '--request', requestPath]).status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsulePath, 'utf8')) as ContextCapsule
    const audit = JSON.parse(readFileSync(auditPath, 'utf8')) as RetrievalAuditRecord

    expect(capsule.roleConditionCoverage).toEqual(audit.roleConditionCoverage)
    expect(capsule.roleConditionCoverage?.map((condition) => condition.conditionId)).toEqual([
      'implementation.selected-owner',
      'implementation.required-contract',
    ])
    expect(findRawEvidenceParityIssues(capsule, audit)).toEqual([])
  })

  it('accepts a schema-major-1 legacy pair when condition coverage is absent from both artifacts', () => {
    const shared = {
      schemaVersion: '1.0.0',
      tool: { name: 'my-dev-kit', version: '1.10.3' },
      request: {},
      index: {
        indexPath: 'C:/repo/index',
        manifestPath: 'C:/repo/index/manifest.json',
        manifestSchemaVersion: '1.0.0',
        projectRoot: 'C:/repo',
      },
    }
    const capsule = { ...structuredClone(shared) } as unknown as ContextCapsule
    const audit = { ...structuredClone(shared) } as unknown as RetrievalAuditRecord

    expect(capsule.roleConditionCoverage).toBeUndefined()
    expect(audit.roleConditionCoverage).toBeUndefined()
    expect(findRawEvidenceParityIssues(capsule, audit)).toEqual([])
  })
})
