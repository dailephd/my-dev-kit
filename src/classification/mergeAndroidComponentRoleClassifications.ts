import type { AndroidComponentDependencyFact, AndroidComponentEntry, AndroidComponentConfidence } from '../android/androidComponentTypes.js'
import { buildWarning, dedupeRisks, validateEntry } from './classificationHelpers.js'
import type { ClassificationEntry, ClassificationRole, EditGuidance, UncertaintyTier } from './classificationTypes.js'

export interface MergeAndroidComponentRoleClassificationsResult {
  entries: ClassificationEntry[]
  warningCount: number
}

const SAFE_EDIT_ROLES = new Set(['view-model', 'repository', 'use-case', 'room-entity', 'room-dao', 'retrofit-service'])

const TIER_RANK: Record<UncertaintyTier, number> = { certain: 3, likely: 2, possible: 1, unknown: 0 }

/**
 * v1.12.0 Batch 2: extends the same in-memory classification project by
 * merging existing `android-components.json` role facts (Activity, Fragment,
 * ViewModel, Repository, ...) into the matching already-built `symbol`-kind
 * classification entry - never a second component-role detector, never a
 * second entry for the same target. The vast majority of Android symbols
 * arrive here unresolved (no TypeScript data-model/frontend evidence applies
 * to Kotlin/Java), so the Android role typically becomes the entry's sole
 * classification; when the entry already carries real evidence, the Android
 * role is added alongside it and the stronger confidence tier wins.
 */
export function mergeAndroidComponentRoleClassifications(
  entries: readonly ClassificationEntry[],
  components: readonly AndroidComponentEntry[],
  dependencyFacts: readonly AndroidComponentDependencyFact[] = []
): MergeAndroidComponentRoleClassificationsResult {
  const componentBySymbolId = new Map(components.map((c) => [c.symbolId, c]))
  let merged = entries.map((entry) => {
    if (entry.targetKind !== 'symbol') return entry
    const component = componentBySymbolId.get(entry.targetId)
    if (!component) return entry
    return mergeComponentIntoEntry(entry, component)
  })

  // v1.12.0 Batch 3: advisory wrong-layer-risk only - never changes edit
  // guidance, readiness, or uncertainty - for a source component whose
  // statically visible supported dependency is ambiguous, unresolved, or
  // whose resolved source/target role confidence is low. A ViewModel/
  // Repository/DAO/Database legitimately not using a given layer never
  // triggers this; it only fires when a supported declaration exists.
  if (dependencyFacts.length > 0) {
    const componentById = new Map(components.map((c) => [c.id, c]))
    const riskySymbolIds = computeWrongLayerRiskSymbolIds(dependencyFacts, componentById)
    merged = merged.map((entry) => {
      if (!riskySymbolIds.has(entry.targetId) || entry.risks.includes('wrong-layer-risk')) return entry
      const updated = { ...entry, risks: dedupeRisks([...entry.risks, 'wrong-layer-risk' as const]) }
      validateEntry(updated)
      return updated
    })
  }

  const warningCount = merged.reduce((sum, entry) => sum + entry.warnings.length, 0)
  return { entries: merged, warningCount }
}

function computeWrongLayerRiskSymbolIds(
  facts: readonly AndroidComponentDependencyFact[],
  componentById: Map<string, AndroidComponentEntry>
): Set<string> {
  const result = new Set<string>()
  for (const fact of facts) {
    if (fact.matchStatus !== 'resolved') {
      result.add(fact.sourceSymbolId)
      continue
    }
    const sourceComponent = componentById.get(fact.sourceComponentId)
    if (sourceComponent?.confidence === 'low') {
      result.add(fact.sourceSymbolId)
      continue
    }
    if (fact.candidateComponentIds.some((id) => componentById.get(id)?.confidence === 'low')) {
      result.add(fact.sourceSymbolId)
    }
  }
  return result
}

function mergeComponentIntoEntry(entry: ClassificationEntry, component: AndroidComponentEntry): ClassificationEntry {
  const tier = mapComponentConfidenceToTier(component.confidence)
  const androidRole: ClassificationRole = { role: component.role, subtype: null, confidence: tier }
  const wasUnresolved = entry.classifications.length === 0
  const roles = dedupeRoles(wasUnresolved ? [androidRole] : [...entry.classifications, androidRole])
  const ref = {
    artifact: 'android-components.json',
    artifactKind: 'my-dev-kit-v1-android-components',
    id: component.id,
    path: 'android-components.json',
  }
  const evidence = [
    ...entry.evidence,
    {
      kind: 'artifact-cross-reference' as const,
      source: 'android-components.json',
      artifactSource: ref,
      reason: `Android component role '${component.role}' detected at ${component.confidence} confidence from static android-components.json evidence`,
    },
  ]
  const artifactRefs = entry.artifactRefs.some((r) => r.id === ref.id) ? entry.artifactRefs : [...entry.artifactRefs, ref]

  let editGuidance: EditGuidance
  let readiness: ClassificationEntry['readiness']
  let uncertainty: UncertaintyTier
  const risks = [...entry.risks]
  const warnings = wasUnresolved ? [] : [...entry.warnings]

  if (component.confidence === 'low') {
    editGuidance = 'uncertain'
    readiness = 'risky-assumption'
    uncertainty = 'possible'
    risks.push('wrong-layer-risk')
    warnings.push(
      buildWarning(
        'ambiguous-evidence',
        `'${component.role}' classification is only possible - based on low-confidence naming evidence only, never upgraded solely because it is the only candidate`
      )
    )
  } else {
    uncertainty = wasUnresolved ? tier : strongerTier(entry.uncertainty, tier)
    editGuidance = wasUnresolved || TIER_RANK[tier] >= TIER_RANK[entry.uncertainty] ? guidanceForComponentRole(component.role) : entry.editGuidance
    readiness = deriveReadinessFromTier(uncertainty)
  }

  const merged: ClassificationEntry = {
    ...entry,
    classifications: roles,
    editGuidance,
    readiness,
    uncertainty,
    risks: dedupeRisks(risks),
    warnings,
    evidence,
    artifactRefs,
    reason: wasUnresolved ? `Android component role '${component.role}' detected from static android-components.json evidence.` : entry.reason,
  }
  validateEntry(merged)
  return merged
}

function dedupeRoles(roles: ClassificationRole[]): ClassificationRole[] {
  const seen = new Set<string>()
  const result: ClassificationRole[] = []
  for (const role of roles) {
    if (seen.has(role.role)) continue
    seen.add(role.role)
    result.push(role)
  }
  return result
}

function mapComponentConfidenceToTier(confidence: AndroidComponentConfidence): UncertaintyTier {
  if (confidence === 'high') return 'certain'
  if (confidence === 'medium') return 'likely'
  return 'possible'
}

function strongerTier(a: UncertaintyTier, b: UncertaintyTier): UncertaintyTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b
}

function guidanceForComponentRole(role: string): EditGuidance {
  return SAFE_EDIT_ROLES.has(role) ? 'safe-primary-edit-target' : 'inspect-before-edit'
}

function deriveReadinessFromTier(uncertainty: UncertaintyTier): ClassificationEntry['readiness'] {
  if (uncertainty === 'possible' || uncertainty === 'unknown') return 'needs-more-context'
  return 'ready'
}
