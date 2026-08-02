import { describe, expect, it } from 'vitest'
import {
  resolveAndroidComposableCandidates,
  resolveAndroidTestTagCandidates,
  resolveAndroidUiCandidates,
  resolveAndroidSelectorMode,
  type AndroidGraphData,
} from '../../src/android/androidRetrieval.js'
import type { CodeGraph, CodeGraphNode } from '../../src/graph/codeGraphTypes.js'

function node(overrides: Partial<CodeGraphNode>): CodeGraphNode {
  return {
    id: 'node:default',
    kind: 'android-composable',
    label: 'Default',
    ...overrides,
  }
}

function graphDataFrom(nodes: CodeGraphNode[]): AndroidGraphData {
  const codeGraph: CodeGraph = {
    artifactKind: 'code-graph',
    schemaVersion: '1.0.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    nodes,
    edges: [],
    summary: { nodeCount: nodes.length, edgeCount: 0, fileNodeCount: 0, symbolNodeCount: 0 },
  }
  return { indexDir: '/fake', codeGraphPath: '/fake/code-graph.json', codeGraph, androidNodes: nodes.filter((n) => n.kind.startsWith('android-')) }
}

describe('resolveAndroidComposableCandidates', () => {
  // TST-401
  it('matches by exact composable name', () => {
    const gd = graphDataFrom([node({ id: 'c1', kind: 'android-composable', label: 'HomeScreen' })])
    const results = resolveAndroidComposableCandidates(gd, 'HomeScreen')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ graphNodeId: 'c1', matchKind: 'composable-name' })
  })

  // TST-402
  it('matches by exact stable composable id', () => {
    const gd = graphDataFrom([node({ id: 'android-compose-declaration:App.kt#Home', kind: 'android-composable', label: 'Home' })])
    const results = resolveAndroidComposableCandidates(gd, 'android-compose-declaration:App.kt#Home')
    expect(results).toHaveLength(1)
    expect(results[0]!.matchKind).toBe('composable-id')
  })

  // TST-403
  it('returns no candidates for an unrelated query', () => {
    const gd = graphDataFrom([node({ id: 'c1', kind: 'android-composable', label: 'HomeScreen' })])
    expect(resolveAndroidComposableCandidates(gd, 'DoesNotExist')).toEqual([])
  })

  // TST-404
  it('preserves ambiguity when two composables share a name', () => {
    const gd = graphDataFrom([
      node({ id: 'c1', kind: 'android-composable', label: 'Item' }),
      node({ id: 'c2', kind: 'android-composable', label: 'Item' }),
    ])
    const results = resolveAndroidComposableCandidates(gd, 'Item')
    expect(results).toHaveLength(2)
  })

  // TST-405
  it('ignores non-composable node kinds', () => {
    const gd = graphDataFrom([node({ id: 'f1', kind: 'android-compose-fact', label: 'Item' })])
    expect(resolveAndroidComposableCandidates(gd, 'Item')).toEqual([])
  })
})

describe('resolveAndroidTestTagCandidates', () => {
  // TST-406
  it('matches an exact resolved test-tag value', () => {
    const gd = graphDataFrom([
      node({ id: 'f1', kind: 'android-compose-fact', label: 'login_button', androidMetadata: { factKind: 'test-tag', resolvedValue: 'login_button' } }),
    ])
    const results = resolveAndroidTestTagCandidates(gd, 'login_button')
    expect(results).toHaveLength(1)
    expect(results[0]!.matchKind).toBe('resolved-test-tag')
  })

  // TST-407
  it('never matches an unresolved (dynamic) test tag by any value', () => {
    const gd = graphDataFrom([
      node({ id: 'f1', kind: 'android-compose-fact', label: 'tag', androidMetadata: { factKind: 'test-tag', resolvedValue: null, rawExpression: 'tag' } }),
    ])
    expect(resolveAndroidTestTagCandidates(gd, 'tag')).toEqual([])
    expect(resolveAndroidTestTagCandidates(gd, 'null')).toEqual([])
  })

  // TST-408
  it('preserves ambiguity when the same test tag value repeats', () => {
    const gd = graphDataFrom([
      node({ id: 'f1', kind: 'android-compose-fact', label: 't', androidMetadata: { factKind: 'test-tag', resolvedValue: 'shared' } }),
      node({ id: 'f2', kind: 'android-compose-fact', label: 't', androidMetadata: { factKind: 'test-tag', resolvedValue: 'shared' } }),
    ])
    expect(resolveAndroidTestTagCandidates(gd, 'shared')).toHaveLength(2)
  })
})

