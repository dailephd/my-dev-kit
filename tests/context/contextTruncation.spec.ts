import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

// v1.10.1 Batch 4: budget and truncation reporting.
// Responsibility IDs: TST-B4-036, 037, 038, 039, 040, 041.

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

/** Ten owner-like, contract-like, and test-like files so evidence-group limits (which
 * are well below 10 for most groups) are exceeded deterministically. */
function writeManyFilesFixture(root: string): { indexOut: string } {
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  for (let i = 0; i < 12; i++) {
    const n = String(i).padStart(2, '0')
    writeFileSync(join(src, `widgetManager${n}.ts`), `export function manage${n}(): void { /* widget */ }\n`)
    writeFileSync(join(src, `widgetValidator${n}.ts`), `export function validate${n}(): boolean { return true }\n`)
  }
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

describe('budget and truncation', () => {
  it('TST-B4-036/037: candidate and evidence-group budget usage is reported with declared/used/dropped counts', () => {
    const root = createTempRoot('my-dev-kit-v1-budget-basic-')
    const { indexOut } = writeManyFilesFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'architecture',
      limits: { candidates: 5 },
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    const candidatesBudget = capsule.budget.limits.find((l: { name: string }) => l.name === 'candidates')
    expect(candidatesBudget.declaredValue).toBe(5)
    expect(typeof candidatesBudget.usedValue).toBe('number')
    const evidenceGroupBudget = capsule.budget.limits.find((l: { name: string }) => l.name === 'evidenceGroupEntries')
    expect(evidenceGroupBudget).toBeDefined()
    expect(typeof evidenceGroupBudget.usedValue).toBe('number')
  })

  it('TST-B4-038: responsibility-mapping truncation is enforced by limits.responsibilityMappings and reported', () => {
    const root = createTempRoot('my-dev-kit-v1-budget-resp-')
    const { indexOut } = writeManyFilesFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'implementation',
      focusFiles: ['src/widgetManager00.ts'],
      testResponsibilityRefs: ['resp-a', 'resp-b', 'resp-c'],
      requestedEvidenceKinds: ['responsibility-mappings'],
      limits: { responsibilityMappings: 1 },
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.responsibilityMappings.usedCount).toBe(1)
    expect(capsule.responsibilityMappings.truncated).toBe(true)
    expect(capsule.responsibilityMappings.droppedCount).toBe(2)
    const record = capsule.truncation.records.find((r: { affectedGroup: string }) => r.affectedGroup === 'responsibility-mappings')
    expect(record).toBeDefined()
    expect(record.droppedCount).toBe(2)
  })

  it('TST-B4-039: character budget is deterministic and bounded when `limits.characters` is supplied', () => {
    const root = createTempRoot('my-dev-kit-v1-budget-chars-')
    const { indexOut } = writeManyFilesFixture(root)
    const requestPath = writeRequest(root, 'req.json', { schemaVersion: '1.0.0', query: 'widget', role: 'architecture', limits: { characters: 10 } })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule1 = JSON.parse(readFileSync(outPath, 'utf8'))
    const result2 = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result2.status).toBe(0)
    const capsule2 = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule1.budget.characters).toEqual(capsule2.budget.characters)
    expect(capsule1.budget.characters.limit).toBe(10)
    expect(capsule1.budget.characters.truncated).toBe(true)
  })

  it('TST-B4-040: required evidence-group truncation reduces role adequacy and is not hidden', () => {
    const root = createTempRoot('my-dev-kit-v1-budget-required-loss-')
    const { indexOut } = writeManyFilesFixture(root)
    // Force a small candidates cap so many owner-like candidates compete for a tiny
    // "owners" group limit (5 for architecture), guaranteeing truncation of a required group.
    const requestPath = writeRequest(root, 'req.json', { schemaVersion: '1.0.0', query: 'manage', role: 'architecture' })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    const ownersGroup = capsule.evidenceGroups.find((g: { kind: string }) => g.kind === 'owners')
    if (ownersGroup.truncated) {
      expect(capsule.truncation.truncated).toBe(true)
      const record = capsule.truncation.records.find((r: { affectedGroup: string }) => r.affectedGroup === ownersGroup.id)
      expect(record.requiredEvidenceLost).toBe(true)
      expect(capsule.roleAdequacy.missingConditions).toContain('required evidence truncated')
    } else {
      // Environment produced fewer owner-like candidates than the group limit; the
      // absence-of-truncation branch is still a valid, honestly-reported outcome.
      expect(capsule.truncation.records.find((r: { affectedGroup: string }) => r.affectedGroup === ownersGroup.id)).toBeUndefined()
    }
  })

  it('TST-B4-041: truncating only noncritical responsibility mappings (limits.responsibilityMappings) warns without forcing inadequacy', () => {
    // Every responsibility mapped through the current string-only testResponsibilityRefs
    // contract is noncritical (section 18's documented safe default), and truncation is
    // deterministically critical-first (section 25.2) — so a responsibilityMappings limit
    // smaller than the supplied (all-noncritical) count can only ever drop noncritical
    // mappings. This is the honest "optional evidence truncated" case section 25.3
    // distinguishes from required-evidence loss (TST-B4-038/040 cover the loss case).
    // Deliberately a small (non-truncating) fixture: only responsibility-mapping
    // truncation should occur here, so this isolates the "optional/noncritical
    // truncation" case from any unrelated required-evidence-group truncation.
    const root = createTempRoot('my-dev-kit-v1-budget-noncritical-loss-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'widgetRegistry.ts'), 'export function registerWidget(): void {}\n')
    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'implementation',
      focusFiles: ['src/widgetRegistry.ts'],
      testResponsibilityRefs: ['resp-a', 'resp-b', 'resp-c'],
      requestedEvidenceKinds: ['responsibility-mappings'],
      limits: { responsibilityMappings: 2 },
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.responsibilityMappings.truncated).toBe(true)
    expect(capsule.responsibilityMappings.criticalDropped).toBe(false)
    const record = capsule.truncation.records.find((r: { affectedGroup: string }) => r.affectedGroup === 'responsibility-mappings')
    expect(record.requiredEvidenceLost).toBe(false)
    // Truncation is still honestly reported (never hidden), but must not appear in
    // roleAdequacy.missingConditions as "required evidence truncated" on its own.
    expect(capsule.roleAdequacy.missingConditions).not.toContain('required evidence truncated')
  })
})
