/**
 * v1.12.0 Batch 6: centralized Android owner policy for the existing context
 * pipeline - intent/category preferences, production-owner eligibility,
 * usage-versus-owner rules, and conflict predicates (section 45's "narrowly
 * focused Android owner-policy module"). Consumed by `roleCandidates.ts`
 * (ranking), `evidenceGroups.ts` (owner eligibility), and
 * `conflictDetection.ts` (wrong-layer conflicts). Never a second ranking
 * engine, owner-selection engine, or graph traversal: this module only
 * classifies candidates the existing pipeline already ranked/selected, and
 * reuses Batch 5's `ANDROID_DATA_FLOW_EDGE_KIND_SET` for the one bounded
 * internal owner-support traversal it performs.
 */
import type { ClassificationRoleName, EditGuidance } from '../classification/classificationTypes.js'
import type { CodeGraph } from '../graph/codeGraphTypes.js'
import { ANDROID_DATA_FLOW_EDGE_KIND_SET } from '../android/androidDataFlowEdges.js'
import type { AndroidIntent } from './androidContextIntent.js'
import type { CandidateFile, CandidateNode } from './types.js'

export interface AndroidCategoryPreference {
  primary: readonly ClassificationRoleName[]
  supporting: readonly ClassificationRoleName[]
}

/** Fixed intent-to-owner-category preference matrix (section 11). Supplements,
 * never replaces, existing request relevance/structural eligibility/ranking. */
export const ANDROID_INTENT_CATEGORY_PREFERENCES: Record<AndroidIntent, AndroidCategoryPreference> = {
  ui: {
    primary: ['compose-screen', 'compose-ui-component', 'activity', 'fragment'],
    supporting: ['ui-event', 'ui-only-state', 'resource-file', 'xml-layout'],
  },
  state: {
    primary: ['view-model'],
    supporting: ['ui-only-state', 'compose-screen', 'compose-ui-component', 'ui-event'],
  },
  data: {
    primary: ['repository', 'use-case'],
    supporting: ['view-model', 'room-dao', 'retrofit-service'],
  },
  'persistence-schema': {
    primary: ['room-entity'],
    supporting: ['room-database', 'room-dao', 'repository'],
  },
  'persistence-access': {
    primary: ['room-dao', 'room-database'],
    supporting: ['repository', 'room-entity'],
  },
  'network-contract': {
    primary: ['retrofit-service'],
    supporting: ['repository'],
  },
  navigation: {
    primary: ['navigation-route'],
    supporting: ['compose-screen', 'android-manifest', 'manifest-component', 'activity'],
  },
  'manifest-platform': {
    primary: ['android-manifest', 'manifest-component'],
    supporting: ['activity', 'fragment', 'service', 'broadcast-receiver', 'content-provider', 'worker'],
  },
  resource: {
    primary: ['resource-file', 'xml-layout'],
    supporting: ['compose-screen', 'compose-ui-component', 'activity', 'fragment'],
  },
  test: {
    primary: ['compose-ui-test', 'instrumented-test', 'android-unit-test', 'test-block', 'test-fixture'],
    supporting: [],
  },
}

/** Guidance values that always exclude a candidate from production ownership
 * (section 13), regardless of intent match. `test-only` is excluded here too;
 * the explicit-test-intent/role exception is applied by the caller. */
const HARD_EXCLUDED_GUIDANCE: ReadonlySet<EditGuidance> = new Set([
  'generated-do-not-edit',
  'docs-only',
  'read-only-reference',
])

const TEST_ONLY_GUIDANCE: EditGuidance = 'test-only'

/** Grounded Android provenance (same rule as `search --android-role`, v1.12.0
 * Batch 5): an `android-*`-kind graph node, or a `symbol` node carrying real
 * `androidComponentRefs`. Path/filename is never consulted. This is what lets
 * a Kotlin ViewModel/Repository/DAO `symbol` node participate in Android
 * owner eligibility/ranking while a plain non-Android symbol whose
 * classification role happens to share a name (e.g. `repository`) never does. */
export function hasAndroidProvenance(candidate: {
  kind?: string
  androidArtifactId?: string
  androidComponentRefs?: readonly unknown[]
}): boolean {
  if (candidate.kind?.startsWith('android-')) return true
  if (candidate.androidArtifactId) return true
  if ((candidate.androidComponentRefs?.length ?? 0) > 0) return true
  return false
}

function classificationRoleNames(candidate: { classificationRoles?: readonly { role: string }[] }): ClassificationRoleName[] {
  return (candidate.classificationRoles ?? []).map((r) => r.role as ClassificationRoleName)
}

function classificationGuidances(candidate: { classificationRoles?: readonly { editGuidance: EditGuidance }[] }): EditGuidance[] {
  return (candidate.classificationRoles ?? []).map((r) => r.editGuidance)
}

/** Every Android category matched by at least one detected intent, split into
 * primary/supporting tiers (a category can be primary for one intent and
 * supporting for another; both tiers are checked independently). */
