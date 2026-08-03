/**
 * v1.12.0 Batch 6: Android owner-policy unit coverage (eligibility, ranking
 * boost, generated/test-only classification, bounded owner-support
 * traversal). TST-605 through TST-619, TST-644 through TST-646 (subset).
 */
import { describe, expect, it } from 'vitest'
import {
  androidIntentRankingBoost,
  androidOwnerEligible,
  findAndroidOwnerSupportNodeIds,
  hasAndroidProvenance,
  isAndroidGeneratedCandidate,
  isAndroidTestOnlyCandidate,
  isAndroidValidTestLocation,
  MAX_ANDROID_OWNER_SUPPORT_PATH_LENGTH,
} from '../../src/context/androidContextOwnerPolicy.js'
import type { AndroidIntent } from '../../src/context/androidContextIntent.js'
import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from '../../src/graph/codeGraphTypes.js'

function role(roleName: string, editGuidance: string) {
  return { role: roleName, editGuidance: editGuidance as never, readiness: 'ready' as never, uncertainty: 'certain' as never }
}

describe('hasAndroidProvenance', () => {
  it('recognizes android-* kinds and androidArtifactId-backed symbols, never a plain symbol', () => {
    expect(hasAndroidProvenance({ kind: 'android-composable' })).toBe(true)
    expect(hasAndroidProvenance({ kind: 'symbol', androidArtifactId: 'android-components' })).toBe(true)
    expect(hasAndroidProvenance({ kind: 'symbol' })).toBe(false)
  })
})

describe('androidOwnerEligible', () => {
  it('TST-605/606: a ViewModel is eligible for the state intent even though "view-model" is a generic non-owner category elsewhere', () => {
    const viewModel = { kind: 'symbol', androidArtifactId: 'android-components', classificationRoles: [role('view-model', 'safe-primary-edit-target')] }
    expect(androidOwnerEligible(viewModel, new Set<AndroidIntent>(['state']), false)).toBe(true)
  })

  it('TST-619: a generated-file candidate is never eligible, regardless of intent', () => {
    const generated = { kind: 'symbol', androidArtifactId: 'android-project', classificationRoles: [role('generated-file', 'generated-do-not-edit')] }
    expect(androidOwnerEligible(generated, new Set<AndroidIntent>(['ui']), false)).toBe(false)
  })

  it('TST-618: a test-only candidate is never eligible for production work', () => {
    const testOnly = { kind: 'android-test-method', classificationRoles: [role('android-unit-test', 'test-only')] }
    expect(androidOwnerEligible(testOnly, new Set<AndroidIntent>(['data']), false)).toBe(false)
  })

  it('TST-617 (corrected): a test-only candidate is NEVER production-owner eligible, even under explicit test intent or the test-implementation role - it becomes a valid test EDIT LOCATION instead, a distinct concept', () => {
    const testOnly = { kind: 'android-test-method', classificationRoles: [role('android-unit-test', 'test-only')] }
    expect(androidOwnerEligible(testOnly, new Set<AndroidIntent>(['test']), false)).toBe(false)
    expect(androidOwnerEligible(testOnly, new Set<AndroidIntent>(), true)).toBe(false)
    expect(isAndroidValidTestLocation(testOnly, new Set<AndroidIntent>(['test']), false)).toBe(true)
    expect(isAndroidValidTestLocation(testOnly, new Set<AndroidIntent>(), true)).toBe(true)
    expect(isAndroidValidTestLocation(testOnly, new Set<AndroidIntent>(), false)).toBe(false)
  })

  it('a non-test-only Android node is never blanket-approved merely because test intent/role is present', () => {
    const sourceSet = { kind: 'android-source-set', classificationRoles: [role('gradle-module', 'safe-primary-edit-target')] }
    expect(androidOwnerEligible(sourceSet, new Set<AndroidIntent>(['test']), false)).toBe(false)
  })

  it('excludes docs-only and read-only-reference guidance from ownership', () => {
    const docsOnly = { kind: 'android-manifest-file', classificationRoles: [role('android-manifest', 'docs-only')] }
    expect(androidOwnerEligible(docsOnly, new Set<AndroidIntent>(['manifest-platform']), false)).toBe(false)
    const readOnly = { kind: 'android-resource-file', classificationRoles: [role('resource-file', 'read-only-reference')] }
    expect(androidOwnerEligible(readOnly, new Set<AndroidIntent>(['resource']), false)).toBe(false)
  })

  it('a non-Android candidate is never widened by this policy (returns false, generic rules apply instead)', () => {
    expect(androidOwnerEligible({ kind: 'symbol' }, new Set<AndroidIntent>(['data']), false)).toBe(false)
  })
})

