/** Shared, deterministic comparison helpers used across every graph-diff section. */

export function sortByString<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    const aKey = key(a)
    const bKey = key(b)
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0
  })
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Compares two flat records field-by-field (deep-equal per field) and
 * returns only the fields that differ, sorted by field name. Used for
 * manifest fields and semantic-artifact summary objects — always small,
 * always safe to include in full (never a huge raw dump).
 */
export function diffFlatRecord(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  fields: readonly string[]
): Array<{ field: string; before: unknown; after: unknown }> {
  const changed: Array<{ field: string; before: unknown; after: unknown }> = []
  for (const field of fields) {
    const beforeValue = before?.[field]
    const afterValue = after?.[field]
    if (!deepEqual(beforeValue, afterValue)) {
      changed.push({ field, before: beforeValue ?? null, after: afterValue ?? null })
    }
  }
  return changed.sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0))
}
