import { describe, expect, it } from 'vitest'
import { buildReachabilityLookupResult } from '../../src/frontend-reachability/index.js'
import { buildConsumerFixture } from '../frontend-reachability/consumerFixture.js'
import type { RouteFact } from '../../src/frontend-reachability/index.js'

describe('lookup reachability consumer', () => {
  it('returns the matching route fact and depth-1 neighbors', () => {
    const artifact = buildConsumerFixture()
    const result = buildReachabilityLookupResult(artifact, 'route', '/dashboard')
    expect(result.status).toBe('found')
    expect(result.facts).toHaveLength(1)
    expect((result.facts[0] as RouteFact).path).toBe('/dashboard')
    expect(result.summary.edgeCount).toBeGreaterThanOrEqual(1)
    expect(result.relatedEdges.some((e) => e.source === 'route:/dashboard')).toBe(true)
  })

  it('looks up a storage key fact and its edges', () => {
    const artifact = buildConsumerFixture()
    const result = buildReachabilityLookupResult(artifact, 'storage-key', 'auth_token')
    expect(result.status).toBe('found')
    expect(result.facts[0].id).toBe('storage:localStorage:auth_token')
    expect(result.relatedEdges.some((e) => e.kind === 'component-uses-storage')).toBe(true)
  })

  it('looks up a UI marker fact and may match multiple', () => {
    const artifact = buildConsumerFixture()
    const result = buildReachabilityLookupResult(artifact, 'ui', 'dashboard-panel')
    expect(result.status).toBe('found')
    expect(result.facts[0].id).toBe('ui:data-testid:dashboard-panel')
    expect(result.relatedEdges.some((e) => e.kind === 'storage-gates-ui')).toBe(true)
  })

  it('returns not-found for an unknown route', () => {
    const artifact = buildConsumerFixture()
    const result = buildReachabilityLookupResult(artifact, 'route', '/nope')
    expect(result.status).toBe('not-found')
    expect(result.facts).toEqual([])
    expect(result.warnings[0]).toContain('No route fact')
  })

  it('returns missing-artifact when the artifact is absent', () => {
    const result = buildReachabilityLookupResult(null, 'ui', 'dashboard-panel')
    expect(result.status).toBe('missing-artifact')
  })
})
