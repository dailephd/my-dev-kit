import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 180_000 })

const tempDirs: string[] = []
const OUT = 'cache-out'

function runCli(args: string[]) {
  return spawnSync(process.execPath, [join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
  })
}

/** a.ts <- b.ts (imports a); c.ts is unrelated. */
function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-refresh-scope-'))
  tempDirs.push(root)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'a.ts'), 'export function fa(): number { return 1 }\n')
  writeFileSync(join(root, 'src', 'b.ts'), "import { fa } from './a'\nexport function fb(): number { return fa() + 1 }\n")
  writeFileSync(join(root, 'src', 'c.ts'), 'export function fc(): number { return 3 }\n')
  return root
}

function run(root: string, args: string[] = ['--incremental'], out = OUT) {
  const result = runCli(['index', '--root', root, '--src', 'src', '--out', out, '--json', ...args])
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}

const AFFECTED = ['--incremental', '--refresh-scope', 'affected-neighborhood']
const CHANGED = ['--incremental', '--refresh-scope', 'changed-files']

const write = (root: string, file: string, text: string) => writeFileSync(join(root, 'src', file), text)
const modifyA = (root: string) => write(root, 'a.ts', 'export function fa(): number { return 1 }\nexport function fa2(): number { return 2 }\n')

const readJson = (root: string, file: string, out = OUT) => JSON.parse(readFileSync(join(root, out, file), 'utf8'))
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex')

/**
 * Compares every semantic artifact the minimal a/b/c.ts fixture actually
 * produces, not just symbol-index.json/code-graph.json: the roadmap's v1.12.5
 * acceptance criterion is "equivalent final semantic artifacts", and
 * classification/data-model/frontend-semantic/frontend-reachability are each
 * written for this fixture even though it declares no entities/components
 * (see manifest.semanticArtifacts / manifest.analyzers). Android artifacts
 * are not produced for this fixture (no Android project evidence) and are
 * therefore not applicable to this comparison.
 */
function normalizedArtifacts(root: string, out = OUT) {
  return {
    symbolIndex: { ...readJson(root, 'symbol-index.json', out), buildTime: 'N', repoRoot: 'R' },
    codeGraph: { ...readJson(root, 'code-graph.json', out), createdAt: 'N' },
    classification: { ...readJson(root, 'classification.json', out), createdAt: 'N' },
    dataModel: { ...readJson(root, 'data-model.json', out), createdAt: 'N' },
    dataModelGraph: { ...readJson(root, 'data-model-graph.json', out), createdAt: 'N' },
    frontendSemantic: { ...readJson(root, 'frontend-semantic.json', out), createdAt: 'N' },
    frontendReachability: { ...readJson(root, 'frontend-reachability.json', out), generatedAt: 'N', sourceRoot: 'R' },
  }
}

/** Rewrites an artifact and re-records its SHA-256 in the cache so only graph content, not identity, is at issue. */
function tamperWithRehash(root: string, file: 'symbol-index.json' | 'code-graph.json', mutate: (json: any) => void) {
  const artifact = readJson(root, file)
  mutate(artifact)
  const text = JSON.stringify(artifact)
  writeFileSync(join(root, OUT, file), text)
  const cachePath = join(root, OUT, 'cache-metadata.json')
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'))
  cache.baselineArtifacts[file === 'code-graph.json' ? 'codeGraphSha256' : 'symbolIndexSha256'] = sha(text)
  writeFileSync(cachePath, JSON.stringify(cache))
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('index --refresh-scope CLI contract', () => {
  it.each([
    [['--refresh-scope', 'changed-files'], /--refresh-scope requires --incremental/],
    [['--refresh-scope', 'affected-neighborhood'], /--refresh-scope requires --incremental/],
    [['--incremental', '--refresh-scope', 'invalid-value'], /Unsupported refresh scope "invalid-value".*changed-files, affected-neighborhood/],
    [['--dry-run', '--incremental', '--refresh-scope', 'changed-files'], /cannot be combined with --dry-run/],
    [['--dry-run', '--incremental', '--refresh-scope', 'affected-neighborhood'], /cannot be combined with --dry-run/],
  ])('rejects %j', (args, message) => {
    const root = createRoot()
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', OUT, ...args])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(message)
    expect(existsSync(join(root, OUT, 'manifest.json'))).toBe(false)
  })

  it('accepts all three incremental forms and keeps --dry-run --incremental without a scope unchanged', () => {
    const root = createRoot()
    expect(run(root).incrementalRefresh.requestedScope).toBe('changed-files')
    expect(run(root, CHANGED).incrementalRefresh.requestedScope).toBe('changed-files')
    expect(run(root, AFFECTED).incrementalRefresh.requestedScope).toBe('affected-neighborhood')
    const dry = runCli(['index', '--root', root, '--src', 'src', '--out', OUT, '--dry-run', '--incremental', '--json'])
    expect(dry.status).toBe(0)
    expect(JSON.parse(dry.stdout).mode).toBe('dry-run')
  })

  it('reports incrementalRefresh as null and omits it from the manifest for a plain full index', () => {
    const root = createRoot()
    const plain = run(root, [])
    expect(plain.incrementalRefresh).toBeNull()
    expect(readJson(root, 'manifest.json').incrementalRefresh).toBeUndefined()
  })

  it('prints the refresh result in human-readable output', () => {
    const root = createRoot()
    run(root, AFFECTED)
    modifyA(root)
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', OUT, ...AFFECTED])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Refresh scope: requested=affected-neighborhood applied=affected-neighborhood status=applied')
    expect(result.stdout).toContain('Refresh extraction: fresh=2 reused=1 forced-neighbors=1')
    expect(result.stdout).toContain('Affected neighborhood: seed-files=1 seed-symbols=1')
  })
})

