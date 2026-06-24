import { describe, expect, it } from 'vitest'
import { buildReachabilitySearchResult } from '../../src/frontend-reachability/index.js'
import { resolveReachabilityMode } from '../../src/frontend-reachability/index.js'
import { buildConsumerFixture } from '../frontend-reachability/consumerFixture.js'

describe('search reachability consumer', () => {
  it('returns route fact and related edges for --route', () => {
    const artifact = buildConsumerFixture()
    const result = buildReachabilitySearchResult(artifact, 'route', '/dashboard')
    expect(result.status).toBe('ok')
    expect(result.mode).toBe('route')
    expect(result.results.some((r) => r.id === 'route:/dashboard')).toBe(true)
    expect(result.summary.resultCount).toBe(1)
    expect(result.summary.edgeCount).toBeGreaterThanOrEqual(1)
    expect(result.relatedEdges.some((e) => e.kind === 'route-serves-component')).toBe(true)
  })

  it('matches storage keys by substring for --storage-key', () => {
    const artifact = buildConsumerFixture()
    const result = buildReachabilitySearchResult(artifact, 'storage-key', 'auth')
    expect(result.results.some((r) => r.label === 'localStorage:auth_token')).toBe(true)
    expect(result.results[0].factKind).toBe('storage-key')
  })

  it('matches UI markers by value for --ui', () => {
    const artifact = buildConsumerFixture()
    const result = buildReachabilitySearchResult(artifact, 'ui', 'dashboard-panel')
    expect(result.results.some((r) => r.id === 'ui:data-testid:dashboard-panel')).toBe(true)
    expect(result.relatedEdges.some((e) => e.kind === 'component-renders-ui')).toBe(true)
  })

  it('matches UI markers by markerKind', () => {
    const artifact = buildConsumerFixture()
    const result = buildReachabilitySearchResult(artifact, 'ui', 'data-testid')
    expect(result.summary.resultCount).toBe(1)
  })

  it('returns missing-artifact status when artifact is null', () => {
    const result = buildReachabilitySearchResult(null, 'route', '/dashboard')
    expect(result.status).toBe('missing-artifact')
    expect(result.results).toEqual([])
    expect(result.warnings[0]).toContain('not found')
  })

  it('returns empty results for an unknown query', () => {
    const artifact = buildConsumerFixture()
    const result = buildReachabilitySearchResult(artifact, 'route', '/does-not-exist')
    expect(result.status).toBe('ok')
    expect(result.summary.resultCount).toBe(0)
  })

  it('rejects combining --route with --storage-key', () => {
    expect(() => resolveReachabilityMode({ route: '/x', storageKey: 'y' })).toThrow(/mutually exclusive/)
  })

  it('returns null mode when no reachability flags are present', () => {
    expect(resolveReachabilityMode({})).toBeNull()
  })
})
