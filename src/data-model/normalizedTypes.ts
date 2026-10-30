import type {
  DataModelConfidence,
  DataModelEvidenceKind,
  DataModelEntityKind,
  DataModelFieldCardinality,
  DataModelRelationshipKind,
  DataModelWarningKind,
} from './types.js'

export interface NormalizedDataModelSourceRef {
  filePath: string
  symbolId?: string | null
  nodeId?: string | null
  evidenceId?: string | null
  evidenceKind?: DataModelEvidenceKind | null
  line?: number | null
  column?: number | null
}

export interface NormalizedDataModelWarning {
  kind: DataModelWarningKind
  message: string
  entityName?: string | null
  fieldName?: string | null
  toEntityName?: string | null
  sourceRefs?: NormalizedDataModelSourceRef[]
}

export interface NormalizedDataModelEntityRecord {
  entityKey?: string
  sourceLanguage?: 'python'
  ormFamily?: 'django' | 'sqlalchemy'
  name: string
  kind: DataModelEntityKind
  sourceRefs: NormalizedDataModelSourceRef[]
  warnings: NormalizedDataModelWarning[]
}

export interface NormalizedDataModelFieldRecord {
  entityKey?: string
  options?: Record<string, string | number | boolean | null>
  entityName: string
  fieldName: string
  typeText: string
  optional: boolean
  nullable: boolean
  cardinality: DataModelFieldCardinality
  sourceRefs: NormalizedDataModelSourceRef[]
  warnings: NormalizedDataModelWarning[]
}

export interface NormalizedDataModelRelationshipRecord {
  fromEntityKey?: string
  toEntityKey?: string
  occurrence?: string
  fromEntityName: string
  toEntityName: string
  kind: DataModelRelationshipKind
  fromFieldName?: string | null
  toFieldName?: string | null
  confidence: DataModelConfidence
  sourceRefs: NormalizedDataModelSourceRef[]
  warnings: NormalizedDataModelWarning[]
}

export interface NormalizedDataModelRecordSet {
  entities: NormalizedDataModelEntityRecord[]
  fields: NormalizedDataModelFieldRecord[]
  relationships: NormalizedDataModelRelationshipRecord[]
  warnings: NormalizedDataModelWarning[]
}
