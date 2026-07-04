import * as fs from 'node:fs'
import type { Command } from 'commander'
import { toForwardSlash } from '../io/pathUtils.js'
import { readIndexManifest } from '../indexing/readIndexManifest.js'
import { readRequiredJson } from '../indexing/loadIndexArtifacts.js'
import { buildContextCapsule, computeContextAdequacy, writeContextCapsule } from '../context/contextCapsule.js'
import { buildRetrievalAuditRecord, writeRetrievalAuditRecord } from '../context/retrievalAuditRecord.js'
import { buildQueryPlan } from '../context/queryPlan.js'
import { buildModeEffects, rankCandidateFiles, rankCandidateNodes, type RankingInput } from '../context/candidateRanking.js'
import { selectPrimaryFocus } from '../context/graphFocus.js'
import { selectGraphNeighborhood } from '../context/graphSelection.js'
import { deriveSourceTargets, selectSourceSlices } from '../context/sourceSelection.js'
import { selectSourceBundles } from '../context/sourceBundles.js'
import { buildSemanticSummary } from '../context/metadataSummary.js'
import { buildClassificationSummary } from '../context/classificationSummary.js'
import { buildArtifactReferenceSummary } from '../context/artifactReferenceSummary.js'
import { buildPruning } from '../context/pruningPolicy.js'
import { detectContextConflicts } from '../context/conflictDetection.js'
import { DEFAULT_MAX_SOURCE_SLICES } from '../context/sourceSelection.js'
import { loadClassificationArtifact } from '../classification/resolveClassificationForCommands.js'
import { searchIndex } from '../search/searchIndex.js'
import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { SymbolIndex } from '../symbol-index/types.js'
import type { FrontendSemanticArtifact } from '../frontend/frontendTypes.js'
import type { ResolvedIndexManifest } from '../indexing/readIndexManifest.js'
import type {
  AuditStep,
  ContextCapsuleLimits,
  ContextCapsuleMode,
  ContextEntry,
  DroppedContextEntry,
} from '../context/types.js'

const VALID_MODES: ContextCapsuleMode[] = ['general', 'feature-add', 'subsystem']
const SEARCH_INTERNAL_LIMIT = 50

interface ContextCommandOptions {
  index: string
  query?: string
  out?: string
  auditOut?: string
  mode: string
  maxCandidateFiles?: number
  maxSourceSlices?: number
  maxGraphNodes?: number
  maxGraphEdges?: number
  json?: boolean
  source: boolean
}

