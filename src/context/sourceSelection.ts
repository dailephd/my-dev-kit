import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { ResolvedIndexManifest } from '../indexing/readIndexManifest.js'
import { getSourceSlice } from '../lookup/getSourceSlice.js'
import { resolveFileNodeTarget, resolveSymbolTarget } from '../lookup/resolveSourceTarget.js'
import type { SymbolIndex } from '../symbol-index/types.js'
import type { ContextFocus, SelectedGraph, SelectedSource, SelectedSourceSlice, SkippedSourceEntry } from './types.js'

export const DEFAULT_MAX_LINES = 160
export const DEFAULT_MAX_SOURCE_SLICES = 8

interface SourceTargetCandidate {
  nodeId: string
  priority: 0 | 1
  reason: string
}

export function deriveSourceTargets(options: { focus: ContextFocus; selectedGraph: SelectedGraph }): SourceTargetCandidate[] {
  const { focus, selectedGraph } = options
  const targets: SourceTargetCandidate[] = []
  if (focus.focusNodeId) {
    targets.push({ nodeId: focus.focusNodeId, priority: 0, reason: 'primary focus node' })
  }
  for (const node of selectedGraph.nodes) {
    if (node.nodeId === focus.focusNodeId) continue
    targets.push({ nodeId: node.nodeId, priority: 1, reason: 'selected graph neighbor of focus node' })
  }
  return targets
}

export function selectSourceSlices(options: {
  codeGraph: CodeGraph
  symbolIndex: SymbolIndex
  resolved: ResolvedIndexManifest
  targets: SourceTargetCandidate[]
  maxSourceSlices: number | null
}): SelectedSource {
  const { codeGraph, symbolIndex, resolved, targets } = options
  const maxSourceSlices = options.maxSourceSlices ?? DEFAULT_MAX_SOURCE_SLICES

  const slices: SelectedSourceSlice[] = []
  const skipped: SkippedSourceEntry[] = []
  const warnings: string[] = []
  let continuationUsedOnce = false

  for (const target of targets) {
    if (slices.length >= maxSourceSlices) {
      skipped.push({
        id: `skip-${target.nodeId}`,
        kind: 'omitted',
        filePath: undefined,
        reason: 'cap exceeded (--max-source-slices)',
        capType: 'max-source-slices',
      })
      continue
    }

    try {
      const nodeTarget = resolveFileNodeTarget(codeGraph, target.nodeId, DEFAULT_MAX_LINES)
      const resolvedTarget =
        nodeTarget.mode === 'symbol'
          ? resolveSymbolTarget(symbolIndex, nodeTarget.filePath, nodeTarget.symbolName!, DEFAULT_MAX_LINES)
          : nodeTarget

      let slice = getSourceSlice({
        indexDir: resolved.indexDir,
        projectRoot: resolved.manifest.projectRoot,
        filePath: resolvedTarget.filePath,
        startLine: resolvedTarget.startLine!,
        endLine: resolvedTarget.endLine!,
        maxLines: DEFAULT_MAX_LINES,
        mode: resolvedTarget.mode,
        symbolName: resolvedTarget.symbolName,
        semanticRoles: resolvedTarget.semanticRoles,
        artifactRefs: resolvedTarget.artifactRefs,
        evidenceRefs: resolvedTarget.evidenceRefs,
        classificationRoles: resolvedTarget.classificationRoles,
        classificationRefs: resolvedTarget.classificationRefs,
        warnings: resolvedTarget.warnings,
      })

      let continuationUsed = false
      if (target.priority === 0 && !continuationUsedOnce && slice.continuationCursor && !slice.continuationCursor.eof) {
        const cursor = slice.continuationCursor
        const nextEnd = cursor.nextStartLine + DEFAULT_MAX_LINES - 1
        try {
          const continued = getSourceSlice({
            indexDir: resolved.indexDir,
            projectRoot: resolved.manifest.projectRoot,
            filePath: resolvedTarget.filePath,
            startLine: cursor.nextStartLine,
            endLine: nextEnd,
            maxLines: DEFAULT_MAX_LINES,
            mode: resolvedTarget.mode,
            symbolName: resolvedTarget.symbolName,
          })
          slice = {
            ...slice,
            endLine: continued.endLine,
            lineCount: slice.lineCount + continued.lineCount,
            continuationCursor: continued.continuationCursor,
          }
          continuationUsed = true
          continuationUsedOnce = true
        } catch {
          // continuation is best-effort; keep the original bounded slice on failure
        }
      }

      slices.push(toSelectedSourceSlice(target, slice, continuationUsed))
    } catch (error) {
      skipped.push({
        id: `skip-${target.nodeId}`,
        kind: target.priority === 0 ? 'focus' : 'graph-neighbor',
        filePath: undefined,
        reason: (error as Error).message,
      })
    }
  }

  for (const entry of skipped) warnings.push(`Skipped source target: ${entry.reason}`)

  return {
    slices,
    omittedSliceCount: skipped.filter((entry) => entry.capType !== undefined).length,
    totalSelectedLines: slices.reduce((sum, slice) => sum + (slice.endLine - slice.startLine + 1), 0),
    maxSourceSlices,
    warnings,
    skipped,
  }
}

function toSelectedSourceSlice(
  target: SourceTargetCandidate,
  slice: ReturnType<typeof getSourceSlice>,
  continuationUsed: boolean
): SelectedSourceSlice {
  return {
    id: `src-${slice.filePath}-${slice.startLine}`,
    kind: slice.mode,
    filePath: slice.filePath,
    startLine: slice.startLine,
    endLine: slice.endLine,
    nodeId: target.nodeId,
    symbolName: slice.symbolName,
    reason: target.reason,
    sourceRetrievalMethod: slice.mode === 'symbol' ? 'symbol' : 'node',
    includedBy: target.priority === 0 ? 'primary-focus' : 'selected-graph',
    truncated: !(slice.continuationCursor?.eof ?? true),
    continuationAvailable: slice.continuationCursor ? !slice.continuationCursor.eof : undefined,
    continuationUsed,
    localExpansionUsed: false,
    ...(slice.classificationRefs ? { classificationRefs: slice.classificationRefs } : {}),
    ...(slice.artifactRefs ? { semanticRefs: slice.artifactRefs } : {}),
    warnings: slice.warnings,
  }
}
