import { describe, expect, it } from 'vitest'
import type { NormalizedDataModelRecordSet } from '../../src/data-model/index.js'

describe('normalized data-model record types', () => {
  it('can construct an empty normalized record set', () => {
    const records: NormalizedDataModelRecordSet = {
      entities: [],
      fields: [],
      relationships: [],
      warnings: [],
    }

    expect(records.entities).toEqual([])
  })

  it('can construct entity, field, and relationship records', () => {
    const records: NormalizedDataModelRecordSet = {
      entities: [
        {
          name: 'User',
          kind: 'canonical-model',
          sourceRefs: [{ filePath: 'src/models/user.ts', line: 1 }],
          warnings: [],
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
          sourceRefs: [{ filePath: 'src/models/user.ts', line: 3, symbolId: 'symbol:src/models/user.ts#User' }],
          warnings: [],
        },
      ],
      relationships: [
        {
          fromEntityName: 'User',
          toEntityName: 'Organization',
          kind: 'many-to-one',
          fromFieldName: 'organizationId',
          toFieldName: 'id',
          confidence: 'explicit',
          sourceRefs: [{ filePath: 'src/models/user.ts', line: 4 }],
          warnings: [],
        },
      ],
      warnings: [
        {
          kind: 'partial-extraction',
          message: 'View-only helper fields were ignored.',
          entityName: 'User',
          sourceRefs: [{ filePath: 'src/models/user.ts', line: 5 }],
        },
      ],
    }

    expect(records.entities[0].name).toBe('User')
    expect(records.fields[0].fieldName).toBe('email')
    expect(records.relationships[0].kind).toBe('many-to-one')
    expect(records.warnings[0].kind).toBe('partial-extraction')
  })

  it('normalized records do not require final artifact IDs', () => {
    const fieldRecord = {
      entityName: 'User',
      fieldName: 'id',
      typeText: 'string',
      optional: false,
      nullable: false,
      cardinality: 'one' as const,
      sourceRefs: [],
      warnings: [],
    }

    expect('id' in fieldRecord).toBe(false)
  })
})