export function registerContextCommand(program: Command): void {
  program
    .command('context')
    .description(
      'Write a bounded, local, deterministic context capsule for a query against an indexed project. ' +
        'Ranks candidate files/nodes via the existing search engine, selects a single-seed graph focus and ' +
        'neighborhood, and attaches bounded, content-free source evidence plus semantic/classification ' +
        'summaries. No LLM calls, no multi-seed focus, no raw source/artifact dumps.'
    )
    .option('--index <dir>', 'index artifact directory', '.my-dev-kit')
    .option('--query <text>', 'task query to record in the capsule')
    .option('--out <path>', 'context capsule output path')
    .option('--audit-out <path>', 'retrieval audit record output path')
    .option('--mode <mode>', 'general, feature-add, or subsystem', 'general')
    .option('--max-candidate-files <n>', 'cap retained candidate files', parsePositiveInt)
    .option('--max-source-slices <n>', 'cap selected source slices around the focus and graph neighborhood', parsePositiveInt)
    .option('--max-graph-nodes <n>', 'cap selected graph nodes around the focus', parsePositiveInt)
    .option('--max-graph-edges <n>', 'cap selected graph edges around the focus', parsePositiveInt)
    .option('--no-source', 'disable bounded source slices and source bundles')
    .option('--json', 'print JSON output')
    .action((options: ContextCommandOptions) => {
      validateOptions(options)

      const mode = options.mode as ContextCapsuleMode
      const limits: ContextCapsuleLimits = {
        maxCandidateFiles: options.maxCandidateFiles ?? null,
        maxSourceSlices: options.maxSourceSlices ?? null,
        maxGraphNodes: options.maxGraphNodes ?? null,
        maxGraphEdges: options.maxGraphEdges ?? null,
      }

      const steps: AuditStep[] = []
      steps.push({
        id: 'step-validate-inputs',
        kind: 'validate-inputs',
        description: 'Validated required and optional command inputs.',
        inputs: { index: options.index, mode, out: options.out ?? null, auditOut: options.auditOut ?? null },
        outputs: {},
        status: 'ok',
        warnings: [],
      })

      const resolved = readIndexManifest(options.index)
      steps.push({
        id: 'step-load-manifest',
        kind: 'load-manifest',
        description: 'Loaded and validated the index manifest.',
        inputs: { manifestPath: toForwardSlash(resolved.manifestPath) },
        outputs: { manifestVersion: resolved.manifest.version },
        status: 'ok',
        warnings: [],
      })

      const symbolIndex = readRequiredJson<SymbolIndex>(resolved.artifactPaths.symbolIndex, 'symbol index')
      const codeGraph = readRequiredJson<CodeGraph>(resolved.artifactPaths.codeGraph, 'code graph')

      const queryPlan = buildQueryPlan({ originalQuery: options.query!, mode })
      steps.push({
        id: 'step-normalize-query',
        kind: 'normalize-query',
        description: 'Normalized the query string.',
        inputs: { originalQuery: options.query! },
        outputs: { normalizedQuery: queryPlan.normalizedQuery },
        status: 'ok',
        warnings: [],
      })
      steps.push({
        id: 'step-extract-query-terms',
        kind: 'extract-query-terms',
        description: 'Extracted deterministic structured query terms.',
        inputs: {},
        outputs: { termCount: queryPlan.terms.raw.length },
        status: 'ok',
        warnings: [],
      })

      const rankingInput = runSearch({ resolved, symbolIndex, codeGraph, normalizedQuery: queryPlan.normalizedQuery, hasTerms: queryPlan.terms.raw.length > 0 })
      steps.push({
        id: 'step-run-search',
        kind: 'run-search',
        description: 'Ran the existing search engine to gather ranked candidates.',
        inputs: { query: queryPlan.normalizedQuery },
        outputs: { status: rankingInput.status, resultCount: rankingInput.results.length },
        status: rankingInput.status === 'ok' ? 'ok' : 'skipped',
        warnings: rankingInput.warnings,
      })

      const candidateFiles = rankCandidateFiles(rankingInput, limits.maxCandidateFiles, mode)
      steps.push({
        id: 'step-rank-candidate-files',
        kind: 'rank-candidate-files',
        description: 'Ranked candidate files from search results.',
        inputs: {},
        outputs: {
          retainedCount: candidateFiles.filter((c) => c.retained).length,
          droppedCount: candidateFiles.filter((c) => !c.retained).length,
        },
        status: 'ok',
        warnings: [],
      })

      const candidateNodes = rankCandidateNodes(rankingInput, mode)
      steps.push({
        id: 'step-rank-candidate-nodes',
        kind: 'rank-candidate-nodes',
        description: 'Ranked candidate graph nodes from search results.',
        inputs: {},
        outputs: { candidateCount: candidateNodes.length },
        status: 'ok',
        warnings: [],
      })

      const modeEffects = buildModeEffects(mode, candidateFiles, candidateNodes)
      steps.push({
        id: 'step-apply-mode-ranking-adjustment',
        kind: 'apply-mode-ranking-adjustment',
        description: 'Applied small deterministic mode-specific ranking adjustments.',
        inputs: { mode },
        outputs: { applied: modeEffects.applied, effectCount: modeEffects.effects.length },
        status: mode === 'general' ? 'skipped' : 'ok',
        warnings: modeEffects.warnings,
      })

      const focus = selectPrimaryFocus(candidateNodes)
      steps.push({
        id: 'step-select-primary-focus',
        kind: 'select-primary-focus',
        description: 'Selected a single primary focus node, if evidence was sufficient.',
        inputs: {},
        outputs: {
          focusNodeId: focus.focusNodeId,
          selectionMode: focus.selectionMode,
          confidence: focus.confidence,
        },
        status: 'ok',
        warnings: focus.warnings,
      })

      const focusNode = focus.focusNodeId ? codeGraph.nodes.find((node) => node.id === focus.focusNodeId) ?? null : null
      steps.push({
        id: 'step-inspect-primary-focus',
        kind: 'inspect-primary-focus',
        description: 'Read already-embedded semantic and classification metadata for the primary focus node.',
        inputs: { focusNodeId: focus.focusNodeId },
        outputs: { found: focusNode !== null },
        status: 'ok',
        warnings: [],
      })

      const selectedGraph = selectGraphNeighborhood({
        codeGraph,
        focus,
        maxGraphNodes: limits.maxGraphNodes,
        maxGraphEdges: limits.maxGraphEdges,
      })
      steps.push({
        id: 'step-select-graph-neighborhood',
        kind: 'select-graph-neighborhood',
        description: 'Selected a bounded graph neighborhood around the primary focus node.',
        inputs: { focusNodeId: focus.focusNodeId },
        outputs: { nodeCount: selectedGraph.nodes.length, edgeCount: selectedGraph.edges.length },
        status: 'ok',
        warnings: selectedGraph.warnings,
      })

      steps.push({
        id: 'step-apply-caps',
        kind: 'apply-caps',
        description: 'Applied candidate-file and graph node/edge caps.',
        inputs: {
          maxCandidateFiles: limits.maxCandidateFiles,
          maxGraphNodes: limits.maxGraphNodes,
          maxGraphEdges: limits.maxGraphEdges,
        },
        outputs: {
          omittedNodeCount: selectedGraph.omittedNodeCount,
          omittedEdgeCount: selectedGraph.omittedEdgeCount,
        },
        status: 'ok',
        warnings: [],
      })

      const retention = {
        retainedCandidateCount: candidateFiles.filter((c) => c.retained).length,
        droppedCandidateCount: candidateFiles.filter((c) => !c.retained).length,
        retainedGraphNodeCount: selectedGraph.nodes.length,
        droppedGraphNodeCount: selectedGraph.omittedNodeCount,
        retainedGraphEdgeCount: selectedGraph.edges.length,
        droppedGraphEdgeCount: selectedGraph.omittedEdgeCount,
        capSettings: {
          maxCandidateFiles: limits.maxCandidateFiles,
          maxGraphNodes: limits.maxGraphNodes,
          maxGraphEdges: limits.maxGraphEdges,
        },
      }
      steps.push({
        id: 'step-record-retained-and-dropped-context',
        kind: 'record-retained-and-dropped-context',
        description: 'Recorded retained/dropped candidate and graph-selection counts.',
        inputs: {},
        outputs: {
          retainedCandidateCount: retention.retainedCandidateCount,
          droppedCandidateCount: retention.droppedCandidateCount,
        },
        status: 'ok',
        warnings: [],
      })

      // --- Batch 3: bounded source evidence and semantic/classification-enriched capsule ---

      const sourceControl = {
        enabled: options.source,
        reason: options.source
          ? 'Bounded source evidence is enabled by default.'
          : 'Source evidence was intentionally disabled by --no-source.',
      }
      const sourceTargets = options.source ? deriveSourceTargets({ focus, selectedGraph }) : []
      steps.push({
        id: 'step-derive-source-targets',
        kind: 'derive-source-targets',
        description: 'Derived bounded source targets from the primary focus and selected graph neighborhood.',
        inputs: {},
        outputs: { targetCount: sourceTargets.length },
        status: options.source ? 'ok' : 'skipped',
        warnings: [],
      })

      const selectedSource = options.source
        ? selectSourceSlices({
            codeGraph,
            symbolIndex,
            resolved,
            targets: sourceTargets,
            maxSourceSlices: limits.maxSourceSlices,
          })
        : {
            slices: [],
            omittedSliceCount: 0,
            totalSelectedLines: 0,
            maxSourceSlices: limits.maxSourceSlices ?? DEFAULT_MAX_SOURCE_SLICES,
            warnings: [sourceControl.reason],
            skipped: [],
          }
      steps.push({
        id: 'step-select-source-slices',
        kind: 'select-source-slices',
        description: 'Selected bounded, content-free source slices for the derived targets.',
        inputs: {},
        outputs: { sliceCount: selectedSource.slices.length, omittedSliceCount: selectedSource.omittedSliceCount },
        status: options.source ? 'ok' : 'skipped',
        warnings: selectedSource.warnings,
      })

      const frontendArtifact = options.source ? loadOptionalFrontendArtifact(resolved) : null
      const selectedSourceBundles = options.source
        ? selectSourceBundles({ focus, symbolIndex, codeGraph, resolved, frontendArtifact })
        : { bundles: [], omittedBundleCount: 0, totalSelectedLines: 0, warnings: [sourceControl.reason] }
      steps.push({
        id: 'step-select-source-bundles',
        kind: 'select-source-bundles',
        description: 'Selected at most one local-dependency source bundle for a symbol-kind primary focus.',
        inputs: {},
        outputs: { bundleCount: selectedSourceBundles.bundles.length },
        status: options.source ? 'ok' : 'skipped',
        warnings: selectedSourceBundles.warnings,
      })

      steps.push({
        id: 'step-apply-source-caps',
        kind: 'apply-source-caps',
        description: 'Applied --max-source-slices to the selected source slices.',
        inputs: { maxSourceSlices: selectedSource.maxSourceSlices },
        outputs: { omittedSliceCount: selectedSource.omittedSliceCount },
        status: options.source ? 'ok' : 'skipped',
        warnings: [],
      })

      const continuationUsed = selectedSource.slices.some((slice) => slice.continuationUsed)
      steps.push({
        id: 'step-use-source-continuation',
        kind: 'use-source-continuation',
        description: 'Reported whether the primary focus source slice used one bounded continuation window.',
        inputs: {},
        outputs: { continuationUsed },
        status: continuationUsed ? 'ok' : 'skipped',
        warnings: [],
      })

      steps.push({
        id: 'step-skip-source-evidence',
        kind: 'skip-source-evidence',
        description: 'Recorded whether source evidence was intentionally disabled by user request.',
        inputs: { sourceEnabled: sourceControl.enabled },
        outputs: { sourceDisabled: !sourceControl.enabled },
        status: sourceControl.enabled ? 'skipped' : 'ok',
        warnings: sourceControl.enabled ? [] : [sourceControl.reason],
      })

      const localExpansionUsed = selectedSourceBundles.bundles.length > 0
      steps.push({
        id: 'step-use-local-source-expansion',
        kind: 'use-local-source-expansion',
        description: 'Reported whether local-dependency expansion was used via the one optional source bundle.',
        inputs: {},
        outputs: { localExpansionUsed },
        status: localExpansionUsed ? 'ok' : 'skipped',
        warnings: [],
      })

      const semanticSummary = buildSemanticSummary({ focus, selectedGraph, candidateNodes, candidateFiles })
      steps.push({
        id: 'step-inspect-semantic-metadata',
        kind: 'inspect-semantic-metadata',
        description: 'Inspected already-embedded semantic role and artifact-ref metadata.',
        inputs: {},
        outputs: { available: semanticSummary.available },
        status: 'ok',
        warnings: semanticSummary.warnings,
      })

      const classificationArtifact = loadClassificationArtifact(options.index, resolved.manifest)
      const classificationSummary = buildClassificationSummary({
        classificationArtifact,
        indexDir: options.index,
        manifest: resolved.manifest,
        focus,
        selectedGraph,
        candidateNodes,
        candidateFiles,
      })
      steps.push({
        id: 'step-inspect-classification-metadata',
        kind: 'inspect-classification-metadata',
        description: 'Inspected classification.json metadata when available.',
        inputs: {},
        outputs: { available: classificationSummary.available },
        status: 'ok',
        warnings: classificationSummary.warnings,
      })

      const artifactReferenceSummary = buildArtifactReferenceSummary(resolved)
      steps.push({
        id: 'step-inspect-artifact-references',
        kind: 'inspect-artifact-references',
        description: 'Inspected compact artifact references known to the manifest.',
        inputs: {},
        outputs: { artifactCount: artifactReferenceSummary.length },
        status: 'ok',
        warnings: [],
      })

      const conflicts = detectContextConflicts({ focus, candidateNodes })
      steps.push({
        id: 'step-detect-context-conflicts',
        kind: 'detect-context-conflicts',
        description: 'Applied conservative static edit-guidance conflict rules.',
        inputs: { focusNodeId: focus.focusNodeId },
        outputs: { status: conflicts.status, conflictCount: conflicts.conflicts.length },
        status: 'ok',
        warnings: conflicts.warnings,
      })

      const { extraRequiredContext, extraOptionalSupportContext } = assembleContextBuckets({
        focus,
        selectedGraph,
        selectedSource,
        semanticSummary,
        classificationSummary,
        conflicts,
      })
      steps.push({
        id: 'step-assemble-required-context',
        kind: 'assemble-required-context',
        description: 'Assembled required context entries for focus, graph, source, and classification evidence.',
        inputs: {},
        outputs: { entryCount: extraRequiredContext.length },
        status: 'ok',
        warnings: [],
      })
      steps.push({
        id: 'step-assemble-optional-support-context',
        kind: 'assemble-optional-support-context',
        description: 'Assembled optional support context entries for secondary graph/source/semantic evidence.',
        inputs: {},
        outputs: { entryCount: extraOptionalSupportContext.length },
        status: 'ok',
        warnings: [],
      })

      const extraDroppedContext = assembleDroppedContext({ candidateFiles, candidateNodes, selectedGraph, selectedSource, selectedSourceBundles })
      steps.push({
        id: 'step-assemble-dropped-context',
        kind: 'assemble-dropped-context',
        description: 'Assembled dropped context entries for cap- and relevance-based omissions.',
        inputs: {},
        outputs: { entryCount: extraDroppedContext.length },
        status: 'ok',
        warnings: [],
      })

      const pruning = buildPruning({ retention, selectedSource, selectedSourceBundles, semanticSummary, classificationSummary })
      steps.push({
        id: 'step-apply-pruning-policy',
        kind: 'apply-pruning-policy',
        description: 'Applied the deterministic pruning/retention rollup policy.',
        inputs: {},
        outputs: { policyVersion: pruning.policyVersion },
        status: 'ok',
        warnings: pruning.warnings,
      })

      const contextAdequacy = computeContextAdequacy({
        focus,
        selectedGraph,
        selectedSource,
        classificationSummary,
        conflicts,
        sourceControl,
      })
      steps.push({
        id: 'step-update-context-adequacy',
        kind: 'update-context-adequacy',
        description: 'Updated context adequacy based on graph, source, and metadata sufficiency.',
        inputs: {},
        outputs: { status: contextAdequacy.status },
        status: 'ok',
        warnings: [],
      })

      const capsule = buildContextCapsule({
        resolved,
        originalQuery: options.query!,
        mode,
        requestedOutputPath: options.out!,
        limits,
        queryPlan,
        candidateFiles,
        candidateNodes,
        focus,
        selectedGraph,
        retention,
        contextAdequacy,
        selectedSource,
        selectedSourceBundles,
        semanticSummary,
        classificationSummary,
        artifactReferenceSummary,
        pruning,
        conflicts,
        modeEffects,
        sourceControl,
        extraRequiredContext,
        extraOptionalSupportContext,
        extraDroppedContext,
      })
      steps.push({
        id: 'step-inspect-artifacts',
        kind: 'inspect-artifacts',
        description: 'Enumerated known index and semantic artifacts from the manifest.',
        inputs: {},
        outputs: { artifactCount: capsule.index.artifactRefs.length },
        status: 'ok',
        warnings: [],
      })

      const writtenCapsulePath = writeContextCapsule(options.out!, capsule)
      steps.push({
        id: 'step-write-context-capsule',
        kind: 'write-context-capsule',
        description: 'Wrote the context capsule artifact.',
        inputs: { outputPath: options.out! },
        outputs: { writtenPath: writtenCapsulePath },
        status: 'ok',
        warnings: [],
      })

      let writtenAuditPath: string | null = null
      if (options.auditOut) {
        const auditRecord = buildRetrievalAuditRecord({
          resolved,
          request: capsule.request,
          steps: [
            ...steps,
            {
              id: 'step-write-retrieval-audit-record',
              kind: 'write-retrieval-audit-record',
              description: 'Wrote the retrieval audit record artifact.',
              inputs: { outputPath: options.auditOut },
              outputs: {},
              status: 'ok',
              warnings: [],
            },
          ],
        })
        writtenAuditPath = writeRetrievalAuditRecord(options.auditOut, auditRecord)
      }

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              ...capsule,
              outputPath: writtenCapsulePath,
              ...(writtenAuditPath ? { auditOutputPath: writtenAuditPath } : {}),
            },
            null,
            2
          )
        )
        return
      }

      console.log(
        `Context capsule: ${capsule.requiredContext.length} required, ${capsule.optionalSupportContext.length} optional, ${capsule.droppedContext.length} dropped.`
      )
      console.log(`Wrote context capsule to ${writtenCapsulePath}.`)
      if (writtenAuditPath) console.log(`Wrote retrieval audit record to ${writtenAuditPath}.`)
    })
}

