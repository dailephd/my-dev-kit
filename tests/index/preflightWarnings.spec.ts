import { describe, expect, it } from 'vitest'
import {
  BROAD_SOURCE_ROOT_FILE_THRESHOLD,
  LARGE_FILE_COUNT_THRESHOLD,
  computePreflightWarnings,
} from '../../src/indexing/preflight.js'

describe('computePreflightWarnings', () => {
  it('returns no warnings for a small, scoped project', () => {
    const warnings = computePreflightWarnings({
      sourceRoots: ['src'],
      totalFilesDiscovered: 10,
      totalFilesEligibleForIndexing: 8,
    })

    expect(warnings).toEqual([])
  })

  it('emits large-file-count when eligible files exceed the safe threshold', () => {
    const warnings = computePreflightWarnings({
      sourceRoots: ['src'],
      totalFilesDiscovered: LARGE_FILE_COUNT_THRESHOLD + 500,
      totalFilesEligibleForIndexing: LARGE_FILE_COUNT_THRESHOLD + 1,
    })

    expect(warnings).toHaveLength(1)
    expect(warnings[0].code).toBe('large-file-count')
    expect(warnings[0].message).toContain(String(LARGE_FILE_COUNT_THRESHOLD + 1))
  })

  it('emits broad-source-root when a root-level --src discovers many files', () => {
    const warnings = computePreflightWarnings({
      sourceRoots: ['.'],
      totalFilesDiscovered: BROAD_SOURCE_ROOT_FILE_THRESHOLD + 1,
      totalFilesEligibleForIndexing: 50,
    })

    expect(warnings).toHaveLength(1)
    expect(warnings[0].code).toBe('broad-source-root')
  })

  it('does not treat a scoped subdirectory --src as broad even with many files', () => {
    const warnings = computePreflightWarnings({
      sourceRoots: ['apps/web/src'],
      totalFilesDiscovered: BROAD_SOURCE_ROOT_FILE_THRESHOLD + 1000,
      totalFilesEligibleForIndexing: 50,
    })

    expect(warnings).toEqual([])
  })

  it('emits both warnings in a fixed, deterministic order when both trigger', () => {
    const warnings = computePreflightWarnings({
      sourceRoots: ['.'],
      totalFilesDiscovered: LARGE_FILE_COUNT_THRESHOLD + BROAD_SOURCE_ROOT_FILE_THRESHOLD + 10,
      totalFilesEligibleForIndexing: LARGE_FILE_COUNT_THRESHOLD + 1,
    })

    expect(warnings.map((warning) => warning.code)).toEqual(['large-file-count', 'broad-source-root'])
  })

  it('is deterministic across repeated calls with identical input', () => {
    const input = {
      sourceRoots: ['.', 'src'],
      totalFilesDiscovered: LARGE_FILE_COUNT_THRESHOLD + 1,
      totalFilesEligibleForIndexing: LARGE_FILE_COUNT_THRESHOLD + 1,
    }

    expect(computePreflightWarnings(input)).toEqual(computePreflightWarnings(input))
  })
})
