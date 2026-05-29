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
    .sort(compareResults)

  return ranked.slice(0, options.limit)
}

function scoreCandidate(candidate: SearchCandidate, phrase: string, terms: string[]): SearchResultItem | null {
  const reasons: SearchMatchReason[] = []
  const matchedTerms = new Set<string>()

  for (const field of candidate.fields) {
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
