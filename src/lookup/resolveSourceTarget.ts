import type { CodeGraph, CodeGraphNode } from '../graph/codeGraphTypes.js'
import type { SemanticEvidenceRef, SemanticRole } from '../semantics/index.js'
import type { SymbolIndex, SymbolDefinition } from '../symbol-index/types.js'
import type { SourceTarget } from './sourceSliceTypes.js'

export function resolveFileNodeTarget(graph: CodeGraph, nodeId: string, maxLines: number): SourceTarget {
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
  if (node.kind === 'symbol') {
    const filePath = node.path ?? parseSymbolNodeId(node.id).filePath
    const symbolName = node.symbolName ?? parseSymbolNodeId(node.id).symbolName
    if (!filePath || !symbolName) throw new Error(`Symbol node does not include retrievable source metadata: ${nodeId}`)
    return {
      mode: 'symbol',
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

export function resolveSymbolTarget(symbolIndex: SymbolIndex, filePath: string, symbolName: string, maxLines: number): SourceTarget {
  const file = symbolIndex.files.find((candidate) => candidate.path === normalize(filePath))
  if (!file) throw new Error(`File is not present in the current symbol index: ${filePath}`)
  const symbol = file.symbols.find((candidate) => candidate.name === symbolName)
  if (!symbol) throw new Error(`Symbol not found in ${filePath}: ${symbolName}`)
  if (!symbol.location || typeof symbol.location.line !== 'number') {
    throw new Error('Symbol was found, but source location is not available in the current symbol index.')
  }

  const endLine = Math.min(file.lineCount, symbol.location.line + Math.min(maxLines, 20) - 1)
  return {
    mode: 'symbol',
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
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) throw new Error(`Node not found: ${nodeId}`)
  return node
}

function parseSymbolNodeId(nodeId: string): { filePath: string | null; symbolName: string | null } {
  if (!nodeId.startsWith('symbol:')) return { filePath: null, symbolName: null }
  const body = nodeId.slice('symbol:'.length)
  const marker = body.lastIndexOf('#')
  if (marker < 0) return { filePath: null, symbolName: null }
  return { filePath: body.slice(0, marker), symbolName: body.slice(marker + 1) }
}

function normalize(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}
