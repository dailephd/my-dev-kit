import * as fs from 'node:fs'
import * as path from 'node:path'
import { toForwardSlash } from '../io/pathUtils.js'
import type { ResolvedIndexManifest } from '../indexing/readIndexManifest.js'
import { VERSION } from '../version.js'
import type { RawEvidenceIndexIdentity } from './rawEvidenceIdentity.js'
import type {
  ArtifactReferenceSummaryEntry,
  CandidateFile,
  CandidateNode,
  ClassificationSummary,
  ContextAdequacyStatement,
  ContextCapsule,
  ContextCapsuleArtifactRef,
  ContextCapsuleLimits,
  ContextCapsuleMode,
  ContextEntry,
  ContextFocus,
  ContextConflictSummary,
  ContextRole,
  DroppedContextEntry,
  PruningSummary,
  QueryPlan,
  RetentionSummary,
  SelectedGraph,
  SelectedSource,
  SelectedSourceBundles,
  SemanticSummary,
  ModeEffects,
  SourceControl,
  RoleContextSummary,
  EvidenceGroup,
  EvidenceItemRef,
  TestInfrastructureSummary,
  UnresolvedEvidenceItem,
  GroupTruncationEntry,
  RoleConditionCoverage,
  ResponsibilityMappingSummary,
  RoleAdequacyStatement,
  FreshnessSummary,
  BudgetSummary,
  TruncationSummary,
  FullFileFallbackSummary,
  ProvenanceRecord,
} from './types.js'

export interface BuildContextCapsuleOptions {
  resolved: ResolvedIndexManifest
  identity: RawEvidenceIndexIdentity
  originalQuery: string
  mode: ContextCapsuleMode
  requestedOutputPath: string
  /** v1.10.1 Batch 1: stage-specific role, or null for a legacy (no --role/--request role) invocation. */
  role?: ContextRole | null
  /** v1.10.1 Batch 1: forward-slash path to the --request file used, or null/undefined for none. */
  requestFilePath?: string | null
  /** v1.10.1 Batch 1: names of accepted-but-not-yet-operational ContextRequest fields. */
  deferredRequestFields?: string[]
  /** v1.10.1 Batch 1: request-normalization warnings (e.g. deferred-field notices) to merge into capsule.warnings. */
  requestWarnings?: string[]
  /** v1.10.1 Batch 2: operational role/focus/changed-surface summary. */
  roleContext: RoleContextSummary
  /** v1.10.1 Batch 3: deterministic, bounded, role-scoped evidence groups. */
  evidenceGroups: EvidenceGroup[]
  selectedOwners: EvidenceItemRef[]
  selectedContracts: EvidenceItemRef[]
  selectedTests: EvidenceItemRef[]
  testInfrastructure: TestInfrastructureSummary
  unresolvedItems: UnresolvedEvidenceItem[]
  groupTruncation: GroupTruncationEntry[]
  /** v1.10.4 Phase 1: shared post-allocation condition coverage. Optional only
   * for schema-major-1 callers that predate the additive contract. */
  roleConditionCoverage?: RoleConditionCoverage[]
  /** v1.10.1 Batch 4: deterministic responsibility-to-evidence mapping. */
  responsibilityMappings: ResponsibilityMappingSummary
  /** v1.10.1 Batch 4: role-specific adequacy verdict. */
  roleAdequacy: RoleAdequacyStatement
  /** v1.10.1 Batch 4: fresh/stale/unknown classification. */
  freshness: FreshnessSummary
  /** v1.10.1 Batch 4: budget/limit usage rollup. */
  budget: BudgetSummary
  /** v1.10.1 Batch 4: truncation and required-evidence-loss reporting. */
  truncation: TruncationSummary
  /** v1.10.1 Batch 4: bounded, auditable full-file-fallback usage. */
  fullFileFallback: FullFileFallbackSummary
  /** v1.10.1 Batch 4: deterministic, deduplicated evidence provenance. */
  provenance: ProvenanceRecord[]
  limits: ContextCapsuleLimits
  queryPlan: QueryPlan
  candidateFiles: CandidateFile[]
  candidateNodes: CandidateNode[]
  focus: ContextFocus
  selectedGraph: SelectedGraph
  retention: RetentionSummary
  contextAdequacy: ContextAdequacyStatement
  selectedSource: SelectedSource
  selectedSourceBundles: SelectedSourceBundles
  semanticSummary: SemanticSummary
  classificationSummary: ClassificationSummary
  artifactReferenceSummary: ArtifactReferenceSummaryEntry[]
  pruning: PruningSummary
  conflicts: ContextConflictSummary
  modeEffects: ModeEffects
  sourceControl: SourceControl
  extraRequiredContext?: ContextEntry[]
  extraOptionalSupportContext?: ContextEntry[]
  extraDroppedContext?: DroppedContextEntry[]
}

