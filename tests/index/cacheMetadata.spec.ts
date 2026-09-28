import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CACHE_SCHEMA_VERSION,
  buildCacheMetadata,
  checkCacheCompatibility,
  classifyChangedFiles,
  computeBaselineArtifactIdentity,
  computeConfigFingerprint,
  readCacheMetadata,
  writeCacheMetadata,
  type CacheFileEntry,
} from '../../src/indexing/cacheMetadata.js'

function entry(path: string, contentHash: string, sizeBytes = 10): CacheFileEntry {
  return { path, contentHash, sizeBytes }
}

describe('computeConfigFingerprint', () => {
  it('is stable across repeated calls with identical input', () => {
    const input = {
      sourceRoots: ['src', 'tests'],
      excludePatterns: ['generated'],
      callGraphEnabled: true,
      language: null,
      defaultIgnoredDirectoryNames: ['node_modules', 'dist'],
      defaultIgnoredDirectoryPrefixes: ['.my-dev-kit-'],
      defaultFileExcludePatterns: ['.d.ts'],
      androidEvidenceFingerprint: 'no-android-evidence',
      androidGradleEvidenceFingerprint: 'no-android-gradle-evidence',
      androidManifestEvidenceFingerprint: 'no-android-manifest-evidence',
      androidResourcesEvidenceFingerprint: 'no-android-resources-evidence',
      androidNavigationXmlEvidenceFingerprint: 'no-android-navigation-evidence',
      androidTestEvidenceFingerprint: 'no-android-project',
    }

    expect(computeConfigFingerprint(input)).toBe(computeConfigFingerprint(input))
  })

  it('is insensitive to --src/--exclude ordering', () => {
    const a = computeConfigFingerprint({
      sourceRoots: ['src', 'tests'],
      excludePatterns: ['b', 'a'],
      callGraphEnabled: false,
      language: null,
      defaultIgnoredDirectoryNames: ['node_modules'],
      defaultIgnoredDirectoryPrefixes: ['.my-dev-kit-'],
      defaultFileExcludePatterns: ['.d.ts'],
      androidEvidenceFingerprint: 'no-android-evidence',
      androidGradleEvidenceFingerprint: 'no-android-gradle-evidence',
      androidManifestEvidenceFingerprint: 'no-android-manifest-evidence',
      androidResourcesEvidenceFingerprint: 'no-android-resources-evidence',
      androidNavigationXmlEvidenceFingerprint: 'no-android-navigation-evidence',
      androidTestEvidenceFingerprint: 'no-android-project',
    })
    const b = computeConfigFingerprint({
      sourceRoots: ['tests', 'src'],
      excludePatterns: ['a', 'b'],
      callGraphEnabled: false,
      language: null,
      defaultIgnoredDirectoryNames: ['node_modules'],
      defaultIgnoredDirectoryPrefixes: ['.my-dev-kit-'],
      defaultFileExcludePatterns: ['.d.ts'],
      androidEvidenceFingerprint: 'no-android-evidence',
      androidGradleEvidenceFingerprint: 'no-android-gradle-evidence',
      androidManifestEvidenceFingerprint: 'no-android-manifest-evidence',
      androidResourcesEvidenceFingerprint: 'no-android-resources-evidence',
      androidNavigationXmlEvidenceFingerprint: 'no-android-navigation-evidence',
      androidTestEvidenceFingerprint: 'no-android-project',
    })

    expect(a).toBe(b)
  })

  it('changes when --call-graph changes', () => {
    const base = {
      sourceRoots: ['src'],
      excludePatterns: [],
      language: null,
      defaultIgnoredDirectoryNames: ['node_modules'],
      defaultIgnoredDirectoryPrefixes: ['.my-dev-kit-'],
      defaultFileExcludePatterns: ['.d.ts'],
      androidEvidenceFingerprint: 'no-android-evidence',
      androidGradleEvidenceFingerprint: 'no-android-gradle-evidence',
      androidManifestEvidenceFingerprint: 'no-android-manifest-evidence',
      androidResourcesEvidenceFingerprint: 'no-android-resources-evidence',
      androidNavigationXmlEvidenceFingerprint: 'no-android-navigation-evidence',
      androidTestEvidenceFingerprint: 'no-android-project',
    }
    const withCallGraph = computeConfigFingerprint({ ...base, callGraphEnabled: true })
    const withoutCallGraph = computeConfigFingerprint({ ...base, callGraphEnabled: false })

    expect(withCallGraph).not.toBe(withoutCallGraph)
  })

  it('changes when source roots change', () => {
    const base = {
      excludePatterns: [],
      callGraphEnabled: false,
      language: null,
      defaultIgnoredDirectoryNames: ['node_modules'],
      defaultIgnoredDirectoryPrefixes: ['.my-dev-kit-'],
      defaultFileExcludePatterns: ['.d.ts'],
      androidEvidenceFingerprint: 'no-android-evidence',
      androidGradleEvidenceFingerprint: 'no-android-gradle-evidence',
      androidManifestEvidenceFingerprint: 'no-android-manifest-evidence',
      androidResourcesEvidenceFingerprint: 'no-android-resources-evidence',
      androidNavigationXmlEvidenceFingerprint: 'no-android-navigation-evidence',
      androidTestEvidenceFingerprint: 'no-android-project',
    }
    const a = computeConfigFingerprint({ ...base, sourceRoots: ['src'] })
    const b = computeConfigFingerprint({ ...base, sourceRoots: ['src', 'lib'] })

    expect(a).not.toBe(b)
  })

  it('changes when the default file exclusion policy changes (v1.12.4 test-file admission)', () => {
    const base = {
      sourceRoots: ['src', 'tests'],
      excludePatterns: [],
      callGraphEnabled: false,
      language: null,
      defaultIgnoredDirectoryNames: ['node_modules'],
      defaultIgnoredDirectoryPrefixes: ['.my-dev-kit-'],
      androidEvidenceFingerprint: 'no-android-evidence',
      androidGradleEvidenceFingerprint: 'no-android-gradle-evidence',
      androidManifestEvidenceFingerprint: 'no-android-manifest-evidence',
      androidResourcesEvidenceFingerprint: 'no-android-resources-evidence',
      androidNavigationXmlEvidenceFingerprint: 'no-android-navigation-evidence',
      androidTestEvidenceFingerprint: 'no-android-project',
    }
    const legacyPolicy = computeConfigFingerprint({ ...base, defaultFileExcludePatterns: ['.d.ts', '.test.', '.spec.'] })
    const currentPolicy = computeConfigFingerprint({ ...base, defaultFileExcludePatterns: ['.d.ts'] })

    expect(legacyPolicy).not.toBe(currentPolicy)
  })
})

