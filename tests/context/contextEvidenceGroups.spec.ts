import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

// v1.10.1 Batch 3: deterministic, bounded, role-scoped evidence-group construction.
// Responsibility IDs: TST-B3-001, 002, 003, 004, 005, 006, 024, 027, 028, 029.

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

/** Owner + validator + error + schema + related/unrelated test fixture, matching the
 * classification conventions in `evidenceClassification.ts`/`roleCandidates.ts`. */
function writeFullFixture(root: string): { indexOut: string } {
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'widgetRegistry.ts'), "export function registerWidget(name: string): void { /* widget registry entry point */ }\n")
  writeFileSync(
    join(src, 'widgetValidator.ts'),
    "import { registerWidget } from './widgetRegistry'\nexport function validateWidgetName(name: string): boolean { return name.length > 0 }\nexport const widget = registerWidget\n"
  )
  writeFileSync(join(src, 'widgetError.ts'), "export class WidgetError extends Error {}\n")
  writeFileSync(join(src, 'widgetSchema.ts'), "export const widgetSchema = { type: 'object' }\n")
  writeFileSync(
    join(src, 'widgetRegistry.spec.ts'),
    "import { registerWidget } from './widgetRegistry'\nexport const check = registerWidget\n"
  )
  writeFileSync(join(src, 'unrelatedThing.spec.ts'), 'export const unrelated = 1\n')

  const indexOut = join(root, '.my-dev-kit')
  const result = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
  expect(result.status).toBe(0)
  return { indexOut }
}

function writeRequest(root: string, name: string, body: unknown): string {
  const filePath = join(root, name)
  writeFileSync(filePath, JSON.stringify(body, null, 2))
  return filePath
}

function runContext(indexOut: string, requestPath: string, outPath: string, extraArgs: string[] = []) {
  return runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath, ...extraArgs])
}

