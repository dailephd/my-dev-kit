import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function createFixture(prefix: string, redundantTestCount: number, includeLateCoverageTest = false) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(root)
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'readinessTypes.ts'), 'export interface ReadinessContract { ready: boolean }\n')
  writeFileSync(
    join(src, 'readinessValidator.ts'),
    [
      "import type { ReadinessContract } from './readinessTypes'",
      'export function validateReadiness(value: ReadinessContract): boolean { return value.ready }',
      '',
    ].join('\n')
  )
  for (let index = 0; index < redundantTestCount; index++) {
    const suffix = String(index).padStart(3, '0')
    writeFileSync(
      join(src, `readiness-${suffix}.test.ts`),
      [
        "import { validateReadiness } from './readinessValidator'",
        `export const observed${suffix} = validateReadiness({ ready: true })`,
        '',
      ].join('\n')
    )
  }
  if (includeLateCoverageTest) {
    writeFileSync(
      join(src, 'zz-readiness-contract.test.ts'),
      [
        "import type { ReadinessContract } from './readinessTypes'",
        'export const contractWitness: ReadinessContract = { ready: true }',
        '',
      ].join('\n')
    )
  }
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'test-required-evidence-fixture',
        version: '0.0.0',
        scripts: { test: 'vitest run' },
      },
      null,
      2
    )
  )

  const indexOut = join(root, '.my-dev-kit')
  expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)
  return { root, indexOut }
}

function runRequest(
  root: string,
  indexOut: string,
  name: string,
  testResponsibilityRefs: string[] | undefined
) {
  const output = join(root, `${name}.capsule.json`)
  const auditOutput = join(root, `${name}.audit.json`)
  const request = {
    schemaVersion: '1.0.0',
    role: 'test-implementation',
    mode: 'subsystem',
    query: 'readiness contract validator',
    index: indexOut,
    output,
    auditOutput,
    focusFiles: ['src/readinessTypes.ts', 'src/readinessValidator.ts'],
    focusSymbols: [
      'symbol:src/readinessTypes.ts#ReadinessContract',
      'symbol:src/readinessValidator.ts#validateReadiness',
    ],
    changedFiles: ['src/readinessTypes.ts', 'src/readinessValidator.ts'],
    changedSymbols: [
      'symbol:src/readinessTypes.ts#ReadinessContract',
      'symbol:src/readinessValidator.ts#validateReadiness',
    ],
    ...(testResponsibilityRefs ? { testResponsibilityRefs } : {}),
    requestedEvidenceKinds: [
      'contracts',
      'validators',
      'closest-tests',
      'test-infrastructure',
      'test-commands',
      'changed-surface',
      'responsibility-mappings',
    ],
  }
  const requestPath = join(root, `${name}.request.json`)
  writeFileSync(requestPath, JSON.stringify(request, null, 2))
  expect(runCli(['context', '--request', requestPath]).status).toBe(0)
  return {
    capsule: JSON.parse(readFileSync(output, 'utf8')),
    audit: JSON.parse(readFileSync(auditOutput, 'utf8')),
    requestPath,
  }
}

function group(capsule: any, kind: string): any {
  const found = capsule.evidenceGroups.find((candidate: { kind: string }) => candidate.kind === kind)
  if (!found) throw new Error(`Missing evidence group "${kind}"`)
  return found
}

