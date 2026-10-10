import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from '../graph/codeGraphTypes.js'
import type { FrontendSemanticArtifact, FrontendFileResult } from '../frontend/frontendTypes.js'
import type { FileSummary, SymbolDefinition, SymbolIndex } from '../symbol-index/types.js'
import { isFixtureLike, isGeneratedLike, isTestScoped } from '../classification/classificationHelpers.js'
import { resolveRelativeSpecifier } from '../languages/typescript/resolveRelativeSpecifier.js'
import { normalizeSearchQuery, rankSearchResults } from './rankSearchResults.js'
import type {
  SearchCandidate,
  SearchCandidateField,
  SearchIndexInput,
  SearchIndexResult,
  SearchOwnershipEvidence,
  SearchOwnershipTier,
  SearchResultItem,
  SearchResultOwnership,
} from './searchTypes.js'

const DEFAULT_LIMIT = 20

const WEIGHTS = {
  path: 8,
  label: 6,
  symbolName: 12,
  symbolKind: 4,
  import: 5,
  export: 10,
  edgeKind: 3,
  nodeId: 4,
  neighbor: 2,
  semanticRole: 7,
  semanticSubtype: 6,
  semanticSource: 2,
  semanticArtifactRef: 3,
  frontendValue: 14,
  classificationRole: 7,
  classificationEditGuidance: 3,
  androidComponentRole: 7,
  androidMetadata: 6,
} as const

const EDGE_WEIGHTS = {
  nodeId: 1,
  neighbor: 1,
} as const

export function searchIndex(input: SearchIndexInput): SearchIndexResult {
  validateArtifacts(input.symbolIndex, input.codeGraph)
  const normalizedTerms = normalizeSearchQuery(input.query)
  if (normalizedTerms.length === 0) throw new Error('Search query must include at least one non-empty term.')

  const limit = input.limit ?? DEFAULT_LIMIT
  const candidates = buildCandidates(input.symbolIndex, input.codeGraph, input.frontendArtifact ?? null)
  const ownershipMode = input.intent === 'ownership'
  // Ownership mode ranks the complete relevant pool (same scoring, no new weights) and applies `limit` only after tiering.
  const rankedResults = rankSearchResults({
    candidates,
    query: input.query,
    normalizedTerms,
    limit: ownershipMode ? Math.max(candidates.length, 1) : limit,
  })
  const recovery = ownershipMode ? recoverOwnerCandidates(rankedResults, candidates, input.symbolIndex, input.codeGraph) : null
  const results = recovery ? applyOwnershipTiers(recovery).slice(0, limit) : rankedResults

  const searchedFileIds = new Set<string>()
  const searchedSymbolIds = new Set<string>()
  for (const candidate of candidates) {
    if (candidate.item.kind === 'file') searchedFileIds.add(candidate.item.id)
    if (candidate.item.kind === 'symbol') searchedSymbolIds.add(candidate.item.id)
  }

  return {
    artifactKind: 'my-dev-kit-v1-search-result',
    version: '1.0.0',
    createdAt: input.createdAt ?? new Date().toISOString(),
    indexDir: input.resolved.indexDir,
    query: input.query,
    normalizedTerms,
    limit,
    results,
    summary: {
      resultCount: results.length,
      searchedFileCount: searchedFileIds.size,
      searchedSymbolCount: searchedSymbolIds.size,
      searchedEdgeCount: input.codeGraph.edges.length,
    },
    artifactPaths: {
      manifest: input.resolved.manifestPath,
      symbolIndex: input.resolved.artifactPaths.symbolIndex,
      codeGraph: input.resolved.artifactPaths.codeGraph,
    },
    warnings: recovery?.warnings ?? [],
    ...(ownershipMode ? { intent: 'ownership' as const } : {}),
  }
}

const OWNERSHIP_TIER_RANK: Record<SearchOwnershipTier, number> = {
  'direct-owner': 0,
  'production-candidate': 1,
  'supporting-evidence': 2,
}

/** Edit-guidance values that already assert a target is not a production owner. */
const NON_OWNER_EDIT_GUIDANCE = new Set<string>(['test-only', 'docs-only', 'generated-do-not-edit'])

const DOCS_ONLY_PATH_PATTERN = /(^|[\/])docs?[\/]|\.(md|mdx|markdown|rst|adoc|txt)$/i

