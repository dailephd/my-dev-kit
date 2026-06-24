import * as fs from 'node:fs'
import * as path from 'node:path'
import type { FrontendReachabilityArtifact } from './types.js'

export const FRONTEND_REACHABILITY_FILENAME = 'frontend-reachability.json'

/** Returns a copy of the artifact with all arrays deterministically sorted. */
export function sortFrontendReachabilityArtifact(
  artifact: FrontendReachabilityArtifact
): FrontendReachabilityArtifact {
  return {
    ...artifact,
    routes: [...artifact.routes].sort((a, b) => a.path.localeCompare(b.path)),
    storageKeys: [...artifact.storageKeys].sort((a, b) =>
      `${a.storageKind}:${a.key}`.localeCompare(`${b.storageKind}:${b.key}`)
    ),
    uiReachability: [...artifact.uiReachability].sort((a, b) =>
      `${a.markerKind}:${a.value}`.localeCompare(`${b.markerKind}:${b.value}`)
    ),
    edges: [...artifact.edges].sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        a.source.localeCompare(b.source) ||
        a.target.localeCompare(b.target)
    ),
    warnings: [...artifact.warnings].sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        (a.factId ?? '').localeCompare(b.factId ?? '') ||
        a.message.localeCompare(b.message)
    ),
  }
}

/** Writes the artifact to disk (deterministically sorted) and returns the file path. */
export function writeFrontendReachabilityArtifact(
  outputDir: string,
  artifact: FrontendReachabilityArtifact
): string {
  const filePath = path.join(outputDir, FRONTEND_REACHABILITY_FILENAME)
  const sorted = sortFrontendReachabilityArtifact(artifact)
  fs.writeFileSync(filePath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8')
  return filePath
}
