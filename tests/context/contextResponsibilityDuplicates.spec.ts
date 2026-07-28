import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

// v1.10.3 Batch 3: duplicate responsibility diagnostics (F-004, Stage 0 CASE-006).
// Responsibility IDs: TST-B1303-001..013.

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

/** Same fully-grounded fixture shape as contextResponsibilityMapping.spec.ts's
 * writeFullFixture: owner + validator + constant + error + schema + related test +
 * fixture + package.json test script, so a responsibility can reach `mapped`. */
function writeFullFixture(root: string): { indexOut: string } {
  const src = join(root, 'src')
  const fixtures = join(src, '__fixtures__')
  mkdirSync(fixtures, { recursive: true })
  writeFileSync(join(src, 'widgetRegistry.ts'), 'export function registerWidget(name: string): void { /* entry point */ }\n')
  writeFileSync(
    join(src, 'widgetValidator.ts'),
    "import { registerWidget } from './widgetRegistry'\nexport const MAX_WIDGET_NAME_LENGTH_constant = 64\nexport function validateWidgetName(name: string): boolean { return name.length > 0 }\nexport const widget = registerWidget\n"
  )
  writeFileSync(join(src, 'widgetError.ts'), 'export class WidgetError extends Error {}\n')
  writeFileSync(join(src, 'widgetSchema.ts'), "export const widgetSchema = { type: 'object' }\n")
  writeFileSync(join(src, 'widgetConstants.ts'), 'export const MAX_WIDGET_NAME_LENGTH = 64\n')
  writeFileSync(
    join(src, 'widgetRegistry.spec.ts'),
    "import { registerWidget } from './widgetRegistry'\nimport { widgetFixture } from './__fixtures__/widgetFixture'\nexport const check = registerWidget\nexport const fx = widgetFixture\n"
  )
  writeFileSync(join(fixtures, 'widgetFixture.ts'), "export const widgetFixture = { name: 'sample' }\n")

  const indexOut = join(root, '.my-dev-kit')
  const result = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
  expect(result.status).toBe(0)

  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture-pkg', version: '0.0.0', scripts: { test: 'vitest run' } }, null, 2))
  return { indexOut }
}

function writeIsolatedFixture(root: string): { indexOut: string } {
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'lonelyThing.ts'), 'export function lonelyThing(): void {}\n')
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

