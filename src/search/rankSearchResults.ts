import type { SearchCandidate, SearchMatchReason, SearchResultItem } from './searchTypes.js'

const ALL_TERMS_BONUS = 10
const EXACT_PHRASE_MULTIPLIER = 2
const MAX_MATCH_TEXT_LENGTH = 120

export function normalizeSearchQuery(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/[\s.,;:()[\]{}<>"'`|\\/!?@#$%^&*+=~-]+/u)
    .map((term) => term.trim())
    .filter(Boolean)
}

export function rankSearchResults(options: {
  candidates: SearchCandidate[]
  query: string
  normalizedTerms: string[]
  limit: number
}): SearchResultItem[] {
  const phrase = options.query.trim().toLowerCase()
  const ranked = options.candidates
    .map((candidate) => scoreCandidate(candidate, phrase, options.normalizedTerms))
    .filter((item): item is SearchResultItem => item !== null)
  if (/^(?:[\p{L}\p{N}_]+::)*[\p{L}\p{N}_]+$/u.test(phrase)) {
    const exactIds = new Set(options.candidates.filter(candidate => candidate.item.language === 'rust' && candidate.fields.some(field => field.field === 'symbolName' && (field.text.toLowerCase() === phrase || field.text.toLowerCase().endsWith(`::${phrase}`)))).map(candidate => candidate.item.id))
    const exactScores = ranked.filter(item => exactIds.has(item.id)).map(item => item.score)
    if (exactScores.length > 0) {
      const ceiling = exactScores.reduce((minimum, score) => Math.min(minimum, score), Infinity) - 1
      for (const item of ranked) if (item.language === 'rust' && !exactIds.has(item.id)) item.score = Math.min(item.score, ceiling)
    }
  }
  ranked.sort(compareResults)

  return ranked.slice(0, options.limit)
}

function scoreCandidate(candidate: SearchCandidate, phrase: string, terms: string[]): SearchResultItem | null {
  const reasons: SearchMatchReason[] = []
  const matchedTerms = new Set<string>()

  // Repeated owner aliases are useful vocabulary, not independent proof that one
  // physical Rust method owns an otherwise ambiguous simple/qualified name.
  const exactRustNames = candidate.item.language === 'rust' && candidate.item.kind === 'symbol' && /^(?:[\p{L}\p{N}_]+::)*[\p{L}\p{N}_]+$/u.test(phrase)
    ? candidate.fields.filter(field => field.field === 'symbolName' && (field.text.toLowerCase() === phrase || field.text.toLowerCase().endsWith(`::${phrase}`)))
    : []
  const fields = exactRustNames.length > 0 ? [exactRustNames.sort((a, b) => a.text.length - b.text.length || a.text.localeCompare(b.text))[0]] : candidate.fields
  for (const field of fields) {
    const normalizedText = field.text.toLowerCase()
    if (phrase && normalizedText.includes(phrase)) {
      reasons.push({
        field: field.field,
        term: phrase,
        weight: field.weight * EXACT_PHRASE_MULTIPLIER,
        text: shorten(field.text),
      })
    }

    for (const term of terms) {
      if (!normalizedText.includes(term)) continue
      matchedTerms.add(term)
      reasons.push({
        field: field.field,
        term,
        weight: field.weight,
        text: shorten(field.text),
      })
    }
  }

  if (reasons.length === 0) return null
  const dedupedReasons = dedupeReasons(reasons)
  const baseScore = dedupedReasons.reduce((sum, reason) => sum + reason.weight, 0)
  const score = baseScore + (terms.length > 0 && matchedTerms.size === terms.length ? ALL_TERMS_BONUS : 0)

  return {
    ...candidate.item,
    score,
    matchReasons: dedupedReasons.sort(compareReasons),
  }
}

function dedupeReasons(reasons: SearchMatchReason[]): SearchMatchReason[] {
  const seen = new Set<string>()
  const result: SearchMatchReason[] = []
  for (const reason of reasons) {
    const key = `${reason.field}\0${reason.term}\0${reason.text}\0${reason.weight}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(reason)
  }
  return result
}

function compareResults(a: SearchResultItem, b: SearchResultItem): number {
  return (
    b.score - a.score ||
    a.kind.localeCompare(b.kind) ||
    stableResultKey(a).localeCompare(stableResultKey(b))
  )
}

function stableResultKey(item: SearchResultItem): string {
  return item.path ?? item.id
}

function compareReasons(a: SearchMatchReason, b: SearchMatchReason): number {
  return b.weight - a.weight || a.field.localeCompare(b.field) || a.term.localeCompare(b.term) || a.text.localeCompare(b.text)
}

function shorten(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= MAX_MATCH_TEXT_LENGTH) return compact
  return `${compact.slice(0, MAX_MATCH_TEXT_LENGTH - 3)}...`
}
