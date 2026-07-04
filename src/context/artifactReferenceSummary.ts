import { toForwardSlash } from '../io/pathUtils.js'
import type { ResolvedIndexManifest } from '../indexing/readIndexManifest.js'
import { resolveClassificationArtifactPath } from '../classification/resolveClassificationForCommands.js'
import type { ArtifactReferenceSummaryEntry } from './types.js'

const REASONS: Record<string, string> = {
  symbolIndex: 'Core symbol index, always available in a valid index.',
  codeGraph: 'Core code graph, always available in a valid index.',
  callGraph: 'Call-graph edges, available when the index was built with call-graph analysis.',
  dataModel: 'Data-model entities and fields, relevant when the query concerns data models.',
  dataModelGraph: 'Data-model graph, relevant when the query concerns data-model relationships.',
  modelViewLineage: 'Static model-to-view lineage, relevant when the query concerns data-to-view usage.',
  frontendSemantic: 'Frontend semantic facts, relevant when the query concerns React/TSX components.',
  frontendReachability: 'Frontend reachability facts (routes/storage/UI), relevant when the query concerns frontend flows.',
  classification: 'Static layer/role classification, relevant for edit-guidance and risk evidence.',
}

export function buildArtifactReferenceSummary(resolved: ResolvedIndexManifest): ArtifactReferenceSummaryEntry[] {
  const entries: ArtifactReferenceSummaryEntry[] = []
  const seen = new Set<string>()

  const addEntry = (name: string, path: string | null): void => {
    if (seen.has(name)) return
    seen.add(name)
    entries.push({
      artifactKind: name,
      artifactPath: path ? toForwardSlash(path) : null,
      available: path !== null,
      reason: REASONS[name] ?? `Artifact "${name}" registered in the index manifest.`,
      warnings: path === null ? [`Artifact reference missing: ${name} is not registered in this index.`] : [],
    })
  }

  addEntry('symbolIndex', resolved.artifactPaths.symbolIndex)
  addEntry('codeGraph', resolved.artifactPaths.codeGraph)
  addEntry('callGraph', resolved.artifactPaths.callGraph)
  for (const [name, path] of Object.entries(resolved.semanticArtifactPaths)) {
    addEntry(name, path ?? null)
  }
  addEntry('classification', resolveClassificationArtifactPath(resolved.manifest, resolved.indexDir))

  return entries
}