describe('classifyChangedFiles', () => {
  it('detects added, changed, removed, and unchanged files deterministically', () => {
    const previous: CacheFileEntry[] = [
      entry('src/b.ts', 'hash-b'),
      entry('src/a.ts', 'hash-a'),
      entry('src/removed.ts', 'hash-removed'),
    ]
    const current: CacheFileEntry[] = [
      entry('src/a.ts', 'hash-a'),
      entry('src/b.ts', 'hash-b-changed'),
      entry('src/z-new.ts', 'hash-new'),
    ]

    const summary = classifyChangedFiles(previous, current)

    expect(summary).toEqual({
      addedCount: 1,
      changedCount: 1,
      removedCount: 1,
      unchangedCount: 1,
      addedSample: ['src/z-new.ts'],
      changedSample: ['src/b.ts'],
      removedSample: ['src/removed.ts'],
    })
  })

  it('returns all-zero counts for identical snapshots', () => {
    const files: CacheFileEntry[] = [entry('src/a.ts', 'hash-a'), entry('src/b.ts', 'hash-b')]

    const summary = classifyChangedFiles(files, files)

    expect(summary.addedCount).toBe(0)
    expect(summary.changedCount).toBe(0)
    expect(summary.removedCount).toBe(0)
    expect(summary.unchangedCount).toBe(2)
  })

  it('sorts sample lists alphabetically regardless of input order', () => {
    const previous: CacheFileEntry[] = []
    const current: CacheFileEntry[] = [entry('src/z.ts', 'h1'), entry('src/a.ts', 'h2'), entry('src/m.ts', 'h3')]

    const summary = classifyChangedFiles(previous, current)

    expect(summary.addedSample).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts'])
  })

  it('is deterministic across repeated calls with identical input', () => {
    const previous: CacheFileEntry[] = [entry('src/a.ts', 'hash-a')]
    const current: CacheFileEntry[] = [entry('src/a.ts', 'hash-a-changed'), entry('src/b.ts', 'hash-b')]

    expect(classifyChangedFiles(previous, current)).toEqual(classifyChangedFiles(previous, current))
  })
})

