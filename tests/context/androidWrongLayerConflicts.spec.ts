/**
 * v1.12.0 Batch 6: wrong-layer conflict-detection unit coverage (TST-620
 * through TST-630, TST-652). Exercises `detectContextConflicts` directly
 * against synthetic focus/candidate/graph data - faster and just as precise
 * as a full CLI round-trip for these predicate-level behaviors.
 */
import { describe, expect, it } from 'vitest'
import { detectContextConflicts } from '../../src/context/conflictDetection.js'
import type { AndroidIntent } from '../../src/context/androidContextIntent.js'
import type { CandidateNode, ContextFocus, ClassificationSummary } from '../../src/context/types.js'
import type { CodeGraph, CodeGraphEdge } from '../../src/graph/codeGraphTypes.js'

function focusOn(nodeId: string): ContextFocus {
  return { focusNodeId: nodeId, focusFilePath: null, selectionMode: 'single-best', confidence: 'high', reasons: [], ambiguityNotes: [], warnings: [] }
}

function node(overrides: Partial<CandidateNode> & Pick<CandidateNode, 'nodeId' | 'score'>): CandidateNode {
  return {
    kind: 'symbol',
    label: overrides.nodeId,
    reasons: [],
    matchedTerms: [],
    retained: true,
    ...overrides,
  }
}

function role(roleName: string, editGuidance: string) {
  return { role: roleName as never, editGuidance: editGuidance as never, readiness: 'ready' as never, uncertainty: 'certain' as never }
}

function emptyGraph(edges: CodeGraphEdge[] = []): CodeGraph {
  return { artifactKind: 'code-graph', schemaVersion: '1.0.0', createdAt: '2026-01-01T00:00:00.000Z', nodes: [], edges, summary: { nodeCount: 0, edgeCount: edges.length, fileNodeCount: 0, symbolNodeCount: 0 } }
}

