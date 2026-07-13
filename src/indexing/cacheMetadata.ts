/**
 * Internal incremental-indexing cache metadata.
 *
 * `cache-metadata.json` is written inside an index output directory. It is
 * internal bookkeeping for `index --incremental` (content hashes and a
 * config fingerprint from the last successful build), not a public semantic
 * artifact: it is not registered in `manifest.json`'s `artifacts` map and is
 * not part of the documented artifact set in `docs/COMMANDS.md`'s "Artifacts"
 * section.
 *
 * Batch 2 added changed/added/removed/unchanged file detection and
 * cache/config invalidation so `--incremental` can report honestly and skip
 * redundant work on a true no-op run.
 *
 * Batch 3 adds partial-rebuild support: each file entry now also carries
 * `reExportSpecifiers`/`exportAllSpecifiers` (the two `ExtractionResult`
 * fields not present in the public `FileSummary` shape) so an unchanged
 * file's per-file analysis can be safely reused to rebuild `graph.fileDeps`/
 * `graph.symbols` without re-parsing the file. `CACHE_SCHEMA_VERSION` was
 * bumped so a pre-Batch-3 cache is treated as incompatible and rebuilt once
 * rather than silently misread (its file entries lack these two fields).
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { toForwardSlash } from '../io/pathUtils.js'
import { VERSION } from '../version.js'

export const CACHE_METADATA_FILENAME = 'cache-metadata.json'
export const CACHE_SCHEMA_VERSION = '1.1.0'
export const INDEX_ARTIFACT_SCHEMA_VERSION = '1.0.0'

const SAMPLE_LIMIT = 20

export interface CacheFileEntry {
  path: string
  contentHash: string
  sizeBytes: number
  /** Present from Batch 3 onward. Absent/empty on entries from an older cache (never reused directly — a cache-schema-version bump forces a rebuild first). */
  reExportSpecifiers?: string[]
  exportAllSpecifiers?: string[]
}

export interface CacheMetadata {
  artifactKind: 'my-dev-kit-v1-cache-metadata'
  cacheSchemaVersion: string
  packageVersion: string
  indexArtifactSchemaVersion: string
  projectRoot: string
  sourceRoots: string[]
  configFingerprint: string
  generatedAt: string
  files: CacheFileEntry[]
}

export type CacheReadStatus =
  | { status: 'missing' }
  | { status: 'invalid'; reason: string }
  | { status: 'ok'; metadata: CacheMetadata }

export interface ChangedFileSummary {
  addedCount: number
  changedCount: number
  removedCount: number
  unchangedCount: number
  addedSample: string[]
  changedSample: string[]
  removedSample: string[]
}

export interface CacheResetResult {
  requested: boolean
  existed: boolean
  path: string
}

export type CacheMode =
  | 'full'
  | 'incremental-full-initial'
  | 'incremental-full-cache-incompatible'
  | 'incremental-full-config-changed'
  | 'incremental-no-change'
  /** Changes were detected but partial-rebuild reuse was not safely possible this run; a full rebuild ran instead. */
  | 'incremental-change-detected-full-rebuild'
  /** Changes were detected and a partial rebuild reused unchanged per-file analysis for every supported artifact family. */
  | 'incremental-partial'
  /** Same as `incremental-partial`, except at least one artifact family (see `partialRebuildFallbackArtifacts`) was fully regenerated rather than reused. */
  | 'incremental-partial-with-artifact-fallback'

export interface ConfigFingerprintInput {
  sourceRoots: string[]
  excludePatterns: string[]
  callGraphEnabled: boolean
  language: string | null
  defaultIgnoredDirectoryNames: string[]
  defaultIgnoredDirectoryPrefixes: string[]
  /**
   * Fingerprint of Android project/module/source-set detection facts
   * (v1.9.0 Batch 1), so a Gradle/manifest edit that changes what was
   * statically detected invalidates the cache even though those files live
   * outside `--src`. A `null` project (no Android evidence at all) still
   * contributes a stable, constant fingerprint value.
   */
  androidEvidenceFingerprint: string
  /**
   * Fingerprint of detailed Gradle evidence (v1.10.0 Batch 1: plugins,
   * dependencies, `android {}` configuration, version catalogs), so a Gradle
   * file edit that doesn't change v1.9.0 module/source-set detection (and
   * therefore wouldn't change `androidEvidenceFingerprint`) still invalidates
   * the cache when it changes what `android-gradle.json` would contain.
   */
  androidGradleEvidenceFingerprint: string
  /**
   * Fingerprint of detailed Android manifest evidence (v1.10.0 Batch 2:
   * discovered manifest files, applications, components, permissions,
   * intent filters), so a manifest add/edit/delete, a custom Gradle
   * manifest-path change, or a Gradle namespace change (any of which change
   * what `android-manifest.json` would contain) invalidates the cache even
   * when neither `androidEvidenceFingerprint` nor
   * `androidGradleEvidenceFingerprint` alone would catch it.
   */
  androidManifestEvidenceFingerprint: string
  /**
   * Fingerprint of detailed Android resource evidence (v1.10.0 Batch 3:
   * resource directories, value/file resource definitions, layouts, IDs,
   * references, FileProvider paths, network-security config), so a
   * resource add/edit/delete or a custom Gradle resource-directory change
   * invalidates the cache even when the other three Android fingerprints
   * wouldn't catch it.
   */
  androidResourcesEvidenceFingerprint: string
  /**
   * Fingerprint of the XML-navigation portion of Android navigation
   * evidence (v1.10.0 Batch 4: `res/navigation/*.xml` graphs, destinations,
   * actions, arguments, deep links, includes). Computed early — like the
   * other three Android fingerprints — because navigation XML files aren't
   * tracked by the normal `--src` changed-file mechanism. The Compose
   * route portion of `android-navigation.json` deliberately has no
   * separate fingerprint: it's computed from already-indexed Kotlin/Java
   * files inside the same pipeline stage that already re-runs whenever a
   * relevant `--src` file changes.
   */
  androidNavigationXmlEvidenceFingerprint: string
}

