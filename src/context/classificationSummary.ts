import {
  buildClassificationCommandSummary,
  findClassificationEntryByTargetId,
  resolveClassificationArtifactPath,
  type ClassificationCommandSummary,
} from '../classification/resolveClassificationForCommands.js'
import type { ClassificationArtifact, EditGuidance, Readiness, RiskLabel, UncertaintyTier } from '../classification/classificationTypes.js'
import type { IndexManifest } from '../indexing/manifestTypes.js'
import type { CandidateFile, CandidateNode, ClassificationSummary, ClassificationSummaryEntry, ContextFocus, SelectedGraph } from './types.js'

export function buildClassificationSummary(options: {
  classificationArtifact: ClassificationArtifact | null
  indexDir: string
  manifest: IndexManifest
  focus: ContextFocus
  selectedGraph: SelectedGraph
  candidateNodes: CandidateNode[]
  candidateFiles: CandidateFile[]
}): ClassificationSummary {
  const { classificationArtifact, indexDir, manifest, focus, selectedGraph, candidateNodes, candidateFiles } = options

  if (!classificationArtifact) {
    return {
      available: false,
      classificationArtifactPath: null,
      roles: [],
      refs: [],
      editGuidance: [],
      readiness: [],
      riskLabels: [],
      uncertainty: [],
      summariesByNode: {},
      summariesByFile: {},
      warnings: ['Classification metadata unavailable: older index without classification, or classification.json not registered.'],
    }
  }

  const targetIds = new Set<string>()
  if (focus.focusNodeId) targetIds.add(focus.focusNodeId)
  for (const node of selectedGraph.nodes) targetIds.add(node.nodeId)
  for (const node of candidateNodes.filter((c) => c.retained)) targetIds.add(node.nodeId)
  for (const file of candidateFiles.filter((c) => c.retained)) targetIds.add(`file:${file.path}`)

  const summariesByNode: Record<string, ClassificationSummaryEntry> = {}
  const allRoles: ClassificationSummary['roles'] = []
  const allRefs: ClassificationSummary['refs'] = []
  const allGuidance: EditGuidance[] = []
  const allReadiness: Readiness[] = []
  const allRisks: RiskLabel[] = []
  const allUncertainty: UncertaintyTier[] = []

  for (const targetId of targetIds) {
    const entry = findClassificationEntryByTargetId(classificationArtifact, targetId)
    const summary: ClassificationCommandSummary | null = buildClassificationCommandSummary(entry)
    if (!summary) continue
    summariesByNode[targetId] = {
      classifications: entry!.classifications,
      editGuidance: summary.editGuidance,
      readiness: summary.readiness,
      risks: summary.risks,
      uncertainty: summary.uncertainty,
      warnings: summary.warnings.map((warning) => warning.message),
    }
    allRoles.push(...summary.classifications)
    allRefs.push(...summary.evidenceRefs)
    allGuidance.push(summary.editGuidance)
    allReadiness.push(summary.readiness)
    allRisks.push(...summary.risks)
    allUncertainty.push(summary.uncertainty)
  }

  const available = Object.keys(summariesByNode).length > 0

  return {
    available,
    classificationArtifactPath: resolveClassificationArtifactPath(manifest, indexDir),
    roles: dedupeByJson(allRoles),
    refs: dedupeByJson(allRefs),
    editGuidance: dedupeByJson(allGuidance),
    readiness: dedupeByJson(allReadiness),
    riskLabels: dedupeByJson(allRisks),
    uncertainty: dedupeByJson(allUncertainty),
    summariesByNode,
    summariesByFile: {},
    warnings: available ? [] : ['No classification.json entries matched the selected focus, graph, or candidates.'],
  }
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
