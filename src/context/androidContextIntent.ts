/**
 * v1.12.0 Batch 6: bounded, deterministic internal Android task-intent model.
 *
 * Not a public option, not a `ContextRequest` field, not a context role: this
 * is an internal classifier consumed only by `androidContextOwnerPolicy.ts`
 * and the ranking/owner-eligibility integration points in `roleCandidates.ts`
 * and `evidenceGroups.ts`. Matching reuses the existing query normalization
 * (`queryPlan.ts`'s `normalizedQuery`/`terms.raw`) - no embeddings, no fuzzy
 * matching, no stemming beyond what the normalizer already does, no external
 * library, no LLM.
 *
 * A query may match more than one intent; there is no forced single winner.
 */

export type AndroidIntent =
  | 'ui'
  | 'state'
  | 'data'
  | 'persistence-schema'
  | 'persistence-access'
  | 'network-contract'
  | 'navigation'
  | 'manifest-platform'
  | 'resource'
  | 'test'

export const ANDROID_INTENTS: readonly AndroidIntent[] = [
  'ui',
  'state',
  'data',
  'persistence-schema',
  'persistence-access',
  'network-contract',
  'navigation',
  'manifest-platform',
  'resource',
  'test',
]

/**
 * Fixed term/phrase allowlist per intent (section 10.2). Single-word entries
 * are matched against normalized whole terms; multi-word entries are matched
 * as a fixed normalized phrase against the normalized query string. Deliberately
 * excludes the generic word "service" from `network-contract` (an Android
 * platform service and a Retrofit service are distinct - TST-603) and excludes
 * bare "layout" from `resource` in favor of the fuller fixed phrases below.
 */
const INTENT_TERMS: Record<AndroidIntent, readonly string[]> = {
  ui: ['ui', 'screen', 'composable', 'compose', 'button', 'visible text', 'render', 'rendering', 'user interface'],
  state: ['state', 'ui state', 'viewmodel', 'view model', 'loading state', 'error state', 'event state'],
  data: ['repository', 'data', 'use case', 'business logic', 'data owner'],
  'persistence-schema': ['entity', 'room entity', 'schema', 'database schema', 'table', 'column', 'field migration'],
  'persistence-access': ['dao', 'room dao', 'database access', 'persistence', 'room database', 'database query'],
  'network-contract': ['retrofit', 'api', 'endpoint', 'network', 'network service', 'remote service'],
  navigation: ['route', 'navigation', 'destination', 'deep link', 'deeplink', 'navigate'],
  'manifest-platform': [
    'manifest',
    'permission',
    'exported',
    'intent filter',
    'provider',
    'activity declaration',
    'service declaration',
    'receiver declaration',
    'component declaration',
  ],
  resource: [
    'resource',
    'string resource',
    'layout resource',
    'xml layout',
    'theme',
    'drawable',
    'color resource',
    'resource definition',
  ],
  test: [
    'test',
    'unit test',
    'instrumented test',
    'androidtest',
    'compose ui test',
    'espresso',
    'robolectric',
    'test failure',
  ],
}

function normalizePhrase(term: string): string {
  return term.trim().toLowerCase()
}

const INTENT_MATCHERS: Record<AndroidIntent, { words: ReadonlySet<string>; phrases: readonly string[] }> = Object.fromEntries(
  ANDROID_INTENTS.map((intent) => {
    const terms = INTENT_TERMS[intent].map(normalizePhrase)
    const words = new Set(terms.filter((t) => !t.includes(' ')))
    const phrases = terms.filter((t) => t.includes(' '))
    return [intent, { words, phrases }]
  })
) as unknown as Record<AndroidIntent, { words: ReadonlySet<string>; phrases: readonly string[] }>

/**
 * Detects every Android intent a normalized query matches. `normalizedQuery`
 * is the whitespace-normalized lowercase query string (as produced by
 * `queryPlan.ts`'s `normalizedQuery`); `terms` is its tokenized word list
 * (`queryPlan.ts`'s `terms.raw`). A single-word intent term matches only a
 * whole normalized token (never a substring of an unrelated word); a
 * multi-word intent phrase matches as a fixed substring of the normalized
 * query (word-boundary-safe because every phrase is itself multiple words).
 */
export function detectAndroidIntents(normalizedQuery: string, terms: readonly string[]): ReadonlySet<AndroidIntent> {
  const tokenSet = new Set(terms.map((t) => t.toLowerCase()))
  const normalized = normalizedQuery.toLowerCase()
  const intents = new Set<AndroidIntent>()
  for (const intent of ANDROID_INTENTS) {
    const matcher = INTENT_MATCHERS[intent]
    const wordMatch = [...matcher.words].some((word) => tokenSet.has(word))
    const phraseMatch = !wordMatch && matcher.phrases.some((phrase) => normalized.includes(phrase))
    if (wordMatch || phraseMatch) intents.add(intent)
  }
  return intents
}

export function isAndroidIntent(value: string): value is AndroidIntent {
  return (ANDROID_INTENTS as readonly string[]).includes(value)
}
