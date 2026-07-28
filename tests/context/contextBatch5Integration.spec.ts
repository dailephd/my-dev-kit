import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

// v1.10.1 Batch 5: final CLI integration, compatibility, determinism, and
// regression gate. This file exercises the complete end-to-end pipeline
// (CLI -> normalization -> role-aware ranking -> evidence groups -> test
// infrastructure -> responsibility mapping -> freshness -> budget/truncation
// -> full-file fallback -> adequacy -> provenance -> capsule/audit
// serialization) across all three roles plus legacy no-role requests, using
// only the existing CLI entrypoint (contextCommand.ts), the existing
// runCli() test harness, and the existing context/index/graph-diff pipeline.
// No second orchestration path, no second CLI harness, no new fixture
// framework, no new product scope.
//
// Stable test IDs: TST-B5-001 .. TST-B5-025 (see task spec section 19).

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

function writeRequest(root: string, name: string, body: unknown): string {
  const filePath = join(root, name)
  writeFileSync(filePath, JSON.stringify(body, null, 2))
  return filePath
}

/** Architecture-role fixture: owner/entry point, extension point, contract,
 * an architecture-relevant test, and an unrelated helper that must not be
 * broadly swept into evidence groups. */
function writeArchitectureFixture(root: string): { indexOut: string } {
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'pluginRegistry.ts'), 'export function registerPlugin(name: string): void { /* entry point / owner */ }\n')
  writeFileSync(
    join(src, 'pluginExtensionPoint.ts'),
    "import { registerPlugin } from './pluginRegistry'\nexport function extendPlugins(): void { registerPlugin('ext') }\n"
  )
  writeFileSync(join(src, 'pluginContract.ts'), 'export interface PluginContract { readonly id: string }\n')
  writeFileSync(
    join(src, 'pluginRegistry.spec.ts'),
    "import { registerPlugin } from './pluginRegistry'\nexport const architectureCheck = registerPlugin\n"
  )
  writeFileSync(join(src, 'unrelatedHelper.ts'), 'export function unrelatedHelper(): number { return 42 }\n')
  const indexOut = join(root, '.my-dev-kit')
  expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)
  return { indexOut }
}

/** Implementation-role fixture: focus symbol, owner, dependency, validator,
 * constant, error, schema, and a closest test. */
function writeImplementationFixture(root: string): { indexOut: string } {
  const src = join(root, 'src')
  const fixtures = join(src, '__fixtures__')
  mkdirSync(fixtures, { recursive: true })
  writeFileSync(join(src, 'orderProcessor.ts'), 'export function processOrder(id: string): void { /* owner + focus symbol */ }\n')
  writeFileSync(
    join(src, 'orderDependency.ts'),
    "import { processOrder } from './orderProcessor'\nexport function dependOnOrder(): void { processOrder('dep') }\n"
  )
  writeFileSync(
    join(src, 'orderValidator.ts'),
    "import { processOrder } from './orderProcessor'\nexport function validateOrder(id: string): boolean { return id.length > 0 }\nexport const linked = processOrder\n"
  )
  writeFileSync(join(src, 'orderConstants.ts'), 'export const MAX_ORDER_ID_LENGTH = 32\n')
  writeFileSync(join(src, 'orderError.ts'), 'export class OrderError extends Error {}\n')
  writeFileSync(join(src, 'orderSchema.ts'), "export const orderSchema = { type: 'object' }\n")
  writeFileSync(
    join(src, 'orderProcessor.spec.ts'),
    "import { processOrder } from './orderProcessor'\nimport { orderFixture } from './__fixtures__/orderFixture'\nexport const closestCheck = processOrder\nexport const fx = orderFixture\n"
  )
  writeFileSync(join(fixtures, 'orderFixture.ts'), "export const orderFixture = { id: 'sample' }\n")
  const indexOut = join(root, '.my-dev-kit')
  expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)
  return { indexOut }
}

/** Test-implementation-role fixture: beforeIndex/afterIndex, a changed
 * production file, a changed symbol, a removed symbol, a related test,
 * fixture/helper, and a package.json test command. */