/** v1.12.6 Batch 2 fixed recovery bounds. */
const MAX_OWNER_SEED_FILES = 20
const MAX_RECOVERED_FILES_PER_SEED = 16
const MAX_RECOVERED_FILES_OVERALL = 128

/** Directed, one-hop relationship support for one result id (never persisted, never lexical). */
interface OwnerSupport {
  seedPaths: Set<string>
  maxSeedScore: number
  evidence: SearchOwnershipEvidence[]
  /** File targets are ordered and promoted by support; same-file symbols carry provenance evidence only. */
  affectsRanking: boolean
}

interface OwnerRecovery {
  items: SearchResultItem[]
  support: Map<string, OwnerSupport>
  /** Indexed files that contain at least one symbol with its own non-path lexical evidence. */
  relevantSymbolFiles: Set<string>
  warnings: string[]
}

interface OwnerSeed {
  path: string
  id: string
  score: number
}

/**
 * v1.12.6 Batch 2: bounded, evidence-backed owner recovery over the already-ranked lexical pool.
 * Path: lexically matching seed file -> directly depended-on indexed file -> same-file symbols.
 * Sources are limited to indexed file dependencies, `imports`/`depends-on` file edges and
 * `FileSummary.imports` specifiers resolved against the indexed path inventory; there is no
 * transitive hop. Lexical `score`/`matchReasons` are never modified.
 */
