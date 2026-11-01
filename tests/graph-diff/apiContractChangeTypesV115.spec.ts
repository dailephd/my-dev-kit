import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateApiContractChangeSection } from '../../src/graph/validateApiContractEvidence.js'
import { GRAPH_DIFF_REPORT_KIND, MAX_API_CONTRACT_CHANGES } from '../../src/graph-diff/types.js'
import type {
  ApiContractChange,
  ApiContractChangeSection,
  GraphDiffResult,
} from '../../src/graph-diff/types.js'

const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'v115-api-contract')
const PREFIX = /^INVALID_API_CONTRACT_EVIDENCE: /

function fixture(name: string): ApiContractChangeSection {
  const value: unknown = JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'))
  return value as ApiContractChangeSection
}

function section(overrides: Partial<ApiContractChangeSection> = {}): ApiContractChangeSection {
  const changes = overrides.changes ?? []
  return {
    available: 'both',
    complete: true,
    totalChanges: changes.length,
    returnedChanges: changes.length,
    omittedChanges: 0,
    changes,
    warnings: [],
    ...overrides,
  }
}

function change(index: number): ApiContractChange {
  return {
    kind: 'relationship',
    change: 'changed',
    subjectId: `rel:${index}`,
    affectedNodeIds: [`n:${index}`],
    sourceRefs: [{ filePath: 'src/a.ts', line: 1, endLine: 2 }],
    certainty: 'partial',
  }
}

function expectInvalid(value: unknown, fragment?: string): void {
  expect(() => validateApiContractChangeSection(value)).toThrow(PREFIX)
  if (fragment) expect(() => validateApiContractChangeSection(value)).toThrow(fragment)
}

function baseResult(): GraphDiffResult {
  const empty = { added: [], removed: [], changed: [] }
  return {
    reportKind: GRAPH_DIFF_REPORT_KIND,
    before: { indexDir: 'b', projectRoot: '/p' },
    after: { indexDir: 'a', projectRoot: '/p' },
    summary: {
      nodesAdded: 0, nodesRemoved: 0, nodesChanged: 0, edgesAdded: 0, edgesRemoved: 0, edgesChanged: 0,
      filesAdded: 0, filesRemoved: 0, filesChanged: 0, symbolsAdded: 0, symbolsRemoved: 0, symbolsChanged: 0,
    },
    nodes: empty,
    edges: empty,
    symbolIndex: { available: true, filesAdded: [], filesRemoved: [], filesChanged: [], symbolsAdded: [], symbolsRemoved: [], symbolsChanged: [] },
    manifest: { schemaVersionMatch: true, changedFields: [], analyzerChanges: [] },
    classification: { available: 'both', added: [], removed: [], changed: [] },
    semanticArtifacts: {
      dataModel: { available: 'neither', changedFields: [] },
      frontendSemantic: { available: 'neither', changedFields: [] },
      frontendReachability: { available: 'neither', changedFields: [] },
    },
    warnings: [],
  }
}

