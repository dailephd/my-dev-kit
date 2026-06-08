import type { GraphEdgeStyleMode } from './dotTypes.js'
import { buildLegendLines, formatEdgeAttrs, getEdgeAttrs } from './edgeStyleConvention.js'
import type { RenderableGraph } from './renderableGraphTypes.js'

export interface BuildRenderableDotGraphOptions {
  edgeStyle?: GraphEdgeStyleMode
}

export function buildRenderableDotGraph(
  graph: RenderableGraph,
  options: BuildRenderableDotGraphOptions = {}
): string {
  const mode: GraphEdgeStyleMode = options.edgeStyle ?? 'semantic'
  const lines = [`digraph ${sanitizeGraphId(graph.label)} {`, '  rankdir=LR;']

  for (const node of [...graph.nodes].sort(compareById)) {
    const label = mode === 'minimal' ? omitSemanticRoleAdornment(node.label) : node.label
    lines.push(`  ${quote(node.id)} [label=${quote(label)}, shape=${quote(node.shape ?? 'oval')}];`)
  }

  for (const edge of [...graph.edges].sort(compareById)) {
    if (mode === 'labeled') {
      lines.push(`  ${quote(edge.source)} -> ${quote(edge.target)} [label=${quote(edge.label ?? edge.kind)}];`)
    } else if (mode === 'minimal') {
      lines.push(`  ${quote(edge.source)} -> ${quote(edge.target)};`)
    } else {
      const attrs = getEdgeAttrs(edge.kind)
      const label = edge.label ?? edge.kind
      const labelAttr = graph.id === 'code' ? '' : `, label=${quote(label)}`
      lines.push(`  ${quote(edge.source)} -> ${quote(edge.target)} [${formatEdgeAttrs(attrs)}${labelAttr}];`)
    }
  }

  if (mode === 'semantic' && graph.id === 'code') {
    lines.push(...buildLegendLines())
  }

  lines.push('}')
  return `${lines.join('\n')}\n`
}

function sanitizeGraphId(value: string): string {
  const id = value.replace(/[^A-Za-z0-9_]/g, '')
  return id || 'Graph'
}

function omitSemanticRoleAdornment(label: string): string {
  return label
    .split(/\r?\n/)
    .filter((line) => !/^\[[A-Za-z0-9_-]+\]$/.test(line))
    .join('\n')
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`
}

function compareById<T extends { id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id)
}
