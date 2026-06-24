import { afterEach, describe, expect, it } from 'vitest'
import {
  FRONTEND_REACHABILITY_ARTIFACT_KIND,
  runFrontendReachabilityAnalyzer,
} from '../../src/frontend-reachability/index.js'
import { buildFrontendFixture, cleanupReachabilityTempDirs } from './reachabilityTestHelpers.js'

afterEach(() => cleanupReachabilityTempDirs())

function buildIntegratedFixture() {
  return buildFrontendFixture([
    {
      path: 'src/DashboardPage.tsx',
      content: `import { useState } from 'react'
export function DashboardPage() {
  const [isLoggedIn] = useState(false)
  const token = localStorage.getItem('auth_token')
  return (
    <div>
      <a href="/dashboard" data-testid="dashboard-link">Dashboard</a>
      {isLoggedIn ? <div data-testid="dashboard-panel">{token}</div> : null}
    </div>
  )
}
`,
    },
    {
      path: 'src/dashboard.spec.ts',
      content: `import { test } from '@playwright/test'
test('shows dashboard panel', async ({ page }) => {
  await page.goto('/dashboard')
  await page.getByTestId('dashboard-panel').click()
})
`,
    },
  ])
}

describe('runFrontendReachabilityAnalyzer (integrated)', () => {
  it('produces a complete cross-domain artifact', () => {
    const { repoRoot, artifact: frontendArtifact } = buildIntegratedFixture()
    const { artifact } = runFrontendReachabilityAnalyzer({
      frontendArtifact,
      repoRoot,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    expect(artifact.artifactKind).toBe(FRONTEND_REACHABILITY_ARTIFACT_KIND)
    expect(artifact.routes.some((r) => r.path === '/dashboard')).toBe(true)
    expect(artifact.storageKeys.some((s) => s.key === 'auth_token')).toBe(true)
    expect(artifact.uiReachability.some((u) => u.value === 'dashboard-panel')).toBe(true)
    expect(artifact.stats.routeCount).toBe(artifact.routes.length)
    expect(artifact.stats.edgeCount).toBe(artifact.edges.length)
  })

  it('builds route-serves-component and component-renders-ui edges', () => {
    const { repoRoot, artifact: frontendArtifact } = buildIntegratedFixture()
    const { artifact } = runFrontendReachabilityAnalyzer({
      frontendArtifact,
      repoRoot,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const route = artifact.routes.find((r) => r.path === '/dashboard')
    expect(route?.componentIds.length).toBeGreaterThanOrEqual(1)
    const componentId = route!.componentIds[0]

    expect(
      artifact.edges.some((e) => e.kind === 'route-serves-component' && e.source === route!.id && e.target === componentId)
    ).toBe(true)
    expect(artifact.edges.some((e) => e.kind === 'component-renders-ui' && e.source === componentId)).toBe(true)
  })

  it('builds a transitive route-reaches-ui edge and populates gateRouteIds', () => {
    const { repoRoot, artifact: frontendArtifact } = buildIntegratedFixture()
    const { artifact } = runFrontendReachabilityAnalyzer({
      frontendArtifact,
      repoRoot,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const route = artifact.routes.find((r) => r.path === '/dashboard')!
    const panel = artifact.uiReachability.find((u) => u.value === 'dashboard-panel')
    expect(panel).toBeDefined()
    expect(
      artifact.edges.some((e) => e.kind === 'route-reaches-ui' && e.source === route.id && e.target === panel!.id)
    ).toBe(true)
    expect(panel!.gateRouteIds).toContain(route.id)
  })

  it('builds component-uses-storage edges', () => {
    const { repoRoot, artifact: frontendArtifact } = buildIntegratedFixture()
    const { artifact } = runFrontendReachabilityAnalyzer({
      frontendArtifact,
      repoRoot,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const storage = artifact.storageKeys.find((s) => s.key === 'auth_token')!
    expect(artifact.edges.some((e) => e.kind === 'component-uses-storage' && e.target === storage.id)).toBe(true)
  })

  it('links test evidence and builds a test-covers-ui edge', () => {
    const { repoRoot, artifact: frontendArtifact } = buildIntegratedFixture()
    const { artifact } = runFrontendReachabilityAnalyzer({
      frontendArtifact,
      repoRoot,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const panel = artifact.uiReachability.find((u) => u.value === 'dashboard-panel')!
    expect(panel.testEvidenceRefs.length).toBeGreaterThanOrEqual(1)
    expect(panel.testEvidenceRefs[0].testBlockTitle).toBe('shows dashboard panel')
    expect(artifact.edges.some((e) => e.kind === 'test-covers-ui' && e.target === panel.id)).toBe(true)
  })

  it('produces an empty (but valid) artifact when there are no frontend files', () => {
    const { repoRoot, artifact: frontendArtifact } = buildFrontendFixture([])
    const { artifact, warningCount, errorCount } = runFrontendReachabilityAnalyzer({
      frontendArtifact,
      repoRoot,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(artifact.routes).toEqual([])
    expect(artifact.storageKeys).toEqual([])
    expect(artifact.uiReachability).toEqual([])
    expect(artifact.edges).toEqual([])
    expect(warningCount).toBe(0)
    expect(errorCount).toBe(0)
  })
})
