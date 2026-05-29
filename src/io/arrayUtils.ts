/**
 * Shared array utilities for generator scripts and source modules.
 *
 * All functions are pure: they never mutate their inputs and always return
 * new arrays.
 */

/**
 * Returns a deduplicated, sorted copy of a string array.
 * Uses locale-aware comparison for deterministic ordering.
 * Does not mutate the input.
 */
export function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
}
