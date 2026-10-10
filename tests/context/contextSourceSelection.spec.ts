import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { deriveSourceTargets, selectSourceSlices } from '../../src/context/sourceSelection.js'
import { selectSourceBundles } from '../../src/context/sourceBundles.js'
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'
import type { ContextFocus, SelectedGraph } from '../../src/context/types.js'
import type { ResolvedIndexManifest } from '../../src/indexing/readIndexManifest.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function fixtureRoot(lineCount: number): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-context-source-'))
  tempDirs.push(root)
  mkdirSync(join(root, 'src'), { recursive: true })
  const lines: string[] = []
  lines.push('export function Foo() {')
  for (let i = 0; i < lineCount - 2; i++) lines.push(`  // line ${i}`)
  lines.push('}')
  writeFileSync(join(root, 'src', 'a.ts'), lines.join('\n') + '\n')
  return root
}

function resolvedManifest(root: string): ResolvedIndexManifest {
  return {
    indexDir: root,
    manifestPath: join(root, 'manifest.json'),
    manifest: { projectRoot: root, analyzers: [], warnings: [], version: '1.0.0' } as unknown as ResolvedIndexManifest['manifest'],
    artifactPaths: { symbolIndex: join(root, 'symbol-index.json'), codeGraph: join(root, 'code-graph.json'), callGraph: null },
    semanticArtifactPaths: {
      dataModel: null,
      dataModelGraph: null,
      modelViewLineage: null,
      frontendSemantic: null,
      frontendReachability: null,
    },
  } as unknown as ResolvedIndexManifest
}

function codeGraphFixture(): CodeGraph {
  return {
    artifactKind: 'code-graph',
    schemaVersion: '1.0.0',
    createdAt: new Date().toISOString(),
    nodes: [
      { id: 'file:src/a.ts', kind: 'file', label: 'a.ts', path: 'src/a.ts' },
      { id: 'symbol:src/a.ts#Foo', kind: 'symbol', label: 'Foo', path: 'src/a.ts', symbolName: 'Foo' },
    ],
    edges: [{ id: 'e1', source: 'file:src/a.ts', target: 'symbol:src/a.ts#Foo', kind: 'defines' }],
    summary: { nodeCount: 2, symbolNodeCount: 1, fileNodeCount: 1, edgeCount: 1 },
  }
}

function symbolIndexFixture(lineCount: number): SymbolIndex {
  return {
    schemaVersion: '2',
    buildTime: new Date().toISOString(),
    repoRoot: '/root',
    sourceRoots: ['src'],
    fileCount: 1,
    symbolCount: 1,
    files: [
      {
        path: 'src/a.ts',
        language: 'typescript',
        lineCount,
        imports: [],
        exports: ['Foo'],
        symbols: [
          {
            name: 'Foo',
            kind: 'function',
            location: { line: 1 },
            exported: true,
          },
        ],
      },
    ],
    graph: { fileDeps: [], symbols: [] },
  } as unknown as SymbolIndex
}

const noFocus: ContextFocus = {
  focusNodeId: null,
  focusFilePath: null,
  selectionMode: 'none',
  confidence: 'none',
  reasons: [],
  ambiguityNotes: [],
  warnings: [],
}

