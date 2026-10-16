export interface NeighborhoodEdge {
  from: string
  to: string
}

/**
 * Production owner of incremental affected-neighborhood refresh: given the changed
 * files and the dependency edges, returns every file that must be refreshed.
 */
export function selectAffectedNeighborhood(changedFiles: string[], edges: NeighborhoodEdge[]): string[] {
  const affected = new Set<string>(changedFiles)
  for (const edge of edges) {
    if (affected.has(edge.to)) affected.add(edge.from)
  }
  return [...affected].sort()
}
