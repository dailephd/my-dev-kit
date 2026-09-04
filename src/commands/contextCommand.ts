import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Command } from 'commander'
import { toForwardSlash } from '../io/pathUtils.js'
import { readIndexManifest } from '../indexing/readIndexManifest.js'
import { readRequiredJson } from '../indexing/loadIndexArtifacts.js'
import { buildContextCapsule, computeContextAdequacy, writeContextCapsule } from '../context/contextCapsule.js'
import { buildRetrievalAuditRecord, writeRetrievalAuditRecord } from '../context/retrievalAuditRecord.js'
import { buildRawEvidenceIndexIdentity } from '../context/rawEvidenceIdentity.js'
import { assertRawEvidenceParity } from '../context/rawEvidenceParity.js'
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
import { loadContextRequestFile, normalizeContextRequest } from '../context/contextRequestNormalization.js'
import { resolveFocusIntake } from '../context/focusResolution.js'
import { buildChangedSurface } from '../context/changedSurface.js'
import { applyRoleAwareCandidates } from '../context/roleCandidates.js'
import { buildEvidenceGroups } from '../context/evidenceGroups.js'
import { detectAndroidIntents } from '../context/androidContextIntent.js'
import { normalizeResponsibilityRefs, buildResponsibilityMappings } from '../context/responsibilityMapping.js'
import { classifyFreshness } from '../context/contextFreshness.js'
import { buildBudget, buildTruncation } from '../context/contextBudget.js'
import { buildFullFileFallbacks, type FullFileFallbackCandidate } from '../context/fullFileFallback.js'
import { evaluateRoleAdequacy } from '../context/contextRoleAdequacy.js'
import { buildProvenanceRecords, buildChangedSurfaceProvenance, mergeProvenanceRecords } from '../context/contextProvenance.js'
import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { SymbolIndex } from '../symbol-index/types.js'
import type { FrontendSemanticArtifact } from '../frontend/frontendTypes.js'
import type { ResolvedIndexManifest } from '../indexing/readIndexManifest.js'
import type {
  AuditStep,
  ContextCapsuleLimits,
  ContextEntry,
  DroppedContextEntry,
} from '../context/types.js'

const SEARCH_INTERNAL_LIMIT = 50

