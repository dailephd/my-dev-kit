import { createHash } from 'node:crypto'
import type { SourceAuditEvidenceArtifact } from '../symbol-index/auditEvidenceTypes.js'
import { AUDIT_CONTENT_MAX_BYTES } from '../symbol-index/auditEvidenceTypes.js'
import { isCanonicalAuditRelativePath, SourceAuditEvidenceError } from '../lookup/readSourceAuditEvidence.js'
import { ensureInsideProjectRoot } from '../lookup/getSourceSlice.js'
import { readAuthenticatedAuditBytes } from './readAuthenticatedAuditBytes.js'

const MAX_MATCHES = 200

export function findExactByteMatches(artifact: SourceAuditEvidenceArtifact, filePath: string, hex: string) {
  if (artifact.schemaVersion !== '1.2.0') throw new SourceAuditEvidenceError('AUDIT_EVIDENCE_INVALID', 'Byte occurrence requires audit schema 1.2.0.')
  if (hex.length < 2 || hex.length > 8192 || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error('INVALID_BYTE_NEEDLE: Expected 1–4096 bytes of even-length hexadecimal.')
  }
  const file = isCanonicalAuditRelativePath(filePath) && artifact.files.find(item => item.path === filePath)
  if (!file) throw new SourceAuditEvidenceError('INVALID_AUDIT_PATH', 'Expected a canonical selected file.')
  ensureInsideProjectRoot(artifact.source.projectRoot, filePath)
  const needle = Buffer.from(hex, 'hex')
  const identity = {
    schemaVersion: '1.0.0', mode: 'exact-file-byte-occurrence', snapshotId: artifact.source.snapshotId,
    selectionFingerprint: artifact.source.selectionFingerprint, filePath,
    expectedContentSha256: file.contentSha256, sizeBytes: file.sizeBytes, needleHex: hex.toLowerCase(),
    matching: 'literal-bytes-overlapping',
  } as const
  const reasonCode = file.sizeBytes !== null && file.sizeBytes > AUDIT_CONTENT_MAX_BYTES
    ? 'FILE_EXCEEDS_SCAN_LIMIT' : file.contentSha256 === null ? 'CONTENT_HASH_UNAVAILABLE' : null
  if (reasonCode) return {
    ...identity, verifiedContentSha256: null, sourceAuthenticated: false,
    scannedBytes: 0, scanComplete: false, matchCount: 0, matchCountExact: false,
    returnedMatches: 0, matchesComplete: false, truncated: false, complete: false, reasonCode, matches: [],
  }
  const bytes = readAuthenticatedAuditBytes(artifact, file, AUDIT_CONTENT_MAX_BYTES)
  const matches: Array<{ startByte: number; endByteExclusive: number }> = []
  let matchCount = 0
  for (let offset = bytes.indexOf(needle); offset >= 0; offset = bytes.indexOf(needle, offset + 1)) {
    matchCount += 1
    if (matches.length < MAX_MATCHES) matches.push({ startByte: offset, endByteExclusive: offset + needle.length })
  }
  const truncated = matchCount > matches.length
  return {
    ...identity, verifiedContentSha256: createHash('sha256').update(bytes).digest('hex'),
    sourceAuthenticated: true, scannedBytes: bytes.length, scanComplete: true,
    matchCount, matchCountExact: true, returnedMatches: matches.length,
    matchesComplete: !truncated, truncated, complete: !truncated,
    reasonCode: truncated ? 'MATCHES_TRUNCATED' : null, matches,
  }
}
