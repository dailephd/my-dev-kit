import { describe, expect, it } from 'vitest'
import { buildQueryPlan } from '../../src/context/queryPlan.js'
import { buildModeEffects, rankCandidateFiles, rankCandidateNodes, type RankingInput } from '../../src/context/candidateRanking.js'
import { selectPrimaryFocus } from '../../src/context/graphFocus.js'
import { selectGraphNeighborhood } from '../../src/context/graphSelection.js'
import { computeContextAdequacy } from '../../src/context/contextCapsule.js'
import type { SearchResultItem } from '../../src/search/searchTypes.js'
import type { CandidateNode } from '../../src/context/types.js'
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'

function fileResult(overrides: Partial<SearchResultItem> & { path: string }): SearchResultItem {
  return {
    kind: 'file',
    id: `file:${overrides.path}`,
    label: overrides.path,
    score: 10,
    matchReasons: [{ field: 'path', term: 'foo', weight: 8, text: overrides.path }],
    ...overrides,
  }
}

function symbolResult(overrides: Partial<SearchResultItem> & { path: string; nodeId: string }): SearchResultItem {
  return {
    kind: 'symbol',
    id: overrides.nodeId,
    label: overrides.nodeId,
    score: 10,
    matchReasons: [{ field: 'symbolName', term: 'foo', weight: 12, text: overrides.nodeId }],
    ...overrides,
  }
}

function ranking(results: SearchResultItem[]): RankingInput {
  return { status: 'ok', results, warnings: [] }
}

describe('buildQueryPlan', () => {
  it('is deterministic', () => {
    const a = buildQueryPlan({ originalQuery: '  add   a field  ', mode: 'general' })
    const b = buildQueryPlan({ originalQuery: '  add   a field  ', mode: 'general' })
    expect(a).toEqual(b)
  })

  it('extracts simple raw terms', () => {
    const plan = buildQueryPlan({ originalQuery: 'add a field to User', mode: 'general' })
    expect(plan.terms.raw).toEqual(expect.arrayContaining(['add', 'field', 'user']))
  })

  it('preserves symbol-like terms', () => {
    const plan = buildQueryPlan({ originalQuery: 'update WorkspaceEditorShell', mode: 'general' })
    expect(plan.terms.symbolLike).toContain('WorkspaceEditorShell')
  })

  it('preserves path-like terms', () => {
    const plan = buildQueryPlan({ originalQuery: 'edit src/userTypes.ts', mode: 'general' })
    expect(plan.terms.pathLike.some((t) => t.toLowerCase().includes('usertypes.ts'))).toBe(true)
  })

  it('preserves route-like terms', () => {
    const plan = buildQueryPlan({ originalQuery: 'navigate to /workspaces/new', mode: 'general' })
    expect(plan.terms.routeLike).toContain('/workspaces/new')
  })
})

describe('rankCandidateFiles', () => {
  it('ranks candidates from search results, sorted by score desc', () => {
    const input = ranking([
      fileResult({ path: 'src/a.ts', score: 5 }),
      fileResult({ path: 'src/b.ts', score: 20 }),
    ])
    const result = rankCandidateFiles(input, null)
    expect(result.map((c) => c.path)).toEqual(['src/b.ts', 'src/a.ts'])
    for (const candidate of result) {
      expect(candidate.reasons.length).toBeGreaterThan(0)
      expect(candidate.retained).toBe(true)
    }
  })

  it('penalizes a weakly-matched generic top-level file when a stronger candidate exists', () => {
    const input = ranking([
      fileResult({
        path: 'README.md',
        score: 15,
        matchReasons: [{ field: 'path', term: 'add', weight: 15, text: 'README.md' }],
      }),
      fileResult({
        path: 'src/userTypes.ts',
        score: 15,
        matchReasons: [{ field: 'symbolName', term: 'user', weight: 15, text: 'User' }],
      }),
    ])
    const result = rankCandidateFiles(input, null)
    const readme = result.find((c) => c.path === 'README.md')!
    const userTypes = result.find((c) => c.path === 'src/userTypes.ts')!
    expect(readme.score).toBeLessThan(userTypes.score)
    expect(readme.reasons.some((r) => r.includes('penalized'))).toBe(true)
  })

  it('does not penalize a generic file with strong term overlap', () => {
    const input = ranking([
      fileResult({
        path: 'README.md',
        score: 15,
        matchReasons: [
          { field: 'path', term: 'add', weight: 8, text: 'README.md' },
          { field: 'path', term: 'field', weight: 8, text: 'README.md' },
        ],
      }),
    ])
    const result = rankCandidateFiles(input, null)
    expect(result[0].reasons.some((r) => r.includes('penalized'))).toBe(false)
  })

  it('enforces the candidate-file cap and records drop reasons', () => {
    const input = ranking([
      fileResult({ path: 'src/a.ts', score: 30 }),
      fileResult({ path: 'src/b.ts', score: 20 }),
      fileResult({ path: 'src/c.ts', score: 10 }),
    ])
    const result = rankCandidateFiles(input, 1)
    expect(result.filter((c) => c.retained)).toHaveLength(1)
    const dropped = result.filter((c) => !c.retained)
    expect(dropped).toHaveLength(2)
    for (const entry of dropped) {
      expect(entry.droppedReason).toBe('cap exceeded (--max-candidate-files)')
    }
  })
})

