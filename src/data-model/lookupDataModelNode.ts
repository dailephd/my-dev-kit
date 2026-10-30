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
  if (!selector.trim() || selector !== selector.trim()) throw new Error('Invalid entity selector.')
  const exact = artifact.entities.filter(candidate => candidate.id === selector)
  const candidates = exact.length ? exact : artifact.entities.filter(candidate => candidate.name === selector)
  if (candidates.length > 1) throw ambiguity(candidates.map(candidate => candidate.id))
  const entity = candidates[0]
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
  if (!selector.trim() || selector !== selector.trim()) throw new Error('Invalid field selector.')
  const exact = artifact.entities.flatMap(entity => entity.fields.filter(field => field.id === selector).map(field => ({ entity, field })))
  if (exact.length > 1) throw ambiguity(exact.map(match => match.field.id))
  if (exact.length === 1) return { status: 'found', selector, ...exact[0], sourceRefs: [...exact[0].field.sourceRefs], warnings: [...exact[0].entity.warnings, ...exact[0].field.warnings] }
  if (selector.startsWith('field:')) throw new Error(`Field not found: ${selector}`)
  const parsed = parseDataModelFieldSelector(selector)
  const candidates = artifact.entities.filter(candidate => candidate.name === parsed.entityName || candidate.id === parsed.entityName)
  if (candidates.length > 1) throw ambiguity(candidates.map(candidate => candidate.id))
  const entity = candidates[0]
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

function ambiguity(ids: string[]): Error & { candidates: string[]; code: string } {
  const candidates = [...ids].sort().slice(0, 20)
  return Object.assign(new Error(`Ambiguous data-model selector; use an exact ID. Candidates: ${candidates.join(', ')}`), { candidates, code: 'AMBIGUOUS_DATA_MODEL_SELECTOR' })
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
