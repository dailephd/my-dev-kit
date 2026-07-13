import type { SearchResultItem } from '../search/searchTypes.js'
import type { CandidateFile, CandidateNode, ContextCapsuleMode, ModeEffects } from './types.js'

const GENERIC_FILENAME_PATTERN =
  /^(readme(\.\w+)?|license(\.\w+)?|changelog(\.\w+)?|package(-lock)?\.json|tsconfig.*\.json|\.gitignore|\.npmignore)$/i
const GENERIC_FILE_PENALTY = 20
const MIN_DISTINCT_TERMS_TO_AVOID_PENALTY = 2

export interface RankingInput {
  status: 'ok' | 'no-terms' | 'search-failed'
  results: SearchResultItem[]
  warnings: string[]
}

interface PenalizedResult {
  result: SearchResultItem
  baseScore: number
  score: number
  penaltyReasons: string[]
  modeReasons: string[]
}

function basename(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] ?? filePath
}

function applyGenericFilePenalty(result: SearchResultItem): PenalizedResult {
  const path = result.path
  const isGeneric = path !== undefined && GENERIC_FILENAME_PATTERN.test(basename(path))
  const distinctMatchedTerms = new Set(result.matchReasons.map((reason) => reason.term)).size

  if (isGeneric && distinctMatchedTerms < MIN_DISTINCT_TERMS_TO_AVOID_PENALTY) {
    return {
      result,
      baseScore: result.score - GENERIC_FILE_PENALTY,
      score: result.score - GENERIC_FILE_PENALTY,
      penaltyReasons: ['penalized: generic top-level file with weak query evidence'],
      modeReasons: [],
    }
  }
  return { result, baseScore: result.score, score: result.score, penaltyReasons: [], modeReasons: [] }
}

function directoryOf(filePath: string | undefined): string {
  if (!filePath) return ''
  const normalized = filePath.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(0, index) : ''
}

function applyModeAdjustment(
  entry: PenalizedResult,
  mode: ContextCapsuleMode,
  strongestDirectory: string
): PenalizedResult {
  if (mode === 'general') return entry
  const guidance = new Set(entry.result.classificationRoles?.map((role) => role.editGuidance) ?? [])
  const path = (entry.result.path ?? '').replace(/\\/g, '/').toLowerCase()
  const reasons: string[] = []
  let adjustment = 0

  if (mode === 'feature-add') {
    if (guidance.has('safe-primary-edit-target')) {
      adjustment += 6
      reasons.push('mode feature-add: preferred safe primary edit target (+6)')
    } else if (guidance.has('inspect-before-edit')) {
      adjustment += 3
      reasons.push('mode feature-add: preferred inspect-before-edit candidate (+3)')
    }
    if (guidance.has('docs-only') || /(^|\/)(docs?|readme)(\/|\.|$)/.test(path)) {
      adjustment -= 4
      reasons.push('mode feature-add: deprioritized docs-only candidate (-4)')
    }
    if (guidance.has('test-only') || /(^|\/)(__tests__|tests?)(\/|\.|$)/.test(path)) {
      adjustment += 2
      reasons.push('mode feature-add: retained nearby test support (+2)')
    }
  } else if (strongestDirectory && directoryOf(entry.result.path) === strongestDirectory) {
    adjustment += 4
    reasons.push('mode subsystem: preferred strongest-candidate path cluster (+4)')
  }

  return { ...entry, score: entry.score + adjustment, modeReasons: reasons }
}

function buildReasons(result: SearchResultItem, penaltyReasons: string[], modeReasons: string[] = []): string[] {
  const reasons: string[] = []
  const seen = new Set<string>()
  for (const matchReason of result.matchReasons) {
    const reason = `${matchReason.field} matched term "${matchReason.term}"`
    if (seen.has(reason)) continue
    seen.add(reason)
    reasons.push(reason)
  }
  if (result.semanticRoles?.length) reasons.push('semantic role present on candidate')
  if (result.classificationRoles?.length) reasons.push('classification role present on candidate')
  if (result.artifactRefs?.length) reasons.push('artifact reference present on candidate')
  reasons.push(...penaltyReasons)
  reasons.push(...modeReasons)
  return reasons
}

function matchedTerms(result: SearchResultItem): string[] {
  const terms = new Set<string>()
  for (const reason of result.matchReasons) terms.add(reason.term)
  return [...terms].sort()
}