function recoverOwnerCandidates(
  ranked: SearchResultItem[],
  candidates: SearchCandidate[],
  symbolIndex: SymbolIndex,
  codeGraph: CodeGraph,
): OwnerRecovery {
  const filesByPath = new Map(symbolIndex.files.map((file) => [file.path, file]))
  const knownPaths = new Set(filesByPath.keys())
  const candidateById = new Map(candidates.map((candidate) => [candidate.item.id, candidate]))
  const rankedById = new Map(ranked.map((item) => [item.id, item]))

  const relevantSymbolFiles = new Set<string>()
  const rankedSymbolsByPath = new Map<string, SearchResultItem[]>()
  for (const item of ranked) {
    if (item.kind !== 'symbol' || item.path === undefined) continue
    const list = rankedSymbolsByPath.get(item.path) ?? []
    list.push(item)
    rankedSymbolsByPath.set(item.path, list)
    if (hasIndependentSymbolEvidence(item)) relevantSymbolFiles.add(item.path)
  }

  // Seeds: distinct lexically matching indexed files, strongest result first.
  const seeds: OwnerSeed[] = []
  const seenSeedPaths = new Set<string>()
  let omittedSeedCount = 0
  for (const item of ranked) {
    if ((item.kind !== 'file' && item.kind !== 'symbol') || item.path === undefined) continue
    if (!knownPaths.has(item.path) || seenSeedPaths.has(item.path)) continue
    seenSeedPaths.add(item.path)
    if (seeds.length < MAX_OWNER_SEED_FILES) seeds.push({ path: item.path, id: item.id, score: item.score })
    else omittedSeedCount += 1
  }

  const dependencies = buildDirectDependencies(symbolIndex, codeGraph, knownPaths)
  const eligibleFileCache = new Map<string, boolean>()
  const isEligibleFile = (filePath: string): boolean => {
    const cached = eligibleFileCache.get(filePath)
    if (cached !== undefined) return cached
    const candidate = candidateById.get(fileNodeId(filePath))
    const eligible = candidate !== undefined && isProductionOwnerEligible({ ...candidate.item, score: 0, matchReasons: [] })
    eligibleFileCache.set(filePath, eligible)
    return eligible
  }

  const support = new Map<string, OwnerSupport>()
  const recoveredPaths = new Set<string>()
  const suppressedPaths = new Set<string>()
  const addSupport = (id: string, seed: OwnerSeed, evidence: SearchOwnershipEvidence[], affectsRanking: boolean): void => {
    const entry = support.get(id) ?? { seedPaths: new Set<string>(), maxSeedScore: 0, evidence: [], affectsRanking }
    entry.seedPaths.add(seed.path)
    entry.maxSeedScore = Math.max(entry.maxSeedScore, seed.score)
    entry.evidence.push(...evidence)
    support.set(id, entry)
  }

  for (const seed of seeds) {
    const targets = new Map<string, { dependency: boolean; specifier?: string }>()
    for (const to of dependencies.get(seed.path) ?? []) targets.set(to, { dependency: true })
    for (const specifier of filesByPath.get(seed.path)?.imports ?? []) {
      const resolved = resolveRelativeSpecifier(seed.path, specifier, knownPaths)
      if (resolved === null || resolved === seed.path) continue
      const existing = targets.get(resolved)
      if (existing === undefined) targets.set(resolved, { dependency: false, specifier })
      else if (existing.specifier === undefined) existing.specifier = specifier
    }

    const eligibleTargets = [...targets.keys()].filter(isEligibleFile).sort((a, b) => a.localeCompare(b))
    for (const dropped of eligibleTargets.slice(MAX_RECOVERED_FILES_PER_SEED)) suppressedPaths.add(dropped)
    for (const target of eligibleTargets.slice(0, MAX_RECOVERED_FILES_PER_SEED)) {
      if (!recoveredPaths.has(target)) {
        if (recoveredPaths.size >= MAX_RECOVERED_FILES_OVERALL) {
          suppressedPaths.add(target)
          continue
        }
        recoveredPaths.add(target)
      }
      const how = targets.get(target)!
      const evidence: SearchOwnershipEvidence[] = []
      if (how.dependency) evidence.push({ kind: 'indexed-file-dependency', sourceId: seed.id, seedPath: seed.path, targetPath: target })
      if (how.specifier !== undefined) {
        evidence.push({ kind: 'resolved-relative-import', sourceId: seed.id, seedPath: seed.path, targetPath: target, specifier: how.specifier })
      }
      addSupport(fileNodeId(target), seed, evidence, true)
      // Same-file association only: symbols with their own non-path lexical evidence; no invented references.
      for (const symbol of rankedSymbolsByPath.get(target) ?? []) {
        if (!hasIndependentSymbolEvidence(symbol)) continue
        addSupport(symbol.id, seed, [{ kind: 'same-file-symbol', sourceId: seed.id, seedPath: seed.path, targetPath: target }], false)
      }
    }
  }

  const items = [...ranked]
  for (const target of [...recoveredPaths].sort((a, b) => a.localeCompare(b))) {
    const id = fileNodeId(target)
    if (rankedById.has(id)) continue
    const candidate = candidateById.get(id)
    if (candidate === undefined) continue
    items.push({ ...candidate.item, score: 0, matchReasons: [] })
  }

  const warnings: string[] = []
  const stillSuppressed = [...suppressedPaths].filter((filePath) => !recoveredPaths.has(filePath))
  if (stillSuppressed.length > 0 || omittedSeedCount > 0) {
    const parts: string[] = []
    if (stillSuppressed.length > 0) {
      parts.push(
        `${stillSuppressed.length} supported candidate file(s) omitted by recovery bounds (${MAX_RECOVERED_FILES_PER_SEED} per seed, ${MAX_RECOVERED_FILES_OVERALL} overall)`,
      )
    }
    if (omittedSeedCount > 0) {
      parts.push(`${omittedSeedCount} lexically matching seed file(s) beyond the ${MAX_OWNER_SEED_FILES}-seed bound were not expanded`)
    }
    warnings.push(`Ownership recovery is bounded and not exhaustive: ${parts.join('; ')}.`)
  }

  return { items, support, relevantSymbolFiles, warnings }
}

/** Direct, directed file dependencies between indexed files only: `fileDeps` plus file-to-file `imports`/`depends-on` edges. */
function buildDirectDependencies(symbolIndex: SymbolIndex, codeGraph: CodeGraph, knownPaths: Set<string>): Map<string, Set<string>> {
  const dependencies = new Map<string, Set<string>>()
  const add = (from: string, to: string): void => {
    if (from === to || !knownPaths.has(from) || !knownPaths.has(to)) return
    const set = dependencies.get(from) ?? new Set<string>()
    set.add(to)
    dependencies.set(from, set)
  }
  for (const dep of symbolIndex.graph?.fileDeps ?? []) add(dep.from, dep.to)
  const prefix = 'file:'
  for (const edge of codeGraph.edges) {
    if (edge.kind !== 'imports' && edge.kind !== 'depends-on') continue
    if (!edge.source.startsWith(prefix) || !edge.target.startsWith(prefix)) continue
    add(edge.source.slice(prefix.length), edge.target.slice(prefix.length))
  }
  return dependencies
}

