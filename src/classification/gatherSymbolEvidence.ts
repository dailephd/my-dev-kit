import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { DataModelArtifact } from '../data-model/types.js'
import type { FrontendSemanticArtifact } from '../frontend/frontendTypes.js'
import type { FrontendReachabilityArtifact } from '../frontend-reachability/index.js'
import type { SemanticRole } from '../semantics/index.js'
import type { SymbolDefinition } from '../symbol-index/types.js'

/** The v1.5 category names that already exist as SemanticRoleName/subtype values (BEH-020 reuse). */
const SHARED_CATEGORY_NAMES = new Set([
  'canonical-type',
  'database-model',
  'artifact-type',
  'projection-type',
  'view-model',
  'ui-only-state',
  'persistence-adapter',
  'route-handler',
  'client-component',
  'server-component',
  'test-fixture',
])

export interface FrontendReachabilityFactEvidence {
  factKind: 'route' | 'storage-key' | 'ui-reachability'
  inferredRole: 'route-handler' | 'client-component' | 'server-component' | 'ui-only-state'
  hasReachabilityGate: boolean
}

export interface SymbolEvidenceBundle {
  /**
   * Whichever of role/subtype on the symbol's existing SemanticRole carries a
   * v1.5-category-matching name. Only `role: 'data-entity'` is ever assigned
   * by any producer in this codebase today (grep-confirmed) - the practical
   * category signal lives in `subtype` (see contract-implementation-notes.txt
   * section 7). Checking both fields honors BEH-020 without depending on
   * which field a given producer happens to populate.
   */
  existingRole: SemanticRole | null
  matchedExistingCategory: string | null
  frontendReachabilityFact: FrontendReachabilityFactEvidence | null
}

export function gatherSymbolEvidence(
  filePath: string,
  symbol: SymbolDefinition,
  _codeGraph: CodeGraph,
  _dataModel: DataModelArtifact | null,
  _frontendSemantic: FrontendSemanticArtifact | null,
  frontendReachability: FrontendReachabilityArtifact | null
): SymbolEvidenceBundle {
  const existingRole = symbol.semanticRoles?.[0] ?? null
  const matchedExistingCategory = existingRole ? matchSharedCategory(existingRole) : null

  const symbolNodeId = `symbol:${filePath}#${symbol.name}`
  const frontendReachabilityFact = frontendReachability
    ? findReachabilityFact(frontendReachability, symbolNodeId)
    : null

  return { existingRole, matchedExistingCategory, frontendReachabilityFact }
}

function matchSharedCategory(role: SemanticRole): string | null {
  if (SHARED_CATEGORY_NAMES.has(role.role)) return role.role
  if (role.subtype && SHARED_CATEGORY_NAMES.has(role.subtype)) return role.subtype
  return null
}

function findReachabilityFact(
  artifact: FrontendReachabilityArtifact,
  symbolNodeId: string
): FrontendReachabilityFactEvidence | null {
  const uiFact = artifact.uiReachability.find((fact) => fact.componentId === symbolNodeId)
  if (uiFact) {
    return {
      factKind: 'ui-reachability',
      inferredRole: 'ui-only-state',
      hasReachabilityGate: uiFact.gateRouteIds.length > 0 || uiFact.gateStorageKeyIds.length > 0,
    }
  }
  return null
}
