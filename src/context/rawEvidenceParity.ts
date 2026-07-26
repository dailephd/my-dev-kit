import { isDeepStrictEqual } from 'node:util'
import type { ContextCapsule, RetrievalAuditRecord } from './types.js'

export const RAW_EVIDENCE_PARITY_ERROR_CODE = 'RAW_EVIDENCE_PARITY_MISMATCH'

export type RawEvidenceParityField =
  | 'schemaMajor'
  | 'tool'
  | 'request'
  | 'index.indexPath'
  | 'index.manifestPath'
  | 'index.manifestSchemaVersion'
  | 'index.projectRoot'
  | 'contextAdequacy'
  | 'roleContext'
  | 'responsibilityMappings'
  | 'roleAdequacy'
  | 'freshness'
  | 'budget'
  | 'truncation'
  | 'fullFileFallback'
  | 'provenance'

export interface RawEvidenceParityIssue {
  readonly field: RawEvidenceParityField
  readonly message: string
}

function schemaMajor(value: string): number | null {
  const match = /^(\d+)\.\d+\.\d+$/.exec(value)
  return match ? Number(match[1]) : null
}

/**
 * Compare only fields contractually duplicated between the two raw artifacts.
 * The fixed comparison order is the deterministic issue order.
 */
export function findRawEvidenceParityIssues(
  capsule: ContextCapsule,
  audit: RetrievalAuditRecord
): RawEvidenceParityIssue[] {
  const comparisons: ReadonlyArray<readonly [RawEvidenceParityField, unknown, unknown]> = [
    ['schemaMajor', schemaMajor(capsule.schemaVersion), schemaMajor(audit.schemaVersion)],
    ['tool', capsule.tool, audit.tool],
    ['request', capsule.request, audit.request],
    ['index.indexPath', capsule.index.indexPath, audit.index.indexPath],
    ['index.manifestPath', capsule.index.manifestPath, audit.index.manifestPath],
    ['index.manifestSchemaVersion', capsule.index.manifestSchemaVersion, audit.index.manifestSchemaVersion],
    ['index.projectRoot', capsule.index.projectRoot, audit.index.projectRoot],
    ['contextAdequacy', capsule.contextAdequacy, audit.contextAdequacy],
    ['roleContext', capsule.roleContext, audit.roleContext],
    ['responsibilityMappings', capsule.responsibilityMappings, audit.responsibilityMappings],
    ['roleAdequacy', capsule.roleAdequacy, audit.roleAdequacy],
    ['freshness', capsule.freshness, audit.freshness],
    ['budget', capsule.budget, audit.budget],
    ['truncation', capsule.truncation, audit.truncation],
    ['fullFileFallback', capsule.fullFileFallback, audit.fullFileFallback],
    ['provenance', capsule.provenance, audit.provenance],
  ]

  return comparisons
    .filter(([, capsuleValue, auditValue]) => !isDeepStrictEqual(capsuleValue, auditValue))
    .map(([field]) => ({
      field,
      message: `Context capsule and retrieval audit disagree on duplicated field "${field}".`,
    }))
}

export function assertRawEvidenceParity(capsule: ContextCapsule, audit: RetrievalAuditRecord): void {
  const issues = findRawEvidenceParityIssues(capsule, audit)
  if (issues.length === 0) return
  throw new Error(
    `[${RAW_EVIDENCE_PARITY_ERROR_CODE}] Raw evidence contract validation failed: ${issues
      .map((issue) => issue.field)
      .join(', ')}. No context capsule or retrieval audit was written.`
  )
}
