import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runFrontendAnalyzer } from '../../src/frontend/frontendAnalyzer.js'
import { addFrontendRelationshipsToCodeGraph } from '../../src/graph/addFrontendRelationshipsToCodeGraph.js'
import { sliceGraph } from '../../src/graph/sliceGraph.js'
import { lookupNode } from '../../src/lookup/lookupNode.js'
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-react-flow-'))
  tempDirs.push(dir)
  return dir
}

function writeFixture(dir: string, relativePath: string, content: string): void {
  const fullPath = join(dir, relativePath)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, content)
}

function stubSymbolIndex(path: string): SymbolIndex {
  return {
    schemaVersion: '2',
    buildTime: '2026-01-01T00:00:00.000Z',
    repoRoot: '/stub',
    sourceRoots: ['src'],
    fileCount: 1,
    symbolCount: 1,
    files: [{
      path,
      language: 'typescript',
      lineCount: 1,
      imports: ['react'],
      exports: ['Parent'],
      symbols: [{
        name: 'Parent',
        kind: 'function',
        exported: true,
        location: { file: path, line: 8 },
        signature: 'export function Parent()',
      }],
      hasCallGraphEntries: false,
    }],
  }
}

function analyze(content: string, path = 'src/Tree.tsx') {
  const dir = makeTempDir()
  writeFixture(dir, path, content)
  return runFrontendAnalyzer({
    symbolIndex: stubSymbolIndex(path),
    repoRoot: dir,
    createdAt: '2026-01-01T00:00:00.000Z',
  }).artifact.files[0]
}

function graphWithFrontend(file = analyze(flowFixture())): CodeGraph {
  return addFrontendRelationshipsToCodeGraph({
    artifactKind: 'code-graph',
    schemaVersion: '1.0.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    nodes: [
      { id: 'file:src/Tree.tsx', kind: 'file', label: 'Tree.tsx', path: 'src/Tree.tsx' },
      { id: 'symbol:src/Tree.tsx#Parent', kind: 'symbol', label: 'Parent', path: 'src/Tree.tsx', symbolName: 'Parent', symbolKind: 'function', line: 8, exported: true },
    ],
    edges: [{ id: 'file:src/Tree.tsx--defines-->symbol:src/Tree.tsx#Parent', source: 'file:src/Tree.tsx', target: 'symbol:src/Tree.tsx#Parent', kind: 'defines' }],
    summary: { nodeCount: 2, edgeCount: 1, fileNodeCount: 1, symbolNodeCount: 1 },
  }, {
    artifactKind: 'my-dev-kit-v1-frontend-semantic',
    schemaVersion: '1.0.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    files: [file],
    summary: {
      fileCount: 1,
      jsxFileCount: 1,
      testFileCount: 0,
      componentCount: file.components.length + file.localComponents.length,
      hookCount: file.hooks.length,
      testBlockCount: 0,
      uiStringCount: file.uiStrings.length,
      relationshipCount: file.relationships.length,
      locatorCount: 0,
      warningCount: 0,
      errorCount: 0,
    },
    warnings: [],
  })
}

function kinds(file: ReturnType<typeof analyze>) {
  return file.relationships.map((relationship) => relationship.kind)
}

function flowFixture(): string {
  return `
    import React from 'react'

    interface ChildProps {
      label: string
      onSelect?: (id: string) => void
    }

    export function Parent() {
      const [selected, setSelected] = React.useState(false)
      const buildLabel = () => selected ? 'yes' : 'no'
      const handleSelect = () => {
        if (selected) setSelected(false)
      }
      function Child({ label, onSelect = () => {} }: ChildProps) {
        function GrandChild({ onSelect }: { onSelect: () => void }) {
          return <button onClick={() => onSelect()}>{label}</button>
        }
        return <GrandChild onSelect={onSelect} />
      }
      return (
        <>
          {selected && <Child label={buildLabel()} onSelect={handleSelect} />}
          <Child label="static" onSelect={() => setSelected(true)} />
        </>
      )
    }

    function Sibling() {
      return <ImportedChild label="external" />
    }
  `
}

