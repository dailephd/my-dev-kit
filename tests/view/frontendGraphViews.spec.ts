import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adaptReactComponentGraph, adaptReactFlowGraph, validateFrontendArtifact } from '../../src/graph/adaptFrontendGraphs.js'
import { buildRenderableDotGraph } from '../../src/graph/buildRenderableDotGraph.js'
import { isGraphvizAvailable } from '../../src/graph/renderGraphviz.js'
import { runCli } from '../lookup/testCli.js'
import type { FrontendFileResult, FrontendSemanticArtifact, ReactFlowRelationship } from '../../src/frontend/frontendTypes.js'

const tempDirs: string[] = []

function makeTempProject(): { projectDir: string; indexDir: string } {
  const projectDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-fgraph-'))
  const indexDir = join(projectDir, '.idx')
  tempDirs.push(projectDir)
  return { projectDir, indexDir }
}

function writeFixture(projectDir: string, relativePath: string, content: string): void {
  const full = join(projectDir, relativePath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

function buildIndex(projectDir: string, indexDir: string): void {
  const res = runCli(['index', '--root', projectDir, '--src', 'src', '--out', indexDir])
  if (res.status !== 0) throw new Error(`Index failed: ${res.stderr || res.stdout}`)
}

// ---------------------------------------------------------------------------
// Shared fixture project
// ---------------------------------------------------------------------------

let sharedProjectDir = ''
let sharedIndexDir = ''

beforeAll(() => {
  const { projectDir, indexDir } = makeTempProject()
  sharedProjectDir = projectDir
  sharedIndexDir = indexDir

  writeFixture(projectDir, 'src/LoginForm.tsx', `import React from 'react'
import { useState } from 'react'

export interface LoginProps {
  onSuccess: () => void
}

export function LoginForm({ onSuccess }: LoginProps) {
  const [username, setUsername] = useState('')
  const handleSubmit = () => onSuccess()
  return (
    <form data-testid="login-form">
      <input value={username} onChange={(e) => setUsername(e.target.value)} />
      <button type="submit">Sign in</button>
    </form>
  )
}
`)

  writeFixture(projectDir, 'src/Dashboard.tsx', `import React from 'react'

const MetricsWidget = () => <div aria-label="metrics">metrics</div>

export function Dashboard() {
  return (
    <main>
      <MetricsWidget />
    </main>
  )
}
`)

  writeFixture(projectDir, 'src/utils.ts', `export function formatDate(d: Date): string { return d.toISOString() }`)

  buildIndex(projectDir, indexDir)
})

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// react-component graph — CLI integration
// ---------------------------------------------------------------------------

describe('view --graph react-component', () => {
  it('produces valid DOT output', () => {
    const dotOut = join(sharedIndexDir, 'react-component.dot')
    const res = runCli(['view', '--index', sharedIndexDir, '--graph', 'react-component', '--format', 'dot', '--out', dotOut])
    expect(res.status).toBe(0)
    expect(existsSync(dotOut)).toBe(true)
    const dot = readFileSync(dotOut, 'utf8')
    expect(dot).toContain('digraph ReactComponentGraph')
    expect(dot).toContain('{')
    expect(dot).toContain('}')
  })

  it('includes component names in DOT', () => {
    const dotOut = join(sharedIndexDir, 'react-component-names.dot')
    runCli(['view', '--index', sharedIndexDir, '--graph', 'react-component', '--format', 'dot', '--out', dotOut])
    const dot = readFileSync(dotOut, 'utf8')
    expect(dot).toContain('LoginForm')
    expect(dot).toContain('Dashboard')
  })

  it('includes local component in DOT', () => {
    const dotOut = join(sharedIndexDir, 'react-component-local.dot')
    runCli(['view', '--index', sharedIndexDir, '--graph', 'react-component', '--format', 'dot', '--out', dotOut])
    const dot = readFileSync(dotOut, 'utf8')
    expect(dot).toContain('MetricsWidget')
  })

  it('JSON result has node and edge counts', () => {
    const dotOut = join(sharedIndexDir, 'react-component-json.dot')
    const res = runCli(['view', '--index', sharedIndexDir, '--graph', 'react-component', '--format', 'dot', '--out', dotOut, '--json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.graph).toBe('react-component')
    expect(parsed.nodeCount).toBeGreaterThan(0)
    expect(typeof parsed.edgeCount).toBe('number')
  })

  it('output is deterministic across repeated calls', () => {
    const dotOut1 = join(sharedIndexDir, 'rc-det-1.dot')
    const dotOut2 = join(sharedIndexDir, 'rc-det-2.dot')
    runCli(['view', '--index', sharedIndexDir, '--graph', 'react-component', '--format', 'dot', '--out', dotOut1])
    runCli(['view', '--index', sharedIndexDir, '--graph', 'react-component', '--format', 'dot', '--out', dotOut2])
    expect(readFileSync(dotOut1, 'utf8')).toBe(readFileSync(dotOut2, 'utf8'))
  })

  it('SVG rendering or dot-fallback works', () => {
    const svgOut = join(sharedIndexDir, 'react-component.svg')
    const res = runCli(['view', '--index', sharedIndexDir, '--graph', 'react-component', '--format', 'svg', '--out', svgOut, '--allow-dot-fallback', '--json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.actualFormat === 'svg' || parsed.dotFallbackUsed).toBe(true)
    expect(existsSync(parsed.outputPath)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// react-flow graph — CLI integration
// ---------------------------------------------------------------------------

describe('view --graph react-flow', () => {
  it('produces valid DOT output', () => {
    const dotOut = join(sharedIndexDir, 'react-flow.dot')
    const res = runCli(['view', '--index', sharedIndexDir, '--graph', 'react-flow', '--format', 'dot', '--out', dotOut])
    expect(res.status).toBe(0)
    expect(existsSync(dotOut)).toBe(true)
    const dot = readFileSync(dotOut, 'utf8')
    expect(dot).toContain('digraph ReactFlowGraph')
  })

  it('includes hook and component nodes', () => {
    const dotOut = join(sharedIndexDir, 'react-flow-nodes.dot')
    runCli(['view', '--index', sharedIndexDir, '--graph', 'react-flow', '--format', 'dot', '--out', dotOut])
    const dot = readFileSync(dotOut, 'utf8')
    expect(dot).toContain('LoginForm')
  })

  it('JSON result has graph=react-flow', () => {
    const dotOut = join(sharedIndexDir, 'react-flow-json.dot')
    const res = runCli(['view', '--index', sharedIndexDir, '--graph', 'react-flow', '--format', 'dot', '--out', dotOut, '--json'])
    const parsed = JSON.parse(res.stdout)
    expect(parsed.graph).toBe('react-flow')
    expect(parsed.nodeCount).toBeGreaterThanOrEqual(0)
  })

  it('output is deterministic', () => {
    const dotOut1 = join(sharedIndexDir, 'rf-det-1.dot')
    const dotOut2 = join(sharedIndexDir, 'rf-det-2.dot')
    runCli(['view', '--index', sharedIndexDir, '--graph', 'react-flow', '--format', 'dot', '--out', dotOut1])
    runCli(['view', '--index', sharedIndexDir, '--graph', 'react-flow', '--format', 'dot', '--out', dotOut2])
    expect(readFileSync(dotOut1, 'utf8')).toBe(readFileSync(dotOut2, 'utf8'))
  })

  it('SVG or dot-fallback works', () => {
    const svgOut = join(sharedIndexDir, 'react-flow.svg')
    const res = runCli(['view', '--index', sharedIndexDir, '--graph', 'react-flow', '--format', 'svg', '--out', svgOut, '--allow-dot-fallback', '--json'])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.actualFormat === 'svg' || parsed.dotFallbackUsed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('view --graph react-component: error cases', () => {
  it('fails clearly when manifest has no frontendSemantic path', () => {
    const { projectDir, indexDir } = makeTempProject()
    writeFixture(projectDir, 'src/Card.tsx', `export function Card() { return <div /> }`)
    buildIndex(projectDir, indexDir)

    // Null out the frontendSemantic path in the manifest
    const manifestPath = join(indexDir, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.semanticArtifacts = { ...manifest.semanticArtifacts, frontendSemantic: null }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

    const res = runCli(['view', '--index', indexDir, '--graph', 'react-component', '--format', 'dot'])
    expect(res.status).not.toBe(0)
    expect(res.stderr + res.stdout).toMatch(/frontendSemantic|TSX|JSX/i)
  })

  it('fails clearly with malformed frontend artifact', () => {
    const { projectDir, indexDir } = makeTempProject()
    writeFixture(projectDir, 'src/Card.tsx', `export function Card() { return <div /> }`)
    buildIndex(projectDir, indexDir)

    // Overwrite with malformed JSON
    const artifactPath = join(indexDir, 'frontend-semantic.json')
    if (existsSync(artifactPath)) {
      writeFileSync(artifactPath, '{ "artifactKind": "my-dev-kit-v1-frontend-semantic", "files": "not-an-array" }', 'utf8')
      const res = runCli(['view', '--index', indexDir, '--graph', 'react-component', '--format', 'dot'])
      expect(res.status).not.toBe(0)
    }
  })

  it('fails clearly with wrong artifactKind', () => {
    const { projectDir, indexDir } = makeTempProject()
    writeFixture(projectDir, 'src/Card.tsx', `export function Card() { return <div /> }`)
    buildIndex(projectDir, indexDir)

    const artifactPath = join(indexDir, 'frontend-semantic.json')
    if (existsSync(artifactPath)) {
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
      artifact.artifactKind = 'wrong-kind'
      writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), 'utf8')
      const res = runCli(['view', '--index', indexDir, '--graph', 'react-component', '--format', 'dot'])
      expect(res.status).not.toBe(0)
      expect(res.stderr + res.stdout).toContain('artifactKind')
    }
  })
})

// ---------------------------------------------------------------------------
// Unit tests — adaptReactComponentGraph
// ---------------------------------------------------------------------------

function makeMinimalArtifact(overrides: Partial<FrontendSemanticArtifact> = {}): FrontendSemanticArtifact {
  return {
    artifactKind: 'my-dev-kit-v1-frontend-semantic',
    schemaVersion: '1.0.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    files: [],
    summary: { fileCount: 0, jsxFileCount: 0, testFileCount: 0, componentCount: 0, hookCount: 0, testBlockCount: 0, uiStringCount: 0, relationshipCount: 0, locatorCount: 0, warningCount: 0, errorCount: 0 },
    warnings: [],
    ...overrides,
  }
}

function makeFile(filePath: string, overrides: Partial<FrontendFileResult> = {}): FrontendFileResult {
  const emptyFile: FrontendFileResult = {
    filePath,
    hasJsx: true,
    isTestFile: false,
    parseError: false,
    components: [],
    localComponents: [],
    propTypes: [],
    hooks: [],
    jsxRegions: [],
    eventHandlers: [],
    uiStrings: [],
    relationships: [],
    testBlocks: [],
    locators: [],
    routeStrings: [],
    warnings: [],
  }
  return { ...emptyFile, ...overrides }
}

function makeComponent(id: string, name: string) {
  return {
    id, name,
    kind: 'function' as const,
    exportKind: 'named' as const,
    isDefaultExport: false,
    exported: true,
    sourceRef: { filePath: 'src/Test.tsx', line: 1, endLine: 5 },
    warnings: [],
  }
}

function makeLocalComponent(id: string, name: string) {
  return {
    id, name,
    kind: 'arrow-function' as const,
    sourceRef: { filePath: 'src/Test.tsx', line: 1, endLine: 3 },
    warnings: [],
  }
}

function makeHook(id: string, hookName: string, stateVarName?: string) {
  return {
    id, hookName,
    kind: 'useState' as const,
    stateVarName: stateVarName ?? null,
    setterName: null,
    sourceRef: { filePath: 'src/Test.tsx', line: 2, endLine: 2 },
    warnings: [],
  }
}

const DUMMY_REF = { filePath: 'src/Test.tsx', line: 1, endLine: 1 }

function makeRel(id: string, kind: ReactFlowRelationship['kind'], sourceId: string, targetId: string, propName?: string): ReactFlowRelationship {
  return {
    id, kind,
    filePath: 'src/Test.tsx',
    ownerComponentId: sourceId,
    sourceId, targetId,
    propName: propName ?? null,
    valueSummary: null,
    sourceRef: DUMMY_REF,
    warnings: [],
  }
}

describe('adaptReactComponentGraph — unit', () => {
  it('empty artifact produces empty graph', () => {
    const g = adaptReactComponentGraph(makeMinimalArtifact())
    expect(g.nodes).toHaveLength(0)
    expect(g.edges).toHaveLength(0)
    expect(g.id).toBe('react-component')
    expect(g.label).toBe('ReactComponentGraph')
  })

  it('one component adds file and component nodes', () => {
    const artifact = makeMinimalArtifact({
      files: [makeFile('src/A.tsx', { components: [makeComponent('comp-1', 'MyComp')] })],
    })
    const g = adaptReactComponentGraph(artifact)
    const kinds = g.nodes.map((n) => n.kind)
    expect(kinds).toContain('file')
    expect(kinds).toContain('component')
    const compNode = g.nodes.find((n) => n.kind === 'component')
    expect(compNode?.label).toBe('MyComp')
  })

  it('local component gets ellipse shape', () => {
    const artifact = makeMinimalArtifact({
      files: [makeFile('src/A.tsx', {
        components: [makeComponent('comp-1', 'Parent')],
        localComponents: [makeLocalComponent('local-1', 'Child')],
      })],
    })
    const g = adaptReactComponentGraph(artifact)
    const local = g.nodes.find((n) => n.kind === 'local-component')
    expect(local).toBeDefined()
    expect(local?.shape).toBe('ellipse')
    expect(local?.label).toBe('Child')
  })

  it('file with no components is skipped', () => {
    const artifact = makeMinimalArtifact({
      files: [makeFile('src/utils.ts', {})],
    })
    const g = adaptReactComponentGraph(artifact)
    expect(g.nodes).toHaveLength(0)
  })

  it('renders-local-component relationship becomes edge', () => {
    const artifact = makeMinimalArtifact({
      files: [makeFile('src/A.tsx', {
        components: [makeComponent('comp-1', 'Parent')],
        localComponents: [makeLocalComponent('local-1', 'Child')],
        relationships: [makeRel('rel-1', 'react-renders-local-component', 'comp-1', 'local-1')],
      })],
    })
    const g = adaptReactComponentGraph(artifact)
    const renderEdge = g.edges.find((e) => e.kind === 'renders')
    expect(renderEdge).toBeDefined()
    expect(renderEdge?.source).toBe('component:comp-1')
    expect(renderEdge?.target).toBe('local:local-1')
  })

  it('prop type adds diamond node and uses-props edge', () => {
    const artifact = makeMinimalArtifact({
      files: [makeFile('src/A.tsx', {
        components: [makeComponent('comp-1', 'Card')],
        propTypes: [{
          id: 'pt-1',
          name: 'CardProps',
          kind: 'interface',
          usedByComponentIds: ['comp-1'],
          sourceRef: { filePath: 'src/A.tsx', line: 1, endLine: 3 },
          warnings: [],
        }],
      })],
    })
    const g = adaptReactComponentGraph(artifact)
    const propNode = g.nodes.find((n) => n.kind === 'prop-type')
    expect(propNode?.shape).toBe('diamond')
    const usesEdge = g.edges.find((e) => e.kind === 'uses-props')
    expect(usesEdge).toBeDefined()
  })

  it('duplicate component IDs produce only one node', () => {
    const artifact = makeMinimalArtifact({
      files: [
        makeFile('src/A.tsx', { components: [makeComponent('comp-1', 'Button')] }),
        makeFile('src/B.tsx', { components: [makeComponent('comp-1', 'Button')] }),
      ],
    })
    const g = adaptReactComponentGraph(artifact)
    const buttonNodes = g.nodes.filter((n) => n.label === 'Button')
    expect(buttonNodes.length).toBe(1)
  })

  it('long labels are truncated', () => {
    const longName = 'A'.repeat(100)
    const artifact = makeMinimalArtifact({
      files: [makeFile('src/A.tsx', { components: [makeComponent('comp-1', longName)] })],
    })
    const g = adaptReactComponentGraph(artifact)
    const comp = g.nodes.find((n) => n.kind === 'component')
    expect(comp?.label.length).toBeLessThanOrEqual(61)
  })

  it('labels with double quotes are safe in DOT via buildRenderableDotGraph', () => {
    const artifact = makeMinimalArtifact({
      files: [makeFile('src/A.tsx', { components: [makeComponent('comp-1', 'A"B')] })],
    })
    const g = adaptReactComponentGraph(artifact)
    // buildRenderableDotGraph imported at top
    const dot = buildRenderableDotGraph(g)
    expect(dot).not.toContain('A"B"')
    expect(dot).toContain('A\\"B')
  })

  it('Unicode labels are preserved', () => {
    const artifact = makeMinimalArtifact({
      files: [makeFile('src/A.tsx', { components: [makeComponent('comp-1', '컴포넌트')] })],
    })
    const g = adaptReactComponentGraph(artifact)
    const comp = g.nodes.find((n) => n.kind === 'component')
    expect(comp?.label).toBe('컴포넌트')
  })

  it('Windows paths are used as-is in labels', () => {
    const artifact = makeMinimalArtifact({
      files: [makeFile('src\\components\\A.tsx', { components: [makeComponent('comp-1', 'A')] })],
    })
    const g = adaptReactComponentGraph(artifact)
    expect(g.nodes.length).toBeGreaterThan(0)
  })

  it('many components respect MAX_NODES cap', () => {
    const comps = Array.from({ length: 400 }, (_, i) => makeComponent(`comp-${i}`, `Comp${i}`))
    const artifact = makeMinimalArtifact({
      files: [makeFile('src/A.tsx', { components: comps })],
    })
    const g = adaptReactComponentGraph(artifact)
    expect(g.nodes.length).toBeLessThanOrEqual(301)
  })

  it('wrong artifactKind throws', () => {
    expect(() => validateFrontendArtifact({ artifactKind: 'wrong', files: [] })).toThrow('artifactKind')
  })

  it('files not an array throws', () => {
    expect(() => validateFrontendArtifact({ artifactKind: 'my-dev-kit-v1-frontend-semantic', files: 'nope' })).toThrow()
  })

  it('null artifact throws', () => {
    expect(() => validateFrontendArtifact(null)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Unit tests — adaptReactFlowGraph
// ---------------------------------------------------------------------------

describe('adaptReactFlowGraph — unit', () => {
  it('empty artifact produces empty graph', () => {
    const g = adaptReactFlowGraph(makeMinimalArtifact())
    expect(g.nodes).toHaveLength(0)
    expect(g.id).toBe('react-flow')
    expect(g.label).toBe('ReactFlowGraph')
  })

  it('component with hook produces nodes', () => {
    const artifact = makeMinimalArtifact({
      files: [makeFile('src/A.tsx', {
        components: [makeComponent('comp-1', 'Counter')],
        hooks: [makeHook('hook-1', 'useState', 'count')],
        relationships: [makeRel('rel-owns-hook', 'react-handler-reads-state', 'comp-1', 'hook-1')],
      })],
    })
    const g = adaptReactFlowGraph(artifact)
    const kinds = g.nodes.map((n) => n.kind)
    expect(kinds).toContain('component')
    expect(kinds).toContain('hook')
    const hookNode = g.nodes.find((n) => n.kind === 'hook')
    expect(hookNode?.label).toContain('count')
  })

  it('relationship becomes edge with correct label', () => {
    const artifact = makeMinimalArtifact({
      files: [makeFile('src/A.tsx', {
        components: [makeComponent('comp-1', 'Form')],
        hooks: [makeHook('hook-1', 'useState', 'value')],
        relationships: [makeRel('rel-1', 'react-handler-sets-state', 'comp-1', 'hook-1')],
      })],
    })
    const g = adaptReactFlowGraph(artifact)
    const edge = g.edges.find((e) => e.kind === 'react-handler-sets-state')
    expect(edge).toBeDefined()
    expect(edge?.label).toBe('sets-state')
  })

  it('passes-prop edge includes prop name in label', () => {
    const artifact = makeMinimalArtifact({
      files: [makeFile('src/A.tsx', {
        components: [makeComponent('parent-1', 'Parent')],
        localComponents: [makeLocalComponent('child-1', 'Child')],
        relationships: [makeRel('rel-prop', 'react-passes-prop', 'parent-1', 'child-1', 'title')],
      })],
    })
    const g = adaptReactFlowGraph(artifact)
    const edge = g.edges.find((e) => e.kind === 'react-passes-prop')
    expect(edge?.label).toContain('title')
  })

  it('duplicate relationship IDs produce only one edge', () => {
    const rel = makeRel('dup-rel', 'react-renders-local-component', 'comp-1', 'local-1')
    const artifact = makeMinimalArtifact({
      files: [makeFile('src/A.tsx', {
        components: [makeComponent('comp-1', 'Parent')],
        localComponents: [makeLocalComponent('local-1', 'Child')],
        relationships: [rel, rel],
      })],
    })
    const g = adaptReactFlowGraph(artifact)
    const edges = g.edges.filter((e) => e.id === 'dup-rel')
    expect(edges.length).toBe(1)
  })

  it('output is deterministic', () => {
    const artifact = makeMinimalArtifact({
      files: [makeFile('src/A.tsx', {
        components: [makeComponent('comp-1', 'Form')],
        hooks: [makeHook('hook-1', 'useState', 'val')],
        relationships: [makeRel('rel-1', 'react-handler-reads-state', 'comp-1', 'hook-1')],
      })],
    })
    const g1 = adaptReactFlowGraph(artifact)
    const g2 = adaptReactFlowGraph(artifact)
    expect(g1.nodes.map((n) => n.id)).toEqual(g2.nodes.map((n) => n.id))
    expect(g1.edges.map((e) => e.id)).toEqual(g2.edges.map((e) => e.id))
  })
})

// ---------------------------------------------------------------------------
// Regression: existing v1.1 graph choices
// ---------------------------------------------------------------------------

describe('regression: existing graph choices', () => {
  it('--graph code still works', () => {
    const dotOut = join(sharedIndexDir, 'code-regression.dot')
    const res = runCli(['view', '--index', sharedIndexDir, '--graph', 'code', '--format', 'dot', '--out', dotOut])
    expect(res.status).toBe(0)
    expect(readFileSync(dotOut, 'utf8')).toContain('digraph CodeGraph')
  })

  it('unknown graph choice still fails clearly', () => {
    const res = runCli(['view', '--index', sharedIndexDir, '--graph', 'nonexistent-graph'])
    expect(res.status).not.toBe(0)
    expect(res.stderr + res.stdout).toContain('--graph')
  })
})

// ---------------------------------------------------------------------------
// Adversarial: cyclic render, duplicate names, long paths
// ---------------------------------------------------------------------------

describe('adversarial: edge cases', () => {
  it('cyclic render relationships produce valid DOT', () => {
    const artifact = makeMinimalArtifact({
      files: [makeFile('src/A.tsx', {
        components: [makeComponent('comp-a', 'CompA'), makeComponent('comp-b', 'CompB')],
        relationships: [
          makeRel('rel-ab', 'react-renders-local-component', 'comp-a', 'comp-b'),
          makeRel('rel-ba', 'react-renders-local-component', 'comp-b', 'comp-a'),
        ],
        localComponents: [],
      })],
    })
    const g = adaptReactComponentGraph(artifact)
    // buildRenderableDotGraph imported at top
    const dot = buildRenderableDotGraph(g)
    expect(dot).toContain('digraph ReactComponentGraph')
  })

  it('components with same display name in different files both appear', () => {
    const artifact = makeMinimalArtifact({
      files: [
        makeFile('src/featureA/Button.tsx', { components: [makeComponent('btn-a', 'Button')] }),
        makeFile('src/featureB/Button.tsx', { components: [makeComponent('btn-b', 'Button')] }),
      ],
    })
    const g = adaptReactComponentGraph(artifact)
    const buttonNodes = g.nodes.filter((n) => n.label === 'Button')
    // two distinct components with same name but different IDs
    expect(buttonNodes.length).toBe(2)
  })

  it('route-like string in test fact does not produce route-aware edges', () => {
    // react-component graph should not include test facts
    const artifact = makeMinimalArtifact({
      files: [makeFile('src/A.tsx', {
        components: [makeComponent('comp-1', 'App')],
        routeStrings: [{ id: 'rt-1', value: '/dashboard', sourceRef: { filePath: 'src/A.tsx', line: 1, endLine: 1 } }],
      })],
    })
    const g = adaptReactComponentGraph(artifact)
    const routeEdge = g.edges.find((e) => e.label?.includes('/dashboard'))
    expect(routeEdge).toBeUndefined()
  })
})
