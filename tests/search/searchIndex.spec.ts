import { describe, expect, it } from 'vitest'
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'
import type { ResolvedIndexManifest } from '../../src/indexing/readIndexManifest.js'
import { normalizeSearchQuery } from '../../src/search/rankSearchResults.js'
import { searchIndex } from '../../src/search/searchIndex.js'
import type { SearchIndexResult } from '../../src/search/searchTypes.js'
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

  it('finds semantic role matches and returns compact semantic metadata', () => {
    const result = runSearch('data-entity')
    const user = result.results.find((item) => item.id === 'symbol:src/types.ts#User')

    expect(user?.semanticRoles?.[0]).toMatchObject({
      role: 'data-entity',
      subtype: 'canonical-type',
    })
    expect(user?.artifactRefs).toEqual([
      {
        artifact: 'data-model.json',
        artifactKind: 'data-model',
        id: 'entity:User',
      },
    ])
    expect(user?.matchReasons.some((reason) => reason.field === 'semanticRole')).toBe(true)
    expect(JSON.stringify(user)).not.toContain('"fields"')
    expect(JSON.stringify(user)).not.toContain('"relationships"')
  })

  it('finds semantic subtype matches conservatively', () => {
    const result = runSearch('canonical-type')
    const user = result.results.find((item) => item.id === 'symbol:src/types.ts#User')

    expect(user?.matchReasons.some((reason) => reason.field === 'semanticSubtype')).toBe(true)
  })

  it('finds semantic artifact reference matches without loading detailed artifacts', () => {
    const result = runSearch('entity:User')
    const user = result.results.find((item) => item.id === 'symbol:src/types.ts#User')

    expect(user?.matchReasons.some((reason) => reason.field === 'semanticArtifactRef')).toBe(true)
    expect(user?.artifactRefs?.[0]?.id).toBe('entity:User')
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

describe('searchIndex ownership intent', () => {
  const ownerId = 'symbol:src/widgetEngine.ts#renderWidget'

  function ownership(query: string, limit = 50, intent: 'ownership' | 'relevance' | 'omitted' = 'ownership'): SearchIndexResult {
    return searchIndex({
      resolved: fixtureResolved(),
      symbolIndex: ownershipSymbolIndex(),
      codeGraph: { artifactKind: 'code-graph', schemaVersion: '1.0.0', createdAt: '2026-05-12T00:00:00.000Z', nodes: [], edges: [] } as unknown as CodeGraph,
      query,
      limit,
      intent: intent === 'omitted' ? undefined : intent,
      createdAt: '2026-05-12T00:00:00.000Z',
    })
  }

  const tierOf = (result: SearchIndexResult, id: string) => result.results.find((item) => item.id === id)?.ownership?.tier

  it('assigns direct-owner to a matching non-test symbol with symbolName evidence', () => {
    const result = ownership('widget')
    expect(result.intent).toBe('ownership')
    const owner = result.results.find((item) => item.id === ownerId)
    expect(owner?.ownership).toEqual({
      tier: 'direct-owner',
      lexicalScore: owner?.score,
      evidence: [{ kind: 'direct-symbol-name', sourceId: ownerId }],
    })
  })

  it('assigns direct-owner from established safe-primary-edit-target classification', () => {
    const result = ownership('widget')
    expect(result.results.find((item) => item.id === 'symbol:src/widgetPanel.ts#panel')?.ownership).toMatchObject({
      tier: 'direct-owner',
      evidence: [{ kind: 'classified-primary-edit', sourceId: 'symbol:src/widgetPanel.ts#panel' }],
    })
  })

  it('keeps a filename-only match and uncertain classification as production-candidate', () => {
    const result = ownership('widget')
    expect(tierOf(result, 'file:src/widgetHelpers.ts')).toBe('production-candidate')
    expect(tierOf(result, 'symbol:src/widgetHelpers.ts#helper')).toBe('production-candidate')
    expect(tierOf(result, 'symbol:src/widgetUncertain.ts#thing')).toBe('production-candidate')
    expect(result.results.find((item) => item.id === 'file:src/widgetHelpers.ts')?.ownership?.evidence).toEqual([
      { kind: 'production-lexical-match', sourceId: 'file:src/widgetHelpers.ts' },
    ])
  })

  it('keeps tests, fixtures, generated and docs results as supporting evidence only', () => {
    const result = ownership('widget')
    for (const id of [
      'symbol:tests/widget.spec.ts#widget',
      'file:tests/widget.spec.ts',
      'symbol:tests/fixtures/widgetFixture.ts#widgetFixture',
      'symbol:src/generated/widgetGen.ts#widgetGen',
      'file:docs/widget.md',
      'symbol:src/widgetDocsOnly.ts#docsOnly',
    ]) {
      expect(tierOf(result, id)).toBe('supporting-evidence')
    }
  })

  it('orders direct-owner, production-candidate, then supporting evidence with lexical order inside tiers', () => {
    const result = ownership('widget')
    const rank = { 'direct-owner': 0, 'production-candidate': 1, 'supporting-evidence': 2 } as const
    const tiers = result.results.map((item) => rank[item.ownership!.tier])
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b))
    for (let i = 1; i < result.results.length; i += 1) {
      const prev = result.results[i - 1]!
      const next = result.results[i]!
      if (prev.ownership!.tier === next.ownership!.tier) expect(prev.score).toBeGreaterThanOrEqual(next.score)
    }
  })

  it('preserves lexical score and matchReasons exactly relative to relevance mode', () => {
    const relevance = ownership('widget', 50, 'omitted')
    const owned = ownership('widget')
    expect(owned.results.length).toBe(relevance.results.length)
    const byId = new Map(relevance.results.map((item) => [item.id, item]))
    for (const item of owned.results) {
      const original = byId.get(item.id)!
      expect(item.score).toBe(original.score)
      expect(item.matchReasons).toEqual(original.matchReasons)
      expect(item.ownership?.lexicalScore).toBe(original.score)
    }
  })

  it('applies the result limit only after ownership ranking', () => {
    const relevance = ownership('widget', 1, 'omitted')
    expect(relevance.results[0]?.id).toBe('symbol:tests/widget.spec.ts#widget')
    const owned = ownership('widget', 1)
    expect(owned.results).toHaveLength(1)
    expect(owned.results[0]?.ownership?.tier).toBe('direct-owner')
  })

  it('does not alter relevance output and omits intent and ownership metadata', () => {
    const omitted = ownership('widget', 20, 'omitted')
    const explicit = ownership('widget', 20, 'relevance')
    expect(JSON.stringify(explicit)).toBe(JSON.stringify(omitted))
    expect('intent' in omitted).toBe(false)
    expect(omitted.results.every((item) => !('ownership' in item))).toBe(true)
  })

  it('is deterministic for fixed inputs', () => {
    expect(JSON.stringify(ownership('widget'))).toBe(JSON.stringify(ownership('widget')))
  })

  it('does not introduce zero-lexical candidates', () => {
    expect(ownership('zzzznomatch').results).toEqual([])
  })
})

