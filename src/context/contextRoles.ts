import { CONTEXT_ROLES, type ContextRole } from './types.js'

/**
 * v1.10.1 Batch 2: bounded internal role-definition registry.
 *
 * This is NOT a public plugin API and NOT the eventual v2.0 plugin
 * architecture: it is a fixed, in-repo lookup table of deterministic
 * numeric adjustments consumed only by `roleCandidates.ts`. Role
 * definitions never mutate global ranking configuration (`candidateRanking.ts`
 * mode-adjustment logic is untouched); they only supply bounded weights that
 * `roleCandidates.ts` adds on top of the existing base/mode score.
 *
 * `CONTEXT_ROLES` (declared in `types.ts`, Batch 1) is the single source of
 * truth for role order and membership; this module must not redeclare it.
 */
export interface RoleDefinition {
  role: ContextRole
  /** Boost for a candidate matching an exact stable-ID `focusSymbols` entry. */
  focusSymbolExactBoost: number
  /** Boost for a candidate contained in a resolved `focusFiles` entry. */
  focusFileBoost: number
  /** Boost for a candidate matching merged changed-surface symbol evidence. */
  changedSymbolBoost: number
  /** Boost for a candidate matching merged changed-surface file evidence. */
  changedFileBoost: number
  /** Boost for a candidate classified as owner-like (command handler, registry, adapter, analyzer, builder, artifact producer, shared type/public interface). */
  ownerLikeBoost: number
  /** Boost for a candidate classified as contract-like (validator, constant, error, schema). */
  contractLikeBoost: number
  /** Boost for a candidate directly graph-adjacent (one hop) to a resolved focus/seed symbol. */
  adjacentBoost: number
  /** Boost for a candidate whose matched terms include an exact query-name match. */
  exactQueryMatchBoost: number
  /** Boost for a candidate classified as a closest-test candidate (test file near a changed/focus production file). */
  closestTestBoost: number
  /** Evidence kinds this role's candidate generation naturally favors (documentation only; does not gate `requestedEvidenceKinds` handling). */
  preferredEvidenceKinds: string[]
  /** Deterministic warning template emitted when this role runs without any changed-surface input (test-implementation only). */
  missingChangedSurfaceWarning: string | null
}

const ARCHITECTURE: RoleDefinition = {
  role: 'architecture',
  focusSymbolExactBoost: 500,
  focusFileBoost: 150,
  changedSymbolBoost: 5,
  changedFileBoost: 2,
  ownerLikeBoost: 60,
  contractLikeBoost: 5,
  adjacentBoost: 25,
  exactQueryMatchBoost: 20,
  closestTestBoost: 0,
  preferredEvidenceKinds: ['owner', 'contracts', 'schemas'],
  missingChangedSurfaceWarning: null,
}

const IMPLEMENTATION: RoleDefinition = {
  role: 'implementation',
  focusSymbolExactBoost: 500,
  focusFileBoost: 150,
  changedSymbolBoost: 40,
  changedFileBoost: 15,
  ownerLikeBoost: 10,
  contractLikeBoost: 45,
  adjacentBoost: 35,
  exactQueryMatchBoost: 10,
  closestTestBoost: 5,
  preferredEvidenceKinds: ['dependencies', 'contracts', 'validators', 'constants', 'errors', 'schemas', 'callers', 'callees'],
  missingChangedSurfaceWarning: null,
}

const TEST_IMPLEMENTATION: RoleDefinition = {
  role: 'test-implementation',
  focusSymbolExactBoost: 500,
  focusFileBoost: 150,
  changedSymbolBoost: 300,
  changedFileBoost: 120,
  ownerLikeBoost: 5,
  contractLikeBoost: 10,
  adjacentBoost: 15,
  exactQueryMatchBoost: 10,
  closestTestBoost: 50,
  preferredEvidenceKinds: ['changed-surface', 'closest-tests', 'validators', 'errors'],
  missingChangedSurfaceWarning:
    'test-implementation role requested without changedFiles/changedSymbols/beforeIndex/afterIndex; post-implementation changed-surface focus is unavailable, falling back to query and explicit focus evidence only.',
}

/** Neutral (role === null) magnitudes: focus/changed-surface intake stays operational even
 * without a role, but role-specific heuristics (owner-like/contract-like/adjacent/exact-query/
 * closest-test) are role behavior and do not apply — this is the "legacy path" from section 10. */
const LEGACY: RoleDefinition = {
  role: 'implementation', // unused placeholder; LEGACY is never exposed via `role` field lookups
  focusSymbolExactBoost: 500,
  focusFileBoost: 150,
  changedSymbolBoost: 30,
  changedFileBoost: 10,
  ownerLikeBoost: 0,
  contractLikeBoost: 0,
  adjacentBoost: 0,
  exactQueryMatchBoost: 0,
  closestTestBoost: 0,
  preferredEvidenceKinds: [],
  missingChangedSurfaceWarning: null,
}

const ROLE_DEFINITIONS_BY_ROLE: ReadonlyMap<ContextRole, RoleDefinition> = new Map([
  ['architecture', ARCHITECTURE],
  ['implementation', IMPLEMENTATION],
  ['test-implementation', TEST_IMPLEMENTATION],
])

/** Stable role order, mirroring `CONTEXT_ROLES`. */
export const ROLE_DEFINITIONS: readonly RoleDefinition[] = CONTEXT_ROLES.map((role) => {
  const definition = ROLE_DEFINITIONS_BY_ROLE.get(role)
  if (!definition) throw new Error(`Missing role definition for role "${role}".`)
  return definition
})

/** Exact role lookup. Returns the legacy (role === null) definition for `null`/`undefined`. */
export function getRoleDefinition(role: ContextRole | null | undefined): RoleDefinition {
  if (!role) return LEGACY
  const definition = ROLE_DEFINITIONS_BY_ROLE.get(role)
  if (!definition) throw new Error(`Unknown context role "${role}".`)
  return definition
}

export function isLegacyRoleDefinition(definition: RoleDefinition): boolean {
  return definition === LEGACY
}
