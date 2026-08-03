/**
 * v1.12.0 Batch 5: Android-aware `slice --include-tests` extension unit
 * coverage (TST-521 through TST-535). Synthetic graphs directly exercise
 * `expandAndroidRelatedTests`: production-seed derivation, hierarchy
 * traversal, ambiguous-reference preservation, bounded truncation, and
 * graceful degradation with no test evidence present.
 */
import { describe, expect, it } from 'vitest'
import {
  expandAndroidRelatedTests,
  MAX_ANDROID_RELATED_TEST_NODES,
} from '../../src/android/androidRelatedTestsExpansion.js'
import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from '../../src/graph/codeGraphTypes.js'

function n(id: string, kind: CodeGraphNode['kind'], extra: Partial<CodeGraphNode> = {}): CodeGraphNode {
  return { id, kind, label: id, ...extra }
}
function e(id: string, source: string, target: string, kind: CodeGraphEdge['kind']): CodeGraphEdge {
  return { id, source, target, kind }
}
function buildGraph(nodes: CodeGraphNode[], edges: CodeGraphEdge[]): CodeGraph {
  return {
    artifactKind: 'code-graph',
    schemaVersion: '1.0.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    nodes,
    edges,
    summary: { nodeCount: nodes.length, edgeCount: edges.length, fileNodeCount: 0, symbolNodeCount: nodes.length },
  }
}

/** file -> class -> method -> fact -> (references) -> production node */
function testHierarchy(productionId: string, referenceKind: CodeGraphEdge['kind']) {
  const nodes = [
    n('file:T.kt', 'android-test-file'),
    n('class:T', 'android-test-class'),
    n('method:T.m', 'android-test-method'),
    n('fact:T.m.f', 'android-test-fact'),
  ]
  const edges = [
    e('e-file-class', 'file:T.kt', 'class:T', 'defines-test-class'),
    e('e-class-method', 'class:T', 'method:T.m', 'test-class-defines-method'),
    e('e-method-fact', 'method:T.m', 'fact:T.m.f', 'test-method-has-fact'),
    e('e-fact-ref', 'fact:T.m.f', productionId, referenceKind),
  ]
  return { nodes, edges }
}