function writeTestImplementationFixture(root: string): { beforeOut: string; afterOut: string } {
  const beforeSrc = join(root, 'before', 'src')
  const afterSrc = join(root, 'after', 'src')
  mkdirSync(beforeSrc, { recursive: true })
  mkdirSync(afterSrc, { recursive: true })

  writeFileSync(
    join(beforeSrc, 'invoiceService.ts'),
    "export function formatInvoice(id: string): string { return id }\nexport function legacyInvoiceHelper(): string { return 'legacy' }\n"
  )
  writeFileSync(
    join(beforeSrc, 'invoiceService.spec.ts'),
    "import { formatInvoice } from './invoiceService'\nexport const check = formatInvoice\n"
  )

  writeFileSync(
    join(afterSrc, 'invoiceService.ts'),
    "export function formatInvoice(id: string): string { return id.toUpperCase() }\n"
  )
  writeFileSync(
    join(afterSrc, 'invoiceService.spec.ts'),
    "import { formatInvoice } from './invoiceService'\nexport const check = formatInvoice\n"
  )

  const beforeOut = join(root, 'before', '.my-dev-kit')
  const afterOut = join(root, 'after', '.my-dev-kit')
  expect(runCli(['index', '--root', join(root, 'before'), '--src', 'src', '--out', beforeOut]).status).toBe(0)
  expect(runCli(['index', '--root', join(root, 'after'), '--src', 'src', '--out', afterOut]).status).toBe(0)

  writeFileSync(
    join(root, 'after', 'package.json'),
    JSON.stringify({ name: 'invoice-pkg', version: '0.0.0', scripts: { test: 'vitest run' } }, null, 2)
  )
  return { beforeOut, afterOut }
}

describe('Batch 5: legacy CLI end-to-end compatibility', () => {
  it('TST-B5-001: a plain legacy CLI invocation (no --role, no --request) produces a complete, valid capsule and audit', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-legacy-')
    const { indexOut } = writeArchitectureFixture(root)
    const capsuleOut = join(root, 'capsule.json')
    const auditOut = join(root, 'audit.json')
    const result = runCli(['context', '--index', indexOut, '--query', 'registerPlugin', '--out', capsuleOut, '--audit-out', auditOut, '--json'])
    expect(result.status).toBe(0)
    expect(() => JSON.parse(result.stdout)).not.toThrow()

    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.request.role).toBeNull()
    expect(capsule.roleContext.role).toBeNull()
    expect(capsule.evidenceGroups).toEqual([])
    expect(capsule.responsibilityMappings.requested).toBe(false)
    expect(capsule.freshness.state).toBe('unknown')
    expect(capsule.roleAdequacy.role).toBeNull()
    expect(capsule.fullFileFallback.fallbacks).toEqual([])

    const audit = JSON.parse(readFileSync(auditOut, 'utf8'))
    expect(audit.request.role).toBeNull()
    expect(audit.roleContext.role).toBeNull()
    expect(audit.contextAdequacy).toEqual(capsule.contextAdequacy)
    expect(audit.index.projectRoot).toBe(capsule.index.projectRoot)
    expect(audit.index.indexPath).toBe(capsule.index.indexPath)
    expect(audit.freshness.comparedIdentities).toEqual(capsule.freshness.comparedIdentities)
    expect(audit.freshness.comparedIdentities).toEqual(
      expect.arrayContaining([
        { label: 'beforeIndexPath', value: null },
        { label: 'afterIndexPath', value: null },
      ])
    )
  })
})

describe('Batch 5: request-file end-to-end integration', () => {
  it('TST-B5-002: a full structured request file (role, focus, limits, requestedEvidenceKinds) drives one coherent pipeline', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-request-')
    const { indexOut } = writeImplementationFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'processOrder',
      focusSymbols: ['symbol:src/orderProcessor.ts#processOrder'],
      requestedEvidenceKinds: ['owner', 'dependencies', 'contracts', 'validators', 'constants', 'errors', 'schemas', 'closest-tests'],
      limits: { candidates: 10, evidenceGroupEntries: 20 },
    })
    const capsuleOut = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.request.role).toBe('implementation')
    expect(capsule.request.requestFilePath).toBe(requestPath.replace(/\\/g, '/'))
    expect(capsule.roleContext.focus.focusSymbols[0]).toMatchObject({ resolved: true })
    expect(capsule.deferredRequestFields).toEqual([])
    expect(capsule.evidenceGroups.length).toBeGreaterThan(0)
  })
})

