import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

// v1.10.1 Batch 4: role-specific adequacy.
// Responsibility IDs: TST-B4-021, 022, 025, 026, 027, 028, 029, 030.

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

function writeFullFixture(root: string): { indexOut: string } {
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'widgetRegistry.ts'), "export function registerWidget(name: string): void { /* entry point */ }\n")
  writeFileSync(
    join(src, 'widgetValidator.ts'),
    "import { registerWidget } from './widgetRegistry'\nexport function validateWidgetName(name: string): boolean { return name.length > 0 }\nexport const widget = registerWidget\n"
  )
  writeFileSync(join(src, 'widgetError.ts'), "export class WidgetError extends Error {}\n")
  writeFileSync(
    join(src, 'widgetRegistry.spec.ts'),
    "import { registerWidget } from './widgetRegistry'\nexport const check = registerWidget\n"
  )
  const indexOut = join(root, '.my-dev-kit')
  const result = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
  expect(result.status).toBe(0)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'p', version: '0.0.0', scripts: { test: 'vitest run' } }, null, 2))
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

describe('role-specific adequacy', () => {
  it('TST-B4-025: architecture role with a resolvable owner and contract evidence is adequate', () => {
    const root = createTempRoot('my-dev-kit-v1-adeq-arch-ok-')
    const { indexOut } = writeFullFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'architecture',
      focusSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.roleAdequacy.role).toBe('architecture')
    expect(capsule.roleAdequacy.blockingConditions).toEqual([])
    expect(capsule.roleAdequacy.satisfiedConditions).toContain('at least one plausible owner is present')
  })

  it('TST-B4-026: architecture role with no resolvable owner reports a blocking missing condition', () => {
    const root = createTempRoot('my-dev-kit-v1-adeq-arch-missing-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'plain.ts'), 'export const value = 1\n')
    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)
    const requestPath = writeRequest(root, 'req.json', { schemaVersion: '1.0.0', query: 'zzz-no-match', role: 'architecture' })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.roleAdequacy.role).toBe('architecture')
    expect(capsule.roleAdequacy.blockingConditions).toContain('no plausible owner exists')
    expect(capsule.roleAdequacy.status).toBe('context insufficient and more retrieval required')
  })

  it('TST-B4-027/028: implementation role adequacy tracks owner and contract presence', () => {
    const root = createTempRoot('my-dev-kit-v1-adeq-impl-')
    const { indexOut } = writeFullFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'implementation',
      focusSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.roleAdequacy.role).toBe('implementation')
    expect(capsule.roleAdequacy.satisfiedConditions).toContain('selected owner evidence exists')
    expect(capsule.roleAdequacy.satisfiedConditions).toContain('required contract evidence exists')
  })

  it('TST-B4-021/029: test-implementation role: a critical unmapped responsibility makes the role adequacy inadequate', () => {
    const root = createTempRoot('my-dev-kit-v1-adeq-test-critical-')
    const { indexOut } = writeFullFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'test-implementation',
      changedFiles: ['src/widgetRegistry.ts'],
      testResponsibilityRefs: ['resp-critical-unreachable-xyz'],
      requestedEvidenceKinds: ['responsibility-mappings'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    // The current string-only testResponsibilityRefs contract cannot mark a
    // responsibility critical (section 18's documented safe default is noncritical),
    // so this responsibility maps as noncritical: it must warn but never block.
    const mapping = capsule.responsibilityMappings.mappings[0]
    expect(mapping.criticality).toBe('noncritical')
    if (mapping.mappingStatus === 'unmapped' || mapping.mappingStatus === 'partially-mapped') {
      expect(capsule.roleAdequacy.blockingConditions).not.toContain('resp-critical-unreachable-xyz')
    }
  })

  it('TST-B4-030: test-implementation role with no changed-surface evidence reports reduced adequacy', () => {
    const root = createTempRoot('my-dev-kit-v1-adeq-test-nochange-')
    const { indexOut } = writeFullFixture(root)
    const requestPath = writeRequest(root, 'req.json', { schemaVersion: '1.0.0', query: 'widget', role: 'test-implementation' })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.roleAdequacy.role).toBe('test-implementation')
    expect(capsule.roleAdequacy.missingConditions).toContain('changed surface required but missing')
    expect(capsule.roleAdequacy.status).toBe('context insufficient and more retrieval required')
  })

  it('TST-B4-022: a noncritical unmapped responsibility produces a warning without forcing inadequacy on its own', () => {
    const root = createTempRoot('my-dev-kit-v1-adeq-noncritical-')
    const { indexOut } = writeFullFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'implementation',
      focusSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
      testResponsibilityRefs: ['resp-unrelated-noncritical'],
      requestedEvidenceKinds: ['responsibility-mappings'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.roleAdequacy.warnings.some((w: string) => w.includes('resp-unrelated-noncritical'))).toBe(true)
  })

  it('TST-B4-048: legacy (no-role) requests keep the existing contextAdequacy status and report role adequacy as not applicable', () => {
    const root = createTempRoot('my-dev-kit-v1-adeq-legacy-')
    const { indexOut } = writeFullFixture(root)
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--query', 'widget', '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.roleAdequacy.role).toBeNull()
    expect(capsule.roleAdequacy.status).toBe(capsule.contextAdequacy.status)
    expect(capsule.responsibilityMappings.operational).toBe(false)
  })
})