describe('expandAndroidRelatedTests', () => {
  it('TST-521: pulls the full file->class->method->fact hierarchy for a referenced ViewModel seed', () => {
    const viewModel = n('symbol:VM.kt#VM', 'symbol', {
      classificationRoles: [{ role: 'view-model', editGuidance: 'safe-primary-edit-target', readiness: 'ready', uncertainty: 'certain' }],
    })
    const hierarchy = testHierarchy(viewModel.id, 'android-test-references-viewmodel')
    const graph = buildGraph([viewModel, ...hierarchy.nodes], hierarchy.edges)

    const result = expandAndroidRelatedTests(graph, new Set([viewModel.id]))
    expect(result.productionSeedCount).toBe(1)
    expect(result.relatedTestMethodCount).toBe(1)
    expect(result.addedNodeIds.sort()).toEqual(['class:T', 'fact:T.m.f', 'file:T.kt', 'method:T.m'].sort())
    expect(result.truncated).toBe(false)
  })

  it('TST-522: a plain symbol without a view-model role is never treated as a production seed', () => {
    const plain = n('symbol:Util.kt#Util', 'symbol')
    const result = expandAndroidRelatedTests(buildGraph([plain], []), new Set([plain.id]))
    expect(result.productionSeedCount).toBe(0)
    expect(result.addedNodeIds).toEqual([])
  })

  it('TST-523: android-composable and android-navigation-destination kinds qualify as seeds directly', () => {
    const composable = n('android-composable:Screen', 'android-composable')
    const destination = n('android-navigation-destination:home', 'android-navigation-destination')
    const nodes = [
      composable,
      destination,
      n('file:T1.kt', 'android-test-file'),
      n('class:T1', 'android-test-class'),
      n('method:T1.m', 'android-test-method'),
      n('fact:T1.m.f', 'android-test-fact'),
      n('file:T2.kt', 'android-test-file'),
      n('class:T2', 'android-test-class'),
      n('method:T2.m', 'android-test-method'),
      n('fact:T2.m.f', 'android-test-fact'),
    ]
    const edges = [
      e('e1-file-class', 'file:T1.kt', 'class:T1', 'defines-test-class'),
      e('e1-class-method', 'class:T1', 'method:T1.m', 'test-class-defines-method'),
      e('e1-method-fact', 'method:T1.m', 'fact:T1.m.f', 'test-method-has-fact'),
      e('e1-fact-ref', 'fact:T1.m.f', composable.id, 'android-test-references-composable'),
      e('e2-file-class', 'file:T2.kt', 'class:T2', 'defines-test-class'),
      e('e2-class-method', 'class:T2', 'method:T2.m', 'test-class-defines-method'),
      e('e2-method-fact', 'method:T2.m', 'fact:T2.m.f', 'test-method-has-fact'),
      e('e2-fact-ref', 'fact:T2.m.f', destination.id, 'android-test-references-route'),
    ]
    const result = expandAndroidRelatedTests(buildGraph(nodes, edges), new Set([composable.id, destination.id]))
    expect(result.productionSeedCount).toBe(2)
    expect(result.relatedTestMethodCount).toBe(2)
  })

  it('TST-524: ambiguous test-fact candidates are preserved once, without fabricating a winner', () => {
    const viewModelA = n('symbol:A.kt#A', 'symbol', {
      classificationRoles: [{ role: 'view-model', editGuidance: 'safe-primary-edit-target', readiness: 'ready', uncertainty: 'certain' }],
    })
    const viewModelB = n('symbol:B.kt#B', 'symbol', {
      classificationRoles: [{ role: 'view-model', editGuidance: 'safe-primary-edit-target', readiness: 'ready', uncertainty: 'certain' }],
    })
    const nodes = [
      viewModelA,
      viewModelB,
      n('file:T.kt', 'android-test-file'),
      n('class:T', 'android-test-class'),
      n('method:T.m', 'android-test-method'),
      n('fact:T.m.f', 'android-test-fact'),
    ]
    const edges = [
      e('e-file-class', 'file:T.kt', 'class:T', 'defines-test-class'),
      e('e-class-method', 'class:T', 'method:T.m', 'test-class-defines-method'),
      e('e-method-fact', 'method:T.m', 'fact:T.m.f', 'test-method-has-fact'),
      e('e-fact-ref-a', 'fact:T.m.f', viewModelA.id, 'android-test-references-viewmodel'),
      e('e-fact-ref-b', 'fact:T.m.f', viewModelB.id, 'android-test-references-viewmodel'),
    ]
    const result = expandAndroidRelatedTests(buildGraph(nodes, edges), new Set([viewModelA.id, viewModelB.id]))
    expect(result.productionSeedCount).toBe(2)
    // The single ambiguous fact/hierarchy is included once, not duplicated.
    expect(result.relatedTestMethodCount).toBe(1)
    expect(result.addedNodeIds.filter((id) => id === 'fact:T.m.f')).toHaveLength(1)
  })

  it('TST-525: graceful degradation - no android-test-* evidence in the graph yields all-zero, no error', () => {
    const viewModel = n('symbol:VM.kt#VM', 'symbol', {
      classificationRoles: [{ role: 'view-model', editGuidance: 'safe-primary-edit-target', readiness: 'ready', uncertainty: 'certain' }],
    })
    const result = expandAndroidRelatedTests(buildGraph([viewModel], []), new Set([viewModel.id]))
    expect(result.productionSeedCount).toBe(1)
    expect(result.relatedTestMethodCount).toBe(0)
    expect(result.addedNodeIds).toEqual([])
    expect(result.truncated).toBe(false)
  })

  it('TST-526: truncates and reports when the added-node cap is exceeded', () => {
    const viewModel = n('symbol:VM.kt#VM', 'symbol', {
      classificationRoles: [{ role: 'view-model', editGuidance: 'safe-primary-edit-target', readiness: 'ready', uncertainty: 'certain' }],
    })
    const nodes: CodeGraphNode[] = [viewModel]
    const edges: CodeGraphEdge[] = []
    const count = MAX_ANDROID_RELATED_TEST_NODES + 20
    for (let i = 0; i < count; i++) {
      nodes.push(n(`file:T${i}.kt`, 'android-test-file'))
      nodes.push(n(`class:T${i}`, 'android-test-class'))
      nodes.push(n(`method:T${i}.m`, 'android-test-method'))
      nodes.push(n(`fact:T${i}.m.f`, 'android-test-fact'))
      edges.push(e(`e-file-class-${i}`, `file:T${i}.kt`, `class:T${i}`, 'defines-test-class'))
      edges.push(e(`e-class-method-${i}`, `class:T${i}`, `method:T${i}.m`, 'test-class-defines-method'))
      edges.push(e(`e-method-fact-${i}`, `method:T${i}.m`, `fact:T${i}.m.f`, 'test-method-has-fact'))
      edges.push(e(`e-fact-ref-${i}`, `fact:T${i}.m.f`, viewModel.id, 'android-test-references-viewmodel'))
    }
    const result = expandAndroidRelatedTests(buildGraph(nodes, edges), new Set([viewModel.id]))
    expect(result.truncated).toBe(true)
    expect(result.addedNodeIds.length).toBeLessThanOrEqual(MAX_ANDROID_RELATED_TEST_NODES)
  })
})