function ownershipSymbolIndex(): SymbolIndex {
  const sym = (file: string, name: string, extra: Record<string, unknown> = {}) => ({
    name,
    kind: 'function' as const,
    location: { file, line: 1 },
    exported: false,
    ...extra,
  })
  const file = (path: string, symbols: ReturnType<typeof sym>[] = []) => ({
    path,
    language: 'typescript' as const,
    lineCount: 5,
    imports: [],
    exports: [],
    symbols,
    hasCallGraphEntries: false,
  })
  const role = (editGuidance: string) => [
    { role: 'command-handler', editGuidance, readiness: 'ready', uncertainty: 'certain' },
  ]
  const files = [
    file('src/widgetEngine.ts', [sym('src/widgetEngine.ts', 'renderWidget')]),
    file('src/widgetPanel.ts', [
      sym('src/widgetPanel.ts', 'panel', { classificationRoles: role('safe-primary-edit-target') }),
    ]),
    file('src/widgetHelpers.ts', [sym('src/widgetHelpers.ts', 'helper')]),
    file('src/widgetUncertain.ts', [
      sym('src/widgetUncertain.ts', 'thing', { classificationRoles: role('uncertain') }),
    ]),
    file('src/widgetDocsOnly.ts', [
      sym('src/widgetDocsOnly.ts', 'docsOnly', { classificationRoles: role('docs-only') }),
    ]),
    file('src/generated/widgetGen.ts', [sym('src/generated/widgetGen.ts', 'widgetGen')]),
    file('tests/widget.spec.ts', [
      sym('tests/widget.spec.ts', 'widget', { exported: true, signature: 'function widget(): widget' }),
    ]),
    file('tests/fixtures/widgetFixture.ts', [sym('tests/fixtures/widgetFixture.ts', 'widgetFixture')]),
    file('docs/widget.md'),
  ]
  return {
    schemaVersion: '2',
    buildTime: '2026-05-12T00:00:00.000Z',
    repoRoot: '/repo',
    sourceRoots: ['src', 'tests'],
    fileCount: files.length,
    symbolCount: files.reduce((n, f) => n + f.symbols.length, 0),
    files,
  } as unknown as SymbolIndex
}

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
      frontendSemantic: null,
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
            semanticRoles: [
              {
                role: 'data-entity',
                subtype: 'canonical-type',
                confidence: 'explicit',
                source: 'typescript-model-analyzer',
                artifactRefs: [
                  {
                    artifact: 'data-model.json',
                    artifactKind: 'data-model',
                    id: 'entity:User',
                  },
                ],
                evidenceRefs: [
                  {
                    filePath: 'src/types.ts',
                    symbolId: 'symbol:src/types.ts#User',
                    line: 1,
                    source: 'typescript-model-analyzer',
                  },
                ],
              },
            ],
            artifactRefs: [
              {
                artifact: 'data-model.json',
                artifactKind: 'data-model',
                id: 'entity:User',
              },
            ],
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
        semanticRoles: [
          {
            role: 'data-entity',
            subtype: 'canonical-type',
            confidence: 'explicit',
            source: 'typescript-model-analyzer',
            artifactRefs: [
              {
                artifact: 'data-model.json',
                artifactKind: 'data-model',
                id: 'entity:User',
              },
            ],
            evidenceRefs: [
              {
                filePath: 'src/types.ts',
                symbolId: 'symbol:src/types.ts#User',
                line: 1,
                source: 'typescript-model-analyzer',
              },
            ],
          },
        ],
        artifactRefs: [
          {
            artifact: 'data-model.json',
            artifactKind: 'data-model',
            id: 'entity:User',
          },
        ],
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