describe('duplicate responsibility diagnostics (Batch 3)', () => {
  it('TST-B1303-001 (CASE-006): a duplicated stable ID supplied through --request produces one mapping and a reported duplicate', () => {
    const root = createTempRoot('my-dev-kit-v1-dup-case006-')
    const { indexOut } = writeFullFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'implementation',
      changedFiles: ['src/widgetRegistry.ts'],
      changedSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
      testResponsibilityRefs: ['resp-register-widget', 'resp-register-widget'],
      requestedEvidenceKinds: ['responsibility-mappings', 'test-infrastructure', 'test-commands'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    expect(capsule.responsibilityMappings.mappings.length).toBe(1)
    expect(capsule.responsibilityMappings.mappings[0].responsibilityId).toBe('resp-register-widget')
    expect(capsule.responsibilityMappings.duplicateResponsibilityIds).toEqual(['resp-register-widget'])
  })

  it('TST-B1303-002: an ID repeated three times is reported once, not once per extra occurrence', () => {
    const root = createTempRoot('my-dev-kit-v1-dup-triple-')
    const { indexOut } = writeIsolatedFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'lonelyThing',
      role: 'implementation',
      testResponsibilityRefs: ['resp-triple', 'resp-triple', 'resp-triple'],
      requestedEvidenceKinds: ['responsibility-mappings'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    expect(capsule.responsibilityMappings.mappings.length).toBe(1)
    expect(capsule.responsibilityMappings.duplicateResponsibilityIds).toEqual(['resp-triple'])
  })

  it('TST-B1303-003: multiple duplicated IDs preserve first-occurrence mapping order and first-duplicate-occurrence diagnostic order', () => {
    const root = createTempRoot('my-dev-kit-v1-dup-multi-')
    const { indexOut } = writeIsolatedFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'lonelyThing',
      role: 'implementation',
      testResponsibilityRefs: ['TST-002', 'TST-001', 'TST-002', 'TST-003', 'TST-001'],
      requestedEvidenceKinds: ['responsibility-mappings'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    expect(capsule.responsibilityMappings.mappings.map((m: { responsibilityId: string }) => m.responsibilityId)).toEqual(['TST-002', 'TST-001', 'TST-003'])
    expect(capsule.responsibilityMappings.duplicateResponsibilityIds).toEqual(['TST-002', 'TST-001'])
  })

  it('TST-B1303-004: a duplicated, fully-mapped responsibility is derived once and counted once in the denominator', () => {
    const root = createTempRoot('my-dev-kit-v1-dup-mapped-')
    const { indexOut } = writeFullFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'implementation',
      changedFiles: ['src/widgetRegistry.ts'],
      changedSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
      testResponsibilityRefs: ['resp-register-widget', 'resp-register-widget'],
      requestedEvidenceKinds: ['responsibility-mappings', 'test-infrastructure', 'test-commands'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    expect(capsule.responsibilityMappings.mappings[0].mappingStatus).toBe('mapped')
    expect(capsule.responsibilityMappings.availableCount).toBe(1)
    expect(capsule.responsibilityMappings.usedCount).toBe(1)
    expect(capsule.responsibilityMappings.duplicateResponsibilityIds).toEqual(['resp-register-widget'])
  })

  it('TST-B1303-005: a duplicated, unmapped responsibility reports one unmapped mapping with its unresolved reasons preserved, plus the duplicate', () => {
    const root = createTempRoot('my-dev-kit-v1-dup-unmapped-')
    const { indexOut } = writeIsolatedFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'zzz-completely-unrelated-query-term',
      role: 'implementation',
      testResponsibilityRefs: ['resp-totally-unrelated-id', 'resp-totally-unrelated-id'],
      requestedEvidenceKinds: ['responsibility-mappings'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    expect(capsule.responsibilityMappings.mappings.length).toBe(1)
    expect(capsule.responsibilityMappings.mappings[0].mappingStatus).toBe('unmapped')
    expect(capsule.responsibilityMappings.mappings[0].unresolvedReasons.length).toBeGreaterThan(0)
    expect(capsule.responsibilityMappings.duplicateResponsibilityIds).toEqual(['resp-totally-unrelated-id'])
  })

  it('TST-B1303-006: a duplicated, unknown (unmapped) responsibility keeps the unknown diagnostic and the duplicate diagnostic both visible, with no invented mapping', () => {
    const root = createTempRoot('my-dev-kit-v1-dup-unknown-')
    const { indexOut } = writeIsolatedFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'zzz-completely-unrelated-query-term',
      role: 'implementation',
      testResponsibilityRefs: ['resp-unknown-and-duplicated', 'resp-unknown-and-duplicated'],
      requestedEvidenceKinds: ['responsibility-mappings'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    expect(capsule.responsibilityMappings.unknownResponsibilityIds).toEqual(['resp-unknown-and-duplicated'])
    expect(capsule.responsibilityMappings.duplicateResponsibilityIds).toEqual(['resp-unknown-and-duplicated'])
    expect(capsule.responsibilityMappings.mappings.length).toBe(1)
  })

  it('TST-B1303-007: a duplicated, partially-mapped responsibility remains incomplete for later criticality overlay, with the duplicate reported', () => {
    const root = createTempRoot('my-dev-kit-v1-dup-partial-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'lonelyThing.ts'), 'export function lonelyThing(): void {}\n')
    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'lonelyThing',
      role: 'implementation',
      changedFiles: ['src/lonelyThing.ts'],
      changedSymbols: ['symbol:src/lonelyThing.ts#lonelyThing'],
      testResponsibilityRefs: ['resp-partial-dup', 'resp-partial-dup'],
      requestedEvidenceKinds: ['responsibility-mappings'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    expect(capsule.responsibilityMappings.mappings.length).toBe(1)
    expect(capsule.responsibilityMappings.mappings[0].mappingStatus).toBe('partially-mapped')
    expect(capsule.responsibilityMappings.duplicateResponsibilityIds).toEqual(['resp-partial-dup'])
  })

  it('TST-B1303-008: unique-ID requests produce no duplicate diagnostic and keep existing order and behavior', () => {
    const root = createTempRoot('my-dev-kit-v1-dup-unique-')
    const { indexOut } = writeIsolatedFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'lonelyThing',
      role: 'implementation',
      testResponsibilityRefs: ['resp-alpha', 'resp-beta', 'resp-gamma'],
      requestedEvidenceKinds: ['responsibility-mappings'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    expect(capsule.responsibilityMappings.mappings.map((m: { responsibilityId: string }) => m.responsibilityId)).toEqual(['resp-alpha', 'resp-beta', 'resp-gamma'])
    expect(capsule.responsibilityMappings.duplicateResponsibilityIds).toEqual([])
  })

  it('TST-B1303-009: an empty or missing testResponsibilityRefs is accepted with no mappings and no duplicates', () => {
    const root = createTempRoot('my-dev-kit-v1-dup-empty-')
    const { indexOut } = writeIsolatedFixture(root)

    const emptyPath = writeRequest(root, 'empty.json', {
      schemaVersion: '1.0.0',
      query: 'lonelyThing',
      role: 'implementation',
      testResponsibilityRefs: [],
      requestedEvidenceKinds: ['responsibility-mappings'],
    })
    const emptyOut = join(root, 'empty-capsule.json')
    expect(runContext(indexOut, emptyPath, emptyOut).status).toBe(0)
    const emptyCapsule = JSON.parse(readFileSync(emptyOut, 'utf8'))
    expect(emptyCapsule.responsibilityMappings.mappings).toEqual([])
    expect(emptyCapsule.responsibilityMappings.duplicateResponsibilityIds).toEqual([])
    expect(emptyCapsule.responsibilityMappings.operational).toBe(false)

    const missingPath = writeRequest(root, 'missing.json', {
      schemaVersion: '1.0.0',
      query: 'lonelyThing',
      role: 'implementation',
      requestedEvidenceKinds: ['responsibility-mappings'],
    })
    const missingOut = join(root, 'missing-capsule.json')
    expect(runContext(indexOut, missingPath, missingOut).status).toBe(0)
    const missingCapsule = JSON.parse(readFileSync(missingOut, 'utf8'))
    expect(missingCapsule.responsibilityMappings.mappings).toEqual([])
    expect(missingCapsule.responsibilityMappings.duplicateResponsibilityIds).toEqual([])
  })

  it('TST-B1303-010: malformed testResponsibilityRefs entries are still rejected by structural validation', () => {
    const root = createTempRoot('my-dev-kit-v1-dup-malformed-')
    const { indexOut } = writeIsolatedFixture(root)

    for (const malformed of [null, { not: 'a string' }, 42, ['ok-id', 42]]) {
      const requestPath = writeRequest(root, 'malformed.json', {
        schemaVersion: '1.0.0',
        query: 'lonelyThing',
        role: 'implementation',
        testResponsibilityRefs: Array.isArray(malformed) ? malformed : [malformed],
        requestedEvidenceKinds: ['responsibility-mappings'],
      })
      const outPath = join(root, 'malformed-capsule.json')
      const result = runContext(indexOut, requestPath, outPath)
      expect(result.status).not.toBe(0)
    }
  })

  it('TST-B1303-011: capsule and retrieval-audit responsibility-mapping summaries are identical for a duplicate request', () => {
    const root = createTempRoot('my-dev-kit-v1-dup-parity-')
    const { indexOut } = writeIsolatedFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'zzz-completely-unrelated-query-term',
      role: 'implementation',
      testResponsibilityRefs: ['TST-002', 'TST-001', 'TST-002', 'TST-003', 'TST-001'],
      requestedEvidenceKinds: ['responsibility-mappings'],
    })
    const capsuleOut = join(root, 'capsule.json')
    const auditOut = join(root, 'audit.json')
    const result = runContext(indexOut, requestPath, capsuleOut, ['--audit-out', auditOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    const audit = JSON.parse(readFileSync(auditOut, 'utf8'))
    expect(audit.responsibilityMappings).toEqual(capsule.responsibilityMappings)
  })

  it('TST-B1303-012: repeated identical requests produce byte-stable mappings and duplicate diagnostics', () => {
    const root = createTempRoot('my-dev-kit-v1-dup-determinism-')
    const { indexOut } = writeIsolatedFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'zzz-completely-unrelated-query-term',
      role: 'implementation',
      testResponsibilityRefs: ['TST-002', 'TST-001', 'TST-002', 'TST-003', 'TST-001'],
      requestedEvidenceKinds: ['responsibility-mappings'],
    })
    const outPath = join(root, 'capsule.json')
    const first = runContext(indexOut, requestPath, outPath)
    expect(first.status).toBe(0)
    const firstCapsule = JSON.parse(readFileSync(outPath, 'utf8'))
    const second = runContext(indexOut, requestPath, outPath)
    expect(second.status).toBe(0)
    const secondCapsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(secondCapsule.responsibilityMappings).toEqual(firstCapsule.responsibilityMappings)
  })

  it('TST-B1303-013: a request file in a directory containing spaces produces identical duplicate diagnostics', () => {
    const root = createTempRoot('my-dev-kit-v1-dup-crossplat-')
    const spacedDir = join(root, 'req dir with spaces')
    mkdirSync(spacedDir, { recursive: true })
    const { indexOut } = writeIsolatedFixture(root)
    const requestPath = writeRequest(spacedDir, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'zzz-completely-unrelated-query-term',
      role: 'implementation',
      testResponsibilityRefs: ['TST-002', 'TST-001', 'TST-002', 'TST-003', 'TST-001'],
      requestedEvidenceKinds: ['responsibility-mappings'],
    })
    const outPath = join(spacedDir, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.responsibilityMappings.mappings.map((m: { responsibilityId: string }) => m.responsibilityId)).toEqual(['TST-002', 'TST-001', 'TST-003'])
    expect(capsule.responsibilityMappings.duplicateResponsibilityIds).toEqual(['TST-002', 'TST-001'])
  })
})