describe('changed-files scope (v1.12.4 behavior)', () => {
  it('plain --incremental and explicit --refresh-scope changed-files behave identically', () => {
    const implicit = createRoot()
    const explicit = createRoot()
    run(implicit)
    run(explicit, CHANGED)
    for (const root of [implicit, explicit]) modifyA(root)

    const a = run(implicit)
    const b = run(explicit, CHANGED)

    expect(a.cache.mode).toBe('incremental-partial')
    expect(b.cache.mode).toBe(a.cache.mode)
    expect(a.incrementalRefresh).toEqual({
      requestedScope: 'changed-files',
      appliedScope: 'changed-files',
      selectionStatus: 'applied',
      fallbackReason: null,
      seedFileCount: null,
      seedSymbolCount: null,
      affectedNodeCount: null,
      affectedEdgeCount: null,
      forcedNeighborReanalysisFileCount: 0,
      forcedNeighborSample: [],
      freshExtractionFileCount: 1,
      reusedFileCount: 2,
    })
    expect(b.incrementalRefresh).toEqual(a.incrementalRefresh)
    expect(normalizedArtifacts(explicit)).toEqual(normalizedArtifacts(implicit))
  })
})

describe('affected-neighborhood scope', () => {
  it('re-extracts the modified file and its direct neighbor, and reuses unrelated files', () => {
    const root = createRoot()
    run(root, AFFECTED)
    modifyA(root)
    const result = run(root, AFFECTED)

    expect(result.cache.mode).toBe('incremental-partial')
    expect(result.incrementalRefresh).toMatchObject({
      requestedScope: 'affected-neighborhood',
      appliedScope: 'affected-neighborhood',
      selectionStatus: 'applied',
      fallbackReason: null,
      seedFileCount: 1,
      seedSymbolCount: 1,
      forcedNeighborReanalysisFileCount: 1,
      forcedNeighborSample: ['src/b.ts'],
      freshExtractionFileCount: 2,
      reusedFileCount: 1,
    })
    expect(Number.isInteger(result.incrementalRefresh.affectedNodeCount)).toBe(true)
    expect(result.incrementalRefresh.affectedEdgeCount).toBeGreaterThan(0)
    expect(readJson(root, 'manifest.json').incrementalRefresh).toEqual(result.incrementalRefresh)
    expect(result.manifest.incrementalRefresh).toEqual(result.incrementalRefresh)
  })

  it('uses a removed file as a baseline seed while it stays absent from the current index', () => {
    const root = createRoot()
    run(root, AFFECTED)
    rmSync(join(root, 'src', 'a.ts'))
    const result = run(root, AFFECTED)

    expect(result.incrementalRefresh).toMatchObject({
      appliedScope: 'affected-neighborhood',
      selectionStatus: 'applied',
      seedFileCount: 1,
      forcedNeighborSample: ['src/b.ts'],
      freshExtractionFileCount: 1,
      reusedFileCount: 1,
    })
    const files = readJson(root, 'symbol-index.json').files.map((file: { path: string }) => file.path)
    expect(files).toEqual(['src/b.ts', 'src/c.ts'])
  })

  it('applies (not falls back) for an added-only change, with zero seeds and no forced neighbors', () => {
    const root = createRoot()
    run(root, AFFECTED)
    write(root, 'd.ts', "import { fc } from './c'\nexport function fd(): number { return fc() }\n")
    const result = run(root, AFFECTED)

    expect(result.incrementalRefresh).toEqual({
      requestedScope: 'affected-neighborhood',
      appliedScope: 'affected-neighborhood',
      selectionStatus: 'applied',
      fallbackReason: null,
      seedFileCount: 0,
      seedSymbolCount: 0,
      affectedNodeCount: 0,
      affectedEdgeCount: 0,
      forcedNeighborReanalysisFileCount: 0,
      forcedNeighborSample: [],
      freshExtractionFileCount: 1,
      reusedFileCount: 3,
    })
  })

  it('keeps call-graph regeneration reporting separate from the applied scope', () => {
    const root = createRoot()
    run(root, [...AFFECTED, '--call-graph'])
    modifyA(root)
    const result = run(root, [...AFFECTED, '--call-graph'])

    expect(result.incrementalRefresh.appliedScope).toBe('affected-neighborhood')
    expect(result.cache.mode).toBe('incremental-partial-with-artifact-fallback')
    expect(result.cache.partialRebuildFallbackArtifacts).toEqual(['call-graph'])
  })

  it('is deterministic across equivalent baselines', () => {
    const first = createRoot()
    const second = createRoot()
    for (const root of [first, second]) {
      run(root, AFFECTED)
      modifyA(root)
    }
    const a = run(first, AFFECTED)
    const b = run(second, AFFECTED)
    expect(b.incrementalRefresh).toEqual(a.incrementalRefresh)
    expect(normalizedArtifacts(second)).toEqual(normalizedArtifacts(first))
  })

  it('converges with a full build and a changed-files incremental build of the same final tree', () => {
    const full = createRoot()
    const changed = createRoot()
    const affected = createRoot()
    run(changed, CHANGED)
    run(affected, AFFECTED)
    for (const root of [full, changed, affected]) modifyA(root)

    run(full, [], 'full-out')
    run(changed, CHANGED)
    const result = run(affected, AFFECTED)
    expect(result.incrementalRefresh.appliedScope).toBe('affected-neighborhood')

    const reference = normalizedArtifacts(full, 'full-out')
    expect(normalizedArtifacts(changed)).toEqual(reference)
    expect(normalizedArtifacts(affected)).toEqual(reference)
  })
})