function loadOptionalFrontendArtifact(resolved: ResolvedIndexManifest): FrontendSemanticArtifact | null {
  const artifactPath = resolved.semanticArtifactPaths.frontendSemantic
  if (!artifactPath) return null
  try {
    if (!fs.existsSync(artifactPath)) return null
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as FrontendSemanticArtifact
  } catch {
    return null
  }
}

function assembleContextBuckets(options: {
  focus: ReturnType<typeof selectPrimaryFocus>
  selectedGraph: ReturnType<typeof selectGraphNeighborhood>
  selectedSource: ReturnType<typeof selectSourceSlices>
  semanticSummary: ReturnType<typeof buildSemanticSummary>
  classificationSummary: ReturnType<typeof buildClassificationSummary>
  conflicts: ReturnType<typeof detectContextConflicts>
}): { extraRequiredContext: ContextEntry[]; extraOptionalSupportContext: ContextEntry[] } {
  const { focus, selectedGraph, selectedSource, semanticSummary, classificationSummary, conflicts } = options

  const extraRequiredContext: ContextEntry[] = [
    {
      id: 'ctx-focus-summary',
      kind: 'focus-summary',
      title: focus.focusNodeId ? `Primary focus: ${focus.focusNodeId}` : 'No primary focus selected',
      reason: focus.focusNodeId
        ? `Primary focus selected with ${focus.confidence} confidence.`
        : 'No candidate had sufficient evidence to become the primary focus.',
      evidenceRefs: [],
      warnings: focus.warnings,
    },
  ]

  if (selectedGraph.nodes.length > 0) {
    extraRequiredContext.push({
      id: 'ctx-selected-graph-summary',
      kind: 'selected-graph-summary',
      title: `Selected graph neighborhood (${selectedGraph.nodes.length} node(s))`,
      reason: 'Bounded graph neighborhood around the primary focus node.',
      evidenceRefs: [],
      warnings: selectedGraph.warnings,
    })
  }

  if (selectedSource.slices.length > 0) {
    extraRequiredContext.push({
      id: 'ctx-selected-source-summary',
      kind: 'selected-source-summary',
      title: `Selected source evidence (${selectedSource.slices.length} slice(s))`,
      reason: 'Bounded, content-free source slices around the primary focus and selected graph neighborhood.',
      evidenceRefs: selectedSource.slices.map((slice) => ({ path: `${slice.filePath}:${slice.startLine}-${slice.endLine}` })),
      warnings: selectedSource.warnings,
    })
  }

  if (classificationSummary.available) {
    extraRequiredContext.push({
      id: 'ctx-classification-summary',
      kind: 'classification-summary',
      title: 'Classification edit-guidance summary',
      reason: 'Edit-guidance, readiness, risk, and uncertainty evidence for the primary focus and candidates.',
      evidenceRefs: [],
      classificationRefs: classificationSummary.refs,
      classificationRoles: classificationSummary.roles.length > 0 ? [] : undefined,
      warnings: classificationSummary.warnings,
    })
  }

  if (conflicts.status === 'conflict') {
    extraRequiredContext.push({
      id: 'ctx-conflict-summary',
      kind: 'conflict-summary',
      title: `Static context conflict (${conflicts.conflicts.length})`,
      reason: conflicts.conflicts.map((conflict) => conflict.reason).join(' '),
      evidenceRefs: conflicts.conflicts.flatMap((conflict) => conflict.affectedFiles.map((path) => ({ path }))),
      warnings: conflicts.conflicts.map((conflict) => conflict.recommendedNextAction),
    })
  }

  const extraOptionalSupportContext: ContextEntry[] = []
  for (const node of selectedGraph.nodes.slice(1)) {
    extraOptionalSupportContext.push({
      id: `ctx-selected-graph-secondary-${slugify(node.nodeId)}`,
      kind: 'selected-graph-summary',
      title: `Secondary graph neighbor: ${node.label}`,
      reason: 'Secondary graph evidence supporting, but not required for, the primary focus.',
      evidenceRefs: [],
      warnings: [],
    })
  }
  for (const slice of selectedSource.slices.slice(1)) {
    extraOptionalSupportContext.push({
      id: `ctx-selected-source-secondary-${slugify(slice.id)}`,
      kind: 'selected-source-summary',
      title: `Secondary source slice: ${slice.filePath}:${slice.startLine}-${slice.endLine}`,
      reason: 'Secondary source evidence supporting, but not required for, the primary focus.',
      evidenceRefs: [{ path: `${slice.filePath}:${slice.startLine}-${slice.endLine}` }],
      warnings: slice.warnings,
    })
  }
  if (semanticSummary.available) {
    extraOptionalSupportContext.push({
      id: 'ctx-semantic-summary',
      kind: 'semantic-summary',
      title: 'Semantic role summary',
      reason: 'Compact semantic role and artifact-ref evidence for the focus, graph, and candidates.',
      evidenceRefs: [],
      warnings: semanticSummary.warnings,
    })
  }

  return { extraRequiredContext, extraOptionalSupportContext }
}