describe('local React flow relationships', () => {
  it('records local child render, prop passing, callback passing, helper, callback invocation, event, state, and prop reference relationships', () => {
    const file = analyze(flowFixture())

    expect(kinds(file)).toContain('react-renders-local-component')
    expect(kinds(file)).toContain('react-passes-prop')
    expect(kinds(file)).toContain('react-passes-callback-prop')
    expect(kinds(file)).toContain('react-callback-invoked-by-child')
    expect(kinds(file)).toContain('react-event-uses-handler')
    expect(kinds(file)).toContain('react-handler-reads-state')
    expect(kinds(file)).toContain('react-handler-sets-state')
    expect(kinds(file)).toContain('react-state-controls-jsx-branch')
    expect(kinds(file)).toContain('react-helper-computes-prop')
    expect(kinds(file)).toContain('react-prop-reference')
  })

  it('records prop names and source-backed removed-prop reference candidates', () => {
    const file = analyze(flowFixture())
    const references = file.relationships.filter((relationship) => relationship.kind === 'react-prop-reference')

    expect(references.some((relationship) => relationship.propName === 'onSelect' && relationship.metadata?.referenceKind === 'parent-jsx-prop')).toBe(true)
    expect(references.some((relationship) => relationship.propName === 'onSelect' && relationship.metadata?.referenceKind === 'destructured-prop')).toBe(true)
    expect(references.some((relationship) => relationship.propName === 'onSelect' && relationship.metadata?.referenceKind === 'callback-pass-through')).toBe(true)
    expect(references.every((relationship) => relationship.sourceRef.filePath === 'src/Tree.tsx')).toBe(true)
  })

  it('handles multiple local children, child declared after parent usage, conditional JSX, mapped JSX, object props, and clear object spread', () => {
    const file = analyze(`
      export function Parent() {
        const cards = [{ id: 'a' }]
        const handleOpen = () => {}
        return (
          <>
            {cards.map(card => <Card key={card.id} model={{ id: card.id }} onOpen={handleOpen} />)}
            {cards.length > 0 ? <Late {...{ title: 'later', onOpen: handleOpen }} /> : null}
          </>
        )
      }
      function Card({ model, onOpen }: { model: { id: string }, onOpen: () => void }) {
        return <button onClick={onOpen}>{model.id}</button>
      }
      function Late({ title, onOpen }: { title: string, onOpen: () => void }) {
        return <button onClick={() => onOpen()}>{title}</button>
      }
    `)

    const renderedChildren = file.relationships
      .filter((relationship) => relationship.kind === 'react-renders-local-component')
      .map((relationship) => relationship.metadata?.childName)
    expect(renderedChildren).toEqual(expect.arrayContaining(['Card', 'Late']))
    expect(file.relationships.some((relationship) => relationship.propName === 'model' && relationship.valueSummary?.includes('{ id: card.id }'))).toBe(true)
    expect(file.relationships.some((relationship) => relationship.propName === 'title' && relationship.metadata?.spread === true)).toBe(true)
  })

  it('omits imported, lowercase, dynamic, member-expression, and unknown-spread child relationships conservatively', () => {
    const file = analyze(`
      import { ImportedChild } from './external'
      export function Parent({ Component, props }: { Component: any, props: any }) {
        return <>
          <div />
          <ImportedChild label="external" />
          <Component />
          <Foo.Bar />
          <Local {...props} />
        </>
      }
      function Local({ label }: { label?: string }) {
        return <span>{label}</span>
      }
    `)

    const renderEdges = file.relationships.filter((relationship) => relationship.kind === 'react-renders-local-component')
    expect(renderEdges).toHaveLength(1)
    expect(renderEdges[0].metadata?.childName).toBe('Local')
    expect(file.relationships.some((relationship) => relationship.metadata?.spread === true)).toBe(false)
  })

  it('keeps non-TSX files and React-like utilities from producing relationships', () => {
    const file = analyze(`
      export function makeButton() {
        return { type: 'button', props: { onClick: () => {} } }
      }
    `, 'src/not-react.ts')

    expect(file.components).toHaveLength(0)
    expect(file.relationships).toHaveLength(0)
  })

  it('preserves relationships through lookup and slice graph traversal', () => {
    const graph = graphWithFrontend()
    const lookup = lookupNode({
      graph,
      indexDir: '.my-dev-kit',
      nodeId: 'symbol:src/Tree.tsx#Parent',
      depth: 2,
      manifestPath: '.my-dev-kit/manifest.json',
      codeGraphPath: '.my-dev-kit/code-graph.json',
    })
    const slice = sliceGraph({ graph, focusNodeId: 'symbol:src/Tree.tsx#Parent', depth: 2, direction: 'both' })

    expect(lookup.outgoingEdges.some((edge) => edge.kind === 'react-renders-local-component')).toBe(true)
    expect(slice.edges.some((edge) => edge.kind === 'react-passes-callback-prop' && edge.metadata?.propName === 'onSelect')).toBe(true)
    expect(slice.nodes.some((node) => node.kind === 'frontend-fact' && node.frontendFactKind === 'local-react-component')).toBe(true)
  })
})