export function rankCandidateFiles(
  input: RankingInput,
  maxCandidateFiles: number | null,
  mode: ContextCapsuleMode = 'general'
): CandidateFile[] {
  const fileResults = input.results.filter((result) => result.kind === 'file')
  const base = fileResults.map(applyGenericFilePenalty)
  const strongestDirectory = directoryOf([...base].sort((a, b) => b.baseScore - a.baseScore || (a.result.path ?? a.result.id).localeCompare(b.result.path ?? b.result.id))[0]?.result.path)
  const penalized = base.map((entry) => applyModeAdjustment(entry, mode, strongestDirectory))
  const sorted = [...penalized].sort(
    (a, b) => b.score - a.score || (a.result.path ?? a.result.id).localeCompare(b.result.path ?? b.result.id)
  )

  const cappedCount = maxCandidateFiles != null ? Math.min(maxCandidateFiles, sorted.length) : sorted.length
  const retained = sorted.slice(0, cappedCount)
  const dropped = sorted.slice(cappedCount)

  return [
    ...retained.map((entry) => toCandidateFile(entry, true)),
    ...dropped.map((entry) => toCandidateFile(entry, false, 'cap exceeded (--max-candidate-files)')),
  ]
}

function toCandidateFile(entry: PenalizedResult, retained: boolean, droppedReason?: string): CandidateFile {
  const { result, score, penaltyReasons } = entry
  return {
    path: result.path ?? result.id,
    score,
    baseScore: entry.baseScore,
    modeAdjustment: score - entry.baseScore,
    reasons: buildReasons(result, penaltyReasons, entry.modeReasons),
    matchedTerms: matchedTerms(result),
    ...(result.semanticRoles ? { semanticRoles: result.semanticRoles } : {}),
    ...(result.artifactRefs ? { artifactRefs: result.artifactRefs } : {}),
    ...(result.classificationRoles ? { classificationRoles: result.classificationRoles } : {}),
    ...(result.classificationRefs ? { classificationRefs: result.classificationRefs } : {}),
    retained,
    ...(droppedReason ? { droppedReason } : {}),
  }
}

/** Node kinds eligible for the generic node-candidate pool: source-backed `file`/`symbol` plus Batch 5's compact `android-*` artifact-backed graph nodes (v1.10.0 Batch 6) - reuses the exact same scoring/penalty/mode-adjustment pipeline as file/symbol candidates, never a separate ranking model. */
function isEligibleNodeKind(kind: string): boolean {
  return kind === 'file' || kind === 'symbol' || kind.startsWith('android-')
}

export function rankCandidateNodes(input: RankingInput, mode: ContextCapsuleMode = 'general'): CandidateNode[] {
  const nodeResults = input.results.filter((result) => isEligibleNodeKind(result.kind))
  const base = nodeResults.map(applyGenericFilePenalty)
  const strongestDirectory = directoryOf([...base].sort((a, b) => b.baseScore - a.baseScore || a.result.id.localeCompare(b.result.id))[0]?.result.path)
  const penalized = base.map((entry) => applyModeAdjustment(entry, mode, strongestDirectory))
  const sorted = [...penalized].sort((a, b) => b.score - a.score || a.result.id.localeCompare(b.result.id))

  return sorted.map((entry) => toCandidateNode(entry))
}

function toCandidateNode(entry: PenalizedResult): CandidateNode {
  const { result, score, penaltyReasons } = entry
  const kind = result.kind === 'symbol' ? 'symbol' : result.kind.startsWith('android-') ? result.kind : 'file'
  return {
    nodeId: result.nodeId ?? result.id,
    kind,
    label: result.label,
    ...(result.path ? { filePath: result.path } : {}),
    score,
    baseScore: entry.baseScore,
    modeAdjustment: score - entry.baseScore,
    reasons: buildReasons(result, penaltyReasons, entry.modeReasons),
    matchedTerms: matchedTerms(result),
    ...(result.semanticRoles ? { semanticRoles: result.semanticRoles } : {}),
    ...(result.artifactRefs ? { artifactRefs: result.artifactRefs } : {}),
    ...(result.classificationRoles ? { classificationRoles: result.classificationRoles } : {}),
    ...(result.classificationRefs ? { classificationRefs: result.classificationRefs } : {}),
    ...(result.androidArtifactId ? { androidArtifactId: result.androidArtifactId } : {}),
    ...(result.androidMetadata ? { androidMetadata: result.androidMetadata } : {}),
    retained: true,
  }
}

export function buildModeEffects(
  mode: ContextCapsuleMode,
  candidateFiles: CandidateFile[],
  candidateNodes: CandidateNode[]
): ModeEffects {
  const effects = [...candidateFiles.map((candidate) => ({
    candidateId: candidate.path,
    adjustment: candidate.modeAdjustment ?? 0,
    reasons: candidate.reasons.filter((reason) => reason.startsWith('mode ')),
  })), ...candidateNodes.map((candidate) => ({
    candidateId: candidate.nodeId,
    adjustment: candidate.modeAdjustment ?? 0,
    reasons: candidate.reasons.filter((reason) => reason.startsWith('mode ')),
  }))]
    .filter((effect) => effect.adjustment !== 0)
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId))
  return { mode, applied: effects.length > 0, effects, warnings: [] }
}
