import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

/**
 * v1.10.3 final producer integration gate (Batch 4, section 20).
 *
 * One focused suite exercising the complete public `context --request` pipeline —
 * request parsing, owner eligibility (Batch 1), evidence grouping with corrected
 * directed dependency/caller classification (Batch 4), required-first allocation
 * (Batch 2), responsibility mapping and duplicate diagnostics (Batch 3), adequacy,
 * and capsule/retrieval-audit parity — against the shape of every my-dev-kit-owned
 * frozen Stage 0 case (CASE-001 through CASE-006, CASE-012). Deliberately does not
 * re-assert every lower-level behavior already covered by
 * contextEvidenceGroups.spec.ts / contextRequiredAllocation.spec.ts /
 * contextResponsibilityDuplicates.spec.ts / contextDirectedEvidence.spec.ts.
 * Responsibility IDs: TST-B1304-INT-001..007.
 */

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function createTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(root)
  return root
}

function writeRequest(root: string, name: string, body: unknown): string {
  const filePath = join(root, name)
  writeFileSync(filePath, JSON.stringify(body, null, 2))
  return filePath
}

function runContextWithAudit(indexOut: string, requestPath: string, outPath: string, auditPath: string) {
  return runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath, '--audit-out', auditPath])
}

const SHARED_SUMMARY_FIELDS = [
  'roleContext',
  'evidenceGroups',
  'selectedOwners',
  'selectedContracts',
  'selectedTests',
  'unresolvedItems',
  'responsibilityMappings',
  'roleAdequacy',
  'freshness',
  'budget',
  'truncation',
  'groupTruncation',
  'fullFileFallback',
  'provenance',
] as const

function assertCapsuleAuditParity(capsule: Record<string, unknown>, audit: Record<string, unknown>): void {
  for (const field of SHARED_SUMMARY_FIELDS) {
    if (!(field in capsule)) continue // groupTruncation is capsule-only (raw per-group diagnostics); skip if absent from audit's shape
    if (!(field in audit)) continue
    expect(audit[field]).toEqual(capsule[field])
  }
}