describe('ApiContractChangeSection contract (RSP-009)', () => {
  it('freezes the 200-change result cap', () => {
    expect(MAX_API_CONTRACT_CHANGES).toBe(200)
  })

  it('accepts the canonical contract-change fixture', () => {
    const value = fixture('valid-contract-change.json')
    expect(() => validateApiContractChangeSection(value)).not.toThrow()
    expect(value.changes.map((c) => c.change)).toEqual(['added', 'unresolved'])
    expect(value.changes[1]?.certainty).not.toBe('explicit-static')
  })

  it('rejects the inconsistent-count fixture', () => {
    expectInvalid(fixture('invalid-contract-change-count.json'), 'omittedChanges')
  })

  it('enforces count arithmetic and the cap at 199/200/201 changes', () => {
    for (const count of [0, 199, 200]) {
      const changes = Array.from({ length: count }, (_, i) => change(i))
      expect(() => validateApiContractChangeSection(section({ changes }))).not.toThrow()
    }
    const over = Array.from({ length: 201 }, (_, i) => change(i))
    expectInvalid(section({ changes: over, totalChanges: 201, returnedChanges: 201 }), 'must not exceed 200')

    const capped = Array.from({ length: 200 }, (_, i) => change(i))
    const truncated = section({ changes: capped, totalChanges: 250, returnedChanges: 200, omittedChanges: 50, complete: false })
    expect(() => validateApiContractChangeSection(truncated)).not.toThrow()
    expectInvalid({ ...truncated, complete: true }, 'complete')
    expectInvalid({ ...truncated, omittedChanges: 49 }, 'omittedChanges')
    expectInvalid({ ...truncated, returnedChanges: 199 }, 'returnedChanges')
    expectInvalid({ ...truncated, totalChanges: 100 }, 'returnedChanges')
  })

  it('does not claim completeness for one-sided or missing artifacts', () => {
    for (const available of ['before-only', 'after-only', 'neither'] as const) {
      expectInvalid(section({ available, complete: true }), 'complete')
      expect(() => validateApiContractChangeSection(section({ available, complete: false }))).not.toThrow()
    }
    expectInvalid(section({ available: 'sideways' as never }), 'available')
  })

  it('rejects invalid change entries and source references', () => {
    const entry = change(1)
    const wrap = (c: unknown) => ({ ...section(), totalChanges: 1, returnedChanges: 1, changes: [c] })
    expectInvalid(wrap({ ...entry, kind: 'other' }), 'kind')
    expectInvalid(wrap({ ...entry, change: 'moved' }), 'change')
    expectInvalid(wrap({ ...entry, certainty: 'certain' }), 'certainty')
    expectInvalid(wrap({ ...entry, subjectId: '' }), 'subjectId')
    expectInvalid(wrap({ ...entry, affectedNodeIds: ['a', 'a'] }), 'duplicated')
    expectInvalid(wrap({ ...entry, extra: 1 }), 'extra')
    expectInvalid(wrap({ ...entry, change: 'unresolved', certainty: 'explicit-static' }), 'certainty')
    const bad = (ref: unknown) => wrap({ ...entry, sourceRefs: [ref] })
    expectInvalid(bad({ filePath: '../x.ts', line: 1, endLine: 1 }), 'filePath')
    expectInvalid(bad({ filePath: 'src/a.ts', line: 0, endLine: 1 }), 'line')
    expectInvalid(bad({ filePath: 'src/a.ts', line: 5, endLine: 4 }), 'endLine')
    expectInvalid(bad({ filePath: 'src/a.ts', line: 1, endLine: 1, column: -1 }), 'column')
    expectInvalid(bad({ filePath: 'src/a.ts', line: 1 }), 'endLine')
    expectInvalid(bad({ filePath: 'src/a.ts', line: 1, endLine: 1, bogus: true }), 'bogus')
    expect(() => validateApiContractChangeSection(bad({ filePath: 'src/a.ts', line: 1, endLine: 1, column: null, symbolId: 'symbol:src/a.ts#f' }))).not.toThrow()
    expectInvalid(null)
  })
})

describe('GraphDiffResult compatibility (RSP-009)', () => {
  it('still compiles and holds without apiContractChanges', () => {
    const result: GraphDiffResult = baseResult()
    expect(result.apiContractChanges).toBeUndefined()
    expect(Object.keys(result)).not.toContain('apiContractChanges')
  })

  it('accepts the optional section additively without changing other fields', () => {
    const plain = baseResult()
    const extended: GraphDiffResult = { ...plain, apiContractChanges: fixture('valid-contract-change.json') }
    const { apiContractChanges, ...rest } = extended
    expect(rest).toEqual(plain)
    expect(() => validateApiContractChangeSection(apiContractChanges)).not.toThrow()
  })
})
