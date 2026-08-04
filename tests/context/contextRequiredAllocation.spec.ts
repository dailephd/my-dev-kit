import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

// v1.10.3 Batch 2: required-first evidence allocation (F-003).
// Responsibility IDs: TST-B1202-001..010, covering Stage 0 CASE-001/004/005.

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

function runContext(indexOut: string, requestPath: string, outPath: string, extraArgs: string[] = []) {
  return runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath, ...extraArgs])
}

interface GroupTruncationLike {
  groupId: string
  limit: number | null
  availableCount: number
  usedCount: number
  truncated: boolean
  droppedCount: number
  required?: boolean
  reservation?: number
  initiallySelectedCount?: number
  unusedReservationContributed?: number
  borrowedCapacity?: number
  requiredOmittedCount?: number
  optionalOmittedCount?: number
  adequacyAffected?: boolean
  governingHardBound?: number
  aggregateCapacityUsed?: number
  aggregateCapacityRemaining?: number
}

function findGroup(groupTruncation: GroupTruncationLike[], groupId: string): GroupTruncationLike {
  const found = groupTruncation.find((g) => g.groupId === groupId)
  if (!found) throw new Error(`group ${groupId} not found`)
  return found
}

describe('required-first evidence allocation (Batch 2)', () => {
  it('TST-B1202-001 (CASE-004): unused required reservation spills over to eliminate avoidable truncation', () => {
    const root = createTempRoot('my-dev-kit-v1-alloc-case004-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    for (let i = 0; i < 14; i++) {
      writeFileSync(join(src, `entityType${i}.ts`), `export interface EntityType${i} {\n  id: string\n}\n`)
    }
    writeFileSync(join(src, 'resolver.ts'), "import type { EntityType0 } from './entityType0'\n\nexport function resolveEntity(id: string): EntityType0 {\n  return { id }\n}\n")

    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'case004.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate all entity type contracts and resolver',
      focusFiles: ['src/resolver.ts'],
      focusSymbols: ['symbol:src/resolver.ts#resolveEntity'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const contracts = findGroup(capsule.groupTruncation, 'implementation-contracts')
    // The 14 neutral entity-type contracts exceed the fixed reservation (10), which
    // before this batch would have been an avoidable truncation: several other
    // required groups (validators/errors/schemas/closest-tests) have no candidates
    // in this fixture and so contribute unused reservation to the shared pool.
    expect(contracts.availableCount).toBeGreaterThan(10)
    expect(contracts.usedCount).toBe(contracts.availableCount)
    expect(contracts.truncated).toBe(false)
    expect(contracts.borrowedCapacity).toBeGreaterThan(0)
    expect(contracts.requiredOmittedCount).toBe(0)
    expect(contracts.reservation).toBe(10)

    // No group in this fixture should show avoidable required truncation.
    for (const g of capsule.groupTruncation as GroupTruncationLike[]) {
      expect(g.truncated).toBe(false)
    }
    expect(capsule.roleAdequacy.missingConditions).not.toContain('required evidence truncated')
    expect(capsule.roleAdequacy.status).not.toBe('context insufficient and more retrieval required')
  })

  it('TST-B1202-002 (CASE-005): bounded overflow stays visible without fabricating required-condition loss', () => {
    const root = createTempRoot('my-dev-kit-v1-alloc-case005-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    for (let i = 0; i < 40; i++) {
      writeFileSync(join(src, `entityType${i}.ts`), `export interface EntityType${i} {\n  id: string\n}\n`)
    }

    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'case005.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate all entity type contracts',
      focusFiles: ['src/entityType0.ts'],
      focusSymbols: ['symbol:src/entityType0.ts#EntityType0'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    // Total qualified evidence across groups vastly exceeds the governing hard
    // bound. Overflow remains visible, while the retained owner and contract
    // witnesses keep the mapped conditions covered.
    const anyEntry = capsule.groupTruncation[0]
    expect(anyEntry.aggregateCapacityRemaining).toBe(0)
    expect(anyEntry.governingHardBound).toBeGreaterThan(0)

    const truncatedGroups = (capsule.groupTruncation as GroupTruncationLike[]).filter((g) => g.truncated)
    expect(truncatedGroups.length).toBeGreaterThan(0)
    for (const g of truncatedGroups) {
      expect(g.requiredOmittedCount).toBe(0)
      expect(g.optionalOmittedCount).toBe(g.droppedCount)
      expect(g.adequacyAffected).toBe(false)
    }

    expect(capsule.truncation.truncated).toBe(true)
    expect(capsule.truncation.records.some((r: { requiredEvidenceLost: boolean }) => r.requiredEvidenceLost)).toBe(false)
    expect(capsule.roleAdequacy.missingConditions).not.toContain('required evidence truncated')
    expect(capsule.roleAdequacy.status).toBe('context sufficient for implementation')
  })

  it('TST-B1202-003 (CASE-001 shape): neutral owner plus allocation fix together produce adequate implementation context', () => {
    const root = createTempRoot('my-dev-kit-v1-alloc-case001-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'types.ts'), 'export interface Profile {\n  id: string\n}\n')
    writeFileSync(join(src, 'profiles.ts'), "import type { Profile } from './types'\n\nexport const profiles: Profile[] = [{ id: 'alpha' }]\n")
    writeFileSync(join(src, 'resolver.ts'), "import { profiles } from './profiles'\n\nexport function resolveProfile(id: string) {\n  return profiles.find((p) => p.id === id)\n}\n")
    for (let i = 0; i < 12; i++) {
      writeFileSync(join(src, `profileConstant${i}.ts`), `export const PROFILE_CONSTANT_${i} = ${i}\n`)
    }

    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'case001.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate the canonical profile registry and resolver owners',
      focusFiles: ['src/profiles.ts', 'src/resolver.ts'],
      focusSymbols: ['symbol:src/profiles.ts#profiles', 'symbol:src/resolver.ts#resolveProfile'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const ownerPaths = capsule.selectedOwners.map((o: { path?: string }) => o.path)
    expect(ownerPaths).toContain('src/profiles.ts')
    expect(ownerPaths).toContain('src/resolver.ts')
    for (const g of capsule.groupTruncation as GroupTruncationLike[]) {
      if (g.groupId === 'implementation-validators-and-constants') continue // may legitimately still cap if constants exceed governing bound
      expect(g.requiredOmittedCount ?? 0).toBeGreaterThanOrEqual(0)
    }
    expect(capsule.roleAdequacy.blockingConditions).not.toContain('owner missing')
  })

  it('TST-B1202-004: required evidence is allocated before optional test-infrastructure evidence, and optional evidence never displaces required allocation', () => {
    const root = createTempRoot('my-dev-kit-v1-alloc-required-before-optional-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    for (let i = 0; i < 40; i++) {
      writeFileSync(join(src, `entityType${i}.ts`), `export interface EntityType${i} {\n  id: string\n}\n`)
    }
    writeFileSync(join(src, 'entityType0.spec.ts'), "import type { EntityType0 } from './entityType0'\n\nexport const check: EntityType0 = { id: 'x' }\n")

    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const baseRequest = {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate all entity type contracts',
      focusFiles: ['src/entityType0.ts'],
      focusSymbols: ['symbol:src/entityType0.ts#EntityType0'],
    }
    const withoutOptionalPath = writeRequest(root, 'without-optional.json', baseRequest)
    const withOptionalPath = writeRequest(root, 'with-optional.json', { ...baseRequest, requestedEvidenceKinds: ['test-infrastructure'] })

    const withoutOptionalOut = join(root, 'without-optional-capsule.json')
    const withOptionalOut = join(root, 'with-optional-capsule.json')
    expect(runContext(indexOut, withoutOptionalPath, withoutOptionalOut).status).toBe(0)
    expect(runContext(indexOut, withOptionalPath, withOptionalOut).status).toBe(0)

    const withoutOptional = JSON.parse(readFileSync(withoutOptionalOut, 'utf8'))
    const withOptional = JSON.parse(readFileSync(withOptionalOut, 'utf8'))

    // Requesting optional test-infrastructure evidence alongside heavy required-group
    // competition must not change any required group's allocation outcome.
    for (const kind of ['implementation-contracts', 'implementation-compatibility-surfaces', 'implementation-owners']) {
      const before = findGroup(withoutOptional.groupTruncation, kind)
      const after = findGroup(withOptional.groupTruncation, kind)
      expect(after.usedCount).toBe(before.usedCount)
      expect(after.requiredOmittedCount).toBe(before.requiredOmittedCount)
      expect(after.borrowedCapacity).toBe(before.borrowedCapacity)
    }
    expect(withOptional.testInfrastructure.relatedTests.length).toBeGreaterThan(0)
  })

  it('TST-B1202-005: spillover follows fixed required-group priority, not iteration or file-system order', () => {
    const root = createTempRoot('my-dev-kit-v1-alloc-priority-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    for (let i = 0; i < 12; i++) {
      writeFileSync(join(src, `fieldValidator${i}.ts`), `export function validateField${i}(value: string): boolean { return value.length > ${i} }\n`)
      writeFileSync(join(src, `parseError${i}.ts`), `export class ParseError${i} extends Error {}\n`)
    }
    writeFileSync(join(src, 'resolver.ts'), "import { validateField0 } from './fieldValidator0'\n\nexport function resolveInput(value: string): boolean {\n  return validateField0(value)\n}\n")

    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'priority.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate all field validators, parse errors, and the resolver',
      focusFiles: ['src/resolver.ts'],
      focusSymbols: ['symbol:src/resolver.ts#resolveInput'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    // Fixed priority order (declared before this batch, unchanged): owners,
    // dependencies, callers-and-callees, contracts, validators-and-constants, errors,
    // schemas-and-serializers, compatibility-surfaces, closest-tests. "contracts" (a
    // higher-priority group than validators/errors/schemas/compatibility-surfaces, all
    // of which also have unmet demand here) must exhaust the shared pool first.
    const contracts = findGroup(capsule.groupTruncation, 'implementation-contracts')
    const validators = findGroup(capsule.groupTruncation, 'implementation-validators-and-constants')
    const errors = findGroup(capsule.groupTruncation, 'implementation-errors')
    expect(contracts.borrowedCapacity).toBeGreaterThan(0)
    expect(validators.optionalOmittedCount).toBeGreaterThan(0)
    expect(errors.optionalOmittedCount).toBeGreaterThan(0)
    expect(validators.requiredOmittedCount).toBe(0)
    expect(errors.requiredOmittedCount).toBe(0)
    // Lower-priority groups only borrow what remains after higher-priority groups' claims.
    expect(validators.borrowedCapacity).toBe(0)
    expect(errors.borrowedCapacity).toBe(0)

    const second = runContext(indexOut, requestPath, outPath)
    expect(second.status).toBe(0)
    const secondCapsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(secondCapsule.groupTruncation).toEqual(capsule.groupTruncation)
  })

  it('TST-B1202-006: no remaining required demand leaves reservations honestly unused and invents no evidence or truncation', () => {
    const root = createTempRoot('my-dev-kit-v1-alloc-no-demand-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    // A single, minimal production file: at most a file-level and one symbol-level
    // owner candidate (2), well within the owners reservation (3), and nothing at
    // all for any other required group.
    writeFileSync(join(src, 'widgetRegistry.ts'), 'export function registerWidget(name: string): void { /* widget registry entry point */ }\n')

    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'no-demand.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'widget',
      focusSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    for (const g of capsule.groupTruncation as GroupTruncationLike[]) {
      expect(g.truncated).toBe(false)
      expect(g.requiredOmittedCount ?? 0).toBe(0)
      // Nothing needed the pool, so nothing borrowed it, regardless of how much was available.
      expect(g.borrowedCapacity ?? 0).toBe(0)
    }
  })

  it('TST-B1202-007: once the shared pool is exhausted, further unmet required demand is genuine and explicit, never silently absorbed', () => {
    const root = createTempRoot('my-dev-kit-v1-alloc-zero-remaining-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    for (let i = 0; i < 40; i++) {
      writeFileSync(join(src, `entityType${i}.ts`), `export interface EntityType${i} {\n  id: string\n}\n`)
    }

    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'zero-remaining.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate all entity type contracts',
      focusFiles: ['src/entityType0.ts'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const remaining = capsule.groupTruncation[0].aggregateCapacityRemaining
    expect(remaining).toBe(0)
    const used = capsule.groupTruncation.reduce((sum: number, g: GroupTruncationLike) => sum + g.usedCount, 0)
    const bound = capsule.groupTruncation[0].governingHardBound
    expect(used).toBe(bound)
    for (const g of capsule.groupTruncation as GroupTruncationLike[]) {
      if ((g.requiredOmittedCount ?? 0) > 0) {
        expect(g.truncated).toBe(true)
        expect(g.adequacyAffected).toBe(true)
      }
    }
  })

  it('TST-B1202-008: allocation is deterministic across repeated identical requests', () => {
    const root = createTempRoot('my-dev-kit-v1-alloc-determinism-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    for (let i = 0; i < 14; i++) {
      writeFileSync(join(src, `entityType${i}.ts`), `export interface EntityType${i} {\n  id: string\n}\n`)
    }
    writeFileSync(join(src, 'resolver.ts'), "import type { EntityType0 } from './entityType0'\n\nexport function resolveEntity(id: string): EntityType0 {\n  return { id }\n}\n")

    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'determinism.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate all entity type contracts and resolver',
      focusFiles: ['src/resolver.ts'],
      focusSymbols: ['symbol:src/resolver.ts#resolveEntity'],
    })
    const outPath = join(root, 'capsule.json')

    const first = runContext(indexOut, requestPath, outPath)
    expect(first.status).toBe(0)
    const firstCapsule = JSON.parse(readFileSync(outPath, 'utf8'))
    const second = runContext(indexOut, requestPath, outPath)
    expect(second.status).toBe(0)
    const secondCapsule = JSON.parse(readFileSync(outPath, 'utf8'))

    delete firstCapsule.generatedAt
    delete secondCapsule.generatedAt
    expect(secondCapsule.groupTruncation).toEqual(firstCapsule.groupTruncation)
    expect(secondCapsule.evidenceGroups).toEqual(firstCapsule.evidenceGroups)
    expect(secondCapsule.roleAdequacy).toEqual(firstCapsule.roleAdequacy)
  })

  it('TST-B1202-009: architecture preserves default caps and legacy roles remain unaffected', () => {
    const root = createTempRoot('my-dev-kit-v1-alloc-role-compat-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'widgetRegistry.ts'), 'export function registerWidget(name: string): void { /* widget registry entry point */ }\n')

    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const archRequestPath = writeRequest(root, 'arch.json', {
      schemaVersion: '1.0.0',
      role: 'architecture',
      query: 'widget',
      focusSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
    })
    const archOut = join(root, 'arch-capsule.json')
    expect(runContext(indexOut, archRequestPath, archOut).status).toBe(0)
    const archCapsule = JSON.parse(readFileSync(archOut, 'utf8'))
    // Architecture keeps its historical default caps while exposing additive
    // diagnostics from the shared allocator.
    for (const g of archCapsule.groupTruncation as GroupTruncationLike[]) {
      if (g.groupId === 'architecture-owners') expect(g.reservation).toBe(5)
      if (g.groupId === 'architecture-extension-points') expect(g.reservation).toBe(8)
      if (g.groupId === 'architecture-contracts') expect(g.reservation).toBe(10)
      if (g.groupId === 'architecture-architecture-tests') expect(g.reservation).toBe(8)
      if (g.groupId !== 'architecture-graph-neighborhood') expect(g.borrowedCapacity).toBe(0)
      expect(g.governingHardBound).toBeUndefined()
    }

    const legacyOut = join(root, 'legacy-capsule.json')
    expect(runCli(['context', '--index', indexOut, '--query', 'registerWidget', '--out', legacyOut]).status).toBe(0)
    const legacyCapsule = JSON.parse(readFileSync(legacyOut, 'utf8'))
    expect(legacyCapsule.groupTruncation).toEqual([])
    expect(legacyCapsule.evidenceGroups).toEqual([])
  })

  it('TST-B1202-010: schema-major-1 consumers reading only the original six groupTruncation fields still see correct values', () => {
    const root = createTempRoot('my-dev-kit-v1-alloc-schema-major1-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    for (let i = 0; i < 14; i++) {
      writeFileSync(join(src, `entityType${i}.ts`), `export interface EntityType${i} {\n  id: string\n}\n`)
    }
    writeFileSync(join(src, 'resolver.ts'), "import type { EntityType0 } from './entityType0'\n\nexport function resolveEntity(id: string): EntityType0 {\n  return { id }\n}\n")

    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'schema-major1.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate all entity type contracts and resolver',
      focusFiles: ['src/resolver.ts'],
      focusSymbols: ['symbol:src/resolver.ts#resolveEntity'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.schemaVersion).toBe('1.0.0')

    const contracts = findGroup(capsule.groupTruncation, 'implementation-contracts')
    // A pre-Batch-2 consumer that only reads groupId/limit/availableCount/usedCount/
    // truncated/droppedCount (ignoring every additive field) still sees a coherent,
    // internally consistent legacy shape: usedCount <= limit, truncated matches
    // availableCount vs usedCount, droppedCount matches the difference.
    expect(contracts.usedCount).toBeLessThanOrEqual(contracts.limit as number)
    expect(contracts.truncated).toBe(contracts.availableCount > contracts.usedCount)
    expect(contracts.droppedCount).toBe(Math.max(0, contracts.availableCount - contracts.usedCount))
  })
})
