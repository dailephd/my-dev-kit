import type { SemanticArtifactRef } from '../semantics/index.js'

export const ANDROID_COMPONENTS_ARTIFACT_KIND = 'my-dev-kit-v1-android-components'
export const ANDROID_COMPONENTS_SCHEMA_VERSION = '1.0.0'
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

export interface AndroidComponentsSummary {
  componentCount: number
  highConfidenceCount: number
  mediumConfidenceCount: number
  lowConfidenceCount: number
  roleCounts: Partial<Record<AndroidComponentRole, number>>
}

export interface AndroidComponentsArtifact {
  artifactKind: typeof ANDROID_COMPONENTS_ARTIFACT_KIND
  schemaVersion: typeof ANDROID_COMPONENTS_SCHEMA_VERSION
  createdAt: string
  detected: boolean
  components: AndroidComponentEntry[]
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
