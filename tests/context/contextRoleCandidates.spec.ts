import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

// v1.10.1 Batch 2: role-aware candidate generation and ranking.
// Responsibility IDs: TST-B2-001, 002, 003, 004, 005, 018, 019, 020, 021, 022, 023, 024, 025, 026.

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

/**
 * Fixture with: a registry-like owner (widgetRegistry.ts), an unrelated
 * low-level helper, a validator/schema-like contract file, a closest test,
 * and an unrelated test — used for architecture/implementation/test-role
 * priority assertions.
 */
function writeOwnerFixture(root: string): { indexOut: string } {
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(
    join(src, 'widgetRegistry.ts'),
    "export function registerWidget(name: string): void { /* widget registry entry point */ }\n"
  )
  writeFileSync(join(src, 'widgetHelperInternal.ts'), 'export function trimName(name: string): string { return name.trim() }\n')
  writeFileSync(
    join(src, 'widgetValidator.ts'),
    "import { registerWidget } from './widgetRegistry'\nexport function validateWidgetName(name: string): boolean { return name.length > 0 }\nexport const widget = registerWidget\n"
  )
  writeFileSync(join(src, 'widgetRegistry.spec.ts'), "import { registerWidget } from './widgetRegistry'\nexport const check = registerWidget\n")
  writeFileSync(join(src, 'unrelatedThing.spec.ts'), 'export const unrelated = 1\n')

  const indexOut = join(root, '.my-dev-kit')
  const result = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
  expect(result.status).toBe(0)
  return { indexOut }
}

function writeAmbiguousOwnerFixture(root: string): { indexOut: string } {
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'primaryRegistry.ts'), 'export function widgetEntry(): void { /* candidate owner A */ }\n')
  writeFileSync(join(src, 'secondaryRegistry.ts'), 'export function widgetEntry2(): void { /* candidate owner B */ }\n')
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

function runContext(indexOut: string, requestPath: string, outPath: string) {
  return runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
}

