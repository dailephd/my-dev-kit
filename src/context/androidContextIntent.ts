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
  ui: ['ui', 'screen', 'composable', 'compose', 'button', 'layout', 'presentation', 'visible text', 'render', 'rendering', 'user interface'],
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
 * Clause scoping (v1.13.0 post-Batch-5 D2). A request names the component it
 * changes, but may also name components it must NOT change (`without
 * changing the ViewModel`) or merely depends on (`from the DAO and Retrofit
 * service`). Terms inside such a clause describe constraints or dependencies,
 * not the task, so they are removed from intent detection only: they stay in
 * the lexical query, candidate lists, graph neighborhoods and dependency
 * evidence. Fixed marker lists, a fixed clause terminator set and a fixed
 * maximum clause length keep this deterministic and bounded.
 */
const EXCLUSION_MARKERS: readonly (readonly string[])[] = [
  ['without'],
  ['except'],
  ['excluding'],
  ['preserving'],
  ['preserve'],
  ['do', 'not'],
  ["don't"],
  ['dont'],
  ['must', 'not'],
  ['should', 'not'],
  ['not', 'changing'],
  ['not', 'modifying'],
  ['not', 'touching'],
  ['but', 'not'],
]
const DEPENDENCY_MARKERS: readonly (readonly string[])[] = [['from'], ['using'], ['via'], ['through'], ['calling']]
const CLAUSE_TERMINATORS: ReadonlySet<string> = new Set([',', ';', '.', ':', '!', '?', '(', ')', 'but', 'then', 'instead', 'so', 'while'])
const MAX_CLAUSE_TOKENS = 8

/**
 * A CamelCase identifier that ends in a conventional Android component suffix
 * (for example `<Name>Repository`) states which layer the task is about even
 * though the whole identifier is a single token. It is only a fallback: it is
 * consulted when no explicit intent term matched, so a named screen that merely
 * locates a state task never adds a UI intent. The suffix must follow at
 * least one other character, so the bare words are handled by INTENT_TERMS and
 * a name that merely contains a suffix mid-word never matches. Generic
 * `Service` is deliberately absent (platform service versus Retrofit service).
 */
const IDENTIFIER_SUFFIX_INTENTS: ReadonlyArray<{ pattern: RegExp; intent: AndroidIntent }> = [
  { pattern: /[a-z0-9]Screen$/, intent: 'ui' },
  { pattern: /[a-z0-9]ViewModel$/, intent: 'state' },
  { pattern: /[a-z0-9]Repository$/, intent: 'data' },
  { pattern: /[a-z0-9]Dao$/, intent: 'persistence-access' },
  { pattern: /[a-z0-9]Entity$/, intent: 'persistence-schema' },
]

export interface AndroidTaskClauses {
  /** Lowercase tokens that describe the task itself. */
  active: readonly string[]
  /** The same task tokens with their original casing (for identifier-shape checks). */
  activeIdentifiers: readonly string[]
  /** Tokens inside an exclusion clause (`without changing X`). */
  excluded: readonly string[]
  /** Tokens inside a dependency clause (`from X`, `using X`). */
  dependency: readonly string[]
}

function matchMarker(words: readonly string[], index: number, markers: readonly (readonly string[])[]): number {
  let best = 0
  for (const marker of markers) {
    if (marker.length > best && marker.every((part, offset) => words[index + offset] === part)) best = marker.length
  }
  return best
}

/** Splits a normalized query into task, exclusion and dependency tokens. */
export function splitAndroidTaskClauses(normalizedQuery: string): AndroidTaskClauses {
  const originalWords = normalizedQuery
    .replace(/[,;.:!?()]/g, (m) => ` ${m} `)
    .split(/[\s\-/\\[\]{}<>"`|@#$%^&*+=~]+/u)
    .filter((w) => w.length > 0)
  const words = originalWords.map((w) => w.toLowerCase())
  const active: string[] = []
  const activeIdentifiers: string[] = []
  const excluded: string[] = []
  const dependency: string[] = []
  let i = 0
  while (i < words.length) {
    const exclusion = matchMarker(words, i, EXCLUSION_MARKERS)
    const dependencyMarker = exclusion > 0 ? 0 : matchMarker(words, i, DEPENDENCY_MARKERS)
    const markerLength = exclusion || dependencyMarker
    if (markerLength === 0) {
      if (!CLAUSE_TERMINATORS.has(words[i] as string)) {
        active.push(words[i] as string)
        activeIdentifiers.push(originalWords[i] as string)
      }
      i += 1
      continue
    }
    const target = exclusion > 0 ? excluded : dependency
    i += markerLength
    let consumed = 0
    while (i < words.length && consumed < MAX_CLAUSE_TOKENS) {
      const word = words[i] as string
      if (CLAUSE_TERMINATORS.has(word)) break
      if (matchMarker(words, i, EXCLUSION_MARKERS) > 0 || matchMarker(words, i, DEPENDENCY_MARKERS) > 0) break
      target.push(word)
      i += 1
      consumed += 1
    }
  }
  return { active, activeIdentifiers, excluded, dependency }
}

/**
 * Detects every Android intent the task part of a query matches. `normalizedQuery`
 * is the whitespace-normalized query string (as produced by `queryPlan.ts`'s
 * `normalizedQuery`); `terms` is its tokenized word list (`queryPlan.ts`'s
 * `terms.raw`). A single-word intent term matches only a whole normalized token
 * (never a substring of an unrelated word); a multi-word intent phrase matches as
 * a fixed substring of the normalized task text. Terms inside exclusion or
 * dependency clauses (see `splitAndroidTaskClauses`) do not contribute intents.
 * `layout` counts as a UI term unless it is part of the `xml layout` /
 * `layout resource` resource phrases. When no intent term matched, a CamelCase
 * identifier ending in a conventional layer suffix (`Screen`, `ViewModel`, `Repository`,
 * `Dao`, `Entity`) that is part of the task contributes that layer's intent.
 */
export function detectAndroidIntents(normalizedQuery: string, terms: readonly string[]): ReadonlySet<AndroidIntent> {
  const clauses = splitAndroidTaskClauses(normalizedQuery)
  const hasScopedClauses = clauses.excluded.length > 0 || clauses.dependency.length > 0
  const activeWords = hasScopedClauses ? clauses.active : terms.map((t) => t.toLowerCase())
  const tokenSet = new Set(activeWords)
  const normalized = hasScopedClauses ? clauses.active.join(' ') : normalizedQuery.toLowerCase()
  const bareLayout = activeWords.some((word, index) => word === 'layout' && activeWords[index - 1] !== 'xml' && activeWords[index + 1] !== 'resource')
  const intents = new Set<AndroidIntent>()
  for (const intent of ANDROID_INTENTS) {
    const matcher = INTENT_MATCHERS[intent]
    const wordMatch = [...matcher.words].some((word) => (word === 'layout' ? bareLayout : tokenSet.has(word)))
    const phraseMatch = !wordMatch && matcher.phrases.some((phrase) => normalized.includes(phrase))
    if (wordMatch || phraseMatch) intents.add(intent)
  }
  if (intents.size === 0) {
    for (const identifier of clauses.activeIdentifiers) {
      for (const rule of IDENTIFIER_SUFFIX_INTENTS) if (rule.pattern.test(identifier)) intents.add(rule.intent)
    }
  }
  return intents
}

export function isAndroidIntent(value: string): value is AndroidIntent {
  return (ANDROID_INTENTS as readonly string[]).includes(value)
}
