import { readFileSync } from 'node:fs'
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

describe('searchIndex ownership recovery (v1.12.6 Batch 2)', () => {
  interface RecoveryFile {
    path: string
    imports?: string[]
    symbols?: string[]
  }

  function recoveryIndex(files: RecoveryFile[], fileDeps: Array<{ from: string; to: string }> = []): SymbolIndex {
    const summaries = files.map((file) => ({
      path: file.path,
      language: 'typescript' as const,
      lineCount: 5,
      imports: file.imports ?? [],
      exports: [],
      symbols: (file.symbols ?? []).map((name) => ({
        name,
        kind: 'function' as const,
        location: { file: file.path, line: 1 },
        exported: false,
      })),
      hasCallGraphEntries: false,
    }))
    return {
      schemaVersion: '2',
      buildTime: '2026-05-12T00:00:00.000Z',
      repoRoot: '/repo',
      sourceRoots: ['src', 'tests'],
      fileCount: summaries.length,
      symbolCount: 0,
      files: summaries,
      graph: { fileDeps: fileDeps.map((dep) => ({ ...dep, kind: 'import' })), symbols: [] },
    } as unknown as SymbolIndex
  }

  function run(
    files: RecoveryFile[],
    options: { fileDeps?: Array<{ from: string; to: string }>; edges?: Array<{ source: string; target: string; kind: string }>; limit?: number; intent?: 'ownership' | 'relevance' } = {},
  ): SearchIndexResult {
    return searchIndex({
      resolved: fixtureResolved(),
      symbolIndex: recoveryIndex(files, options.fileDeps),
      codeGraph: {
        artifactKind: 'code-graph',
        schemaVersion: '1.0.0',
        createdAt: '2026-05-12T00:00:00.000Z',
        nodes: [],
        edges: (options.edges ?? []).map((edge, index) => ({ id: `e${index}`, ...edge })),
      } as unknown as CodeGraph,
      query: 'gizmo',
      limit: options.limit ?? 100,
      intent: options.intent ?? 'ownership',
      createdAt: '2026-05-12T00:00:00.000Z',
    })
  }

  const find = (result: SearchIndexResult, id: string) => result.results.find((item) => item.id === id)
  const spec = (name: string, imports: string[]): RecoveryFile => ({ path: `tests/${name}.gizmo.spec.ts`, imports })

  it('recovers a lexically silent production file through a NodeNext .js import with inspectable evidence', () => {
    const result = run([spec('a', ['../src/engine.js']), { path: 'src/engine.ts' }])
    const owner = find(result, 'file:src/engine.ts')
    expect(owner?.score).toBe(0)
    expect(owner?.matchReasons).toEqual([])
    expect(owner?.ownership?.tier).toBe('production-candidate')
    expect(owner?.ownership?.lexicalScore).toBe(0)
    expect(owner?.ownership?.evidence).toEqual([
      {
        kind: 'resolved-relative-import',
        sourceId: 'file:tests/a.gizmo.spec.ts',
        seedPath: 'tests/a.gizmo.spec.ts',
        targetPath: 'src/engine.ts',
        specifier: '../src/engine.js',
      },
    ])
    expect(find(run([spec('a', ['../src/engine.js']), { path: 'src/engine.ts' }], { intent: 'relevance' }), 'file:src/engine.ts')).toBeUndefined()
  })

  it('recovers .js -> .tsx and .jsx -> .tsx sources', () => {
    const result = run([spec('a', ['../src/Panel.js', '../src/Card.jsx']), { path: 'src/Panel.tsx' }, { path: 'src/Card.tsx' }])
    expect(find(result, 'file:src/Panel.tsx')).toBeDefined()
    expect(find(result, 'file:src/Card.tsx')).toBeDefined()
  })

  it('keeps an exact indexed .js target ahead of its .ts correspondence, and supports extensionless and index imports', () => {
    const result = run([
      spec('a', ['../src/exact.js', '../src/bare', '../src/pkg']),
      { path: 'src/exact.js' },
      { path: 'src/exact.ts' },
      { path: 'src/bare.ts' },
      { path: 'src/pkg/index.ts' },
    ])
    expect(find(result, 'file:src/exact.js')).toBeDefined()
    expect(find(result, 'file:src/exact.ts')).toBeUndefined()
    expect(find(result, 'file:src/bare.ts')).toBeDefined()
    expect(find(result, 'file:src/pkg/index.ts')).toBeDefined()
  })

  it('recovers through indexed file dependencies and file-to-file import edges without double counting', () => {
    const result = run(
      [spec('a', ['../src/engine.js']), { path: 'src/engine.ts' }, { path: 'src/viaDep.ts' }, { path: 'src/viaEdge.ts' }],
      {
        fileDeps: [
          { from: 'tests/a.gizmo.spec.ts', to: 'src/engine.ts' },
          { from: 'tests/a.gizmo.spec.ts', to: 'src/engine.ts' },
          { from: 'tests/a.gizmo.spec.ts', to: 'src/viaDep.ts' },
        ],
        edges: [
          { source: 'file:tests/a.gizmo.spec.ts', target: 'file:src/viaEdge.ts', kind: 'depends-on' },
          { source: 'file:tests/a.gizmo.spec.ts', target: 'file:src/viaEdge.ts', kind: 'imports' },
          { source: 'file:tests/a.gizmo.spec.ts', target: 'file:src/viaDep.ts', kind: 'calls' },
        ],
      },
    )
    expect(result.results.filter((item) => item.id === 'file:src/engine.ts')).toHaveLength(1)
    expect(find(result, 'file:src/engine.ts')?.ownership?.evidence.map((e) => e.kind)).toEqual([
      'indexed-file-dependency',
      'resolved-relative-import',
    ])
    expect(find(result, 'file:src/viaDep.ts')?.ownership?.evidence.map((e) => e.kind)).toEqual(['indexed-file-dependency'])
    expect(find(result, 'file:src/viaEdge.ts')?.ownership?.evidence.map((e) => e.kind)).toEqual(['indexed-file-dependency'])
  })

  it('promotes only with own lexical relevance or two distinct seeds, retaining original lexical score', () => {
    const files: RecoveryFile[] = [
      spec('a', ['../src/solo.js', '../src/shared.js', '../src/gizmoCore.js']),
      spec('b', ['../src/shared.js']),
      { path: 'src/solo.ts' },
      { path: 'src/shared.ts' },
      { path: 'src/gizmoCore.ts' },
    ]
    const result = run(files)
    expect(find(result, 'file:src/solo.ts')?.ownership?.tier).toBe('production-candidate')
    expect(find(result, 'file:src/shared.ts')?.ownership?.tier).toBe('direct-owner')
    const lexical = find(result, 'file:src/gizmoCore.ts')
    expect(lexical?.ownership?.tier).toBe('direct-owner')
    const relevance = find(run(files, { intent: 'relevance' }), 'file:src/gizmoCore.ts')
    expect(lexical?.score).toBe(relevance?.score)
    expect(lexical?.matchReasons).toEqual(relevance?.matchReasons)
  })

  it('does not recover test, fixture, generated, doc, external, missing, or unsupported-extension targets', () => {
    const result = run([
      spec('a', [
        './other.spec.js',
        '../tests/fixtures/data.js',
        '../src/generated/api.js',
        '../docs/guide.js',
        'vitest',
        '@scope/pkg',
        '../src/missing.js',
        '../src/esm.mjs',
      ]),
      { path: 'tests/other.spec.ts' },
      { path: 'tests/fixtures/data.ts' },
      { path: 'src/generated/api.ts' },
      { path: 'docs/guide.ts' },
      { path: 'src/esm.mts' },
    ])
    const recoveredIds = result.results.filter((item) => item.score === 0).map((item) => item.id)
    expect(recoveredIds).toEqual([])
  })

  it('does not recover in the wrong direction, nor beyond one file hop', () => {
    const result = run([
      spec('a', ['../src/first.js']),
      { path: 'src/first.ts', imports: ['./second.js'] },
      { path: 'src/second.ts' },
      { path: 'src/importsSeed.ts', imports: ['../tests/a.gizmo.spec.js'] },
    ])
    expect(find(result, 'file:src/first.ts')).toBeDefined()
    expect(find(result, 'file:src/second.ts')).toBeUndefined()
    // It only appears through its own lexical import text; the seed -> owner direction is not inverted.
    expect(find(result, 'file:src/importsSeed.ts')?.ownership?.evidence.map((e) => e.kind)).toEqual(['production-lexical-match'])
  })

  it('does not expand cyclic relationships recursively', () => {
    const result = run([
      { path: 'src/gizmoA.ts', imports: ['./gizmoB.js'] },
      { path: 'src/gizmoB.ts', imports: ['./gizmoA.js', './quiet.js'] },
      { path: 'src/quiet.ts' },
    ])
    expect(find(result, 'file:src/gizmoA.ts')).toBeDefined()
    expect(find(result, 'file:src/quiet.ts')).toBeDefined() // direct import of seed gizmoB
    const quiet = find(result, 'file:src/quiet.ts')
    expect(quiet?.ownership?.evidence.map((e) => e.seedPath)).toEqual(['src/gizmoB.ts'])
  })

  it('associates only lexically relevant same-file symbols and never invents references', () => {
    const result = run([
      spec('a', ['../src/engine.js']),
      { path: 'src/engine.ts', symbols: ['quietHelper', 'gizmoRunner'] },
    ])
    expect(find(result, 'symbol:src/engine.ts#quietHelper')).toBeUndefined()
    const symbol = find(result, 'symbol:src/engine.ts#gizmoRunner')
    expect(symbol?.ownership?.evidence.map((e) => e.kind)).toEqual(['direct-symbol-name', 'same-file-symbol'])
    expect(symbol?.score).toBe(find(run([spec('a', ['../src/engine.js']), { path: 'src/engine.ts', symbols: ['quietHelper', 'gizmoRunner'] }], { intent: 'relevance' }), 'symbol:src/engine.ts#gizmoRunner')?.score)
  })

  it('surfaces a recovered owner within a small limit ahead of weak lexical production matches', () => {
    const result = run(
      [
        spec('a', ['../src/engine.js']),
        spec('b', ['../src/engine.js']),
        { path: 'src/engine.ts' },
        { path: 'src/gizmoNote.ts' },
      ],
      { limit: 3 },
    )
    expect(result.results.map((item) => item.id)).toContain('file:src/engine.ts')
    expect(result.results).toHaveLength(3)
  })

  it('does not count a seed file twice and reports its candidates once', () => {
    const files: RecoveryFile[] = [
      { path: 'tests/multi.gizmo.spec.ts', imports: ['../src/engine.js'], symbols: ['gizmoOne', 'gizmoTwo', 'gizmoThree'] },
      { path: 'src/engine.ts' },
    ]
    const engine = find(run(files), 'file:src/engine.ts')
    expect(engine?.ownership?.evidence).toHaveLength(1)
    expect(engine?.ownership?.tier).toBe('production-candidate')
  })

  it('bounds per-seed recovery at 16 files and reports the truncated count', () => {
    const targets = Array.from({ length: 20 }, (_, i) => `src/t${String(i).padStart(2, '0')}.ts`)
    const files: RecoveryFile[] = [
      spec('a', targets.map((t) => `../${t.replace(/\.ts$/, '.js')}`)),
      ...targets.map((path) => ({ path })),
    ]
    const result = run(files)
    expect(result.results.filter((item) => item.score === 0)).toHaveLength(16)
    expect(find(result, 'file:src/t15.ts')).toBeDefined()
    expect(find(result, 'file:src/t16.ts')).toBeUndefined()
    expect(result.warnings).toEqual([expect.stringContaining('4 supported candidate file(s) omitted')])
  })

  it('bounds distinct recovered files at 128 overall and the seed set at 20', () => {
    const seeds = Array.from({ length: 22 }, (_, s) =>
      spec(`s${String(s).padStart(2, '0')}`, Array.from({ length: 8 }, (_, t) => `../src/m${String(s).padStart(2, '0')}x${t}.js`)),
    )
    const targets = Array.from({ length: 22 * 8 }, (_, i) => ({ path: `src/m${String(Math.floor(i / 8)).padStart(2, '0')}x${i % 8}.ts` }))
    const result = run([...seeds, ...targets], { limit: 500 })
    // 20 expanded seeds * 8 distinct targets = 160 supported files; only 128 are kept.
    expect(result.results.filter((item) => item.score === 0)).toHaveLength(128)
    expect(result.warnings[0]).toContain('32 supported candidate file(s) omitted')
    expect(result.warnings[0]).toContain('2 lexically matching seed file(s) beyond the 20-seed bound')
  })

  it('consumes pure generic predicates without loading context role-candidate or Android policy code', () => {
    const source = readFileSync(new URL('../../src/search/searchIndex.ts', import.meta.url), 'utf8')
    expect(source).toContain("from '../classification/classificationHelpers.js'")
    expect(source).toContain("from '../languages/typescript/resolveRelativeSpecifier.js'")
    expect(source).not.toContain("from '../context/")
    const helpers = readFileSync(new URL('../../src/classification/classificationHelpers.ts', import.meta.url), 'utf8')
    expect(helpers).not.toContain("from '../context/")
    const resolver = readFileSync(new URL('../../src/languages/typescript/resolveRelativeSpecifier.ts', import.meta.url), 'utf8')
    expect(resolver).not.toContain('node:fs')
    expect(resolver).not.toContain("from '../../context/")
  })

  it('is deterministic and leaves relevance output free of recovery data', () => {
    const files: RecoveryFile[] = [spec('a', ['../src/engine.js']), spec('b', ['../src/engine.js']), { path: 'src/engine.ts' }]
    expect(JSON.stringify(run(files))).toBe(JSON.stringify(run(files)))
    const relevance = run(files, { intent: 'relevance' })
    expect(relevance.warnings).toEqual([])
    expect(relevance.results.every((item) => !('ownership' in item))).toBe(true)
  })
})

