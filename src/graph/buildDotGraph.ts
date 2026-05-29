import type { CodeGraph, CodeGraphNode } from './codeGraphTypes.js'
import type { GraphEdgeStyleMode } from './dotTypes.js'
import { buildLegendLines, formatEdgeAttrs, getEdgeAttrs } from './edgeStyleConvention.js'

export interface BuildDotGraphOptions {
  edgeStyle?: GraphEdgeStyleMode
}

export function buildDotGraph(graph: CodeGraph, options: BuildDotGraphOptions = {}): string {
  const mode: GraphEdgeStyleMode = options.edgeStyle ?? 'semantic'
  const lines = ['digraph CodeGraph {', '  rankdir=LR;']

  for (const node of [...graph.nodes].sort(compareById)) {
    lines.push(`  ${quote(node.id)} [label=${quote(nodeLabel(node))}, shape=${quote(nodeShape(node))}];`)
  }

  for (const edge of [...graph.edges].sort(compareById)) {
    if (mode === 'labeled') {
      lines.push(`  ${quote(edge.source)} -> ${quote(edge.target)} [label=${quote(edge.label ?? edge.kind)}];`)
    } else if (mode === 'minimal') {
      lines.push(`  ${quote(edge.source)} -> ${quote(edge.target)};`)
    } else {
      const attrs = getEdgeAttrs(edge.kind)
      lines.push(`  ${quote(edge.source)} -> ${quote(edge.target)} [${formatEdgeAttrs(attrs)}];`)
    }
  }

  if (mode === 'semantic') {
    lines.push(...buildLegendLines())
  }

  lines.push('}')
  return `${lines.join('\n')}\n`
}

function nodeLabel(node: CodeGraphNode): string {
  if (node.kind === 'file') return node.path ?? node.label
  if (node.kind === 'symbol') return node.symbolName ?? node.label
  return node.label
}

function nodeShape(node: CodeGraphNode): string {
  if (node.kind === 'file') return 'box'
  if (node.kind === 'symbol') return 'ellipse'
  return 'oval'
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`
}

function compareById<T extends { id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id)
}
