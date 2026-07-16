import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'
import { buildFullFileFallbacks } from '../../src/context/fullFileFallback.js'

// v1.10.1 Batch 4: full-file fallback.
// Responsibility IDs: TST-B4-042, 043, 044.

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
  writeFileSync(join(src, 'widgetRegistry.ts'), 'export function registerWidget(): void { /* entry point */ }\n')
  writeFileSync(join(src, 'widgetError.ts'), "export class WidgetError extends Error {}\n")
  const indexOut = join(root, '.my-dev-kit')
  expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)
  return { indexOut }
}

function writeRequest(root: string, name: string, body: unknown): string {
  const filePath = join(root, name)
  writeFileSync(filePath, JSON.stringify(body, null, 2))
  return filePath
}

describe('full-file fallback (CLI, end-to-end)', () => {
  it('TST-B4-042: contract/error evidence not covered by a bounded source slice is retrieved via one bounded, auditable full-file fallback', () => {
    const root = createTempRoot('my-dev-kit-v1-fallback-used-')
    const { indexOut } = writeFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'implementation',
      focusSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
      testResponsibilityRefs: ['resp-widget-errors'],
      requestedEvidenceKinds: ['responsibility-mappings'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.fullFileFallback.enabled).toBe(true)
    if (capsule.fullFileFallback.fallbacks.length > 0) {
      const fb = capsule.fullFileFallback.fallbacks[0]
      expect(fb.filePath).toBe('src/widgetError.ts')
      expect(fb.boundedRetrievalAttempted).toBe(true)
      expect(fb.allowed).toBe(true)
      expect(fb.includedLineCount).toBeGreaterThan(0)
    }
  })

  it('TST-B4-043: disabling fallback (limits.fullFileFallbacks = 0) reports unresolved evidence instead of silently omitting it', () => {
    const root = createTempRoot('my-dev-kit-v1-fallback-disabled-')
    const { indexOut } = writeFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'implementation',
      focusSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
      testResponsibilityRefs: ['resp-widget-errors'],
      requestedEvidenceKinds: ['responsibility-mappings'],
      limits: { fullFileFallbacks: 0 },
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.fullFileFallback.enabled).toBe(false)
    expect(capsule.fullFileFallback.used).toBe(0)
    for (const fb of capsule.fullFileFallback.fallbacks) {
      expect(fb.allowed).toBe(false)
    }
  })
})

describe('full-file fallback (unit-level)', () => {
  it('TST-B4-044: the fallback count deterministically cannot exceed limits.fullFileFallbacks', () => {
    const summary = buildFullFileFallbacks({
      role: 'implementation',
      repoRoot: process.cwd(),
      candidates: [
        { filePath: 'src/a.ts', reason: 'contract evidence', requestedEvidenceKind: 'contracts', responsibilityIdsAffected: ['r1'] },
        { filePath: 'src/b.ts', reason: 'contract evidence', requestedEvidenceKind: 'contracts', responsibilityIdsAffected: ['r2'] },
        { filePath: 'src/c.ts', reason: 'contract evidence', requestedEvidenceKind: 'contracts', responsibilityIdsAffected: ['r3'] },
      ],
      alreadyCoveredFilePaths: new Set(),
      limit: 1,
    })
    expect(summary.limit).toBe(1)
    expect(summary.fallbacks.filter((f) => f.boundedRetrievalAttempted).length).toBe(1)
    expect(summary.fallbacks.filter((f) => !f.boundedRetrievalAttempted).length).toBe(2)
    expect(summary.used).toBeLessThanOrEqual(1)
  })
})