describe('deriveSourceTargets + selectSourceSlices', () => {
  it('selects a source slice for the primary focus node', () => {
    const root = fixtureRoot(10)
    const focus: ContextFocus = { ...noFocus, focusNodeId: 'symbol:src/a.ts#Foo', focusFilePath: 'src/a.ts', confidence: 'high', selectionMode: 'single-best' }
    const selectedGraph: SelectedGraph = { nodes: [], edges: [], omittedNodeCount: 0, omittedEdgeCount: 0, warnings: [] }
    const targets = deriveSourceTargets({ focus, selectedGraph })
    expect(targets).toHaveLength(1)

    const result = selectSourceSlices({
      codeGraph: codeGraphFixture(),
      symbolIndex: symbolIndexFixture(10),
      resolved: resolvedManifest(root),
      targets,
      maxSourceSlices: null,
    })
    expect(result.slices).toHaveLength(1)
    expect(result.slices[0].nodeId).toBe('symbol:src/a.ts#Foo')
    expect(result.slices[0].filePath).toBe('src/a.ts')
  })

  it('derives source targets from selectedGraph neighbors within the cap', () => {
    const root = fixtureRoot(10)
    const focus: ContextFocus = { ...noFocus, focusNodeId: 'symbol:src/a.ts#Foo', focusFilePath: 'src/a.ts', confidence: 'high', selectionMode: 'single-best' }
    const selectedGraph: SelectedGraph = {
      nodes: [
        { nodeId: 'symbol:src/a.ts#Foo', kind: 'symbol', label: 'Foo', reasons: [] },
        { nodeId: 'file:src/a.ts', kind: 'file', label: 'a.ts', reasons: [] },
      ],
      edges: [],
      omittedNodeCount: 0,
      omittedEdgeCount: 0,
      warnings: [],
    }
    const targets = deriveSourceTargets({ focus, selectedGraph })
    expect(targets).toHaveLength(2)

    const result = selectSourceSlices({
      codeGraph: codeGraphFixture(),
      symbolIndex: symbolIndexFixture(10),
      resolved: resolvedManifest(root),
      targets,
      maxSourceSlices: 2,
    })
    expect(result.slices).toHaveLength(2)
    expect(result.omittedSliceCount).toBe(0)
  })

  it('respects --max-source-slices and reports omitted count', () => {
    const root = fixtureRoot(10)
    const focus: ContextFocus = { ...noFocus, focusNodeId: 'symbol:src/a.ts#Foo', focusFilePath: 'src/a.ts', confidence: 'high', selectionMode: 'single-best' }
    const selectedGraph: SelectedGraph = {
      nodes: [
        { nodeId: 'symbol:src/a.ts#Foo', kind: 'symbol', label: 'Foo', reasons: [] },
        { nodeId: 'file:src/a.ts', kind: 'file', label: 'a.ts', reasons: [] },
      ],
      edges: [],
      omittedNodeCount: 0,
      omittedEdgeCount: 0,
      warnings: [],
    }
    const targets = deriveSourceTargets({ focus, selectedGraph })

    const result = selectSourceSlices({
      codeGraph: codeGraphFixture(),
      symbolIndex: symbolIndexFixture(10),
      resolved: resolvedManifest(root),
      targets,
      maxSourceSlices: 1,
    })
    expect(result.slices).toHaveLength(1)
    expect(result.omittedSliceCount).toBe(1)
  })

  it('records a reason for every retained slice and never throws for a missing target', () => {
    const root = fixtureRoot(10)
    const targets = [{ nodeId: 'symbol:src/missing.ts#Nope', priority: 0 as const, reason: 'primary focus node' }]
    const result = selectSourceSlices({
      codeGraph: { ...codeGraphFixture(), nodes: [] },
      symbolIndex: symbolIndexFixture(10),
      resolved: resolvedManifest(root),
      targets,
      maxSourceSlices: null,
    })
    expect(result.slices).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].reason.length).toBeGreaterThan(0)
  })

  it('reports truncation and uses continuation at most once, for the focus node only', () => {
    const root = fixtureRoot(500)
    const focus: ContextFocus = { ...noFocus, focusNodeId: 'symbol:src/a.ts#Foo', focusFilePath: 'src/a.ts', confidence: 'high', selectionMode: 'single-best' }
    const selectedGraph: SelectedGraph = {
      nodes: [
        { nodeId: 'symbol:src/a.ts#Foo', kind: 'symbol', label: 'Foo', reasons: [] },
        { nodeId: 'file:src/a.ts', kind: 'file', label: 'a.ts', reasons: [] },
      ],
      edges: [],
      omittedNodeCount: 0,
      omittedEdgeCount: 0,
      warnings: [],
    }
    const targets = deriveSourceTargets({ focus, selectedGraph })

    const result = selectSourceSlices({
      codeGraph: codeGraphFixture(),
      symbolIndex: symbolIndexFixture(500),
      resolved: resolvedManifest(root),
      targets,
      maxSourceSlices: null,
    })
    const focusSlice = result.slices.find((slice) => slice.includedBy === 'primary-focus')!
    const neighborSlice = result.slices.find((slice) => slice.includedBy === 'selected-graph')!
    expect(focusSlice.continuationUsed).toBe(true)
    expect(neighborSlice.continuationUsed).toBe(false)
    expect(focusSlice.endLine).toBeGreaterThan(160)
  })
})

