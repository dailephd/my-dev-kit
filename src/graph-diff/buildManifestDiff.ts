import type { IndexManifest } from '../indexing/manifestTypes.js'
import { deepEqual, diffFlatRecord } from './diffUtils.js'
import type { AnalyzerStatusChange, ManifestDiffSection } from './types.js'

/**
 * Fields compared for behavior-relevant manifest drift. Deliberately
 * excludes `createdAt` (a timestamp, never logical) and the artifact-body
 * fields that the code-graph/symbol-index diffs already cover in detail.
 */
const COMPARED_MANIFEST_FIELDS = [
  'projectRoot',
  'sourceRoots',
  'languages',
  'callGraphEnabled',
  'artifacts',
  'semanticArtifacts',
  'summary',
  'indexMode',
  'cacheMode',
  'cacheInvalidationReason',
  'changedFileSummary',
  'partialRebuildFallbackArtifacts',
  'warnings',
  'errors',
] as const

export function buildManifestDiff(before: IndexManifest, after: IndexManifest): ManifestDiffSection {
  const schemaVersionMatch = before.version === after.version

  const changedFields = diffFlatRecord(
    before as unknown as Record<string, unknown>,
    after as unknown as Record<string, unknown>,
    COMPARED_MANIFEST_FIELDS
  )

  const analyzerChanges = buildAnalyzerChanges(before, after)

  return { schemaVersionMatch, changedFields, analyzerChanges }
}

function buildAnalyzerChanges(before: IndexManifest, after: IndexManifest): AnalyzerStatusChange[] {
  const beforeById = new Map((before.analyzers ?? []).map((analyzer) => [analyzer.id, analyzer]))
  const afterById = new Map((after.analyzers ?? []).map((analyzer) => [analyzer.id, analyzer]))
  const ids = new Set([...beforeById.keys(), ...afterById.keys()])

  const changes: AnalyzerStatusChange[] = []
  for (const id of ids) {
    const beforeAnalyzer = beforeById.get(id)
    const afterAnalyzer = afterById.get(id)
    const beforeStatus = beforeAnalyzer?.status ?? null
    const afterStatus = afterAnalyzer?.status ?? null
    if (!deepEqual(beforeStatus, afterStatus)) {
      changes.push({ id, before: beforeStatus, after: afterStatus })
    }
  }
  return changes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
