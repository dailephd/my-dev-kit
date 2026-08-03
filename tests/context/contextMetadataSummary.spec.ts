import { describe, expect, it } from 'vitest'
import { buildSemanticSummary } from '../../src/context/metadataSummary.js'
import { buildClassificationSummary } from '../../src/context/classificationSummary.js'
import { buildArtifactReferenceSummary } from '../../src/context/artifactReferenceSummary.js'
import { buildPruning } from '../../src/context/pruningPolicy.js'
import type { CandidateFile, CandidateNode, ContextFocus, RetentionSummary, SelectedGraph, SelectedSource, SelectedSourceBundles } from '../../src/context/types.js'
import type { ClassificationArtifact, ClassificationEntry } from '../../src/classification/classificationTypes.js'
import type { ResolvedIndexManifest } from '../../src/indexing/readIndexManifest.js'

function candidateNode(overrides: Partial<CandidateNode> & { nodeId: string }): CandidateNode {
  return { kind: 'symbol', label: overrides.nodeId, score: 10, reasons: [], matchedTerms: [], retained: true, ...overrides }
}

function candidateFile(overrides: Partial<CandidateFile> & { path: string }): CandidateFile {
  return { score: 10, reasons: [], matchedTerms: [], retained: true, ...overrides }
}

const emptyFocus: ContextFocus = {
  focusNodeId: null,
  focusFilePath: null,
  selectionMode: 'none',
  confidence: 'none',
  reasons: [],
  ambiguityNotes: [],
  warnings: [],
}

const emptySelectedGraph: SelectedGraph = { nodes: [], edges: [], omittedNodeCount: 0, omittedEdgeCount: 0, warnings: [] }

describe('buildSemanticSummary', () => {
  it('preserves roles/artifactRefs when present on a candidate node', () => {
    const node = candidateNode({
      nodeId: 'symbol:src/a.ts#Foo',
      semanticRoles: [{ role: 'data-entity', confidence: 'explicit', source: 'typescript-model-analyzer' }],
      artifactRefs: [{ artifact: 'data-model.json', artifactKind: 'data-model', id: 'entity:Foo' }],
    })
    const summary = buildSemanticSummary({ focus: emptyFocus, selectedGraph: emptySelectedGraph, candidateNodes: [node], candidateFiles: [] })
    expect(summary.available).toBe(true)
    expect(summary.summariesByNode['symbol:src/a.ts#Foo'].roles).toHaveLength(1)
    expect(summary.summariesByNode['symbol:src/a.ts#Foo'].artifactRefs).toHaveLength(1)
  })

  it('reports unavailable when nothing has semantic roles', () => {
    const node = candidateNode({ nodeId: 'symbol:src/a.ts#Foo' })
    const summary = buildSemanticSummary({ focus: emptyFocus, selectedGraph: emptySelectedGraph, candidateNodes: [node], candidateFiles: [] })
    expect(summary.available).toBe(false)
  })
})

describe('buildClassificationSummary', () => {
  const manifest = { projectRoot: '/root', analyzers: [] } as unknown as ResolvedIndexManifest['manifest']

  it('preserves editGuidance/readiness/riskLabels/uncertainty when a matching entry exists', () => {
    const entry: ClassificationEntry = {
      id: 'c1',
      targetId: 'symbol:src/a.ts#Foo',
      targetKind: 'symbol',
      filePath: 'src/a.ts',
      symbolName: 'Foo',
      nodeId: 'symbol:src/a.ts#Foo',
      classifications: [{ role: 'canonical-type', confidence: 'certain' }],
      editGuidance: 'inspect-before-edit',
      readiness: 'ready',
      risks: ['wrong-layer-risk'],
      evidence: [],
      uncertainty: 'certain',
      reason: 'test',
      sourceRefs: [],
      artifactRefs: [],
      warnings: [],
    }
    const artifact: ClassificationArtifact = {
      artifactKind: 'my-dev-kit-v1-classification',
      schemaVersion: '1.1.0',
      createdAt: new Date().toISOString(),
      entries: [entry],
      summary: { entryCount: 1, fileEntryCount: 0, symbolEntryCount: 1, warningCount: 0 },
    }
    const focus: ContextFocus = { ...emptyFocus, focusNodeId: 'symbol:src/a.ts#Foo', confidence: 'high', selectionMode: 'single-best' }
    const summary = buildClassificationSummary({
      classificationArtifact: artifact,
      indexDir: '/idx',
      manifest,
      focus,
      selectedGraph: emptySelectedGraph,
      candidateNodes: [],
      candidateFiles: [],
    })
    expect(summary.available).toBe(true)
    const entrySummary = summary.summariesByNode['symbol:src/a.ts#Foo']
    expect(entrySummary.editGuidance).toBe('inspect-before-edit')
    expect(entrySummary.readiness).toBe('ready')
    expect(entrySummary.risks).toEqual(['wrong-layer-risk'])
    expect(entrySummary.uncertainty).toBe('certain')
  })

  it('reports unavailable when classificationArtifact is null', () => {
    const summary = buildClassificationSummary({
      classificationArtifact: null,
      indexDir: '/idx',
      manifest,
      focus: emptyFocus,
      selectedGraph: emptySelectedGraph,
      candidateNodes: [],
      candidateFiles: [],
    })
    expect(summary.available).toBe(false)
    expect(summary.warnings.some((w) => w.includes('older index without classification'))).toBe(true)
  })
})