describe('evidence-group construction', () => {
  it('TST-B3-001: architecture role produces owner, extension-point, contract, graph-neighborhood, and architecture-test groups', () => {
    const root = createTempRoot('my-dev-kit-v1-evg-arch-')
    const { indexOut } = writeFullFixture(root)
    const requestPath = writeRequest(root, 'arch.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'architecture',
      focusSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const kinds = capsule.evidenceGroups.map((g: { kind: string }) => g.kind)
    expect(kinds).toEqual(['owners', 'extension-points', 'contracts', 'graph-neighborhood', 'architecture-tests'])
    for (const group of capsule.evidenceGroups) {
      expect(group.role).toBe('architecture')
    }
    expect(capsule.selectedOwners.length).toBeGreaterThan(0)
    expect(capsule.selectedOwners[0].path).toBe('src/widgetRegistry.ts')
  })

  it('TST-B3-002: implementation role produces owner, dependency, contract, validator/error/schema, and closest-test groups', () => {
    const root = createTempRoot('my-dev-kit-v1-evg-impl-')
    const { indexOut } = writeFullFixture(root)
    const requestPath = writeRequest(root, 'impl.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'implementation',
      focusSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const kinds = capsule.evidenceGroups.map((g: { kind: string }) => g.kind)
    expect(kinds).toEqual([
      'owners',
      'dependencies',
      'callers-and-callees',
      'contracts',
      'validators-and-constants',
      'errors',
      'schemas-and-serializers',
      'compatibility-surfaces',
      'closest-tests',
    ])

    const dependenciesGroup = capsule.evidenceGroups.find((g: { kind: string }) => g.kind === 'dependencies')
    expect(dependenciesGroup.items.some((i: { path: string }) => i.path === 'src/widgetValidator.ts')).toBe(true)
  })

  it('TST-B3-003: test-implementation role produces changed-surface, production-symbol, related-test, infrastructure, and command groups', () => {
    const root = createTempRoot('my-dev-kit-v1-evg-test-')
    const { indexOut } = writeFullFixture(root)
    const requestPath = writeRequest(root, 'test-role.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'test-implementation',
      changedFiles: ['src/widgetRegistry.ts'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const kinds = capsule.evidenceGroups.map((g: { kind: string }) => g.kind)
    expect(kinds).toEqual([
      'changed-surface',
      'production-symbols',
      'contracts',
      'validators-and-boundaries',
      'errors-and-side-effects',
      'related-tests',
      'fixtures',
      'factories',
      'mocks',
      'setup-and-configuration',
      'test-commands',
    ])

    const relatedTestsGroup = capsule.evidenceGroups.find((g: { kind: string }) => g.kind === 'related-tests')
    expect(relatedTestsGroup.items.some((i: { path: string }) => i.path === 'src/widgetRegistry.spec.ts')).toBe(true)
    expect(relatedTestsGroup.items.some((i: { path: string }) => i.path === 'src/unrelatedThing.spec.ts')).toBe(false)
  })

  it('TST-B3-004/005: group order and item order are deterministic across repeated runs', () => {
    const root = createTempRoot('my-dev-kit-v1-evg-order-')
    const { indexOut } = writeFullFixture(root)
    const requestPath = writeRequest(root, 'order.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'implementation',
      focusSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
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
    expect(secondCapsule.evidenceGroups).toEqual(firstCapsule.evidenceGroups)
  })

  it('TST-B3-006: exact duplicate evidence is not copied repeatedly within a group', () => {
    const root = createTempRoot('my-dev-kit-v1-evg-dedupe-')
    const { indexOut } = writeFullFixture(root)
    const requestPath = writeRequest(root, 'dedupe.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'implementation',
      focusSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    for (const group of capsule.evidenceGroups) {
      const ids = group.items.map((item: { id: string }) => item.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('TST-B3-024/026: per-group caps are enforced and auditable via groupTruncation', () => {
    const root = createTempRoot('my-dev-kit-v1-evg-cap-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    // 8 owner-like registries: exceeds the architecture role's owners cap (5).
    for (let i = 0; i < 8; i++) {
      writeFileSync(join(src, `widgetRegistry${i}.ts`), `export function registerWidget${i}(name: string): void { /* widget registry ${i} */ }\n`)
    }
    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'cap.json', { schemaVersion: '1.0.0', query: 'widget registry', role: 'architecture' })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const ownersGroup = capsule.evidenceGroups.find((g: { kind: string }) => g.kind === 'owners')
    expect(ownersGroup.limit).toBe(5)
    expect(ownersGroup.usedCount).toBeLessThanOrEqual(5)
    if (ownersGroup.availableCount > 5) {
      expect(ownersGroup.truncated).toBe(true)
      expect(ownersGroup.droppedCount).toBe(ownersGroup.availableCount - ownersGroup.usedCount)
    }

    const truncationEntry = capsule.groupTruncation.find((g: { groupId: string }) => g.groupId === ownersGroup.id)
    expect(truncationEntry).toBeDefined()
    expect(truncationEntry.limit).toBe(5)
    expect(truncationEntry.usedCount).toBe(ownersGroup.usedCount)
  })

  it('TST-B3-027: test-implementation role without changed surface remains honestly limited', () => {
    const root = createTempRoot('my-dev-kit-v1-evg-no-changed-')
    const { indexOut } = writeFullFixture(root)
    const requestPath = writeRequest(root, 'no-changed.json', { schemaVersion: '1.0.0', query: 'widget', role: 'test-implementation' })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    expect(capsule.warnings.some((w: string) => w.includes('post-implementation changed-surface focus is unavailable'))).toBe(true)
    const changedSurfaceGroup = capsule.evidenceGroups.find((g: { kind: string }) => g.kind === 'changed-surface')
    expect(changedSurfaceGroup.items.length).toBe(0)
    expect(changedSurfaceGroup.unresolved.length).toBeGreaterThan(0)
  })

  it('TST-B3-028: evidence grouping does not bypass --max-candidate-files', () => {
    const root = createTempRoot('my-dev-kit-v1-evg-source-cap-')
    const { indexOut } = writeFullFixture(root)
    const requestPath = writeRequest(root, 'source-cap.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'implementation',
      focusSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath, '--max-candidate-files', '1'])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    const retainedCount = capsule.candidateFiles.filter((f: { retained: boolean }) => f.retained).length
    expect(retainedCount).toBeLessThanOrEqual(1)
  })

  // v1.10.3 Batch 1: structural implementation-owner eligibility (F-001/F-002).
  // Responsibility IDs: TST-B1103-001..006.

  it('TST-B1103-001: a neutral canonical filename (types.ts/profiles.ts/resolver.ts) qualifies as owner through structural evidence, not filename keywords', () => {
    const root = createTempRoot('my-dev-kit-v1-owner-neutral-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'types.ts'), 'export interface Profile {\n  id: string\n}\n')
    writeFileSync(join(src, 'profiles.ts'), "import type { Profile } from './types'\n\nexport const profiles: Profile[] = [{ id: 'alpha' }]\n")
    writeFileSync(join(src, 'resolver.ts'), "import { profiles } from './profiles'\n\nexport function resolveProfile(id: string) {\n  return profiles.find((p) => p.id === id)\n}\n")
    writeFileSync(join(src, 'consumer.ts'), "import { resolveProfile } from './resolver'\n\nexport const found = resolveProfile('alpha')\n")

    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'neutral-owner.json', {
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

    const ownerPaths = capsule.selectedOwners.map((o: { path?: string }) => o.path).filter(Boolean)
    expect(ownerPaths).toContain('src/profiles.ts')
    expect(ownerPaths).toContain('src/resolver.ts')
    expect(capsule.roleAdequacy.missingConditions).not.toContain('owner missing')
  })

  it('TST-B1103-002: resolver/contract/definition ownership with downstream consumers qualifies deterministically', () => {
    const root = createTempRoot('my-dev-kit-v1-owner-resolver-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'contract.ts'), 'export type Resolution = { found: boolean }\n')
    writeFileSync(
      join(src, 'definitions.ts'),
      "import type { Resolution } from './contract'\n\nexport const definitions: Record<string, Resolution> = { alpha: { found: true } }\n"
    )
    writeFileSync(
      join(src, 'resolver.ts'),
      "import { definitions } from './definitions'\n\nexport function resolve(id: string) {\n  return definitions[id]\n}\n"
    )
    writeFileSync(join(src, 'consumerA.ts'), "import { resolve } from './resolver'\n\nexport const a = resolve('alpha')\n")
    writeFileSync(join(src, 'consumerB.ts'), "import { resolve } from './resolver'\n\nexport const b = resolve('alpha')\n")

    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'resolver-owner.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate the resolver and its governing contract/definitions',
      focusFiles: ['src/resolver.ts'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const ownerPaths = capsule.selectedOwners.map((o: { path?: string }) => o.path).filter(Boolean)
    expect(ownerPaths).toContain('src/resolver.ts')
    expect(ownerPaths).toContain('src/definitions.ts')
    expect(ownerPaths.includes('src/consumerA.ts')).toBe(false)
    expect(ownerPaths.includes('src/consumerB.ts')).toBe(false)

    const second = runContext(indexOut, requestPath, outPath)
    expect(second.status).toBe(0)
    const secondCapsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(secondCapsule.selectedOwners.map((o: { id: string }) => o.id)).toEqual(capsule.selectedOwners.map((o: { id: string }) => o.id))
  })

  it('TST-B1103-003: focusing an unrelated test/fixture/generated file with an owner-like name never establishes ownership', () => {
    const root = createTempRoot('my-dev-kit-v1-owner-focus-only-')
    const src = join(root, 'src')
    const tests = join(root, 'tests')
    mkdirSync(src, { recursive: true })
    mkdirSync(tests, { recursive: true })
    writeFileSync(join(src, 'unrelated.ts'), 'export const unrelated = 1\n')
    writeFileSync(join(tests, 'generatedManager.ts'), "export const generatedFixture = 'not-a-production-owner'\n")

    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--src', 'tests', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'focus-false-owner.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Inspect generated fixture evidence',
      focusFiles: ['tests/generatedManager.ts'],
      focusSymbols: ['symbol:tests/generatedManager.ts#generatedFixture'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    expect(capsule.selectedOwners.length).toBe(0)
    expect(capsule.roleAdequacy.missingConditions).toContain('owner missing')
    expect(capsule.roleAdequacy.blockingConditions).toContain('owner missing')
  })

  it('TST-B1103-004: existing owner-like-keyword fixtures keep qualifying (no regression)', () => {
    const root = createTempRoot('my-dev-kit-v1-owner-keyword-compat-')
    const { indexOut } = writeFullFixture(root)
    const requestPath = writeRequest(root, 'keyword-owner.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'implementation',
      focusSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.selectedOwners.some((o: { path?: string }) => o.path === 'src/widgetRegistry.ts')).toBe(true)
  })

  it('TST-B1103-005: multiple materially credible owners are all retained in stable deterministic order', () => {
    const root = createTempRoot('my-dev-kit-v1-owner-multi-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'contract.ts'), 'export type Resolution = { found: boolean }\n')
    writeFileSync(join(src, 'resolver.ts'), "import type { Resolution } from './contract'\n\nexport function resolve(id: string): Resolution {\n  return { found: id.length > 0 }\n}\n")
    writeFileSync(join(src, 'registry.ts'), "import { resolve } from './resolver'\n\nexport const registryEntry = resolve('alpha')\n")
    writeFileSync(join(src, 'producer.ts'), "import { registryEntry } from './registry'\n\nexport const produced = registryEntry\n")
    writeFileSync(join(src, 'consumer.ts'), "import { produced } from './producer'\n\nexport const value = produced\n")

    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'multi-owner.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate all credible owners in this resolution pipeline',
      focusFiles: ['src/resolver.ts', 'src/registry.ts', 'src/producer.ts'],
    })
    const outPath = join(root, 'capsule.json')
    const first = runContext(indexOut, requestPath, outPath)
    expect(first.status).toBe(0)
    const firstCapsule = JSON.parse(readFileSync(outPath, 'utf8'))
    const ownerPaths: string[] = firstCapsule.selectedOwners.map((o: { path?: string }) => o.path).filter(Boolean)
    const uniqueOwnerPaths = new Set(ownerPaths)
    // v1.10.3 Batch 2: the implementation role's owners group reservation (3) is now
    // an initial reservation, not an isolated cap — unused reservation from other
    // required groups may legitimately spill over here, so more than 3 owners can be
    // retained (section 22.9: "only final retained count may change when legitimate
    // spillover applies"). What must not change is *which* files qualify: every
    // credible structural owner is retained, and the unrelated leaf consumer never is.
    const credibleOwnerPaths = new Set(['src/contract.ts', 'src/resolver.ts', 'src/registry.ts', 'src/producer.ts'])
    for (const p of credibleOwnerPaths) expect(uniqueOwnerPaths.has(p)).toBe(true)
    expect(uniqueOwnerPaths.has('src/consumer.ts')).toBe(false)
    for (const p of uniqueOwnerPaths) expect(credibleOwnerPaths.has(p)).toBe(true)

    const second = runContext(indexOut, requestPath, outPath)
    expect(second.status).toBe(0)
    const secondCapsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(secondCapsule.selectedOwners.map((o: { id: string }) => o.id)).toEqual(firstCapsule.selectedOwners.map((o: { id: string }) => o.id))
  })

  it('TST-B1103-006: cross-platform repository-relative paths (POSIX, spaces) select the same owner deterministically', () => {
    const root = createTempRoot('my-dev-kit-v1-owner-crossplat-')
    const src = join(root, 'src', 'my module')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'types.ts'), 'export interface Item {\n  id: string\n}\n')
    writeFileSync(join(src, 'resolver.ts'), "import type { Item } from './types'\n\nexport function resolveItem(id: string): Item {\n  return { id }\n}\n")
    writeFileSync(join(src, 'consumer.ts'), "import { resolveItem } from './resolver'\n\nexport const item = resolveItem('alpha')\n")

    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'crossplat-owner.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate the item resolver owner',
      focusFiles: ['src/my module/resolver.ts'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    const ownerPaths = capsule.selectedOwners.map((o: { path?: string }) => o.path).filter(Boolean)
    expect(ownerPaths.some((p: string) => p.replace(/\\/g, '/') === 'src/my module/resolver.ts')).toBe(true)
    for (const p of ownerPaths) expect(p.includes('\\')).toBe(false)
  })

  it('TST-B3-029: legacy no-role requests keep evidenceGroups/testInfrastructure empty and unchanged', () => {
    const root = createTempRoot('my-dev-kit-v1-evg-legacy-')
    const { indexOut } = writeFullFixture(root)
    const legacyOut = join(root, 'legacy.json')
    const legacyResult = runCli(['context', '--index', indexOut, '--query', 'registerWidget', '--out', legacyOut])
    expect(legacyResult.status).toBe(0)
    const legacy = JSON.parse(readFileSync(legacyOut, 'utf8'))

    expect(legacy.evidenceGroups).toEqual([])
    expect(legacy.selectedOwners).toEqual([])
    expect(legacy.selectedContracts).toEqual([])
    expect(legacy.selectedTests).toEqual([])
    expect(legacy.unresolvedItems).toEqual([])
    expect(legacy.groupTruncation).toEqual([])
    expect(legacy.testInfrastructure.relatedTests).toEqual([])
    expect(legacy.testInfrastructure.testCommands).toEqual([])

    const requestPath = writeRequest(root, 'no-role.json', { schemaVersion: '1.0.0', query: 'registerWidget' })
    const requestOut = join(root, 'no-role-capsule.json')
    const requestResult = runContext(indexOut, requestPath, requestOut)
    expect(requestResult.status).toBe(0)
    const withRequest = JSON.parse(readFileSync(requestOut, 'utf8'))
    expect(withRequest.candidateFiles).toEqual(legacy.candidateFiles)
    expect(withRequest.candidateNodes).toEqual(legacy.candidateNodes)
    expect(withRequest.evidenceGroups).toEqual([])
  })
})