describe('isAndroidGeneratedCandidate / isAndroidTestOnlyCandidate', () => {
  it('TST-619/620: identifies generated Android nodes precisely', () => {
    expect(isAndroidGeneratedCandidate({ kind: 'android-generated-build-path', classificationRoles: [role('generated-file', 'generated-do-not-edit')] })).toBe(true)
    expect(isAndroidGeneratedCandidate({ kind: 'symbol', androidArtifactId: 'android-components', classificationRoles: [role('repository', 'safe-primary-edit-target')] })).toBe(false)
  })

  it('TST-621: identifies test-only Android nodes precisely, never a mixed-guidance node', () => {
    expect(isAndroidTestOnlyCandidate({ kind: 'android-test-method', classificationRoles: [role('android-unit-test', 'test-only')] })).toBe(true)
    expect(isAndroidTestOnlyCandidate({ kind: 'symbol', androidArtifactId: 'android-components', classificationRoles: [role('view-model', 'safe-primary-edit-target')] })).toBe(false)
  })
})

describe('androidIntentRankingBoost', () => {
  it('TST-605: a primary-category candidate outranks a supporting-category candidate for the same intent', () => {
    const screen = { kind: 'android-composable', classificationRoles: [role('compose-screen', 'safe-primary-edit-target')] }
    const stateFact = { kind: 'android-compose-fact', classificationRoles: [role('ui-only-state', 'avoid-primary-edit-target')] }
    const intents = new Set<AndroidIntent>(['ui'])
    expect(androidIntentRankingBoost(screen, intents).boost).toBeGreaterThan(androidIntentRankingBoost(stateFact, intents).boost)
  })

  it('returns 0 for a non-Android candidate or when no intent is detected', () => {
    expect(androidIntentRankingBoost({ kind: 'symbol' }, new Set<AndroidIntent>(['ui'])).boost).toBe(0)
    const screen = { kind: 'android-composable', classificationRoles: [role('compose-screen', 'safe-primary-edit-target')] }
    expect(androidIntentRankingBoost(screen, new Set<AndroidIntent>()).boost).toBe(0)
  })
})

function n(id: string): CodeGraphNode {
  return { id, kind: 'symbol', label: id }
}
function e(id: string, source: string, target: string, kind: CodeGraphEdge['kind']): CodeGraphEdge {
  return { id, source, target, kind }
}

describe('findAndroidOwnerSupportNodeIds', () => {
  const nodes = [n('activity'), n('composable'), n('viewmodel'), n('repository'), n('dao'), n('entity')]
  const edges = [
    e('e1', 'activity', 'composable', 'activity-hosts-composable'),
    e('e2', 'composable', 'viewmodel', 'composable-references-viewmodel'),
    e('e3', 'viewmodel', 'repository', 'viewmodel-uses-repository'),
    e('e4', 'repository', 'dao', 'repository-uses-dao'),
    e('e5', 'dao', 'entity', 'dao-uses-entity'),
  ]
  const graph: CodeGraph = {
    artifactKind: 'code-graph',
    schemaVersion: '1.0.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    nodes,
    edges,
    summary: { nodeCount: nodes.length, edgeCount: edges.length, fileNodeCount: 0, symbolNodeCount: nodes.length },
  }

  it('TST-644/645: reuses the Batch 5 data-flow allowlist and respects the fixed 4-hop cap and the caller-supplied node cap', () => {
    // activity -> composable -> viewmodel -> repository -> dao is exactly 4 hops;
    // -> entity is a 5th hop and must not be reached (the fixed path-length cap).
    const reached = findAndroidOwnerSupportNodeIds({ codeGraph: graph, seedNodeIds: new Set(['activity']), maxNodes: 100 })
    expect(reached.has('dao')).toBe(true)
    expect(reached.has('entity')).toBe(false)
    expect(MAX_ANDROID_OWNER_SUPPORT_PATH_LENGTH).toBe(4)

    const capped = findAndroidOwnerSupportNodeIds({ codeGraph: graph, seedNodeIds: new Set(['activity']), maxNodes: 2 })
    expect(capped.size).toBeLessThanOrEqual(2)
  })

  it('TST-646: cyclic edges remain bounded and deterministic', () => {
    const cyclicNodes = [n('a'), n('b'), n('c')]
    const cyclicEdges = [
      e('e1', 'a', 'b', 'viewmodel-uses-repository'),
      e('e2', 'b', 'c', 'repository-uses-dao'),
      e('e3', 'c', 'a', 'dao-uses-entity'),
    ]
    const cyclicGraph: CodeGraph = {
      artifactKind: 'code-graph',
      schemaVersion: '1.0.0',
      createdAt: '2026-01-01T00:00:00.000Z',
      nodes: cyclicNodes,
      edges: cyclicEdges,
      summary: { nodeCount: 3, edgeCount: 3, fileNodeCount: 0, symbolNodeCount: 3 },
    }
    const reached = findAndroidOwnerSupportNodeIds({ codeGraph: cyclicGraph, seedNodeIds: new Set(['a']), maxNodes: 100 })
    expect([...reached].sort()).toEqual(['a', 'b', 'c'])
  })
})