function assembleDroppedContext(options: {
  candidateFiles: ReturnType<typeof rankCandidateFiles>
  candidateNodes: ReturnType<typeof rankCandidateNodes>
  selectedGraph: ReturnType<typeof selectGraphNeighborhood>
  selectedSource: ReturnType<typeof selectSourceSlices>
  selectedSourceBundles: ReturnType<typeof selectSourceBundles>
}): DroppedContextEntry[] {
  const { candidateFiles, selectedGraph, selectedSource, selectedSourceBundles } = options
  const dropped: DroppedContextEntry[] = []

  for (const file of candidateFiles.filter((candidate) => !candidate.retained)) {
    dropped.push({
      id: `ctx-dropped-candidate-${slugify(file.path)}`,
      kind: 'artifact-summary',
      title: `Dropped candidate file: ${file.path}`,
      reason: file.droppedReason ?? 'Dropped candidate file.',
    })
  }

  if (selectedGraph.omittedNodeCount > 0 || selectedGraph.omittedEdgeCount > 0) {
    dropped.push({
      id: 'ctx-dropped-graph-evidence',
      kind: 'selected-graph-summary',
      title: `Dropped graph evidence (${selectedGraph.omittedNodeCount} node(s), ${selectedGraph.omittedEdgeCount} edge(s))`,
      reason: 'Graph nodes/edges beyond --max-graph-nodes/--max-graph-edges were omitted.',
    })
  }

  for (const skipped of selectedSource.skipped) {
    dropped.push({
      id: `ctx-dropped-source-${slugify(skipped.id)}`,
      kind: 'selected-source-summary',
      title: `Dropped source target: ${skipped.id}`,
      reason: skipped.reason,
    })
  }

  if (selectedSourceBundles.omittedBundleCount > 0) {
    dropped.push({
      id: 'ctx-dropped-source-bundle',
      kind: 'selected-source-summary',
      title: 'Dropped source bundle',
      reason: selectedSourceBundles.warnings.join(' ') || 'Source bundle construction was omitted.',
    })
  }

  return dropped
}

