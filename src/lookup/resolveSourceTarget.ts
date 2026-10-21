import type { CodeGraph, CodeGraphNode } from '../graph/codeGraphTypes.js'
import type { SemanticEvidenceRef, SemanticRole } from '../semantics/index.js'
import type { SymbolIndex, SymbolDefinition } from '../symbol-index/types.js'
import type { SourceTarget } from './sourceSliceTypes.js'
import { declarationNodeId, parseDeclarationNodeId } from '../symbol-index/declarationIdentity.js'

export class AmbiguousSymbolError extends Error {
  readonly code = 'AMBIGUOUS_SYMBOL'
  readonly candidates: Array<{ nodeId: string; filePath: string; name: string; qualifiedName?: string; ownerKey?: string; startLine: number; endLine?: number }>
  constructor(filePath: string, symbols: SymbolDefinition[], lineCount: number) {
    super(`AMBIGUOUS_SYMBOL: Multiple declarations match in ${filePath}; use an exact node ID.`)
    this.candidates = symbols.map((symbol) => ({
      nodeId: declarationNodeId(filePath, symbol), filePath, name: symbol.name,
      ...(symbol.qualifiedName !== undefined ? { qualifiedName: symbol.qualifiedName } : {}),
      ...(symbol.ownerKey !== undefined ? { ownerKey: symbol.ownerKey } : {}),
      startLine: symbol.location.line,
      ...(trustedEnd(symbol, lineCount) !== undefined ? { endLine: symbol.location.endLine } : {}),
    })).sort((a, b) => a.nodeId.localeCompare(b.nodeId) || a.startLine - b.startLine).slice(0, 20)
  }
}

function trustedEnd(symbol: SymbolDefinition, lineCount: number): number | undefined {
  const { line, endLine } = symbol.location
  return Number.isInteger(line) && line >= 1 && typeof endLine === 'number' && Number.isInteger(endLine) && endLine >= line && endLine <= lineCount ? endLine : undefined
}

export function resolveFileNodeTarget(graph: CodeGraph, nodeId: string, maxLines: number): SourceTarget {
  if (nodeId.startsWith('symbolq:')) parseDeclarationNodeId(nodeId)
  const node = findNode(graph, nodeId)
  if (node.kind === 'file') {
    if (!node.path) throw new Error(`File node does not include a source path: ${nodeId}`)
    return {
      mode: 'node',
      filePath: node.path,
      startLine: 1,
      endLine: maxLines,
      warnings: ['File node retrieval returns a capped preview, not the whole file.'],
    }
  }
  if (node.kind === 'framework-route' && node.path && Number.isInteger(node.line) && node.line! > 0) {
    return { mode: 'node', nodeId: node.id, filePath: node.path, startLine: node.line!, endLine: node.line! + Math.max(1, Math.min(maxLines, 12)) - 1, warnings: ['Framework route source is a bounded declaration excerpt; the declaration end is unknown.'] }
  }
  if ((node.kind === 'rust-module' || node.kind === 'rust-target' || node.kind === 'rust-impl') && node.path && Number.isInteger(node.line) && node.line! > 0) {
    const startLine = node.line!
    const end = node.rustMetadata?.endLine
    return { mode: 'node', nodeId: node.id, filePath: node.path, startLine, endLine: Math.min(end !== undefined && end >= startLine ? end : startLine + 11, startLine + maxLines - 1), warnings: ['Rust structural source is observed syntax; external module declarations do not prove a module body in this file.'] }
  }
  if (node.kind === 'symbol') {
    const filePath = node.path ?? parseSymbolNodeId(node.id).filePath
    const symbolName = node.symbolName ?? parseSymbolNodeId(node.id).symbolName
    if (!filePath || !symbolName) throw new Error(`Symbol node does not include retrievable source metadata: ${nodeId}`)
    return {
      mode: 'symbol',
      nodeId: node.id,
      qualifiedName: node.qualifiedName,
      ownerKey: node.ownerKey,
      filePath,
      symbolName,
      semanticRoles: node.semanticRoles,
      artifactRefs: node.artifactRefs,
      evidenceRefs: collectEvidenceRefs(node.semanticRoles),
      classificationRoles: node.classificationRoles,
      classificationRefs: node.classificationRefs,
      androidComponentRoles: node.androidComponentRoles,
      androidComponentRefs: node.androidComponentRefs,
      warnings: [],
    }
  }
  if (ANDROID_LINE_RETRIEVABLE_KINDS.has(node.kind) && node.path) {
    const startLine = node.line ?? 1
    const window = Math.max(1, Math.min(maxLines, ANDROID_DEFAULT_WINDOW))
    // Batch 1/2/3's Compose nodes record their own declaration/fact `endLine`
    // in `androidMetadata` (v1.11.0 Batch 4) — prefer that exact bound over
    // the generic fixed window so a multi-line composable isn't cut short.
    const metadataEndLine = typeof node.androidMetadata?.endLine === 'number' ? node.androidMetadata.endLine : null
    const endLine =
      metadataEndLine !== null && metadataEndLine >= startLine
        ? Math.min(metadataEndLine, startLine + maxLines - 1)
        : startLine + window - 1
    return {
      mode: 'node',
      filePath: node.path,
      startLine,
      endLine,
      warnings: [
        'Android artifact-backed node retrieval returns a bounded excerpt near the declaration line, not the full file and not a proven runtime range.',
      ],
    }
  }

  throw new Error('Node is not a source-retrievable file or symbol node.')
}

