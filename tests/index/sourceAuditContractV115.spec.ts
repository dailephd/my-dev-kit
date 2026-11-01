import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AUDIT_FACT_PAGE_SIZE,
  AUDIT_INVENTORY_PAGE_SIZE,
  AUDIT_LITERAL_MAX_CHARS,
  SOURCE_AUDIT_ARTIFACT_KIND,
  SOURCE_AUDIT_CAPABILITIES,
  SOURCE_AUDIT_CAPABILITY_STATUSES,
  SOURCE_AUDIT_EXPORT_ORIGINS,
  SOURCE_AUDIT_EXTRACTION_METHODS,
  SOURCE_AUDIT_FACT_KINDS,
  SOURCE_AUDIT_FILENAME,
  SOURCE_AUDIT_FILE_STATUSES,
  SOURCE_AUDIT_IMPORT_RESOLUTIONS,
  SOURCE_AUDIT_OBSERVATION_KINDS,
  SOURCE_AUDIT_ROLES,
  SOURCE_AUDIT_SCHEMA_VERSION,
  SOURCE_AUDIT_VISIBILITIES,
} from '../../src/symbol-index/auditEvidenceTypes.js'
import type {
  SourceAuditEvidenceArtifact,
  SourceAuditFact,
  SourceAuditFile,
  SourceAuditFilePage,
  SourceAuditInventoryPage,
} from '../../src/symbol-index/auditEvidenceTypes.js'
import {
  validateSourceAuditEvidence,
  validateSourceAuditFilePage,
  validateSourceAuditInventoryPage,
} from '../../src/symbol-index/validateAuditEvidence.js'

const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'v115-source-audit')
const PREFIX = /^INVALID_SOURCE_AUDIT_EVIDENCE: /
const SHA = 'c'.repeat(64)

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as unknown
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function artifact(name = 'valid-complete.json'): SourceAuditEvidenceArtifact {
  const value = fixture(name)
  validateSourceAuditEvidence(value)
  return clone(value)
}

function expectInvalidArtifact(value: unknown, fragment?: string): void {
  let message = ''
  try {
    validateSourceAuditEvidence(value)
  } catch (error) {
    message = (error as Error).message
  }
  expect(message).toMatch(PREFIX)
  if (fragment) expect(message).toContain(fragment)
  expect(message.length).toBeLessThanOrEqual(240)
}

const noCapabilities = (): SourceAuditFile['capabilities'] => ({
  declarations: 'not-applicable',
  imports: 'not-applicable',
  exports: 'not-applicable',
  'identifier-literals': 'not-applicable',
  'test-observations': 'not-applicable',
  'fixture-references': 'not-applicable',
  'process-observations': 'not-applicable',
  'api-client-calls': 'not-applicable',
  'source-ranges': 'not-applicable',
})

function summary(path: string): Omit<SourceAuditFile, 'facts' | 'diagnostics'> {
  return {
    path,
    language: 'typescript',
    role: 'source',
    status: 'parsed',
    contentSha256: SHA,
    sizeBytes: 10,
    lineCount: 1,
    analyzerId: 'typescript-ast',
    capabilities: { ...noCapabilities(), 'identifier-literals': 'complete' },
    warnings: [],
  }
}

function literalFact(index: number, path: string): SourceAuditFact {
  return {
    id: `${path}#identifier-literal:${index}`,
    kind: 'identifier-literal',
    span: { path, startLine: index, startColumn: 0, endLine: index, endColumn: 4 },
    extractionMethod: 'typescript-ast',
    value: `v${index}`,
  }
}

const COVERAGE_ZERO: SourceAuditEvidenceArtifact['coverage'] = {
  selectedFileCount: 0,
  recordedFileCount: 0,
  unreadableFileCount: 0,
  excludedPathCount: 0,
  unsupportedFileCount: 0,
  inventoryComplete: true,
  exclusionsAreExplicit: true,
}