describe('affected-neighborhood full fallback', () => {
  const expectFallback = (result: any, reason: string) => {
    expect(result.incrementalRefresh).toMatchObject({
      requestedScope: 'affected-neighborhood',
      appliedScope: 'full',
      selectionStatus: 'fallback-full',
      fallbackReason: reason,
      seedFileCount: null,
      affectedNodeCount: null,
      forcedNeighborReanalysisFileCount: 0,
      forcedNeighborSample: [],
      reusedFileCount: 0,
    })
    expect(result.incrementalRefresh.freshExtractionFileCount).toBe(3)
    expect(result.cache.mode).not.toBe('incremental-partial')
    expect(result.manifest.incrementalRefresh).toEqual(result.incrementalRefresh)
  }

  it('bootstraps with a full build when no cache exists', () => {
    const root = createRoot()
    const result = run(root, AFFECTED)
    expectFallback(result, 'cache-missing')
    expect(result.cache.mode).toBe('incremental-full-initial')
  })

  it('reports cache-missing after --reset-cache instead of rejecting or silently using changed-files', () => {
    const root = createRoot()
    run(root, AFFECTED)
    modifyA(root)
    const result = run(root, [...AFFECTED, '--reset-cache'])
    expectFallback(result, 'cache-missing')
  })

  it('treats an old 1.1.0 cache as incompatible', () => {
    const root = createRoot()
    run(root, AFFECTED)
    const cachePath = join(root, OUT, 'cache-metadata.json')
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'))
    cache.cacheSchemaVersion = '1.1.0'
    delete cache.baselineArtifacts
    writeFileSync(cachePath, JSON.stringify(cache))
    modifyA(root)
    const result = run(root, AFFECTED)
    expectFallback(result, 'cache-incompatible')
    expect(result.cache.mode).toBe('incremental-full-cache-incompatible')
  })

  it('reports config-changed when the configuration fingerprint differs', () => {
    const root = createRoot()
    run(root, AFFECTED)
    modifyA(root)
    const result = run(root, [...AFFECTED, '--exclude', 'nonexistent-dir'])
    expectFallback(result, 'config-changed')
    expect(result.cache.mode).toBe('incremental-full-config-changed')
  })

  it.each([
    ['manifest.json', 'manifest-hash-mismatch'],
    ['symbol-index.json', 'symbol-index-hash-mismatch'],
    ['code-graph.json', 'code-graph-hash-mismatch'],
  ])('falls back to full when %s no longer matches the recorded identity', (file, reason) => {
    const root = createRoot()
    run(root, AFFECTED)
    writeFileSync(join(root, OUT, file), `${readFileSync(join(root, OUT, file), 'utf8')}\n`)
    modifyA(root)
    const result = run(root, AFFECTED)
    expectFallback(result, reason)
    expect(result.cache.mode).toBe('incremental-change-detected-full-rebuild')
  })

  it('does not depend on baseline identity under the changed-files scope', () => {
    const root = createRoot()
    run(root, CHANGED)
    writeFileSync(join(root, OUT, 'code-graph.json'), `${readFileSync(join(root, OUT, 'code-graph.json'), 'utf8')}\n`)
    modifyA(root)
    const result = run(root, CHANGED)
    expect(result.incrementalRefresh).toMatchObject({ appliedScope: 'changed-files', selectionStatus: 'applied' })
  })

  it('falls back on a dangling edge incident to a seed', () => {
    const root = createRoot()
    run(root, AFFECTED)
    tamperWithRehash(root, 'code-graph.json', (graph) => {
      graph.edges.push({ id: 'x', source: 'file:src/a.ts', target: 'file:src/nowhere.ts', kind: 'imports' })
    })
    modifyA(root)
    expectFallback(run(root, AFFECTED), 'dangling-edge')
  })

  it('falls back on conflicting node identity', () => {
    const root = createRoot()
    run(root, AFFECTED)
    tamperWithRehash(root, 'code-graph.json', (graph) => {
      graph.nodes.push({ id: 'file:src/a.ts', kind: 'file', label: 'a.ts', path: 'src/other.ts' })
    })
    modifyA(root)
    expectFallback(run(root, AFFECTED), 'conflicting-duplicate-node')
  })

  it('falls back when a modified path has no baseline identity', () => {
    const root = createRoot()
    run(root, AFFECTED)
    tamperWithRehash(root, 'symbol-index.json', (index) => {
      index.files = index.files.filter((file: { path: string }) => file.path !== 'src/a.ts')
    })
    modifyA(root)
    expectFallback(run(root, AFFECTED), 'unseeded-changed-path')
  })

  it('falls back when partial-rebuild eligibility fails, for either scope', () => {
    for (const args of [AFFECTED, CHANGED]) {
      const root = createRoot()
      run(root, args)
      rmSync(join(root, OUT, 'symbol-index.json'))
      modifyA(root)
      const result = run(root, args)
      expect(result.incrementalRefresh).toMatchObject({
        requestedScope: args === AFFECTED ? 'affected-neighborhood' : 'changed-files',
        appliedScope: 'full',
        selectionStatus: 'fallback-full',
        fallbackReason: 'partial-rebuild-ineligible',
      })
    }
  })
})

