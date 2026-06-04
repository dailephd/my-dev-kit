import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractTypeScriptDataModels } from '../../src/data-model/index.js'

function readFixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests', 'fixtures', 'data-model', 'typescript-models', name), 'utf8')
}

describe('TypeScript data-model extractor', () => {
  it('extracts exported interface entities with fields, optional markers, nullable unions, and source refs', () => {
    const result = extractTypeScriptDataModels({
      filePath: 'tests/fixtures/data-model/typescript-models/interfaceModel.ts',
      sourceText: readFixture('interfaceModel.ts'),
    })

    expect(result.records.entities.map((entity) => entity.name)).toEqual(['User'])
    expect(result.records.fields.map((field) => ({
      entityName: field.entityName,
      fieldName: field.fieldName,
      typeText: field.typeText,
      optional: field.optional,
      nullable: field.nullable,
      cardinality: field.cardinality,
    }))).toEqual([
      {
        entityName: 'User',
        fieldName: 'email',
        typeText: 'string | null',
        optional: true,
        nullable: true,
        cardinality: 'one',
      },
      {
        entityName: 'User',
        fieldName: 'id',
        typeText: 'string',
        optional: false,
        nullable: false,
        cardinality: 'one',
      },
      {
        entityName: 'User',
        fieldName: 'tags',
        typeText: 'string[]',
        optional: false,
        nullable: false,
        cardinality: 'many',
      },
    ])
    expect(result.records.entities[0].sourceRefs[0]?.filePath).toContain('interfaceModel.ts')
    expect(result.records.entities[0].sourceRefs[0]?.line).toBe(1)
    expect(result.records.entities[0].sourceRefs[0]?.symbolId).toContain('#User')
  })

  it('extracts exported object-literal type aliases', () => {
    const result = extractTypeScriptDataModels({
      filePath: 'tests/fixtures/data-model/typescript-models/typeAliasModel.ts',
      sourceText: readFixture('typeAliasModel.ts'),
    })

    expect(result.records.entities.map((entity) => entity.name)).toEqual(['Session'])
    expect(result.records.fields.map((field) => field.fieldName)).toEqual(['active', 'id'])
  })

  it('extracts exported class property declarations', () => {
    const result = extractTypeScriptDataModels({
      filePath: 'tests/fixtures/data-model/typescript-models/classModel.ts',
      sourceText: readFixture('classModel.ts'),
    })

    expect(result.records.entities.map((entity) => entity.name)).toEqual(['AuditLog'])
    expect(result.records.fields.map((field) => ({
      fieldName: field.fieldName,
      optional: field.optional,
      nullable: field.nullable,
      cardinality: field.cardinality,
    }))).toEqual([
      { fieldName: 'actor', optional: true, nullable: true, cardinality: 'one' },
      { fieldName: 'entries', optional: false, nullable: false, cardinality: 'many' },
      { fieldName: 'id', optional: false, nullable: false, cardinality: 'one' },
    ])
  })

  it('emits warnings for unsupported mapped, conditional, and generic utility type aliases', () => {
    const result = extractTypeScriptDataModels({
      filePath: 'tests/fixtures/data-model/typescript-models/unsupportedPatterns.ts',
      sourceText: readFixture('unsupportedPatterns.ts'),
    })

    expect(result.records.entities.map((entity) => entity.name)).toEqual(['User'])
    expect(result.records.warnings.map((warning) => warning.kind)).toEqual([
      'unsupported-pattern',
      'unsupported-pattern',
      'unsupported-pattern',
    ])
    expect(result.records.warnings.every((warning) => warning.message.includes('Skipped exported type alias'))).toBe(true)
    expect(result.records.warnings.every((warning) => warning.sourceRefs?.[0]?.filePath?.includes('unsupportedPatterns.ts'))).toBe(true)
  })

  it('does not expand imported types across files or infer runtime database relationships', () => {
    const importedTypeResult = extractTypeScriptDataModels({
      filePath: 'tests/fixtures/data-model/typescript-models/importedTypes.ts',
      sourceText: readFixture('importedTypes.ts'),
    })
    const runtimeFactoryResult = extractTypeScriptDataModels({
      filePath: 'tests/fixtures/data-model/typescript-models/runtimeFactory.ts',
      sourceText: readFixture('runtimeFactory.ts'),
    })

    expect(importedTypeResult.records.entities.map((entity) => entity.name)).toEqual(['UserProfile'])
    expect(importedTypeResult.records.fields[0]?.typeText).toBe('ExternalUser')
    expect(importedTypeResult.records.relationships).toEqual([])
    expect(runtimeFactoryResult.records.entities).toEqual([])
    expect(runtimeFactoryResult.records.relationships).toEqual([])
    expect(runtimeFactoryResult.records.warnings.map((warning) => warning.kind)).toEqual(['skipped-dynamic-pattern'])
  })

  it('warns for computed properties, decorator-based ORM classes, and React props contracts', () => {
    const computedResult = extractTypeScriptDataModels({
      filePath: 'tests/fixtures/data-model/typescript-models/computedProperty.ts',
      sourceText: readFixture('computedProperty.ts'),
    })
    const decoratedResult = extractTypeScriptDataModels({
      filePath: 'tests/fixtures/data-model/typescript-models/decoratedModel.ts',
      sourceText: readFixture('decoratedModel.ts'),
    })
    const reactPropsResult = extractTypeScriptDataModels({
      filePath: 'tests/fixtures/data-model/typescript-models/reactProps.tsx',
      sourceText: readFixture('reactProps.tsx'),
    })

    expect(computedResult.records.entities.map((entity) => entity.name)).toEqual(['ComputedModel'])
    expect(computedResult.records.fields).toEqual([])
    expect(computedResult.records.entities[0].warnings[0]?.kind).toBe('unsupported-pattern')

    expect(decoratedResult.records.entities).toEqual([])
    expect(decoratedResult.records.warnings[0]?.message).toContain('decorator-based ORM extraction is not supported')

    expect(reactPropsResult.records.entities).toEqual([])
    expect(reactPropsResult.records.warnings[0]?.message).toContain('React props/state contract')
  })

  it('produces deterministic output for repeated runs', () => {
    const input = {
      filePath: 'tests/fixtures/data-model/typescript-models/interfaceModel.ts',
      sourceText: readFixture('interfaceModel.ts'),
    }

    const first = extractTypeScriptDataModels(input)
    const second = extractTypeScriptDataModels(input)

    expect(second).toEqual(first)
  })
})
