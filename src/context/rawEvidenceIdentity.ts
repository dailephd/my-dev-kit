import * as path from 'node:path'
import { toForwardSlash } from '../io/pathUtils.js'
import type { ResolvedIndexManifest } from '../indexing/readIndexManifest.js'

/**
 * Grounded index/repository identity shared by the context capsule and retrieval
 * audit. Artifact-specific fields do not belong here.
 */
export interface RawEvidenceIndexIdentity {
  readonly projectRoot: string
  readonly indexPath: string
  readonly manifestPath: string
  readonly manifestSchemaVersion: string
}

/**
 * Pure path representation for serialized raw-evidence identity.
 *
 * It normalizes separators and redundant/trailing segments, uppercases only a
 * Windows drive letter, and preserves the case of every other path segment
 * (including POSIX paths). Relative paths remain relative: identity is never
 * fabricated from the current working directory.
 */
export function canonicalizeEvidenceIdentityPath(value: string): string {
  const forward = toForwardSlash(value.trim())
  let normalized: string

  if (/^[A-Za-z]:\//.test(forward) || forward.startsWith('//')) {
    normalized = toForwardSlash(path.win32.normalize(forward))
    normalized = normalized.replace(/^([a-z]):\//, (_, drive: string) => `${drive.toUpperCase()}:/`)
  } else {
    normalized = path.posix.normalize(forward)
  }

  if (normalized === '/' || /^[A-Z]:\/$/.test(normalized)) return normalized
  return normalized.replace(/\/+$/g, '')
}

export function buildRawEvidenceIndexIdentity(resolved: ResolvedIndexManifest): RawEvidenceIndexIdentity {
  return Object.freeze({
    projectRoot: canonicalizeEvidenceIdentityPath(resolved.manifest.projectRoot),
    indexPath: canonicalizeEvidenceIdentityPath(resolved.indexDir),
    manifestPath: canonicalizeEvidenceIdentityPath(resolved.manifestPath),
    manifestSchemaVersion: resolved.manifest.version,
  })
}
