import { existsSync, mkdtempSync, rmSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isGraphvizAvailable } from '../../src/graph/renderGraphviz.js'
import { runCli } from '../lookup/testCli.js'

let outDir = ''
let semanticOutDir = ''

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-view-'))
  const result = runCli(['index', '--root', 'examples/basic-ts', '--src', 'src', '--out', outDir])
  expect(result.status).toBe(0)

  semanticOutDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-view-semantic-'))
  const semanticIndex = runCli([
    'index',
    '--root',
    'examples/basic-data-model-ts',
    '--src',
    'src',
    '--out',
    semanticOutDir,
    '--json',
  ])
  expect(semanticIndex.status).toBe(0)
  const generate = runCli(['data-model', '--index', semanticOutDir, '--out', semanticOutDir, '--json'])
  expect(generate.status).toBe(0)
  const trace = runCli(['data-model', '--index', semanticOutDir, '--out', semanticOutDir, '--trace-view', 'User', '--json'])
  expect(trace.status).toBe(0)
}, 60000)

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
  rmSync(semanticOutDir, { recursive: true, force: true })
})

describe('view command', () => {
  it('writes DOT by default using semantic mode', () => {
    const result = runCli(['view', '--index', outDir, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.actualFormat).toBe('dot')
    expect(parsed.edgeStyle).toBe('semantic')
    expect(existsSync(join(outDir, 'graph.dot'))).toBe(true)
  })

  it('default semantic DOT contains a legend', () => {
    const dotOut = join(outDir, 'semantic-default.dot')
    const result = runCli(['view', '--index', outDir, '--format', 'dot', '--out', dotOut])
    expect(result.status).toBe(0)
    expect(readFileSync(dotOut, 'utf8')).toContain('cluster_legend')
  })

  it('default semantic DOT includes concise semantic role labels for enriched nodes', () => {
    const dotOut = join(outDir, 'semantic-labels.dot')
    const result = runCli(['view', '--index', outDir, '--format', 'dot', '--out', dotOut])
    expect(result.status).toBe(0)
    const dotContent = readFileSync(dotOut, 'utf8')

    expect(dotContent).toContain('User\\n[canonical-type]')
    expect(dotContent).not.toContain('data-model-graph')
    expect(dotContent).not.toContain('model-view-lineage')
  })

  it('writes DOT to explicit --out path and prints valid JSON', () => {
    const dotOut = join(outDir, 'custom.dot')
    const result = runCli(['view', '--index', outDir, '--format', 'dot', '--out', dotOut, '--json'])
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).outputPath).toContain('custom.dot')
    expect(readFileSync(dotOut, 'utf8')).toContain('digraph CodeGraph')
  })

  it('--graph code renders code graph explicitly', () => {
    const dotOut = join(outDir, 'code-explicit.dot')
    const result = runCli(['view', '--index', outDir, '--graph', 'code', '--format', 'dot', '--out', dotOut, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.graph).toBe('code')
    expect(parsed.artifactPath).toContain('code-graph.json')
    expect(parsed.nodeCount).toBeGreaterThan(0)
    expect(readFileSync(dotOut, 'utf8')).toContain('digraph CodeGraph')
  })

  it('--graph data-model renders data-model-graph.json as DOT', () => {
    const dotOut = join(semanticOutDir, 'data-model.dot')
    const result = runCli([
      'view',
      '--index',
      semanticOutDir,
      '--graph',
      'data-model',
      '--format',
      'dot',
      '--out',
      dotOut,
      '--edge-style',
      'labeled',
      '--json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.graph).toBe('data-model')
    expect(parsed.artifactPath).toContain('data-model-graph.json')
    expect(parsed.nodeCount).toBeGreaterThan(0)
    expect(parsed.edgeCount).toBeGreaterThan(0)
    const dotContent = readFileSync(dotOut, 'utf8')
    expect(dotContent).toContain('digraph DataModelGraph')
    expect(dotContent).toContain('User')
    expect(dotContent).toContain('User.email')
    expect(dotContent).toContain('has-field')
  })

  it('--graph model-view-lineage renders model-view-lineage.json as DOT', () => {
    const dotOut = join(semanticOutDir, 'lineage.dot')
    const result = runCli([
      'view',
      '--index',
      semanticOutDir,
      '--graph',
      'model-view-lineage',
      '--format',
      'dot',
      '--out',
      dotOut,
      '--edge-style',
      'labeled',
      '--json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.graph).toBe('model-view-lineage')
    expect(parsed.artifactPath).toContain('model-view-lineage.json')
    expect(parsed.nodeCount).toBeGreaterThan(0)
    expect(parsed.edgeCount).toBeGreaterThan(0)
    const dotContent = readFileSync(dotOut, 'utf8')
    expect(dotContent).toContain('digraph ModelViewLineage')
    expect(dotContent).toContain('User.email')
    expect(dotContent).toContain('buildUserViewModel')
    expect(dotContent).toContain('creates-view-model')
  })

  it('--edge-style semantic works and sets edgeStyle in JSON', () => {
    const dotOut = join(outDir, 'semantic.dot')
    const result = runCli(['view', '--index', outDir, '--format', 'dot', '--out', dotOut, '--edge-style', 'semantic', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.edgeStyle).toBe('semantic')
    expect(readFileSync(dotOut, 'utf8')).toContain('cluster_legend')
  })

  it('--edge-style labeled works and keeps inline edge labels', () => {
    const dotOut = join(outDir, 'labeled.dot')
    const result = runCli(['view', '--index', outDir, '--format', 'dot', '--out', dotOut, '--edge-style', 'labeled', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.edgeStyle).toBe('labeled')
    const dotContent = readFileSync(dotOut, 'utf8')
    expect(dotContent).not.toContain('cluster_legend')
    expect(dotContent).toMatch(/label="(defines|imports|exports|calls|depends-on)"/)
  })

  it('--edge-style minimal works and omits legend', () => {
    const dotOut = join(outDir, 'minimal.dot')
    const result = runCli(['view', '--index', outDir, '--format', 'dot', '--out', dotOut, '--edge-style', 'minimal', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.edgeStyle).toBe('minimal')
    const dotContent = readFileSync(dotOut, 'utf8')
    expect(dotContent).not.toContain('cluster_legend')
    expect(dotContent).not.toContain('canonical-type')
    expect(dotContent).toContain('digraph CodeGraph')
  })

  it('invalid --edge-style fails clearly', () => {
    const result = runCli(['view', '--index', outDir, '--edge-style', 'fancy'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('edge-style')
  })

  it('invalid --graph fails clearly', () => {
    const result = runCli(['view', '--index', outDir, '--graph', 'data-model-view'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--graph')
  })

  it('fails clearly for missing manifest', () => {
    const missing = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-view-missing-'))
    try {
      const result = runCli(['view', '--index', missing])
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('Missing index manifest')
    } finally {
      rmSync(missing, { recursive: true, force: true })
    }
  })

  it('fails clearly for missing code-graph.json', () => {
    const codeGraph = join(outDir, 'code-graph.json')
    const hidden = join(outDir, 'code-graph.hidden')
    renameSync(codeGraph, hidden)
    try {
      const result = runCli(['view', '--index', outDir])
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('Missing required code graph artifact')
    } finally {
      renameSync(hidden, codeGraph)
    }
  })

  it('fails clearly when manifest does not reference data-model-graph.json even if a stale file exists', () => {
    const staleDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-view-stale-data-model-'))
    try {
      const manifest = JSON.parse(readFileSync(join(semanticOutDir, 'manifest.json'), 'utf8'))
      manifest.semanticArtifacts = {
        ...manifest.semanticArtifacts,
        dataModelGraph: null,
      }
      writeFileSync(join(staleDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
      writeFileSync(join(staleDir, 'code-graph.json'), readFileSync(join(semanticOutDir, 'code-graph.json')), 'utf8')
      writeFileSync(join(staleDir, 'symbol-index.json'), readFileSync(join(semanticOutDir, 'symbol-index.json')), 'utf8')
      writeFileSync(join(staleDir, 'data-model-graph.json'), '{"artifactKind":"my-dev-kit-v1-data-model-graph","nodes":[],"edges":[]}', 'utf8')

      const result = runCli(['view', '--index', staleDir, '--graph', 'data-model', '--format', 'dot'])
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('Missing dataModelGraph artifact in manifest')
    } finally {
      rmSync(staleDir, { recursive: true, force: true })
    }
  })

  it('fails clearly when manifest does not reference model-view-lineage.json even if a stale file exists', () => {
    const staleDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-view-stale-lineage-'))
    try {
      const manifest = JSON.parse(readFileSync(join(semanticOutDir, 'manifest.json'), 'utf8'))
      manifest.semanticArtifacts = {
        ...manifest.semanticArtifacts,
        modelViewLineage: null,
      }
      writeFileSync(join(staleDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
      writeFileSync(join(staleDir, 'code-graph.json'), readFileSync(join(semanticOutDir, 'code-graph.json')), 'utf8')
      writeFileSync(join(staleDir, 'symbol-index.json'), readFileSync(join(semanticOutDir, 'symbol-index.json')), 'utf8')
      writeFileSync(join(staleDir, 'model-view-lineage.json'), '{"artifactKind":"my-dev-kit-v1-model-view-lineage","nodes":[],"edges":[]}', 'utf8')

      const result = runCli(['view', '--index', staleDir, '--graph', 'model-view-lineage', '--format', 'dot'])
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('Missing modelViewLineage artifact in manifest')
    } finally {
      rmSync(staleDir, { recursive: true, force: true })
    }
  })

  it('rejects unsupported format', () => {
    const result = runCli(['view', '--index', outDir, '--format', 'pdf'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Unsupported view format')
  })

  it('does not require Graphviz for DOT output', () => {
    const result = runCli(['view', '--index', outDir, '--format', 'dot'])
    expect(result.status).toBe(0)
  })

  it('handles SVG rendering or fallback based on Graphviz availability', () => {
    if (isGraphvizAvailable()) {
      const svgOut = join(outDir, 'graph.svg')
      const result = runCli(['view', '--index', outDir, '--format', 'svg', '--out', svgOut, '--json'])
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout).graphvizUsed).toBe(true)
      expect(existsSync(svgOut)).toBe(true)
      return
    }

    const fail = runCli(['view', '--index', outDir, '--format', 'svg'])
    expect(fail.status).toBe(2)
    expect(fail.stderr).toContain('Graphviz dot executable is not available')

    const fallbackOut = join(outDir, 'fallback.dot')
    const fallback = runCli(['view', '--index', outDir, '--format', 'svg', '--out', fallbackOut, '--allow-dot-fallback', '--json'])
    expect(fallback.status).toBe(0)
    expect(JSON.parse(fallback.stdout).dotFallbackUsed).toBe(true)
    expect(readFileSync(fallbackOut, 'utf8')).toContain('digraph CodeGraph')
  })

  it('handles PNG rendering as binary output or DOT fallback', () => {
    const pngOut = join(outDir, 'graph.png')
    const result = runCli([
      'view',
      '--index',
      outDir,
      '--format',
      'png',
      '--out',
      pngOut,
      '--allow-dot-fallback',
      '--json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.actualFormat === 'png' || parsed.dotFallbackUsed).toBe(true)
    expect(existsSync(parsed.outputPath)).toBe(true)
    if (parsed.actualFormat === 'png') {
      expect(readFileSync(parsed.outputPath).subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )
    }
  })

  it('handles data-model SVG rendering or DOT fallback', () => {
    const graphOut = join(semanticOutDir, 'data-model.svg')
    const result = runCli([
      'view',
      '--index',
      semanticOutDir,
      '--graph',
      'data-model',
      '--format',
      'svg',
      '--out',
      graphOut,
      '--allow-dot-fallback',
      '--json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.graph).toBe('data-model')
    expect(parsed.actualFormat === 'svg' || parsed.dotFallbackUsed).toBe(true)
    expect(existsSync(parsed.outputPath)).toBe(true)
  })

  it('handles lineage SVG rendering or DOT fallback', () => {
    const graphOut = join(semanticOutDir, 'lineage.svg')
    const result = runCli([
      'view',
      '--index',
      semanticOutDir,
      '--graph',
      'model-view-lineage',
      '--format',
      'svg',
      '--out',
      graphOut,
      '--allow-dot-fallback',
      '--json',
    ])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.graph).toBe('model-view-lineage')
    expect(parsed.actualFormat === 'svg' || parsed.dotFallbackUsed).toBe(true)
    expect(existsSync(parsed.outputPath)).toBe(true)
  })
})