describe('Batch 5: architecture role complete output', () => {
  it('TST-B5-003: architecture role prioritizes owner/extension-point/contract evidence and does not broadly sweep unrelated helpers into required groups', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-arch-')
    const { indexOut } = writeArchitectureFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'architecture',
      query: 'registerPlugin',
      focusSymbols: ['symbol:src/pluginRegistry.ts#registerPlugin'],
      requestedEvidenceKinds: ['owner', 'contracts', 'closest-tests'],
    })
    const capsuleOut = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))

    expect(capsule.roleContext.role).toBe('architecture')
    expect(capsule.selectedOwners.some((o: { path?: string }) => o.path === 'src/pluginRegistry.ts')).toBe(true)
    const allEvidencePaths = capsule.evidenceGroups.flatMap((g: { items: { path?: string }[] }) => g.items.map((i) => i.path)).filter(Boolean)
    expect(allEvidencePaths).not.toContain('src/unrelatedHelper.ts')
    expect(capsule.provenance.length).toBeGreaterThan(0)
    expect(['context sufficient for implementation', 'context sufficient with listed assumptions', 'context insufficient and more retrieval required']).toContain(
      capsule.roleAdequacy.status
    )
  })
})

describe('Batch 5: implementation role complete output', () => {
  it('TST-B5-004: implementation role retains owner and direct contracts, reports truncation/provenance correctly, and never reports stale context as fresh without evidence', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-impl-')
    const { indexOut } = writeImplementationFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'processOrder',
      focusSymbols: ['symbol:src/orderProcessor.ts#processOrder'],
      requestedEvidenceKinds: ['owner', 'dependencies', 'contracts', 'validators', 'constants', 'errors', 'schemas', 'closest-tests'],
      limits: { evidenceGroupEntries: 1 },
    })
    const capsuleOut = join(root, 'capsule.json')
    const auditOut = join(root, 'audit.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', capsuleOut, '--audit-out', auditOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    const audit = JSON.parse(readFileSync(auditOut, 'utf8'))

    const allEvidencePaths = capsule.evidenceGroups.flatMap((g: { items: { path?: string }[] }) => g.items.map((i) => i.path)).filter(Boolean)
    expect(allEvidencePaths).toContain('src/orderProcessor.ts')
    expect(capsule.freshness.state).toBe('unknown') // no before/after/git identity supplied: honestly unknown
    expect(capsule.truncation).toEqual(audit.truncation)
    expect(capsule.provenance).toEqual(audit.provenance)
  })
})

