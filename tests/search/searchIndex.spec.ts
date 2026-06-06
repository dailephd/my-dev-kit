import { describe, expect, it } from 'vitest'
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'
import type { ResolvedIndexManifest } from '../../src/indexing/readIndexManifest.js'
import { normalizeSearchQuery } from '../../src/search/rankSearchResults.js'
import { searchIndex } from '../../src/search/searchIndex.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'

describe('searchIndex', () => {
  it('normalizes query terms deterministically', () => {
    expect(normalizeSearchQuery(' Service, createUser! ')).toEqual(['service', 'createuser'])
  })

  it('finds path matches', () => {
    const result = runSearch('service')
    expect(result.results.some((item) => item.kind === 'file' && item.path === 'src/service.ts')).toBe(true)
  })

  it('boosts symbol-name matches', () => {
    const result = runSearch('createUser')
    expect(result.results[0]).toMatchObject({
      kind: 'symbol',
      id: 'symbol:src/service.ts#createUser',
    })
    expect(result.results[0]?.matchReasons.some((reason) => reason.field === 'symbolName')).toBe(true)
  })

  it('finds export matches', () => {
    const result = runSearch('UserRole')
    const exported = result.results.find((item) => item.id === 'symbol:src/types.ts#UserRole')
    expect(exported?.matchReasons.some((reason) => reason.field === 'export')).toBe(true)
  })

  it('finds import matches', () => {
    const result = runSearch('./types')
    const file = result.results.find((item) => item.id === 'file:src/service.ts')
    expect(file?.matchReasons.some((reason) => reason.field === 'import')).toBe(true)
  })

  it('finds edge kind and endpoint matches without dominating symbol matches', () => {
    const edgeKind = runSearch('imports')
    expect(edgeKind.results.some((item) => item.kind === 'edge' && item.edge?.kind === 'imports')).toBe(true)

    const endpoint = runSearch('src/types.ts')
    expect(endpoint.results.some((item) => item.kind === 'edge' && item.matchReasons.some((reason) => reason.field === 'neighbor'))).toBe(true)
  })

  it('applies deterministic ranking and limit', () => {
    const first = runSearch('user', 3).results.map((item) => item.id)
    const second = runSearch('user', 3).results.map((item) => item.id)
    expect(first).toEqual(second)
    expect(first).toHaveLength(3)
  })

  it('fails clearly for an empty query', () => {
    expect(() => runSearch('   ')).toThrow('Search query must include at least one non-empty term.')
  })

  it('returns a valid empty result when there are no matches', () => {
    const result = runSearch('definitelymissing')
    expect(result.results).toEqual([])
    expect(result.summary).toMatchObject({
      resultCount: 0,
      searchedFileCount: 3,
      searchedSymbolCount: 3,
      searchedEdgeCount: 5,
    })
  })
})

function runSearch(query: string, limit = 20) {
  return searchIndex({
    resolved: fixtureResolved(),
    symbolIndex: fixtureSymbolIndex(),
    codeGraph: fixtureCodeGraph(),
    query,
    limit,
    createdAt: '2026-05-12T00:00:00.000Z',
  })
}

function fixtureResolved(): ResolvedIndexManifest {
  return {
    indexDir: '/repo/.my-dev-kit-v1',
    manifestPath: '/repo/.my-dev-kit-v1/manifest.json',
    manifest: {
      artifactKind: 'my-dev-kit-v1-manifest',
      version: '1.0.0',
      createdAt: '2026-05-12T00:00:00.000Z',
      projectRoot: '/repo',
      sourceRoots: ['src'],
      languages: ['typescript'],
      callGraphEnabled: false,
      artifacts: {
        symbolIndex: 'symbol-index.json',
        codeGraph: 'code-graph.json',
        callGraph: null,
      },
      summary: {
        fileCount: 3,
        symbolCount: 3,
        edgeCount: 5,
        warningCount: 0,
        errorCount: 0,
      },
      warnings: [],
      errors: [],
    },
    artifactPaths: {
      symbolIndex: '/repo/.my-dev-kit-v1/symbol-index.json',
      codeGraph: '/repo/.my-dev-kit-v1/code-graph.json',
      callGraph: null,
    },
    semanticArtifactPaths: {
      dataModel: null,
      dataModelGraph: null,
      modelViewLineage: null,
    },
  }
}