describe('selectSourceBundles', () => {
  it('produces one bundle for a symbol-kind focus', () => {
    const root = fixtureRoot(20)
    const focus: ContextFocus = { ...noFocus, focusNodeId: 'symbol:src/a.ts#Foo', focusFilePath: 'src/a.ts', confidence: 'high', selectionMode: 'single-best' }
    const result = selectSourceBundles({
      focus,
      symbolIndex: symbolIndexFixture(20),
      codeGraph: codeGraphFixture(),
      resolved: resolvedManifest(root),
      frontendArtifact: null,
    })
    expect(result.bundles).toHaveLength(1)
    for (const block of result.bundles[0].blocks) {
      expect((block as unknown as { content?: string }).content).toBeUndefined()
    }
  })

  it('produces no bundle for a file-kind focus', () => {
    const root = fixtureRoot(20)
    const focus: ContextFocus = { ...noFocus, focusNodeId: 'file:src/a.ts', focusFilePath: 'src/a.ts', confidence: 'high', selectionMode: 'single-best' }
    const result = selectSourceBundles({
      focus,
      symbolIndex: symbolIndexFixture(20),
      codeGraph: codeGraphFixture(),
      resolved: resolvedManifest(root),
      frontendArtifact: null,
    })
    expect(result.bundles).toHaveLength(0)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('produces no bundle when there is no focus', () => {
    const root = fixtureRoot(20)
    const result = selectSourceBundles({
      focus: noFocus,
      symbolIndex: symbolIndexFixture(20),
      codeGraph: codeGraphFixture(),
      resolved: resolvedManifest(root),
      frontendArtifact: null,
    })
    expect(result.bundles).toHaveLength(0)
  })
})

describe('selectSourceSlices known symbol boundaries', () => {
  // Foo occupies lines 1..symbolEnd; a following declaration begins at symbolEnd + 1.
  function boundedRoot(fileLines: number, symbolEnd: number): string {
    const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-context-bounded-'))
    tempDirs.push(root)
    mkdirSync(join(root, 'src'), { recursive: true })
    const lines: string[] = ['export function Foo() {']
    for (let i = 2; i < symbolEnd; i++) lines.push(`  // foo ${i}`)
    lines.push('}')
    lines.push('export function Next() {')
    while (lines.length < fileLines - 1) lines.push(`  // next ${lines.length}`)
    lines.push('}')
    writeFileSync(join(root, 'src', 'a.ts'), lines.join('\n') + '\n')
    return root
  }

  function boundedSymbolIndex(fileLines: number, endLine: number | undefined): SymbolIndex {
    const index = symbolIndexFixture(fileLines)
    const symbol = index.files[0].symbols[0]
    symbol.location = (endLine === undefined ? { line: 1 } : { line: 1, endLine }) as typeof symbol.location
    return index
  }

  function focusTarget(nodeId: string) {
    return [{ nodeId, priority: 0 as const, reason: 'primary focus node' }]
  }

  function run(root: string, fileLines: number, endLine: number | undefined, nodeId = 'symbol:src/a.ts#Foo') {
    return selectSourceSlices({
      codeGraph: codeGraphFixture(),
      symbolIndex: boundedSymbolIndex(fileLines, endLine),
      resolved: resolvedManifest(root),
      targets: focusTarget(nodeId),
      maxSourceSlices: null,
    })
  }

  it('A: a known short symbol stops at its end with no continuation and no later declaration', () => {
    const result = run(boundedRoot(400, 40), 400, 40)
    const slice = result.slices[0]
    expect(slice.startLine).toBe(1)
    expect(slice.endLine).toBe(40)
    expect(slice.continuationUsed).toBe(false)
    expect(slice.continuationAvailable ?? false).toBe(false)
    expect(slice.truncated).toBe(false)
    expect(result.totalSelectedLines).toBe(40)
  })

  it('B: a known 180-line symbol uses one continuation that ends at the symbol end, not 320', () => {
    const result = run(boundedRoot(400, 180), 400, 180)
    const slice = result.slices[0]
    expect(slice.startLine).toBe(1)
    expect(slice.endLine).toBe(180)
    expect(slice.continuationUsed).toBe(true)
    expect(slice.continuationAvailable ?? false).toBe(false)
    expect(slice.truncated).toBe(false)
    expect(result.totalSelectedLines).toBe(180)
  })

  it('C: a known symbol longer than two windows gets at most one continuation and stays truncated', () => {
    const result = run(boundedRoot(500, 400), 500, 400)
    const slice = result.slices[0]
    expect(slice.startLine).toBe(1)
    expect(slice.endLine).toBe(320)
    expect(slice.continuationUsed).toBe(true)
    expect(slice.continuationAvailable).toBe(true)
    expect(slice.truncated).toBe(true)
    expect(result.totalSelectedLines).toBe(320)
  })

  it('D: an unknown symbol boundary keeps the conservative continuation behavior', () => {
    const result = run(boundedRoot(500, 40), 500, undefined)
    const slice = result.slices[0]
    expect(slice.startLine).toBe(1)
    expect(slice.endLine).toBe(180)
    expect(slice.continuationUsed).toBe(true)
    expect(slice.truncated).toBe(true)
    expect(slice.continuationAvailable).toBe(true)
  })

  it('E: a file node keeps its existing single-continuation policy', () => {
    const result = run(boundedRoot(500, 40), 500, 40, 'file:src/a.ts')
    const slice = result.slices[0]
    expect(slice.kind).not.toBe('symbol')
    expect(slice.startLine).toBe(1)
    expect(slice.endLine).toBe(320)
    expect(slice.continuationUsed).toBe(true)
    expect(slice.truncated).toBe(true)
  })

  it('F: a stale indexed end beyond the actual file is skipped rather than reported complete', () => {
    const result = run(boundedRoot(30, 20), 400, 300)
    expect(result.slices).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].reason).toMatch(/Stale index/)
  })
})
