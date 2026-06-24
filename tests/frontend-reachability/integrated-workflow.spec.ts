/**
 * Integrated workflow tests for v1.3.0 frontend reachability.
 *
 * These validate the full assembled pipeline: producers (route/storage/UI) ->
 * cross-domain edge builder -> assembled FrontendReachabilityArtifact. They are
 * deliberately broader than integrated.spec.ts (which asserts individual edge
 * kinds); this file asserts the *whole* artifact shape, the cross-domain edge
 * set, the static-confidence boundary, and the documented warning vocabulary.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  FRONTEND_REACHABILITY_ARTIFACT_KIND,
  FRONTEND_REACHABILITY_SCHEMA_VERSION,
  runFrontendReachabilityAnalyzer,
  type ReachabilityConfidence,
  type ReachabilityEdgeKind,
  type ReachabilityWarningKind,
} from '../../src/frontend-reachability/index.js'
import { buildFrontendFixture, cleanupReachabilityTempDirs } from './reachabilityTestHelpers.js'

afterEach(() => cleanupReachabilityTempDirs())

/**
 * A cross-domain fixture: one component owns a route, a storage key tied to a
 * useState gate, and a gated UI marker; a test file provides locator evidence.
 */
function buildWorkflowFixture() {
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

const VALID_CONFIDENCE: ReadonlySet<ReachabilityConfidence> = new Set(['high', 'medium', 'low'])

const VALID_EDGE_KINDS: ReadonlySet<ReachabilityEdgeKind> = new Set([
  'route-serves-component',
  'component-uses-storage',
  'component-renders-ui',
  'storage-gates-ui',
  'route-reaches-ui',
  'test-covers-ui',
  'ui-in-gated-region',
])

const VALID_WARNING_KINDS: ReadonlySet<ReachabilityWarningKind> = new Set([
  'dynamic-route',
  'dynamic-storage-key',
  'dynamic-condition',
  'missing-test-evidence',
  'ambiguous-component-ownership',
  'missing-frontend-semantic',
  'truncated-value',
  'partial-extraction',
  'unsupported-pattern',
])

function analyzeWorkflow() {
  const { repoRoot, artifact: frontendArtifact } = buildWorkflowFixture()
  return runFrontendReachabilityAnalyzer({
    frontendArtifact,
    repoRoot,
    createdAt: '2026-01-01T00:00:00.000Z',
  })
}

describe('frontend reachability integrated workflow (producers -> artifact -> consumers)', () => {
  it('assembles a complete, well-formed artifact', () => {
    const { artifact } = analyzeWorkflow()

    expect(artifact.artifactKind).toBe(FRONTEND_REACHABILITY_ARTIFACT_KIND)
    expect(artifact.schemaVersion).toBe(FRONTEND_REACHABILITY_SCHEMA_VERSION)
    expect(artifact.sourceRoot).toBeTruthy()
    expect(artifact.generatedAt).toBe('2026-01-01T00:00:00.000Z')

    // All four cross-domain arrays are populated.
    expect(artifact.routes.length).toBeGreaterThan(0)
    expect(artifact.storageKeys.length).toBeGreaterThan(0)
    expect(artifact.uiReachability.length).toBeGreaterThan(0)
    expect(artifact.edges.length).toBeGreaterThan(0)

    // Stats mirror the array lengths.
    expect(artifact.stats.routeCount).toBe(artifact.routes.length)
    expect(artifact.stats.storageKeyCount).toBe(artifact.storageKeys.length)
    expect(artifact.stats.uiReachabilityCount).toBe(artifact.uiReachability.length)
    expect(artifact.stats.edgeCount).toBe(artifact.edges.length)
    expect(artifact.stats.warningCount).toBe(artifact.warnings.length)
  })

  it('produces the four core cross-domain edge types', () => {
    const { artifact } = analyzeWorkflow()
    const kinds = new Set(artifact.edges.map((e) => e.kind))

    expect(kinds.has('route-serves-component')).toBe(true)
    expect(kinds.has('component-renders-ui')).toBe(true)
    expect(kinds.has('component-uses-storage')).toBe(true)
    expect(kinds.has('route-reaches-ui')).toBe(true)
  })

  it('links a route through its component to a UI marker and back-populates gateRouteIds', () => {
    const { artifact } = analyzeWorkflow()
    const route = artifact.routes.find((r) => r.path === '/dashboard')
    expect(route).toBeDefined()
    const panel = artifact.uiReachability.find((u) => u.value === 'dashboard-panel')
    expect(panel).toBeDefined()

    expect(
      artifact.edges.some(
        (e) => e.kind === 'route-reaches-ui' && e.source === route!.id && e.target === panel!.id
      )
    ).toBe(true)
    expect(panel!.gateRouteIds).toContain(route!.id)
  })

  it('keeps every confidence value inside the static {high|medium|low} boundary', () => {
    const { artifact } = analyzeWorkflow()
    const confidences: ReachabilityConfidence[] = [
      ...artifact.routes.map((r) => r.confidence),
      ...artifact.storageKeys.map((s) => s.confidence),
      ...artifact.uiReachability.map((u) => u.confidence),
      ...artifact.edges.map((e) => e.confidence),
    ]
    expect(confidences.length).toBeGreaterThan(0)
    for (const c of confidences) {
      expect(VALID_CONFIDENCE.has(c)).toBe(true)
    }
    // The tool never claims runtime-proven facts: no 'runtime' or 'proven' levels.
    const serialized = JSON.stringify(artifact)
    expect(serialized).not.toMatch(/"confidence"\s*:\s*"runtime"/)
    expect(serialized).not.toMatch(/"confidence"\s*:\s*"proven"/)
  })

  it('emits only documented edge kinds', () => {
    const { artifact } = analyzeWorkflow()
    for (const edge of artifact.edges) {
      expect(VALID_EDGE_KINDS.has(edge.kind)).toBe(true)
    }
  })

  it('emits only documented warning kinds', () => {
    const { artifact } = analyzeWorkflow()
    const allWarnings = [
      ...artifact.warnings,
      ...artifact.routes.flatMap((r) => r.warnings),
      ...artifact.storageKeys.flatMap((s) => s.warnings),
      ...artifact.uiReachability.flatMap((u) => u.warnings),
    ]
    for (const w of allWarnings) {
      expect(VALID_WARNING_KINDS.has(w.kind)).toBe(true)
    }
  })

  it('carries static test evidence on the UI marker without asserting the test passes', () => {
    const { artifact } = analyzeWorkflow()
    const panel = artifact.uiReachability.find((u) => u.value === 'dashboard-panel')!
    expect(panel.testEvidenceRefs.length).toBeGreaterThanOrEqual(1)
    const ref = panel.testEvidenceRefs[0]
    expect(ref.locatorKind).toBe('getByTestId')
    expect(ref.locatorValue).toBe('dashboard-panel')
    // Evidence is a static locator match, not a pass/fail verdict.
    expect(JSON.stringify(ref)).not.toMatch(/"passed"|"verified"|"runtime"/)
  })
})
