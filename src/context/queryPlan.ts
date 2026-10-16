import { normalizeSearchQuery } from '../search/rankSearchResults.js'
import { normalizeQuery } from './contextCapsule.js'
import type { ContextCapsuleMode, QueryPlan, QueryTerms } from './types.js'

const KNOWN_COMMAND_NAMES = new Set([
  'index',
  'search',
  'lookup',
  'source',
  'slice',
  'view',
  'data-model',
  'context',
])

const KNOWN_ARTIFACT_NAMES = new Set([
  'manifest.json',
  'code-graph.json',
  'symbol-index.json',
  'call-graph.json',
  'data-model.json',
  'data-model-graph.json',
  'model-view-lineage.json',
  'frontend-semantic.json',
  'frontend-reachability.json',
  'classification.json',
])

const KNOWN_CLASSIFICATION_ROLE_NAMES = new Set([
  'canonical-type',
  'artifact-type',
  'database-model',
  'projection-type',
  'view-model',
  'ui-only-state',
  'test-fixture',
  'persistence-adapter',
  'route-handler',
  'client-component',
  'server-component',
  'generated-file',
  'configuration-file',
  'command-handler',
  'analyzer',
  'validator',
  'public-docs',
  'internal-planning-docs',
])

const PATH_LIKE_EXTENSION = /\.(ts|tsx|js|jsx|py|json|md)$/i
const SYMBOL_LIKE_PATTERN = /^[a-z]+[A-Z]/
const PASCAL_CASE_PATTERN = /^[A-Z][a-zA-Z0-9]*$/
const TRAILING_PUNCTUATION = /[.,;:!?)('"]+$/

/**
 * v1.13.0 Batch 1C: fixed, reproduced low-information connector terms. Only the
 * exact lowercase bare word is ever suppressed, and only when the query has
 * other meaningful terms. Not a general stop-word list.
 */
const CONNECTOR_TERMS: ReadonlySet<string> = new Set(['a', 'to', 'in', 'the'])
const QUERY_TOKEN_PATTERN = /"[^"]*"|\S+/g

export interface EffectiveSearchQuery {
  query: string
  suppressedTerms: string[]
}

/**
 * Builds the internal lexical query used for context candidate discovery. Bare
 * lowercase connector words are dropped from multiword queries so that
 * substring matching in the search engine cannot let them dominate owner
 * selection. Protected and kept verbatim: quoted phrases, any token that is not
 * exactly a connector (paths, routes, qualified names, identifiers, capitalized
 * words), single-token queries, and queries that would otherwise be empty.
 */
export function buildEffectiveSearchQuery(originalQuery: string): EffectiveSearchQuery {
  const normalized = normalizeQuery(originalQuery)
  const tokens = normalized.match(QUERY_TOKEN_PATTERN) ?? []
  if (tokens.length < 2) return { query: normalized, suppressedTerms: [] }
  const kept: string[] = []
  const suppressedTerms: string[] = []
  for (const token of tokens) {
    const bare = token.startsWith('"') ? null : token.replace(TRAILING_PUNCTUATION, '')
    if (bare !== null && CONNECTOR_TERMS.has(bare)) suppressedTerms.push(bare)
    else kept.push(token)
  }
  if (suppressedTerms.length === 0 || kept.length === 0) return { query: normalized, suppressedTerms: [] }
  return { query: kept.join(' '), suppressedTerms }
}

export function buildQueryPlan(options: { originalQuery: string; mode: ContextCapsuleMode }): QueryPlan {
  const { originalQuery, mode } = options
  const normalizedQuery = normalizeQuery(originalQuery)
  const rawTerms = normalizeSearchQuery(originalQuery)

  // Structural categories (path/symbol/route) need original casing and
  // punctuation, which normalizeSearchQuery's lowercase+split-on-punctuation
  // tokenizer destroys - so these are derived from whitespace-only tokens
  // of the original query instead of from rawTerms.
  const whitespaceTokens = originalQuery
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(TRAILING_PUNCTUATION, ''))
    .filter(Boolean)

  const quotedPhrases = [...originalQuery.matchAll(/"([^"]+)"/g)].map((match) => match[1])
  // Route-like tokens (leading '/', no recognized file extension) are
  // classified before path-like so a token is never counted as both.
  const routeLike = whitespaceTokens.filter((token) => token.startsWith('/') && !PATH_LIKE_EXTENSION.test(token))
  const pathLike = whitespaceTokens.filter(
    (token) =>
      !routeLike.includes(token) &&
      (token.includes('/') || token.includes('\\') || PATH_LIKE_EXTENSION.test(token))
  )
  const symbolLike = whitespaceTokens.filter(
    (token) => SYMBOL_LIKE_PATTERN.test(token) || PASCAL_CASE_PATTERN.test(token) || token.includes('#')
  )
  const commandLike = rawTerms.filter((term) => KNOWN_COMMAND_NAMES.has(term))
  const artifactLike = rawTerms.filter((term) => KNOWN_ARTIFACT_NAMES.has(term))
  const classificationLike = rawTerms.filter((term) => KNOWN_CLASSIFICATION_ROLE_NAMES.has(term))

  const terms: QueryTerms = {
    raw: rawTerms,
    quotedPhrases,
    pathLike,
    symbolLike,
    routeLike,
    commandLike,
    artifactLike,
    classificationLike,
  }

  return {
    originalQuery,
    normalizedQuery,
    mode,
    searchQueries: [buildEffectiveSearchQuery(originalQuery).query],
    terms,
  }
}
