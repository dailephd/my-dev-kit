import type {
  ClassificationEntry,
  ClassificationEvidence,
  ClassificationRole,
  ClassificationRoleName,
  ClassificationWarning,
  ClassificationWarningKind,
  EditGuidance,
  Readiness,
  RiskLabel,
  UncertaintyTier,
} from './classificationTypes.js'

/** One candidate category considered for a file or symbol, before conflict resolution. */
export interface CategoryCandidate {
  role: ClassificationRoleName
  subtype?: string | null
  confidence: UncertaintyTier
  evidence: ClassificationEvidence[]
}

export interface ResolvedCandidates {
  roles: ClassificationRole[]
  overallUncertainty: UncertaintyTier
  warningsToAdd: ClassificationWarning[]
  evidence: ClassificationEvidence[]
}

const UNCERTAINTY_RANK: Record<UncertaintyTier, number> = {
  certain: 3,
  likely: 2,
  possible: 1,
  unknown: 0,
}

/**
 * PSE-040: groups candidates by evidence strength (confidence tier) and keeps
 * only the strongest group. A single candidate at the strongest tier is
 * resolved directly; multiple tied candidates are ambiguous and capped at
 * 'possible' uncertainty with a conflicting-category warning (BEH-060).
 */
export function resolveCandidateConflicts(candidates: readonly CategoryCandidate[]): ResolvedCandidates {
  if (candidates.length === 0) {
    return { roles: [], overallUncertainty: 'unknown', warningsToAdd: [], evidence: [] }
  }
  if (candidates.length === 1) {
    const only = candidates[0]
    return {
      roles: [{ role: only.role, subtype: only.subtype ?? null, confidence: only.confidence }],
      overallUncertainty: only.confidence,
      warningsToAdd: buildLowConfidenceWarnings(only),
      evidence: only.evidence,
    }
  }

  const strongestRank = Math.max(...candidates.map((candidate) => UNCERTAINTY_RANK[candidate.confidence]))
  const strongest = candidates.filter((candidate) => UNCERTAINTY_RANK[candidate.confidence] === strongestRank)

  if (strongest.length === 1) {
    const only = strongest[0]
    return {
      roles: [{ role: only.role, subtype: only.subtype ?? null, confidence: only.confidence }],
      overallUncertainty: only.confidence,
      warningsToAdd: buildLowConfidenceWarnings(only),
      evidence: only.evidence,
    }
  }

  return {
    roles: strongest.map((candidate) => ({
      role: candidate.role,
      subtype: candidate.subtype ?? null,
      confidence: 'possible',
    })),
    overallUncertainty: 'possible',
    warningsToAdd: [
      {
        kind: 'conflicting-category',
        message: `multiple statically plausible categories: ${strongest.map((candidate) => candidate.role).join(', ')}`,
      },
    ],
    evidence: mergeEvidence(strongest.map((candidate) => candidate.evidence)),
  }
}

/**
 * PSE-033/avoidOverclaiming: a resolved 'possible'/'unknown'-tier candidate must
 * always surface >=1 warning explaining the limitation. Uses the candidate's own
 * evidence.uncertaintyReason when present (deterministic, evidence-derived);
 * falls back to a generic role-referencing message otherwise so the invariant
 * can never be silently violated regardless of which matcher produced the
 * candidate.
 */
function buildLowConfidenceWarnings(candidate: CategoryCandidate): ClassificationWarning[] {
  if (candidate.confidence !== 'possible' && candidate.confidence !== 'unknown') return []
  const reasons = candidate.evidence.map((evidence) => evidence.uncertaintyReason).filter((reason): reason is string => !!reason)
  const message =
    reasons.length > 0
      ? reasons.join('; ')
      : `'${candidate.role}' classification is only ${candidate.confidence} - evidence is not strong enough for a higher confidence tier`
  return [{ kind: 'ambiguous-evidence', message }]
}

/** PSE-031: deterministic merge - concatenate then de-duplicate, preserving first-seen order. */
function mergeEvidence(evidenceLists: readonly ClassificationEvidence[][]): ClassificationEvidence[] {
  const seen = new Set<string>()
  const merged: ClassificationEvidence[] = []
  for (const list of evidenceLists) {
    for (const evidence of list) {
      const key = `${evidence.kind}\0${evidence.source}\0${evidence.staticPattern ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(evidence)
    }
  }
  return merged
}

/** PSE-030: constructs one evidence entry; `reason` must always be non-empty. */
export function createEvidence(evidence: ClassificationEvidence): ClassificationEvidence {
  if (!evidence.reason || evidence.reason.trim() === '') {
    throw new Error('ClassificationEvidence.reason must not be empty')
  }
  return evidence
}

/**
 * PSE-033/avoidOverclaiming: 'possible'/'unknown' tier entries must always carry
 * at least one warning explaining the limitation (classification-contract.txt
 * section 6). Throws if violated so a malformed entry is never silently
 * written (matches AC-002's "build-time assertion failure" requirement).
 */
export function assertNoOverclaiming(entry: Pick<ClassificationEntry, 'uncertainty' | 'warnings'>): void {
  if ((entry.uncertainty === 'possible' || entry.uncertainty === 'unknown') && entry.warnings.length === 0) {
    throw new Error('possible/unknown-tier entry must carry >=1 warning explaining the limitation')
  }
}

/** INV-001: a certain-tier classification must have >=1 evidence entry. */
export function assertCertainHasEvidence(entry: Pick<ClassificationEntry, 'uncertainty' | 'evidence'>): void {
  if (entry.uncertainty === 'certain' && entry.evidence.length === 0) {
    throw new Error('certain-tier classification must have at least one evidence entry')
  }
}

/** INV-002: unknown uncertainty must pair only with 'uncertain' edit guidance. */
export function assertUnknownPairsWithUncertainGuidance(
  entry: Pick<ClassificationEntry, 'uncertainty' | 'editGuidance'>
): void {
  if (entry.uncertainty === 'unknown' && entry.editGuidance !== 'uncertain') {
    throw new Error("unknown uncertainty must pair with 'uncertain' edit guidance (INV-002)")
  }
}

/** INV-003: generated-file classification always pairs with generated-do-not-edit. */
export function assertGeneratedFilePairing(entry: Pick<ClassificationEntry, 'classifications' | 'editGuidance'>): void {
  const hasGeneratedFile = entry.classifications.some((classification) => classification.role === 'generated-file')
  if (hasGeneratedFile && entry.editGuidance !== 'generated-do-not-edit') {
    throw new Error("generated-file classification must pair with 'generated-do-not-edit' edit guidance (INV-003)")
  }
}

export function validateEntry(entry: ClassificationEntry): void {
  assertCertainHasEvidence(entry)
  assertUnknownPairsWithUncertainGuidance(entry)
  assertGeneratedFilePairing(entry)
  assertNoOverclaiming(entry)
}

export function buildWarning(kind: ClassificationWarningKind, message: string): ClassificationWarning {
  return { kind, message }
}

export function editGuidanceForUnresolved(): EditGuidance {
  return 'uncertain'
}

export function readinessForUnresolved(): Readiness {
  return 'needs-more-context'
}

export function deriveReadiness(overallUncertainty: UncertaintyTier, hasConflictWarning: boolean): Readiness {
  if (hasConflictWarning) return 'risky-assumption'
  if (overallUncertainty === 'possible' || overallUncertainty === 'unknown') return 'needs-more-context'
  return 'ready'
}

export function dedupeRisks(risks: readonly RiskLabel[]): RiskLabel[] {
  return [...new Set(risks)]
}
