import { describe, expect, it } from 'vitest'
import { buildDataModelArtifact, type NormalizedDataModelRecordSet } from '../../src/data-model/index.js'

function makeRecords(): NormalizedDataModelRecordSet {
  return {
    entities: [
      {
        name: 'Post',
        kind: 'schema-model',
        sourceRefs: [{ filePath: 'src/models/post.ts', line: 1 }],
        warnings: [],
      },
      {
        name: 'User',
        kind: 'canonical-model',
        sourceRefs: [{ filePath: 'src/models/user.ts', line: 1, symbolId: 'symbol:src/models/user.ts#User' }],
        warnings: [
          {
            kind: 'unsupported-pattern',
            message: 'Decorators were not interpreted.',
            entityName: 'User',
            sourceRefs: [{ filePath: 'src/models/user.ts', line: 1 }],
          },
        ],
      },
    ],
    fields: [
      {
        entityName: 'User',
        fieldName: 'email',
        typeText: 'string',
        optional: false,
        nullable: false,
        cardinality: 'one',
        sourceRefs: [{ filePath: 'src/models/user.ts', line: 3 }],
        warnings: [],
      },
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
        warnings: [
          {
            kind: 'missing-source',
            message: 'No reverse reference was found.',
            entityName: 'Post',
            fieldName: 'userId',
            sourceRefs: [{ filePath: 'src/models/post.ts', line: 2 }],
          },
        ],
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
    warnings: [
      {
        kind: 'skipped-dynamic-pattern',
        message: 'Dynamic registry configuration was skipped.',
        sourceRefs: [{ filePath: 'src/models/index.ts', line: 1 }],
      },
    ],
  }
}

describe('buildDataModelArtifact', () => {
  it('builds an empty artifact', () => {
    const artifact = buildDataModelArtifact({
      records: { entities: [], fields: [], relationships: [], warnings: [] },
      createdAt: '2026-06-04T00:00:00.000Z',
    })

    expect(artifact.entities).toEqual([])
    expect(artifact.summary).toEqual({
      entityCount: 0,
      fieldCount: 0,
      relationshipCount: 0,
      warningCount: 0,
    })
  })

  it('builds one entity with deterministic field ordering', () => {
    const artifact = buildDataModelArtifact({
      records: {
        entities: [makeRecords().entities[1]],
        fields: [makeRecords().fields[0], makeRecords().fields[1]],
        relationships: [],
        warnings: [],
      },
      createdAt: '2026-06-04T00:00:00.000Z',
    })

    expect(artifact.entities[0].id).toBe('entity:User')
    expect(artifact.entities[0].fields.map((field) => field.id)).toEqual(['field:User.email', 'field:User.id'])
  })

  it('builds multiple entities and relationships in deterministic order', () => {
    const artifact = buildDataModelArtifact({
      records: makeRecords(),
      createdAt: '2026-06-04T00:00:00.000Z',
    })

    expect(artifact.entities.map((entity) => entity.id)).toEqual(['entity:Post', 'entity:User'])
    expect(artifact.relationships.map((relationship) => relationship.id)).toEqual([
      'relationship:one-to-many:User:-:Post:userId:0',
    ])
  })

  it('attaches source refs and preserves warnings', () => {
    const artifact = buildDataModelArtifact({
      records: makeRecords(),
      createdAt: '2026-06-04T00:00:00.000Z',
    })

    expect(artifact.entities[1].sourceRefs[0].symbolId).toContain('#User')
    expect(artifact.entities[1].warnings[0].kind).toBe('unsupported-pattern')
    expect(artifact.entities[0].fields[0].warnings[0].kind).toBe('missing-source')
  })

  it('produces correct summary counts', () => {
    const artifact = buildDataModelArtifact({
      records: makeRecords(),
      createdAt: '2026-06-04T00:00:00.000Z',
    })

    expect(artifact.summary).toEqual({
      entityCount: 2,
      fieldCount: 3,
      relationshipCount: 1,
      warningCount: 3,
    })
  })

  it('does not create guessed relationships from warnings', () => {
    const artifact = buildDataModelArtifact({
      records: {
        ...makeRecords(),
        relationships: [],
        warnings: [
          {
            kind: 'ambiguous-relationship',
            message: 'A relation may exist, but it was not resolved statically.',
            entityName: 'User',
            toEntityName: 'Post',
            sourceRefs: [{ filePath: 'src/models/user.ts', line: 10 }],
          },
        ],
      },
      createdAt: '2026-06-04T00:00:00.000Z',
    })

    expect(artifact.relationships).toHaveLength(0)
    expect(artifact.warnings[0].kind).toBe('ambiguous-relationship')
  })

  it('generates stable IDs for repeated runs with the same input', () => {
    const first = buildDataModelArtifact({
      records: makeRecords(),
      createdAt: '2026-06-04T00:00:00.000Z',
    })
    const second = buildDataModelArtifact({
      records: makeRecords(),
      createdAt: '2026-06-04T00:00:00.000Z',
    })

    expect(second).toEqual(first)
  })
})
