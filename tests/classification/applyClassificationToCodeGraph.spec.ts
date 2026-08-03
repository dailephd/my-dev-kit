import { describe, expect, it } from 'vitest'
import { applyClassificationToCodeGraph } from '../../src/classification/applyClassificationToCodeGraph.js'
import type { CompactClassificationMetadata } from '../../src/classification/buildClassificationRefsBySymbolId.js'
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'

function buildGraph(): CodeGraph {
  return {
    artifactKind: 'code-graph',
    schemaVersion: '1.0.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    nodes: [
      { id: 'file:src/models.ts', kind: 'file', label: 'models.ts', path: 'src/models.ts' },
      { id: 'symbol:src/models.ts#User', kind: 'symbol', label: 'User', path: 'src/models.ts' },
      { id: 'symbol:src/models.ts#Unclassified', kind: 'symbol', label: 'Unclassified', path: 'src/models.ts' },
    ],
    edges: [],
    summary: { nodeCount: 3, edgeCount: 0, fileNodeCount: 1, symbolNodeCount: 2 },
  }
}

describe('applyClassificationToCodeGraph', () => {
  it('TST-041: only symbol-kind nodes receive classificationRoles/classificationRefs; other nodes are untouched', () => {
    const graph = buildGraph()
    const metadata: CompactClassificationMetadata = {
      classificationRoles: [
        { role: 'database-model', editGuidance: 'avoid-primary-edit-target', readiness: 'ready', uncertainty: 'certain' },
      ],
      classificationRefs: [{ artifact: 'classification.json', artifactKind: 'my-dev-kit-v1-classification', id: 'classification:symbol:symbol:src/models.ts#User', path: 'classification.json' }],
    }
    const bySymbolId = new Map([['symbol:src/models.ts#User', metadata]])

    const result = applyClassificationToCodeGraph(graph, bySymbolId)

    const fileNode = result.nodes.find((n) => n.id === 'file:src/models.ts')
    const classifiedSymbol = result.nodes.find((n) => n.id === 'symbol:src/models.ts#User')
    const unclassifiedSymbol = result.nodes.find((n) => n.id === 'symbol:src/models.ts#Unclassified')

    expect(fileNode).toEqual(graph.nodes[0])
    expect(fileNode?.classificationRoles).toBeUndefined()

    expect(classifiedSymbol?.classificationRoles).toEqual(metadata.classificationRoles)
    expect(classifiedSymbol?.classificationRefs).toEqual(metadata.classificationRefs)

    expect(unclassifiedSymbol).toEqual(graph.nodes[2])
    expect(unclassifiedSymbol?.classificationRoles).toBeUndefined()
  })

  it('v1.12.0 Batch 1: an explicit eligibleKinds list projects onto android-project/android-module nodes without touching symbol nodes', () => {
    const graph: CodeGraph = {
      ...buildGraph(),
      nodes: [
        ...buildGraph().nodes,
        { id: 'android-project:root', kind: 'android-project', label: 'Android project' },
        { id: 'android-module:app', kind: 'android-module', label: 'app', path: 'app' },
      ],
    }
    const metadata: CompactClassificationMetadata = {
      classificationRoles: [{ role: 'android-project', editGuidance: 'read-only-reference', readiness: 'ready', uncertainty: 'certain' }],
      classificationRefs: [{ artifact: 'classification.json', artifactKind: 'my-dev-kit-v1-classification', id: 'classification:graph-node:android-project:root', path: 'classification.json' }],
    }
    const byNodeId = new Map([['android-project:root', metadata]])

    const result = applyClassificationToCodeGraph(graph, byNodeId, ['android-project', 'android-module'])

    expect(result.nodes.find((n) => n.id === 'android-project:root')?.classificationRoles).toEqual(metadata.classificationRoles)
    expect(result.nodes.find((n) => n.id === 'android-module:app')?.classificationRoles).toBeUndefined()
    // Symbol nodes are untouched because 'symbol' is not in the passed eligibleKinds.
    expect(result.nodes.find((n) => n.id === 'symbol:src/models.ts#User')?.classificationRoles).toBeUndefined()
  })
})