function inventoryPage(totalItems: number, pageIndex: number): SourceAuditInventoryPage {
  const totalPages = Math.max(1, Math.ceil(totalItems / AUDIT_INVENTORY_PAGE_SIZE))
  const count = Math.min(AUDIT_INVENTORY_PAGE_SIZE, Math.max(0, totalItems - pageIndex * AUDIT_INVENTORY_PAGE_SIZE))
  const start = pageIndex * AUDIT_INVENTORY_PAGE_SIZE
  return {
    schemaVersion: '1.0.0',
    snapshotId: SHA,
    pageIndex,
    pageSize: AUDIT_INVENTORY_PAGE_SIZE,
    totalItems,
    totalPages,
    nextPageIndex: pageIndex + 1 < totalPages ? pageIndex + 1 : null,
    mode: 'audit-files',
    coverage: { ...COVERAGE_ZERO, selectedFileCount: totalItems, recordedFileCount: totalItems },
    files: Array.from({ length: count }, (_, i) => summary(`src/f${String(start + i).padStart(4, '0')}.ts`)),
  }
}

function filePage(totalFacts: number, pageIndex: number): SourceAuditFilePage {
  const path = 'src/big.ts'
  const totalPages = Math.max(1, Math.ceil(totalFacts / AUDIT_FACT_PAGE_SIZE))
  const count = Math.min(AUDIT_FACT_PAGE_SIZE, Math.max(0, totalFacts - pageIndex * AUDIT_FACT_PAGE_SIZE))
  const start = pageIndex * AUDIT_FACT_PAGE_SIZE
  return {
    schemaVersion: '1.0.0',
    snapshotId: SHA,
    pageIndex,
    pageSize: AUDIT_FACT_PAGE_SIZE,
    totalItems: totalFacts,
    totalPages,
    nextPageIndex: pageIndex + 1 < totalPages ? pageIndex + 1 : null,
    mode: 'audit-file',
    status: 'found',
    file: { ...summary(path), diagnostics: [] },
    facts: Array.from({ length: count }, (_, i) => literalFact(start + i + 1, path)),
  }
}

function expectInvalidInventory(value: unknown, fragment?: string): void {
  expect(() => validateSourceAuditInventoryPage(value)).toThrow(PREFIX)
  if (fragment) expect(() => validateSourceAuditInventoryPage(value)).toThrow(fragment)
}

function expectInvalidFilePage(value: unknown, fragment?: string): void {
  expect(() => validateSourceAuditFilePage(value)).toThrow(PREFIX)
  if (fragment) expect(() => validateSourceAuditFilePage(value)).toThrow(fragment)
}

describe('v1.15.0 source-audit contract constants', () => {
  it('materializes the exact frozen constants', () => {
    expect(SOURCE_AUDIT_SCHEMA_VERSION).toBe('1.0.0')
    expect(SOURCE_AUDIT_ARTIFACT_KIND).toBe('my-dev-kit-v1-source-audit-evidence')
    expect(SOURCE_AUDIT_FILENAME).toBe('source-audit-evidence.json')
    expect(AUDIT_INVENTORY_PAGE_SIZE).toBe(64)
    expect(AUDIT_FACT_PAGE_SIZE).toBe(128)
    expect(AUDIT_LITERAL_MAX_CHARS).toBe(256)
  })

  it('materializes the exact frozen enumeration values', () => {
    expect([...SOURCE_AUDIT_ROLES]).toEqual(['source', 'test', 'script', 'unknown'])
    expect([...SOURCE_AUDIT_FILE_STATUSES]).toEqual(['parsed', 'partial', 'file-level-only', 'unsupported', 'failed', 'skipped'])
    expect([...SOURCE_AUDIT_CAPABILITIES]).toEqual([
      'declarations', 'imports', 'exports', 'identifier-literals', 'test-observations',
      'fixture-references', 'process-observations', 'api-client-calls', 'source-ranges',
    ])
    expect([...SOURCE_AUDIT_CAPABILITY_STATUSES]).toEqual(['complete', 'partial', 'unsupported', 'failed', 'not-applicable'])
    expect([...SOURCE_AUDIT_FACT_KINDS]).toEqual([
      'declaration', 'import', 'export', 'identifier-literal', 'test-observation',
      'fixture-reference', 'process-observation', 'api-client-call',
    ])
    expect([...SOURCE_AUDIT_OBSERVATION_KINDS]).toEqual([
      'test-title', 'test-modifier-skip', 'test-modifier-only', 'embedded-test-command', 'registry-id',
      'fixture-basename', 'process-invocation', 'process-option', 'newline-split', 'path-separator-split', 'source-literal',
    ])
    expect([...SOURCE_AUDIT_EXTRACTION_METHODS]).toEqual([
      'typescript-ast', 'python-ast', 'rust-tree-sitter', 'java-lexical', 'kotlin-lexical', 'lexical', 'metadata',
    ])
    expect([...SOURCE_AUDIT_VISIBILITIES]).toEqual(['public', 'internal', 'protected', 'private', 'package', 'module', 'unknown'])
    expect([...SOURCE_AUDIT_EXPORT_ORIGINS]).toEqual([
      'declared-export', 're-export', 'commonjs', 'python-all', 'python-convention', 'visibility-inferred', 'none', 'unknown',
    ])
    expect([...SOURCE_AUDIT_IMPORT_RESOLUTIONS]).toEqual([
      'resolved-local', 'ambiguous', 'unresolved', 'external', 'outside-selected-roots', 'observed',
    ])
  })
})