/** A symbol's own relevance beyond the shared file path or its node id (both merely restate the file). */
function hasIndependentSymbolEvidence(item: SearchResultItem): boolean {
  return item.matchReasons.some((reason) => reason.field !== 'path' && reason.field !== 'nodeId')
}

/**
 * Attaches ownership tiers and orders by tier, then highest contributing seed score, then the candidate's own
 * lexical score, then distinct supporting seed count (so broadly imported helpers never outrank a more directly
 * relevant file on seed breadth alone), then kind/path/id. Items without support have zero seed score and count,
 * so their relative order is exactly the Batch 1 order. `score` and `matchReasons` are never modified.
 */
function applyOwnershipTiers(recovery: OwnerRecovery): SearchResultItem[] {
  return recovery.items
    .map((item) => ({ ...item, ownership: classifyOwnership(item, recovery.support.get(item.id), recovery.relevantSymbolFiles) }))
    .sort((a, b) => {
      const supportA = rankingSupport(recovery.support.get(a.id))
      const supportB = rankingSupport(recovery.support.get(b.id))
      return (
        OWNERSHIP_TIER_RANK[a.ownership.tier] - OWNERSHIP_TIER_RANK[b.ownership.tier] ||
        (supportB?.maxSeedScore ?? 0) - (supportA?.maxSeedScore ?? 0) ||
        b.score - a.score ||
        (supportB?.seedPaths.size ?? 0) - (supportA?.seedPaths.size ?? 0) ||
        a.kind.localeCompare(b.kind) ||
        (a.path ?? a.id).localeCompare(b.path ?? b.id) ||
        a.id.localeCompare(b.id)
      )
    })
}

function rankingSupport(support: OwnerSupport | undefined): OwnerSupport | undefined {
  return support?.affectsRanking === true ? support : undefined
}

function classifyOwnership(item: SearchResultItem, support?: OwnerSupport, relevantSymbolFiles?: Set<string>): SearchResultOwnership {
  const evidence: SearchOwnershipEvidence[] = []
  let tier: SearchOwnershipTier = 'supporting-evidence'

  if (isProductionOwnerEligible(item)) {
    if (item.kind === 'symbol' && item.matchReasons.some((reason) => reason.field === 'symbolName')) {
      evidence.push({ kind: 'direct-symbol-name', sourceId: item.id })
    }
    if ((item.classificationRoles ?? []).some((role) => role.editGuidance === 'safe-primary-edit-target')) {
      evidence.push({ kind: 'classified-primary-edit', sourceId: item.id })
    }
    if (evidence.length > 0) {
      tier = 'direct-owner'
    } else {
      tier = 'production-candidate'
      // A zero-score recovered file has no lexical match to report.
      if (item.matchReasons.length > 0) evidence.push({ kind: 'production-lexical-match', sourceId: item.id })
    }

    if (support !== undefined) {
      evidence.push(...support.evidence)
      // Promotion applies to recovered file targets only: a direct seed link plus the file's own lexical
      // relevance (or one of its symbols'), or independent support from two distinct seeds. Same-file symbols
      // keep their own tier so one imported file never promotes all of its symbols equally.
      if (support.affectsRanking) {
        const ownRelevance = item.score > 0 || (item.path !== undefined && relevantSymbolFiles?.has(item.path) === true)
        if (ownRelevance || support.seedPaths.size >= 2) tier = 'direct-owner'
      }
    }
  }

  return { tier, lexicalScore: item.score, evidence }
}

function isProductionOwnerEligible(item: SearchResultItem): boolean {
  if (item.kind !== 'file' && item.kind !== 'symbol') return false
  const filePath = item.path
  if (filePath === undefined) return false
  if (isTestScoped(filePath) || isFixtureLike(filePath) || isGeneratedLike(filePath) || DOCS_ONLY_PATH_PATTERN.test(filePath)) {
    return false
  }
  return !(item.classificationRoles ?? []).some((role) => NON_OWNER_EDIT_GUIDANCE.has(role.editGuidance))
}

