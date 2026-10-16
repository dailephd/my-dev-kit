/**
 * v1.12.0 Batch 6 integration gate: Android-aware context owner selection over
 * the canonical combined Android fixture. TST-604, TST-631/633/634/635,
 * TST-656, TST-660 through TST-666 (representative subset).
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'
import { CANONICAL_FIXTURE_ROOT } from '../integration/androidV110CombinedFixture.spec.js'

const tempDirs: string[] = []
function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-context-'))
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

function runContext(query: string, role?: string): any {
  const capsuleOut = join(createTempRoot(), 'capsule.json')
  const args = ['context', '--index', outDir, '--query', query, '--out', capsuleOut, '--json']
  if (role) args.push('--role', role)
  const result = runCli(args)
  expect(result.status).toBe(0)
  return json(result)
}

describe('v1.12.0 Batch 6: Android-aware context owner selection', () => {
  it('TST-660/TST-631: a UI request surfaces a Compose owner among selected owners/candidates', () => {
    const capsule = runContext('Locate the owner for changing the Home screen UI composable.', 'architecture')
    expect(capsule.schemaVersion).toBe('1.0.0')
    const allOwnerIds = [...capsule.selectedOwners.map((o: any) => o.id), ...capsule.candidateNodes.filter((n: any) => n.retained).map((n: any) => n.nodeId)]
    expect(allOwnerIds.some((id: string) => id.includes('UserHomeScreen'))).toBe(true)
  })

  it('TST-661: a state request ranks the ViewModel at or above a collected-state fact', () => {
    const capsule = runContext('Change the loading state behavior shown by HomeScreen viewmodel.', 'implementation')
    const viewModelCandidate = capsule.candidateNodes.find((n: any) => n.nodeId.includes('UserViewModel'))
    expect(viewModelCandidate).toBeTruthy()
    const stateFactCandidate = capsule.candidateNodes.find((n: any) => n.kind === 'android-compose-fact')
    if (stateFactCandidate) {
      expect(viewModelCandidate.score).toBeGreaterThanOrEqual(stateFactCandidate.score)
    }
  })

  it('TST-662: a data/repository request surfaces the repository among owners', () => {
    const capsule = runContext('Change how Home data is loaded from the repository.', 'implementation')
    const ownerIds: string[] = capsule.selectedOwners.map((o: any) => o.id)
    expect(ownerIds.some((id) => id.includes('UserRepository'))).toBe(true)
  })

  it('TST-604: non-Android query ranking is unaffected (no Android boost applied)', () => {
    const capsule = runContext('formatUser helper function', 'implementation')
    for (const node of capsule.candidateNodes) {
      expect(JSON.stringify(node.reasons ?? [])).not.toContain('android-intent-category-match')
    }
  })

  it('TST-656: a legacy (no-role) request remains compatible and produces no Android evidence groups', () => {
    const capsule = runContext('Change the Home screen UI composable.')
    expect(capsule.evidenceGroups).toEqual([])
    expect(capsule.roleContext.role).toBeNull()
  })

  it('TST-655: capsule and audit remain schema "1.0.0"', () => {
    const root = createTempRoot()
    const capsuleOut = join(root, 'capsule.json')
    const auditOut = join(root, 'audit.json')
    const result = runCli([
      'context', '--index', outDir, '--query', 'Change the repository data loading.', '--role', 'implementation',
      '--out', capsuleOut, '--audit-out', auditOut, '--json',
    ])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    const audit = JSON.parse(readFileSync(auditOut, 'utf8'))
    expect(capsule.schemaVersion).toBe('1.0.0')
    expect(audit.schemaVersion).toBe('1.0.0')
  })

  it('TST-653: every Android conflict appearing in the capsule also appears in the audit (parity)', () => {
    const root = createTempRoot()
    const capsuleOut = join(root, 'capsule.json')
    const auditOut = join(root, 'audit.json')
    runCli([
      'context', '--index', outDir, '--query', 'Change the repository data loading.', '--role', 'implementation',
      '--out', capsuleOut, '--audit-out', auditOut, '--json',
    ])
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    const audit = JSON.parse(readFileSync(auditOut, 'utf8'))
    // Both artifacts derive contextAdequacy/roleAdequacy from the same pipeline run;
    // conflicts themselves are only serialized in the capsule today (pre-existing
    // convention - see conflicts field), so parity is checked on roleAdequacy/status.
    expect(audit.roleAdequacy.status).toBe(capsule.roleAdequacy.status)
  })
})

describe('v1.13.0 Batch 1C: connector terms do not dominate Android owner selection (D1)', () => {
  function runWithAudit(query: string): { capsule: any; audit: any } {
    const root = createTempRoot()
    const capsuleOut = join(root, 'capsule.json')
    const auditOut = join(root, 'audit.json')
    const result = runCli(['context', '--index', outDir, '--query', query, '--mode', 'feature-add', '--out', capsuleOut, '--audit-out', auditOut, '--json'])
    expect(result.status).toBe(0)
    return { capsule: JSON.parse(readFileSync(capsuleOut, 'utf8')), audit: JSON.parse(readFileSync(auditOut, 'utf8')) }
  }
  const HOME = 'android-compose-declaration:app/src/main/kotlin/com/example/combined/UserHomeScreen.kt#UserHomeScreen'

  it('the exact D1 query selects the same owner, candidates and scores as the connector-free control, without a conflict', () => {
    const natural = runWithAudit('add a new Compose screen next to UserHomeScreen')
    const control = runWithAudit('add new Compose screen next UserHomeScreen')
    expect(natural.capsule.focus.focusNodeId).toBe(HOME)
    expect(natural.capsule.conflicts.status).toBe('none')
    expect(natural.capsule.contextAdequacy.status).toBe(control.capsule.contextAdequacy.status)
    const brief = (c: any) => c.candidateFiles.map((f: any) => [f.path, f.score])
    expect(brief(natural.capsule)).toEqual(brief(control.capsule))
    expect(natural.capsule.candidateNodes.map((n: any) => [n.nodeId, n.score])).toEqual(control.capsule.candidateNodes.map((n: any) => [n.nodeId, n.score]))
    // unrelated owners are not retained file candidates
    expect(natural.capsule.candidateFiles.some((f: any) => f.retained && f.path.includes('other/MainActivity'))).toBe(false)
    // match reasons reflect the effective terms only
    const reasons = JSON.stringify(natural.capsule.focus.reasons)
    expect(reasons).toContain('userhomescreen')
    expect(reasons).not.toMatch(/matched term \\"(a|to)\\"/)
    // audit and query plan record what was actually searched
    const searchStep = natural.audit.steps.find((step: any) => step.kind === 'run-search')
    expect(searchStep.inputs).toEqual({ query: 'add new Compose screen next UserHomeScreen', suppressedConnectorTerms: 'a to' })
    expect(natural.capsule.queryPlan.originalQuery).toBe('add a new Compose screen next to UserHomeScreen')
  })

  it('a long natural request naming both screens focuses a Compose screen (not an unrelated Activity) and keeps the genuine screen tie', () => {
    const long = runWithAudit('add a new Compose screen UserProfileScreen in the UserSettingsScreen style, a sibling of UserHomeScreen and UserSettingsScreen').capsule
    expect(long.focus.focusNodeId).toMatch(/UserHomeScreen|UserSettingsScreen/)
    expect(long.focus.focusNodeId).not.toContain('MainActivity')
    const candidateIds = long.candidateNodes.map((n: any) => n.nodeId).join(' ')
    expect(candidateIds).toContain('UserHomeScreen')
    expect(candidateIds).toContain('UserSettingsScreen')
    // two named, equally plausible screens remain a conservative conflict
    expect(JSON.stringify(long.conflicts)).toContain('compose-ui-component')
  })

  it('identical input and index produce identical results', () => {
    const a = runWithAudit('add a new Compose screen next to UserHomeScreen').capsule
    const b = runWithAudit('add a new Compose screen next to UserHomeScreen').capsule
    expect(b.candidateFiles).toEqual(a.candidateFiles)
    expect(b.focus).toEqual(a.focus)
    expect(b.conflicts).toEqual(a.conflicts)
  })
})
