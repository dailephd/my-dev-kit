import type { CodeGraph, CodeGraphNode } from '../graph/codeGraphTypes.js'
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
    return { mode: 'symbol', filePath, symbolName, warnings: [] }
  }
  throw new Error('Node is not a source-retrievable file or symbol node.')
}

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
    warnings: ['Symbol location has a start line only; returning a small bounded preview from that line.'],
  }
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
