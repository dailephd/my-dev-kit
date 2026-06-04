import { describe, expect, it } from 'vitest'
import type { CodeGraphEdgeKind, CodeGraphNodeKind } from '../../src/graph/codeGraphTypes.js'
import {
  buildDataModelArtifact,
  buildDataModelGraph,
  type DataModelGraphEdgeKind,
  type DataModelGraphNodeKind,
} from '../../src/data-model/index.js'
import type { NormalizedDataModelRecordSet } from '../../src/data-model/index.js'

function makeArtifact() {
  const records: NormalizedDataModelRecordSet = {
    entities: [
      {
        name: 'User',
        kind: 'canonical-model',
        sourceRefs: [{ filePath: 'src/models/user.ts', line: 1 }],
        warnings: [],
      },
      {
        name: 'Post',
        kind: 'schema-model',
        sourceRefs: [{ filePath: 'src/models/post.ts', line: 1 }],
        warnings: [],
      },
    ],
    fields: [
      {
        entityName: 'User',
        fieldName: 'id',
        typeText: 'string',
        optional: false,
        nullable: false,
        cardinality: 'one',
        sourceRefs: [{ filePath: 'src/models/user.ts', line: 2 }],
        warnings: [],
      },
      {
        entityName: 'Post',
        fieldName: 'userId',
        typeText: 'string',
        optional: false,
        nullable: false,
        cardinality: 'one',
        sourceRefs: [{ filePath: 'src/models/post.ts', line: 2 }],
        warnings: [],
      },
    ],
    relationships: [
      {
        fromEntityName: 'User',
        toEntityName: 'Post',
        kind: 'one-to-many',
        fromFieldName: null,
        toFieldName: 'userId',
        confidence: 'explicit',
        sourceRefs: [{ filePath: 'src/models/post.ts', line: 2 }],
        warnings: [],
      },
    ],
    warnings: [],
  }

  return buildDataModelArtifact({
    records,
    createdAt: '2026-06-04T00:00:00.000Z',
  })
}

describe('buildDataModelGraph', () => {
  it('builds an empty graph artifact', () => {
    const graph = buildDataModelGraph({
      artifact: buildDataModelArtifact({
        records: { entities: [], fields: [], relationships: [], warnings: [] },
        createdAt: '2026-06-04T00:00:00.000Z',
      }),
    })

    expect(graph.nodes).toEqual([])
    expect(graph.edges).toEqual([])
  })

  it('builds entity nodes, field nodes, has-field edges, and relationship edges', () => {
    const graph = buildDataModelGraph({ artifact: makeArtifact() })

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'data-model-entity:Post',
      'data-model-entity:User',
      'data-model-field:Post.userId',
      'data-model-field:User.id',
    ])
    expect(graph.edges.map((edge) => edge.id)).toEqual([
      'data-model-edge:has-field:Post.userId',
      'data-model-edge:has-field:User.id',
      'data-model-edge:relates-to:User:Post:0',
    ])
  })

  it('preserves source refs where available', () => {
    const graph = buildDataModelGraph({ artifact: makeArtifact() })

    expect(graph.nodes[0].sourceRefs[0].filePath).toContain('post.ts')
    expect(graph.edges[2].sourceRefs[0].filePath).toContain('post.ts')
  })

  it('produces correct summary counts and deterministic ordering', () => {
    const first = buildDataModelGraph({ artifact: makeArtifact() })
    const second = buildDataModelGraph({ artifact: makeArtifact() })

    expect(first.summary).toEqual({
      nodeCount: 4,
      edgeCount: 3,
      entityNodeCount: 2,
      fieldNodeCount: 2,
      relationshipEdgeCount: 1,
      warningCount: 0,
    })
    expect(second).toEqual(first)
  })

  it('does not require code graph types', () => {
    const nodeKind: Exclude<DataModelGraphNodeKind, CodeGraphNodeKind> = 'entity'
    const edgeKind: Exclude<DataModelGraphEdgeKind, CodeGraphEdgeKind> = 'relates-to'

    expect(nodeKind).toBe('entity')
    expect(edgeKind).toBe('relates-to')
  })

  it('does not mutate the input artifact', () => {
    const artifact = makeArtifact()
    const snapshot = JSON.parse(JSON.stringify(artifact))

    buildDataModelGraph({ artifact })

    expect(artifact).toEqual(snapshot)
  })
})
