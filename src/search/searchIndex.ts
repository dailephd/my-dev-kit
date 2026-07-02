import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from '../graph/codeGraphTypes.js'
import type { FrontendSemanticArtifact, FrontendFileResult } from '../frontend/frontendTypes.js'
import type { FileSummary, SymbolDefinition, SymbolIndex } from '../symbol-index/types.js'
import { normalizeSearchQuery, rankSearchResults } from './rankSearchResults.js'
import type { SearchCandidate, SearchCandidateField, SearchIndexInput, SearchIndexResult } from './searchTypes.js'

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
  const results = rankSearchResults({
    candidates,
    query: input.query,
    normalizedTerms,
    limit,
  })

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
    warnings: [],
  }
}

function buildCandidates(symbolIndex: SymbolIndex, codeGraph: CodeGraph, frontendArtifact: FrontendSemanticArtifact | null): SearchCandidate[] {
  const candidates = new Map<string, SearchCandidate>()
  const nodesById = new Map(codeGraph.nodes.map((node) => [node.id, node]))

  for (const node of codeGraph.nodes) {
    if (!isSearchableNode(node)) continue
    mergeCandidate(candidates, nodeCandidate(node))
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