/**
 * Deterministic fingerprint of index-relevant configuration. Source roots
 * and excludes are sorted before hashing so re-ordering repeated `--src`/
 * `--exclude` flags does not spuriously invalidate the cache.
 */
export function computeConfigFingerprint(input: ConfigFingerprintInput): string {
  const normalized = {
    sourceRoots: [...input.sourceRoots].map(toForwardSlash).sort(),
    excludePatterns: [...input.excludePatterns].map((value) => value.trim()).sort(),
    callGraphEnabled: input.callGraphEnabled,
    language: input.language,
    defaultIgnoredDirectoryNames: [...input.defaultIgnoredDirectoryNames].sort(),
    defaultIgnoredDirectoryPrefixes: [...input.defaultIgnoredDirectoryPrefixes].sort(),
    androidEvidenceFingerprint: input.androidEvidenceFingerprint,
    androidGradleEvidenceFingerprint: input.androidGradleEvidenceFingerprint,
    androidManifestEvidenceFingerprint: input.androidManifestEvidenceFingerprint,
    androidResourcesEvidenceFingerprint: input.androidResourcesEvidenceFingerprint,
    androidNavigationXmlEvidenceFingerprint: input.androidNavigationXmlEvidenceFingerprint,
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

export function hashFileContent(absPath: string): string {
  const content = fs.readFileSync(absPath)
  return createHash('sha256').update(content).digest('hex')
}

/** Builds sorted cache file entries by hashing each discovered file's content. */
export function buildCacheFileEntries(
  files: Array<{ relPath: string; absPath: string; sizeBytes: number }>
): CacheFileEntry[] {
  return files
    .map((file) => ({
      path: toForwardSlash(file.relPath),
      contentHash: hashFileContent(file.absPath),
      sizeBytes: file.sizeBytes,
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

export function cacheMetadataPathFor(outputDir: string): string {
  return path.join(outputDir, CACHE_METADATA_FILENAME)
}

export function readCacheMetadata(outputDir: string): CacheReadStatus {
  const cachePath = cacheMetadataPathFor(outputDir)
  if (!fs.existsSync(cachePath)) return { status: 'missing' }

  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
  } catch {
    return { status: 'invalid', reason: 'Cache metadata file is not valid JSON.' }
  }

  const shapeError = validateCacheMetadataShape(parsed)
  if (shapeError) return { status: 'invalid', reason: shapeError }

  return { status: 'ok', metadata: parsed as CacheMetadata }
}

function validateCacheMetadataShape(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'Cache metadata is not an object.'
  const candidate = value as Partial<CacheMetadata>
  if (candidate.artifactKind !== 'my-dev-kit-v1-cache-metadata') {
    return 'Cache metadata artifactKind is missing or unrecognized.'
  }
  if (typeof candidate.cacheSchemaVersion !== 'string') return 'Cache metadata is missing cacheSchemaVersion.'
  if (typeof candidate.packageVersion !== 'string') return 'Cache metadata is missing packageVersion.'
  if (typeof candidate.configFingerprint !== 'string') return 'Cache metadata is missing configFingerprint.'
  if (!Array.isArray(candidate.files)) return 'Cache metadata is missing a files array.'
  return null
}

/** Schema/version compatibility only. Config-fingerprint mismatch is checked separately. */
export function checkCacheCompatibility(metadata: CacheMetadata): { compatible: boolean; reason?: string } {
  if (metadata.cacheSchemaVersion !== CACHE_SCHEMA_VERSION) {
    return {
      compatible: false,
      reason: `Cache schema version "${metadata.cacheSchemaVersion}" does not match the current cache schema version "${CACHE_SCHEMA_VERSION}".`,
    }
  }
  if (metadata.packageVersion !== VERSION) {
    return {
      compatible: false,
      reason: `Cache metadata was written by my-dev-kit ${metadata.packageVersion}; the current version is ${VERSION}.`,
    }
  }
  if (metadata.indexArtifactSchemaVersion !== INDEX_ARTIFACT_SCHEMA_VERSION) {
    return {
      compatible: false,
      reason: `Cache metadata targets index artifact schema "${metadata.indexArtifactSchemaVersion}"; the current schema is "${INDEX_ARTIFACT_SCHEMA_VERSION}".`,
    }
  }
  return { compatible: true }
}

export function writeCacheMetadata(outputDir: string, metadata: CacheMetadata): void {
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(cacheMetadataPathFor(outputDir), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
}

export function resetCacheMetadata(outputDir: string): CacheResetResult {
  const cachePath = cacheMetadataPathFor(outputDir)
  const existed = fs.existsSync(cachePath)
  if (existed) fs.rmSync(cachePath, { force: true })
  return { requested: true, existed, path: toForwardSlash(cachePath) }
}

export interface ChangedFilePaths {
  added: string[]
  changed: string[]
  removed: string[]
  unchanged: string[]
}

/**
 * Full (unbounded) added/changed/removed/unchanged path classification,
 * sorted deterministically. Internal-use only — this is the input the
 * partial-rebuild merge needs (the full unchanged-file list), whereas the
 * public `ChangedFileSummary` intentionally keeps only bounded samples for
 * CLI/JSON output.
 */
export function classifyChangedFilePaths(previousFiles: CacheFileEntry[], currentFiles: CacheFileEntry[]): ChangedFilePaths {
  const previousByPath = new Map(previousFiles.map((file) => [file.path, file]))
  const currentByPath = new Map(currentFiles.map((file) => [file.path, file]))

  const added: string[] = []
  const changed: string[] = []
  const unchanged: string[] = []
  const removed: string[] = []

  for (const [filePath, current] of currentByPath) {
    const previous = previousByPath.get(filePath)
    if (!previous) {
      added.push(filePath)
    } else if (previous.contentHash !== current.contentHash) {
      changed.push(filePath)
    } else {
      unchanged.push(filePath)
    }
  }
  for (const filePath of previousByPath.keys()) {
    if (!currentByPath.has(filePath)) removed.push(filePath)
  }

  added.sort()
  changed.sort()
  unchanged.sort()
  removed.sort()

  return { added, changed, removed, unchanged }
}

/** Classifies added/changed/removed/unchanged files between two cache snapshots, deterministically sorted. */
export function classifyChangedFiles(previousFiles: CacheFileEntry[], currentFiles: CacheFileEntry[]): ChangedFileSummary {
  const { added, changed, removed, unchanged } = classifyChangedFilePaths(previousFiles, currentFiles)

  return {
    addedCount: added.length,
    changedCount: changed.length,
    removedCount: removed.length,
    unchangedCount: unchanged.length,
    addedSample: added.slice(0, SAMPLE_LIMIT),
    changedSample: changed.slice(0, SAMPLE_LIMIT),
    removedSample: removed.slice(0, SAMPLE_LIMIT),
  }
}

/**
 * Overlays per-file extraction metadata (`reExportSpecifiers`/`exportAllSpecifiers`)
 * onto hash/size-only cache entries, sorted by path. Used when writing the
 * final `cache-metadata.json` after a build so every mode (full or partial)
 * produces complete entries that a future partial rebuild can safely reuse.
 */
export function mergeCacheFileEntryMeta(
  baseEntries: CacheFileEntry[],
  metaByPath: ReadonlyMap<string, { reExportSpecifiers: string[]; exportAllSpecifiers: string[] }>
): CacheFileEntry[] {
  return baseEntries
    .map((entry) => {
      const meta = metaByPath.get(entry.path)
      return meta
        ? { ...entry, reExportSpecifiers: meta.reExportSpecifiers, exportAllSpecifiers: meta.exportAllSpecifiers }
        : entry
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

export function buildCacheMetadata(input: {
  projectRoot: string
  sourceRoots: string[]
  configFingerprint: string
  files: CacheFileEntry[]
  generatedAt?: string
}): CacheMetadata {
  return {
    artifactKind: 'my-dev-kit-v1-cache-metadata',
    cacheSchemaVersion: CACHE_SCHEMA_VERSION,
    packageVersion: VERSION,
    indexArtifactSchemaVersion: INDEX_ARTIFACT_SCHEMA_VERSION,
    projectRoot: toForwardSlash(input.projectRoot),
    sourceRoots: input.sourceRoots,
    configFingerprint: input.configFingerprint,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    files: input.files,
  }
}