export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ')
}

export function buildArtifactRefs(resolved: ResolvedIndexManifest): ContextCapsuleArtifactRef[] {
  const refs: ContextCapsuleArtifactRef[] = []
  const seenPaths = new Set<string>()

  const addRef = (name: string, artifactPath: string): void => {
    const normalized = toForwardSlash(artifactPath)
    if (seenPaths.has(normalized)) return
    seenPaths.add(normalized)
    refs.push({ name, path: normalized })
  }

  addRef('symbolIndex', resolved.artifactPaths.symbolIndex)
  addRef('codeGraph', resolved.artifactPaths.codeGraph)
  if (resolved.artifactPaths.callGraph) addRef('callGraph', resolved.artifactPaths.callGraph)
  for (const [name, artifactPath] of Object.entries(resolved.semanticArtifactPaths)) {
    if (artifactPath) addRef(name, artifactPath)
  }
  for (const analyzer of resolved.manifest.analyzers ?? []) {
    for (const artifact of analyzer.artifacts ?? []) {
      addRef(artifact.name, path.resolve(resolved.indexDir, artifact.path))
    }
  }
  return refs
}

export function buildContextCapsule(options: BuildContextCapsuleOptions): ContextCapsule {
  const {
    resolved,
    identity,
    originalQuery,
    mode,
    requestedOutputPath,
    role = null,
    requestFilePath = null,
    deferredRequestFields = [],
    requestWarnings = [],
    roleContext,
    evidenceGroups,
    selectedOwners,
    selectedContracts,
    selectedTests,
    testInfrastructure,
    unresolvedItems,
    groupTruncation,
    roleConditionCoverage,
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
    extraRequiredContext = [],
    extraOptionalSupportContext = [],
    extraDroppedContext = [],
  } = options
  const artifactRefs = buildArtifactRefs(resolved)

  const requiredContext: ContextEntry[] = [
    {
      id: 'ctx-request-summary',
      kind: 'request-summary',
      title: 'Request summary',
      reason: 'Captures the literal task query for downstream planning.',
      evidenceRefs: [],
      warnings: [],
    },
    {
      id: 'ctx-index-summary',
      kind: 'index-summary',
      title: 'Index summary',
      reason: 'Confirms which index directory and manifest version were used.',
      evidenceRefs: [{ path: toForwardSlash(resolved.manifestPath) }],
      warnings: [],
    },
  ]

  const optionalSupportContext: ContextEntry[] = artifactRefs.map((ref) => ({
    id: `ctx-artifact-${slugify(ref.name)}`,
    kind: 'artifact-summary',
    title: `Artifact: ${ref.name}`,
    reason: 'Lists an artifact available in this index for later batches to consume.',
    evidenceRefs: [{ path: ref.path }],
    warnings: [],
  }))

  if (requiredContext.length === 0 && optionalSupportContext.length === 0) {
    requiredContext.push({
      id: 'ctx-placeholder',
      kind: 'placeholder',
      title: 'No context available',
      reason: 'No request, index, or artifact summaries could be constructed.',
      evidenceRefs: [],
      warnings: [],
    })
  }

  return {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    tool: { name: 'my-dev-kit', version: VERSION },
    request: {
      originalQuery,
      normalizedQuery: normalizeQuery(originalQuery),
      mode,
      requestedOutputPath: toForwardSlash(requestedOutputPath),
      role,
      requestFilePath,
    },
    index: {
      indexPath: identity.indexPath,
      manifestPath: identity.manifestPath,
      manifestSchemaVersion: identity.manifestSchemaVersion,
      projectRoot: identity.projectRoot,
      artifactRefs,
    },
    limits,
    requiredContext: [...requiredContext, ...extraRequiredContext],
    optionalSupportContext: [...optionalSupportContext, ...extraOptionalSupportContext],
    droppedContext: [...extraDroppedContext],
    warnings: [...resolved.manifest.warnings, ...requestWarnings],
    deferredRequestFields: [...deferredRequestFields].sort((a, b) => a.localeCompare(b)),
    roleContext,
    evidenceGroups,
    selectedOwners,
    selectedContracts,
    selectedTests,
    testInfrastructure,
    unresolvedItems,
    groupTruncation,
    ...(roleConditionCoverage === undefined ? {} : { roleConditionCoverage }),
    responsibilityMappings,
    roleAdequacy,
    freshness,
    budget,
    truncation,
    fullFileFallback,
    provenance,
    contextAdequacy,
    queryPlan,
    candidateFiles,
    candidateNodes,
    focus,
    selectedGraph,
    retention,
    selectedSource,
    selectedSourceBundles,
    semanticSummary,
    classificationSummary,
    artifactReferenceSummary,
    pruning,
    conflicts,
    modeEffects,
    sourceControl,
  }
}