describe('rankCandidateNodes', () => {
  it('ranks file and symbol candidates from search results', () => {
    const input = ranking([
      fileResult({ path: 'src/a.ts', score: 5 }),
      symbolResult({ path: 'src/a.ts', nodeId: 'symbol:src/a.ts#Foo', score: 25 }),
    ])
    const result = rankCandidateNodes(input)
    expect(result[0].nodeId).toBe('symbol:src/a.ts#Foo')
    expect(result[0].kind).toBe('symbol')
    expect(result.every((c) => c.reasons.length > 0)).toBe(true)
  })

  it('preserves general ranking and records no mode effects', () => {
    const input = ranking([
      fileResult({ path: 'src/a.ts', score: 20 }),
      fileResult({ path: 'src/b.ts', score: 10 }),
    ])
    const files = rankCandidateFiles(input, null, 'general')
    const nodes = rankCandidateNodes(input, 'general')
    expect(files.map((candidate) => [candidate.path, candidate.score])).toEqual([
      ['src/a.ts', 20],
      ['src/b.ts', 10],
    ])
    expect(buildModeEffects('general', files, nodes)).toMatchObject({ applied: false, effects: [] })
  })

  it('applies small deterministic feature-add edit-guidance adjustments', () => {
    const classification = (editGuidance: 'safe-primary-edit-target' | 'avoid-primary-edit-target') => [{
      role: 'canonical-type' as const,
      editGuidance,
      readiness: 'ready' as const,
      uncertainty: 'certain' as const,
    }]
    const input = ranking([
      fileResult({ path: 'src/safe.ts', score: 10, classificationRoles: classification('safe-primary-edit-target') }),
      fileResult({ path: 'docs/guide.md', score: 12, classificationRoles: classification('avoid-primary-edit-target') }),
    ])
    const result = rankCandidateFiles(input, null, 'feature-add')
    expect(result[0].path).toBe('src/safe.ts')
    expect(result[0].modeAdjustment).toBe(6)
    expect(result.find((candidate) => candidate.path === 'docs/guide.md')?.modeAdjustment).toBe(-4)
  })

  it('applies subsystem clustering relative to the strongest base candidate', () => {
    const input = ranking([
      fileResult({ path: 'src/context/a.ts', score: 20 }),
      fileResult({ path: 'src/context/b.ts', score: 18 }),
      fileResult({ path: 'src/other/c.ts', score: 18 }),
    ])
    const result = rankCandidateFiles(input, null, 'subsystem')
    expect(result.find((candidate) => candidate.path === 'src/context/b.ts')?.modeAdjustment).toBe(4)
    expect(result.find((candidate) => candidate.path === 'src/other/c.ts')?.modeAdjustment).toBe(0)
  })
})