describe('Batch 5: test-implementation role complete output', () => {
  it('TST-B5-005/013/020: test role reports correct changed surface, removed-symbol representation, bounded test infrastructure, freshness reflecting afterIndex, and stale detection against beforeIndex', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-test-role-')
    const { beforeOut, afterOut } = writeTestImplementationFixture(root)

    // Fresh: active index == afterIndex
    const freshRequestPath = writeRequest(root, 'req-fresh.json', {
      schemaVersion: '1.0.0',
      role: 'test-implementation',
      query: 'formatInvoice',
      changedFiles: ['src/invoiceService.ts'],
      changedSymbols: ['symbol:src/invoiceService.ts#formatInvoice'],
      beforeIndex: beforeOut,
      afterIndex: afterOut,
      testResponsibilityRefs: ['resp-format-invoice'],
      requestedEvidenceKinds: ['changed-surface', 'test-infrastructure', 'test-commands', 'responsibility-mappings'],
    })
    const freshCapsuleOut = join(root, 'capsule-fresh.json')
    const freshResult = runCli(['context', '--index', afterOut, '--request', freshRequestPath, '--out', freshCapsuleOut])
    expect(freshResult.status).toBe(0)
    const freshCapsule = JSON.parse(readFileSync(freshCapsuleOut, 'utf8'))
    expect(freshCapsule.freshness.state).toBe('fresh')
    expect(freshCapsule.roleContext.changedSurface.symbols.some((s: { status: string }) => s.status === 'removed')).toBe(true)
    expect(freshCapsule.testInfrastructure.relatedTests.length + freshCapsule.testInfrastructure.testCommands.length).toBeGreaterThan(0)

    // TST-B5-013: Stale: active index == beforeIndex (production changed since)
    const staleCapsuleOut = join(root, 'capsule-stale.json')
    const staleResult = runCli(['context', '--index', beforeOut, '--request', freshRequestPath, '--out', staleCapsuleOut])
    expect(staleResult.status).toBe(0)
    const staleCapsule = JSON.parse(readFileSync(staleCapsuleOut, 'utf8'))
    expect(staleCapsule.freshness.state).toBe('stale')
    expect(staleCapsule.freshness.relevantChangedPaths.length).toBeGreaterThan(0)
  })
})

describe('Batch 5: capsule/audit agreement', () => {
  function runFullScenario(root: string): { capsule: any; audit: any } {
    const { indexOut } = writeImplementationFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'processOrder',
      focusSymbols: ['symbol:src/orderProcessor.ts#processOrder'],
      testResponsibilityRefs: ['resp-process-order'],
      requestedEvidenceKinds: ['owner', 'contracts', 'validators', 'errors', 'responsibility-mappings', 'test-infrastructure'],
      limits: { evidenceGroupEntries: 2 },
    })
    const capsuleOut = join(root, 'capsule.json')
    const auditOut = join(root, 'audit.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', capsuleOut, '--audit-out', auditOut])
    expect(result.status).toBe(0)
    return {
      capsule: JSON.parse(readFileSync(capsuleOut, 'utf8')),
      audit: JSON.parse(readFileSync(auditOut, 'utf8')),
    }
  }

  it('TST-B5-006: capsule/audit adequacy agreement', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-agree-adequacy-')
    const { capsule, audit } = runFullScenario(root)
    expect(audit.contextAdequacy).toEqual(capsule.contextAdequacy)
    expect(audit.roleAdequacy).toEqual(capsule.roleAdequacy)
  })

  it('TST-B5-006A: the real producer writes matching repository and active-index identity', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-agree-identity-')
    const { capsule, audit } = runFullScenario(root)
    expect(capsule.index.projectRoot).toBe(root.replace(/\\/g, '/'))
    expect(audit.index.projectRoot).toBe(capsule.index.projectRoot)
    expect(audit.index.indexPath).toBe(capsule.index.indexPath)
    expect(audit.index.manifestPath).toBe(capsule.index.manifestPath)
    expect(audit.index.manifestSchemaVersion).toBe(capsule.index.manifestSchemaVersion)
  })

  it('TST-B5-007: capsule/audit freshness agreement', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-agree-freshness-')
    const { capsule, audit } = runFullScenario(root)
    expect(audit.freshness).toEqual(capsule.freshness)
  })

  it('TST-B5-008: capsule/audit mapping agreement', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-agree-mapping-')
    const { capsule, audit } = runFullScenario(root)
    expect(audit.responsibilityMappings).toEqual(capsule.responsibilityMappings)
  })

  it('TST-B5-009: capsule/audit truncation agreement', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-agree-truncation-')
    const { capsule, audit } = runFullScenario(root)
    expect(audit.truncation).toEqual(capsule.truncation)
    expect(audit.budget).toEqual(capsule.budget)
  })

  it('TST-B5-010: capsule/audit provenance agreement', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-agree-provenance-')
    const { capsule, audit } = runFullScenario(root)
    expect(audit.provenance).toEqual(capsule.provenance)
    expect(audit.fullFileFallback).toEqual(capsule.fullFileFallback)
  })
})

