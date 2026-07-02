import type { SymbolDefinition } from '../symbol-index/types.js'
import {
  buildWarning,
  createEvidence,
  deriveReadiness,
  editGuidanceForUnresolved,
  readinessForUnresolved,
  resolveCandidateConflicts,
  validateEntry,
  type CategoryCandidate,
} from './classificationHelpers.js'
import type { ClassificationEntry, EditGuidance, RiskLabel, UncertaintyTier } from './classificationTypes.js'
import type { SymbolEvidenceBundle } from './gatherSymbolEvidence.js'

export function classifySymbol(
  filePath: string,
  symbol: SymbolDefinition,
  evidence: SymbolEvidenceBundle
): ClassificationEntry {
  const targetId = `symbol:${filePath}#${symbol.name}`
  const candidates: CategoryCandidate[] = []

  if (evidence.existingRole && evidence.matchedExistingCategory) {
    candidates.push({
      role: evidence.matchedExistingCategory,
      confidence: mapSemanticConfidenceToUncertaintyTier(evidence.existingRole.confidence),
      evidence: [
        createEvidence({
          kind: 'existing-semantic-role',
          source: 'classification-symbol-analyzer',
          relatedRole: evidence.matchedExistingCategory,
          artifactSource: evidence.existingRole.artifactRefs?.[0] ?? null,
          reason: `existing semantic role/subtype '${evidence.matchedExistingCategory}' from ${evidence.existingRole.source}`,
        }),
      ],
    })
  }

  if (evidence.frontendReachabilityFact) {
    candidates.push({
      role: evidence.frontendReachabilityFact.inferredRole,
      confidence: evidence.frontendReachabilityFact.hasReachabilityGate ? 'likely' : 'possible',
      evidence: [
        createEvidence({
          kind: 'frontend-reachability-fact',
          source: 'classification-symbol-analyzer',
          relatedRole: evidence.frontendReachabilityFact.inferredRole,
          reason: `frontend-reachability ${evidence.frontendReachabilityFact.factKind} fact references this symbol`,
          uncertaintyReason: evidence.frontendReachabilityFact.hasReachabilityGate
            ? null
            : 'no route/storage gate links this component to a confirmed reachability path',
        }),
      ],
    })
  }

  if (candidates.length === 0) {
    return buildSymbolEntry(filePath, symbol, targetId, {
      roles: [],
      overallUncertainty: 'unknown',
      warningsToAdd: [
        buildWarning('no-static-evidence', 'no existing semantic role and no static evidence found'),
      ],
      evidence: [],
      editGuidance: editGuidanceForUnresolved(),
      readiness: readinessForUnresolved(),
      risks: [],
      reason: 'no existing semantic role and no static evidence found',
    })
  }

  const resolved = resolveCandidateConflicts(candidates)
  const editGuidance = deriveSymbolEditGuidance(resolved.roles.map((role) => role.role), resolved.overallUncertainty)
  const risks = deriveSymbolRisks(resolved.roles.map((role) => role.role), evidence)
  const readiness = deriveReadiness(
    resolved.overallUncertainty,
    resolved.warningsToAdd.some((warning) => warning.kind === 'conflicting-category')
  )

  return buildSymbolEntry(filePath, symbol, targetId, {
    roles: resolved.roles,
    overallUncertainty: resolved.overallUncertainty,
    warningsToAdd: resolved.warningsToAdd,
    evidence: resolved.evidence,
    editGuidance,
    readiness,
    risks,
    reason: `matched ${resolved.roles.length} static symbol-level signal(s): ${resolved.roles.map((r) => r.role).join(', ')}`,
  })
}

function mapSemanticConfidenceToUncertaintyTier(confidence: string): UncertaintyTier {
  if (confidence === 'explicit') return 'certain'
  if (confidence === 'inferred-static') return 'likely'
  if (confidence === 'partial') return 'possible'
  return 'unknown'
}

/** PSE-022: conservative default for categories not yet mapped is inspect-before-edit. */
function deriveSymbolEditGuidance(roles: readonly string[], overallUncertainty: UncertaintyTier): EditGuidance {
  if (overallUncertainty === 'unknown') return 'uncertain'
  if (roles.includes('database-model') || roles.includes('persistence-adapter')) {
    return overallUncertainty === 'certain' ? 'avoid-primary-edit-target' : 'inspect-before-edit'
  }
  if (roles.includes('view-model') || roles.includes('projection-type')) {
    return overallUncertainty === 'certain' || overallUncertainty === 'likely'
      ? 'safe-primary-edit-target'
      : 'inspect-before-edit'
  }
  return 'inspect-before-edit'
}

function deriveSymbolRisks(roles: readonly string[], evidence: SymbolEvidenceBundle): RiskLabel[] {
  const risks: RiskLabel[] = []
  if (roles.includes('database-model') || roles.includes('persistence-adapter')) {
    risks.push('wrong-layer-risk')
  }
  const isUiFlavoredRole =
    roles.includes('client-component') || roles.includes('server-component') || roles.includes('ui-only-state')
  if (isUiFlavoredRole && !(evidence.frontendReachabilityFact?.hasReachabilityGate ?? false)) {
    risks.push('requires-browser-validation')
  }
  if (roles.includes('route-handler') && evidence.frontendReachabilityFact && !evidence.frontendReachabilityFact.hasReachabilityGate) {
    risks.push('unreachable-ui-risk')
  }
  if ((roles.includes('canonical-type') || roles.includes('artifact-type') || roles.includes('route-handler'))) {
    risks.push('public-contract-risk')
  }
  return risks
}

function buildSymbolEntry(
  filePath: string,
  symbol: SymbolDefinition,
  targetId: string,
  parts: {
    roles: ClassificationEntry['classifications']
    overallUncertainty: UncertaintyTier
    warningsToAdd: ClassificationEntry['warnings']
    evidence: ClassificationEntry['evidence']
    editGuidance: EditGuidance
    readiness: ClassificationEntry['readiness']
    risks: RiskLabel[]
    reason: string
  }
): ClassificationEntry {
  const entry: ClassificationEntry = {
    id: `classification:symbol:${targetId}`,
    targetId,
    targetKind: 'symbol',
    filePath,
    symbolName: symbol.name,
    nodeId: targetId,
    classifications: parts.roles,
    editGuidance: parts.editGuidance,
    readiness: parts.readiness,
    risks: parts.risks,
    evidence: parts.evidence,
    uncertainty: parts.overallUncertainty,
    reason: parts.reason,
    sourceRefs: [{ filePath, symbolId: targetId, line: symbol.location.line }],
    artifactRefs: [],
    warnings: parts.warningsToAdd,
  }
  validateEntry(entry)
  return entry
}