describe('validateSourceAuditEvidence positive fixtures', () => {
  it('accepts the complete canonical artifact (RSP-001)', () => {
    const value = fixture('valid-complete.json')
    expect(() => validateSourceAuditEvidence(value)).not.toThrow()
    const typed = clone(value) as SourceAuditEvidenceArtifact
    expect(typed.coverage.inventoryComplete).toBe(true)
    expect(typed.files.every((f) => !Object.values(f.capabilities).includes('partial'))).toBe(true)
  })

  it('accepts partial evidence without treating it as complete (RSP-001)', () => {
    const value = artifact('valid-partial.json')
    expect(value.coverage.inventoryComplete).toBe(true)
    const statuses = value.files.flatMap((f) => Object.values(f.capabilities))
    expect(statuses).toContain('partial')
    expect(statuses).toContain('unsupported')
    expect(statuses).toContain('failed')
    expect(value.files.find((f) => f.status === 'failed')?.contentSha256).toBeNull()
  })

  it('accepts a typed minimal artifact with zero files', () => {
    const typed: SourceAuditEvidenceArtifact = {
      artifactKind: SOURCE_AUDIT_ARTIFACT_KIND,
      schemaVersion: SOURCE_AUDIT_SCHEMA_VERSION,
      producer: { packageName: '@dailephd/my-dev-kit', packageVersion: '1.15.0' },
      source: {
        projectRoot: '/work/p', sourceRoots: ['src'], excludes: [],
        symbolIndexSchemaVersion: '3', codeGraphSchemaVersion: '1.1.0',
        selectionFingerprint: SHA, snapshotId: SHA,
      },
      coverage: COVERAGE_ZERO,
      files: [],
    }
    expect(() => validateSourceAuditEvidence(typed)).not.toThrow()
  })
})

