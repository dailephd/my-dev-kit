export const DATA_MODEL_SCHEMA_VERSION = '1.1.0'
export const DATA_MODEL_ARTIFACT_KIND = 'my-dev-kit-v1-data-model'

export type DataModelEntityKind =
  | 'canonical-model'
  | 'schema-model'
  | 'inferred-model'
  | 'view-model'
  | 'unknown'

export type DataModelRelationshipKind =
  | 'one-to-one'
  | 'one-to-many'
  | 'many-to-one'
  | 'many-to-many'
  | 'field-reference'
  | 'derives-from'
  | 'unknown'

export type DataModelFieldCardinality = 'one' | 'many' | 'unknown'

export type DataModelConfidence = 'explicit' | 'inferred' | 'partial' | 'unknown'

export type DataModelWarningKind =
  | 'unsupported-pattern'
  | 'ambiguous-relationship'
  | 'missing-source'
  | 'skipped-dynamic-pattern'
  | 'partial-extraction'

export type DataModelEvidenceKind =
  | 'symbol-index'
  | 'code-graph'
  | 'call-graph'
  | 'source'
  | 'data-model'
  | 'unknown'

export interface DataModelSourceRef {
  filePath: string
  symbolId?: string | null
  nodeId?: string | null
  evidenceId?: string | null
  evidenceKind?: DataModelEvidenceKind | null
  line?: number | null
  column?: number | null
}

export interface DataModelWarning {
  kind: DataModelWarningKind
  message: string
  entityId?: string | null
  fieldId?: string | null
  relationshipId?: string | null
  sourceRefs?: DataModelSourceRef[]
}

export interface DataModelField {
  id: string
  name: string
  typeText: string
  optional: boolean
  nullable: boolean
  cardinality: DataModelFieldCardinality
  sourceRefs: DataModelSourceRef[]
  warnings: DataModelWarning[]
}

export interface DataModelRelationship {
  id: string
  kind: DataModelRelationshipKind
  fromEntityId: string
  toEntityId: string
  fromFieldId?: string | null
  toFieldId?: string | null
  confidence: DataModelConfidence
  sourceRefs: DataModelSourceRef[]
  warnings: DataModelWarning[]
}

export interface DataModelEntity {
  id: string
  name: string
  kind: DataModelEntityKind
  fields: DataModelField[]
  relationships: string[]
  sourceRefs: DataModelSourceRef[]
  warnings: DataModelWarning[]
}

export interface DataModelSummary {
  entityCount: number
  fieldCount: number
  relationshipCount: number
  warningCount: number
}

export interface DataModelArtifact {
  artifactKind: typeof DATA_MODEL_ARTIFACT_KIND
  schemaVersion: string
  createdAt: string
  entities: DataModelEntity[]
  relationships: DataModelRelationship[]
  warnings: DataModelWarning[]
  summary: DataModelSummary
}