function buildCandidates(symbolIndex: SymbolIndex, codeGraph: CodeGraph, frontendArtifact: FrontendSemanticArtifact | null): SearchCandidate[] {
  const candidates = new Map<string, SearchCandidate>()
  const nodesById = new Map(codeGraph.nodes.map((node) => [node.id, node]))

  for (const node of codeGraph.nodes) {
    if (isSearchableNode(node)) {
      mergeCandidate(candidates, nodeCandidate(node))
    } else if (isAndroidGraphNode(node)) {
      mergeCandidate(candidates, androidNodeCandidate(node))
    }
  }

  for (const file of symbolIndex.files) {
    mergeCandidate(candidates, fileCandidate(file))
    for (const symbol of file.symbols) {
      mergeCandidate(candidates, symbolCandidate(file, symbol))
    }
  }

  for (const dep of symbolIndex.graph?.fileDeps ?? []) {
    mergeCandidate(candidates, {
      item: {
        kind: 'file',
        id: fileNodeId(dep.from),
        label: dep.from,
        path: dep.from,
        nodeId: fileNodeId(dep.from),
      },
      fields: [
        field('neighbor', dep.to, WEIGHTS.neighbor),
        field('edgeKind', dep.kind, WEIGHTS.edgeKind),
      ],
    })
  }

  for (const edge of codeGraph.edges) {
    mergeCandidate(candidates, edgeCandidate(edge, nodesById))
  }

  // Enrich with frontend semantic facts when available
  if (frontendArtifact) {
    for (const c of frontendFileCandidates(frontendArtifact)) {
      mergeCandidate(candidates, c)
    }
  }

  return [...candidates.values()].sort((a, b) => a.item.kind.localeCompare(b.item.kind) || a.item.id.localeCompare(b.item.id))
}

function frontendFileCandidates(artifact: FrontendSemanticArtifact): SearchCandidate[] {
  const result: SearchCandidate[] = []
  for (const fileResult of artifact.files) {
    const frontendFields = buildFrontendValueFields(fileResult)
    if (frontendFields.length === 0) continue
    result.push({
      item: {
        kind: 'file',
        id: fileNodeId(fileResult.filePath),
        label: fileResult.filePath,
        path: fileResult.filePath,
        nodeId: fileNodeId(fileResult.filePath),
      },
      fields: frontendFields,
    })
  }
  return result
}

function buildFrontendValueFields(fileResult: FrontendFileResult): SearchCandidateField[] {
  const fields: SearchCandidateField[] = []
  const seen = new Set<string>()

  function addValue(value: string | null | undefined): void {
    if (!value || seen.has(value)) return
    seen.add(value)
    fields.push(field('frontendValue', value, WEIGHTS.frontendValue))
  }

  for (const ui of fileResult.uiStrings) addValue(ui.value)
  for (const block of fileResult.testBlocks) addValue(block.title)
  for (const loc of fileResult.locators) addValue(loc.value)
  for (const route of fileResult.routeStrings) addValue(route.value)
  for (const comp of fileResult.components) addValue(comp.name)

  return fields
}

function isSearchableNode(node: CodeGraphNode): node is CodeGraphNode & { kind: 'file' | 'symbol' } {
  return node.kind === 'file' || node.kind === 'symbol'
}

/** `android-*` node kinds are eligible for generic `search --query`/`context` candidate ranking (v1.10.0 Batch 6), reusing the same generic search engine rather than a second retrieval path. */
function isAndroidGraphNode(node: CodeGraphNode): boolean {
  return node.kind.startsWith('android-')
}

function nodeCandidate(node: CodeGraphNode & { kind: 'file' | 'symbol' }): SearchCandidate {
  const fields: SearchCandidateField[] = [
    field('nodeId', node.id, WEIGHTS.nodeId),
    field('label', node.label, WEIGHTS.label),
  ]
  if (node.path) fields.push(field('path', node.path, WEIGHTS.path))
  if (node.symbolName) fields.push(field('symbolName', node.symbolName, WEIGHTS.symbolName))
  if (node.symbolKind) fields.push(field('symbolKind', node.symbolKind, WEIGHTS.symbolKind))
  if (node.exported && node.symbolName) fields.push(field('export', node.symbolName, WEIGHTS.export))
  fields.push(...semanticFields(node.semanticRoles, node.artifactRefs))
  fields.push(...classificationFields(node.classificationRoles))
  fields.push(...androidComponentFields(node.androidComponentRoles))

  return {
    item: {
      kind: node.kind,
      id: node.id,
      label: node.label,
      path: node.path,
      nodeId: node.id,
      semanticRoles: node.semanticRoles,
      artifactRefs: node.artifactRefs,
      classificationRoles: node.classificationRoles,
      classificationRefs: node.classificationRefs,
      androidComponentRoles: node.androidComponentRoles,
      androidComponentRefs: node.androidComponentRefs,
    },
    fields,
  }
}

