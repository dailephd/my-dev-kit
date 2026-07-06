import { toForwardSlash } from '../io/pathUtils.js'
import { loadGraphDiffArtifacts, type GraphDiffArtifacts } from './loadGraphDiffArtifacts.js'
import { buildCodeGraphDiff } from './buildCodeGraphDiff.js'
import { buildSymbolIndexDiff } from './buildSymbolIndexDiff.js'
import { buildManifestDiff } from './buildManifestDiff.js'
import { buildClassificationDiff } from './buildClassificationDiff.js'
import { buildDataModelDiff, buildFrontendReachabilityDiff, buildFrontendSemanticDiff } from './buildSemanticSummaryDiff.js'
import { GRAPH_DIFF_REPORT_KIND, type GraphDiffResult } from './types.js'

export interface RunGraphDiffOptions {
  before: string
  after: string
}

/**
 * Compares two existing `my-dev-kit` index output directories. Read-only:
 * never runs `index`, never writes to either input directory. Required
 * artifacts (`manifest.json`, `code-graph.json`) throw a clear error when
 * missing or malformed (via the same `readIndexManifest`/`readRequiredJson`
 * helpers `lookup`/`slice`/`view` use); every optional artifact degrades to
 * an "unavailable" section rather than failing the whole comparison.
 */
export function runGraphDiff(options: RunGraphDiffOptions): GraphDiffResult {
  const before = loadGraphDiffArtifacts(options.before)
  const after = loadGraphDiffArtifacts(options.after)

  const warnings: string[] = []
  collectManifestSchemaWarning(before, after, warnings)
  collectOptionalArtifactWarnings(before, after, warnings)

  const { nodes, edges } = buildCodeGraphDiff(before.codeGraph, after.codeGraph)
  const symbolIndex = buildSymbolIndexDiff(before.symbolIndex, after.symbolIndex)
  const manifest = buildManifestDiff(before.resolved.manifest, after.resolved.manifest)
  const classification = buildClassificationDiff(before.classification, after.classification)
  const dataModel = buildDataModelDiff(before.dataModel, after.dataModel)
  const frontendSemantic = buildFrontendSemanticDiff(before.frontendSemantic, after.frontendSemantic)
  const frontendReachability = buildFrontendReachabilityDiff(before.frontendReachability, after.frontendReachability)

  return {
    reportKind: GRAPH_DIFF_REPORT_KIND,
    before: { indexDir: toForwardSlash(before.resolved.indexDir), projectRoot: before.resolved.manifest.projectRoot },
    after: { indexDir: toForwardSlash(after.resolved.indexDir), projectRoot: after.resolved.manifest.projectRoot },
    summary: {
      nodesAdded: nodes.added.length,
      nodesRemoved: nodes.removed.length,
      nodesChanged: nodes.changed.length,
      edgesAdded: edges.added.length,
      edgesRemoved: edges.removed.length,
      edgesChanged: edges.changed.length,
      filesAdded: symbolIndex.filesAdded.length,
      filesRemoved: symbolIndex.filesRemoved.length,
      filesChanged: symbolIndex.filesChanged.length,
      symbolsAdded: symbolIndex.symbolsAdded.length,
      symbolsRemoved: symbolIndex.symbolsRemoved.length,
      symbolsChanged: symbolIndex.symbolsChanged.length,
    },
    nodes,
    edges,
    symbolIndex,
    manifest,
    classification,
    semanticArtifacts: {
      dataModel,
      frontendSemantic,
      frontendReachability,
    },
    warnings,
  }
}

function collectManifestSchemaWarning(before: GraphDiffArtifacts, after: GraphDiffArtifacts, warnings: string[]): void {
  if (before.resolved.manifest.version !== after.resolved.manifest.version) {
    warnings.push(
      `Manifest schema version differs (before: ${before.resolved.manifest.version}, after: ${after.resolved.manifest.version}); only safe common fields were compared.`
    )
  }
}

function collectOptionalArtifactWarnings(before: GraphDiffArtifacts, after: GraphDiffArtifacts, warnings: string[]): void {
  if (!before.symbolIndex || !after.symbolIndex) {
    warnings.push('symbol-index.json is missing from at least one side; symbol-index diff is omitted.')
  }
  if (!before.classification && !after.classification) {
    warnings.push('classification.json is absent from both indexes; classification diff is omitted.')
  } else if (!before.classification || !after.classification) {
    warnings.push(
      `classification.json is present in only one index (${!before.classification ? 'after' : 'before'} only); classification diff is limited to presence.`
    )
  }
  warnOptionalArtifact(before.dataModel, after.dataModel, 'data-model.json', warnings)
  warnOptionalArtifact(before.frontendSemantic, after.frontendSemantic, 'frontend-semantic.json', warnings)
  warnOptionalArtifact(before.frontendReachability, after.frontendReachability, 'frontend-reachability.json', warnings)
}

function warnOptionalArtifact(before: unknown, after: unknown, label: string, warnings: string[]): void {
  if (!before && !after) return
  if (!before || !after) {
    warnings.push(`${label} is present in only one index (${!before ? 'after' : 'before'} only); its diff is limited to presence.`)
  }
}
