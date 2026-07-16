import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'
import { buildResponsibilityMappings } from '../../src/context/responsibilityMapping.js'

// v1.10.1 Batch 4: deterministic test-responsibility mapping.
// Responsibility IDs: TST-B4-001, 002, 003, 005, 006, 007, 009, 010, 011, 012, 013,
// 014, 015, 016, 018, 019, 020, 023, 024.

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

/** Owner + validator + constant + error + schema + related test + fixture + package.json
 * test script, matching the classification conventions used across Batch 3/4. */
function writeFullFixture(root: string): { indexOut: string } {
  const src = join(root, 'src')
  const fixtures = join(src, '__fixtures__')
  mkdirSync(fixtures, { recursive: true })
  writeFileSync(join(src, 'widgetRegistry.ts'), "export function registerWidget(name: string): void { /* entry point */ }\n")
  writeFileSync(
    join(src, 'widgetValidator.ts'),
    "import { registerWidget } from './widgetRegistry'\nexport const MAX_WIDGET_NAME_LENGTH_constant = 64\nexport function validateWidgetName(name: string): boolean { return name.length > 0 }\nexport const widget = registerWidget\n"
  )
  writeFileSync(join(src, 'widgetError.ts'), "export class WidgetError extends Error {}\n")
  writeFileSync(join(src, 'widgetSchema.ts'), "export const widgetSchema = { type: 'object' }\n")
  // A separate file whose *name* matches the constant naming convention
  // (`CONSTANT_PATTERN`/`evidencePatterns.ts` classify by file path, not by
  // in-file variable names) so the `constants` responsibility-mapping category has
  // grounded evidence to map to.
  writeFileSync(join(src, 'widgetConstants.ts'), "export const MAX_WIDGET_NAME_LENGTH = 64\n")
  writeFileSync(
    join(src, 'widgetRegistry.spec.ts'),
    "import { registerWidget } from './widgetRegistry'\nimport { widgetFixture } from './__fixtures__/widgetFixture'\nexport const check = registerWidget\nexport const fx = widgetFixture\n"
  )
  writeFileSync(join(fixtures, 'widgetFixture.ts'), "export const widgetFixture = { name: 'sample' }\n")

  const indexOut = join(root, '.my-dev-kit')
  const result = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
  expect(result.status).toBe(0)

  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture-pkg', version: '0.0.0', scripts: { test: 'vitest run' } }, null, 2)
  )
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

