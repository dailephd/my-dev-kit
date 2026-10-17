/**
 * v1.13.0 post-Batch-5 D2 correction: end-to-end owner selection over the
 * public examples/basic-android-kotlin project.
 *
 * D2-A: an explicitly excluded or merely depended-on component must not become
 * the primary edit owner of a context request. D2-B: Android `src/androidTest`
 * source is test-scoped, so it never earns a production ownership tier.
 * Every case runs the real `index`, `context` and `search` commands.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isTestScoped } from '../../src/classification/classificationHelpers.js'
import { runCli } from '../lookup/testCli.js'

const EXAMPLE_ROOT = join(process.cwd(), 'examples', 'basic-android-kotlin')
const TS_EXAMPLE_ROOT = join(process.cwd(), 'examples', 'basic-ts')
const KP = 'app/src/main/kotlin/com/example/kitdemo/'

const tempDirs: string[] = []
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v113-d2-'))
  tempDirs.push(root)
  return root
}
afterAll(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

let androidIndex: string
let tsIndex: string
let scratch: string
let counter = 0

beforeAll(() => {
  scratch = tempRoot()
  androidIndex = join(scratch, 'android-index')
  const android = runCli([
    'index', '--root', EXAMPLE_ROOT,
    '--src', 'app/src/main', '--src', 'app/src/test', '--src', 'app/src/androidTest',
    '--out', androidIndex, '--json',
  ])
  expect(android.status).toBe(0)
  tsIndex = join(scratch, 'ts-index')
  const ts = runCli(['index', '--root', TS_EXAMPLE_ROOT, '--src', 'src', '--out', tsIndex, '--json'])
  expect(ts.status).toBe(0)
}, 240_000)

function context(index: string, role: string, query: string, extra: Record<string, unknown> = {}): any {
  counter += 1
  const out = join(scratch, `capsule-${counter}.json`)
  const audit = join(scratch, `audit-${counter}.json`)
  if (Object.keys(extra).length > 0) {
    const request = join(scratch, `request-${counter}.json`)
    writeFileSync(request, JSON.stringify({ schemaVersion: '1.0.0', role, query, index, output: out, auditOutput: audit, ...extra }))
    const result = runCli(['context', '--request', request, '--json'])
    expect(result.status).toBe(0)
    return JSON.parse(readFileSync(out, 'utf8'))
  }
  const result = runCli(['context', '--index', index, '--role', role, '--query', query, '--out', out, '--audit-out', audit, '--json'])
  expect(result.status).toBe(0)
  return JSON.parse(readFileSync(out, 'utf8'))
}
const implementation = (query: string, extra?: Record<string, unknown>) => context(androidIndex, 'implementation', query, extra)
const ownerIds = (capsule: any): string[] => capsule.selectedOwners.map((o: any) => o.id)
const candidateIds = (capsule: any): string[] => capsule.candidateNodes.map((n: any) => n.nodeId)
const SCREEN = `${KP}UserHomeScreen.kt`
const VM = `${KP}UserViewModel.kt`
const REPO = `${KP}data/UserRepository.kt`
const SERVICE = `${KP}data/UserApiService.kt`
const SCREEN_TEST = 'app/src/androidTest/kotlin/com/example/kitdemo/UserHomeScreenTest.kt'

describe('D2-A: edit-target selection with exclusion and dependency clauses', () => {
  it('1-2: selects the UI owner for a UI change that excludes the ViewModel, and keeps the ViewModel as non-primary evidence', () => {
    for (const query of [
      'Change the UserHomeScreen layout without changing the ViewModel.',
      'Update UserHomeScreen presentation while preserving UserViewModel behavior.',
    ]) {
      const capsule = implementation(query)
      expect(capsule.focus.focusFilePath).toBe(SCREEN)
      expect(ownerIds(capsule)[0]).toContain('UserHomeScreen')
      expect(ownerIds(capsule).some((id) => id.includes('UserViewModel#UserViewModel') || id.endsWith('UserViewModel.kt#UserViewModel'))).toBe(false)
      expect(capsule.conflicts.conflicts.some((c: any) => c.kind === 'android-ambiguous-owner')).toBe(false)
      // excluded dependency stays visible, but not as the leading candidate
      expect(candidateIds(capsule).some((id) => id.includes('UserViewModel.kt'))).toBe(true)
      expect(candidateIds(capsule).some((id) => id.includes('UserHomeScreenTest'))).toBe(true)
      expect(capsule.selectedGraph.nodes.some((item: any) => item.nodeId.includes('UserHomeScreenTest'))).toBe(true)
      const first = capsule.candidateNodes[0]
      expect(first.nodeId).toContain('UserHomeScreen')
      expect(first.score).toBeGreaterThan(capsule.candidateNodes.find((n: any) => n.nodeId.includes('UserViewModel.kt')).score)
    }
  })

  it('3-4: selects the Repository for a data-loading change and keeps the service as supporting evidence', () => {
    for (const query of [
      'Change UserRepository data-loading behavior without modifying UserApiService.',
      'Change how UserRepository refreshes users from the DAO and Retrofit service.',
    ]) {
      const capsule = implementation(query)
      expect(capsule.focus.focusFilePath).toBe(REPO)
      expect(ownerIds(capsule)[0]).toContain('UserRepository')
      expect(candidateIds(capsule).some((id) => id.includes('UserApiService'))).toBe(true)
      expect(candidateIds(capsule).some((id) => id.includes('UserDao'))).toBe(true)
      expect(ownerIds(capsule).some((id) => id.includes('UserApiService'))).toBe(true)
      expect(capsule.conflicts.conflicts.some((c: any) => c.kind === 'android-ambiguous-owner')).toBe(false)
    }
  })

  it('5-6: still selects the ViewModel for a state task and the service for a network-contract task', () => {
    const state = implementation('Update UserViewModel state handling.')
    expect(state.focus.focusFilePath).toBe(VM)
    expect(ownerIds(state)[0]).toContain('UserViewModel')
    expect(candidateIds(state).some((id) => id.includes('UserHomeScreen'))).toBe(true)
    expect(state.conflicts.conflicts.some((c: any) => c.kind === 'android-ambiguous-owner')).toBe(false)
    const contract = implementation('Change the UserApiService Retrofit contract.')
    expect(contract.focus.focusFilePath).toBe(SERVICE)
    expect(ownerIds(contract)[0]).toContain('UserApiService')
    expect(candidateIds(contract).some((id) => id.includes('UserRepository'))).toBe(true)
    expect(contract.conflicts.conflicts.some((c: any) => c.kind === 'android-ambiguous-owner')).toBe(false)
  })

  it('2b: a direct single-screen presentation request does not conflict with navigation or test projections', () => {
    const capsule = implementation('Update UserHomeScreen presentation.')
    expect(capsule.focus.focusFilePath).toBe(SCREEN)
    expect(ownerIds(capsule)[0]).toContain('UserHomeScreen')
    expect(candidateIds(capsule).some((id) => id.includes('AppNavigation'))).toBe(true)
    expect(candidateIds(capsule).some((id) => id.includes('UserHomeScreenTest'))).toBe(true)
    expect(capsule.conflicts.conflicts.some((c: any) => c.kind === 'android-ambiguous-owner')).toBe(false)
  })

  it('13: keeps ambiguity for a genuine multi-layer request instead of a falsely certain single owner', () => {
    const capsule = implementation('Change the UserHomeScreen layout and update the UserViewModel state handling.')
    const ids = ownerIds(capsule).join(' ')
    expect(ids).toContain('UserHomeScreen')
    expect(ids).toContain('UserViewModel')
    expect(capsule.contextAdequacy.status).not.toBe('context sufficient for implementation')
    const ambiguity = capsule.conflicts.conflicts.find((c: any) => c.kind === 'android-ambiguous-owner')
    expect(ambiguity).toBeTruthy()
    expect(ambiguity.candidates.some((candidate: any) => candidate.nodeId.includes('UserHomeScreen'))).toBe(true)
    expect(ambiguity.candidates.some((candidate: any) => candidate.nodeId.includes('UserViewModel'))).toBe(true)
    expect(ambiguity.candidates.some((candidate: any) => candidate.nodeId.includes('AppNavigation') || candidate.nodeId.includes('MainActivity'))).toBe(false)
    expect(candidateIds(capsule).some((id) => id.includes('AppNavigation'))).toBe(true)
    expect(ambiguity.reason).toContain('multiple primary responsibilities')
  })

  it('18: two explicitly plausible screens remain competing primary owners', () => {
    const capsule = implementation('Change the screen layout for UserHomeScreen and UserSettingsScreen.')
    const ambiguity = capsule.conflicts.conflicts.find((c: any) => c.kind === 'android-ambiguous-owner' && c.candidates.some((candidate: any) => candidate.nodeId.includes('UserHomeScreen')) && c.candidates.some((candidate: any) => candidate.nodeId.includes('UserSettingsScreen')))
    expect(candidateIds(capsule).some((id) => id.includes('UserHomeScreen'))).toBe(true)
    expect(candidateIds(capsule).some((id) => id.includes('UserSettingsScreen'))).toBe(true)
    expect(ambiguity).toBeTruthy()
    expect(ambiguity.candidates.map((candidate: any) => candidate.nodeId).sort()).toEqual([
      'android-compose-declaration:app/src/main/kotlin/com/example/kitdemo/UserHomeScreen.kt#UserHomeScreen',
      'android-compose-declaration:app/src/main/kotlin/com/example/kitdemo/UserSettingsScreen.kt#UserSettingsScreen',
    ])
  })

  it('19: a nonexistent screen remains unresolved instead of receiving a fabricated owner', () => {
    const capsule = implementation('Change UnknownProfileScreen presentation.')
    expect(capsule.focus.focusNodeId).toBeNull()
    expect(ownerIds(capsule)).toEqual([])
    expect(capsule.conflicts.status).toBe('none')
  })

  it('12: an explicit focus file stays boosted and wins when the request states no competing layer', () => {
    const neutral = implementation('Investigate the refresh flow.', { focusFiles: [VM] })
    expect(neutral.focus.focusFilePath).toBe(VM)
    // a stated UI intent still outranks a focus boost (unchanged policy), but the focus match is preserved
    const ui = implementation('Change the UserHomeScreen layout without changing the ViewModel.', { focusFiles: [VM] })
    const focused = ui.candidateFiles.find((f: any) => f.path === VM)
    expect(focused.focusMatch).toBe(true)
    expect(ui.candidateNodes.find((n: any) => n.nodeId.endsWith('UserViewModel.kt#UserViewModel')).focusMatch).toBe(true)
  })

  it('14: keeps the connector-term correction and the original query', () => {
    const query = 'Change the UserHomeScreen layout without changing the ViewModel.'
    const capsule = implementation(query)
    expect(capsule.queryPlan.originalQuery).toBe(query)
    expect(capsule.queryPlan.searchQueries[0]).toBe('Change UserHomeScreen layout without changing ViewModel.')
  })

  it('16-17: is deterministic and keeps the capsule shape and caps', () => {
    const query = 'Change the UserHomeScreen layout without changing the ViewModel.'
    const first = implementation(query)
    const second = implementation(query)
    const stable = (c: any) => ({
      focus: c.focus,
      owners: ownerIds(c),
      nodes: c.candidateNodes.map((n: any) => ({ id: n.nodeId, score: n.score, reasons: n.reasons })),
      adequacy: c.contextAdequacy.status,
      conflicts: c.conflicts,
    })
    expect(stable(second)).toEqual(stable(first))
    expect(Object.keys(first).sort()).toEqual(Object.keys(second).sort())
    for (const key of ['schemaVersion', 'request', 'limits', 'focus', 'selectedOwners', 'candidateNodes', 'conflicts', 'contextAdequacy', 'queryPlan']) {
      expect(first).toHaveProperty(key)
    }
    expect(first.candidateFiles.filter((f: any) => f.retained).length).toBeLessThanOrEqual(first.limits.maxCandidateFiles ?? Infinity)
    // an explanation of the intent boost is still recorded per candidate
    expect(first.candidateNodes[0].reasons.some((r: string) => r.startsWith('android-intent-category-match'))).toBe(true)
  })
})

describe('tests remain valid test-oriented requests and are never production owners', () => {
  it('7: a test-implementation request keeps the test as its focus', () => {
    const capsule = context(androidIndex, 'test-implementation', 'Update the UserHomeScreenTest assertion.')
    expect(capsule.focus.focusFilePath).toBe(SCREEN_TEST)
    const testLocation = capsule.candidateNodes.find((candidate: any) => candidate.nodeId.includes('UserHomeScreenTest') && candidate.classificationRoles?.some((role: any) => role.editGuidance === 'test-only'))
    expect(testLocation).toBeTruthy()
    expect(ownerIds(capsule).some((id) => id.includes('UserHomeScreenTest'))).toBe(false)
  })

  it('15: the same request under the implementation role keeps the wrong-layer conflict and no test owner', () => {
    const capsule = implementation('Update the UserHomeScreenTest assertion.')
    expect(capsule.focus.focusFilePath).toBe(SCREEN_TEST)
    expect(capsule.conflicts.conflicts.some((c: any) => c.kind === 'android-test-primary-target')).toBe(true)
    expect(ownerIds(capsule).some((id) => id.includes('UserHomeScreenTest'))).toBe(false)
  })
})

describe('D2-B: androidTest is test-scoped for ownership tiers', () => {
  it('8-9: an androidTest symbol is supporting evidence yet still discoverable', () => {
    const owned = runCli(['search', '--index', androidIndex, '--query', 'UserHomeScreen', '--intent', 'ownership', '--limit', '20', '--json'])
    const relevance = runCli(['search', '--index', androidIndex, '--query', 'UserHomeScreen', '--limit', '20', '--json'])
    expect(owned.status).toBe(0)
    const ownedResults = JSON.parse(owned.stdout).results
    const relevanceResults = JSON.parse(relevance.stdout).results
    const testId = `symbol:${SCREEN_TEST}#UserHomeScreenTest`
    const screenId = `symbol:${SCREEN}#UserHomeScreen`
    const test = ownedResults.find((r: any) => r.id === testId)
    expect(test.ownership.tier).toBe('supporting-evidence')
    expect(ownedResults.find((r: any) => r.id === screenId).ownership.tier).toBe('direct-owner')
    const plain = relevanceResults.find((r: any) => r.id === testId)
    expect(test.score).toBe(plain.score)
    expect(test.matchReasons).toEqual(plain.matchReasons)
    expect(ownedResults.every((r: any) => !r.path?.includes('androidTest') || r.ownership.tier === 'supporting-evidence')).toBe(true)
    const role = runCli(['search', '--index', androidIndex, '--android-role', 'instrumented-test', '--json'])
    expect(JSON.parse(role.stdout).results.length).toBeGreaterThan(0)
  })

  it('10: classifies Android source sets and keeps previous recognition', () => {
    expect(isTestScoped('app/src/androidTest/kotlin/com/example/UserHomeScreenTest.kt')).toBe(true)
    expect(isTestScoped('app/src/test/kotlin/com/example/UserViewModelTest.kt')).toBe(true)
    expect(isTestScoped('tests/helpers/util.ts')).toBe(true)
    expect(isTestScoped('src/__mocks__/api.ts')).toBe(true)
    expect(isTestScoped('src/widget.spec.ts')).toBe(true)
    expect(isTestScoped('app/src/main/kotlin/com/example/AndroidTestHelper.kt')).toBe(false)
    expect(isTestScoped('app/src/main/kotlin/androidTestUtil/Thing.kt')).toBe(false)
    expect(isTestScoped('app/src/main/kotlin/com/example/UserHomeScreen.kt')).toBe(false)
  })
})

describe('non-Android behavior is unchanged', () => {
  it('11: a TypeScript context request carries no Android boost and ownership search keeps its tiers', () => {
    const capsule = context(tsIndex, 'implementation', 'Change describeUser without changing the ViewModel')
    expect(capsule.candidateNodes.every((n: any) => !n.reasons.some((r: string) => r.startsWith('android-intent-category-match')))).toBe(true)
    const owned = runCli(['search', '--index', tsIndex, '--query', 'describeUser', '--intent', 'ownership', '--json'])
    expect(owned.status).toBe(0)
    const results = JSON.parse(owned.stdout).results
    expect(results.find((r: any) => r.id === 'symbol:src/index.ts#describeUser').ownership.tier).toBe('direct-owner')
  })
})
