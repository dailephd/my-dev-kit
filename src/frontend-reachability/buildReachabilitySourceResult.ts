/**
 * Builds the reachability source result for `source --route|--storage-key|--ui`.
 *
 * Resolves each matched fact's source refs to bounded source blocks using the
 * shared getSourceSlice retrieval. A --context window is applied around each
 * source ref line.
 */

import type { FrontendReachabilityArtifact, ReachabilityEvidenceRef } from './types.js'
import { getSourceSlice } from '../lookup/getSourceSlice.js'
import {
  findRouteFact,
  findStorageKeyFacts,
  findUiFacts,
  MISSING_ARTIFACT_WARNING,
  type ReachabilityMode,
} from './reachabilityConsumers.js'

export interface ReachabilitySourceBlock {
  factId: string
  factKind: 'route' | 'storage-key' | 'ui'
  label: string
  confidence: string
  filePath: string
  startLine: number
  endLine: number
  content: string
  warnings: string[]
}

export interface ReachabilitySourceResult {
  artifactKind: 'my-dev-kit-v1-reachability-source-result'
  version: '1.0.0'
  mode: ReachabilityMode
  query: string
  status: 'ok' | 'not-found' | 'no-source-range' | 'missing-artifact'
  blocks: ReachabilitySourceBlock[]
  warnings: string[]
  summary: { blockCount: number }
}

interface FactSourceTarget {
  factId: string
  factKind: 'route' | 'storage-key' | 'ui'
  label: string
  confidence: string
  sourceRefs: ReachabilityEvidenceRef[]
}

export interface BuildReachabilitySourceOptions {
  artifact: FrontendReachabilityArtifact | null
  mode: ReachabilityMode
  query: string
  indexDir: string
  projectRoot: string
  contextLines: number
  maxLines: number
}

function emptyResult(
  mode: ReachabilityMode,
  query: string,
  status: 'not-found' | 'no-source-range' | 'missing-artifact',
  warning: string
): ReachabilitySourceResult {
  return {
    artifactKind: 'my-dev-kit-v1-reachability-source-result',
    version: '1.0.0',
    mode,
    query,
    status,
    blocks: [],
    warnings: [warning],
    summary: { blockCount: 0 },
  }
}

function collectTargets(
  artifact: FrontendReachabilityArtifact,
  mode: ReachabilityMode,
  query: string
): FactSourceTarget[] {
  const targets: FactSourceTarget[] = []
  if (mode === 'route') {
    const fact = findRouteFact(artifact, query)
    if (fact) {
      targets.push({
        factId: fact.id,
        factKind: 'route',
        label: fact.path,
        confidence: fact.confidence,
        sourceRefs: fact.sourceRefs,
      })
    }
  } else if (mode === 'storage-key') {
    for (const fact of findStorageKeyFacts(artifact, query)) {
      targets.push({
        factId: fact.id,
        factKind: 'storage-key',
        label: `${fact.storageKind}:${fact.key}`,
        confidence: fact.confidence,
        sourceRefs: fact.sourceRefs,
      })
    }
  } else {
    for (const fact of findUiFacts(artifact, query)) {
      targets.push({
        factId: fact.id,
        factKind: 'ui',
        label: `${fact.markerKind}:${fact.value}`,
        confidence: fact.confidence,
        sourceRefs: [fact.sourceRef],
      })
    }
  }
  return targets
}

export function buildReachabilitySourceResult(
  options: BuildReachabilitySourceOptions
): ReachabilitySourceResult {
  const { artifact, mode, query, indexDir, projectRoot, contextLines, maxLines } = options
  if (!artifact) return emptyResult(mode, query, 'missing-artifact', MISSING_ARTIFACT_WARNING)

  const targets = collectTargets(artifact, mode, query)
  if (targets.length === 0) {
    return emptyResult(
      mode,
      query,
      'not-found',
      `No ${mode} fact found matching "${query}" in frontend-reachability artifact.`
    )
  }

  const blocks: ReachabilitySourceBlock[] = []
  const warnings: string[] = []
  let sawUsableRef = false

  for (const target of targets) {
    const usableRefs = target.sourceRefs.filter(
      (ref) => ref.filePath && ref.line != null && ref.line > 0
    )
    if (usableRefs.length === 0) {
      warnings.push(
        `Fact ${target.factId} has no source range; try \`source --contains "${target.label}"\` instead.`
      )
      continue
    }
    sawUsableRef = true
    for (const ref of usableRefs) {
      const line = ref.line as number
      const startLine = Math.max(1, line - contextLines)
      const endLine = line + contextLines
      const slice = getSourceSlice({
        indexDir,
        projectRoot,
        filePath: ref.filePath,
        startLine,
        endLine,
        maxLines,
        mode: 'symbol',
        symbolName: target.label,
      })
      blocks.push({
        factId: target.factId,
        factKind: target.factKind,
        label: target.label,
        confidence: target.confidence,
        filePath: slice.filePath,
        startLine: slice.startLine,
        endLine: slice.endLine,
        content: slice.content,
        warnings: slice.warnings,
      })
    }
  }

  if (!sawUsableRef) {
    return {
      artifactKind: 'my-dev-kit-v1-reachability-source-result',
      version: '1.0.0',
      mode,
      query,
      status: 'no-source-range',
      blocks: [],
      warnings,
      summary: { blockCount: 0 },
    }
  }

  return {
    artifactKind: 'my-dev-kit-v1-reachability-source-result',
    version: '1.0.0',
    mode,
    query,
    status: 'ok',
    blocks,
    warnings,
    summary: { blockCount: blocks.length },
  }
}
