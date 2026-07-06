/**
 * Large-repo preflight warnings.
 *
 * These are static, deterministic advisories computed from discovery counts
 * and source roots before or after a scan. They never fail the command by
 * themselves; they only report evidence so a human or coding agent can
 * decide whether to narrow `--src`/`--exclude` before a large index run.
 */

export const LARGE_FILE_COUNT_THRESHOLD = 5000
export const BROAD_SOURCE_ROOT_FILE_THRESHOLD = 1000

export type PreflightWarningCode = 'large-file-count' | 'broad-source-root'

export interface PreflightWarning {
  code: PreflightWarningCode
  message: string
}

export interface PreflightWarningInput {
  sourceRoots: string[]
  totalFilesDiscovered: number
  totalFilesEligibleForIndexing: number
}

function isBroadSourceRoot(sourceRoot: string): boolean {
  const normalized = sourceRoot.trim().replace(/^\/+|\/+$/g, '')
  return normalized === '' || normalized === '.'
}

/**
 * Computes deterministic preflight warnings from discovery counts.
 *
 * Order is fixed (large-file-count, then broad-source-root) regardless of
 * which conditions are met, so JSON/manifest consumers can rely on stable
 * ordering across runs with the same inputs.
 */
export function computePreflightWarnings(input: PreflightWarningInput): PreflightWarning[] {
  const warnings: PreflightWarning[] = []

  if (input.totalFilesEligibleForIndexing > LARGE_FILE_COUNT_THRESHOLD) {
    warnings.push({
      code: 'large-file-count',
      message:
        `large-file-count: ${input.totalFilesEligibleForIndexing} eligible file(s) exceed the safe preflight ` +
        `threshold of ${LARGE_FILE_COUNT_THRESHOLD}. Indexing can still proceed; this is a static file-count ` +
        'observation, not a guarantee of runtime or memory safety.',
    })
  }

  const broadRoots = input.sourceRoots.filter(isBroadSourceRoot)
  if (broadRoots.length > 0 && input.totalFilesDiscovered > BROAD_SOURCE_ROOT_FILE_THRESHOLD) {
    warnings.push({
      code: 'broad-source-root',
      message:
        `broad-source-root: source root(s) [${broadRoots.join(', ')}] resolve to the project root and ` +
        `${input.totalFilesDiscovered} file(s) were discovered, above the ${BROAD_SOURCE_ROOT_FILE_THRESHOLD} ` +
        'file preflight threshold. Consider a narrower --src if this is unintentional.',
    })
  }

  return warnings
}
