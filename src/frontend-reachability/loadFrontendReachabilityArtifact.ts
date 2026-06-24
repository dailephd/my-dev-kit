import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  FRONTEND_REACHABILITY_ARTIFACT_KIND,
  type FrontendReachabilityArtifact,
} from './types.js'
import { FRONTEND_REACHABILITY_FILENAME } from './writeFrontendReachabilityArtifact.js'

/**
 * Reads and validates the frontend-reachability artifact from an index directory.
 *
 * - Returns null if the file is not found (graceful: run index first).
 * - Throws a clear error if the file is malformed (wrong kind or missing fields).
 */
export function loadFrontendReachabilityArtifact(indexDir: string): FrontendReachabilityArtifact | null {
  const filePath = path.join(indexDir, FRONTEND_REACHABILITY_FILENAME)
  if (!fs.existsSync(filePath)) return null

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`frontend-reachability.json is malformed: invalid JSON in ${filePath}: ${error.message}`)
    }
    throw error
  }

  return validateArtifact(raw, filePath)
}

function validateArtifact(raw: unknown, filePath: string): FrontendReachabilityArtifact {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`frontend-reachability.json is malformed: expected an object (${filePath})`)
  }
  const candidate = raw as Partial<FrontendReachabilityArtifact>
  if (candidate.artifactKind !== FRONTEND_REACHABILITY_ARTIFACT_KIND) {
    throw new Error(
      `frontend-reachability.json is malformed: unexpected artifactKind "${String(
        candidate.artifactKind
      )}" (${filePath})`
    )
  }
  if (!candidate.schemaVersion) {
    throw new Error(`frontend-reachability.json is malformed: missing schemaVersion (${filePath})`)
  }
  if (
    !Array.isArray(candidate.routes) ||
    !Array.isArray(candidate.storageKeys) ||
    !Array.isArray(candidate.uiReachability) ||
    !Array.isArray(candidate.edges) ||
    !Array.isArray(candidate.warnings)
  ) {
    throw new Error(
      `frontend-reachability.json is malformed: missing or invalid required top-level array fields (${filePath})`
    )
  }
  if (!candidate.stats || typeof candidate.stats !== 'object') {
    throw new Error(`frontend-reachability.json is malformed: missing stats (${filePath})`)
  }
  return candidate as FrontendReachabilityArtifact
}
