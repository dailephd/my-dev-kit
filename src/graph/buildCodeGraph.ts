import type { CallGraph, SymbolIndex, SymbolDefinition } from '../symbol-index/types.js'
import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from './codeGraphTypes.js'
import { CODE_GRAPH_SCHEMA_VERSION } from './codeGraphTypes.js'

export interface BuildCodeGraphOptions {
  symbolIndex: SymbolIndex
  callGraph?: CallGraph | null
}

export function buildCodeGraph(options: BuildCodeGraphOptions): CodeGraph {
  const nodes: CodeGraphNode[] = []
  const edges: CodeGraphEdge[] = []
  const symbolIds = new Map<string, string>()

  for (const file of options.symbolIndex.files) {
    const fileId = fileNodeId(file.path)
    nodes.push({
      id: fileId,
      kind: 'file',
      label: basename(file.path),
      path: file.path,
      language: file.language,
    })

    for (const symbol of file.symbols) {
      const symbolId = symbolNodeId(file.path, symbol.name)
      symbolIds.set(symbolKey(file.path, symbol), symbolId)
      nodes.push({
        id: symbolId,
        kind: 'symbol',
        label: symbol.name,
        path: file.path,
        symbolName: symbol.name,
        symbolKind: symbol.kind,
        line: symbol.location.line,
        exported: symbol.exported,
      })
      edges.push({
        id: edgeId(fileId, 'defines', symbolId),
        source: fileId,
        target: symbolId,
        kind: 'defines',
      })
      if (symbol.exported) {
        edges.push({
          id: edgeId(fileId, 'exports', symbolId),
          source: fileId,
          target: symbolId,
          kind: 'exports',
        })
      }
    }
  }

  for (const dep of options.symbolIndex.graph?.fileDeps ?? []) {
    const source = fileNodeId(dep.from)
    const target = fileNodeId(dep.to)
    edges.push({
      id: edgeId(source, 'imports', target),
      source,
      target,
      kind: dep.kind === 'import' ? 'imports' : 'depends-on',
      label: dep.kind,
    })
  }

  for (const call of options.callGraph?.edges ?? []) {
    if (!call.callee.file) continue
    const source = symbolIds.get(`${call.caller.file}#${call.caller.name}@${call.caller.line}`)
    const target = findSymbolId(symbolIds, call.callee.file, call.callee.name)
    if (!source || !target) continue
    edges.push({
      id: `${edgeId(source, 'calls', target)}@${call.callLine}`,
      source,
      target,
      kind: 'calls',
    })
  }

  sortById(nodes)
  sortById(edges)

  const fileNodeCount = nodes.filter((node) => node.kind === 'file').length
  const symbolNodeCount = nodes.filter((node) => node.kind === 'symbol').length

  return {
    artifactKind: 'code-graph',
    schemaVersion: CODE_GRAPH_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    nodes,
    edges,
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      fileNodeCount,
      symbolNodeCount,
    },
  }
}

function fileNodeId(filePath: string): string {
  return `file:${filePath}`
}

function symbolNodeId(filePath: string, name: string): string {
  return `symbol:${filePath}#${name}`
}

function symbolKey(filePath: string, symbol: SymbolDefinition): string {
  return `${filePath}#${symbol.name}@${symbol.location.line}`
}

function findSymbolId(symbolIds: Map<string, string>, filePath: string, name: string): string | undefined {
  const prefix = `${filePath}#${name}@`
  for (const [key, id] of symbolIds) {
    if (key.startsWith(prefix)) return id
  }
  return undefined
}

function edgeId(source: string, kind: string, target: string): string {
  return `${source}--${kind}-->${target}`
}

function basename(filePath: string): string {
  return filePath.split('/').at(-1) ?? filePath
}

function sortById<T extends { id: string }>(items: T[]): void {
  items.sort((a, b) => a.id.localeCompare(b.id))
}
