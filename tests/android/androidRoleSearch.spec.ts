/**
 * v1.12.0 Batch 5: `search --android-role` unit coverage (TST-501 through
 * TST-510). Exercises the allowlist, provenance filter, ordering, and
 * limit/total-count behavior directly against synthetic `CodeGraph` data,
 * independent of the CLI.
 */
import { describe, expect, it } from 'vitest'
import {
  ANDROID_ROLE_SEARCH_VALUES,
  buildAndroidRoleSearchResult,
  isAndroidRoleSearchValue,
} from '../../src/android/androidRoleSearch.js'
import type { CodeGraph, CodeGraphNode } from '../../src/graph/codeGraphTypes.js'
import type { ResolvedIndexManifest } from '../../src/indexing/readIndexManifest.js'

function node(overrides: Partial<CodeGraphNode> & Pick<CodeGraphNode, 'id' | 'kind' | 'label'>): CodeGraphNode {
  return overrides
}

function graph(nodes: CodeGraphNode[]): CodeGraph {
  return {
    artifactKind: 'code-graph',
    schemaVersion: '1.0.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    nodes,
    edges: [],
    summary: { nodeCount: nodes.length, edgeCount: 0, fileNodeCount: 0, symbolNodeCount: nodes.length },
  }
}

const resolved = {
  indexDir: '.my-dev-kit',
  manifestPath: '.my-dev-kit/manifest.json',
  artifactPaths: { symbolIndex: '.my-dev-kit/symbol-index.json', codeGraph: '.my-dev-kit/code-graph.json' },
} as unknown as ResolvedIndexManifest

describe('isAndroidRoleSearchValue', () => {
  it('TST-501: accepts every allowlisted role and rejects an unlisted value', () => {
    for (const role of ANDROID_ROLE_SEARCH_VALUES) expect(isAndroidRoleSearchValue(role)).toBe(true)
    expect(isAndroidRoleSearchValue('bogus-role')).toBe(false)
    expect(isAndroidRoleSearchValue('configuration-file')).toBe(false)
    expect(isAndroidRoleSearchValue('test-block')).toBe(false)
  })
})

describe('buildAndroidRoleSearchResult', () => {
  it('TST-502: excludes a non-Android symbol whose generic role overlaps an Android role name', () => {
    const androidRepo = node({
      id: 'symbol:app/Repo.kt#Repo',
      kind: 'symbol',
      label: 'Repo',
      classificationRoles: [{ role: 'repository', editGuidance: 'safe-primary-edit-target', readiness: 'ready', uncertainty: 'certain' }],
      androidComponentRefs: [{ artifact: 'android-components.json', artifactKind: 'android-component', id: 'component:Repo' }],
    })
    const plainRepo = node({
      id: 'symbol:src/repo.ts#Repo',
      kind: 'symbol',
      label: 'Repo',
      classificationRoles: [{ role: 'repository', editGuidance: 'safe-primary-edit-target', readiness: 'ready', uncertainty: 'certain' }],
    })
    const result = buildAndroidRoleSearchResult({
      resolved,
      codeGraph: graph([androidRepo, plainRepo]),
      role: 'repository',
      limit: 20,
    })
    expect(result.results.map((r) => r.id)).toEqual([androidRepo.id])
  })

  it('TST-503: an android-* kind node qualifies without needing androidComponentRefs', () => {
    const activityNode = node({
      id: 'android-manifest-component:app/AndroidManifest.xml#.MainActivity',
      kind: 'android-manifest-component',
      label: 'MainActivity',
      classificationRoles: [{ role: 'activity', editGuidance: 'safe-primary-edit-target', readiness: 'ready', uncertainty: 'certain' }],
    })
    const result = buildAndroidRoleSearchResult({ resolved, codeGraph: graph([activityNode]), role: 'activity', limit: 20 })
    expect(result.results.map((r) => r.id)).toEqual([activityNode.id])
  })

  it('TST-504: zero results is valid and produces an empty (not missing) results array', () => {
    const result = buildAndroidRoleSearchResult({ resolved, codeGraph: graph([]), role: 'worker', limit: 20 })
    expect(result.results).toEqual([])
    expect(result.summary.resultCount).toBe(0)
    expect(result.summary.totalMatchCount).toBe(0)
  })

  it('TST-505: deterministic id-ascending ordering regardless of input order', () => {
    const a = node({
      id: 'symbol:b.kt#B',
      kind: 'symbol',
      label: 'B',
      classificationRoles: [{ role: 'view-model', editGuidance: 'safe-primary-edit-target', readiness: 'ready', uncertainty: 'certain' }],
      androidComponentRefs: [{ artifact: 'a', artifactKind: 'android-component', id: 'b' }],
    })
    const b = node({
      id: 'symbol:a.kt#A',
      kind: 'symbol',
      label: 'A',
      classificationRoles: [{ role: 'view-model', editGuidance: 'safe-primary-edit-target', readiness: 'ready', uncertainty: 'certain' }],
      androidComponentRefs: [{ artifact: 'a', artifactKind: 'android-component', id: 'a' }],
    })
    const result = buildAndroidRoleSearchResult({ resolved, codeGraph: graph([a, b]), role: 'view-model', limit: 20 })
    expect(result.results.map((r) => r.id)).toEqual(['symbol:a.kt#A', 'symbol:b.kt#B'])
  })

  it('TST-506: --limit truncates results but summary distinguishes returned vs total matches', () => {
    const nodes = Array.from({ length: 5 }, (_, i) =>
      node({
        id: `symbol:f${i}.kt#F${i}`,
        kind: 'symbol',
        label: `F${i}`,
        classificationRoles: [{ role: 'use-case', editGuidance: 'safe-primary-edit-target', readiness: 'ready', uncertainty: 'certain' }],
        androidComponentRefs: [{ artifact: 'a', artifactKind: 'android-component', id: `f${i}` }],
      })
    )
    const result = buildAndroidRoleSearchResult({ resolved, codeGraph: graph(nodes), role: 'use-case', limit: 2 })
    expect(result.results).toHaveLength(2)
    expect(result.summary.resultCount).toBe(2)
    expect(result.summary.totalMatchCount).toBe(5)
  })

  it('TST-507: result artifact reuses the canonical SearchIndexResult shape', () => {
    const result = buildAndroidRoleSearchResult({ resolved, codeGraph: graph([]), role: 'service', limit: 20 })
    expect(result.artifactKind).toBe('my-dev-kit-v1-search-result')
    expect(result.androidRole).toBe('service')
  })
})
