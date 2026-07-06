import { describe, expect, it } from 'vitest'
import {
  classifyChangedFiles,
  computeConfigFingerprint,
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
    })
    const b = computeConfigFingerprint({
      sourceRoots: ['tests', 'src'],
      excludePatterns: ['a', 'b'],
      callGraphEnabled: false,
      language: null,
      defaultIgnoredDirectoryNames: ['node_modules'],
      defaultIgnoredDirectoryPrefixes: ['.my-dev-kit-'],
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
    }
    const a = computeConfigFingerprint({ ...base, sourceRoots: ['src'] })
    const b = computeConfigFingerprint({ ...base, sourceRoots: ['src', 'lib'] })

    expect(a).not.toBe(b)
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
