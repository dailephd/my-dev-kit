/**
 * Regression assertions for v1.3.0 frontend reachability.
 *
 * These guard the stable contract surface the consumers (search/lookup/slice/
 * source/view) depend on: the producer functions still emit valid output from
 * the standard fixture, the assembled artifact keeps its kind/schemaVersion, and
 * a write -> read round-trip is byte-stable. If any of these drift, downstream
 * command behavior breaks, so they are pinned here.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FRONTEND_REACHABILITY_ARTIFACT_KIND,
  FRONTEND_REACHABILITY_SCHEMA_VERSION,
  extractRouteFacts,
  extractStorageKeyFacts,
  extractUiReachabilityFacts,
  buildReachabilityEdges,
  loadFrontendReachabilityArtifact,
  runFrontendReachabilityAnalyzer,
  writeFrontendReachabilityArtifact,
} from '../../src/frontend-reachability/index.js'
import { buildFrontendFixture, cleanupReachabilityTempDirs } from './reachabilityTestHelpers.js'

const tempDirs: string[] = []

afterEach(() => {
  cleanupReachabilityTempDirs()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-reach-reg-'))
  tempDirs.push(dir)
  return dir
}

/** The standard cross-domain fixture used by the Batch 2 producer tests. */
function buildStandardFixture() {
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

describe('frontend reachability producer regression', () => {
  it('extractRouteFacts still produces a /dashboard route fact', () => {
    const { repoRoot, artifact: frontendArtifact } = buildStandardFixture()
    const routes = extractRouteFacts({ frontendArtifact, repoRoot })
    expect(routes.length).toBeGreaterThan(0)
    const dashboard = routes.find((r) => r.path === '/dashboard')
    expect(dashboard).toBeDefined()
    expect(['high', 'medium', 'low']).toContain(dashboard!.confidence)
    expect(dashboard!.id.startsWith('route:')).toBe(true)
  })

  it('extractStorageKeyFacts still produces an auth_token localStorage fact', () => {
    const { repoRoot, artifact: frontendArtifact } = buildStandardFixture()
    const storageKeys = extractStorageKeyFacts({ frontendArtifact, repoRoot })
    const auth = storageKeys.find((s) => s.key === 'auth_token')
    expect(auth).toBeDefined()
    expect(auth!.storageKind).toBe('localStorage')
    expect(auth!.id).toBe('storage:localStorage:auth_token')
  })

  it('extractUiReachabilityFacts still produces a dashboard-panel marker', () => {
    const { repoRoot, artifact: frontendArtifact } = buildStandardFixture()
    const storageKeys = extractStorageKeyFacts({ frontendArtifact, repoRoot })
    const ui = extractUiReachabilityFacts({ frontendArtifact, storageKeys })
    const panel = ui.find((u) => u.value === 'dashboard-panel')
    expect(panel).toBeDefined()
    expect(panel!.markerKind).toBe('data-testid')
  })

  it('buildReachabilityEdges still wires producer output into edges', () => {
    const { repoRoot, artifact: frontendArtifact } = buildStandardFixture()
    const routes = extractRouteFacts({ frontendArtifact, repoRoot })
    const storageKeys = extractStorageKeyFacts({ frontendArtifact, repoRoot })
    const uiReachability = extractUiReachabilityFacts({ frontendArtifact, storageKeys })
    const edges = buildReachabilityEdges({ routes, storageKeys, uiReachability })
    expect(edges.length).toBeGreaterThan(0)
    expect(edges.some((e) => e.kind === 'route-serves-component')).toBe(true)
  })

  it('assembled artifact pins artifactKind and schemaVersion', () => {
    const { repoRoot, artifact: frontendArtifact } = buildStandardFixture()
    const { artifact } = runFrontendReachabilityAnalyzer({
      frontendArtifact,
      repoRoot,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(artifact.artifactKind).toBe('my-dev-kit-v1-frontend-reachability')
    expect(artifact.schemaVersion).toBe('1.0.0')
    expect(FRONTEND_REACHABILITY_ARTIFACT_KIND).toBe('my-dev-kit-v1-frontend-reachability')
    expect(FRONTEND_REACHABILITY_SCHEMA_VERSION).toBe('1.0.0')
  })

  it('write -> read round-trip preserves the artifact and is byte-stable', () => {
    const { repoRoot, artifact: frontendArtifact } = buildStandardFixture()
    const { artifact } = runFrontendReachabilityAnalyzer({
      frontendArtifact,
      repoRoot,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const dirA = makeTempDir()
    const dirB = makeTempDir()
    const fileA = writeFrontendReachabilityArtifact(dirA, artifact)
    const fileB = writeFrontendReachabilityArtifact(dirB, artifact)
    expect(existsSync(fileA)).toBe(true)
    expect(readFileSync(fileA, 'utf8')).toBe(readFileSync(fileB, 'utf8'))

    const loaded = loadFrontendReachabilityArtifact(dirA)
    expect(loaded).not.toBeNull()
    expect(loaded!.artifactKind).toBe(FRONTEND_REACHABILITY_ARTIFACT_KIND)
    expect(loaded!.routes.map((r) => r.path)).toEqual(artifact.routes.map((r) => r.path))
  })
})