describe('validateSourceAuditEvidence negative cases', () => {
  it('rejects non-objects, unknown keys and wrong identifiers', () => {
    expectInvalidArtifact(null)
    expectInvalidArtifact([])
    const a = artifact()
    expectInvalidArtifact({ ...a, extra: 1 }, '$.extra')
    expectInvalidArtifact({ ...a, artifactKind: 'other' }, 'artifactKind')
    expectInvalidArtifact({ ...a, schemaVersion: '2.0.0' }, 'schemaVersion')
    expectInvalidArtifact({ ...a, producer: { ...a.producer, packageName: 'x' } }, 'packageName')
    expectInvalidArtifact({ ...a, source: { ...a.source, symbolIndexSchemaVersion: '2' } }, 'symbolIndexSchemaVersion')
    expectInvalidArtifact({ ...a, source: { ...a.source, codeGraphSchemaVersion: '1.0.0' } }, 'codeGraphSchemaVersion')
  })

  it('rejects duplicate and unordered file paths (RSP-002)', () => {
    expectInvalidArtifact(fixture('invalid-duplicate-file.json'), 'is duplicated')
    const a = artifact()
    a.files.reverse()
    expectInvalidArtifact(a, 'out of order')
  })

  it('rejects out-of-order and duplicated facts (RSP-002)', () => {
    const a = artifact()
    const facts = (a.files[0] as SourceAuditFile).facts
    facts.reverse()
    expectInvalidArtifact(a, 'out of order')
    const b = artifact()
    const first = (b.files[0] as SourceAuditFile).facts[0] as SourceAuditFact
    ;(b.files[1] as SourceAuditFile).facts[0] = { ...(b.files[1] as SourceAuditFile).facts[0] as SourceAuditFact, id: first.id }
    expectInvalidArtifact(b, 'duplicated across')
  })

  it('rejects a fact id reused by two different files via the cross-file fixture (planner 5.1)', () => {
    expectInvalidArtifact(fixture('invalid-cross-file-fact-id.json'), 'duplicated across the artifact')
  })

  it('rejects malformed and noncanonical paths (RSP-003)', () => {
    expectInvalidArtifact(fixture('invalid-path.json'), '.path')
    for (const bad of ['src\\app.ts', '/abs/app.ts', 'C:/app.ts', 'src/../app.ts', './app.ts', 'src//app.ts', 'src/app.ts/', '']) {
      const a = artifact()
      ;(a.files[1] as SourceAuditFile).path = bad
      expectInvalidArtifact(a)
    }
    const roots = artifact()
    roots.source.sourceRoots = ['../src']
    expectInvalidArtifact(roots, 'sourceRoots')
  })

  it('rejects invalid SHA-256 values (RSP-005)', () => {
    for (const bad of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), '']) {
      const a = artifact()
      ;(a.files[0] as SourceAuditFile).contentSha256 = bad
      expectInvalidArtifact(a, 'SHA-256')
    }
    const b = artifact()
    b.source.snapshotId = 'XYZ'
    expectInvalidArtifact(b, 'snapshotId')
    const c = artifact()
    b.source.selectionFingerprint = 'abc'
    expectInvalidArtifact(b, 'selectionFingerprint')
    ;((c.files[0] as SourceAuditFile).facts[2] as SourceAuditFact).valueSha256 = 'nope'
    expectInvalidArtifact(c, 'valueSha256')
  })

  it('rejects missing or unknown capability keys and statuses (RSP-005)', () => {
    const a = artifact()
    delete (a.files[0] as { capabilities: Partial<SourceAuditFile['capabilities']> }).capabilities['api-client-calls']
    expectInvalidArtifact(a, 'api-client-calls')
    const b = artifact()
    ;((b.files[0] as SourceAuditFile).capabilities as Record<string, string>)['bogus'] = 'complete'
    expectInvalidArtifact(b, 'bogus')
    const c = artifact()
    ;((c.files[0] as SourceAuditFile).capabilities as Record<string, string>).imports = 'maybe'
    expectInvalidArtifact(c, 'imports')
  })

  it('rejects invalid fact spans (RSP-005)', () => {
    const mutate = (change: (fact: SourceAuditFact) => void, fragment: string) => {
      const a = artifact()
      change((a.files[0] as SourceAuditFile).facts[0] as SourceAuditFact)
      expectInvalidArtifact(a, fragment)
    }
    mutate((f) => { f.span.startLine = 0 }, 'startLine')
    mutate((f) => { f.span.startLine = 1.5 }, 'startLine')
    mutate((f) => { f.span.startColumn = -1 }, 'startColumn')
    mutate((f) => { f.span.endLine = 0 }, 'endLine')
    mutate((f) => { f.span.endColumn = null; f.span.endLine = null; f.span.endColumn = 3 }, 'endColumn')
    mutate((f) => { f.span.path = 'src/other.ts' }, 'must match the owning file path')
    mutate((f) => { f.span.startColumn = 20; f.span.endColumn = 3 }, 'endColumn')
  })

  it('accepts nullable span columns and end ranges', () => {
    const a = artifact()
    const fact = (a.files[0] as SourceAuditFile).facts[0] as SourceAuditFact
    fact.span = { ...fact.span, startColumn: null, endLine: null, endColumn: null }
    expect(() => validateSourceAuditEvidence(a)).not.toThrow()
  })

  it('rejects incorrect literal truncation metadata (RSP-004)', () => {
    expectInvalidArtifact(fixture('invalid-literal-truncation.json'), 'valueTruncated')
    const withValue = (value: string | null, truncated: boolean | undefined, sha: boolean) => {
      const a = artifact()
      const fact = (a.files[0] as SourceAuditFile).facts[2] as SourceAuditFact
      fact.value = value
      if (truncated === undefined) delete fact.valueTruncated
      else fact.valueTruncated = truncated
      if (!sha) delete fact.valueSha256
      return a
    }
    expect(() => validateSourceAuditEvidence(withValue('x'.repeat(255), false, true))).not.toThrow()
    expect(() => validateSourceAuditEvidence(withValue('x'.repeat(256), false, true))).not.toThrow()
    expect(() => validateSourceAuditEvidence(withValue('x'.repeat(256), true, true))).not.toThrow()
    expectInvalidArtifact(withValue('x'.repeat(257), false, true), 'exceeds')
    expectInvalidArtifact(withValue('x'.repeat(257), undefined, true), 'exceeds')
    expectInvalidArtifact(withValue('x'.repeat(257), true, true), 'valueTruncated')
    expectInvalidArtifact(withValue('x'.repeat(255), true, true), 'valueTruncated')
    expectInvalidArtifact(withValue('x'.repeat(256), true, false), 'valueSha256')
    expectInvalidArtifact(withValue(null, true, true), 'valueTruncated')
  })

  it('does not accept complete capabilities for unproven files or facts for unsupported capabilities (RSP-005)', () => {
    const a = artifact('valid-partial.json')
    ;(a.files[2] as SourceAuditFile).capabilities.declarations = 'complete'
    expectInvalidArtifact(a, 'cannot be complete')
    const b = artifact('valid-partial.json')
    ;(b.files[1] as SourceAuditFile).capabilities.declarations = 'unsupported'
    expectInvalidArtifact(b, 'requires its capability')
    const c = artifact('valid-partial.json')
    ;(c.files[0] as SourceAuditFile).facts = [(c.files[1] as SourceAuditFile).facts[0] as SourceAuditFact]
    expectInvalidArtifact(c)
    const d = artifact('valid-partial.json')
    ;(d.files[2] as SourceAuditFile).facts = [literalFact(1, 'src/missing.ts')]
    expectInvalidArtifact(d, 'must be empty')
  })

  it('rejects fabricated coverage claims (RSP-006)', () => {
    const edit = (change: (c: SourceAuditEvidenceArtifact['coverage']) => void, fragment: string, name = 'valid-complete.json') => {
      const a = artifact(name)
      change(a.coverage)
      expectInvalidArtifact(a, fragment)
    }
    edit((c) => { c.recordedFileCount = 2 }, 'recordedFileCount')
    edit((c) => { c.selectedFileCount = 4 }, 'inventoryComplete')
    edit((c) => { c.unsupportedFileCount = 1 }, 'unsupportedFileCount')
    edit((c) => { c.unreadableFileCount = 1 }, 'unreadableFileCount')
    edit((c) => { c.excludedPathCount = -1 }, 'excludedPathCount')
    edit((c) => { c.unsupportedFileCount = 0 }, 'unsupportedFileCount', 'valid-partial.json')
    const a = artifact()
    a.source.excludes = []
    expectInvalidArtifact(a, 'exclusionsAreExplicit')
    // Planner 5.5: effective rules are recorded, so a default-only index may be explicit with zero excluded paths.
    const b = artifact()
    b.source.excludes = ['default-directory:node_modules', 'default-file-pattern:.d.ts']
    b.coverage.excludedPathCount = 0
    expect(() => validateSourceAuditEvidence(b)).not.toThrow()
  })

  it('enforces kind-specific fact fields', () => {
    const mutate = (change: (fact: SourceAuditFact) => void, fragment: string, index = 0) => {
      const a = artifact()
      change((a.files[0] as SourceAuditFile).facts[index] as SourceAuditFact)
      expectInvalidArtifact(a, fragment)
    }
    mutate((f) => { delete f.sourceSpecifier }, 'sourceSpecifier')
    mutate((f) => { f.importResolution = 'external' }, 'targetPaths')
    mutate((f) => { f.targetPaths = [] }, 'targetPaths')
    mutate((f) => { f.httpMethod = 'GET' }, 'httpMethod')
    mutate((f) => { delete f.symbolId }, 'symbolId', 1)
    mutate((f) => { f.visibility = 'secret' as never }, 'visibility', 1)
    mutate((f) => { f.extractionMethod = 'magic' as never }, 'extractionMethod', 1)
    mutate((f) => { f.httpMethod = 'TRACE' as never }, 'httpMethod', 3)
    mutate((f) => { f.kind = 'mystery' as never }, 'kind', 3)
    mutate((f) => { delete f.exportOrigin }, 'exportOrigin', 4)
  })
})