/** `android-*` node kinds whose Batch 5/Batch 4 (v1.11.0) code-graph projection carries a `path`/`line` pointing at their own static declaration. Module/source-set/permission nodes are excluded: they have no single retrievable declaration site. */
const ANDROID_LINE_RETRIEVABLE_KINDS = new Set([
  'android-manifest-file',
  'android-manifest-component',
  'android-intent-filter',
  'android-resource-file',
  'android-resource-definition',
  'android-navigation-graph',
  'android-navigation-destination',
  'android-navigation-action',
  'android-navigation-deep-link',
  'android-compose-route',
  'android-composable',
  'android-compose-fact',
  'android-test-file',
  'android-test-class',
  'android-test-method',
  'android-test-fact',
])

const ANDROID_DEFAULT_WINDOW = 12

export function resolveSymbolTarget(symbolIndex: SymbolIndex, filePath: string, symbolName: string, maxLines: number, nodeId?: string): SourceTarget {
  if (nodeId?.startsWith('symbolq:')) parseDeclarationNodeId(nodeId)
  const file = symbolIndex.files.find((candidate) => candidate.path === normalize(filePath))
  if (!file) throw new Error(`File is not present in the current symbol index: ${filePath}`)
  const matches = file.symbols.filter((candidate) => candidate.name === symbolName && (nodeId === undefined || declarationNodeId(file.path, candidate) === nodeId))
  if (matches.length > 1) throw new AmbiguousSymbolError(file.path, matches, file.lineCount)
  const symbol = matches[0]
  if (!symbol) throw new Error(`Symbol not found in ${filePath}: ${symbolName}`)
  if (!symbol.location || typeof symbol.location.line !== 'number') {
    throw new Error('Symbol was found, but source location is not available in the current symbol index.')
  }

  const startLine = symbol.location.line
  const indexedEnd = symbol.location.endLine
  // A boundary is trusted only when it is a valid integer span inside the indexed file; anything else
  // (absent, malformed, inverted, beyond the file, invalid start) keeps the conservative preview.
  const boundaryKnown =
    Number.isInteger(startLine) &&
    startLine >= 1 &&
    typeof indexedEnd === 'number' &&
    Number.isInteger(indexedEnd) &&
    indexedEnd >= startLine &&
    indexedEnd <= file.lineCount

  if (boundaryKnown) {
    return {
      mode: 'symbol',
      nodeId: declarationNodeId(file.path, symbol),
      qualifiedName: symbol.qualifiedName,
      ownerKey: symbol.ownerKey,
      filePath: file.path,
      symbolName: symbol.name,
      startLine,
      endLine: Math.min(indexedEnd, startLine + maxLines - 1),
      symbolEndLine: indexedEnd,
      semanticRoles: symbol.semanticRoles,
      artifactRefs: symbol.artifactRefs,
      evidenceRefs: collectEvidenceRefs(symbol.semanticRoles),
      classificationRoles: symbol.classificationRoles,
      classificationRefs: symbol.classificationRefs,
      androidComponentRoles: symbol.androidComponentRoles,
      androidComponentRefs: symbol.androidComponentRefs,
      warnings: [],
    }
  }

  const endLine = Math.min(file.lineCount, symbol.location.line + Math.min(maxLines, 20) - 1)
  return {
    mode: 'symbol',
    nodeId: declarationNodeId(file.path, symbol),
    qualifiedName: symbol.qualifiedName,
    ownerKey: symbol.ownerKey,
    filePath: file.path,
    symbolName: symbol.name,
    startLine: symbol.location.line,
    endLine,
    semanticRoles: symbol.semanticRoles,
    artifactRefs: symbol.artifactRefs,
    evidenceRefs: collectEvidenceRefs(symbol.semanticRoles),
    classificationRoles: symbol.classificationRoles,
    classificationRefs: symbol.classificationRefs,
    androidComponentRoles: symbol.androidComponentRoles,
    androidComponentRefs: symbol.androidComponentRefs,
    warnings: ['Symbol location has a start line only; returning a small bounded preview from that line.'],
  }
}

function collectEvidenceRefs(semanticRoles: SemanticRole[] | undefined): SemanticEvidenceRef[] | undefined {
  const refs: SemanticEvidenceRef[] = []
  const seen = new Set<string>()
  for (const role of semanticRoles ?? []) {
    for (const ref of role.evidenceRefs ?? []) {
      const key = JSON.stringify(ref)
      if (seen.has(key)) continue
      seen.add(key)
      refs.push(ref)
    }
  }
  return refs.length > 0 ? refs : undefined
}

function findNode(graph: CodeGraph, nodeId: string): CodeGraphNode {
  const matches = graph.nodes.filter((candidate) => candidate.id === nodeId)
  if (matches.length > 1) throw new Error(`Ambiguous graph node identity: ${nodeId}`)
  const node = matches[0]
  if (!node) throw new Error(`Node not found: ${nodeId}`)
  return node
}

function parseSymbolNodeId(nodeId: string): { filePath: string | null; symbolName: string | null } {
  return parseDeclarationNodeId(nodeId) ?? { filePath: null, symbolName: null }
}

function normalize(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}
