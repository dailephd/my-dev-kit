import type { CodeGraphEdgeKind, CodeGraphNodeKind } from '../../src/graph/codeGraphTypes.js'
import {
  MODEL_VIEW_LINEAGE_ARTIFACT_KIND,
  MODEL_VIEW_LINEAGE_SCHEMA_VERSION,
  type ModelViewLineageArtifact,
  type ModelViewLineageEdgeKind,
  type ModelViewLineageNodeKind,
} from '../../src/lineage/index.js'
import { describe, expect, it } from 'vitest'

describe('model-view lineage contract types', () => {
  it('can construct an empty lineage artifact', () => {
    const artifact: ModelViewLineageArtifact = {
      artifactKind: MODEL_VIEW_LINEAGE_ARTIFACT_KIND,
      schemaVersion: MODEL_VIEW_LINEAGE_SCHEMA_VERSION,
      createdAt: '2026-06-04T00:00:00.000Z',
      nodes: [],
      edges: [],
      warnings: [],
      summary: {
        nodeCount: 0,
        edgeCount: 0,
        evidenceCount: 0,
        warningCount: 0,
      },
    }
    expect(artifact.artifactKind).toBe('my-dev-kit-v1-model-view-lineage')
  })

  it('can construct static lineage nodes and evidence-backed edges', () => {
    const artifact: ModelViewLineageArtifact = {
      artifactKind: MODEL_VIEW_LINEAGE_ARTIFACT_KIND,
      schemaVersion: MODEL_VIEW_LINEAGE_SCHEMA_VERSION,
      createdAt: '2026-06-04T00:00:00.000Z',
      nodes: [
        {
          id: 'lineage:data-entity:entity:User',
          kind: 'data-entity',
          label: 'User',
          confidence: 'explicit',
          dataModelEntityId: 'entity:User',
          dataModelFieldId: null,
          evidenceRefs: [{ filePath: 'src/models.ts', dataModelEntityId: 'entity:User', line: 1 }],
          warnings: [],
        },
        {
          id: 'lineage:data-field:field:User.email',
          kind: 'data-field',
          label: 'User.email',
          confidence: 'explicit',
          dataModelEntityId: 'entity:User',
          dataModelFieldId: 'field:User.email',
          evidenceRefs: [{ filePath: 'src/models.ts', dataModelFieldId: 'field:User.email', line: 2 }],
          warnings: [],
        },
        {
          id: 'lineage:transformation:src/view.tsx#buildUserViewModel',
          kind: 'transformation',
          label: 'buildUserViewModel',
          confidence: 'explicit',
          dataModelEntityId: null,
          dataModelFieldId: null,
          evidenceRefs: [{ filePath: 'src/view.tsx', line: 5 }],
          warnings: [],
        },
        {
          id: 'lineage:view-model:src/view.tsx#buildUserViewModel.email',
          kind: 'view-model',
          label: 'buildUserViewModel.email',
          confidence: 'explicit',
          dataModelEntityId: 'entity:User',
          dataModelFieldId: 'field:User.email',
          evidenceRefs: [{ filePath: 'src/view.tsx', line: 6 }],
          warnings: [],
        },
        {
          id: 'lineage:component:src/view.tsx#UserCard',
          kind: 'component',
          label: 'UserCard',
          confidence: 'explicit',
          dataModelEntityId: null,
          dataModelFieldId: null,
          evidenceRefs: [{ filePath: 'src/view.tsx', line: 10 }],
          warnings: [],
        },
        {
          id: 'lineage:rendered-field:src/view.tsx#UserCard.email',
          kind: 'rendered-field',
          label: 'UserCard.email',
          confidence: 'explicit',
          dataModelEntityId: 'entity:User',
          dataModelFieldId: 'field:User.email',
          evidenceRefs: [{ filePath: 'src/view.tsx', line: 11 }],
          warnings: [],
        },
      ],
      edges: [
        {
          id: 'lineage-edge:reads-field:a->b',
          kind: 'reads-field',
          source: 'lineage:data-field:field:User.email',
          target: 'lineage:transformation:src/view.tsx#buildUserViewModel',
          confidence: 'explicit',
          evidenceRefs: [{ filePath: 'src/view.tsx', dataModelFieldId: 'field:User.email', line: 6 }],
          warnings: [],
        },
      ],
      warnings: [{
        kind: 'partial-lineage',
        message: 'Lineage warning.',
        evidenceRefs: [{ filePath: 'src/view.tsx', line: 12 }],
      }],
      summary: {
        nodeCount: 6,
        edgeCount: 1,
        evidenceCount: 7,
        warningCount: 1,
      },
    }

    expect(artifact.nodes.some((node) => node.kind === 'component')).toBe(true)
    expect(artifact.nodes.some((node) => node.kind === 'rendered-field')).toBe(true)
    expect(artifact.edges[0]?.evidenceRefs[0]?.dataModelFieldId).toBe('field:User.email')
  })

  it('lineage graph types do not require code-graph node or edge kinds and remain separate from data-model artifacts', () => {
    const nodeKindsOnly: Exclude<ModelViewLineageNodeKind, CodeGraphNodeKind>[] = [
      'data-entity',
      'data-field',
      'transformation',
      'view-model',
      'component',
      'component-prop',
      'rendered-field',
      'unknown',
    ]
    const edgeKindsOnly: Exclude<ModelViewLineageEdgeKind, CodeGraphEdgeKind>[] = [
      'reads-field',
      'derives-field',
      'creates-view-model',
      'passes-prop',
      'renders-field',
      'relates-to',
      'unknown',
    ]
    expect(nodeKindsOnly).toHaveLength(8)
    expect(edgeKindsOnly).toHaveLength(7)
    expect(MODEL_VIEW_LINEAGE_ARTIFACT_KIND).not.toBe('my-dev-kit-v1-data-model')
    expect(MODEL_VIEW_LINEAGE_ARTIFACT_KIND).not.toBe('my-dev-kit-v1-data-model-graph')
  })
})