describe('my-dev-kit v1.10.3 final producer integration matrix', () => {
  it('TST-B1304-INT-001 (CASE-001 shape): neutral owner + corrected directed evidence + full allocation is adequate end to end', () => {
    const root = createTempRoot('my-dev-kit-v1-int-case001-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'types.ts'), 'export interface Profile {\n  id: string\n}\n')
    writeFileSync(join(src, 'profiles.ts'), "import type { Profile } from './types'\n\nexport const profiles: Profile[] = [{ id: 'alpha' }]\n")
    writeFileSync(join(src, 'resolver.ts'), "import { profiles } from './profiles'\n\nexport function resolveProfile(id: string) {\n  return profiles.find((p) => p.id === id)\n}\n")
    writeFileSync(join(src, 'consumer.ts'), "import { resolveProfile } from './resolver'\n\nexport const found = resolveProfile('alpha')\n")

    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate the canonical profile registry and resolver owners',
      focusFiles: ['src/profiles.ts', 'src/resolver.ts'],
      focusSymbols: ['symbol:src/profiles.ts#profiles', 'symbol:src/resolver.ts#resolveProfile'],
    })
    const capsuleOut = join(root, 'capsule.json')
    const auditOut = join(root, 'audit.json')
    const result = runContextWithAudit(indexOut, requestPath, capsuleOut, auditOut)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    const audit = JSON.parse(readFileSync(auditOut, 'utf8'))

    const ownerPaths = capsule.selectedOwners.map((o: { path?: string }) => o.path)
    expect(ownerPaths).toContain('src/profiles.ts')
    expect(ownerPaths).toContain('src/resolver.ts')

    // Corrected directed evidence (Batch 4): resolver.ts's true dependency (profiles.ts)
    // is classified as a dependency; consumer.ts (which depends on resolver.ts) is not.
    const dependencies = capsule.evidenceGroups.find((g: { kind: string }) => g.kind === 'dependencies')
    const dependencyPaths = dependencies.items.map((i: { path?: string }) => i.path)
    expect(dependencyPaths).not.toContain('src/consumer.ts')

    for (const g of capsule.groupTruncation as { truncated: boolean }[]) expect(g.truncated).toBe(false)
    expect(capsule.roleAdequacy.status).toBe('context sufficient with listed assumptions')
    expect(capsule.roleAdequacy.missingConditions).not.toContain('owner missing')
    expect(capsule.roleAdequacy.missingConditions).not.toContain('required evidence truncated')

    assertCapsuleAuditParity(capsule, audit)
  })

  it('TST-B1304-INT-002 (CASE-002 shape): a focused, owner-named generated test file establishes no ownership and context remains inadequate', () => {
    const root = createTempRoot('my-dev-kit-v1-int-case002-')
    const src = join(root, 'src')
    const tests = join(root, 'tests')
    mkdirSync(src, { recursive: true })
    mkdirSync(tests, { recursive: true })
    writeFileSync(join(src, 'unrelated.ts'), 'export const unrelated = 1\n')
    writeFileSync(join(tests, 'generatedManager.ts'), "export const generatedFixture = 'not-a-production-owner'\n")

    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--src', 'tests', '--out', indexOut]).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Inspect generated fixture evidence',
      focusFiles: ['tests/generatedManager.ts'],
      focusSymbols: ['symbol:tests/generatedManager.ts#generatedFixture'],
    })
    const capsuleOut = join(root, 'capsule.json')
    const auditOut = join(root, 'audit.json')
    const result = runContextWithAudit(indexOut, requestPath, capsuleOut, auditOut)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    const audit = JSON.parse(readFileSync(auditOut, 'utf8'))

    expect(capsule.selectedOwners.length).toBe(0)
    expect(capsule.roleAdequacy.missingConditions).toContain('owner missing')
    expect(capsule.roleAdequacy.blockingConditions).toContain('owner missing')
    expect(capsule.roleAdequacy.status).toBe('context insufficient and more retrieval required')

    assertCapsuleAuditParity(capsule, audit)
  })

  it('TST-B1304-INT-003 (CASE-003 shape): multiple credible owners retained in bounded deterministic order with correct directed relationships', () => {
    const root = createTempRoot('my-dev-kit-v1-int-case003-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'contract.ts'), 'export type Resolution = { found: boolean }\n')
    writeFileSync(join(src, 'resolver.ts'), "import type { Resolution } from './contract'\n\nexport function resolve(id: string): Resolution {\n  return { found: id.length > 0 }\n}\n")
    writeFileSync(join(src, 'registry.ts'), "import { resolve } from './resolver'\n\nexport const registryEntry = resolve('alpha')\n")
    writeFileSync(join(src, 'producer.ts'), "import { registryEntry } from './registry'\n\nexport const produced = registryEntry\n")
    writeFileSync(join(src, 'consumer.ts'), "import { produced } from './producer'\n\nexport const value = produced\n")

    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate all credible owners in this resolution pipeline',
      focusFiles: ['src/resolver.ts', 'src/registry.ts', 'src/producer.ts'],
    })
    const capsuleOut = join(root, 'capsule.json')
    const auditOut = join(root, 'audit.json')
    const result = runContextWithAudit(indexOut, requestPath, capsuleOut, auditOut)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    const audit = JSON.parse(readFileSync(auditOut, 'utf8'))

    const ownerPaths = new Set(capsule.selectedOwners.map((o: { path?: string }) => o.path))
    for (const p of ['src/contract.ts', 'src/resolver.ts', 'src/registry.ts', 'src/producer.ts']) expect(ownerPaths.has(p)).toBe(true)
    expect(ownerPaths.has('src/consumer.ts')).toBe(false)

    // Directed evidence: resolver.ts's true dependency is contract.ts, not the
    // downstream consumer.ts.
    const dependencies = capsule.evidenceGroups.find((g: { kind: string }) => g.kind === 'dependencies')
    const dependencyPaths = dependencies.items.map((i: { path?: string }) => i.path)
    expect(dependencyPaths).not.toContain('src/consumer.ts')

    const second = runContextWithAudit(indexOut, requestPath, capsuleOut, auditOut)
    expect(second.status).toBe(0)
    const secondCapsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(secondCapsule.selectedOwners.map((o: { id: string }) => o.id)).toEqual(capsule.selectedOwners.map((o: { id: string }) => o.id))

    assertCapsuleAuditParity(capsule, audit)
  })

  it('TST-B1304-INT-004 (CASE-004 shape): unused required reservation spills over and eliminates avoidable truncation', () => {
    const root = createTempRoot('my-dev-kit-v1-int-case004-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    for (let i = 0; i < 14; i++) {
      writeFileSync(join(src, `entityType${i}.ts`), `export interface EntityType${i} {\n  id: string\n}\n`)
    }
    writeFileSync(join(src, 'resolver.ts'), "import type { EntityType0 } from './entityType0'\n\nexport function resolveEntity(id: string): EntityType0 {\n  return { id }\n}\n")

    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate all entity type contracts and resolver',
      focusFiles: ['src/resolver.ts'],
      focusSymbols: ['symbol:src/resolver.ts#resolveEntity'],
    })
    const capsuleOut = join(root, 'capsule.json')
    const auditOut = join(root, 'audit.json')
    const result = runContextWithAudit(indexOut, requestPath, capsuleOut, auditOut)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    const audit = JSON.parse(readFileSync(auditOut, 'utf8'))

    const contracts = capsule.groupTruncation.find((g: { groupId: string }) => g.groupId === 'implementation-contracts')
    expect(contracts.truncated).toBe(false)
    expect(contracts.borrowedCapacity).toBeGreaterThan(0)
    expect(capsule.roleAdequacy.missingConditions).not.toContain('required evidence truncated')

    assertCapsuleAuditParity(capsule, audit)
  })

  it('TST-B1304-INT-005 (CASE-005 shape): required evidence beyond the real bound is genuinely truncated and blocks adequacy', () => {
    const root = createTempRoot('my-dev-kit-v1-int-case005-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    for (let i = 0; i < 40; i++) {
      writeFileSync(join(src, `entityType${i}.ts`), `export interface EntityType${i} {\n  id: string\n}\n`)
    }

    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate all entity type contracts',
      focusFiles: ['src/entityType0.ts'],
      focusSymbols: ['symbol:src/entityType0.ts#EntityType0'],
    })
    const capsuleOut = join(root, 'capsule.json')
    const auditOut = join(root, 'audit.json')
    const result = runContextWithAudit(indexOut, requestPath, capsuleOut, auditOut)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    const audit = JSON.parse(readFileSync(auditOut, 'utf8'))

    expect(capsule.truncation.truncated).toBe(true)
    expect(capsule.truncation.records.some((r: { requiredEvidenceLost: boolean }) => r.requiredEvidenceLost)).toBe(true)
    expect(capsule.roleAdequacy.missingConditions).toContain('required evidence truncated')
    expect(capsule.roleAdequacy.status).toBe('context insufficient and more retrieval required')

    assertCapsuleAuditParity(capsule, audit)
  })

  it('TST-B1304-INT-006 (CASE-006 shape): duplicate responsibility IDs map uniquely with a deterministic first-occurrence diagnostic', () => {
    const root = createTempRoot('my-dev-kit-v1-int-case006-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'profiles.ts'), "export const profiles = [{ id: 'alpha' }]\n")

    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'test-implementation',
      query: 'Map the duplicated test responsibility to the changed profile registry',
      focusFiles: ['src/profiles.ts'],
      focusSymbols: ['symbol:src/profiles.ts#profiles'],
      changedFiles: ['src/profiles.ts'],
      changedSymbols: ['symbol:src/profiles.ts#profiles'],
      testResponsibilityRefs: ['TST-DUPLICATE', 'TST-DUPLICATE'],
      requestedEvidenceKinds: ['changed-surface', 'responsibility-mappings', 'test-infrastructure', 'test-commands'],
    })
    const capsuleOut = join(root, 'capsule.json')
    const auditOut = join(root, 'audit.json')
    const result = runContextWithAudit(indexOut, requestPath, capsuleOut, auditOut)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    const audit = JSON.parse(readFileSync(auditOut, 'utf8'))

    expect(capsule.responsibilityMappings.mappings.length).toBe(1)
    expect(capsule.responsibilityMappings.mappings[0].responsibilityId).toBe('TST-DUPLICATE')
    expect(capsule.responsibilityMappings.duplicateResponsibilityIds).toEqual(['TST-DUPLICATE'])

    assertCapsuleAuditParity(capsule, audit)
  })

  it('TST-B1304-INT-007 (CASE-012 shape): a roleless legacy request remains schema-major-1 compatible end to end', () => {
    const root = createTempRoot('my-dev-kit-v1-int-case012-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'widget.ts'), 'export function registerWidget(name: string): void {}\n')

    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)

    const legacyOut = join(root, 'legacy-capsule.json')
    const legacyResult = runCli(['context', '--index', indexOut, '--query', 'registerWidget', '--out', legacyOut])
    expect(legacyResult.status).toBe(0)
    const legacyCapsule = JSON.parse(readFileSync(legacyOut, 'utf8'))

    expect(legacyCapsule.schemaVersion).toBe('1.0.0')
    expect(legacyCapsule.evidenceGroups).toEqual([])
    expect(legacyCapsule.selectedOwners).toEqual([])
    expect(legacyCapsule.groupTruncation).toEqual([])
    expect(legacyCapsule.responsibilityMappings.duplicateResponsibilityIds).toEqual([])

    const requestPath = writeRequest(root, 'no-role.json', { schemaVersion: '1.0.0', query: 'registerWidget' })
    const requestOut = join(root, 'no-role-capsule.json')
    expect(runCli(['context', '--index', indexOut, '--request', requestPath, '--out', requestOut]).status).toBe(0)
    const withRequest = JSON.parse(readFileSync(requestOut, 'utf8'))
    expect(withRequest.candidateFiles).toEqual(legacyCapsule.candidateFiles)
    expect(withRequest.evidenceGroups).toEqual([])
  })
})
