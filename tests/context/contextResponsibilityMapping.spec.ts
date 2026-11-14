import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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

  it('TST-B4-002/019: a partial fixture (no derivable oracle evidence, test-commands not requested) reports partially-mapped with clear unresolved reasons, and a missing command is supplemental, not an unresolved core reason', () => {
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
    // v1.12.3 Batch 3: test-commands was not explicitly requested, so a missing
    // command is supplemental and must not appear as a core unresolved reason.
    expect(mapping.unresolvedReasons).not.toContain('no test command')
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
    requireTestCommandEvidence: false,
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

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const full = join(root, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, text)
  }
}


// ---------------------------------------------------------------------------------------------
// KIT-PYTEST-01: Python related-test evidence reaches the existing responsibility-mapping pipeline.
// Scenarios PY-13 .. PY-19 and the consumer-shaped acceptance PY-23. Responsibility criticality is
// never supplied here (string refs are noncritical by contract) and is asserted unchanged.
// ---------------------------------------------------------------------------------------------

const PY_REFS = ['RSP-001', 'RSP-002', 'RSP-003']
const PY_ALL_KINDS = ['changed-surface', 'validators', 'constants', 'errors', 'schemas', 'closest-tests', 'test-infrastructure', 'test-commands', 'responsibility-mappings']

/** Synthetic, consumer-shaped Python project (no private data): dashboard views + query layer + four pytest modules. */
function writePythonConsumerFixture(root: string, options: { withTests?: boolean; withPackageJson?: boolean } = {}): string {
  const { withTests = true, withPackageJson = true } = options
  const files: Record<string, string> = {
    'src/data/weather_query.py': 'def weather_history(location, start, end):\n    return []\n\n\ndef latest_weather(location):\n    return None\n',
    'src/data/weather_validator.py': 'def validate_window(start, end):\n    return end > start\n',
    'src/data/weather_errors.py': 'class WeatherQueryError(Exception):\n    pass\n',
    'src/data/weather_constants.py': 'MAX_RANGE_DAYS = 366\n',
    'src/data/weather_schema.py': "WEATHER_RECORD_SCHEMA = {'type': 'object'}\n",
    'src/ui/weather_dashboard_views.py': 'from src.data.weather_query import weather_history\n\n\ndef history_rows(loc):\n    return weather_history(loc, 0, 1)\n',
    'src/ui/weather_dashboard.py': 'from src.ui import weather_dashboard_views\n\n\ndef render_dashboard():\n    return weather_dashboard_views.history_rows("X")\n',
  }
  if (withTests) {
    files['tests/test_weather_dashboard.py'] =
      'from streamlit.testing.v1 import AppTest\nfrom src.ui.weather_dashboard_views import history_rows\n\n\ndef test_views():\n    assert history_rows("X") == []\n\n\ndef test_app():\n    at = AppTest.from_file("src/ui/weather_dashboard.py")\n    assert at is not None\n'
    files['tests/test_weather_dashboard_integration.py'] =
      'import src.data.weather_query\nfrom src.data import weather_query as wq\nfrom src.data.weather_query import weather_history as wh\n\n\ndef test_integration():\n    assert wh("X", 0, 1) == [] and wq.latest_weather("X") is None\n'
    files['tests/test_weather_dashboard_process_boundary.py'] =
      'import subprocess\n\n\ndef test_boundary():\n    # from src.data.weather_query import weather_history  (comment only)\n    text = "import src.data.weather_query"\n    assert text and subprocess\n'
    files['tests/test_weather_collector_exit_status.py'] = 'def test_unrelated():\n    assert 1 == 1\n'
  }
  if (withPackageJson) files['package.json'] = JSON.stringify({ name: 'fx', version: '0.0.0', private: true, scripts: { test: 'python -m pytest tests/ -q -p no:cacheprovider' } })
  writeFiles(root, files)
  return join(root, '.my-dev-kit')
}

