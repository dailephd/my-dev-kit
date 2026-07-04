import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { FrontendSemanticArtifact } from '../frontend/frontendTypes.js'
import type { ResolvedIndexManifest } from '../indexing/readIndexManifest.js'
import { buildSourceBundle } from '../source/sourceBundle.js'
import type { SymbolIndex } from '../symbol-index/types.js'
import type {
  ContextFocus,
  SelectedSourceBundle,
  SelectedSourceBundleBlock,
  SelectedSourceBundles,
} from './types.js'

const MAX_LINES_PER_BLOCK = 60
const MAX_LINES_PER_BUNDLE = 300
const MAX_BLOCKS = 20

export function selectSourceBundles(options: {
  focus: ContextFocus
  symbolIndex: SymbolIndex
  codeGraph: CodeGraph
  resolved: ResolvedIndexManifest
  frontendArtifact: FrontendSemanticArtifact | null
}): SelectedSourceBundles {
  const { focus, symbolIndex, codeGraph, resolved, frontendArtifact } = options

  if (!focus.focusNodeId) {
    return {
      bundles: [],
      omittedBundleCount: 0,
      totalSelectedLines: 0,
      warnings: ['No primary focus was selected; no source bundle was attempted.'],
    }
  }

  const node = codeGraph.nodes.find((candidate) => candidate.id === focus.focusNodeId)
  if (!node || node.kind !== 'symbol') {
    return {
      bundles: [],
      omittedBundleCount: 0,
      totalSelectedLines: 0,
      warnings: ['Primary focus is not a symbol node; local-dependency bundles are not applicable.'],
    }
  }

  try {
    const bundle = buildSourceBundle({
      indexDir: resolved.indexDir,
      projectRoot: resolved.manifest.projectRoot,
      nodeId: focus.focusNodeId,
      maxLinesPerBlock: MAX_LINES_PER_BLOCK,
      maxLinesPerBundle: MAX_LINES_PER_BUNDLE,
      maxBlocks: MAX_BLOCKS,
      includeImports: true,
      includeLocalTypes: true,
      includeProps: true,
      includeLocalComponents: true,
      includeLocalDeps: true,
      symbolIndex,
      codeGraph,
      frontendArtifact,
    })

    const blocks: SelectedSourceBundleBlock[] = [bundle.primaryBlock, ...bundle.expansionBlocks].map((block) => ({
      id: block.id,
      kind: block.kind,
      filePath: block.filePath,
      startLine: block.startLine,
      endLine: block.endLine,
      reason: block.expansionReasons.join(', ') || block.kind,
      includedBy: block.kind,
      truncated: block.fallbackReason !== undefined,
      warnings: block.warnings,
    }))

    const selectedBundle: SelectedSourceBundle = {
      id: `bundle-${focus.focusNodeId}`,
      title: `Local dependency bundle for ${focus.focusFilePath ?? focus.focusNodeId}`,
      focusNodeId: focus.focusNodeId,
      focusFilePath: focus.focusFilePath,
      reason: 'Local dependency context for the primary focus symbol.',
      blocks,
      totalLines: bundle.stats.totalLineCount,
      maxLines: bundle.limits.maxLinesPerBundle,
      skippedBlocks: bundle.skippedBlocks.map((skipped) => ({
        id: skipped.id,
        kind: skipped.kind,
        ...(skipped.filePath ? { filePath: skipped.filePath } : {}),
        reason: skipped.reason,
        capType: skipped.reasonCode.includes('max-') ? skipped.reasonCode : undefined,
      })),
      warnings: bundle.warnings,
    }

    return {
      bundles: [selectedBundle],
      omittedBundleCount: 0,
      totalSelectedLines: bundle.stats.totalLineCount,
      warnings: bundle.warnings,
    }
  } catch (error) {
    return {
      bundles: [],
      omittedBundleCount: 1,
      totalSelectedLines: 0,
      warnings: [`Bundle construction failed: ${(error as Error).message}`],
    }
  }
}
