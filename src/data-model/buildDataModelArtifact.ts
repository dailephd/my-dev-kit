import {
  DATA_MODEL_ARTIFACT_KIND,
  DATA_MODEL_SCHEMA_VERSION,
  type DataModelArtifact,
  type DataModelEntity,
  type DataModelField,
  type DataModelRelationship,
  type DataModelSourceRef,
  type DataModelWarning,
} from './types.js'
import type {
  NormalizedDataModelFieldRecord,
  NormalizedDataModelRecordSet,
  NormalizedDataModelRelationshipRecord,
  NormalizedDataModelSourceRef,
  NormalizedDataModelWarning,
} from './normalizedTypes.js'

export interface BuildDataModelArtifactInput {
  records: NormalizedDataModelRecordSet
  createdAt?: string
}

export function buildDataModelArtifact(input: BuildDataModelArtifactInput): DataModelArtifact {
  const createdAt = input.createdAt ?? '1970-01-01T00:00:00.000Z'
  const entityRecords = [...input.records.entities].sort((left, right) => compareStrings(left.name, right.name))
  const fieldRecords = [...input.records.fields].sort(compareFieldRecords)
  const relationshipRecords = [...input.records.relationships].sort(compareRelationshipRecords)

  const fieldsByEntity = new Map<string, DataModelField[]>()
  const entitiesByName = new Map<string, DataModelEntity>()

  for (const entityRecord of entityRecords) {
    const entityId = buildEntityId(entityRecord.name)
    entitiesByName.set(entityRecord.name, {
      id: entityId,
      name: entityRecord.name,
      kind: entityRecord.kind,
      fields: [],
      relationships: [],
      sourceRefs: sortSourceRefs(entityRecord.sourceRefs.map(toSourceRef)),
      warnings: sortWarnings(entityRecord.warnings.map((warning) => toWarning(warning, { entityId }))),
    })
    fieldsByEntity.set(entityRecord.name, [])
  }

  for (const fieldRecord of fieldRecords) {
    const entity = entitiesByName.get(fieldRecord.entityName)
    if (!entity) continue
    const field = buildField(fieldRecord)
    fieldsByEntity.get(fieldRecord.entityName)!.push(field)
  }

  for (const entity of entitiesByName.values()) {
    entity.fields = (fieldsByEntity.get(entity.name) ?? []).sort((left, right) => compareStrings(left.id, right.id))
  }

  const relationshipCounts = new Map<string, number>()
  const relationships: DataModelRelationship[] = relationshipRecords
    .map((record) => buildRelationship(record, entitiesByName, relationshipCounts))
    .filter((relationship): relationship is DataModelRelationship => relationship !== null)
    .sort((left, right) => compareStrings(left.id, right.id))

  for (const relationship of relationships) {
    const fromEntity = findEntityById(entitiesByName, relationship.fromEntityId)
    const toEntity = findEntityById(entitiesByName, relationship.toEntityId)
    if (fromEntity) fromEntity.relationships.push(relationship.id)
    if (toEntity && toEntity.id !== relationship.fromEntityId) toEntity.relationships.push(relationship.id)
  }

  const entities = [...entitiesByName.values()]
    .map((entity) => ({
      ...entity,
      relationships: [...new Set(entity.relationships)].sort(compareStrings),
      warnings: sortWarnings(entity.warnings),
      sourceRefs: sortSourceRefs(entity.sourceRefs),
      fields: entity.fields.map((field) => ({
        ...field,
        sourceRefs: sortSourceRefs(field.sourceRefs),
        warnings: sortWarnings(field.warnings),
      })),
    }))
    .sort((left, right) => compareStrings(left.id, right.id))

  const warnings = sortWarnings(input.records.warnings.map((warning) => toWarning(warning)))

  return {
    artifactKind: DATA_MODEL_ARTIFACT_KIND,
    schemaVersion: DATA_MODEL_SCHEMA_VERSION,
    createdAt,
    entities,
    relationships,
    warnings,
    summary: {
      entityCount: entities.length,
      fieldCount: entities.reduce((count, entity) => count + entity.fields.length, 0),
      relationshipCount: relationships.length,
      warningCount: countArtifactWarnings(entities, relationships, warnings),
    },
  }
}

function buildField(record: NormalizedDataModelFieldRecord): DataModelField {
  return {
    id: buildFieldId(record.entityName, record.fieldName),
    name: record.fieldName,
    typeText: record.typeText,
    optional: record.optional,
    nullable: record.nullable,
    cardinality: record.cardinality,
    sourceRefs: sortSourceRefs(record.sourceRefs.map(toSourceRef)),
    warnings: sortWarnings(
      record.warnings.map((warning) =>
        toWarning(warning, {
          entityId: buildEntityId(record.entityName),
          fieldId: buildFieldId(record.entityName, record.fieldName),
        })
      )
    ),
  }
}

