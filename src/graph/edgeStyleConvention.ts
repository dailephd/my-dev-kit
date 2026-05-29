export interface DotEdgeAttrs {
  dir: string
  arrowtail: string
  arrowhead: string
  style: string
}

const KNOWN_EDGE_KINDS: readonly string[] = [
  'defines',
  'imports',
  'exports',
  'calls',
  'depends-on',
  'related-to',
]

const EDGE_ATTR_MAP: Record<string, DotEdgeAttrs> = {
  defines: { dir: 'both', arrowtail: 'dot', arrowhead: 'normal', style: 'solid' },
  imports: { dir: 'both', arrowtail: 'dot', arrowhead: 'inv', style: 'solid' },
  exports: { dir: 'both', arrowtail: 'dot', arrowhead: 'onormal', style: 'solid' },
  calls: { dir: 'both', arrowtail: 'dot', arrowhead: 'normal', style: 'bold' },
  'depends-on': { dir: 'both', arrowtail: 'dot', arrowhead: 'inv', style: 'dashed' },
  'related-to': { dir: 'both', arrowtail: 'odot', arrowhead: 'odot', style: 'dotted' },
}

const FALLBACK_ATTRS: DotEdgeAttrs = { dir: 'forward', arrowtail: 'none', arrowhead: 'normal', style: 'solid' }

export function getEdgeAttrs(kind: string): DotEdgeAttrs {
  return EDGE_ATTR_MAP[kind] ?? FALLBACK_ATTRS
}

export function formatEdgeAttrs(attrs: DotEdgeAttrs): string {
  return `dir="${attrs.dir}", arrowtail="${attrs.arrowtail}", arrowhead="${attrs.arrowhead}", style="${attrs.style}"`
}

export function buildLegendLines(): string[] {
  const lines: string[] = [
    '  subgraph cluster_legend {',
    '    label="Edge Legend"; style=dotted; color=gray;',
  ]
  for (const kind of KNOWN_EDGE_KINDS) {
    const src = `legend_${kind.replace('-', '_')}_src`
    const tgt = `legend_${kind.replace('-', '_')}_tgt`
    const attrs = getEdgeAttrs(kind)
    lines.push(`    "${src}" [label="${kind} (source)", shape=plaintext, fontsize=9];`)
    lines.push(`    "${tgt}" [label="${kind} (target)", shape=plaintext, fontsize=9];`)
    lines.push(`    "${src}" -> "${tgt}" [${formatEdgeAttrs(attrs)}, label="${kind}", fontsize=9];`)
  }
  lines.push('  }')
  return lines
}
