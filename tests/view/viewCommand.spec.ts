import { existsSync, mkdtempSync, rmSync, readFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isGraphvizAvailable } from '../../src/graph/renderGraphviz.js'
import { runCli } from '../lookup/testCli.js'

let outDir = ''

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-view-'))
  const result = runCli(['index', '--root', 'examples/basic-ts', '--src', 'src', '--out', outDir])
  expect(result.status).toBe(0)
})

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
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
})
