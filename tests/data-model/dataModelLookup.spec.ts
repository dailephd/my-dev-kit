import { describe, expect, it } from 'vitest'
import {
  lookupDataModelEntity,
  lookupDataModelField,
  parseDataModelFieldSelector,
  type DataModelArtifact,
} from '../../src/data-model/index.js'

function makeArtifact(): DataModelArtifact {
  return {
    artifactKind: 'my-dev-kit-v1-data-model',
    schemaVersion: '1.1.0',
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
            sourceRefs: [{ filePath: 'src/models.ts', line: 2, symbolId: 'symbol:src/models.ts#User.id' }],
            warnings: [],
          },
          {
            id: 'field:User.email',
            name: 'email',
            typeText: 'string | null',
            optional: true,
            nullable: true,
            cardinality: 'one',
            sourceRefs: [{ filePath: 'src/models.ts', line: 3, symbolId: 'symbol:src/models.ts#User.email' }],
            warnings: [{
              kind: 'partial-extraction',
              message: 'Email field warning.',
              fieldId: 'field:User.email',
              sourceRefs: [{ filePath: 'src/models.ts', line: 3 }],
            }],
          },
        ],
        relationships: [],
        sourceRefs: [{ filePath: 'src/models.ts', line: 1, symbolId: 'symbol:src/models.ts#User' }],
        warnings: [{
          kind: 'unsupported-pattern',
          message: 'Entity warning.',
          entityId: 'entity:User',
          sourceRefs: [{ filePath: 'src/models.ts', line: 1 }],
        }],
      },
    ],
    relationships: [],
    warnings: [],
    summary: {
      entityCount: 1,
      fieldCount: 2,
      relationshipCount: 0,
      warningCount: 2,
    },
  }
}

describe('data-model lookup helpers', () => {
  it('finds an entity by exact name and exact id', () => {
    const artifact = makeArtifact()
    expect(lookupDataModelEntity(artifact, 'User').entity.id).toBe('entity:User')
    expect(lookupDataModelEntity(artifact, 'entity:User').entity.name).toBe('User')
  })

  it('fails clearly for a missing entity', () => {
    expect(() => lookupDataModelEntity(makeArtifact(), 'Missing')).toThrow('Entity not found: Missing')
  })

  it('finds a field by exact Entity.field selector', () => {
    const result = lookupDataModelField(makeArtifact(), 'User.email')
    expect(result.entity.name).toBe('User')
    expect(result.field.name).toBe('email')
    expect(result.sourceRefs[0]?.filePath).toBe('src/models.ts')
  })

  it('fails clearly for malformed field selectors and missing fields', () => {
    expect(() => parseDataModelFieldSelector('User')).toThrow('Field selector must use exact format Entity.field.')
    expect(() => parseDataModelFieldSelector('User.email.extra')).toThrow('Field selector must use exact format Entity.field.')
    expect(() => lookupDataModelField(makeArtifact(), 'User.missing')).toThrow('Field not found: User.missing')
  })

  it('returns source refs and warnings without requiring code-graph artifacts or source files', () => {
    const result = lookupDataModelField(makeArtifact(), 'User.email')
    expect(result.sourceRefs[0]?.symbolId).toContain('User.email')
    expect(result.warnings.map((warning) => warning.message)).toEqual([
      'Entity warning.',
      'Email field warning.',
    ])
  })
})