interface ContextCommandOptions {
  index: string
  query?: string
  out?: string
  auditOut?: string
  mode: string
  role?: string
  request?: string
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
    .option('--role <role>', 'stage-specific context role: architecture, implementation, or test-implementation')
    .option('--request <path>', 'structured ContextRequest JSON file; merges with other flags (additive, v1.10.1)')
    .option('--max-candidate-files <n>', 'cap retained candidate files', parsePositiveInt)
    .option('--max-source-slices <n>', 'cap selected source slices around the focus and graph neighborhood', parsePositiveInt)
    .option('--max-graph-nodes <n>', 'cap selected graph nodes around the focus', parsePositiveInt)
    .option('--max-graph-edges <n>', 'cap selected graph edges around the focus', parsePositiveInt)
    .option('--no-source', 'disable bounded source slices and source bundles')
    .option('--json', 'print JSON output')
    .action((options: ContextCommandOptions, command: Command) => {
      const cliLimits: ContextCapsuleLimits = {
        maxCandidateFiles: options.maxCandidateFiles ?? null,
        maxSourceSlices: options.maxSourceSlices ?? null,
        maxGraphNodes: options.maxGraphNodes ?? null,
        maxGraphEdges: options.maxGraphEdges ?? null,
      }

      const loadedRequest = options.request ? loadContextRequestFile(options.request) : null

      const normalized = normalizeContextRequest({
        cli: {
          query: options.query,
          queryExplicit: options.query !== undefined,
          index: options.index,
          indexExplicit: command.getOptionValueSource('index') === 'cli',
          mode: options.mode,
          modeExplicit: command.getOptionValueSource('mode') === 'cli',
          role: options.role,
          roleExplicit: options.role !== undefined,
          out: options.out,
          outExplicit: options.out !== undefined,
          auditOut: options.auditOut,
          auditOutExplicit: options.auditOut !== undefined,
        },
        limits: cliLimits,
        loaded: loadedRequest,
      })

      const mode = normalized.mode
      const limits = normalized.limits

      const steps: AuditStep[] = []
      steps.push({
        id: 'step-validate-inputs',
        kind: 'validate-inputs',
        description: 'Validated required and optional command inputs.',
        inputs: {
          index: normalized.index,
          mode,
          out: normalized.out,
          auditOut: normalized.auditOut ?? null,
          role: normalized.role,
          requestFilePath: normalized.requestFilePath,
        },
        outputs: {},
        status: 'ok',
        warnings: [],
      })

      const resolved = readIndexManifest(normalized.index)
      const rawEvidenceIdentity = buildRawEvidenceIndexIdentity(resolved)
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

      const queryPlan = buildQueryPlan({ originalQuery: normalized.query, mode })
      steps.push({
        id: 'step-normalize-query',
        kind: 'normalize-query',
        description: 'Normalized the query string.',
        inputs: { originalQuery: normalized.query },
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

      // v1.12.0 Batch 6: bounded, deterministic internal Android task-intent
      // detection - never a new CLI option or ContextRequest field (section 40).
      const androidIntents = detectAndroidIntents(queryPlan.normalizedQuery, queryPlan.terms.raw)

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

      let candidateFiles = rankCandidateFiles(rankingInput, limits.maxCandidateFiles, mode)
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

      let candidateNodes = rankCandidateNodes(rankingInput, mode)
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

      // --- v1.10.1 Batch 2: role-aware candidate generation and changed-surface ranking ---

      const focusIntake = resolveFocusIntake({
        focusFiles: normalized.focusFiles,
        focusSymbols: normalized.focusSymbols,
        symbolIndex,
        codeGraph,
      })
      steps.push({
        id: 'step-resolve-focus',
        kind: 'resolve-focus',
        description: 'Resolved explicit focusFiles/focusSymbols against the active index.',
        inputs: { focusFileCount: normalized.focusFiles.length, focusSymbolCount: normalized.focusSymbols.length },
        outputs: {
          unresolvedFocusFileCount: focusIntake.unresolvedFocusFiles.length,
          unresolvedFocusSymbolCount: focusIntake.unresolvedFocusSymbols.length,
          ambiguousFocusSymbolCount: focusIntake.ambiguousFocusSymbols.length,
        },
        status: normalized.focusFiles.length + normalized.focusSymbols.length > 0 ? 'ok' : 'skipped',
        warnings: focusIntake.warnings,
      })

      const changedSurface = buildChangedSurface({
        changedFiles: normalized.changedFiles,
        changedSymbols: normalized.changedSymbols,
        beforeIndex: normalized.beforeIndex,
        afterIndex: normalized.afterIndex,
      })
      steps.push({
        id: 'step-merge-changed-surface',
        kind: 'merge-changed-surface',
        description: 'Merged caller-supplied changedFiles/changedSymbols with an optional beforeIndex/afterIndex graph diff.',
        inputs: {
          changedFileCount: normalized.changedFiles.length,
          changedSymbolCount: normalized.changedSymbols.length,
          beforeIndex: normalized.beforeIndex,
          afterIndex: normalized.afterIndex,
          diffRequested: changedSurface.diffRequested,
        },
        outputs: {
          mergedFileCount: changedSurface.files.length,
          mergedSymbolCount: changedSurface.symbols.length,
          conflictCount: changedSurface.conflicts.length,
        },
        status: changedSurface.available || changedSurface.diffRequested ? 'ok' : 'skipped',
        warnings: [...changedSurface.warnings, ...changedSurface.conflicts],
      })

      const roleRanked = applyRoleAwareCandidates({
        role: normalized.role,
        candidateFiles,
        candidateNodes,
        focusIntake,
        changedSurface,
        requestedEvidenceKinds: normalized.requestedEvidenceKinds,
        codeGraph,
        maxCandidateFiles: limits.maxCandidateFiles,
        androidIntents,
      })
      candidateFiles = roleRanked.candidateFiles
      candidateNodes = roleRanked.candidateNodes
      steps.push({
        id: 'step-apply-role-ranking',
        kind: 'apply-role-ranking',
        description: 'Applied role-aware ranking adjustments and bounded focus/changed-surface candidate injection.',
        inputs: { role: normalized.role },
        outputs: {
          candidateFileCount: candidateFiles.length,
          candidateNodeCount: candidateNodes.length,
          unsupportedRequestedEvidenceKindCount: roleRanked.unsupportedRequestedEvidenceKinds.length,
        },
        status: normalized.role ? 'ok' : 'skipped',
        warnings: roleRanked.warnings,
      })

      const roleContext = {
        role: normalized.role,
        focus: focusIntake,
        changedSurface,
        requestedEvidenceKinds: normalized.requestedEvidenceKinds,
        unsupportedRequestedEvidenceKinds: roleRanked.unsupportedRequestedEvidenceKinds,
        warnings: [...focusIntake.warnings, ...changedSurface.warnings, ...changedSurface.conflicts, ...roleRanked.warnings],
      }

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

      // --- v1.10.1 Batch 3: evidence groups and bounded test-infrastructure discovery ---
      // (Distinct from the "Batch 3" comment below, which refers to the older v1.6 source-
      // evidence batch numbering; this section is new in v1.10.1.)

      const repoRoot = symbolIndex.repoRoot
      const evidenceResult = buildEvidenceGroups({
        role: normalized.role,
        candidateFiles,
        candidateNodes,
        focusIntake,
        changedSurface,
        requestedEvidenceKinds: normalized.requestedEvidenceKinds,
        codeGraph,
        symbolIndex,
        selectedGraph,
        repoRoot,
        androidIntents,
        evidenceGroupEntries: normalized.requestLimits?.evidenceGroupEntries,
      })
      steps.push({
        id: 'step-build-evidence-groups',
        kind: 'build-evidence-groups',
        description: 'Constructed deterministic, bounded, role-scoped evidence groups from role-ranked candidates, the selected graph neighborhood, and the changed-surface model.',
        inputs: { role: normalized.role },
        outputs: {
          groupCount: evidenceResult.groups.length,
          selectedOwnerCount: evidenceResult.selectedOwners.length,
          selectedContractCount: evidenceResult.selectedContracts.length,
          selectedTestCount: evidenceResult.selectedTests.length,
        },
        status: normalized.role ? 'ok' : 'skipped',
        warnings: evidenceResult.warnings,
      })
      steps.push({
        id: 'step-discover-test-infrastructure',
        kind: 'discover-test-infrastructure',
        description: 'Discovered bounded, conservative evidence of existing related tests, fixtures, factories, mocks, setup files, and test configuration.',
        inputs: {
          requestedTestInfrastructure: normalized.requestedEvidenceKinds.includes('test-infrastructure'),
        },
        outputs: {
          relatedTestCount: evidenceResult.testInfrastructure.relatedTests.length,
          fixtureCount: evidenceResult.testInfrastructure.fixtures.length,
          factoryCount: evidenceResult.testInfrastructure.factories.length,
          mockCount: evidenceResult.testInfrastructure.mocks.length,
          setupFileCount: evidenceResult.testInfrastructure.setupFiles.length,
          testConfigurationCount: evidenceResult.testInfrastructure.testConfigurations.length,
        },
        status: evidenceResult.testInfrastructure.testConfigurations.length > 0 || evidenceResult.testInfrastructure.relatedTests.length > 0 || evidenceResult.testInfrastructure.unresolved.length > 0 ? 'ok' : 'skipped',
        warnings: evidenceResult.testInfrastructure.warnings,
      })
      steps.push({
        id: 'step-derive-test-commands',
        kind: 'derive-test-commands',
        description: 'Derived grounded, targeted test commands (or reported them unresolved) from package.json scripts and discovered related tests.',
        inputs: {
          requestedTestCommands: normalized.requestedEvidenceKinds.includes('test-commands'),
        },
        outputs: {
          testCommandCount: evidenceResult.testInfrastructure.testCommands.length,
          packageScriptCount: evidenceResult.testInfrastructure.packageScripts.length,
        },
        status: evidenceResult.testInfrastructure.testCommands.length > 0 ? 'ok' : 'skipped',
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

      const classificationArtifact = loadClassificationArtifact(normalized.index, resolved.manifest)
      const classificationSummary = buildClassificationSummary({
        classificationArtifact,
        indexDir: normalized.index,
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

      const conflicts = detectContextConflicts({
        focus,
        candidateNodes,
        codeGraph,
        androidIntents,
        role: normalized.role,
        classificationSummary,
      })
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

      // --- v1.10.1 Batch 4: responsibility mapping, role adequacy, freshness, budget,
      // truncation, full-file fallback, and provenance ---

      const changedSymbolItems = changedSurface.symbols.map((s) => ({
        id: s.symbolId,
        itemKind: 'symbol' as const,
        symbolId: s.symbolId,
        nodeId: s.symbolId,
        ...(s.filePath ? { path: s.filePath, sourceLocation: { filePath: s.filePath } } : {}),
        relationship: s.status,
        basis: `changed-surface (${s.provenance})`,
        provenance: s.provenance,
      }))
      const focusSymbolItems = focusIntake.focusSymbols
        .filter((entry) => entry.resolved && !entry.ambiguous)
        .flatMap((entry) => entry.matchedNodeIds)
        .map((nodeId) => {
          const node = codeGraph.nodes.find((n) => n.id === nodeId)
          return {
            id: nodeId,
            itemKind: 'symbol' as const,
            symbolId: nodeId,
            nodeId,
            ...(node?.path ? { path: node.path, sourceLocation: { filePath: node.path } } : {}),
            relationship: 'explicit-focus-symbol',
            basis: 'caller-supplied focusSymbols entry',
            provenance: 'request',
          }
        })

      const responsibilityInputs = normalizeResponsibilityRefs(normalized.testResponsibilityRefs)
      const requestedResponsibilityMappings = normalized.requestedEvidenceKinds.includes('responsibility-mappings')
      const responsibilityMappings = buildResponsibilityMappings({
        role: normalized.role,
        responsibilityInputs,
        hasSuppliedResponsibilities: normalized.testResponsibilityRefs.length > 0,
        requestedResponsibilityMappings,
        requireTestCommandEvidence: normalized.requestedEvidenceKinds.includes('test-commands'),
        evidenceGroups: evidenceResult.groups,
        selectedOwners: evidenceResult.selectedOwners,
        selectedContracts: evidenceResult.selectedContracts,
        selectedTests: evidenceResult.selectedTests,
        testInfrastructure: evidenceResult.testInfrastructure,
        changedSymbolItems,
        focusSymbolItems,
        limit: normalized.requestLimits?.responsibilityMappings ?? null,
      })
      steps.push({
        id: 'step-map-responsibilities',
        kind: 'map-responsibilities',
        description: 'Built deterministic responsibility-to-evidence mappings from testResponsibilityRefs and existing role-aware evidence.',
        inputs: {
          responsibilityCount: normalized.testResponsibilityRefs.length,
          requestedResponsibilityMappings,
        },
        outputs: {
          mappedCount: responsibilityMappings.mappings.filter((m) => m.mappingStatus === 'mapped').length,
          partiallyMappedCount: responsibilityMappings.mappings.filter((m) => m.mappingStatus === 'partially-mapped').length,
          unmappedCount: responsibilityMappings.mappings.filter((m) => m.mappingStatus === 'unmapped').length,
          unknownResponsibilityCount: responsibilityMappings.unknownResponsibilityIds.length,
        },
        status: responsibilityMappings.operational ? 'ok' : 'skipped',
        warnings: responsibilityMappings.warnings,
      })

      const freshness = classifyFreshness({
        role: normalized.role,
        activeIndexPath: normalized.index,
        beforeIndexPath: normalized.beforeIndex,
        afterIndexPath: normalized.afterIndex,
        diffRequested: changedSurface.diffRequested,
        changedSurface,
        repoRoot,
      })
      steps.push({
        id: 'step-classify-freshness',
        kind: 'classify-freshness',
        description: 'Classified context freshness (fresh/stale/unknown) from active-index, before/after-index, and changed-surface evidence.',
        inputs: { diffRequested: changedSurface.diffRequested },
        outputs: { state: freshness.state },
        status: 'ok',
        warnings: freshness.warnings,
      })

      const budget = buildBudget({
        legacyLimits: limits,
        requestLimits: normalized.requestLimits,
        retention,
        selectedSource,
        selectedSourceBundles,
        evidenceGroups: evidenceResult.groups,
        groupTruncation: evidenceResult.groupTruncation,
        responsibilityMappings,
      })
      const truncation = buildTruncation({
        evidenceGroups: evidenceResult.groups,
        groupTruncation: evidenceResult.groupTruncation,
        responsibilityMappings,
        roleConditionCoverage: evidenceResult.roleConditionCoverage,
      })
      steps.push({
        id: 'step-apply-budget',
        kind: 'apply-budget',
        description: 'Reported declared-vs-used limit usage and explicit truncation/required-evidence-loss.',
        inputs: {},
        outputs: { truncatedGroupCount: truncation.records.length, characterBudgetTruncated: budget.characters?.truncated ?? false },
        status: 'ok',
        warnings: [...budget.warnings, ...truncation.warnings],
      })

      // Full-file fallback candidates: contract/validator/error evidence a responsibility
      // mapping relied on whose file is not already covered by a selected source slice.
      const coveredFilePaths = new Set(selectedSource.slices.map((s) => s.filePath))
      const fallbackCandidatesByPath = new Map<string, FullFileFallbackCandidate>()
      for (const mapping of responsibilityMappings.mappings) {
        if (mapping.mappingStatus === 'mapped') continue
        for (const item of [...mapping.contracts, ...mapping.validators, ...mapping.errors]) {
          if (!item.path || coveredFilePaths.has(item.path)) continue
          const existing = fallbackCandidatesByPath.get(item.path)
          fallbackCandidatesByPath.set(item.path, {
            filePath: item.path,
            reason: `Contract/validator/error evidence for responsibility "${mapping.responsibilityId}" was not covered by any bounded source slice.`,
            requestedEvidenceKind: 'contracts',
            responsibilityIdsAffected: [...new Set([...(existing?.responsibilityIdsAffected ?? []), mapping.responsibilityId])].sort(),
          })
        }
      }
      const fullFileFallback = buildFullFileFallbacks({
        role: normalized.role,
        repoRoot,
        candidates: [...fallbackCandidatesByPath.values()],
        alreadyCoveredFilePaths: coveredFilePaths,
        limit: normalized.requestLimits?.fullFileFallbacks,
      })

      const roleAdequacy = evaluateRoleAdequacy({
        role: normalized.role,
        baseAdequacy: contextAdequacy,
        evidenceGroups: evidenceResult.groups,
        selectedOwners: evidenceResult.selectedOwners,
        selectedContracts: evidenceResult.selectedContracts,
        selectedTests: evidenceResult.selectedTests,
        testInfrastructure: evidenceResult.testInfrastructure,
        changedSurface,
        requestedEvidenceKindsRequireTestInfra: normalized.requestedEvidenceKinds.includes('test-infrastructure'),
        requestedEvidenceKindsRequireTestCommands: normalized.requestedEvidenceKinds.includes('test-commands'),
        responsibilityMappings,
        freshness,
        truncation,
        roleConditionCoverage: evidenceResult.roleConditionCoverage,
      })
      steps.push({
        id: 'step-evaluate-adequacy',
        kind: 'evaluate-adequacy',
        description: 'Evaluated role-specific adequacy, extending the existing contextAdequacy verdict without replacing it.',
        inputs: { role: normalized.role },
        outputs: { status: roleAdequacy.status, blockingConditionCount: roleAdequacy.blockingConditions.length },
        status: normalized.role ? 'ok' : 'skipped',
        warnings: roleAdequacy.warnings,
      })

      const provenance = mergeProvenanceRecords([
        buildProvenanceRecords([
          { items: evidenceResult.selectedOwners, role: normalized.role, requestField: null, derivedByModule: 'evidenceGroups.ts' },
          { items: evidenceResult.selectedContracts, role: normalized.role, requestField: null, derivedByModule: 'evidenceGroups.ts' },
          { items: evidenceResult.selectedTests, role: normalized.role, requestField: null, derivedByModule: 'evidenceGroups.ts' },
          { items: evidenceResult.testInfrastructure.relatedTests, role: normalized.role, requestField: null, derivedByModule: 'testInfrastructureDiscovery.ts' },
        ]),
        buildChangedSurfaceProvenance(changedSurface, normalized.role),
        ...responsibilityMappings.mappings.map((m) => m.provenance),
      ])
      steps.push({
        id: 'step-record-provenance',
        kind: 'record-provenance',
        description: 'Merged deterministic, deduplicated evidence provenance across owners, contracts, tests, changed surface, and responsibility mappings.',
        inputs: {},
        outputs: { provenanceRecordCount: provenance.length },
        status: 'ok',
        warnings: [],
      })

      const capsule = buildContextCapsule({
        resolved,
        identity: rawEvidenceIdentity,
        originalQuery: normalized.query,
        mode,
        requestedOutputPath: normalized.out,
        role: normalized.role,
        requestFilePath: normalized.requestFilePath,
        deferredRequestFields: normalized.deferredFields,
        requestWarnings: [...normalized.warnings, ...roleContext.warnings, ...evidenceResult.warnings],
        roleContext,
        evidenceGroups: evidenceResult.groups,
        selectedOwners: evidenceResult.selectedOwners,
        selectedContracts: evidenceResult.selectedContracts,
        selectedTests: evidenceResult.selectedTests,
        testInfrastructure: evidenceResult.testInfrastructure,
        unresolvedItems: evidenceResult.unresolvedItems,
        groupTruncation: evidenceResult.groupTruncation,
        roleConditionCoverage: evidenceResult.roleConditionCoverage,
        responsibilityMappings,
        roleAdequacy,
        freshness,
        budget,
        truncation,
        fullFileFallback,
        provenance,
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

      const plannedCapsulePath = toForwardSlash(path.resolve(normalized.out))
      steps.push({
        id: 'step-write-context-capsule',
        kind: 'write-context-capsule',
        description: 'Wrote the context capsule artifact.',
        inputs: { outputPath: normalized.out },
        outputs: { writtenPath: plannedCapsulePath },
        status: 'ok',
        warnings: [],
      })

      let auditRecord: ReturnType<typeof buildRetrievalAuditRecord> | null = null
      if (normalized.auditOut) {
        auditRecord = buildRetrievalAuditRecord({
          identity: rawEvidenceIdentity,
          request: capsule.request,
          warnings: [...normalized.warnings, ...roleContext.warnings, ...evidenceResult.warnings],
          roleContext,
          // v1.10.1 Batch 4: pass the real computed adequacy/responsibility/freshness/budget/
          // truncation/fallback/provenance through to the audit record. (Narrow earlier-batch
          // defect fix: `contextAdequacy` was previously never passed here, so the audit
          // record's contextAdequacy was always a hardcoded Batch-1 stub regardless of the
          // capsule's real verdict; see final report section 44.22.)
          contextAdequacy: capsule.contextAdequacy,
          responsibilityMappings: capsule.responsibilityMappings,
          roleConditionCoverage: capsule.roleConditionCoverage,
          roleAdequacy: capsule.roleAdequacy,
          freshness: capsule.freshness,
          budget: capsule.budget,
          truncation: capsule.truncation,
          fullFileFallback: capsule.fullFileFallback,
          provenance: capsule.provenance,
          steps: [
            ...steps,
            {
              id: 'step-write-retrieval-audit-record',
              kind: 'write-retrieval-audit-record',
              description: 'Wrote the retrieval audit record artifact.',
              inputs: { outputPath: normalized.auditOut },
              outputs: {},
              status: 'ok',
              warnings: [],
            },
          ],
        })
        assertRawEvidenceParity(capsule, auditRecord)
      }

      const writtenCapsulePath = writeContextCapsule(normalized.out, capsule)
      const writtenAuditPath =
        normalized.auditOut && auditRecord
          ? writeRetrievalAuditRecord(normalized.auditOut, auditRecord)
          : null

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

function parsePositiveInt(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got "${value}".`)
  }
  return parsed
}