describe('resolveAndroidUiCandidates', () => {
  // TST-409
  it('matches exact resolved visible text', () => {
    const gd = graphDataFrom([
      node({ id: 'f1', kind: 'android-compose-fact', label: 'Welcome', androidMetadata: { factKind: 'visible-text', text: 'Welcome' } }),
    ])
    const results = resolveAndroidUiCandidates(gd, 'Welcome')
    expect(results).toHaveLength(1)
    expect(results[0]!.matchKind).toBe('visible-text')
  })

  // TST-410
  it('matches exact string-resource key and identifier separately', () => {
    const gd = graphDataFrom([
      node({
        id: 'f1',
        kind: 'android-compose-fact',
        label: 'R.string.greeting',
        androidMetadata: { factKind: 'string-resource', resourceName: 'greeting', resourceIdentifierText: 'R.string.greeting' },
      }),
    ])
    expect(resolveAndroidUiCandidates(gd, 'greeting')[0]!.matchKind).toBe('string-resource-key')
    expect(resolveAndroidUiCandidates(gd, 'R.string.greeting')[0]!.matchKind).toBe('string-resource-identifier')
  })

  // TST-411
  it('preserves ambiguity for repeated visible text', () => {
    const gd = graphDataFrom([
      node({ id: 'f1', kind: 'android-compose-fact', label: 'Save', androidMetadata: { factKind: 'visible-text', text: 'Save' } }),
      node({ id: 'f2', kind: 'android-compose-fact', label: 'Save', androidMetadata: { factKind: 'visible-text', text: 'Save' } }),
    ])
    expect(resolveAndroidUiCandidates(gd, 'Save')).toHaveLength(2)
  })

  // TST-412
  it('does not fuzzy-match partial text', () => {
    const gd = graphDataFrom([
      node({ id: 'f1', kind: 'android-compose-fact', label: 'Welcome back', androidMetadata: { factKind: 'visible-text', text: 'Welcome back' } }),
    ])
    expect(resolveAndroidUiCandidates(gd, 'Welcome')).toEqual([])
  })
})

describe('resolveAndroidSelectorMode -- Batch 4 flags', () => {
  // TST-413
  it('accepts --composable alone', () => {
    expect(resolveAndroidSelectorMode({ composable: 'HomeScreen' })).toEqual({ mode: 'composable', query: 'HomeScreen' })
  })

  // TST-414
  it('accepts --test-tag alone', () => {
    expect(resolveAndroidSelectorMode({ testTag: 'tag' })).toEqual({ mode: 'test-tag', query: 'tag' })
  })

  // TST-415
  it('accepts --android-ui alone', () => {
    expect(resolveAndroidSelectorMode({ androidUi: 'text' })).toEqual({ mode: 'android-ui', query: 'text' })
  })

  // TST-416
  it('rejects --composable combined with --android-route', () => {
    expect(() => resolveAndroidSelectorMode({ composable: 'Home', androidRoute: 'home' })).toThrow(/mutually exclusive/)
  })

  // TST-417
  it('rejects --test-tag combined with --android-ui', () => {
    expect(() => resolveAndroidSelectorMode({ testTag: 't', androidUi: 'u' })).toThrow(/mutually exclusive/)
  })

  // TST-418
  it('returns null when no selector flag is present', () => {
    expect(resolveAndroidSelectorMode({})).toBeNull()
  })
})
