import type { SemanticArtifactRef, SemanticEvidenceRef } from '../semantics/index.js'

export const CLASSIFICATION_SCHEMA_VERSION = '1.1.0'
export const CLASSIFICATION_ARTIFACT_KIND = 'my-dev-kit-v1-classification'

/**
 * Full v1.5 category vocabulary. 11 of these 13 required categories already
 * exist as SemanticRoleName values (reused verbatim per BEH-020); the
 * project-role categories (command-handler, analyzer, validator, public-docs,
 * internal-planning-docs) are new to v1.5. graph-renderer/report-renderer are
 * explicitly deferred per behavior-model.txt BEH-022 and are not included.
 */
export type ClassificationRoleName =
  | 'canonical-type'
  | 'artifact-type'
  | 'database-model'
  | 'projection-type'
  | 'view-model'
  | 'ui-only-state'
  | 'test-fixture'
  | 'persistence-adapter'
  | 'route-handler'
  | 'client-component'
  | 'server-component'
  | 'generated-file'
  | 'configuration-file'
  | 'command-handler'
  | 'analyzer'
  | 'validator'
  | 'public-docs'
  | 'internal-planning-docs'
  /** v1.12.0 Batch 1: Android project/module graph-node categories (BEH-15.1/15.2). */
  | 'android-project'
  | 'gradle-module'
  | 'android-app-module'
  | 'android-library-module'
  | (string & {})

export type ClassificationTargetKind =
  | 'file'
  | 'symbol'
  | 'type'
  | 'artifact'
  | 'route'
  | 'component'
  | 'command'
  | 'test'
  | 'docs'
  /** v1.12.0 Batch 1: an existing artifact-backed code-graph node (e.g. `android-project`/`android-module`), not a file or symbol. */
  | 'graph-node'

export type EditGuidance =
  | 'safe-primary-edit-target'
  | 'inspect-before-edit'
  | 'avoid-primary-edit-target'
  | 'read-only-reference'
  | 'generated-do-not-edit'
  | 'test-only'
  | 'docs-only'
  | 'uncertain'

export type Readiness = 'ready' | 'needs-more-context' | 'risky-assumption'

export type RiskLabel =
  | 'wrong-layer-risk'
  | 'unreachable-ui-risk'
  | 'requires-test-validation'
  | 'requires-browser-validation'
  | 'generated-file-risk'
  | 'public-contract-risk'
  | 'migration-risk'

/**
 * Measures confidence IN the classification's correctness, distinct from
 * SemanticRoleConfidence (which describes HOW a role was derived). 'unknown'
 * is intentionally kept identical in meaning to SemanticRoleConfidence's
 * 'unknown' - both mean "no usable signal" - per classification-contract.txt
 * section 6.
 */
export type UncertaintyTier = 'certain' | 'likely' | 'possible' | 'unknown'

export type EvidenceKind =
  | 'filename-pattern'
  | 'import-pattern'
  | 'decorator-or-annotation'
  | 'directory-convention'
  | 'artifact-cross-reference'
  | 'existing-semantic-role'
  | 'frontend-reachability-fact'
  | 'test-directory-convention'
  | 'unknown'

export type ClassificationWarningKind =
  | 'ambiguous-evidence'
  | 'missing-artifact-ref'
  | 'missing-source-ref'
  | 'partial-classification'
  | 'unsupported-pattern'
  | 'conflicting-category'
  | 'no-static-evidence'
  | 'unknown'

export interface ClassificationWarning {
  kind: ClassificationWarningKind
  message: string
}

/** Reuses SemanticEvidenceRef's shape verbatim (file path + line/endLine pointer). */
export type SourceRef = SemanticEvidenceRef

export interface ClassificationEvidence {
  kind: EvidenceKind
  source: string
  staticPattern?: string | null
  sourceLocation?: SourceRef | null
  artifactSource?: SemanticArtifactRef | null
  relatedRole?: ClassificationRoleName | null
  reason: string
  uncertaintyReason?: string | null
}

export interface ClassificationRole {
  role: ClassificationRoleName
  subtype?: string | null
  confidence: UncertaintyTier
}

/** Compact projection of ClassificationRole embedded on CodeGraphNode/GraphSymbolRecord. */
export interface ClassificationRoleRef {
  role: ClassificationRoleName
  editGuidance: EditGuidance
  readiness: Readiness
  uncertainty: UncertaintyTier
}

export interface ClassificationEntry {
  id: string
  targetId: string
  targetKind: ClassificationTargetKind
  filePath: string | null
  symbolName: string | null
  nodeId: string | null
  classifications: ClassificationRole[]
  editGuidance: EditGuidance
  readiness: Readiness
  risks: RiskLabel[]
  evidence: ClassificationEvidence[]
  uncertainty: UncertaintyTier
  reason: string
  sourceRefs: SourceRef[]
  artifactRefs: SemanticArtifactRef[]
  warnings: ClassificationWarning[]
}

export interface ClassificationSummary {
  entryCount: number
  fileEntryCount: number
  symbolEntryCount: number
  /** v1.12.0 Batch 1: count of `targetKind: 'graph-node'` entries (e.g. Android project/module nodes). Absent/0 when none exist. */
  graphNodeEntryCount?: number
  warningCount: number
}

export interface ClassificationArtifact {
  artifactKind: typeof CLASSIFICATION_ARTIFACT_KIND
  schemaVersion: typeof CLASSIFICATION_SCHEMA_VERSION
  createdAt: string
  entries: ClassificationEntry[]
  summary: ClassificationSummary
}
