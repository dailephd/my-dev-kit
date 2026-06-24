import { describe, expect, it } from 'vitest'
import { buildReachabilitySliceResult } from '../../src/frontend-reachability/index.js'
import { buildConsumerFixture } from '../frontend-reachability/consumerFixture.js'

describe('slice reachability consumer', () => {
  it('builds a depth-1 route slice with the route fact', () => {
    const artifact = buildConsumerFixture()
    const result = buildReachabilitySliceResult(artifact, 'route', '/dashboard', {})
    expect(result.status).toBe('ok')
    expect(result.facts.routes.some((r) => r.path === '/dashboard')).toBe(true)
    // Without --include-storage / --include-ui, neighbor facts are suppressed.
    expect(result.facts.storageKeys).toEqual([])
    expect(result.facts.uiReachability).toEqual([])
    expect(result.summary.edgeCount).toBeGreaterThanOrEqual(1)
  })

  it('includes storage facts with --include-storage', () => {
    const artifact = buildConsumerFixture()
    const result = buildReachabilitySliceResult(artifact, 'route', '/dashboard', { includeStorage: true })
    expect(result.facts.storageKeys.some((s) => s.key === 'auth_token')).toBe(true)
  })

  it('includes UI facts and test evidence with --include-ui --include-tests', () => {
    const artifact = buildConsumerFixture()
    const result = buildReachabilitySliceResult(artifact, 'route', '/dashboard', {
      includeUi: true,
      includeTests: true,
    })
    expect(result.facts.uiReachability.some((u) => u.value === 'dashboard-panel')).toBe(true)
    expect(result.testEvidence.length).toBeGreaterThanOrEqual(1)
    expect(result.testEvidence[0].testBlockTitle).toBe('shows dashboard panel')
  })

  it('builds a depth-2 storage-key slice that reaches the gated UI marker', () => {
    const artifact = buildConsumerFixture()
    const result = buildReachabilitySliceResult(artifact, 'storage-key', 'auth_token', {})
    expect(result.facts.storageKeys.some((s) => s.key === 'auth_token')).toBe(true)
    expect(result.facts.uiReachability.some((u) => u.value === 'dashboard-panel')).toBe(true)
  })

  it('builds a UI slice that reaches route and storage neighbors', () => {
    const artifact = buildConsumerFixture()
    const result = buildReachabilitySliceResult(artifact, 'ui', 'dashboard-panel', {})
    expect(result.facts.uiReachability.some((u) => u.value === 'dashboard-panel')).toBe(true)
    expect(result.facts.routes.some((r) => r.path === '/dashboard')).toBe(true)
    expect(result.facts.storageKeys.some((s) => s.key === 'auth_token')).toBe(true)
  })

  it('returns not-found for an unknown root', () => {
    const artifact = buildConsumerFixture()
    const result = buildReachabilitySliceResult(artifact, 'route', '/nope', {})
    expect(result.status).toBe('not-found')
  })

  it('returns missing-artifact when the artifact is absent', () => {
    const result = buildReachabilitySliceResult(null, 'route', '/dashboard', {})
    expect(result.status).toBe('missing-artifact')
  })
})