function pyConsumerContext(root: string, fixtureOptions: { withTests?: boolean; withPackageJson?: boolean } = {}, request: Record<string, unknown> = {}) {
  const indexOut = writePythonConsumerFixture(root, fixtureOptions)
  const roots = ['src', ...(fixtureOptions.withTests === false ? [] : ['tests'])]
  expect(runCli(['index', '--root', root, ...roots.flatMap((r) => ['--src', r]), '--out', indexOut]).status).toBe(0)
  const requestPath = writeRequest(root, 'req.json', {
    schemaVersion: '1.0.0',
    query: 'dashboard weather history views tests',
    role: 'test-implementation',
    mode: 'subsystem',
    changedFiles: ['src/ui/weather_dashboard_views.py', 'src/data/weather_query.py'],
    changedSymbols: ['symbol:src/data/weather_query.py#weather_history', 'symbol:src/ui/weather_dashboard_views.py#history_rows'],
    focusFiles: ['src/ui/weather_dashboard.py'],
    testResponsibilityRefs: PY_REFS,
    requestedEvidenceKinds: PY_ALL_KINDS,
    limits: { responsibilityMappings: 40 },
    ...request,
  })
  const outPath = join(root, 'capsule.json')
  const auditPath = join(root, 'audit.json')
  const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath, '--audit-out', auditPath])
  expect(result.status).toBe(0)
  return { capsule: JSON.parse(readFileSync(outPath, 'utf8')), audit: JSON.parse(readFileSync(auditPath, 'utf8')) }
}

type PyMapping = {
  responsibilityId: string
  criticality: string
  mappingStatus: string
  unresolvedReasons: string[]
  proposedOrExistingTestFiles: Array<{ id: string; path: string; relationship: string; provenance: string; basis: string }>
  oracleEvidence: Array<{ id: string; path?: string; relationship: string; provenance: string; basis: string; metadata?: { oracleKind?: string } }>
  testCommands: Array<{ commandText?: string }>
  productionSymbols: Array<{ symbolId?: string }>
}