function buildRelationship(
  record: NormalizedDataModelRelationshipRecord,
  entitiesByName: Map<string, DataModelEntity>,
  relationshipCounts: Map<string, number>
): DataModelRelationship | null {
  const fromEntity = entitiesByName.get(record.fromEntityName)
  const toEntity = entitiesByName.get(record.toEntityName)
  if (!fromEntity || !toEntity) return null

  const signature = [
    record.kind,
    fromEntity.id,
    record.fromFieldName ?? '',
    toEntity.id,
    record.toFieldName ?? '',
  ].join('|')
  const index = relationshipCounts.get(signature) ?? 0
  relationshipCounts.set(signature, index + 1)
  const relationshipId = buildRelationshipId(record, index)

  return {
    id: relationshipId,
    kind: record.kind,
    fromEntityId: fromEntity.id,
    toEntityId: toEntity.id,
    fromFieldId: record.fromFieldName ? buildFieldId(record.fromEntityName, record.fromFieldName) : null,
    toFieldId: record.toFieldName ? buildFieldId(record.toEntityName, record.toFieldName) : null,
    confidence: record.confidence,
    sourceRefs: sortSourceRefs(record.sourceRefs.map(toSourceRef)),
    warnings: sortWarnings(
      record.warnings.map((warning) =>
        toWarning(warning, {
          entityId: fromEntity.id,
          relationshipId,
        })
      )
    ),
  }
}

function findEntityById(entitiesByName: Map<string, DataModelEntity>, entityId: string): DataModelEntity | undefined {
  for (const entity of entitiesByName.values()) {
    if (entity.id === entityId) return entity
  }
  return undefined
}

function toSourceRef(sourceRef: NormalizedDataModelSourceRef): DataModelSourceRef {
  return {
    filePath: sourceRef.filePath,
    symbolId: sourceRef.symbolId ?? null,
    nodeId: sourceRef.nodeId ?? null,
    evidenceId: sourceRef.evidenceId ?? null,
    evidenceKind: sourceRef.evidenceKind ?? null,
    line: sourceRef.line ?? null,
    column: sourceRef.column ?? null,
  }
}

function toWarning(
  warning: NormalizedDataModelWarning,
  ids: {
    entityId?: string | null
    fieldId?: string | null
    relationshipId?: string | null
  } = {}
): DataModelWarning {
  return {
    kind: warning.kind,
    message: warning.message,
    entityId: ids.entityId ?? null,
    fieldId: ids.fieldId ?? null,
    relationshipId: ids.relationshipId ?? null,
    sourceRefs: sortSourceRefs((warning.sourceRefs ?? []).map(toSourceRef)),
  }
}

function countArtifactWarnings(
  entities: DataModelEntity[],
  relationships: DataModelRelationship[],
  warnings: DataModelWarning[]
): number {
  const entityWarnings = entities.reduce(
    (count, entity) => count + entity.warnings.length + entity.fields.reduce((fieldCount, field) => fieldCount + field.warnings.length, 0),
    0
  )
  const relationshipWarnings = relationships.reduce((count, relationship) => count + relationship.warnings.length, 0)
  return warnings.length + entityWarnings + relationshipWarnings
}

export function buildEntityId(entityName: string): string {
  return `entity:${entityName}`
}

export function buildFieldId(entityName: string, fieldName: string): string {
  return `field:${entityName}.${fieldName}`
}

function buildRelationshipId(record: NormalizedDataModelRelationshipRecord, index: number): string {
  return `relationship:${record.kind}:${record.fromEntityName}:${record.fromFieldName ?? '-'}:${record.toEntityName}:${record.toFieldName ?? '-'}:${index}`
}

function sortSourceRefs(sourceRefs: readonly DataModelSourceRef[]): DataModelSourceRef[] {
  return [...sourceRefs].sort((left, right) =>
    compareTuples([
      left.filePath,
      left.symbolId ?? '',
      left.nodeId ?? '',
      left.evidenceId ?? '',
      left.evidenceKind ?? '',
      String(left.line ?? -1),
      String(left.column ?? -1),
    ], [
      right.filePath,
      right.symbolId ?? '',
      right.nodeId ?? '',
      right.evidenceId ?? '',
      right.evidenceKind ?? '',
      String(right.line ?? -1),
      String(right.column ?? -1),
    ])
  )
}

function sortWarnings(warnings: readonly DataModelWarning[]): DataModelWarning[] {
  return [...warnings].sort((left, right) =>
    compareTuples([
      left.kind,
      left.message,
      left.entityId ?? '',
      left.fieldId ?? '',
      left.relationshipId ?? '',
      JSON.stringify(left.sourceRefs ?? []),
    ], [
      right.kind,
      right.message,
      right.entityId ?? '',
      right.fieldId ?? '',
      right.relationshipId ?? '',
      JSON.stringify(right.sourceRefs ?? []),
    ])
  )
}

function compareFieldRecords(left: NormalizedDataModelFieldRecord, right: NormalizedDataModelFieldRecord): number {
  return compareTuples([left.entityName, left.fieldName], [right.entityName, right.fieldName])
}

function compareRelationshipRecords(
  left: NormalizedDataModelRelationshipRecord,
  right: NormalizedDataModelRelationshipRecord
): number {
  return compareTuples(
    [left.kind, left.fromEntityName, left.fromFieldName ?? '', left.toEntityName, left.toFieldName ?? ''],
    [right.kind, right.fromEntityName, right.fromFieldName ?? '', right.toEntityName, right.toFieldName ?? '']
  )
}

function compareTuples(left: readonly string[], right: readonly string[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const value = compareStrings(left[index] ?? '', right[index] ?? '')
    if (value !== 0) return value
  }
  return 0
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right)
}