/** Compact candidate for a Batch 5 `android-*` code-graph node: label + androidMetadata values only, never a full artifact record (v1.10.0 Batch 6).
 * v1.12.0 Batch 6 correction: also projects `classificationRoles`/`classificationRefs` when the code-graph node carries them (e.g. `android-test-class`/`android-generated-build-path` nodes classified `test-only`/`generated-file`) -
 * without this, a compact `android-*` node's classification was silently invisible to generic `search --query`/`context` candidate ranking even though it is present on the underlying graph node and already exposed by `search --android-role`. */
function androidNodeCandidate(node: CodeGraphNode): SearchCandidate {
  const fields: SearchCandidateField[] = [
    field('nodeId', node.id, WEIGHTS.nodeId),
    field('label', node.label, WEIGHTS.label),
  ]
  if (node.path) fields.push(field('path', node.path, WEIGHTS.path))
  for (const value of Object.values(node.androidMetadata ?? {})) {
    if (typeof value === 'string' && value.length > 0) fields.push(field('androidMetadata', value, WEIGHTS.androidMetadata))
  }
  fields.push(...classificationFields(node.classificationRoles))

  return {
    item: {
      kind: node.kind,
      id: node.id,
      label: node.label,
      path: node.path,
      nodeId: node.id,
      androidArtifactId: node.androidArtifactId,
      androidMetadata: node.androidMetadata,
      classificationRoles: node.classificationRoles,
      classificationRefs: node.classificationRefs,
    },
    fields,
  }
}

function fileCandidate(file: FileSummary): SearchCandidate {
  return {
    item: {
      kind: 'file',
      id: fileNodeId(file.path),
      label: file.path,
      path: file.path,
      nodeId: fileNodeId(file.path),
    },
    fields: [
      field('path', file.path, WEIGHTS.path),
      ...file.imports.map((value) => field('import', value, WEIGHTS.import)),
      ...file.exports.map((value) => field('export', value, WEIGHTS.export)),
    ],
  }
}

function symbolCandidate(file: FileSummary, symbol: SymbolDefinition): SearchCandidate {
  const fields = [
    field('path', file.path, WEIGHTS.path),
    field('symbolName', symbol.name, WEIGHTS.symbolName),
    field('symbolKind', symbol.kind, WEIGHTS.symbolKind),
  ]
  if (symbol.exported) fields.push(field('export', symbol.name, WEIGHTS.export))
  if (symbol.signature) fields.push(field('label', symbol.signature, WEIGHTS.label))
  fields.push(...semanticFields(symbol.semanticRoles, symbol.artifactRefs))
  fields.push(...classificationFields(symbol.classificationRoles))
  fields.push(...androidComponentFields(symbol.androidComponentRoles))

  return {
    item: {
      kind: 'symbol',
      id: symbolNodeId(file.path, symbol.name),
      label: symbol.name,
      path: file.path,
      nodeId: symbolNodeId(file.path, symbol.name),
      semanticRoles: symbol.semanticRoles,
      artifactRefs: symbol.artifactRefs,
      classificationRoles: symbol.classificationRoles,
      classificationRefs: symbol.classificationRefs,
      androidComponentRoles: symbol.androidComponentRoles,
      androidComponentRefs: symbol.androidComponentRefs,
    },
    fields,
  }
}

function edgeCandidate(edge: CodeGraphEdge, nodesById: Map<string, CodeGraphNode>): SearchCandidate {
  const source = nodesById.get(edge.source)
  const target = nodesById.get(edge.target)
  const label = edge.label ?? edge.kind

  return {
    item: {
      kind: 'edge',
      id: edge.id,
      label: `${edge.source} --${label}--> ${edge.target}`,
      edge: {
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
      },
    },
    fields: [
      field('edgeKind', edge.kind, WEIGHTS.edgeKind),
      field('edgeKind', label, WEIGHTS.edgeKind),
      field('nodeId', edge.id, EDGE_WEIGHTS.nodeId),
      field('neighbor', edge.source, EDGE_WEIGHTS.neighbor),
      field('neighbor', edge.target, EDGE_WEIGHTS.neighbor),
      ...(source?.path ? [field('neighbor', source.path, EDGE_WEIGHTS.neighbor)] : []),
      ...(target?.path ? [field('neighbor', target.path, EDGE_WEIGHTS.neighbor)] : []),
      ...(source?.label ? [field('neighbor', source.label, EDGE_WEIGHTS.neighbor)] : []),
      ...(target?.label ? [field('neighbor', target.label, EDGE_WEIGHTS.neighbor)] : []),
    ],
  }
}

