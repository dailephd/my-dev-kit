import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FRONTEND_REACHABILITY_ARTIFACT_KIND,
  FRONTEND_REACHABILITY_SCHEMA_VERSION,
  buildEmptyFrontendReachabilityArtifact,
  loadFrontendReachabilityArtifact,
  sortFrontendReachabilityArtifact,
  writeFrontendReachabilityArtifact,
  type FrontendReachabilityArtifact,
} from '../../src/frontend-reachability/index.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-reach-'))
  tempDirs.push(dir)
  return dir
}

function sampleArtifact(): FrontendReachabilityArtifact {
  const artifact = buildEmptyFrontendReachabilityArtifact('2026-01-01T00:00:00.000Z', '/repo')
  artifact.routes = [
    { id: 'route:/zeta', path: '/zeta', kind: 'link-target', componentIds: [], sourceRefs: [{ filePath: 'src/Z.tsx', line: 1 }], confidence: 'high', warnings: [] },
    { id: 'route:/alpha', path: '/alpha', kind: 'link-target', componentIds: [], sourceRefs: [{ filePath: 'src/A.tsx', line: 1 }], confidence: 'high', warnings: [] },
  ]
  artifact.storageKeys = [
    { id: 'storage:sessionStorage:cart', key: 'cart', storageKind: 'sessionStorage', componentIds: [], stateVarNames: [], sourceRefs: [{ filePath: 'src/A.tsx', line: 2 }], confidence: 'high', warnings: [] },
    { id: 'storage:localStorage:auth', key: 'auth', storageKind: 'localStorage', componentIds: [], stateVarNames: [], sourceRefs: [{ filePath: 'src/A.tsx', line: 3 }], confidence: 'high', warnings: [] },
  ]
  artifact.uiReachability = [
    { id: 'ui:data-testid:zed', markerKind: 'data-testid', value: 'zed', componentId: 'C', jsxRegionKind: null, conditionText: null, gateStorageKeyIds: [], gateRouteIds: [], testEvidenceRefs: [], sourceRef: { filePath: 'src/A.tsx', line: 4 }, confidence: 'medium', warnings: [] },
    { id: 'ui:data-testid:abc', markerKind: 'data-testid', value: 'abc', componentId: 'C', jsxRegionKind: null, conditionText: null, gateStorageKeyIds: [], gateRouteIds: [], testEvidenceRefs: [], sourceRef: { filePath: 'src/A.tsx', line: 5 }, confidence: 'medium', warnings: [] },
  ]
  artifact.edges = [
    { id: 'C--component-renders-ui-->ui:data-testid:zed', kind: 'component-renders-ui', source: 'C', target: 'ui:data-testid:zed', confidence: 'medium', evidenceRefs: [] },
    { id: 'route:/alpha--route-serves-component-->C', kind: 'route-serves-component', source: 'route:/alpha', target: 'C', confidence: 'high', evidenceRefs: [] },
  ]
  return artifact
}

describe('frontend-reachability contract', () => {
  it('buildEmptyFrontendReachabilityArtifact returns a valid empty artifact', () => {
    const artifact = buildEmptyFrontendReachabilityArtifact('2026-01-01T00:00:00.000Z', '/repo')
    expect(artifact.artifactKind).toBe(FRONTEND_REACHABILITY_ARTIFACT_KIND)
    expect(artifact.schemaVersion).toBe(FRONTEND_REACHABILITY_SCHEMA_VERSION)
    expect(artifact.routes).toEqual([])
    expect(artifact.storageKeys).toEqual([])
    expect(artifact.uiReachability).toEqual([])
    expect(artifact.edges).toEqual([])
    expect(artifact.warnings).toEqual([])
    expect(artifact.stats).toEqual({
      routeCount: 0,
      storageKeyCount: 0,
      uiReachabilityCount: 0,
      edgeCount: 0,
      warningCount: 0,
    })
  })

  it('write then read round-trips an artifact', () => {
    const dir = makeTempDir()
    const artifact = sampleArtifact()
    const filePath = writeFrontendReachabilityArtifact(dir, artifact)
    expect(existsSync(filePath)).toBe(true)
    const loaded = loadFrontendReachabilityArtifact(dir)
    expect(loaded).not.toBeNull()
    expect(loaded?.artifactKind).toBe(FRONTEND_REACHABILITY_ARTIFACT_KIND)
    expect(loaded?.routes.map((r) => r.path)).toEqual(['/alpha', '/zeta'])
  })

  it('sorts all arrays deterministically', () => {
    const sorted = sortFrontendReachabilityArtifact(sampleArtifact())
    expect(sorted.routes.map((r) => r.path)).toEqual(['/alpha', '/zeta'])
    expect(sorted.storageKeys.map((s) => s.id)).toEqual([
      'storage:localStorage:auth',
      'storage:sessionStorage:cart',
    ])
    expect(sorted.uiReachability.map((u) => u.value)).toEqual(['abc', 'zed'])
    expect(sorted.edges.map((e) => e.kind)).toEqual(['component-renders-ui', 'route-serves-component'])
  })

  it('writes byte-identical JSON regardless of input order', () => {
    const dir1 = makeTempDir()
    const dir2 = makeTempDir()
    const a = sampleArtifact()
    const b = sampleArtifact()
    b.routes.reverse()
    b.storageKeys.reverse()
    b.uiReachability.reverse()
    b.edges.reverse()
    const f1 = writeFrontendReachabilityArtifact(dir1, a)
    const f2 = writeFrontendReachabilityArtifact(dir2, b)
    expect(readFileSync(f1, 'utf8')).toBe(readFileSync(f2, 'utf8'))
  })

  it('returns null when artifact file is missing', () => {
    const dir = makeTempDir()
    expect(loadFrontendReachabilityArtifact(dir)).toBeNull()
  })

  it('throws on wrong artifactKind', () => {
    const dir = makeTempDir()
    writeFileSync(
      join(dir, 'frontend-reachability.json'),
      JSON.stringify({ artifactKind: 'wrong', schemaVersion: '1.0.0', routes: [], storageKeys: [], uiReachability: [], edges: [], warnings: [], stats: {} })
    )
    expect(() => loadFrontendReachabilityArtifact(dir)).toThrow(/malformed/)
  })

  it('throws on missing required arrays', () => {
    const dir = makeTempDir()
    writeFileSync(
      join(dir, 'frontend-reachability.json'),
      JSON.stringify({ artifactKind: FRONTEND_REACHABILITY_ARTIFACT_KIND, schemaVersion: '1.0.0' })
    )
    expect(() => loadFrontendReachabilityArtifact(dir)).toThrow(/malformed/)
  })

  it('throws on invalid JSON', () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, 'frontend-reachability.json'), '{ not json')
    expect(() => loadFrontendReachabilityArtifact(dir)).toThrow(/malformed/)
  })
})