describe('cache schema 1.2.0 baseline artifact identity', () => {
  const sha = (text: string) => createHash('sha256').update(text).digest('hex')

  function writeIndex(symbolIndexName = 'symbol-index.json'): string {
    const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-cache-identity-'))
    writeFileSync(join(dir, symbolIndexName), 'SYMBOLS')
    writeFileSync(join(dir, 'code-graph.json'), 'GRAPH')
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        artifactKind: 'my-dev-kit-v1-manifest',
        version: '1.0.0',
        projectRoot: '/p',
        sourceRoots: ['src'],
        artifacts: { symbolIndex: symbolIndexName, codeGraph: 'code-graph.json', callGraph: null },
      })
    )
    return dir
  }

  it('advances the internal cache schema to 1.2.0', () => {
    expect(CACHE_SCHEMA_VERSION).toBe('1.2.0')
  })

  it('hashes the exact manifest and the manifest-registered symbol index and code graph, deterministically', () => {
    const dir = writeIndex('registered-symbols.json')
    try {
      writeFileSync(join(dir, 'symbol-index.json'), 'STALE-UNREGISTERED')
      const identity = computeBaselineArtifactIdentity(dir)
      expect(identity).toEqual(computeBaselineArtifactIdentity(dir))
      expect(identity.symbolIndexSha256).toBe(sha('SYMBOLS'))
      expect(identity.codeGraphSha256).toBe(sha('GRAPH'))
      expect(identity.manifestSha256).toMatch(/^[0-9a-f]{64}$/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('round-trips baselineArtifacts through the cache file', () => {
    const dir = writeIndex()
    try {
      const baselineArtifacts = computeBaselineArtifactIdentity(dir)
      writeCacheMetadata(
        dir,
        buildCacheMetadata({ projectRoot: '/p', sourceRoots: ['src'], configFingerprint: 'fp', files: [], baselineArtifacts })
      )
      const read = readCacheMetadata(dir)
      expect(read.status).toBe('ok')
      if (read.status === 'ok') {
        expect(read.metadata.cacheSchemaVersion).toBe('1.2.0')
        expect(read.metadata.baselineArtifacts).toEqual(baselineArtifacts)
        expect(checkCacheCompatibility(read.metadata).compatible).toBe(true)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a current-schema cache that lacks valid baseline identities', () => {
    const dir = writeIndex()
    try {
      const metadata = buildCacheMetadata({
        projectRoot: '/p',
        sourceRoots: ['src'],
        configFingerprint: 'fp',
        files: [],
        baselineArtifacts: { manifestSha256: 'nope', symbolIndexSha256: 'x', codeGraphSha256: 'y' },
      })
      writeCacheMetadata(dir, metadata)
      expect(readCacheMetadata(dir).status).toBe('invalid')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('still reads a 1.1.0 cache but reports it incompatible through the normal compatibility check', () => {
    const dir = writeIndex()
    try {
      const baselineArtifacts = computeBaselineArtifactIdentity(dir)
      const metadata = buildCacheMetadata({ projectRoot: '/p', sourceRoots: ['src'], configFingerprint: 'fp', files: [], baselineArtifacts })
      const { baselineArtifacts: _dropped, ...legacy } = { ...metadata, cacheSchemaVersion: '1.1.0' }
      writeFileSync(join(dir, 'cache-metadata.json'), JSON.stringify(legacy))
      const read = readCacheMetadata(dir)
      expect(read.status).toBe('ok')
      if (read.status === 'ok') expect(checkCacheCompatibility(read.metadata).compatible).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
