/**
 * v1.10.1 Batch 4: freshness classification (sections 21-22).
 *
 * The active index manifest (`manifestTypes.ts`) does not record a repository
 * commit or content hash (no such owner exists yet — recording that would be a
 * new artifact-family/schema decision out of Batch 4 scope), so "supplied
 * repository commit matches manifest commit" can never be proven today. Freshness
 * is instead grounded in what Batch 1/2 already capture: whether a before/after
 * graph-diff was requested and, when so, whether the *active* `--index`/`index`
 * used for retrieval is the after-index (post-change), the before-index
 * (pre-change), or neither. `git rev-parse HEAD` is read read-only, wrapped so a
 * missing/absent Git never throws, and is recorded as informational evidence only
 * (there is nothing in the manifest to compare it against yet).
 */
import { execFileSync } from 'node:child_process'
import * as path from 'node:path'
import { toForwardSlash } from '../io/pathUtils.js'
import type { ChangedSurface, ContextRole, FreshnessComparedIdentity, FreshnessSummary } from './types.js'

function normalizeForComparison(p: string): string {
  return toForwardSlash(path.resolve(p))
}

/** Read-only, optional, safe: absence of Git / not-a-repo / any failure degrades
 * to `null`, never throws (section 21.6). */
export function readRepositoryHeadCommit(repoRoot: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] })
    const commit = out.toString('utf8').trim()
    return /^[0-9a-f]{7,40}$/i.test(commit) ? commit : null
  } catch {
    return null
  }
}

export interface ClassifyFreshnessOptions {
  role: ContextRole | null
  activeIndexPath: string
  beforeIndexPath: string | null
  afterIndexPath: string | null
  diffRequested: boolean
  changedSurface: ChangedSurface
  /** Injectable for deterministic tests; defaults to a real, wrapped `git rev-parse HEAD`. */
  readRepositoryHeadCommitFn?: (repoRoot: string) => string | null
  repoRoot: string
}

export function classifyFreshness(options: ClassifyFreshnessOptions): FreshnessSummary {
  const { role, activeIndexPath, beforeIndexPath, afterIndexPath, diffRequested, changedSurface, repoRoot } = options
  const readHead = options.readRepositoryHeadCommitFn ?? readRepositoryHeadCommit

  const evidenceUsed: string[] = ['active index path']
  const evidenceUnavailable: string[] = []
  const comparedIdentities: FreshnessComparedIdentity[] = [{ label: 'activeIndexPath', value: normalizeForComparison(activeIndexPath) }]
  const warnings: string[] = []

  const headCommit = readHead(repoRoot)
  if (headCommit) {
    evidenceUsed.push('repository HEAD commit (informational; not recorded in the index manifest, so it cannot be compared)')
    comparedIdentities.push({ label: 'repositoryHeadCommit', value: headCommit })
  } else {
    evidenceUnavailable.push('repository HEAD commit (no Git repository, Git not installed, or the read failed)')
  }

  const relevantChangedPaths = [...changedSurface.files.filter((f) => f.status !== 'removed').map((f) => f.path)].sort()

  if (!diffRequested) {
    comparedIdentities.push({ label: 'beforeIndexPath', value: null }, { label: 'afterIndexPath', value: null })
    evidenceUnavailable.push('beforeIndex/afterIndex graph diff (not supplied)')
    if (changedSurface.available) {
      // Caller-supplied changedFiles/changedSymbols with no before/after comparison:
      // we know something changed, but cannot prove whether the active index reflects
      // it (section 21.5) — never label this fresh.
      return {
        state: 'unknown',
        role,
        evidenceUsed,
        evidenceUnavailable,
        comparedIdentities,
        reason: 'Caller-supplied changed-surface evidence exists, but no beforeIndex/afterIndex graph diff was supplied, so whether the active index reflects those changes cannot be proven.',
        relevantChangedPaths,
        warnings,
      }
    }
    return {
      state: 'unknown',
      role,
      evidenceUsed,
      evidenceUnavailable: [...evidenceUnavailable, 'changed-surface evidence (none supplied)'],
      comparedIdentities,
      reason: 'No before/after graph diff and no changed-surface evidence were supplied; freshness relative to any prior repository state cannot be established.',
      relevantChangedPaths,
      warnings,
    }
  }

  // diffRequested: both beforeIndex and afterIndex were supplied (buildChangedSurface
  // throws otherwise), so both paths are non-null here.
  const beforeNormalized = normalizeForComparison(beforeIndexPath as string)
  const afterNormalized = normalizeForComparison(afterIndexPath as string)
  const activeNormalized = normalizeForComparison(activeIndexPath)
  comparedIdentities.push({ label: 'beforeIndexPath', value: beforeNormalized }, { label: 'afterIndexPath', value: afterNormalized })
  evidenceUsed.push('beforeIndex/afterIndex graph diff', 'changed-surface evidence')

  const matchesAfter = activeNormalized === afterNormalized
  const matchesBefore = activeNormalized === beforeNormalized

  if (matchesAfter) {
    return {
      state: 'fresh',
      role,
      evidenceUsed,
      evidenceUnavailable,
      comparedIdentities,
      reason: 'The active index path matches the supplied afterIndex, so the retrieved context reflects the post-change repository state.',
      relevantChangedPaths,
      warnings,
    }
  }
  if (matchesBefore && relevantChangedPaths.length > 0) {
    return {
      state: 'stale',
      role,
      evidenceUsed,
      evidenceUnavailable,
      comparedIdentities,
      reason: 'The active index path matches the supplied beforeIndex while relevant changed-surface evidence exists; the retrieved context predates those changes.',
      relevantChangedPaths,
      warnings: [...warnings, ...(role === 'test-implementation' ? ['Test-implementation context was built from a pre-change (beforeIndex) active index after production changes were supplied.'] : [])],
    }
  }
  return {
    state: 'unknown',
    role,
    evidenceUsed,
    evidenceUnavailable: [...evidenceUnavailable, 'active-index-to-before/after-index identity match'],
    comparedIdentities,
    reason: 'A beforeIndex/afterIndex graph diff was supplied, but the active index path matches neither, so its relationship to the diffed repository states cannot be established.',
    relevantChangedPaths,
    warnings,
  }
}
