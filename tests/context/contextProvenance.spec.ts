import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'
import { buildProvenanceRecords, buildChangedSurfaceProvenance, mergeProvenanceRecords } from '../../src/context/contextProvenance.js'

// v1.10.1 Batch 4: evidence provenance.
// Responsibility IDs: TST-B4-045, 046, 047.

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

function writeFixture(root: string): { indexOut: string } {
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'widgetRegistry.ts'), "export function registerWidget(): void { /* entry point */ }\n")
  writeFileSync(
    join(src, 'widgetRegistry.spec.ts'),
    "import { registerWidget } from './widgetRegistry'\nexport const check = registerWidget\n"
  )
  const indexOut = join(root, '.my-dev-kit')
  expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)
  return { indexOut }
}

function writeRequest(root: string, name: string, body: unknown): string {
  const filePath = join(root, name)
  writeFileSync(filePath, JSON.stringify(body, null, 2))
  return filePath
}

describe('provenance (CLI, end-to-end)', () => {
  it('TST-B4-047: provenance records are deterministically ordered and stable across repeated runs', () => {
    const root = createTempRoot('my-dev-kit-v1-prov-order-')
    const { indexOut } = writeFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'implementation',
      changedFiles: ['src/widgetRegistry.ts'],
      changedSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
    })
    const outPath = join(root, 'capsule.json')
    const first = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(first.status).toBe(0)
    const capsule1 = JSON.parse(readFileSync(outPath, 'utf8'))
    const second = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(second.status).toBe(0)
    const capsule2 = JSON.parse(readFileSync(outPath, 'utf8'))

    expect(capsule1.provenance).toEqual(capsule2.provenance)
    const ids = capsule1.provenance.map((p: { id: string }) => p.id)
    expect(ids).toEqual([...ids].sort())
  })

  it('TST-B4-045: caller-supplied changed-surface evidence merges with candidate-ranking provenance without duplicating the evidence item', () => {
    const root = createTempRoot('my-dev-kit-v1-prov-merge-')
    const { indexOut } = writeFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'implementation',
      changedFiles: ['src/widgetRegistry.ts'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    const callerRecords = capsule.provenance.filter((p: { category: string }) => p.category === 'caller-changed-file')
    expect(callerRecords.length).toBeGreaterThan(0)
    // No provenance record duplicates another record's exact id.
    const ids = capsule.provenance.map((p: { id: string }) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('TST-B4-046: bounded test-directory-walk/import-scan evidence keeps its own provenance category, distinct from graph-based evidence', () => {
    const root = createTempRoot('my-dev-kit-v1-prov-testscan-')
    const { indexOut } = writeFixture(root)
    const requestPath = writeRequest(root, 'req.json', { schemaVersion: '1.0.0', query: 'widget', role: 'test-implementation', changedFiles: ['src/widgetRegistry.ts'] })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    const importScanRecords = capsule.provenance.filter((p: { category: string }) => p.category === 'import-scan')
    expect(importScanRecords.length).toBeGreaterThan(0)
    expect(importScanRecords.some((p: { sourcePath: string | null }) => p.sourcePath === 'src/widgetRegistry.spec.ts')).toBe(true)
  })
})

describe('provenance (unit-level)', () => {
  it('TST-B4-045: buildProvenanceRecords merges duplicate (category, path, evidenceId) triples, preserving distinct relationship bases', () => {
    const item = { id: 'src/a.ts', itemKind: 'file' as const, path: 'src/a.ts', relationship: 'owner-like candidate', basis: 'x', provenance: 'candidate-ranking' }
    const records = buildProvenanceRecords([
      { items: [item], role: 'architecture', requestField: null, derivedByModule: 'evidenceGroups.ts' },
      { items: [{ ...item, relationship: 'contract-like candidate' }], role: 'architecture', requestField: null, derivedByModule: 'evidenceGroups.ts' },
    ])
    expect(records.length).toBe(1)
    expect(records[0].relationshipBasis).toContain('owner-like candidate')
    expect(records[0].relationshipBasis).toContain('contract-like candidate')
  })

  it('TST-B4-045: buildChangedSurfaceProvenance splits "both"-provenance entries into two distinct, non-duplicated categories', () => {
    const records = buildChangedSurfaceProvenance(
      { available: true, diffRequested: true, files: [{ path: 'src/a.ts', status: 'modified', provenance: 'both' }], symbols: [], conflicts: [], warnings: [] },
      'test-implementation'
    )
    const categories = records.map((r) => r.category).sort()
    expect(categories).toEqual(['caller-changed-file', 'graph-diff'])
  })

  it('mergeProvenanceRecords deduplicates identical IDs across groups deterministically', () => {
    const a = { id: 'x:1', category: 'code-graph' as const, sourcePath: 'src/a.ts', sourceId: null, evidenceId: 'src/a.ts', relationshipBasis: 'r1', role: null, requestField: null, derivedByModule: 'm1' }
    const b = { ...a, relationshipBasis: 'r2', derivedByModule: 'm2' }
    const merged = mergeProvenanceRecords([[a], [b]])
    expect(merged.length).toBe(1)
    expect(merged[0]).toEqual(a)
  })
})
