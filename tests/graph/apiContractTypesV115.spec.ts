import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  API_CLIENT_KINDS,
  API_CONTRACT_EDGE_KINDS,
  API_CONTRACT_NODE_KINDS,
  API_HTTP_METHODS,
  API_RESOLUTION_STATUSES,
} from '../../src/graph/apiContractTypes.js'
import type {
  ApiClientCallEvidence,
  ApiContractEdgeKind,
  ApiContractNodeKind,
  ApiResolutionStatus,
  ApiUnresolvedEvidence,
} from '../../src/graph/apiContractTypes.js'
import {
  validateApiClientCallEvidence,
  validateApiUnresolvedEvidence,
} from '../../src/graph/validateApiContractEvidence.js'

const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'v115-api-contract')
const PREFIX = /^INVALID_API_CONTRACT_EVIDENCE: /

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as Record<string, unknown>
}

function resolvedCall(): ApiClientCallEvidence {
  const value = fixture('valid-client-call.json')
  validateApiClientCallEvidence(value)
  return JSON.parse(JSON.stringify(value)) as ApiClientCallEvidence
}

function expectInvalidCall(value: unknown, fragment?: string): void {
  expect(() => validateApiClientCallEvidence(value)).toThrow(PREFIX)
  if (fragment) expect(() => validateApiClientCallEvidence(value)).toThrow(fragment)
}

function expectInvalidUnresolved(value: unknown, fragment?: string): void {
  expect(() => validateApiUnresolvedEvidence(value)).toThrow(PREFIX)
  if (fragment) expect(() => validateApiUnresolvedEvidence(value)).toThrow(fragment)
}

describe('v1.15.0 API relationship contract constants', () => {
  it('freezes the node kinds, edge kinds, statuses, methods and clients', () => {
    expect([...API_CONTRACT_NODE_KINDS]).toEqual(['api-client-call', 'api-data-entity-ref', 'api-data-field-ref'])
    expect([...API_CONTRACT_EDGE_KINDS]).toEqual([
      'api-call-originates-in-component',
      'api-call-targets-route',
      'api-handler-references-schema',
      'api-handler-uses-data-entity',
      'api-schema-maps-data-entity',
      'api-entity-has-field',
    ])
    expect([...API_RESOLUTION_STATUSES]).toEqual([
      'resolved-static', 'ambiguous', 'dynamic', 'external', 'outside-selected-roots', 'unsupported',
    ])
    expect([...API_HTTP_METHODS]).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'UNKNOWN'])
    expect([...API_CLIENT_KINDS]).toEqual(['fetch', 'axios'])
  })

  it('keeps the new kind unions distinct from existing CodeGraph kinds', async () => {
    const nodeKind: ApiContractNodeKind = 'api-client-call'
    const edgeKind: ApiContractEdgeKind = 'api-entity-has-field'
    expect(nodeKind).toBe('api-client-call')
    expect(edgeKind).toBe('api-entity-has-field')
    const source = readFileSync(join(process.cwd(), 'src', 'graph', 'codeGraphTypes.ts'), 'utf8')
    for (const kind of [...API_CONTRACT_NODE_KINDS, ...API_CONTRACT_EDGE_KINDS]) {
      expect(source).not.toContain(`'${kind}'`)
    }
  })
})

describe('validateApiClientCallEvidence', () => {
  it('accepts a resolved-static call (RSP-008)', () => {
    const value = fixture('valid-client-call.json')
    expect(() => validateApiClientCallEvidence(value)).not.toThrow()
    const typed: ApiClientCallEvidence = resolvedCall()
    expect(typed.resolutionStatus satisfies ApiResolutionStatus).toBe('resolved-static')
  })

  it('accepts a dynamic call that is explicitly unresolved (RSP-008)', () => {
    const { call } = fixture('valid-unresolved-call.json')
    expect(() => validateApiClientCallEvidence(call)).not.toThrow()
    expect((call as ApiClientCallEvidence).staticPath).toBeNull()
  })

  it('rejects a dynamic call fabricated as resolved-static (RSP-008)', () => {
    expectInvalidCall(fixture('invalid-fabricated-resolution.json'), 'staticPath')
    expectInvalidCall({ ...resolvedCall(), staticPath: null }, 'staticPath')
    expectInvalidCall({ ...resolvedCall(), method: 'UNKNOWN' }, 'method')
    expectInvalidCall({ ...resolvedCall(), staticPath: 'api/items' }, 'staticPath')
    expectInvalidCall({ ...resolvedCall(), resolutionStatus: 'dynamic' }, 'staticPath')
  })

  it('keeps an exactly established static path for unsupported, external, ambiguous and outside-root calls but never for dynamic (planner 5.2)', () => {
    for (const status of ['unsupported', 'external', 'ambiguous', 'outside-selected-roots'] as const) {
      expect(() => validateApiClientCallEvidence({ ...resolvedCall(), resolutionStatus: status })).not.toThrow()
    }
    expectInvalidCall({ ...resolvedCall(), resolutionStatus: 'dynamic' }, 'dynamic')
    expectInvalidCall({ ...resolvedCall(), method: 'UNKNOWN' }, 'method')
  })

  it('accepts other unresolved statuses without a static path', () => {
    for (const status of ['ambiguous', 'external', 'outside-selected-roots', 'dynamic', 'unsupported'] as const) {
      expect(() => validateApiClientCallEvidence({ ...resolvedCall(), resolutionStatus: status, staticPath: null })).not.toThrow()
    }
  })

  it('rejects invalid source references (RSP-008)', () => {
    for (const bad of ['', '/abs/a.ts', 'C:/a.ts', 'src\\a.ts', '../a.ts', 'src/./a.ts', 'src//a.ts', 'src/a.ts/']) {
      expectInvalidCall({ ...resolvedCall(), filePath: bad }, 'filePath')
    }
    expectInvalidCall({ ...resolvedCall(), startLine: 0 }, 'startLine')
    expectInvalidCall({ ...resolvedCall(), startLine: 1.5 }, 'startLine')
    expectInvalidCall({ ...resolvedCall(), startColumn: -1 }, 'startColumn')
    expect(() => validateApiClientCallEvidence({ ...resolvedCall(), startColumn: 0 })).not.toThrow()
  })

  it('rejects missing identity, unknown enums, unknown keys and non-objects (RSP-008)', () => {
    const { sourceFactId: _omit, ...withoutFact } = resolvedCall()
    expectInvalidCall(withoutFact, 'sourceFactId')
    expectInvalidCall({ ...resolvedCall(), sourceFactId: '' }, 'sourceFactId')
    expectInvalidCall({ ...resolvedCall(), id: '' }, 'id')
    expectInvalidCall({ ...resolvedCall(), owningSymbolId: '' }, 'owningSymbolId')
    expectInvalidCall({ ...resolvedCall(), method: 'TRACE' }, 'method')
    expectInvalidCall({ ...resolvedCall(), clientKind: 'xhr' }, 'clientKind')
    expectInvalidCall({ ...resolvedCall(), resolutionStatus: 'guessed' }, 'resolutionStatus')
    expectInvalidCall({ ...resolvedCall(), observedUrl: 'x'.repeat(5000) }, 'observedUrl')
    expectInvalidCall({ ...resolvedCall(), extra: true }, 'extra')
    expectInvalidCall(null)
    expectInvalidCall('call')
    expect(() => validateApiClientCallEvidence({ ...resolvedCall(), owningSymbolId: null })).not.toThrow()
  })
})

