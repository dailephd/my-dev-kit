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
    searchQueries: [normalizedQuery],
    terms,
  }
}
