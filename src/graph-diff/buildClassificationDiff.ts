import type { ClassificationArtifact, ClassificationEntry } from '../classification/classificationTypes.js'
import { deepEqual } from './diffUtils.js'
import type { ArtifactAvailability, ClassificationDiffSection } from './types.js'

const COMPARED_ENTRY_FIELDS = ['classifications', 'editGuidance', 'readiness', 'risks', 'uncertainty', 'reason'] as const

export function buildClassificationDiff(
  before: ClassificationArtifact | null,
  after: ClassificationArtifact | null
): ClassificationDiffSection {
  const available = artifactAvailability(before, after)

  if (available !== 'both') {
    return { available, added: [], removed: [], changed: [] }
  }

  const beforeById = new Map(before!.entries.map((entry) => [entry.id, entry]))
  const afterById = new Map(after!.entries.map((entry) => [entry.id, entry]))

  const added: string[] = []
  const changed: Array<{ id: string; changedFields: string[] }> = []
  for (const [id, afterEntry] of afterById) {
    const beforeEntry = beforeById.get(id)
    if (!beforeEntry) {
      added.push(id)
      continue
    }
    const changedFields = diffEntryFields(beforeEntry, afterEntry)
    if (changedFields.length > 0) changed.push({ id, changedFields })
  }

  const removed: string[] = []
  for (const id of beforeById.keys()) {
    if (!afterById.has(id)) removed.push(id)
  }

  return {
    available,
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  }
}

function diffEntryFields(before: ClassificationEntry, after: ClassificationEntry): string[] {
  const changed: string[] = []
  for (const field of COMPARED_ENTRY_FIELDS) {
    if (!deepEqual(before[field], after[field])) changed.push(field)
  }
  return changed.sort()
}

function artifactAvailability<T>(before: T | null, after: T | null): ArtifactAvailability {
  if (before && after) return 'both'
  if (before && !after) return 'before-only'
  if (!before && after) return 'after-only'
  return 'neither'
}