function slugify(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
}

function runSearch(options: {
  resolved: ReturnType<typeof readIndexManifest>
  symbolIndex: SymbolIndex
  codeGraph: CodeGraph
  normalizedQuery: string
  hasTerms: boolean
}): RankingInput {
  if (!options.hasTerms) {
    return { status: 'no-terms', results: [], warnings: ['Query produced no searchable terms.'] }
  }
  try {
    const result = searchIndex({
      resolved: options.resolved,
      symbolIndex: options.symbolIndex,
      codeGraph: options.codeGraph,
      query: options.normalizedQuery,
      limit: SEARCH_INTERNAL_LIMIT,
    })
    return { status: 'ok', results: result.results, warnings: [] }
  } catch (error) {
    return { status: 'search-failed', results: [], warnings: [`Search failed: ${(error as Error).message}`] }
  }
}

function validateOptions(options: ContextCommandOptions): void {
  if (!options.index) throw new Error('The context command requires --index <dir>.')
  if (!options.query || options.query.trim() === '') {
    throw new Error('The context command requires --query <text>.')
  }
  if (!options.out) throw new Error('The context command requires --out <path>.')
  if (!VALID_MODES.includes(options.mode as ContextCapsuleMode)) {
    throw new Error(`Invalid --mode "${options.mode}". Expected one of: ${VALID_MODES.join(', ')}.`)
  }
}

function parsePositiveInt(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got "${value}".`)
  }
  return parsed
}