describe('selectPrimaryFocus', () => {
  const node = (nodeId: string, score: number): CandidateNode => ({
    nodeId,
    kind: 'symbol',
    label: nodeId,
    score,
    reasons: [`matched ${nodeId}`],
    matchedTerms: ['foo'],
    retained: true,
  })

  it('selects one focus node with high confidence for a clear winner', () => {
    const focus = selectPrimaryFocus([node('symbol:a#Foo', 50), node('symbol:b#Bar', 5)])
    expect(focus.focusNodeId).toBe('symbol:a#Foo')
    expect(focus.confidence).toBe('high')
    expect(focus.selectionMode).toBe('single-best')
    expect(focus.ambiguityNotes).toEqual([])
  })

  it('records ambiguity for close candidates while still selecting exactly one focus', () => {
    const focus = selectPrimaryFocus([node('symbol:a#Foo', 20), node('symbol:b#Bar', 19)])
    expect(typeof focus.focusNodeId).toBe('string')
    expect(focus.confidence).toBe('low')
    expect(focus.selectionMode).toBe('best-effort-ambiguous')
    expect(focus.ambiguityNotes.length).toBeGreaterThan(0)
  })

  it('never returns multiple focus nodes', () => {
    const candidates = [node('a', 50), node('b', 49), node('c', 48), node('d', 47), node('e', 46)]
    const focus = selectPrimaryFocus(candidates)
    expect(typeof focus.focusNodeId === 'string' || focus.focusNodeId === null).toBe(true)
  })

  it('reports no focus when no candidates exist', () => {
    const focus = selectPrimaryFocus([])
    expect(focus.focusNodeId).toBeNull()
    expect(focus.confidence).toBe('none')
    expect(focus.selectionMode).toBe('none')
  })
})

describe('selectGraphNeighborhood', () => {
  const codeGraph: CodeGraph = {
    artifactKind: 'code-graph',
    schemaVersion: '1.0.0',
    createdAt: new Date().toISOString(),
    nodes: [
      { id: 'file:src/a.ts', kind: 'file', label: 'a.ts', path: 'src/a.ts' },
      { id: 'symbol:src/a.ts#Foo', kind: 'symbol', label: 'Foo', path: 'src/a.ts' },
      { id: 'file:src/b.ts', kind: 'file', label: 'b.ts', path: 'src/b.ts' },
      { id: 'file:src/c.ts', kind: 'file', label: 'c.ts', path: 'src/c.ts' },
    ],
    edges: [
      { id: 'e1', source: 'file:src/a.ts', target: 'symbol:src/a.ts#Foo', kind: 'defines' },
      { id: 'e2', source: 'file:src/a.ts', target: 'file:src/b.ts', kind: 'imports' },
      { id: 'e3', source: 'file:src/a.ts', target: 'file:src/c.ts', kind: 'imports' },
    ],
    summary: { nodeCount: 4, symbolNodeCount: 1, fileNodeCount: 3, edgeCount: 3 },
  }

  it('includes the focus node in the selected graph', () => {
    const focus = { focusNodeId: 'file:src/a.ts', focusFilePath: 'src/a.ts', selectionMode: 'single-best' as const, confidence: 'high' as const, reasons: [], ambiguityNotes: [], warnings: [] }
    const selected = selectGraphNeighborhood({ codeGraph, focus, maxGraphNodes: null, maxGraphEdges: null })
    expect(selected.nodes.some((n) => n.nodeId === 'file:src/a.ts' && n.reasons.includes('primary focus node'))).toBe(true)
  })

  it('edges connect only retained nodes', () => {
    const focus = { focusNodeId: 'file:src/a.ts', focusFilePath: 'src/a.ts', selectionMode: 'single-best' as const, confidence: 'high' as const, reasons: [], ambiguityNotes: [], warnings: [] }
    const selected = selectGraphNeighborhood({ codeGraph, focus, maxGraphNodes: null, maxGraphEdges: null })
    const nodeIds = new Set(selected.nodes.map((n) => n.nodeId))
    for (const edge of selected.edges) {
      expect(nodeIds.has(edge.from)).toBe(true)
      expect(nodeIds.has(edge.to)).toBe(true)
    }
  })

  it('enforces the graph-node cap while preserving the focus node', () => {
    const focus = { focusNodeId: 'file:src/a.ts', focusFilePath: 'src/a.ts', selectionMode: 'single-best' as const, confidence: 'high' as const, reasons: [], ambiguityNotes: [], warnings: [] }
    const selected = selectGraphNeighborhood({ codeGraph, focus, maxGraphNodes: 2, maxGraphEdges: null })
    expect(selected.nodes).toHaveLength(2)
    expect(selected.nodes.some((n) => n.nodeId === 'file:src/a.ts')).toBe(true)
    expect(selected.omittedNodeCount).toBeGreaterThan(0)
  })

  it('enforces the graph-edge cap', () => {
    const focus = { focusNodeId: 'file:src/a.ts', focusFilePath: 'src/a.ts', selectionMode: 'single-best' as const, confidence: 'high' as const, reasons: [], ambiguityNotes: [], warnings: [] }
    const selected = selectGraphNeighborhood({ codeGraph, focus, maxGraphNodes: null, maxGraphEdges: 1 })
    expect(selected.edges).toHaveLength(1)
    expect(selected.omittedEdgeCount).toBeGreaterThan(0)
  })

  it('produces no graph neighborhood when there is no focus', () => {
    const focus = { focusNodeId: null, focusFilePath: null, selectionMode: 'none' as const, confidence: 'none' as const, reasons: [], ambiguityNotes: [], warnings: [] }
    const selected = selectGraphNeighborhood({ codeGraph, focus, maxGraphNodes: null, maxGraphEdges: null })
    expect(selected.nodes).toEqual([])
    expect(selected.edges).toEqual([])
    expect(selected.warnings.length).toBeGreaterThan(0)
  })
})

