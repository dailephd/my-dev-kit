import type {
  ClassificationSummary,
  PruningSummary,
  RetentionSummary,
  SelectedSource,
  SelectedSourceBundles,
  SemanticSummary,
} from './types.js'

export function buildPruning(options: {
  retention: RetentionSummary
  selectedSource: SelectedSource
  selectedSourceBundles: SelectedSourceBundles
  semanticSummary: SemanticSummary
  classificationSummary: ClassificationSummary
}): PruningSummary {
  const { retention, selectedSource, selectedSourceBundles, semanticSummary, classificationSummary } = options

  const retainedReasons = new Set<string>()
  const droppedReasons = new Set<string>()

  if (retention.retainedCandidateCount > 0) retainedReasons.add('retained ranked candidate files')
  if (retention.retainedGraphNodeCount > 0) retainedReasons.add('retained graph neighborhood around the primary focus')
  if (selectedSource.slices.length > 0) retainedReasons.add('retained bounded source slices for the focus and graph neighborhood')
  if (selectedSourceBundles.bundles.length > 0) retainedReasons.add('retained one local-dependency source bundle for the focus symbol')
  if (semanticSummary.available) retainedReasons.add('retained semantic role/artifact-ref evidence for the focus and candidates')
  if (classificationSummary.available) retainedReasons.add('retained classification edit-guidance/readiness/risk evidence')

  if (retention.droppedCandidateCount > 0) droppedReasons.add('dropped lower-ranked candidate files beyond --max-candidate-files')
  if (retention.droppedGraphNodeCount > 0) droppedReasons.add('dropped graph nodes beyond --max-graph-nodes')
  if (retention.droppedGraphEdgeCount > 0) droppedReasons.add('dropped graph edges beyond --max-graph-edges')
  if (selectedSource.omittedSliceCount > 0) droppedReasons.add('dropped source slices beyond --max-source-slices')
  if (selectedSourceBundles.omittedBundleCount > 0) droppedReasons.add('dropped source bundle construction failure')
  if (!classificationSummary.available) droppedReasons.add('classification metadata unavailable for this index')

  return {
    policyVersion: '1.0.0',
    retainedCounts: {
      candidateFiles: retention.retainedCandidateCount,
      candidateNodes: 0,
      graphNodes: retention.retainedGraphNodeCount,
      graphEdges: retention.retainedGraphEdgeCount,
      sourceSlices: selectedSource.slices.length,
      sourceBundles: selectedSourceBundles.bundles.length,
    },
    droppedCounts: {
      candidateFiles: retention.droppedCandidateCount,
      candidateNodes: 0,
      graphNodes: retention.droppedGraphNodeCount,
      graphEdges: retention.droppedGraphEdgeCount,
      sourceSlices: selectedSource.omittedSliceCount,
      sourceBundles: selectedSourceBundles.omittedBundleCount,
    },
    capSettings: {
      maxCandidateFiles: retention.capSettings.maxCandidateFiles,
      maxGraphNodes: retention.capSettings.maxGraphNodes,
      maxGraphEdges: retention.capSettings.maxGraphEdges,
      maxSourceSlices: selectedSource.maxSourceSlices,
    },
    retainedReasons: [...retainedReasons].sort(),
    droppedReasons: [...droppedReasons].sort(),
    warnings: [...selectedSource.warnings, ...selectedSourceBundles.warnings],
  }
}