function matchedTier(roles: ClassificationRoleName[], intents: ReadonlySet<AndroidIntent>): 'primary' | 'supporting' | 'none' {
  let sawSupporting = false
  for (const intent of intents) {
    const preference = ANDROID_INTENT_CATEGORY_PREFERENCES[intent]
    if (roles.some((role) => preference.primary.includes(role))) return 'primary'
    if (roles.some((role) => preference.supporting.includes(role))) sawSupporting = true
  }
  return sawSupporting ? 'supporting' : 'none'
}

export interface AndroidCandidateLike {
  kind?: string
  androidArtifactId?: string
  androidComponentRefs?: readonly unknown[]
  classificationRoles?: readonly { role: string; editGuidance: EditGuidance }[]
}

/**
 * Production-owner eligibility override for Android candidates (sections
 * 13-15). Only ever *widens* eligibility for a candidate the generic
 * `evidenceGroups.ts` non-owner-classification list would otherwise exclude
 * purely because its Android role (`view-model`, `ui-only-state`, ...)
 * happens to share a name with a generic non-owner category; it never widens
 * eligibility for a candidate this module itself excludes (generated, docs,
 * read-only, or test-only without explicit test intent/role).
 */
/**
 * Production-owner eligibility only (section 13/31.4). A `test-only` node is
 * NEVER eligible here, under any intent or role - "no test-only production
 * owner" is an unconditional invariant, not one that explicit test intent can
 * waive. Explicit test work makes a test-only node a valid *test edit
 * location* instead (section 15.2), which is a distinct concept evaluated by
 * `isAndroidValidTestLocation` below, never by this function - conflating the
 * two previously let a test-only node leak into the production "owners"
 * evidence group under any query merely containing the word "test".
 */
export function androidOwnerEligible(
  candidate: AndroidCandidateLike,
  intents: ReadonlySet<AndroidIntent>,
  isTestImplementationRole: boolean
): boolean {
  if (!hasAndroidProvenance(candidate)) return false
  const roles = classificationRoleNames(candidate)
  if (roles.includes('generated-file')) return false
  const guidances = classificationGuidances(candidate)
  if (guidances.some((g) => HARD_EXCLUDED_GUIDANCE.has(g))) return false
  if (guidances.includes(TEST_ONLY_GUIDANCE)) return false
  const effectiveIntents = isTestImplementationRole && !intents.has('test') ? new Set([...intents, 'test' as const]) : intents
  return matchedTier(roles, effectiveIntents) !== 'none'
}

/** True only when a test-only candidate is a valid test EDIT LOCATION (section
 * 15.2/31.4) - explicit test intent or the `test-implementation` role, and
 * the candidate itself actually carries `test-only` guidance. Never implies
 * production-owner eligibility (see `androidOwnerEligible` above); callers
 * building test-location/related-test evidence (never the "owners" group)
 * may use this to admit a test-only node deliberately. */
export function isAndroidValidTestLocation(
  candidate: AndroidCandidateLike,
  intents: ReadonlySet<AndroidIntent>,
  isTestImplementationRole: boolean
): boolean {
  if (!isAndroidTestOnlyCandidate(candidate)) return false
  return intents.has('test') || isTestImplementationRole
}

/** True only for a candidate whose sole plausible role is a test-location
 * category (never a production owner - section 15/31.4). */
export function isAndroidTestOnlyCandidate(candidate: AndroidCandidateLike): boolean {
  if (!hasAndroidProvenance(candidate)) return false
  const guidances = classificationGuidances(candidate)
  return guidances.includes(TEST_ONLY_GUIDANCE) && guidances.every((g) => g === TEST_ONLY_GUIDANCE)
}

/** True only for a candidate classified `generated-file`/`generated-do-not-edit`
 * (section 14). Never silently dropped elsewhere - callers must still surface
 * it in dropped context/warnings/conflicts/provenance. */
export function isAndroidGeneratedCandidate(candidate: AndroidCandidateLike): boolean {
  if (!hasAndroidProvenance(candidate)) return false
  const roles = classificationRoleNames(candidate)
  const guidances = classificationGuidances(candidate)
  return roles.includes('generated-file') || guidances.includes('generated-do-not-edit')
}

/** Ranking boost for an Android intent-matching candidate (section 12, steps
 * 3-4). Returns 0 for a non-Android candidate or a candidate matching no
 * detected intent - the existing generic ranking is otherwise unaffected. */
export function androidIntentRankingBoost(candidate: AndroidCandidateLike, intents: ReadonlySet<AndroidIntent>): { boost: number; reason: string | null } {
  if (!hasAndroidProvenance(candidate) || intents.size === 0) return { boost: 0, reason: null }
  const roles = classificationRoleNames(candidate)
  const tier = matchedTier(roles, intents)
  // Deliberately large relative to typical base-search-score gaps (section 12:
  // intent-to-category match must outrank plain request-relevance score, not
  // merely nudge it) - mirrors the existing role-definition convention of
  // large fixed boosts (e.g. `focusSymbolExactBoost: 500` in contextRoles.ts).
  if (tier === 'primary') return { boost: 300, reason: 'android-intent-category-match: primary category for a detected Android task intent' }
  if (tier === 'supporting') return { boost: 60, reason: 'android-intent-category-match: supporting category for a detected Android task intent' }
  return { boost: 0, reason: null }
}

