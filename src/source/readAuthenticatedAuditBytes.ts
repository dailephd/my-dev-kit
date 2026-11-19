import type { SourceAuditEvidenceArtifact, SourceAuditFile } from '../symbol-index/auditEvidenceTypes.js'
import { readSourceAuditFileBytes, SourceAuditEvidenceError } from '../lookup/readSourceAuditEvidence.js'

/** Shares the manifest-bound containment and hash authority with all audit reads. */
export function readAuthenticatedAuditBytes(
  artifact: SourceAuditEvidenceArtifact, file: SourceAuditFile, maxBytes = Infinity,
): Buffer {
  if (!file.contentSha256 || file.sizeBytes === null) {
    throw new SourceAuditEvidenceError('AUDIT_EVIDENCE_INVALID', 'Selected record lacks an authenticated byte identity.')
  }
  const bytes = readSourceAuditFileBytes(artifact, file, maxBytes)
  if (bytes.length !== file.sizeBytes) {
    throw new SourceAuditEvidenceError('AUDIT_EVIDENCE_INVALID', 'Selected record size contradicts authenticated bytes.')
  }
  return bytes
}
