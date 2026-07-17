/**
 * v1.10.1 Batch 4: bounded, auditable full-file fallback (section 26).
 *
 * Extends the existing bounded source-selection model (`sourceSelection.ts`'s
 * line-range/continuation/local-expansion retrieval and `SourceRetrievalMethod`)
 * rather than replacing it: a full-file fallback is only ever attempted for a
 * small, explicit set of files that responsibility mapping/evidence-group
 * construction already identified as relevant but not covered by any selected
 * source slice. It reads the file once, bounded by `MAX_FALLBACK_READ_BYTES`,
 * and records only line/character counts — never the file content itself — into
 * a `FullFileFallbackRecord`. Honors `ContextRequestLimits.fullFileFallbacks`:
 * `0` disables fallback entirely (still recorded as unresolved evidence, never
 * silently dropped); a positive value caps the fallback count deterministically
 * (sorted by file path).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { toForwardSlash } from '../io/pathUtils.js'
import type { ContextRole, FullFileFallbackRecord, FullFileFallbackSummary } from './types.js'

const MAX_FALLBACK_READ_BYTES = 200_000
const DEFAULT_FULL_FILE_FALLBACK_LIMIT = 3

export interface FullFileFallbackCandidate {
  filePath: string
  reason: string
  requestedEvidenceKind: string | null
  responsibilityIdsAffected: string[]
}

export interface BuildFullFileFallbacksOptions {
  role: ContextRole | null
  repoRoot: string
  candidates: FullFileFallbackCandidate[]
  /** Files already covered by a selected bounded source slice/bundle; never re-fetched
   * as a "fallback" (bounded retrieval already succeeded for them). */
  alreadyCoveredFilePaths: Set<string>
  /** `ContextRequestLimits.fullFileFallbacks`. `0` disables fallback; `undefined`/`null`
   * uses the conservative default cap. */
  limit: number | null | undefined
}

export function buildFullFileFallbacks(options: BuildFullFileFallbacksOptions): FullFileFallbackSummary {
  const { role, repoRoot, alreadyCoveredFilePaths } = options
  const enabled = options.limit !== 0
  const limit = options.limit ?? DEFAULT_FULL_FILE_FALLBACK_LIMIT
  const warnings: string[] = []

  const dedupedByPath = new Map<string, FullFileFallbackCandidate>()
  for (const candidate of options.candidates) {
    if (alreadyCoveredFilePaths.has(candidate.filePath)) continue
    const existing = dedupedByPath.get(candidate.filePath)
    if (!existing) {
      dedupedByPath.set(candidate.filePath, candidate)
    } else {
      dedupedByPath.set(candidate.filePath, {
        ...existing,
        responsibilityIdsAffected: [...new Set([...existing.responsibilityIdsAffected, ...candidate.responsibilityIdsAffected])].sort(),
      })
    }
  }
  const sortedCandidates = [...dedupedByPath.values()].sort((a, b) => a.filePath.localeCompare(b.filePath))

  if (!enabled) {
    const fallbacks: FullFileFallbackRecord[] = sortedCandidates.map((c) => ({
      id: `fallback-disabled:${c.filePath}`,
      filePath: c.filePath,
      reason: c.reason,
      requestedEvidenceKind: c.requestedEvidenceKind,
      boundedRetrievalAttempted: true,
      sourceRangesAttempted: 0,
      includedLineCount: 0,
      includedCharacterCount: 0,
      role,
      responsibilityIdsAffected: c.responsibilityIdsAffected,
      allowed: false,
      provenance: 'full-file-fallback: disabled by limits.fullFileFallbacks = 0',
    }))
    if (fallbacks.length > 0) {
      warnings.push(`Full-file fallback is disabled (limits.fullFileFallbacks = 0); ${fallbacks.length} file(s) that needed it remain unresolved.`)
    }
    return { enabled: false, limit: 0, used: 0, fallbacks, warnings }
  }

  const applied = sortedCandidates.slice(0, limit)
  const droppedByLimit = sortedCandidates.slice(limit)

  const fallbacks: FullFileFallbackRecord[] = applied.map((c) => {
    const absolute = path.resolve(repoRoot, c.filePath)
    let includedLineCount = 0
    let includedCharacterCount = 0
    let readOk = false
    try {
      const stat = fs.statSync(absolute)
      if (stat.isFile() && stat.size <= MAX_FALLBACK_READ_BYTES) {
        const text = fs.readFileSync(absolute, 'utf8')
        includedCharacterCount = text.length
        includedLineCount = text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length
        readOk = true
      }
    } catch {
      readOk = false
    }
    return {
      id: `fallback:${c.filePath}`,
      filePath: c.filePath,
      reason: c.reason,
      requestedEvidenceKind: c.requestedEvidenceKind,
      boundedRetrievalAttempted: true,
      sourceRangesAttempted: 1,
      includedLineCount,
      includedCharacterCount,
      role,
      responsibilityIdsAffected: c.responsibilityIdsAffected,
      allowed: readOk,
      provenance: readOk ? 'full-file-fallback: bounded whole-file read (content not embedded)' : 'full-file-fallback: attempted, read failed or exceeded the bounded size cap',
    }
  })

  for (const c of droppedByLimit) {
    fallbacks.push({
      id: `fallback-capped:${c.filePath}`,
      filePath: c.filePath,
      reason: c.reason,
      requestedEvidenceKind: c.requestedEvidenceKind,
      boundedRetrievalAttempted: false,
      sourceRangesAttempted: 0,
      includedLineCount: 0,
      includedCharacterCount: 0,
      role,
      responsibilityIdsAffected: c.responsibilityIdsAffected,
      allowed: false,
      provenance: `full-file-fallback: cap reached (limits.fullFileFallbacks = ${limit})`,
    })
  }
  if (droppedByLimit.length > 0) {
    warnings.push(`${droppedByLimit.length} full-file fallback(s) exceeded the fullFileFallbacks cap (${limit}) and remain unresolved.`)
  }

  const usedCount = fallbacks.slice(0, applied.length).filter((f) => f.allowed).length

  return {
    enabled: true,
    limit,
    used: usedCount,
    fallbacks: [...fallbacks].sort((a, b) => a.filePath.localeCompare(b.filePath)),
    warnings,
  }
}
