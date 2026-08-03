import type { SemanticArtifactRef } from '../semantics/index.js'

export const ANDROID_COMPONENTS_ARTIFACT_KIND = 'my-dev-kit-v1-android-components'
export const ANDROID_COMPONENTS_SCHEMA_VERSION = '1.1.0'
export const ANDROID_COMPONENTS_FILENAME = 'android-components.json'

export type AndroidComponentRole =
  | 'activity'
  | 'fragment'
  | 'view-model'
  | 'service'
  | 'broadcast-receiver'
  | 'content-provider'
  | 'worker'
  | 'repository'
  | 'use-case'
  | 'room-entity'
  | 'room-dao'
  | 'room-database'
  | 'retrofit-service'
  | 'hilt-module'

export type AndroidComponentConfidence = 'high' | 'medium' | 'low'

export type AndroidComponentEvidenceKind =
  | 'annotation'
  | 'superclass'
  | 'implements'
  | 'import'
  | 'package'
  | 'path'
  | 'name'
  | 'source-pattern'

/** Deterministic sort priority, strongest evidence first — mirrors the role evidence priority in the batch spec. */
export const EVIDENCE_KIND_SORT_PRIORITY: Record<AndroidComponentEvidenceKind, number> = {
  annotation: 0,
  superclass: 1,
  implements: 2,
  'source-pattern': 3,
  import: 4,
  package: 5,
  path: 6,
  name: 7,
}

export interface AndroidComponentEvidence {
  kind: AndroidComponentEvidenceKind
  value: string
  source: string
  confidence: AndroidComponentConfidence
}

export interface AndroidComponentEntry {
  id: string
  role: AndroidComponentRole
  confidence: AndroidComponentConfidence
  filePath: string
  symbolId: string
  symbolName: string
  sourceLanguage: 'kotlin' | 'java'
  modulePath: string | null
  sourceSet: string | null
  packageName: string | null
  evidence: AndroidComponentEvidence[]
  warnings: string[]
}

/**
 * v1.12.0 Batch 3: the five fixed static component-dependency relationships.
 * Never a synonym, never a generic 'component-depends-on-component' edge.
 */
export type AndroidComponentDependencyRelationshipKind =
  | 'viewmodel-uses-repository'
  | 'repository-uses-dao'
  | 'repository-uses-service'
  | 'dao-uses-entity'
  | 'room-database-exposes-dao'

export type AndroidComponentDependencyMatchStatus = 'resolved' | 'ambiguous' | 'unresolved'

export type AndroidComponentDependencyEvidenceKind =
  | 'primary-constructor-parameter'
  | 'secondary-constructor-parameter'
  | 'constructor-parameter'
  | 'typed-property'
  | 'typed-field'
  | 'method-parameter'
  | 'method-return'

export interface AndroidComponentDependencySourceRef {
  file: string
  line: number
}

export interface AndroidComponentDependencyFact {
  id: string
  relationshipKind: AndroidComponentDependencyRelationshipKind
  sourceComponentId: string
  sourceSymbolId: string
  sourceRole: AndroidComponentRole
  targetRole: AndroidComponentRole
  declaredTypeName: string
  evidenceKind: AndroidComponentDependencyEvidenceKind
  sourceRef: AndroidComponentDependencySourceRef
  matchStatus: AndroidComponentDependencyMatchStatus
  candidateComponentIds: string[]
  candidateSymbolIds: string[]
  warnings: string[]
}

export interface AndroidComponentsSummary {
  componentCount: number
  highConfidenceCount: number
  mediumConfidenceCount: number
  lowConfidenceCount: number
  roleCounts: Partial<Record<AndroidComponentRole, number>>
  /** v1.12.0 Batch 3: additive dependency-fact counts. Absent/0 when none exist. */
  dependencyFactCount?: number
  resolvedDependencyFactCount?: number
  ambiguousDependencyFactCount?: number
  unresolvedDependencyFactCount?: number
  dependencyFactCountByKind?: Record<AndroidComponentDependencyRelationshipKind, number>
}

export interface AndroidComponentsArtifact {
  artifactKind: typeof ANDROID_COMPONENTS_ARTIFACT_KIND
  schemaVersion: typeof ANDROID_COMPONENTS_SCHEMA_VERSION
  createdAt: string
  detected: boolean
  components: AndroidComponentEntry[]
  /** v1.12.0 Batch 3: additive. Empty when no supported dependency declarations are found. */
  dependencyFacts: AndroidComponentDependencyFact[]
  summary: AndroidComponentsSummary
  warnings: string[]
}

/** Compact projection of AndroidComponentEntry embedded on CodeGraphNode/GraphSymbolRecord/SymbolDefinition — mirrors ClassificationRoleRef. */
export interface AndroidComponentRoleRef {
  role: AndroidComponentRole
  confidence: AndroidComponentConfidence
}

export interface CompactAndroidComponentMetadata {
  androidComponentRoles: AndroidComponentRoleRef[]
  androidComponentRefs: SemanticArtifactRef[]
}
