import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSourceAuditEvidence } from '../../src/indexing/buildSourceAuditEvidence.js'
import { buildCacheFileEntries, classifyChangedFilePaths, type CacheFileEntry } from '../../src/indexing/cacheMetadata.js'
import { discoverSourceFiles } from '../../src/indexing/discoverSourceFiles.js'
import { buildPartialSymbolIndex } from '../../src/indexing/partialRebuild.js'
import { SOURCE_AUDIT_CAPABILITIES } from '../../src/symbol-index/auditEvidenceTypes.js'
import { validateSourceAuditEvidence } from '../../src/symbol-index/validateAuditEvidence.js'
import { buildIndex } from '../../src/symbol-index/builder.js'
import type { FileSummary } from '../../src/symbol-index/types.js'

const tempDirs: string[] = []
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop() as string, { recursive: true, force: true })
})

const SRC = ['src']

function makeProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v115-incr-'))
  tempDirs.push(root)
  for (const [rel, content] of Object.entries(files)) write(root, rel, content)
  return root
}

function write(root: string, rel: string, content: string): void {
  const abs = join(root, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
}

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

const BASE = {
  'src/a.ts': 'export function a(): number { return 1 }\n',
  'src/b.ts': "import { a } from './a'\nexport function b(): number { return a() }\n",
  'src/c.ts': 'export const c = 3\n',
  'src/notes.md': '# not code\n',
}

/** Full build plus the trusted-baseline inputs an incremental run would have recovered from the previous index/cache. */
function baseline(root: string, excludes: string[] = ['generated']) {
  const full = buildIndex({ repoRoot: root, sourceRoots: SRC, excludePatterns: excludes })
  const cacheEntries = buildCacheFileEntries(full.discovery.files)
  const summaries = new Map(full.index.files.map((f) => [f.path, f]))
  return { full, cacheEntries, summaries, excludes }
}

function fullProjection(root: string, excludes: string[] = ['generated']) {
  const built = buildIndex({ repoRoot: root, sourceRoots: SRC, excludePatterns: excludes })
  return buildSourceAuditEvidence({
    projectRoot: root,
    sourceRoots: SRC,
    excludes,
    discovery: built.discovery,
    symbolIndex: built.index,
    fileHashes: built.fileContentHashes,
    producerVersion: '1.14.0',
  })
}

function partialProjection(
  root: string,
  base: ReturnType<typeof baseline>,
  opts: { forced?: string[]; cacheEntries?: CacheFileEntry[]; summaries?: Map<string, FileSummary> } = {},
) {
  const discovery = discoverSourceFiles({ repoRoot: root, sourceRoots: SRC, userExcludes: base.excludes })
  const cacheEntries = opts.cacheEntries ?? base.cacheEntries
  const classification = classifyChangedFilePaths(cacheEntries, buildCacheFileEntries(discovery.files))
  const partial = buildPartialSymbolIndex({
    repoRoot: root,
    sourceRoots: SRC,
    buildCallGraph: false,
    discoveryFiles: discovery.files,
    unchangedPaths: new Set(classification.unchanged),
    forceReextractPaths: opts.forced ? new Set(opts.forced) : undefined,
    previousFileSummariesByPath: opts.summaries ?? base.summaries,
    previousCacheEntriesByPath: new Map(cacheEntries.map((e) => [e.path, e])),
  })
  const projection = buildSourceAuditEvidence({
    projectRoot: root,
    sourceRoots: SRC,
    excludes: base.excludes,
    discovery,
    symbolIndex: partial.index,
    fileHashes: partial.fileContentHashes,
    producerVersion: '1.14.0',
  })
  return { discovery, classification, partial, projection }
}

describe('v1.15.0 Batch 1 full/incremental audit projection', () => {
  it('produces an equivalent projection from trusted reused evidence and a full build of the same input', () => {
    const root = makeProject(BASE)
    const base = baseline(root)
    const { partial, projection } = partialProjection(root, base)
    expect(partial.reusedPaths).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
    expect(partial.freshlyExtractedPaths).toEqual([])
    const full = fullProjection(root)
    expect(projection.artifact).toEqual(full.artifact)
    expect(projection.incompleteReasons).toEqual(full.incompleteReasons)
    expect(() => validateSourceAuditEvidence(projection.artifact)).not.toThrow()
  })

  it('reuses unchanged file identity from the trusted cache baseline', () => {
    const root = makeProject(BASE)
    const base = baseline(root)
    const { partial } = partialProjection(root, base)
    for (const [path, text] of [['src/a.ts', BASE['src/a.ts']], ['src/c.ts', BASE['src/c.ts']]] as const) {
      expect(partial.fileContentHashes.get(path)).toBe(sha(text))
    }
  })

  it('invalidates stale provenance when file content changes and matches a fresh full build', () => {
    const root = makeProject(BASE)
    const base = baseline(root)
    const before = fullProjection(root).artifact
    write(root, 'src/a.ts', 'export function a(): number { return 2 }\nexport const extra = 1\n')
    const { classification, partial, projection } = partialProjection(root, base)
    expect(classification.changed).toEqual(['src/a.ts'])
    expect(partial.freshlyExtractedPaths).toEqual(['src/a.ts'])
    const changed = projection.artifact.files.find((f) => f.path === 'src/a.ts')!
    expect(changed.contentSha256).toBe(sha('export function a(): number { return 2 }\nexport const extra = 1\n'))
    expect(changed.contentSha256).not.toBe(before.files.find((f) => f.path === 'src/a.ts')!.contentSha256)
    expect(projection.artifact.source.snapshotId).not.toBe(before.source.snapshotId)
    expect(projection.artifact).toEqual(fullProjection(root).artifact)
  })

  it('drops removed files from the selected ledger and the projected set', () => {
    const root = makeProject(BASE)
    const base = baseline(root)
    unlinkSync(join(root, 'src', 'c.ts'))
    unlinkSync(join(root, 'src', 'notes.md'))
    const { classification, projection } = partialProjection(root, base)
    expect(classification.removed).toEqual(['src/c.ts'])
    expect(projection.artifact.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(projection.artifact.coverage).toMatchObject({ selectedFileCount: 2, recordedFileCount: 2, unsupportedFileCount: 0, inventoryComplete: true })
  })

  it('does not reuse stale provenance for a forced re-extraction', () => {
    const root = makeProject(BASE)
    const base = baseline(root)
    // Poison the previous cache identity of a forced neighbor: reuse would surface this stale hash.
    const stale = base.cacheEntries.map((e) => (e.path === 'src/b.ts' ? { ...e, contentHash: 'f'.repeat(64) } : e))
    const discovery = discoverSourceFiles({ repoRoot: root, sourceRoots: SRC, userExcludes: base.excludes })
    const classification = classifyChangedFilePaths(stale, buildCacheFileEntries(discovery.files))
    expect(classification.changed).toEqual(['src/b.ts']) // the poisoned entry no longer counts as unchanged
    const forcedOnly = classifyChangedFilePaths(base.cacheEntries, buildCacheFileEntries(discovery.files))
    const partial = buildPartialSymbolIndex({
      repoRoot: root,
      sourceRoots: SRC,
      buildCallGraph: false,
      discoveryFiles: discovery.files,
      unchangedPaths: new Set(forcedOnly.unchanged),
      forceReextractPaths: new Set(['src/b.ts']),
      previousFileSummariesByPath: base.summaries,
      previousCacheEntriesByPath: new Map(stale.map((e) => [e.path, e])),
    })
    expect(partial.forcedReextractPaths).toEqual(['src/b.ts'])
    expect(partial.reusedPaths).not.toContain('src/b.ts')
    expect(partial.fileContentHashes.get('src/b.ts')).toBe(sha(BASE['src/b.ts']))
    expect(partial.fileContentHashes.get('src/b.ts')).not.toBe('f'.repeat(64))
  })

  it('never turns unknown or untrusted previous cache content into complete evidence', () => {
    const root = makeProject(BASE)
    const base = baseline(root)
    // Reused files whose cache entry lacks a usable content hash get no hash from the baseline.
    const entries = base.cacheEntries.map((e) => (e.path === 'src/c.ts' ? { ...e, contentHash: 'unknown' } : e))
    const discovery = discoverSourceFiles({ repoRoot: root, sourceRoots: SRC, userExcludes: base.excludes })
    const partial = buildPartialSymbolIndex({
      repoRoot: root,
      sourceRoots: SRC,
      buildCallGraph: false,
      discoveryFiles: discovery.files,
      unchangedPaths: new Set(['src/a.ts', 'src/b.ts', 'src/c.ts']),
      previousFileSummariesByPath: base.summaries,
      previousCacheEntriesByPath: new Map(entries.map((e) => [e.path, e])),
    })
    expect(partial.fileContentHashes.has('src/c.ts')).toBe(false)
    const { artifact, incompleteReasons } = buildSourceAuditEvidence({
      projectRoot: root,
      sourceRoots: SRC,
      excludes: base.excludes,
      discovery,
      symbolIndex: partial.index,
      fileHashes: partial.fileContentHashes,
      producerVersion: '1.14.0',
    })
    const c = artifact.files.find((f) => f.path === 'src/c.ts')!
    expect(c).toMatchObject({ status: 'partial', contentSha256: null })
    expect(artifact.coverage.inventoryComplete).toBe(false)
    expect(incompleteReasons).toContain('content-identity-gap')
    // Without content identity matching the analyzed bytes, no capability of that file may be complete.
    for (const k of SOURCE_AUDIT_CAPABILITIES) expect(c.capabilities[k]).not.toBe('complete')
    // Files whose trusted baseline hash and audit evidence are reused keep their demonstrated capabilities.
    expect(artifact.files.find((f) => f.path === 'src/a.ts')!.capabilities.declarations).toBe('complete')
    expect(() => validateSourceAuditEvidence(artifact)).not.toThrow()
  })

  it('produces failed (not complete) evidence when previous index data has no entry for a selected file', () => {
    const root = makeProject(BASE)
    const base = baseline(root)
    const discovery = discoverSourceFiles({ repoRoot: root, sourceRoots: SRC, userExcludes: base.excludes })
    // Simulates a partial index lacking a summary for a file still selected and unchanged.
    const partial = buildPartialSymbolIndex({
      repoRoot: root,
      sourceRoots: SRC,
      buildCallGraph: false,
      discoveryFiles: discovery.files.filter((f) => f.relPath !== 'src/c.ts'),
      unchangedPaths: new Set(['src/a.ts', 'src/b.ts']),
      previousFileSummariesByPath: base.summaries,
      previousCacheEntriesByPath: new Map(base.cacheEntries.map((e) => [e.path, e])),
    })
    const { artifact } = buildSourceAuditEvidence({
      projectRoot: root,
      sourceRoots: SRC,
      excludes: base.excludes,
      discovery,
      symbolIndex: partial.index,
      fileHashes: partial.fileContentHashes,
      producerVersion: '1.14.0',
    })
    const c = artifact.files.find((f) => f.path === 'src/c.ts')!
    expect(c.status).toBe('failed')
    expect(c.diagnostics[0]!.code).toBe('content-unreadable')
    expect(artifact.coverage.inventoryComplete).toBe(false)
    expect(artifact.coverage.unreadableFileCount).toBe(1)
    expect(() => validateSourceAuditEvidence(artifact)).not.toThrow()
  })

  it('keeps existing partial-rebuild behavior: fresh/reused partitioning and symbol-index shape are unchanged', () => {
    const root = makeProject(BASE)
    const base = baseline(root)
    write(root, 'src/c.ts', 'export const c = 4\n')
    const { partial } = partialProjection(root, base)
    expect(partial.freshlyExtractedPaths).toEqual(['src/c.ts'])
    expect(partial.reusedPaths).toEqual(['src/a.ts', 'src/b.ts'])
    expect(Object.keys(partial.index).sort()).toEqual(
      ['buildTime', 'fileCount', 'files', 'graph', 'repoRoot', 'schemaVersion', 'sourceRoots', 'symbolCount'].sort(),
    )
    expect(JSON.stringify(partial.index)).not.toContain('contentSha256')
  })
})