describe('source-audit page validation (RSP-007)', () => {
  it('accepts inventory pages at the 0/1/63/64/65/130 item boundaries', () => {
    for (const total of [0, 1, 63, 64, 65, 130]) {
      const pages = Math.max(1, Math.ceil(total / AUDIT_INVENTORY_PAGE_SIZE))
      for (let index = 0; index < pages; index++) {
        const page = inventoryPage(total, index)
        expect(() => validateSourceAuditInventoryPage(page)).not.toThrow()
        expect(page.nextPageIndex === null).toBe(index === pages - 1)
      }
    }
    const empty = inventoryPage(0, 0)
    expect(empty.totalPages).toBe(1)
    expect(empty.nextPageIndex).toBeNull()
    expect(empty.files).toHaveLength(0)
  })

  it('accepts file pages at the 0/1/127/128/129/300 fact boundaries', () => {
    for (const total of [0, 1, 127, 128, 129, 300]) {
      const pages = Math.max(1, Math.ceil(total / AUDIT_FACT_PAGE_SIZE))
      for (let index = 0; index < pages; index++) {
        const page = filePage(total, index)
        expect(() => validateSourceAuditFilePage(page)).not.toThrow()
        expect(page.nextPageIndex === null).toBe(index === pages - 1)
      }
    }
  })

  it('rejects inconsistent inventory envelopes', () => {
    const base = inventoryPage(130, 1)
    expectInvalidInventory({ ...base, totalPages: 2 }, 'totalPages')
    expectInvalidInventory({ ...base, nextPageIndex: null }, 'nextPageIndex')
    expectInvalidInventory({ ...base, pageIndex: 3, nextPageIndex: null }, 'pageIndex')
    expectInvalidInventory({ ...base, pageSize: 32 }, 'pageSize')
    expectInvalidInventory({ ...base, totalItems: 129 }, 'totalItems')
    expectInvalidInventory({ ...base, files: base.files.slice(1) }, 'items for this page')
    expectInvalidInventory({ ...base, mode: 'audit-file' }, 'mode')
    expectInvalidInventory({ ...base, snapshotId: 'x' }, 'snapshotId')
    expectInvalidInventory({ ...base, files: [...base.files].reverse() }, 'out of order')
    const terminal = inventoryPage(130, 2)
    expectInvalidInventory({ ...terminal, nextPageIndex: 3 }, 'nextPageIndex')
    expectInvalidInventory({ ...base, files: base.files.map((f) => ({ ...f, facts: [] })) }, 'facts')
  })

  it('rejects inconsistent file-page envelopes', () => {
    const base = filePage(300, 1)
    expectInvalidFilePage({ ...base, pageSize: 64 }, 'pageSize')
    expectInvalidFilePage({ ...base, totalPages: 4 }, 'totalPages')
    expectInvalidFilePage({ ...base, nextPageIndex: null }, 'nextPageIndex')
    expectInvalidFilePage({ ...base, facts: base.facts.slice(1) }, 'items for this page')
    expectInvalidFilePage({ ...base, file: null }, 'file')
    const wrongPath = clone(base)
    ;(wrongPath.facts[0] as SourceAuditFact).span.path = 'src/other.ts'
    expectInvalidFilePage(wrongPath, 'owning file path')
    expectInvalidFilePage({ ...base, facts: [...base.facts].reverse() }, 'out of order')
  })

  it('defines not-selected results as a single empty terminal page', () => {
    const notSelected: SourceAuditFilePage = {
      schemaVersion: '1.0.0', snapshotId: SHA, pageIndex: 0, pageSize: AUDIT_FACT_PAGE_SIZE,
      totalItems: 0, totalPages: 1, nextPageIndex: null, mode: 'audit-file', status: 'not-selected', file: null, facts: [],
    }
    expect(() => validateSourceAuditFilePage(notSelected)).not.toThrow()
    expectInvalidFilePage({ ...notSelected, file: { ...summary('src/a.ts'), diagnostics: [] } }, 'file')
    expectInvalidFilePage({ ...notSelected, facts: [literalFact(1, 'src/a.ts')] }, 'facts')
    expectInvalidFilePage({ ...notSelected, totalItems: 1, totalPages: 1 }, 'totalItems')
    expectInvalidFilePage({ ...notSelected, pageIndex: 1 }, 'pageIndex')
    expectInvalidFilePage({ ...notSelected, nextPageIndex: 1, totalPages: 2 }, 'totalPages')
  })

  it('keeps one snapshot identity per page and rejects bad schema versions', () => {
    const page = inventoryPage(65, 0)
    expect(page.snapshotId).toBe(inventoryPage(65, 1).snapshotId)
    expectInvalidInventory({ ...page, schemaVersion: '2.0.0' }, 'schemaVersion')
  })
})