describe('test-role required evidence allocation', () => {
  it('retains 45 compact required test references through bounded spillover and fully maps all supplied responsibilities', () => {
    const { root, indexOut } = createFixture('my-dev-kit-test-required-45-', 45)
    const responsibilityIds = Array.from({ length: 20 }, (_, index) => `TST-${String(index + 1).padStart(3, '0')}`)
    const first = runRequest(root, indexOut, 'main', responsibilityIds)

    const related = group(first.capsule, 'related-tests')
    const relatedDiagnostics = first.capsule.groupTruncation.find(
      (candidate: { groupId: string }) => candidate.groupId === related.id
    )
    expect(related.availableCount).toBe(45)
    expect(related.usedCount).toBe(45)
    expect(related.truncated).toBe(false)
    expect(relatedDiagnostics.reservation).toBe(20)
    expect(relatedDiagnostics.borrowedCapacity).toBe(25)
    expect(relatedDiagnostics.governingHardBound).toBe(118)
    expect(new Set(related.items.map((item: { id: string }) => item.id)).size).toBe(45)
    expect(related.items.every((item: Record<string, unknown>) => !('source' in item) && !('content' in item))).toBe(true)

    expect(group(first.capsule, 'contracts').usedCount).toBeGreaterThan(0)
    expect(first.capsule.responsibilityMappings.mappings).toHaveLength(20)
    expect(
      first.capsule.responsibilityMappings.mappings.every(
        (mapping: { mappingStatus: string }) => mapping.mappingStatus === 'mapped'
      )
    ).toBe(true)
    expect(first.capsule.truncation.truncated).toBe(false)
    expect(first.capsule.roleAdequacy.status).toBe('context sufficient with listed assumptions')
    expect(first.audit.responsibilityMappings).toEqual(first.capsule.responsibilityMappings)
    expect(first.audit.roleAdequacy).toEqual(first.capsule.roleAdequacy)
    expect(first.audit.truncation).toEqual(first.capsule.truncation)

    const firstStable = structuredClone(first)
    const second = runRequest(root, indexOut, 'main', responsibilityIds)
    delete firstStable.capsule.generatedAt
    delete firstStable.audit.generatedAt
    delete second.capsule.generatedAt
    delete second.audit.generatedAt
    expect(second.capsule).toEqual(firstStable.capsule)
    expect(second.audit).toEqual(firstStable.audit)

    const withoutResponsibilities = runRequest(root, indexOut, 'without-responsibilities', undefined)
    expect(withoutResponsibilities.capsule.responsibilityMappings.operational).toBe(false)
    expect(withoutResponsibilities.capsule.responsibilityMappings.mappings).toEqual([])
    expect(withoutResponsibilities.capsule.roleAdequacy.status).toBe('context sufficient with listed assumptions')

    const withDuplicates = runRequest(root, indexOut, 'duplicates', ['TST-002', 'TST-001', 'TST-002'])
    expect(withDuplicates.capsule.responsibilityMappings.duplicateResponsibilityIds).toEqual(['TST-002'])
    expect(
      withDuplicates.capsule.responsibilityMappings.mappings.map(
        (mapping: { responsibilityId: string }) => mapping.responsibilityId
      )
    ).toEqual(['TST-002', 'TST-001'])
  })

  it('prioritizes a breadth-adding late witness and reports exact identities when the aggregate bound genuinely overflows', () => {
    const { root, indexOut } = createFixture('my-dev-kit-test-required-overflow-', 140, true)
    const result = runRequest(root, indexOut, 'overflow', ['TST-001'])
    const related = group(result.capsule, 'related-tests')
    const diagnostics = result.capsule.groupTruncation.find(
      (candidate: { groupId: string }) => candidate.groupId === related.id
    )
    const retainedIds = related.items.map((item: { id: string }) => item.id)

    expect(related.availableCount).toBe(141)
    expect(related.truncated).toBe(true)
    expect(retainedIds).toContain('src/zz-readiness-contract.test.ts')
    expect(diagnostics.requiredOmittedCount).toBeGreaterThan(0)
    expect(diagnostics.aggregateCapacityRemaining).toBe(0)
    expect(diagnostics.droppedEvidenceIds.length).toBe(diagnostics.droppedCount)
    expect(diagnostics.droppedEvidenceIds).not.toContain('src/zz-readiness-contract.test.ts')

    const record = result.capsule.truncation.records.find(
      (candidate: { affectedGroup: string }) => candidate.affectedGroup === related.id
    )
    expect(record.requiredEvidenceLost).toBe(true)
    expect(record.droppedEvidenceIds).toEqual(diagnostics.droppedEvidenceIds)
    expect(result.capsule.roleAdequacy.missingConditions).toContain('required evidence truncated')
    expect(result.capsule.roleAdequacy.status).toBe('context insufficient and more retrieval required')
    expect(result.audit.truncation).toEqual(result.capsule.truncation)
  })
})
