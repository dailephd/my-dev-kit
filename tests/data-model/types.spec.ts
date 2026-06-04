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
} from '../../src/data-model/index.js'

const sourceRef = {
  filePath: 'src/models/user.ts',
  symbolId: 'symbol:src/models/user.ts#User',
  line: 12,
}

const warning = {
  kind: 'unsupported-pattern' as const,
  message: 'Dynamic schema registration was skipped.',
  sourceRefs: [sourceRef],
}

describe('data-model contract types', () => {
  it('can construct a minimal DataModelArtifact', () => {
    const artifact: DataModelArtifact = {
      artifactKind: DATA_MODEL_ARTIFACT_KIND,
      schemaVersion: DATA_MODEL_SCHEMA_VERSION,
      createdAt: '2026-06-04T00:00:00.000Z',
      entities: [],
      relationships: [],
      warnings: [],
      summary: {
        entityCount: 0,
        fieldCount: 0,
        relationshipCount: 0,
        warningCount: 0,
      },
    }

    expect(artifact.artifactKind).toBe(DATA_MODEL_ARTIFACT_KIND)
    expect(artifact.summary.entityCount).toBe(0)
  })

  it('can construct a minimal DataModelGraphArtifact', () => {
    const graph: DataModelGraphArtifact = {
      artifactKind: DATA_MODEL_GRAPH_ARTIFACT_KIND,
      schemaVersion: DATA_MODEL_SCHEMA_VERSION,
      createdAt: '2026-06-04T00:00:00.000Z',
      nodes: [],
      edges: [],
      warnings: [],
      summary: {
        nodeCount: 0,
        edgeCount: 0,
        entityNodeCount: 0,
        fieldNodeCount: 0,
        relationshipEdgeCount: 0,
        warningCount: 0,
      },
    }

    expect(graph.artifactKind).toBe(DATA_MODEL_GRAPH_ARTIFACT_KIND)
    expect(graph.summary.edgeCount).toBe(0)
  })

  it('artifact kind constants are stable strings', () => {
    expect(DATA_MODEL_ARTIFACT_KIND).toBe('my-dev-kit-v1-data-model')
    expect(DATA_MODEL_GRAPH_ARTIFACT_KIND).toBe('my-dev-kit-v1-data-model-graph')
  })

  it('schema version constant is present', () => {
    expect(DATA_MODEL_SCHEMA_VERSION).toBeTruthy()
    expect(typeof DATA_MODEL_SCHEMA_VERSION).toBe('string')
  })

  it('entity and field records can include source refs and warnings', () => {
    const artifact: DataModelArtifact = {
      artifactKind: DATA_MODEL_ARTIFACT_KIND,
      schemaVersion: DATA_MODEL_SCHEMA_VERSION,
      createdAt: '2026-06-04T00:00:00.000Z',
      entities: [
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
              sourceRefs: [sourceRef],
              warnings: [warning],
            },
          ],
          relationships: [],
          sourceRefs: [sourceRef],
          warnings: [warning],
        },
      ],
      relationships: [],
      warnings: [],
      summary: {
        entityCount: 1,
        fieldCount: 1,
        relationshipCount: 0,
        warningCount: 2,
      },
    }

    expect(artifact.entities[0].sourceRefs[0].symbolId).toContain('#User')
    expect(artifact.entities[0].fields[0].warnings[0].kind).toBe('unsupported-pattern')
  })

  it('relationship records can represent explicit and unknown relationships', () => {
    const explicit: DataModelRelationship = {
      id: 'relationship:one-to-many:User:-:Post:userId:0',
      kind: 'one-to-many',
      fromEntityId: 'entity:User',
      toEntityId: 'entity:Post',
      fromFieldId: null,
      toFieldId: 'field:Post.userId',
      confidence: 'explicit',
      sourceRefs: [sourceRef],
      warnings: [],
    }
    const unknown: DataModelRelationship = {
      id: 'relationship:unknown:User:-:Account:-:0',
      kind: 'unknown',
      fromEntityId: 'entity:User',
      toEntityId: 'entity:Account',
      fromFieldId: null,
      toFieldId: null,
      confidence: 'unknown',
      sourceRefs: [],
      warnings: [warning],
    }

    expect(explicit.confidence).toBe('explicit')
    expect(unknown.kind).toBe('unknown')
  })

  it('data-model graph node and edge records do not require code-graph node or edge types', () => {
    const nodeKind: Exclude<DataModelGraphNodeKind, CodeGraphNodeKind> = 'entity'
    const edgeKind: Exclude<DataModelGraphEdgeKind, CodeGraphEdgeKind> = 'has-field'

    expect(nodeKind).toBe('entity')
    expect(edgeKind).toBe('has-field')
  })
})
