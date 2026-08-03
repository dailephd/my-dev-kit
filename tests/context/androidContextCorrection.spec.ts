/**
 * v1.12.0 Batch 6 correction: end-to-end CLI verification of behavior that
 * was previously only unit-tested. Locks in three real defects found and
 * fixed during the correction pass:
 *
 * 1. `findAndroidOwnerSupportNodeIds` existed but was never wired into the
 *    candidate pipeline, so a named-screen state request never even saw the
 *    linked ViewModel as a candidate (roleCandidates.ts).
 * 2. `androidOwnerEligible`'s explicit-test-intent branch returned `true` for
 *    ANY Android candidate, not just test-only ones, letting an unrelated
 *    Android node bypass normal category-tier matching under any query
 *    containing the word "test" (androidContextOwnerPolicy.ts).
 * 3. `androidNodeCandidate` in `searchIndex.ts` never projected
 *    `classificationRoles`/`classificationRefs` onto compact `android-*`
 *    search results, so `search --query`/`context` candidates for
 *    `android-test-class`/`android-generated-build-path` nodes had no
 *    classification at all - silently defeating test-only/generated
 *    production-owner exclusion for any node reached through those paths.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'
import { CANONICAL_FIXTURE_ROOT } from '../integration/androidV110CombinedFixture.spec.js'

const tempDirs: string[] = []
function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-context-correction-'))
  tempDirs.push(root)
  return root
}
afterAll(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function json(result: ReturnType<typeof runCli>): any {
  return JSON.parse(result.stdout)
}

describe('v1.12.0 Batch 6 correction: named-screen state-owner selection', () => {
  let outDir: string

  beforeAll(() => {
    const root = createTempRoot()
    outDir = join(root, 'out')
    const result = runCli([
      'index', '--root', CANONICAL_FIXTURE_ROOT,
      '--src', 'app/src/main', '--src', 'core/src/main',
      '--out', outDir, '--json',
    ])
    expect(result.status).toBe(0)
  })

  it('section 11: "Change the loading state behavior shown by HomeScreen." selects the ViewModel as owner, not the state fact, with no fabricated owner', () => {
    const capsuleOut = join(createTempRoot(), 'capsule.json')
    const auditOut = join(createTempRoot(), 'audit.json')
    const result = runCli([
      'context', '--index', outDir, '--role', 'implementation',
      '--query', 'Change the loading state behavior shown by HomeScreen.',
      '--out', capsuleOut, '--audit-out', auditOut, '--json',
    ])
    expect(result.status).toBe(0)
    const capsule = json(result)
    expect(capsule.focus.focusNodeId).toContain('UserViewModel')
    expect(capsule.selectedOwners.some((o: any) => o.id.includes('UserViewModel'))).toBe(true)
    expect(capsule.conflicts.conflicts).toEqual([])
    const stateFact = capsule.candidateNodes.find((n: any) => n.nodeId.includes('::state#'))
    expect(stateFact).toBeTruthy()
    expect(capsule.selectedOwners.some((o: any) => o.id === stateFact.nodeId)).toBe(false)
    const vm = capsule.candidateNodes.find((n: any) => n.nodeId.includes('UserViewModel'))
    expect(vm.synthesized).toBe(true)
    expect(vm.reasons.join(' ')).toContain('android-intent-category-match')
  })
})

describe('v1.12.0 Batch 6 correction: test-only production-owner exclusion (real CLI)', () => {
  let outDir: string

  beforeAll(() => {
    const root = createTempRoot()
    outDir = join(root, 'out')
    const result = runCli([
      'index', '--root', join(process.cwd(), 'tests', 'fixtures', 'android-test-semantic', 'basic-app'),
      '--src', 'app/src/main', '--src', 'app/src/test', '--src', 'app/src/androidTest',
      '--out', outDir, '--json',
    ])
    expect(result.status).toBe(0)
  })

  it('section 12: a production query anchored on the test class surfaces android-test-primary-target and selects no owner', () => {
    const capsuleOut = join(createTempRoot(), 'capsule.json')
    const auditOut = join(createTempRoot(), 'audit.json')
    const result = runCli([
      'context', '--index', outDir, '--role', 'implementation',
      '--query', 'Fix the login validation logic used by LoginViewModelTest.',
      '--out', capsuleOut, '--audit-out', auditOut, '--json',
    ])
    expect(result.status).toBe(0)
    const capsule = json(result)
    expect(capsule.focus.focusNodeId).toContain('LoginViewModelTest')
    expect(capsule.conflicts.conflicts.some((c: any) => c.kind === 'android-test-primary-target')).toBe(true)
    expect(capsule.selectedOwners).toEqual([])
  })

  it('correction: an explicit test-intent query does not let a test-only node (or an unrelated Android node) leak into selectedOwners', () => {
    const capsuleOut = join(createTempRoot(), 'capsule.json')
    const result = runCli([
      'context', '--index', outDir, '--role', 'implementation',
      '--query', 'Fix the LoginViewModelTest test class.',
      '--out', capsuleOut, '--json',
    ])
    expect(result.status).toBe(0)
    const capsule = json(result)
    for (const owner of capsule.selectedOwners) {
      const node = capsule.candidateNodes.find((n: any) => n.nodeId === owner.id)
      const guidances = (node?.classificationRoles ?? []).map((r: any) => r.editGuidance)
      expect(guidances.includes('test-only')).toBe(false)
    }
  })
})

describe('v1.12.0 Batch 6 correction: generated production-owner exclusion (real CLI)', () => {
  it('section 13: a production query anchored on a generated build path surfaces android-generated-primary-target and selects no owner', () => {
    const root = createTempRoot()
    const outDir = join(root, 'out')
    const indexResult = runCli([
      'index', '--root', join(process.cwd(), 'tests', 'fixtures', 'android', 'generated-build-output'),
      '--src', 'app/src/main', '--out', outDir, '--json',
    ])
    expect(indexResult.status).toBe(0)

    const capsuleOut = join(root, 'capsule.json')
    const auditOut = join(root, 'audit.json')
    const result = runCli([
      'context', '--index', outDir, '--role', 'implementation',
      '--query', 'Fix the build output configuration.',
      '--out', capsuleOut, '--audit-out', auditOut, '--json',
    ])
    expect(result.status).toBe(0)
    const capsule = json(result)
    expect(capsule.focus.focusNodeId).toContain('android-generated-build-path')
    expect(capsule.conflicts.conflicts.some((c: any) => c.kind === 'android-generated-primary-target')).toBe(true)
    expect(capsule.selectedOwners).toEqual([])
  })
})