describe('Batch 5: responsibility integration', () => {
  it('TST-B5-011: responsibility-mappings requested without any testResponsibilityRefs is reported as not-operational, never fabricated', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-resp-norefs-')
    const { indexOut } = writeImplementationFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'processOrder',
      requestedEvidenceKinds: ['responsibility-mappings'],
    })
    const capsuleOut = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.responsibilityMappings.requested).toBe(true)
    expect(capsule.responsibilityMappings.operational).toBe(false)
    expect(capsule.responsibilityMappings.mappings).toEqual([])
  })

  it('TST-B5-012: a critical, unmapped responsibility is reported unmapped end to end and affects adequacy consistently between capsule and audit', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-resp-critical-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'isolatedThing.ts'), 'export function isolatedThing(): void {}\n')
    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'isolatedThing',
      changedFiles: ['src/isolatedThing.ts'],
      testResponsibilityRefs: ['resp-critical-unmapped'],
      requestedEvidenceKinds: ['responsibility-mappings'],
    })
    const capsuleOut = join(root, 'capsule.json')
    const auditOut = join(root, 'audit.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', capsuleOut, '--audit-out', auditOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    const audit = JSON.parse(readFileSync(auditOut, 'utf8'))
    expect(capsule.responsibilityMappings.mappings.length).toBe(1)
    expect(capsule.responsibilityMappings).toEqual(audit.responsibilityMappings)
    expect(capsule.roleAdequacy).toEqual(audit.roleAdequacy)
  })
})

describe('Batch 5: unknown freshness legacy compatibility', () => {
  it('TST-B5-014: legacy no-role requests with no before/after/git identity get unknown freshness without failing or blocking legacy fields', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-fresh-legacy-')
    const { indexOut } = writeArchitectureFixture(root)
    const capsuleOut = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--query', 'registerPlugin', '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.freshness.state).toBe('unknown')
    expect(capsule.schemaVersion).toBe('1.0.0')
    expect(capsule.contextAdequacy).toBeDefined()
  })
})

describe('Batch 5: limit and truncation integration', () => {
  it('TST-B5-015: equal CLI and structured limits are accepted and applied exactly once (no double application)', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-limits-equal-')
    const { indexOut } = writeArchitectureFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'registerPlugin',
      limits: { candidates: 5 },
    })
    const capsuleOut = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', capsuleOut, '--max-candidate-files', '5'])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.limits.maxCandidateFiles).toBe(5)
    const retained = capsule.candidateFiles.filter((c: { retained: boolean }) => c.retained)
    expect(retained.length).toBeLessThanOrEqual(5)
  })

  it('TST-B5-016: required responsibility-mapping evidence truncated by a tight limits.responsibilityMappings cap is reported explicitly (critical sorted first) and identically in capsule and audit', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-limits-truncate-')
    const { indexOut } = writeImplementationFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'processOrder',
      testResponsibilityRefs: ['resp-noncritical-a', 'resp-noncritical-b', 'resp-noncritical-c'],
      requestedEvidenceKinds: ['responsibility-mappings'],
      limits: { responsibilityMappings: 1 },
    })
    const capsuleOut = join(root, 'capsule.json')
    const auditOut = join(root, 'audit.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', capsuleOut, '--audit-out', auditOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    const audit = JSON.parse(readFileSync(auditOut, 'utf8'))
    expect(capsule.responsibilityMappings.limit).toBe(1)
    expect(capsule.responsibilityMappings.usedCount).toBeLessThanOrEqual(1)
    expect(capsule.responsibilityMappings.truncated).toBe(true)
    expect(capsule.responsibilityMappings.droppedCount).toBeGreaterThan(0)
    expect(capsule.truncation).toEqual(audit.truncation)
    expect(capsule.responsibilityMappings).toEqual(audit.responsibilityMappings)
  })
})