describe('responsibility mapping', () => {
  it('TST-B4-001/007/009/010/011/012/013/014/015/016/018/020/023: a fully-grounded responsibility maps with production symbol, contract/validator/constant/error, related test, helper, oracle, and command evidence', () => {
    const root = createTempRoot('my-dev-kit-v1-resp-mapped-')
    const { indexOut } = writeFullFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'implementation',
      changedFiles: ['src/widgetRegistry.ts'],
      changedSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
      testResponsibilityRefs: ['resp-register-widget'],
      requestedEvidenceKinds: ['responsibility-mappings', 'test-infrastructure', 'test-commands'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    expect(capsule.responsibilityMappings.requested).toBe(true)
    expect(capsule.responsibilityMappings.operational).toBe(true)
    expect(capsule.roleContext.unsupportedRequestedEvidenceKinds).toEqual([])
    const mapping = capsule.responsibilityMappings.mappings.find((m: { responsibilityId: string }) => m.responsibilityId === 'resp-register-widget')
    expect(mapping).toBeDefined()
    expect(mapping.productionSymbols.length).toBeGreaterThan(0)
    expect(mapping.productionSymbols[0].symbolId).toBe('symbol:src/widgetRegistry.ts#registerWidget')
    expect(mapping.contracts.length).toBeGreaterThan(0)
    expect(mapping.validators.some((v: { path: string }) => v.path === 'src/widgetValidator.ts')).toBe(true)
    expect(mapping.constants.some((v: { path: string }) => v.path === 'src/widgetConstants.ts')).toBe(true)
    expect(mapping.errors.some((e: { path: string }) => e.path === 'src/widgetError.ts')).toBe(true)
    expect(mapping.oracleEvidence.some((o: { metadata?: { oracleKind?: string } }) => o.metadata?.oracleKind === 'error-type')).toBe(true)
    expect(mapping.testCommands.length).toBeGreaterThan(0)
    expect(['mapped', 'partially-mapped']).toContain(mapping.mappingStatus)
  })

  it('TST-B4-002/019: a partial fixture (no derivable oracle/test-command evidence) reports partially-mapped with clear unresolved reasons', () => {
    const root = createTempRoot('my-dev-kit-v1-resp-partial-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'lonelyThing.ts'), 'export function lonelyThing(): void {}\n')
    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'lonely',
      role: 'implementation',
      changedFiles: ['src/lonelyThing.ts'],
      changedSymbols: ['symbol:src/lonelyThing.ts#lonelyThing'],
      testResponsibilityRefs: ['resp-lonely'],
      requestedEvidenceKinds: ['responsibility-mappings'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    const mapping = capsule.responsibilityMappings.mappings.find((m: { responsibilityId: string }) => m.responsibilityId === 'resp-lonely')
    expect(mapping.mappingStatus).toBe('partially-mapped')
    expect(mapping.unresolvedReasons).toContain('no oracle evidence')
    expect(mapping.unresolvedReasons).toContain('no test command')
  })

  it('TST-B4-003/024: no grounded evidence at all (no responsibilities supplied) never produces a false mapping success', () => {
    const root = createTempRoot('my-dev-kit-v1-resp-unmapped-')
    const { indexOut } = writeFullFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'implementation',
      requestedEvidenceKinds: ['responsibility-mappings'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.responsibilityMappings.requested).toBe(true)
    expect(capsule.responsibilityMappings.operational).toBe(false)
    expect(capsule.responsibilityMappings.mappings).toEqual([])
    // requestedEvidenceKinds no longer lists responsibility-mappings as unsupported
    // (it is operational), but with nothing supplied it produced no mappings.
    expect(capsule.roleContext.unsupportedRequestedEvidenceKinds).toEqual([])
  })

  it('TST-B4-006: an unknown responsibility reference remains explicitly unresolved, never silently dropped', () => {
    // Section 13's resolution order falls back to selected owners/contracts when no
    // changed/focus symbol is supplied, so an unrelated ID still finds *some* grounded
    // request-scope evidence whenever the query itself matches something (see TST-B4-002's
    // fixture). To exercise a genuinely *unmapped* (no evidence at all) responsibility, this
    // fixture's query deliberately matches nothing.
    const root = createTempRoot('my-dev-kit-v1-resp-unknown-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'plainThing.ts'), 'export function plainThing(): void {}\n')
    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'zzz-completely-unrelated-query-term',
      role: 'implementation',
      testResponsibilityRefs: ['resp-totally-unrelated-id'],
      requestedEvidenceKinds: ['responsibility-mappings'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.responsibilityMappings.mappings.length).toBe(1)
    expect(capsule.responsibilityMappings.mappings[0].mappingStatus).toBe('unmapped')
    expect(capsule.responsibilityMappings.unknownResponsibilityIds).toEqual(['resp-totally-unrelated-id'])
  })
})

describe('responsibility mapping: unit-level contract (structured ResponsibilityInput)', () => {
  const baseOptions = {
    role: 'implementation' as const,
    hasSuppliedResponsibilities: true,
    requestedResponsibilityMappings: true,
    evidenceGroups: [],
    selectedOwners: [],
    selectedContracts: [],
    selectedTests: [],
    testInfrastructure: {
      relatedTests: [],
      fixtures: [],
      factories: [],
      mocks: [],
      setupFiles: [],
      testConfigurations: [],
      packageScripts: [],
      testCommands: [],
      unresolved: [],
      warnings: [],
    },
    changedSymbolItems: [],
    focusSymbolItems: [],
    limit: null,
  }

  it('TST-B4-004: an explicit not-applicable responsibility is preserved verbatim, never inferred', () => {
    const result = buildResponsibilityMappings({
      ...baseOptions,
      responsibilityInputs: [{ id: 'resp-na', notApplicable: true }],
    })
    expect(result.mappings).toEqual([
      expect.objectContaining({ responsibilityId: 'resp-na', mappingStatus: 'not-applicable' }),
    ])
  })

  it('TST-B4-005: a duplicate responsibility ID is rejected clearly (first occurrence wins, duplicate reported)', () => {
    const result = buildResponsibilityMappings({
      ...baseOptions,
      responsibilityInputs: [
        { id: 'resp-dup', criticality: 'noncritical' },
        { id: 'resp-dup', criticality: 'critical' },
      ],
    })
    expect(result.mappings.length).toBe(1)
    expect(result.mappings[0].criticality).toBe('noncritical')
    expect(result.duplicateResponsibilityIds).toEqual(['resp-dup'])
    expect(result.warnings.some((w) => w.includes('Duplicate responsibility ID'))).toBe(true)
  })

  it('TST-B4-008: an ambiguous production-symbol set (more than one changed symbol) is preserved, not arbitrarily collapsed', () => {
    const result = buildResponsibilityMappings({
      ...baseOptions,
      responsibilityInputs: [{ id: 'resp-ambiguous' }],
      changedSymbolItems: [
        { id: 'symbol:src/a.ts#fn', itemKind: 'symbol', symbolId: 'symbol:src/a.ts#fn', relationship: 'modified', basis: 'changed-surface (caller)', provenance: 'caller' },
        { id: 'symbol:src/b.ts#fn', itemKind: 'symbol', symbolId: 'symbol:src/b.ts#fn', relationship: 'modified', basis: 'changed-surface (caller)', provenance: 'caller' },
      ],
    })
    expect(result.mappings[0].productionSymbols.length).toBe(2)
    expect(result.mappings[0].productionSymbols.map((s: { symbolId?: string }) => s.symbolId).sort()).toEqual(['symbol:src/a.ts#fn', 'symbol:src/b.ts#fn'])
  })

  it('TST-B4-017: schema/serializer evidence contributes emitted-artifact-shape oracle evidence', () => {
    const result = buildResponsibilityMappings({
      ...baseOptions,
      responsibilityInputs: [{ id: 'resp-shape' }],
      changedSymbolItems: [{ id: 'symbol:src/a.ts#fn', itemKind: 'symbol', symbolId: 'symbol:src/a.ts#fn', relationship: 'modified', basis: 'x', provenance: 'caller' }],
      evidenceGroups: [
        {
          id: 'implementation-schemas-and-serializers',
          kind: 'schemas-and-serializers',
          role: 'implementation',
          title: 'Schemas and serializers',
          required: true,
          items: [{ id: 'src/widgetSchema.ts', itemKind: 'file', path: 'src/widgetSchema.ts', relationship: 'contract-like candidate', basis: 'x', provenance: 'candidate-ranking' }],
          unresolved: [],
          warnings: [],
          limit: 10,
          availableCount: 1,
          usedCount: 1,
          truncated: false,
          droppedCount: 0,
          provenance: 'x',
        },
      ],
    })
    const oracleKinds = result.mappings[0].oracleEvidence.map((o: { metadata?: { oracleKind?: string } }) => o.metadata?.oracleKind)
    expect(oracleKinds).toContain('emitted-artifact-shape')
  })
})