describe('computeContextAdequacy', () => {
  const strongFocus = { focusNodeId: 'a', focusFilePath: 'a.ts', selectionMode: 'single-best' as const, confidence: 'high' as const, reasons: [], ambiguityNotes: [], warnings: [] }
  const ambiguousFocus = { focusNodeId: 'a', focusFilePath: 'a.ts', selectionMode: 'best-effort-ambiguous' as const, confidence: 'low' as const, reasons: [], ambiguityNotes: ['runner-up b scored close'], warnings: [] }
  const noFocus = { focusNodeId: null, focusFilePath: null, selectionMode: 'none' as const, confidence: 'none' as const, reasons: [], ambiguityNotes: [], warnings: [] }

  it('is sufficient for implementation with strong focus and graph evidence', () => {
    const adequacy = computeContextAdequacy({
      focus: strongFocus,
      selectedGraph: { nodes: [{ nodeId: 'a', kind: 'file', label: 'a', reasons: [] }, { nodeId: 'b', kind: 'file', label: 'b', reasons: [] }], edges: [], omittedNodeCount: 0, omittedEdgeCount: 0, warnings: [] },
    })
    expect(adequacy.status).toBe('context sufficient for implementation')
  })

  it('is sufficient with assumptions when ambiguous', () => {
    const adequacy = computeContextAdequacy({
      focus: ambiguousFocus,
      selectedGraph: { nodes: [{ nodeId: 'a', kind: 'file', label: 'a', reasons: [] }], edges: [], omittedNodeCount: 0, omittedEdgeCount: 0, warnings: [] },
    })
    expect(adequacy.status).toBe('context sufficient with listed assumptions')
    expect(adequacy.assumptions.some((a) => a.includes('ambiguous'))).toBe(true)
  })

  it('is insufficient when no focus was found', () => {
    const adequacy = computeContextAdequacy({
      focus: noFocus,
      selectedGraph: { nodes: [], edges: [], omittedNodeCount: 0, omittedEdgeCount: 0, warnings: [] },
    })
    expect(adequacy.status).toBe('context insufficient and more retrieval required')
  })

  it('uses the conflict status only when explicit conflict evidence is present', () => {
    const adequacy = computeContextAdequacy({
      focus: strongFocus,
      selectedGraph: { nodes: [{ nodeId: 'a', kind: 'file', label: 'a', reasons: [] }], edges: [], omittedNodeCount: 0, omittedEdgeCount: 0, warnings: [] },
      conflicts: {
        status: 'conflict',
        warnings: [],
        conflicts: [{
          id: 'conflict-1',
          status: 'conflict',
          reason: 'Explicit edit guidance conflicts.',
          evidenceRefs: [],
          affectedFiles: ['a.ts', 'b.ts'],
          affectedNodes: ['a', 'b'],
          candidates: [],
          recommendedNextAction: 'Choose the canonical owner.',
        }],
      },
    })
    expect(adequacy.status).toBe('context conflict found and user or upstream stage decision required')
    expect(adequacy.gaps[0]).toContain('Choose the canonical owner')
  })
})