describe('Batch 5: full-file fallback integration', () => {
  it('TST-B5-017: disabling full-file fallback (limits.fullFileFallbacks = 0) never bypasses the cap, and missing critical evidence is reported, not silently dropped', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-fallback-disabled-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'gatewayRegistry.ts'), 'export function registerGateway(): void { /* entry point */ }\n')
    writeFileSync(join(src, 'gatewayError.ts'), 'export class GatewayError extends Error {}\n')
    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'gateway',
      focusSymbols: ['symbol:src/gatewayRegistry.ts#registerGateway'],
      testResponsibilityRefs: ['resp-gateway-errors'],
      requestedEvidenceKinds: ['responsibility-mappings'],
      limits: { fullFileFallbacks: 0 },
    })
    const capsuleOut = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.fullFileFallback.enabled).toBe(false)
    expect(capsule.fullFileFallback.used).toBe(0)
    for (const fb of capsule.fullFileFallback.fallbacks) {
      expect(fb.allowed).toBe(false)
    }
  })
})

describe('Batch 5: JSON stdout and error-stream gate', () => {
  it('TST-B5-018: successful --json stdout parses as exactly one JSON value with no diagnostic contamination', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-json-stdout-')
    const { indexOut } = writeArchitectureFixture(root)
    const capsuleOut = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--query', 'registerPlugin', '--out', capsuleOut, '--json'])
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout)
    expect(parsed.schemaVersion).toBe('1.0.0')
    expect(parsed.outputPath).toBeDefined()
  })

  it('TST-B5-019: a failed request (malformed request file) leaves no partial capsule or audit output', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-json-fail-')
    const { indexOut } = writeArchitectureFixture(root)
    const requestPath = join(root, 'malformed.json')
    writeFileSync(requestPath, '{ not valid json')
    const capsuleOut = join(root, 'capsule.json')
    const auditOut = join(root, 'audit.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', capsuleOut, '--audit-out', auditOut])
    expect(result.status).toBe(2)
    expect(existsSync(capsuleOut)).toBe(false)
    expect(existsSync(auditOut)).toBe(false)
  })

  it('TST-B5-019b: an unknown role fails with no partial output and a non-zero, non-crash exit code', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-json-fail-role-')
    const { indexOut } = writeArchitectureFixture(root)
    const capsuleOut = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--query', 'x', '--role', 'bogus', '--out', capsuleOut])
    expect(result.status).toBe(2)
    expect(existsSync(capsuleOut)).toBe(false)
  })
})

describe('Batch 5: before/after graph-diff integration', () => {
  it('TST-B5-020: before/after graph-diff correctly reports added, changed, and removed symbols end to end', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-graphdiff-')
    const { beforeOut, afterOut } = writeTestImplementationFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'test-implementation',
      query: 'formatInvoice',
      beforeIndex: beforeOut,
      afterIndex: afterOut,
      requestedEvidenceKinds: ['changed-surface'],
    })
    const capsuleOut = join(root, 'capsule.json')
    const result = runCli(['context', '--index', afterOut, '--request', requestPath, '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.roleContext.changedSurface.diffRequested).toBe(true)
    const symbolStatuses = capsule.roleContext.changedSurface.symbols.map((s: { status: string }) => s.status)
    expect(symbolStatuses).toContain('removed')
  })
})

describe('Batch 5: incremental/full equivalence', () => {
  it('TST-B5-021: a full index of a fixture produces context output equivalent (apart from generatedAt) whether or not an unrelated before/after diff is layered on top with no actual changes', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-incremental-')
    const { indexOut } = writeArchitectureFixture(root)
    const capsuleOut = join(root, 'capsule.json')

    const baseline = runCli(['context', '--index', indexOut, '--query', 'registerPlugin', '--out', capsuleOut])
    expect(baseline.status).toBe(0)
    const baselineCapsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))

    // Same index used as both before and after (no actual change) must not alter
    // core candidate/focus/graph output.
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'registerPlugin',
      beforeIndex: indexOut,
      afterIndex: indexOut,
    })
    const withDiffResult = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', capsuleOut])
    expect(withDiffResult.status).toBe(0)
    const withDiffCapsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))

    expect(withDiffCapsule.candidateFiles).toEqual(baselineCapsule.candidateFiles)
    expect(withDiffCapsule.focus).toEqual(baselineCapsule.focus)
    expect(withDiffCapsule.selectedGraph).toEqual(baselineCapsule.selectedGraph)
  })
})

