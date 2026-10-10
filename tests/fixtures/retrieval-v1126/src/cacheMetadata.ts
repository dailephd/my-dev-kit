export interface CacheEntry {
  path: string
  contentHash: string
}

/** Cache metadata helper used when deciding which entries are stale during a refresh. */
export function findStaleCacheEntries(entries: CacheEntry[], currentHashes: Record<string, string>): string[] {
  return entries.filter((entry) => currentHashes[entry.path] !== entry.contentHash).map((entry) => entry.path)
}