describe('buildArtifactReferenceSummary', () => {
  it('lists known artifacts and marks absent optional artifacts unavailable', () => {
    const resolved = {
      indexDir: '/idx',
      manifestPath: '/idx/manifest.json',
      manifest: { projectRoot: '/root', analyzers: [], warnings: [] },
      artifactPaths: { symbolIndex: '/idx/symbol-index.json', codeGraph: '/idx/code-graph.json', callGraph: null },
      semanticArtifactPaths: {
        dataModel: null,
        dataModelGraph: null,
        modelViewLineage: null,
        frontendSemantic: null,
        frontendReachability: null,
      },
    } as unknown as ResolvedIndexManifest

    const entries = buildArtifactReferenceSummary(resolved)
    const byKind = Object.fromEntries(entries.map((e) => [e.artifactKind, e]))
    expect(byKind.symbolIndex.available).toBe(true)
    expect(byKind.codeGraph.available).toBe(true)
    expect(byKind.dataModel.available).toBe(false)
    expect(byKind.classification.available).toBe(false)
  })
})

describe('buildPruning', () => {
  const retention: RetentionSummary = {
    retainedCandidateCount: 2,
    droppedCandidateCount: 1,
    retainedGraphNodeCount: 2,
    droppedGraphNodeCount: 0,
    retainedGraphEdgeCount: 1,
    droppedGraphEdgeCount: 0,
    capSettings: { maxCandidateFiles: null, maxGraphNodes: null, maxGraphEdges: null },
  }
  const selectedSource: SelectedSource = { slices: [], omittedSliceCount: 0, totalSelectedLines: 0, maxSourceSlices: 8, warnings: [], skipped: [] }
  const selectedSourceBundles: SelectedSourceBundles = { bundles: [], omittedBundleCount: 0, totalSelectedLines: 0, warnings: [] }
  const semanticSummary = { available: false, roles: [], artifactRefs: [], evidenceRefs: [], summariesByNode: {}, summariesByFile: {}, warnings: [] }
  const classificationSummary = {
    available: false,
    classificationArtifactPath: null,
    roles: [],
    refs: [],
    editGuidance: [],
    readiness: [],
    riskLabels: [],
    uncertainty: [],
    summariesByNode: {},
    summariesByFile: {},
    warnings: [],
  }

  it('is deterministic across repeated calls with identical inputs', () => {
    const a = buildPruning({ retention, selectedSource, selectedSourceBundles, semanticSummary, classificationSummary })
    const b = buildPruning({ retention, selectedSource, selectedSourceBundles, semanticSummary, classificationSummary })
    expect(a).toEqual(b)
  })

  it('aggregates retained/dropped counts directly from its inputs', () => {
    const pruning = buildPruning({ retention, selectedSource, selectedSourceBundles, semanticSummary, classificationSummary })
    expect(pruning.retainedCounts.candidateFiles).toBe(2)
    expect(pruning.droppedCounts.candidateFiles).toBe(1)
    expect(pruning.retainedCounts.graphNodes).toBe(2)
    expect(pruning.capSettings.maxSourceSlices).toBe(8)
  })
})
