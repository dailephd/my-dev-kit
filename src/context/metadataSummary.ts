import type { SemanticArtifactRef, SemanticEvidenceRef, SemanticRole } from '../semantics/index.js'
import type { CandidateFile, CandidateNode, ContextFocus, SelectedGraph, SemanticSummary, SemanticSummaryEntry } from './types.js'

interface SemanticSource {
  key: string
  semanticRoles?: SemanticRole[]
  artifactRefs?: SemanticArtifactRef[]
}

export function buildSemanticSummary(options: {
  focus: ContextFocus
  selectedGraph: SelectedGraph
  candidateNodes: CandidateNode[]
  candidateFiles: CandidateFile[]
}): SemanticSummary {
  const { candidateNodes, candidateFiles } = options

  const sources: SemanticSource[] = []
  for (const node of candidateNodes) {
    if (node.semanticRoles?.length || node.artifactRefs?.length) {
      sources.push({ key: node.nodeId, semanticRoles: node.semanticRoles, artifactRefs: node.artifactRefs })
    }
  }
  for (const file of candidateFiles) {
    if (file.semanticRoles?.length || file.artifactRefs?.length) {
      sources.push({ key: file.path, semanticRoles: file.semanticRoles, artifactRefs: file.artifactRefs })
    }
  }

  const summariesByNode: Record<string, SemanticSummaryEntry> = {}
  const summariesByFile: Record<string, SemanticSummaryEntry> = {}
  const allRoles: SemanticRole[] = []
  const allRefs: SemanticArtifactRef[] = []
  const allEvidence: SemanticEvidenceRef[] = []

  for (const source of sources) {
    const roles = source.semanticRoles ?? []
    const refs = source.artifactRefs ?? []
    const evidenceRefs = collectEvidenceRefs(roles)
    const entry: SemanticSummaryEntry = { roles, artifactRefs: refs, evidenceRefs }
    if (source.key.startsWith('symbol:') || source.key.startsWith('file:')) {
      summariesByNode[source.key] = entry
    } else {
      summariesByFile[source.key] = entry
    }
    allRoles.push(...roles)
    allRefs.push(...refs)
    allEvidence.push(...evidenceRefs)
  }

  const available = Object.keys(summariesByNode).length > 0 || Object.keys(summariesByFile).length > 0

  return {
    available,
    roles: dedupeByJson(allRoles),
    artifactRefs: dedupeByJson(allRefs),
    evidenceRefs: dedupeByJson(allEvidence),
    summariesByNode,
    summariesByFile,
    warnings: available ? [] : ['No semantic role or artifact-ref metadata was found on the focus, graph, or candidates.'],
  }
}

function collectEvidenceRefs(roles: SemanticRole[]): SemanticEvidenceRef[] {
  const refs: SemanticEvidenceRef[] = []
  for (const role of roles) refs.push(...(role.evidenceRefs ?? []))
  return refs
}

function dedupeByJson<T>(values: T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const value of values) {
    const key = JSON.stringify(value)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}