function mergeCandidate(candidates: Map<string, SearchCandidate>, candidate: SearchCandidate): void {
  const key = `${candidate.item.kind}:${candidate.item.id}`
  const existing = candidates.get(key)
  if (!existing) {
    candidates.set(key, candidate)
    return
  }

  existing.fields.push(...candidate.fields)
  existing.item.label = existing.item.label || candidate.item.label
  existing.item.path = existing.item.path ?? candidate.item.path
  existing.item.nodeId = existing.item.nodeId ?? candidate.item.nodeId
  existing.item.edge = existing.item.edge ?? candidate.item.edge
}

function field(fieldName: SearchCandidateField['field'], text: string, weight: number): SearchCandidateField {
  return { field: fieldName, text, weight }
}

function semanticFields(
  semanticRoles: CodeGraphNode['semanticRoles'] | SymbolDefinition['semanticRoles'],
  artifactRefs: CodeGraphNode['artifactRefs'] | SymbolDefinition['artifactRefs'],
): SearchCandidateField[] {
  const fields: SearchCandidateField[] = []
  for (const role of semanticRoles ?? []) {
    fields.push(field('semanticRole', role.role, WEIGHTS.semanticRole))
    if (role.subtype) fields.push(field('semanticSubtype', role.subtype, WEIGHTS.semanticSubtype))
    if (role.source) fields.push(field('semanticSource', role.source, WEIGHTS.semanticSource))
    fields.push(...artifactRefFields(role.artifactRefs))
  }
  fields.push(...artifactRefFields(artifactRefs))
  return fields
}

/** Mirrors semanticFields() for the compact classificationRoles projection (role + editGuidance only - searchable). */
function classificationFields(
  classificationRoles: CodeGraphNode['classificationRoles'] | SymbolDefinition['classificationRoles']
): SearchCandidateField[] {
  const fields: SearchCandidateField[] = []
  for (const role of classificationRoles ?? []) {
    fields.push(field('classificationRole', role.role, WEIGHTS.classificationRole))
    fields.push(field('classificationEditGuidance', role.editGuidance, WEIGHTS.classificationEditGuidance))
  }
  return fields
}

/** Mirrors classificationFields() for the compact androidComponentRoles projection (role label only - searchable). */
function androidComponentFields(
  androidComponentRoles: CodeGraphNode['androidComponentRoles'] | SymbolDefinition['androidComponentRoles']
): SearchCandidateField[] {
  const fields: SearchCandidateField[] = []
  for (const role of androidComponentRoles ?? []) {
    fields.push(field('androidComponentRole', role.role, WEIGHTS.androidComponentRole))
  }
  return fields
}

function artifactRefFields(artifactRefs: CodeGraphNode['artifactRefs'] | SymbolDefinition['artifactRefs']): SearchCandidateField[] {
  const fields: SearchCandidateField[] = []
  for (const ref of artifactRefs ?? []) {
    fields.push(field('semanticArtifactRef', ref.artifact, WEIGHTS.semanticArtifactRef))
    if (ref.artifactKind) fields.push(field('semanticArtifactRef', ref.artifactKind, WEIGHTS.semanticArtifactRef))
    fields.push(field('semanticArtifactRef', ref.id, WEIGHTS.semanticArtifactRef))
    if (ref.path) fields.push(field('semanticArtifactRef', ref.path, WEIGHTS.semanticArtifactRef))
  }
  return fields
}

function validateArtifacts(symbolIndex: SymbolIndex, codeGraph: CodeGraph): void {
  if (!symbolIndex || typeof symbolIndex !== 'object' || !Array.isArray(symbolIndex.files)) {
    throw new Error('Invalid symbol index artifact: files must be an array.')
  }
  if (!codeGraph || typeof codeGraph !== 'object' || !Array.isArray(codeGraph.nodes) || !Array.isArray(codeGraph.edges)) {
    throw new Error('Invalid code graph artifact: nodes and edges must be arrays.')
  }
}

function fileNodeId(filePath: string): string {
  return `file:${filePath}`
}

function symbolNodeId(filePath: string, name: string): string {
  return `symbol:${filePath}#${name}`
}
