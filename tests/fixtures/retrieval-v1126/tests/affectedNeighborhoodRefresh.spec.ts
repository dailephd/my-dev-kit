import { selectAffectedNeighborhood } from '../src/affectedNeighborhood.js'
import { findStaleCacheEntries } from '../src/cacheMetadata.js'

describe('incremental affected-neighborhood refresh', () => {
  it('refreshes the changed file and its dependents', () => {
    const affected = selectAffectedNeighborhood(['a.ts'], [{ from: 'b.ts', to: 'a.ts' }])
    expect(affected).toEqual(['a.ts', 'b.ts'])
  })

  it('reports stale cache metadata for a changed hash', () => {
    expect(findStaleCacheEntries([{ path: 'a.ts', contentHash: 'old' }], { 'a.ts': 'new' })).toEqual(['a.ts'])
  })
})