/** Fixed, bounded Android ownership/data-flow path length (section 17). */
export const MAX_ANDROID_OWNER_SUPPORT_PATH_LENGTH = 4

/**
 * One bounded internal owner-support traversal (section 17-18), reusing
 * Batch 5's fixed data-flow edge allowlist directly - never a second BFS, never
 * a reverse-edge fabrication (bidirectional traversal over existing edges
 * only). Returns node IDs reachable from `seedNodeIds` within
 * `MAX_ANDROID_OWNER_SUPPORT_PATH_LENGTH` hops along that allowlist, bounded
 * additionally by `maxNodes` (the caller's existing context graph cap).
 */
export function findAndroidOwnerSupportNodeIds(options: {
  codeGraph: CodeGraph
  seedNodeIds: ReadonlySet<string>
  maxNodes: number
}): Set<string> {
  const { codeGraph, seedNodeIds, maxNodes } = options
  const included = new Set(seedNodeIds)
  let frontier = new Set(seedNodeIds)
  for (let hop = 0; hop < MAX_ANDROID_OWNER_SUPPORT_PATH_LENGTH; hop++) {
    if (included.size >= maxNodes) break
    const next = new Set<string>()
    for (const current of frontier) {
      for (const edge of codeGraph.edges) {
        if (!ANDROID_DATA_FLOW_EDGE_KIND_SET.has(edge.kind)) continue
        let adjacent: string | null = null
        if (edge.source === current) adjacent = edge.target
        else if (edge.target === current) adjacent = edge.source
        if (adjacent === null || included.has(adjacent)) continue
        if (included.size >= maxNodes) break
        included.add(adjacent)
        next.add(adjacent)
      }
    }
    frontier = next
    if (frontier.size === 0) break
  }
  return included
}

/** Fixed usage -> owner edge kinds (section 18/26). `reverse: true` means the
 * owner is the edge source and the usage/projection is the edge target (e.g.
 * a composable "has" a fact). Single canonical owner for both
 * `conflictDetection.ts` (android-usage-selected-over-owner) and
 * `evidenceGroups.ts` (suppressing a usage node's owner eligibility when its
 * exact stronger owner is also present - section 16/31.5) - never a second
 * copy of this edge-kind list. */
export const USAGE_TO_OWNER_EDGE_KINDS: ReadonlyArray<{ kind: string; reverse: boolean }> = [
  { kind: 'compose-state-reads-viewmodel', reverse: false },
  { kind: 'source-references-resource', reverse: false },
  { kind: 'compose-navigation-targets-route', reverse: false },
  { kind: 'composable-has-fact', reverse: true },
]

export interface UsageOwnerPair {
  usageId: string
  ownerId: string
}

export function findUsageOwnerPairs(codeGraph: CodeGraph, candidateIds: ReadonlySet<string>): UsageOwnerPair[] {
  const pairs: UsageOwnerPair[] = []
  for (const edge of codeGraph.edges) {
    const rule = USAGE_TO_OWNER_EDGE_KINDS.find((r) => r.kind === edge.kind)
    if (!rule) continue
    if (!candidateIds.has(edge.source) || !candidateIds.has(edge.target)) continue
    pairs.push(rule.reverse ? { usageId: edge.target, ownerId: edge.source } : { usageId: edge.source, ownerId: edge.target })
  }
  return pairs
}

/**
 * Node IDs that are the "usage" side of a fixed usage -> owner relationship
 * (section 18/26) whose paired owner is also present among `candidateIds`
 * (section 16: "a usage/projection node never outranks its exact stronger
 * owner when one is connected through an existing graph edge" - section
 * 31.5). Used to suppress a usage node's production-owner eligibility, never
 * to remove it from ranking, dependency evidence, or conflict reporting.
 */
export function findAndroidUsageNodeIdsWithStrongerOwner(codeGraph: CodeGraph, candidateIds: ReadonlySet<string>): ReadonlySet<string> {
  const suppressed = new Set<string>()
  for (const pair of findUsageOwnerPairs(codeGraph, candidateIds)) {
    suppressed.add(pair.usageId)
  }
  return suppressed
}

export function candidateNodeToPolicyInput(node: CandidateNode): AndroidCandidateLike {
  return {
    kind: node.kind,
    androidArtifactId: node.androidArtifactId,
    androidComponentRefs: node.androidComponentRefs,
    classificationRoles: node.classificationRoles,
  }
}

export function candidateFileToPolicyInput(file: CandidateFile): AndroidCandidateLike {
  return { classificationRoles: file.classificationRoles }
}