describe('searchIndex ownership ranking: own lexical relevance before seed breadth (v1.12.6 Batch 2)', () => {
  const query = 'affected neighborhood refresh cache'
  const owner = 'file:src/indexing/affectedNeighborhood.ts'
  const specId = 'file:tests/index/affectedNeighborhoodRefresh.spec.ts'

  function fixture(): SymbolIndex {
    const file = (path: string, imports: string[] = [], exports: string[] = []) => ({
      path,
      language: 'typescript' as const,
      lineCount: 5,
      imports,
      exports,
      symbols: [],
      hasCallGraphEntries: false,
    })
    // The strongest seed imports every production module, so all candidates tie on strongest seed score.
    const files = [
      file('tests/index/affectedNeighborhoodRefresh.spec.ts', [
        '../../src/indexing/cacheMetadata.js',
        '../../src/indexing/affectedNeighborhood.js',
        '../../src/indexing/trustedBaseline.js',
        '../../src/symbol-index/types.js',
        '../../src/indexing/aaaHelper.js',
        '../../src/indexing/zzzHelper.js',
      ]),
      file('tests/index/cacheRefresh.spec.ts', [
        '../../src/indexing/cacheMetadata.js',
        '../../src/indexing/trustedBaseline.js',
        '../../src/symbol-index/types.js',
      ]),
      file('tests/index/partialRefresh.spec.ts', [
        '../../src/indexing/cacheMetadata.js',
        '../../src/indexing/trustedBaseline.js',
        '../../src/symbol-index/types.js',
      ]),
      file('tests/index/refreshTypes.spec.ts', ['../../src/symbol-index/types.js']),
      file('src/indexing/cacheMetadata.ts', [], ['CacheMetadata']),
      file('src/indexing/affectedNeighborhood.ts'),
      file('src/indexing/trustedBaseline.ts', [], ['CacheBaseline']),
      file('src/symbol-index/types.ts', [], ['CacheEntry']),
      file('src/indexing/aaaHelper.ts', [], ['CacheAaa']),
      file('src/indexing/zzzHelper.ts', [], ['CacheZzz']),
    ]
    return {
      schemaVersion: '2',
      buildTime: '2026-05-12T00:00:00.000Z',
      repoRoot: '/repo',
      sourceRoots: ['src', 'tests'],
      fileCount: files.length,
      symbolCount: 0,
      files,
    } as unknown as SymbolIndex
  }

  function run(intent: 'ownership' | 'relevance', limit = 50): SearchIndexResult {
    return searchIndex({
      resolved: fixtureResolved(),
      symbolIndex: fixture(),
      codeGraph: { artifactKind: 'code-graph', schemaVersion: '1.0.0', createdAt: '2026-05-12T00:00:00.000Z', nodes: [], edges: [] } as unknown as CodeGraph,
      query,
      limit,
      intent,
      createdAt: '2026-05-12T00:00:00.000Z',
    })
  }

  const seedCount = (item: SearchIndexResult['results'][number]) =>
    new Set(item.ownership!.evidence.filter((e) => e.seedPath).map((e) => e.seedPath)).size

  it('keeps the directly relevant owner within the top three despite broadly imported weak helpers', () => {
    const result = run('ownership', 3)
    expect(result.results).toHaveLength(3)
    expect(result.results.map((item) => item.id)).toContain(owner)
  })

  it('orders by own lexical score before supporting-seed count, then seed count, then path', () => {
    const result = run('ownership')
    const recovered = result.results.filter((item) => item.id.startsWith('file:src/'))
    expect(recovered.map((item) => item.id)).toEqual([
      'file:src/indexing/cacheMetadata.ts',
      owner,
      'file:src/symbol-index/types.ts',
      'file:src/indexing/trustedBaseline.ts',
      'file:src/indexing/aaaHelper.ts',
      'file:src/indexing/zzzHelper.ts',
    ])
    const byId = new Map(recovered.map((item) => [item.id, item]))
    const owned = byId.get(owner)!
    const helper = byId.get('file:src/symbol-index/types.ts')!
    // Genuinely lower own relevance but broader seed support: ordered after the owner.
    expect(helper.score).toBeLessThan(owned.score)
    expect(seedCount(helper)).toBeGreaterThan(seedCount(owned))
    // Equal own score and seed score: higher seed breadth wins.
    const baseline = byId.get('file:src/indexing/trustedBaseline.ts')!
    expect(baseline.score).toBe(helper.score)
    expect(seedCount(helper)).toBeGreaterThan(seedCount(baseline))
  })

  it('retains lexical score, match reasons, provenance and the relevant test evidence unchanged', () => {
    const owned = run('ownership')
    const relevance = new Map(run('relevance').results.map((item) => [item.id, item]))
    for (const item of owned.results) {
      expect(item.score).toBe(relevance.get(item.id)!.score)
      expect(item.matchReasons).toEqual(relevance.get(item.id)!.matchReasons)
    }
    expect(owned.results.find((item) => item.id === owner)?.ownership?.evidence).toEqual([
      { kind: 'production-lexical-match', sourceId: owner },
      {
        kind: 'resolved-relative-import',
        sourceId: specId,
        seedPath: 'tests/index/affectedNeighborhoodRefresh.spec.ts',
        targetPath: 'src/indexing/affectedNeighborhood.ts',
        specifier: '../../src/indexing/affectedNeighborhood.js',
      },
    ])
    expect(owned.results.find((item) => item.id === specId)?.ownership?.tier).toBe('supporting-evidence')
  })

  it('is deterministic across repeated queries', () => {
    expect(JSON.stringify(run('ownership', 3))).toBe(JSON.stringify(run('ownership', 3)))
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