export function computeContextAdequacy(options: {
  focus: ContextFocus
  selectedGraph: SelectedGraph
  selectedSource?: SelectedSource
  classificationSummary?: ClassificationSummary
  conflicts?: ContextConflictSummary
  sourceControl?: SourceControl
}): ContextAdequacyStatement {
  const { focus, selectedGraph, selectedSource, classificationSummary, conflicts, sourceControl } = options

  if (conflicts?.status === 'conflict') {
    return {
      status: 'context conflict found and user or upstream stage decision required',
      summary: 'Static edit-guidance evidence conflicts for the selected focus and a near-tied retained candidate.',
      assumptions: [],
      gaps: conflicts.conflicts.map((conflict) => `${conflict.reason} ${conflict.recommendedNextAction}`),
    }
  }

  if (focus.confidence === 'none') {
    return {
      status: 'context insufficient and more retrieval required',
      summary: 'No candidates matched the query; no focus or graph evidence was selected.',
      assumptions: [],
      gaps: ['No ranked candidates were available for this query.'],
    }
  }

  if (sourceControl?.enabled !== false && selectedSource !== undefined && selectedSource.slices.length === 0) {
    return {
      status: 'context insufficient and more retrieval required',
      summary: 'A primary focus was selected, but no source evidence could be retrieved for it.',
      assumptions: [],
      gaps: ['No source slices could be selected for the retained primary focus.'],
    }
  }

  const sourceSufficient = selectedSource === undefined || selectedSource.slices.length > 0
  const classificationAvailable = classificationSummary === undefined || classificationSummary.available

  const sourceIntentionallyDisabled = sourceControl?.enabled === false
  if (focus.confidence === 'high' && selectedGraph.nodes.length > 1 && (sourceSufficient || sourceIntentionallyDisabled)) {
    if (classificationAvailable) {
      return {
        status: 'context sufficient for implementation',
        summary: 'A single high-confidence focus node, its graph neighborhood, and bounded source evidence were selected.',
        assumptions: sourceIntentionallyDisabled
          ? ['Source evidence was intentionally disabled by --no-source.']
          : selectedSource === undefined
            ? ['Source slices and semantic summaries are not yet included (later v1.6 batches).']
            : [],
        gaps: [],
      }
    }
    return {
      status: 'context sufficient with listed assumptions',
      summary: 'A single high-confidence focus node and its graph and source evidence were selected, but classification metadata is unavailable.',
      assumptions: ['Classification metadata is unavailable for this index.'],
      gaps: [],
    }
  }

  return {
    status: 'context sufficient with listed assumptions',
    summary: 'A best-effort focus node was selected; some ambiguity or thin graph/source/metadata evidence remains.',
    assumptions: [
      ...(selectedSource === undefined ? ['Source slices and semantic summaries are not yet included (later v1.6 batches).'] : []),
      ...(sourceIntentionallyDisabled ? ['Source evidence was intentionally disabled by --no-source.'] : []),
      ...(focus.ambiguityNotes.length > 0 ? ['Focus selection was ambiguous; see focus.ambiguityNotes.'] : []),
      ...(classificationSummary !== undefined && !classificationSummary.available
        ? ['Classification metadata is unavailable for this index.']
        : []),
    ],
    gaps: selectedGraph.nodes.length <= 1 ? ['Graph neighborhood evidence is thin (0-1 nodes).'] : [],
  }
}

export function writeContextCapsule(outputPath: string, capsule: ContextCapsule): string {
  const resolved = path.resolve(outputPath)
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true })
    fs.writeFileSync(resolved, `${JSON.stringify(capsule, null, 2)}\n`, 'utf8')
  } catch (error) {
    throw new Error(`Failed to write context capsule to ${outputPath}: ${(error as Error).message}`)
  }
  return toForwardSlash(resolved)
}

function slugify(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
}