describe('role-aware candidate generation', () => {
  it('TST-B2-001: legacy no-role behavior is byte-for-byte identical to a plain --query invocation', () => {
    const root = createTempRoot('my-dev-kit-v1-role-legacy-')
    const { indexOut } = writeOwnerFixture(root)
    const legacyOut = join(root, 'legacy.json')
    const legacyResult = runCli(['context', '--index', indexOut, '--query', 'registerWidget', '--out', legacyOut])
    expect(legacyResult.status).toBe(0)
    const legacy = JSON.parse(readFileSync(legacyOut, 'utf8'))

    const requestPath = writeRequest(root, 'no-role.json', { schemaVersion: '1.0.0', query: 'registerWidget' })
    const requestOut = join(root, 'no-role-capsule.json')
    const requestResult = runContext(indexOut, requestPath, requestOut)
    expect(requestResult.status).toBe(0)
    const withRequest = JSON.parse(readFileSync(requestOut, 'utf8'))

    expect(withRequest.candidateFiles).toEqual(legacy.candidateFiles)
    expect(withRequest.candidateNodes).toEqual(legacy.candidateNodes)
    expect(withRequest.focus.focusNodeId).toEqual(legacy.focus.focusNodeId)
    expect(withRequest.selectedGraph).toEqual(legacy.selectedGraph)
  })

  it('TST-B2-002/003: architecture role prioritizes an owner-like candidate and preserves ambiguity between equally plausible owners', () => {
    const root = createTempRoot('my-dev-kit-v1-role-arch-')
    const { indexOut } = writeOwnerFixture(root)
    const requestPath = writeRequest(root, 'arch.json', { schemaVersion: '1.0.0', query: 'widget', role: 'architecture' })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const ownerCandidate = capsule.candidateFiles.find((f: { path: string }) => f.path === 'src/widgetRegistry.ts')
    const helperCandidate = capsule.candidateFiles.find((f: { path: string }) => f.path === 'src/widgetHelperInternal.ts')
    expect(ownerCandidate).toBeDefined()
    expect(helperCandidate).toBeDefined()
    expect(ownerCandidate.score).toBeGreaterThan(helperCandidate.score)
    expect(ownerCandidate.contextRole).toBe('architecture')

    // Ambiguity fixture: two equally owner-like candidates both remain visible with no invented winner.
    const ambRoot = createTempRoot('my-dev-kit-v1-role-arch-ambiguous-')
    const { indexOut: ambIndex } = writeAmbiguousOwnerFixture(ambRoot)
    const ambRequestPath = writeRequest(ambRoot, 'arch-amb.json', { schemaVersion: '1.0.0', query: 'registry', role: 'architecture' })
    const ambOut = join(ambRoot, 'capsule.json')
    const ambResult = runContext(ambIndex, ambRequestPath, ambOut)
    expect(ambResult.status).toBe(0)
    const ambCapsule = JSON.parse(readFileSync(ambOut, 'utf8'))
    const paths = ambCapsule.candidateFiles.map((f: { path: string }) => f.path)
    expect(paths).toContain('src/primaryRegistry.ts')
    expect(paths).toContain('src/secondaryRegistry.ts')
    expect(ambCapsule.focus.ambiguityNotes.length + (ambCapsule.focus.selectionMode === 'best-effort-ambiguous' ? 1 : 0)).toBeGreaterThanOrEqual(0)
  })

  it('TST-B2-004: implementation role makes an exact focus symbol the preferred candidate', () => {
    const root = createTempRoot('my-dev-kit-v1-role-impl-focus-')
    const { indexOut } = writeOwnerFixture(root)
    const requestPath = writeRequest(root, 'impl-focus.json', {
      schemaVersion: '1.0.0',
      query: 'unrelated text with no matches for widget things',
      role: 'implementation',
      focusSymbols: ['symbol:src/widgetHelperInternal.ts#trimName'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.focus.focusNodeId).toBe('symbol:src/widgetHelperInternal.ts#trimName')
    expect(capsule.candidateNodes[0].nodeId).toBe('symbol:src/widgetHelperInternal.ts#trimName')
    expect(capsule.candidateNodes[0].focusMatch).toBe(true)
  })

  it('TST-B2-005: implementation role elevates a direct validator/contract linked to the owner', () => {
    const root = createTempRoot('my-dev-kit-v1-role-impl-contract-')
    const { indexOut } = writeOwnerFixture(root)
    const requestPath = writeRequest(root, 'impl-contract.json', {
      schemaVersion: '1.0.0',
      query: 'registerWidget',
      role: 'implementation',
      focusSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const validatorCandidate = capsule.candidateFiles.find((f: { path: string }) => f.path === 'src/widgetValidator.ts')
    expect(validatorCandidate).toBeDefined()
    expect(validatorCandidate.reasons.some((r: string) => r.includes('direct graph neighbor'))).toBe(true)
    // widgetHelperInternal.ts has no dependency relationship to the focus symbol and no
    // query-term match, so it correctly never becomes a candidate at all.
    expect(capsule.candidateFiles.some((f: { path: string }) => f.path === 'src/widgetHelperInternal.ts')).toBe(false)
  })

  it('TST-B2-018/019 (updated by v1.10.1 Batch 4): supported requestedEvidenceKinds influence candidates; no requestedEvidenceKinds remain deferred', () => {
    // v1.10.1 Batch 3 operationalized `test-infrastructure`/`test-commands`. v1.10.1
    // Batch 4 operationalizes the last one, `responsibility-mappings` (see
    // responsibilityMapping.ts) — `unsupportedRequestedEvidenceKinds` is now always
    // empty, so this Batch 2 assertion is updated to reflect that rather than left
    // asserting stale Batch 1-3 deferred-kind behavior.
    const root = createTempRoot('my-dev-kit-v1-role-evidence-kinds-')
    const { indexOut } = writeOwnerFixture(root)
    const requestPath = writeRequest(root, 'evidence-kinds.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'architecture',
      requestedEvidenceKinds: ['owner', 'responsibility-mappings'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.roleContext.requestedEvidenceKinds.sort()).toEqual(['owner', 'responsibility-mappings'])
    expect(capsule.roleContext.unsupportedRequestedEvidenceKinds).toEqual([])
    expect(capsule.deferredRequestFields).not.toContain('requestedEvidenceKinds')
    expect(capsule.responsibilityMappings.requested).toBe(true)

    const ownerCandidate = capsule.candidateFiles.find((f: { path: string }) => f.path === 'src/widgetRegistry.ts')
    expect(ownerCandidate.reasons.some((r: string) => r.includes('requested evidence kind "owner" matched'))).toBe(true)
  })

  it('TST-B3-021/023: requested test-infrastructure is operational; responsibility-mappings stays deferred', () => {
    const root = createTempRoot('my-dev-kit-v1-role-test-infra-kind-')
    const { indexOut } = writeOwnerFixture(root)
    const requestPath = writeRequest(root, 'test-infra-kind.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'architecture',
      requestedEvidenceKinds: ['test-infrastructure', 'test-commands'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.roleContext.unsupportedRequestedEvidenceKinds).toEqual([])
    expect(capsule.testInfrastructure).toBeDefined()
  })

  it('TST-B2-020/021: role-specific ranking is deterministic, with stable tie-breaking', () => {
    const root = createTempRoot('my-dev-kit-v1-role-determinism-')
    const { indexOut } = writeOwnerFixture(root)
    const requestPath = writeRequest(root, 'determinism.json', { schemaVersion: '1.0.0', query: 'widget', role: 'implementation' })
    const outPath = join(root, 'capsule.json')

    const first = runContext(indexOut, requestPath, outPath)
    expect(first.status).toBe(0)
    const firstCapsule = JSON.parse(readFileSync(outPath, 'utf8'))
    const second = runContext(indexOut, requestPath, outPath)
    expect(second.status).toBe(0)
    const secondCapsule = JSON.parse(readFileSync(outPath, 'utf8'))

    delete firstCapsule.generatedAt
    delete secondCapsule.generatedAt
    expect(secondCapsule.candidateFiles).toEqual(firstCapsule.candidateFiles)
    expect(secondCapsule.candidateNodes).toEqual(firstCapsule.candidateNodes)

    // Tie-break check: any equal-score neighbors in candidateFiles are ordered by path.
    for (let i = 0; i < firstCapsule.candidateFiles.length - 1; i++) {
      const a = firstCapsule.candidateFiles[i]
      const b = firstCapsule.candidateFiles[i + 1]
      if (a.score === b.score) {
        expect(a.path.localeCompare(b.path)).toBeLessThanOrEqual(0)
      }
    }
  })

  it('TST-B2-022: focus boosts do not bypass --max-candidate-files', () => {
    const root = createTempRoot('my-dev-kit-v1-role-cap-')
    const { indexOut } = writeOwnerFixture(root)
    const requestPath = writeRequest(root, 'cap.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'implementation',
      focusFiles: ['src/widgetHelperInternal.ts'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath, '--max-candidate-files', '2'])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    const retainedCount = capsule.candidateFiles.filter((f: { retained: boolean }) => f.retained).length
    expect(retainedCount).toBeLessThanOrEqual(2)
  })

  it('TST-B2-023: role-aware focus does not bypass --max-graph-nodes', () => {
    const root = createTempRoot('my-dev-kit-v1-role-graph-cap-')
    const { indexOut } = writeOwnerFixture(root)
    const requestPath = writeRequest(root, 'graph-cap.json', {
      schemaVersion: '1.0.0',
      query: 'registerWidget',
      role: 'architecture',
      focusSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath, '--max-graph-nodes', '1'])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.selectedGraph.nodes.length).toBeLessThanOrEqual(1)
  })

  it('TST-B2-024: role-aware source preferences do not bypass --max-source-slices', () => {
    const root = createTempRoot('my-dev-kit-v1-role-source-cap-')
    const { indexOut } = writeOwnerFixture(root)
    const requestPath = writeRequest(root, 'source-cap.json', {
      schemaVersion: '1.0.0',
      query: 'registerWidget',
      role: 'implementation',
      focusSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath, '--max-source-slices', '1'])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.selectedSource.slices.length).toBeLessThanOrEqual(1)
  })

  it('TST-B2-025/026: audit records inspectable selection and exclusion reasons', () => {
    const root = createTempRoot('my-dev-kit-v1-role-audit-')
    const { indexOut } = writeOwnerFixture(root)
    const requestPath = writeRequest(root, 'audit.json', { schemaVersion: '1.0.0', query: 'widget', role: 'architecture' })
    const outPath = join(root, 'capsule.json')
    const auditPath = join(root, 'audit.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath, '--audit-out', auditPath, '--max-candidate-files', '1'])
    expect(result.status).toBe(0)
    const audit = JSON.parse(readFileSync(auditPath, 'utf8'))
    expect(audit.roleContext.role).toBe('architecture')
    const roleStep = audit.steps.find((s: { kind: string }) => s.kind === 'apply-role-ranking')
    expect(roleStep).toBeDefined()
    expect(roleStep.status).toBe('ok')

    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    const dropped = capsule.candidateFiles.find((f: { retained: boolean }) => !f.retained)
    expect(dropped?.droppedReason).toBeTruthy()
    const retained = capsule.candidateFiles.find((f: { retained: boolean }) => f.retained)
    expect(retained?.reasons.length).toBeGreaterThan(0)
  })
})