describe('validateApiUnresolvedEvidence', () => {
  it('accepts the dynamic unresolved fixture (RSP-008)', () => {
    const { unresolved } = fixture('valid-unresolved-call.json')
    expect(() => validateApiUnresolvedEvidence(unresolved)).not.toThrow()
    const typed: ApiUnresolvedEvidence = unresolved as ApiUnresolvedEvidence
    expect(typed.candidateNodeIds).toEqual([])
    expect(typed.sourceFactIds.length).toBeGreaterThan(0)
  })

  it('never describes a resolved-static state (RSP-008)', () => {
    const { unresolved } = fixture('valid-unresolved-call.json')
    expectInvalidUnresolved({ ...(unresolved as object), status: 'resolved-static' }, 'status')
    expectInvalidUnresolved({ ...(unresolved as object), status: 'mystery' }, 'status')
  })

  it('enforces candidate and source fact invariants (RSP-008)', () => {
    const base = { subjectId: 'api-client-call:src/a.ts:1:0', status: 'ambiguous', reasonCode: 'multiple-routes', candidateNodeIds: ['n1', 'n2'], sourceFactIds: ['f1'] }
    expect(() => validateApiUnresolvedEvidence(base)).not.toThrow()
    expectInvalidUnresolved({ ...base, candidateNodeIds: ['n1', 'n1'] }, 'duplicated')
    expectInvalidUnresolved({ ...base, sourceFactIds: ['f1', 'f1'] }, 'duplicated')
    expectInvalidUnresolved({ ...base, status: 'unsupported', candidateNodeIds: ['n1'] }, 'candidateNodeIds')
    expectInvalidUnresolved({ ...base, status: 'dynamic', candidateNodeIds: ['n1', 'n2'] }, 'candidateNodeIds')
    expectInvalidUnresolved({ ...base, reasonCode: 'Not Kebab' }, 'reasonCode')
    expectInvalidUnresolved({ ...base, subjectId: '' }, 'subjectId')
    expectInvalidUnresolved({ ...base, extra: 1 }, 'extra')
    expectInvalidUnresolved([])
    expect(() => validateApiUnresolvedEvidence({ ...base, status: 'external', candidateNodeIds: [] })).not.toThrow()
  })

  it('does not require fabricated candidates or source facts (planner 5.3, 5.4)', () => {
    const base = { subjectId: 'api-client-call:src/a.ts:1:0', status: 'ambiguous', reasonCode: 'multiple-routes', candidateNodeIds: [] as string[], sourceFactIds: [] as string[] }
    expect(() => validateApiUnresolvedEvidence(base)).not.toThrow()
    expect(() => validateApiUnresolvedEvidence({ ...base, candidateNodeIds: ['n1'] })).not.toThrow()
    expectInvalidUnresolved({ ...base, candidateNodeIds: ['n1', 'n1'] }, 'duplicated')
    expectInvalidUnresolved({ ...base, sourceFactIds: ['f1', 'f1'] }, 'duplicated')
    expectInvalidUnresolved({ ...base, subjectId: '' }, 'subjectId')
    expectInvalidUnresolved({ ...base, reasonCode: '' }, 'reasonCode')
    expectInvalidUnresolved({ ...base, candidateNodeIds: 'n1' }, 'candidateNodeIds')
  })
})
