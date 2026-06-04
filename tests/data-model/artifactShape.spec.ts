import { describe, expect, it } from 'vitest'
import type { CodeGraphEdgeKind, CodeGraphNodeKind } from '../../src/graph/codeGraphTypes.js'
import {
  DATA_MODEL_ARTIFACT_KIND,
  DATA_MODEL_GRAPH_ARTIFACT_KIND,
  DATA_MODEL_SCHEMA_VERSION,
  type DataModelArtifact,
  type DataModelGraphArtifact,
  type DataModelGraphEdgeKind,
  type DataModelGraphNodeKind,
  type DataModelRelationship,
  type DataModelWarning,
} from '../../src/data-model/index.js'

function makeWarning(kind: DataModelWarning['kind'], message: string): DataModelWarning {
  return {
    kind,
    message,
    sourceRefs: [{ filePath: 'src/models/user.ts', line: 1 }],
  }
}

describe('data-model artifact shape expectations', () => {
  it('supports multiple entities, fields, relationships, warnings, and summary counts', () => {
    const relationship: DataModelRelationship = {
      id: 'relationship:one-to-many:User:-:Post:userId:0',
      kind: 'one-to-many',
      fromEntityId: 'entity:User',
      toEntityId: 'entity:Post',
      fromFieldId: null,
      toFieldId: 'field:Post.userId',
      confidence: 'explicit',
      sourceRefs: [{ filePath: 'src/models/post.ts', line: 22 }],
      warnings: [makeWarning('partial-extraction', 'Relationship target metadata is partial.')],
    }

    const artifact: DataModelArtifact = {
      artifactKind: DATA_MODEL_ARTIFACT_KIND,
      schemaVersion: DATA_MODEL_SCHEMA_VERSION,
      createdAt: '2026-06-04T00:00:00.000Z',
      entities: [
        {
          id: 'entity:Post',
          name: 'Post',
          kind: 'schema-model',
          fields: [
            {
              id: 'field:Post.id',
              name: 'id',
              typeText: 'string',
              optional: false,
              nullable: false,
              cardinality: 'one',
              sourceRefs: [{ filePath: 'src/models/post.ts', line: 2 }],
              warnings: [],
            },
            {
              id: 'field:Post.userId',
              name: 'userId',
              typeText: 'string',
              optional: false,
              nullable: false,
              cardinality: 'one',
              sourceRefs: [{ filePath: 'src/models/post.ts', line: 3 }],
              warnings: [makeWarning('missing-source', 'No symbol index reference was available.')],
            },
          ],
          relationships: [relationship.id],
          sourceRefs: [{ filePath: 'src/models/post.ts', line: 1 }],
          warnings: [makeWarning('unsupported-pattern', 'Decorator metadata was skipped.')],
        },
        {
          id: 'entity:User',
          name: 'User',
          kind: 'canonical-model',
          fields: [
            {
              id: 'field:User.id',
              name: 'id',
              typeText: 'string',
              optional: false,
              nullable: false,
              cardinality: 'one',
              sourceRefs: [{ filePath: 'src/models/user.ts', line: 2 }],
              warnings: [],
            },
          ],
          relationships: [relationship.id],
          sourceRefs: [{ filePath: 'src/models/user.ts', line: 1 }],
          warnings: [makeWarning('ambiguous-relationship', 'Association target could not be narrowed.')],
        },
      ],
      relationships: [relationship],
      warnings: [makeWarning('skipped-dynamic-pattern', 'Dynamic model assembly was not interpreted.')],
      summary: {
        entityCount: 2,
        fieldCount: 3,
        relationshipCount: 1,
        warningCount: 5,
      },
    }

    expect(artifact.entities).toHaveLength(2)
    expect(artifact.entities[0].fields).toHaveLength(2)
    expect(artifact.relationships[0].toFieldId).toBe('field:Post.userId')
    expect(artifact.summary).toEqual({
      entityCount: 2,
      fieldCount: 3,
      relationshipCount: 1,
      warningCount: 5,
    })
  })

  it('documents deterministic identity examples', () => {
    expect('entity:User').toMatch(/^entity:/)
    expect('field:User.email').toBe('field:User.email')
    expect('relationship:one-to-many:User:-:Post:userId:0').toContain('relationship:one-to-many')
    expect('data-model-entity:User').not.toContain('symbol:')
    expect('data-model-edge:has-field:User.email').not.toContain('--')
  })

  it('keeps data-model graph kinds independent from code graph kinds', () => {
    const nodeKind: Exclude<DataModelGraphNodeKind, CodeGraphNodeKind> = 'field'
    const edgeKind: Exclude<DataModelGraphEdgeKind, CodeGraphEdgeKind> = 'derives-from'

    expect(nodeKind).toBe('field')
    expect(edgeKind).toBe('derives-from')
  })

  it('supports all expected warning categories', () => {
    const warnings = [
      makeWarning('unsupported-pattern', 'unsupported'),
      makeWarning('ambiguous-relationship', 'ambiguous'),
      makeWarning('skipped-dynamic-pattern', 'dynamic'),
      makeWarning('partial-extraction', 'partial'),
      makeWarning('missing-source', 'missing'),
    ]

    expect(warnings.map((warning) => warning.kind)).toEqual([
      'unsupported-pattern',
      'ambiguous-relationship',
      'skipped-dynamic-pattern',
      'partial-extraction',
      'missing-source',
    ])
  })

  it('can construct data-model graph records without code-graph types', () => {
    const graph: DataModelGraphArtifact = {
      artifactKind: DATA_MODEL_GRAPH_ARTIFACT_KIND,
      schemaVersion: DATA_MODEL_SCHEMA_VERSION,
      createdAt: '2026-06-04T00:00:00.000Z',
      nodes: [
        {
          id: 'data-model-entity:User',
          kind: 'entity',
          label: 'User',
          entityId: 'entity:User',
          fieldId: null,
          parentEntityId: null,
          sourceRefs: [],
          warnings: [],
        },
      ],
      edges: [
        {
          id: 'data-model-edge:has-field:User.id',
          source: 'data-model-entity:User',
          target: 'data-model-field:User.id',
          kind: 'has-field',
          relationshipId: null,
          sourceRefs: [],
          warnings: [],
        },
      ],
      warnings: [],
      summary: {
        nodeCount: 1,
        edgeCount: 1,
        entityNodeCount: 1,
        fieldNodeCount: 0,
        relationshipEdgeCount: 0,
        warningCount: 0,
      },
    }

    expect(graph.nodes[0].id).toBe('data-model-entity:User')
    expect(graph.edges[0].kind).toBe('has-field')
  })
})