describe('Python responsibility mapping (KIT-PYTEST-01)', () => {
  const REAL_RELATED = ['tests/test_weather_dashboard.py', 'tests/test_weather_dashboard_integration.py']

  it('PY-23: the consumer-shaped Python project gains real related-test evidence, a pytest command, oracle evidence and no related-test gap', () => {
    const root = createTempRoot('my-dev-kit-py23-')
    const { capsule } = pyConsumerContext(root)
    const related = capsule.testInfrastructure.relatedTests as Array<{ path: string; relationship: string }>
    expect(related.map((t) => t.path).sort()).toEqual(REAL_RELATED)
    expect(related.find((t) => t.path === 'tests/test_weather_dashboard_integration.py')?.relationship).toBe('references-selected-production-symbol')
    expect(related.find((t) => t.path === 'tests/test_weather_dashboard.py')?.relationship).toBe('references-selected-production-symbol')
    expect(capsule.testInfrastructure.testCommands.map((c: { commandText: string }) => c.commandText)).toContain('python -m pytest tests/ -q -p no:cacheprovider')
    expect(capsule.testInfrastructure.unresolved.some((u: { evidenceKind: string }) => u.evidenceKind === 'related-tests')).toBe(false)
    expect(capsule.roleContext.unsupportedRequestedEvidenceKinds).toEqual([])
    for (const m of capsule.responsibilityMappings.mappings as PyMapping[]) {
      expect(m.unresolvedReasons).not.toContain('no related test')
      expect(m.unresolvedReasons).not.toContain('no oracle evidence')
      expect(m.mappingStatus).toBe('mapped')
      expect(m.productionSymbols.map((s) => s.symbolId)).toContain('symbol:src/data/weather_query.py#weather_history')
    }
  })

  it('PY-13/PY-14: related Python tests are the existing tests of every mapping and the existing-test oracle carries the genuine test identity and provenance', () => {
    const root = createTempRoot('my-dev-kit-py13-')
    const { capsule } = pyConsumerContext(root)
    for (const m of capsule.responsibilityMappings.mappings as PyMapping[]) {
      expect(m.proposedOrExistingTestFiles.map((t) => t.path).sort()).toEqual(REAL_RELATED)
      for (const t of m.proposedOrExistingTestFiles) {
        expect(t.relationship).toBe('existing: references-selected-production-symbol')
        expect(t.provenance).toBe('python-indexed-import:named-import')
      }
      const existing = m.oracleEvidence.filter((o) => o.metadata?.oracleKind === 'existing-test-assertions')
      expect(existing.map((o) => o.path).sort()).toEqual(REAL_RELATED)
      expect(existing.map((o) => o.id).sort()).toEqual(REAL_RELATED.map((p) => `oracle:${p}`))
      for (const o of existing) {
        expect(o.relationship).toBe('oracle:existing-test-assertions (static reference only; no assertion generated)')
        expect(o.provenance).toBe('python-indexed-import:named-import')
      }
      // No oracle item points at a file that is not a discovered related test.
      for (const o of m.oracleEvidence.filter((x) => x.path?.startsWith('tests/'))) expect(REAL_RELATED).toContain(o.path)
    }
  })

  it('PY-15: with no related Python test the mapping gap stays explicit and the mapping is not mapped', () => {
    const root = createTempRoot('my-dev-kit-py15-')
    const { capsule } = pyConsumerContext(root, { withTests: false })
    expect(capsule.testInfrastructure.relatedTests).toEqual([])
    for (const m of capsule.responsibilityMappings.mappings as PyMapping[]) {
      expect(m.mappingStatus).not.toBe('mapped')
      expect(m.unresolvedReasons).toContain('no related test')
      expect(m.proposedOrExistingTestFiles).toEqual([])
      // Error/schema oracle evidence may legitimately exist; an EXISTING-TEST oracle must not.
      expect(m.oracleEvidence.some((o) => o.metadata?.oracleKind === 'existing-test-assertions')).toBe(false)
    }
  })

  it('PY-16: a discovered pytest command alone never manufactures a mapped responsibility (execution metadata is not oracle evidence)', () => {
    const root = createTempRoot('my-dev-kit-py16-')
    // Tests exist in the project but none relates to the changed surface; the package.json command IS discovered.
    const indexOut = writePythonConsumerFixture(root)
    writeFiles(root, { 'tests/test_weather_dashboard.py': 'def test_nothing():\n    assert True\n', 'tests/test_weather_dashboard_integration.py': 'def test_nothing_else():\n    assert True\n' })
    expect(runCli(['index', '--root', root, '--src', 'src', '--src', 'tests', '--out', indexOut]).status).toBe(0)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0', query: 'dashboard', role: 'test-implementation', changedFiles: ['src/data/weather_query.py'],
      changedSymbols: ['symbol:src/data/weather_query.py#weather_history'], testResponsibilityRefs: PY_REFS, requestedEvidenceKinds: PY_ALL_KINDS,
    })
    const outPath = join(root, 'capsule.json')
    expect(runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath]).status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.testInfrastructure.testCommands.length).toBeGreaterThan(0)
    for (const m of capsule.responsibilityMappings.mappings as PyMapping[]) {
      expect(m.testCommands.length).toBeGreaterThan(0)
      expect(m.mappingStatus).not.toBe('mapped')
      expect(m.unresolvedReasons).toContain('no related test')
      expect(m.unresolvedReasons).toContain('no oracle evidence')
    }
  })

  it('PY-17/PY-18: criticality is unchanged and no responsibility-specific test association is fabricated (mappings stay request-scoped)', () => {
    const root = createTempRoot('my-dev-kit-py17-')
    const { capsule } = pyConsumerContext(root, {}, { testResponsibilityRefs: ['RSP-ALPHA', 'RSP-BETA', 'RSP-GAMMA'] })
    const mappings = capsule.responsibilityMappings.mappings as PyMapping[]
    expect(mappings.map((m) => m.responsibilityId)).toEqual(['RSP-ALPHA', 'RSP-BETA', 'RSP-GAMMA'])
    expect(mappings.map((m) => m.criticality)).toEqual(['noncritical', 'noncritical', 'noncritical'])
    const first = JSON.stringify(mappings[0].proposedOrExistingTestFiles) + JSON.stringify(mappings[0].oracleEvidence)
    for (const m of mappings) {
      expect(JSON.stringify(m.proposedOrExistingTestFiles) + JSON.stringify(m.oracleEvidence)).toBe(first)
      expect(JSON.stringify([m.proposedOrExistingTestFiles, m.oracleEvidence])).not.toMatch(/RSP-(ALPHA|BETA|GAMMA)/)
    }
  })

  it('PY-19: capsule and audit agree on the related-test identity, provenance, mapping status and role-condition coverage', () => {
    const root = createTempRoot('my-dev-kit-py19-')
    const { capsule, audit } = pyConsumerContext(root)
    const view = (doc: { responsibilityMappings: { mappings: PyMapping[] } }) =>
      doc.responsibilityMappings.mappings.map((m) => ({
        id: m.responsibilityId,
        status: m.mappingStatus,
        tests: m.proposedOrExistingTestFiles.map((t) => [t.id, t.path, t.relationship, t.provenance, t.basis]),
        oracle: m.oracleEvidence.map((o) => [o.id, o.path ?? null, o.relationship, o.provenance]),
      }))
    expect(view(audit)).toEqual(view(capsule))
    expect(audit.roleConditionCoverage).toEqual(capsule.roleConditionCoverage)
    expect(audit.roleAdequacy.status).toBe(capsule.roleAdequacy.status)
    expect(audit.roleAdequacy.missingConditions).toEqual(capsule.roleAdequacy.missingConditions)
    expect(capsule.truncation).toBeDefined()
    expect(capsule.responsibilityMappings.truncated).toBe(false)
    expect(capsule.responsibilityMappings.criticalDropped).toBe(false)
  })
})