function fixtureSymbolIndex(): SymbolIndex {
  return {
    schemaVersion: '2',
    buildTime: '2026-05-12T00:00:00.000Z',
    repoRoot: '/repo',
    sourceRoots: ['src'],
    fileCount: 3,
    symbolCount: 3,
    files: [
      {
        path: 'src/index.ts',
        language: 'typescript',
        lineCount: 2,
        imports: ['./service'],
        exports: [],
        symbols: [],
        hasCallGraphEntries: false,
      },
      {
        path: 'src/service.ts',
        language: 'typescript',
        lineCount: 4,
        imports: ['./types'],
        exports: ['createUser'],
        symbols: [
          {
            name: 'createUser',
            kind: 'function',
            location: { file: 'src/service.ts', line: 3 },
            exported: true,
            signature: 'export function createUser(): User',
          },
        ],
        hasCallGraphEntries: false,
      },
      {
        path: 'src/types.ts',
        language: 'typescript',
        lineCount: 3,
        imports: [],
        exports: ['User', 'UserRole'],
        symbols: [
          {
            name: 'User',
            kind: 'interface',
            location: { file: 'src/types.ts', line: 1 },
            exported: true,
          },
          {
            name: 'UserRole',
            kind: 'type',
            location: { file: 'src/types.ts', line: 2 },
            exported: true,
          },
        ],
        hasCallGraphEntries: false,
      },
    ],
    graph: {
      fileDeps: [
        { from: 'src/index.ts', to: 'src/service.ts', kind: 'import' },
        { from: 'src/service.ts', to: 'src/types.ts', kind: 'import' },
      ],
      symbols: [],
    },
  }
}

function fixtureCodeGraph(): CodeGraph {
  return {
    artifactKind: 'code-graph',
    schemaVersion: '1.0.0',
    createdAt: '2026-05-12T00:00:00.000Z',
    nodes: [
      { id: 'file:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts', language: 'typescript' },
      { id: 'file:src/service.ts', kind: 'file', label: 'service.ts', path: 'src/service.ts', language: 'typescript' },
      { id: 'file:src/types.ts', kind: 'file', label: 'types.ts', path: 'src/types.ts', language: 'typescript' },
      {
        id: 'symbol:src/service.ts#createUser',
        kind: 'symbol',
        label: 'createUser',
        path: 'src/service.ts',
        symbolName: 'createUser',
        symbolKind: 'function',
        line: 3,
        exported: true,
      },
      {
        id: 'symbol:src/types.ts#User',
        kind: 'symbol',
        label: 'User',
        path: 'src/types.ts',
        symbolName: 'User',
        symbolKind: 'interface',
        line: 1,
        exported: true,
      },
      {
        id: 'symbol:src/types.ts#UserRole',
        kind: 'symbol',
        label: 'UserRole',
        path: 'src/types.ts',
        symbolName: 'UserRole',
        symbolKind: 'type',
        line: 2,
        exported: true,
      },
    ],
    edges: [
      { id: 'file:src/index.ts--imports-->file:src/service.ts', source: 'file:src/index.ts', target: 'file:src/service.ts', kind: 'imports', label: 'import' },
      { id: 'file:src/service.ts--imports-->file:src/types.ts', source: 'file:src/service.ts', target: 'file:src/types.ts', kind: 'imports', label: 'import' },
      { id: 'file:src/service.ts--exports-->symbol:src/service.ts#createUser', source: 'file:src/service.ts', target: 'symbol:src/service.ts#createUser', kind: 'exports' },
      { id: 'file:src/types.ts--exports-->symbol:src/types.ts#User', source: 'file:src/types.ts', target: 'symbol:src/types.ts#User', kind: 'exports' },
      { id: 'file:src/types.ts--exports-->symbol:src/types.ts#UserRole', source: 'file:src/types.ts', target: 'symbol:src/types.ts#UserRole', kind: 'exports' },
    ],
    summary: {
      nodeCount: 6,
      edgeCount: 5,
      fileNodeCount: 3,
      symbolNodeCount: 3,
    },
  }
}
