import type {
  DataModelArtifact,
  DataModelEntity,
  DataModelField,
  DataModelSourceRef,
  DataModelWarning,
} from './types.js'

export interface DataModelEntityLookupResult {
  status: 'found'
  selector: string
  entity: DataModelEntity
  sourceRefs: DataModelSourceRef[]
  warnings: DataModelWarning[]
}

export interface DataModelFieldLookupResult {
  status: 'found'
  selector: string
  entity: DataModelEntity
  field: DataModelField
  sourceRefs: DataModelSourceRef[]
  warnings: DataModelWarning[]
}

export function lookupDataModelEntity(
  artifact: DataModelArtifact,
  selector: string
): DataModelEntityLookupResult {
  const entity = artifact.entities.find((candidate) => candidate.name === selector || candidate.id === selector)
  if (!entity) {
    throw new Error(`Entity not found: ${selector}`)
  }

  return {
    status: 'found',
    selector,
    entity,
    sourceRefs: [...entity.sourceRefs],
    warnings: [...entity.warnings],
  }
}

export function lookupDataModelField(
  artifact: DataModelArtifact,
  selector: string
): DataModelFieldLookupResult {
  const parsed = parseDataModelFieldSelector(selector)
  const entity = artifact.entities.find((candidate) => candidate.name === parsed.entityName || candidate.id === parsed.entityName)
  if (!entity) {
    throw new Error(`Entity not found for field lookup: ${parsed.entityName}`)
  }

  const field = entity.fields.find((candidate) => candidate.name === parsed.fieldName || candidate.id === parsed.fieldName)
  if (!field) {
    throw new Error(`Field not found: ${selector}`)
  }

  return {
    status: 'found',
    selector,
    entity,
    field,
    sourceRefs: [...field.sourceRefs],
    warnings: [...entity.warnings, ...field.warnings],
  }
}

export function parseDataModelFieldSelector(selector: string): {
  entityName: string
  fieldName: string
} {
  const normalized = selector.trim()
  const parts = normalized.split('.')
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new Error('Field selector must use exact format Entity.field.')
  }

  return {
    entityName: parts[0],
    fieldName: parts[1],
  }
}