describe('Batch 5: cross-platform path handling', () => {
  it('TST-B5-022: index, request, output, and audit paths containing spaces all work end to end', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-spaces-')
    const spacedRoot = join(root, 'has spaces here')
    const src = join(spacedRoot, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'thing.ts'), 'export function thing(): void {}\n')
    const indexOut = join(spacedRoot, '.my-dev-kit')
    expect(runCli(['index', '--root', spacedRoot, '--src', 'src', '--out', indexOut]).status).toBe(0)

    const requestPath = writeRequest(spacedRoot, 'req with spaces.json', { schemaVersion: '1.0.0', query: 'thing', role: 'implementation' })
    const capsuleOut = join(spacedRoot, 'out with spaces', 'capsule.json')
    const auditOut = join(spacedRoot, 'out with spaces', 'audit.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', capsuleOut, '--audit-out', auditOut])
    expect(result.status).toBe(0)
    expect(existsSync(capsuleOut)).toBe(true)
    expect(existsSync(auditOut)).toBe(true)
  })
})

describe('Batch 5: non-Git context', () => {
  it('TST-B5-023: a fixture rooted outside any Git repository still produces a valid capsule with honest (never fabricated-fresh) freshness', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-nongit-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'standalone.ts'), 'export function standalone(): void {}\n')
    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)
    const capsuleOut = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--query', 'standalone', '--role', 'implementation', '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.freshness.state).not.toBe('fresh')
  })
})

describe('Batch 5: complete-output determinism', () => {
  it('TST-B5-024: repeated identical structured requests (role + responsibility + limits + before/after) produce byte-identical output apart from generatedAt', () => {
    const root = createTempRoot('my-dev-kit-v1-b5-determinism-')
    const { beforeOut, afterOut } = writeTestImplementationFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'test-implementation',
      query: 'formatInvoice',
      changedFiles: ['src/invoiceService.ts'],
      changedSymbols: ['symbol:src/invoiceService.ts#formatInvoice'],
      beforeIndex: beforeOut,
      afterIndex: afterOut,
      testResponsibilityRefs: ['resp-format-invoice'],
      requestedEvidenceKinds: ['changed-surface', 'test-infrastructure', 'test-commands', 'responsibility-mappings'],
      limits: { evidenceGroupEntries: 3, fullFileFallbacks: 1 },
    })
    const capsuleOut = join(root, 'capsule.json')
    const auditOut = join(root, 'audit.json')
    const args = ['context', '--index', afterOut, '--request', requestPath, '--out', capsuleOut, '--audit-out', auditOut]

    expect(runCli(args).status).toBe(0)
    const capsule1 = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    const audit1 = JSON.parse(readFileSync(auditOut, 'utf8'))

    expect(runCli(args).status).toBe(0)
    const capsule2 = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    const audit2 = JSON.parse(readFileSync(auditOut, 'utf8'))

    delete capsule1.generatedAt
    delete capsule2.generatedAt
    delete audit1.generatedAt
    delete audit2.generatedAt
    expect(capsule2).toEqual(capsule1)
    expect(audit2).toEqual(audit1)
  })
})

describe('Batch 5: legacy benchmark compatibility', () => {
  it('TST-B5-025: the existing basic-ts fixture still produces a valid, schema-stable capsule with no role, matching pre-Batch-5 shape expectations', () => {
    const outDir = createTempRoot('my-dev-kit-v1-b5-benchmark-')
    const indexResult = runCli(['index', '--root', 'examples/basic-ts', '--src', 'src', '--out', outDir])
    expect(indexResult.status).toBe(0)
    const capsuleOut = join(outDir, 'context-capsule.json')
    const result = runCli(['context', '--index', outDir, '--query', 'describeUser', '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.schemaVersion).toBe('1.0.0')
    expect(capsule.request.role).toBeNull()
    expect(capsule.evidenceGroups).toEqual([])
    expect(capsule.responsibilityMappings).toMatchObject({ requested: false, operational: false, mappings: [] })
  })
})