describe('no-change incremental runs', () => {
  it.each([
    ['plain --incremental', ['--incremental'] as string[], 'changed-files'],
    ['affected-neighborhood', AFFECTED, 'affected-neighborhood'],
  ])('is a true no-op for %s', (_label, args, requested) => {
    const root = createRoot()
    run(root, args)
    const files = ['manifest.json', 'symbol-index.json', 'code-graph.json', 'cache-metadata.json']
    const before = files.map((file) => readFileSync(join(root, OUT, file)))

    const result = run(root, args)

    expect(files.map((file) => readFileSync(join(root, OUT, file)))).toEqual(before)
    expect(result.cache.mode).toBe('incremental-no-change')
    expect(result.incrementalRefresh).toEqual({
      requestedScope: requested,
      appliedScope: 'none',
      selectionStatus: 'not-needed',
      fallbackReason: null,
      seedFileCount: null,
      seedSymbolCount: null,
      affectedNodeCount: null,
      affectedEdgeCount: null,
      forcedNeighborReanalysisFileCount: 0,
      forcedNeighborSample: [],
      freshExtractionFileCount: 0,
      reusedFileCount: 3,
    })
    // The returned manifest is the unchanged on-disk manifest, not a fabricated one.
    expect(result.manifest).toEqual(readJson(root, 'manifest.json'))
  })
})
