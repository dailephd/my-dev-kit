import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

// v1.10.1 Batch 1: context-role and structured ContextRequest contracts.
// Responsibility IDs (TST-B1-001..018) are noted per test.

let outDir = ''
let capsuleOut = ''

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-context-request-'))
  const result = runCli(['index', '--root', 'examples/basic-ts', '--src', 'src', '--out', outDir])
  expect(result.status).toBe(0)
  capsuleOut = join(outDir, 'context-capsule.json')
})

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

function writeRequestFile(name: string, body: unknown): string {
  const filePath = join(outDir, name)
  writeFileSync(filePath, JSON.stringify(body, null, 2))
  return filePath
}

describe('context request contract', () => {
  it('TST-B1-001: an existing v1.10.0 invocation without role or request file stays compatible', () => {
    const result = runCli(['context', '--index', outDir, '--query', 'add a field', '--out', capsuleOut, '--json'])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.schemaVersion).toBe('1.0.0')
    expect(capsule.request.role).toBeNull()
    expect(capsule.request.requestFilePath).toBeNull()
    expect(capsule.deferredRequestFields).toEqual([])
    const parsedStdout = JSON.parse(result.stdout)
    expect(parsedStdout.schemaVersion).toBe('1.0.0')
  })

  it('TST-B1-002/003: loads, validates, and normalizes a valid structured request; role and mode coexist', () => {
    const requestPath = writeRequestFile('valid-request.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'describeUser',
      mode: 'feature-add',
    })
    const result = runCli(['context', '--index', outDir, '--request', requestPath, '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.request.role).toBe('implementation')
    expect(capsule.request.mode).toBe('feature-add')
    expect(capsule.queryPlan.mode).toBe('feature-add')
    expect(capsule.request.originalQuery).toBe('describeUser')
    expect(capsule.request.requestFilePath).toBe(requestPath.replace(/\\/g, '/'))
  })

  it('TST-B1-004: conflicting CLI and request-file query values fail clearly with no output written', () => {
    const requestPath = writeRequestFile('conflict-query.json', { schemaVersion: '1.0.0', query: 'zzz other query' })
    const conflictOut = join(outDir, 'conflict-query-capsule.json')
    const result = runCli(['context', '--index', outDir, '--query', 'add a field', '--request', requestPath, '--out', conflictOut])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Conflicting query')
    expect(existsSync(conflictOut)).toBe(false)
  })

  it('TST-B1-005: equivalent duplicate scalar values across CLI and request file are accepted deterministically', () => {
    const requestPath = writeRequestFile('equivalent-query.json', { schemaVersion: '1.0.0', query: 'add   a field' })
    const equivOut = join(outDir, 'equivalent-capsule.json')
    const result = runCli(['context', '--index', outDir, '--query', 'add a field', '--request', requestPath, '--out', equivOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(equivOut, 'utf8'))
    expect(capsule.request.originalQuery).toBe('add a field')
  })

  it('TST-B1-006 (updated by v1.10.1 Batch 2): collection fields (e.g. focusFiles) are file-sourced, deduplicated, and sorted; now operational, not deferred', () => {
    // focusFiles was deferred in Batch 1; Batch 2 operationalizes it (see roleCandidates.spec-style
    // coverage in contextFocus.spec.ts). Deduplication/sort ordering is still asserted here.
    const requestPath = writeRequestFile('collections.json', {
      schemaVersion: '1.0.0',
      query: 'add a field',
      focusFiles: ['src/index.ts', 'src/index.ts', 'src/other.ts'],
    })
    const result = runCli(['context', '--index', outDir, '--request', requestPath, '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.deferredRequestFields).not.toContain('focusFiles')
    expect(capsule.roleContext.focus.focusFiles.map((entry: { path: string }) => entry.path)).toEqual(['src/index.ts', 'src/other.ts'])
  })

  it('TST-B1-007: an unknown role fails clearly', () => {
    const requestPath = writeRequestFile('unknown-role.json', { schemaVersion: '1.0.0', query: 'x', role: 'bogus-role' })
    const result = runCli(['context', '--index', outDir, '--request', requestPath, '--out', capsuleOut])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Unknown role')
  })

  it('TST-B1-007b: an unknown --role CLI value fails clearly', () => {
    const result = runCli(['context', '--index', outDir, '--query', 'x', '--role', 'bogus-role', '--out', capsuleOut])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Invalid --role')
  })

  it('TST-B1-008: an unsupported schema major fails with a stable diagnostic', () => {
    const requestPath = writeRequestFile('bad-major.json', { schemaVersion: '2.0.0', query: 'x' })
    const result = runCli(['context', '--index', outDir, '--request', requestPath, '--out', capsuleOut])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Unsupported context request schema version')
    expect(result.stderr).toContain('supported major 1')
  })

  it('TST-B1-009: malformed JSON fails without partial output', () => {
    const requestPath = join(outDir, 'malformed.json')
    writeFileSync(requestPath, '{ not valid json')
    const malformedOut = join(outDir, 'malformed-capsule.json')
    const result = runCli(['context', '--index', outDir, '--request', requestPath, '--out', malformedOut])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Invalid JSON in context request file')
    expect(existsSync(malformedOut)).toBe(false)
  })

  it('TST-B1-010: a missing request file fails using the current file-error convention', () => {
    const result = runCli(['context', '--index', outDir, '--request', join(outDir, 'does-not-exist.json'), '--out', capsuleOut])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Missing context request file')
  })

  it('TST-B1-011: invalid field types fail (wrong scalar, array, and object types)', () => {
    const scalarPath = writeRequestFile('bad-scalar.json', { schemaVersion: '1.0.0', query: 'x', mode: 42 })
    let result = runCli(['context', '--index', outDir, '--request', scalarPath, '--out', capsuleOut])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Invalid "mode"')

    const arrayPath = writeRequestFile('bad-array.json', { schemaVersion: '1.0.0', query: 'x', focusFiles: 'src/index.ts' })
    result = runCli(['context', '--index', outDir, '--request', arrayPath, '--out', capsuleOut])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Invalid "focusFiles"')

    const objectPath = writeRequestFile('bad-object.json', { schemaVersion: '1.0.0', query: 'x', limits: 'not-an-object' })
    result = runCli(['context', '--index', outDir, '--request', objectPath, '--out', capsuleOut])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Invalid "limits"')
  })

  it('TST-B1-012: invalid limits (negative and non-integer) fail', () => {
    const negativePath = writeRequestFile('negative-limit.json', { schemaVersion: '1.0.0', query: 'x', limits: { candidates: -1 } })
    let result = runCli(['context', '--index', outDir, '--request', negativePath, '--out', capsuleOut])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Invalid limits.candidates')

    const fractionalPath = writeRequestFile('fractional-limit.json', { schemaVersion: '1.0.0', query: 'x', limits: { files: 1.5 } })
    result = runCli(['context', '--index', outDir, '--request', fractionalPath, '--out', capsuleOut])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Invalid limits.files')
  })

  it('TST-B1-013: request, output, and audit paths containing spaces work end to end', () => {
    const requestPath = writeRequestFile('req with spaces.json', { schemaVersion: '1.0.0', query: 'describeUser', role: 'architecture' })
    const spacedOut = join(outDir, 'out with spaces', 'capsule.json')
    const spacedAudit = join(outDir, 'out with spaces', 'audit.json')
    const result = runCli(['context', '--index', outDir, '--request', requestPath, '--out', spacedOut, '--audit-out', spacedAudit])
    expect(result.status).toBe(0)
    expect(existsSync(spacedOut)).toBe(true)
    expect(existsSync(spacedAudit)).toBe(true)
    const capsule = JSON.parse(readFileSync(spacedOut, 'utf8'))
    expect(capsule.request.role).toBe('architecture')
  })

  it('TST-B1-014: repeated normalization of an identical request produces identical structured output', () => {
    const requestPath = writeRequestFile('deterministic.json', {
      schemaVersion: '1.0.0',
      role: 'test-implementation',
      query: 'describeUser',
      focusFiles: ['src/other.ts', 'src/index.ts'],
    })
    const args = ['context', '--index', outDir, '--request', requestPath, '--out', capsuleOut]
    expect(runCli(args).status).toBe(0)
    const first = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(runCli(args).status).toBe(0)
    const second = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    delete first.generatedAt
    delete second.generatedAt
    expect(second).toEqual(first)
  })

  it('TST-B1-015: JSON stdout remains parseable and diagnostics do not corrupt it', () => {
    const requestPath = writeRequestFile('json-stdout.json', { schemaVersion: '1.0.0', query: 'describeUser' })
    const result = runCli(['context', '--index', outDir, '--request', requestPath, '--out', capsuleOut, '--json'])
    expect(result.status).toBe(0)
    expect(() => JSON.parse(result.stdout)).not.toThrow()
  })

  it('TST-B1-016 (updated by v1.10.1 Batch 4): "limits" is now operational (budget reporting) without changing legacy ranking/selection, while focusFiles/changedFiles/requestedEvidenceKinds remain operational from Batch 2', () => {
    // Batch 1 originally asserted focusFiles/changedFiles/requestedEvidenceKinds had zero
    // operational effect and were reported as deferred. v1.10.1 Batch 2 operationalized
    // those fields (see roleCandidates.ts/contextRequestNormalization.ts). v1.10.1 Batch 4
    // operationalizes "limits" too (section 23): a structured `limits` request field now
    // visibly affects `budget`/`truncation` reporting (declaredValue, adequacyImpact), even
    // though it deliberately does NOT override the legacy `--max-*`/`ContextCapsuleLimits`
    // candidate/graph selection boundary (section 23.2) — so candidateFiles/selectedGraph
    // stay byte-for-byte identical to the no-limits baseline, but deferredRequestFields no
    // longer lists "limits".
    const baselineResult = runCli(['context', '--index', outDir, '--query', 'describeUser', '--out', capsuleOut])
    expect(baselineResult.status).toBe(0)
    const baseline = JSON.parse(readFileSync(capsuleOut, 'utf8'))

    const limitsOnlyPath = writeRequestFile('operational-limits-only.json', {
      schemaVersion: '1.0.0',
      query: 'describeUser',
      limits: { candidates: 3 },
    })
    const limitsOnlyResult = runCli(['context', '--index', outDir, '--request', limitsOnlyPath, '--out', capsuleOut])
    expect(limitsOnlyResult.status).toBe(0)
    const withLimitsOnly = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(withLimitsOnly.focus.focusNodeId).toBe(baseline.focus.focusNodeId)
    expect(withLimitsOnly.candidateFiles).toEqual(baseline.candidateFiles)
    expect(withLimitsOnly.selectedGraph).toEqual(baseline.selectedGraph)
    expect(withLimitsOnly.deferredRequestFields).toEqual([])
    const candidatesBudget = withLimitsOnly.budget.limits.find((l: { name: string }) => l.name === 'candidates')
    expect(candidatesBudget.declaredValue).toBe(3)

    const operationalPath = writeRequestFile('now-operational.json', {
      schemaVersion: '1.0.0',
      query: 'describeUser',
      focusFiles: ['src/index.ts'],
      changedFiles: ['src/index.ts'],
      requestedEvidenceKinds: ['owner', 'callers'],
    })
    const operationalResult = runCli(['context', '--index', outDir, '--request', operationalPath, '--out', capsuleOut])
    expect(operationalResult.status).toBe(0)
    const withOperational = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(withOperational.deferredRequestFields).toEqual([])
    expect(withOperational.roleContext.focus.focusFiles[0]).toMatchObject({ path: 'src/index.ts', resolved: true })
    expect(withOperational.roleContext.changedSurface.files[0]).toMatchObject({ path: 'src/index.ts' })
  })

  it('TST-B1-017: the existing capsule remains readable and compatible without role metadata', () => {
    const result = runCli(['context', '--index', outDir, '--query', 'add a field', '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.request).toMatchObject({
      originalQuery: 'add a field',
      mode: 'general',
      role: null,
      requestFilePath: null,
    })
    expect(Array.isArray(capsule.deferredRequestFields)).toBe(true)
  })

  it('TST-B1-018: the existing retrieval audit remains readable and compatible', () => {
    const auditOut = join(outDir, 'legacy-audit.json')
    const result = runCli(['context', '--index', outDir, '--query', 'add a field', '--out', capsuleOut, '--audit-out', auditOut])
    expect(result.status).toBe(0)
    const audit = JSON.parse(readFileSync(auditOut, 'utf8'))
    expect(audit.request.role).toBeNull()
    expect(Array.isArray(audit.warnings)).toBe(true)
    expect(audit.warnings).toEqual([])
  })

  it('rejects simultaneous conflicting index and root in a request file', () => {
    const requestPath = writeRequestFile('conflicting-index-root.json', {
      schemaVersion: '1.0.0',
      query: 'x',
      index: outDir,
      root: join(outDir, 'not-the-root'),
    })
    const result = runCli(['context', '--request', requestPath, '--out', capsuleOut])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Conflicting "index" and "root"')
  })

  it('accepts a --role CLI flag equivalent to a request-file role', () => {
    const result = runCli(['context', '--index', outDir, '--query', 'describeUser', '--role', 'architecture', '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.request.role).toBe('architecture')
  })

  it('rejects an unknown requestedEvidenceKinds entry', () => {
    const requestPath = writeRequestFile('bad-evidence-kind.json', {
      schemaVersion: '1.0.0',
      query: 'x',
      requestedEvidenceKinds: ['owner', 'bogus-kind'],
    })
    const result = runCli(['context', '--index', outDir, '--request', requestPath, '--out', capsuleOut])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Unknown requestedEvidenceKinds entry')
  })

  it('requires a query from either CLI or request file', () => {
    const requestPath = writeRequestFile('no-query.json', { schemaVersion: '1.0.0', query: 'placeholder' })
    // valid file works; but omitting query in both should fail with the legacy substring
    const result = runCli(['context', '--index', outDir, '--out', capsuleOut])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('requires --query')
    expect(existsSync(requestPath)).toBe(true)
  })

  it('context --help documents --request and --role', () => {
    const result = runCli(['context', '--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('--request')
    expect(result.stdout).toContain('--role')
  })
})
