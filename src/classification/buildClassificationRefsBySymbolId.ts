import type { SemanticArtifactRef } from '../semantics/index.js'
import { CLASSIFICATION_ARTIFACT_KIND, type ClassificationEntry, type ClassificationRoleRef } from './classificationTypes.js'

export interface CompactClassificationMetadata {
  classificationRoles: ClassificationRoleRef[]
  classificationRefs: SemanticArtifactRef[]
}

/**
 * Builds a map-by-id of compact classification metadata for 'symbol'-kind
 * classification entries only, mirroring buildSemanticRolesFromDataModel's
 * map-by-symbolId shape. Entries with zero classifications (unresolved, e.g.
 * uncertainty='unknown') are intentionally excluded so the compact fields
 * stay absent rather than populated with an empty array - matching how
 * semanticRoles/artifactRefs absence is already handled (INV-004).
 */
export function buildClassificationRefsBySymbolId(
  entries: readonly ClassificationEntry[],
  classificationArtifactPath: string
): ReadonlyMap<string, CompactClassificationMetadata> {
  const bySymbolId = new Map<string, CompactClassificationMetadata>()

  for (const entry of entries) {
    if (entry.targetKind !== 'symbol') continue
    if (entry.classifications.length === 0) continue

    const classificationRoles: ClassificationRoleRef[] = entry.classifications.map((role) => ({
      role: role.role,
      editGuidance: entry.editGuidance,
      readiness: entry.readiness,
      uncertainty: entry.uncertainty,
    }))
    const classificationRefs: SemanticArtifactRef[] = [
      {
        artifact: classificationArtifactPath,
        artifactKind: CLASSIFICATION_ARTIFACT_KIND,
        id: entry.id,
        path: classificationArtifactPath,
      },
    ]

    bySymbolId.set(entry.targetId, { classificationRoles, classificationRefs })
  }

  return bySymbolId
}
