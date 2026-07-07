import type { SemanticArtifactRef } from '../semantics/index.js'
import {
  ANDROID_COMPONENTS_ARTIFACT_KIND,
  type AndroidComponentEntry,
  type AndroidComponentRoleRef,
  type CompactAndroidComponentMetadata,
} from './androidComponentTypes.js'

/**
 * Builds a map-by-symbolId of compact Android component-role metadata.
 * Mirrors buildClassificationRefsBySymbolId exactly: a symbol with zero
 * detected roles is simply absent from the map, so the compact fields stay
 * absent on that symbol rather than populated with an empty array.
 */
export function buildAndroidComponentRefsBySymbolId(
  entries: readonly AndroidComponentEntry[],
  androidComponentsArtifactPath: string
): ReadonlyMap<string, CompactAndroidComponentMetadata> {
  const bySymbolId = new Map<string, CompactAndroidComponentMetadata>()

  for (const entry of entries) {
    const existing = bySymbolId.get(entry.symbolId)
    const role: AndroidComponentRoleRef = { role: entry.role, confidence: entry.confidence }
    const ref: SemanticArtifactRef = {
      artifact: androidComponentsArtifactPath,
      artifactKind: ANDROID_COMPONENTS_ARTIFACT_KIND,
      id: entry.id,
      path: androidComponentsArtifactPath,
    }

    if (existing) {
      existing.androidComponentRoles.push(role)
      existing.androidComponentRefs.push(ref)
    } else {
      bySymbolId.set(entry.symbolId, { androidComponentRoles: [role], androidComponentRefs: [ref] })
    }
  }

  return bySymbolId
}