describe('detectContextConflicts: Android wrong-layer kinds', () => {
  it('TST-620: android-generated-primary-target when a generated node is focused for production work', () => {
    const generated = node({ nodeId: 'gen', score: 10, androidArtifactId: 'android-project', classificationRoles: [role('generated-file', 'generated-do-not-edit')] })
    const result = detectContextConflicts({ focus: focusOn('gen'), candidateNodes: [generated], role: 'implementation' })
    expect(result.status).toBe('conflict')
    expect(result.conflicts.some((c) => c.kind === 'android-generated-primary-target')).toBe(true)
  })

  it('does not emit android-generated-primary-target for a non-production role', () => {
    const generated = node({ nodeId: 'gen', score: 10, androidArtifactId: 'android-project', classificationRoles: [role('generated-file', 'generated-do-not-edit')] })
    const result = detectContextConflicts({ focus: focusOn('gen'), candidateNodes: [generated], role: null })
    expect(result.conflicts.some((c) => c.kind === 'android-generated-primary-target')).toBe(false)
  })

  it('TST-621: android-test-primary-target when a test-only node is focused for production work', () => {
    const test = node({ nodeId: 'test-1', score: 10, kind: 'android-test-method', classificationRoles: [role('android-unit-test', 'test-only')] })
    const result = detectContextConflicts({ focus: focusOn('test-1'), candidateNodes: [test], role: 'implementation' })
    expect(result.conflicts.some((c) => c.kind === 'android-test-primary-target')).toBe(true)
  })

  it('TST-625: does not emit android-test-primary-target for test-implementation role or explicit test intent', () => {
    const test = node({ nodeId: 'test-1', score: 10, kind: 'android-test-method', classificationRoles: [role('android-unit-test', 'test-only')] })
    const asTestRole = detectContextConflicts({ focus: focusOn('test-1'), candidateNodes: [test], role: 'test-implementation' })
    expect(asTestRole.conflicts.some((c) => c.kind === 'android-test-primary-target')).toBe(false)
    const withTestIntent = detectContextConflicts({
      focus: focusOn('test-1'),
      candidateNodes: [test],
      role: 'implementation',
      androidIntents: new Set<AndroidIntent>(['test']),
    })
    expect(withTestIntent.conflicts.some((c) => c.kind === 'android-test-primary-target')).toBe(false)
  })

  it('TST-622: android-usage-selected-over-owner for a collected-state fact vs its linked ViewModel', () => {
    const stateFact = node({ nodeId: 'fact', score: 50, kind: 'android-compose-fact', classificationRoles: [role('ui-only-state', 'safe-primary-edit-target')] })
    const viewModel = node({ nodeId: 'vm', score: 40, androidArtifactId: 'android-components', classificationRoles: [role('view-model', 'safe-primary-edit-target')] })
    const graph = emptyGraph([{ id: 'e1', source: 'fact', target: 'vm', kind: 'compose-state-reads-viewmodel' }])
    const result = detectContextConflicts({ focus: focusOn('fact'), candidateNodes: [stateFact, viewModel], codeGraph: graph, role: 'implementation' })
    expect(result.conflicts.some((c) => c.kind === 'android-usage-selected-over-owner' && c.affectedNodes.includes('fact') && c.affectedNodes.includes('vm'))).toBe(true)
  })

  it('TST-623: android-usage-selected-over-owner for resource usage vs resource definition', () => {
    const usage = node({ nodeId: 'usage', score: 30, kind: 'symbol' })
    const definition = node({ nodeId: 'def', score: 20, kind: 'android-resource-definition', classificationRoles: [role('resource-file', 'safe-primary-edit-target')] })
    const graph = emptyGraph([{ id: 'e1', source: 'usage', target: 'def', kind: 'source-references-resource' }])
    const result = detectContextConflicts({ focus: focusOn('usage'), candidateNodes: [usage, definition], codeGraph: graph, role: 'implementation' })
    expect(result.conflicts.some((c) => c.kind === 'android-usage-selected-over-owner')).toBe(true)
  })

  it('TST-624: android-usage-selected-over-owner for a navigation call vs the route definition', () => {
    const navCall = node({ nodeId: 'nav-call', score: 30, kind: 'android-compose-fact' })
    const route = node({ nodeId: 'route', score: 20, kind: 'android-navigation-destination', classificationRoles: [role('navigation-route', 'inspect-before-edit')] })
    const graph = emptyGraph([{ id: 'e1', source: 'nav-call', target: 'route', kind: 'compose-navigation-targets-route' }])
    const result = detectContextConflicts({ focus: focusOn('nav-call'), candidateNodes: [navCall, route], codeGraph: graph, role: 'implementation' })
    expect(result.conflicts.some((c) => c.kind === 'android-usage-selected-over-owner')).toBe(true)
  })

  it('TST-629: android-classification-graph-disagreement when a "safe" node is graph-proven to be only a usage site', () => {
    const stateFact = node({ nodeId: 'fact', score: 50, kind: 'android-compose-fact', classificationRoles: [role('ui-only-state', 'safe-primary-edit-target')] })
    const viewModel = node({ nodeId: 'vm', score: 40, androidArtifactId: 'android-components', classificationRoles: [role('view-model', 'safe-primary-edit-target')] })
    const graph = emptyGraph([{ id: 'e1', source: 'fact', target: 'vm', kind: 'compose-state-reads-viewmodel' }])
    const result = detectContextConflicts({ focus: focusOn('fact'), candidateNodes: [stateFact, viewModel], codeGraph: graph, role: 'implementation' })
    expect(result.conflicts.some((c) => c.kind === 'android-classification-graph-disagreement')).toBe(true)
  })

  it('TST-630: no disagreement conflict for an ordinary adjacent-layer relationship with no usage/owner edge', () => {
    const a = node({ nodeId: 'a', score: 10, androidArtifactId: 'android-components', classificationRoles: [role('repository', 'safe-primary-edit-target')] })
    const b = node({ nodeId: 'b', score: 10, androidArtifactId: 'android-components', classificationRoles: [role('room-dao', 'safe-primary-edit-target')] })
    const graph = emptyGraph([{ id: 'e1', source: 'a', target: 'b', kind: 'repository-uses-dao' }])
    const result = detectContextConflicts({ focus: focusOn('a'), candidateNodes: [a, b], codeGraph: graph, role: 'implementation' })
    expect(result.conflicts.some((c) => c.kind === 'android-classification-graph-disagreement')).toBe(false)
    expect(result.conflicts.some((c) => c.kind === 'android-usage-selected-over-owner')).toBe(false)
  })

  it('TST-626: android-ambiguous-owner preserves every candidate at the best eligible tier without a winner', () => {
    const vmA = node({ nodeId: 'vm-a', score: 100, androidArtifactId: 'android-components', classificationRoles: [role('view-model', 'safe-primary-edit-target')] })
    const vmB = node({ nodeId: 'vm-b', score: 98, androidArtifactId: 'android-components', classificationRoles: [role('view-model', 'safe-primary-edit-target')] })
    const result = detectContextConflicts({
      focus: focusOn('vm-a'),
      candidateNodes: [vmA, vmB],
      role: 'implementation',
      androidIntents: new Set<AndroidIntent>(['state']),
    })
    const ambiguous = result.conflicts.find((c) => c.kind === 'android-ambiguous-owner')
    expect(ambiguous).toBeTruthy()
    expect(ambiguous!.affectedNodes.sort()).toEqual(['vm-a', 'vm-b'])
  })

  it('TST-627: android-unresolved-owner when wrong-layer-risk evidence exists and no eligible owner remains', () => {
    const focus = node({ nodeId: 'vm-risky', score: 10, androidArtifactId: 'android-components', classificationRoles: [role('view-model', 'read-only-reference')] })
    const summary = {
      available: true,
      classificationArtifactPath: null,
      roles: [],
      refs: [],
      editGuidance: [],
      readiness: [],
      riskLabels: [],
      uncertainty: [],
      summariesByNode: { 'vm-risky': { classifications: [], editGuidance: 'read-only-reference' as never, readiness: 'ready' as never, risks: ['wrong-layer-risk' as never], uncertainty: 'certain' as never, warnings: [] } },
      summariesByFile: {},
      warnings: [],
    } as unknown as ClassificationSummary
    const result = detectContextConflicts({ focus: focusOn('vm-risky'), candidateNodes: [focus], role: 'implementation', classificationSummary: summary })
    expect(result.conflicts.some((c) => c.kind === 'android-unresolved-owner')).toBe(true)
  })

  it('TST-628: no false android-unresolved-owner for a component that legitimately has no such dependency (no risk label present)', () => {
    const focus = node({ nodeId: 'vm-fine', score: 10, androidArtifactId: 'android-components', classificationRoles: [role('view-model', 'safe-primary-edit-target')] })
    const result = detectContextConflicts({ focus: focusOn('vm-fine'), candidateNodes: [focus], role: 'implementation' })
    expect(result.conflicts.some((c) => c.kind === 'android-unresolved-owner')).toBe(false)
  })

  it('TST-652: conflicts are deterministically ordered by kind, then primary/related node id', () => {
    const generated = node({ nodeId: 'gen-b', score: 10, androidArtifactId: 'android-project', classificationRoles: [role('generated-file', 'generated-do-not-edit')] })
    const result = detectContextConflicts({ focus: focusOn('gen-b'), candidateNodes: [generated], role: 'implementation' })
    const kinds = result.conflicts.map((c) => c.kind)
    const sortedKinds = [...kinds].sort()
    expect(kinds).toEqual(sortedKinds)
  })
})
