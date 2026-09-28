/**
 * Trusted previous-baseline loader (v1.12.5 Batch 1, internal).
 *
 * Answers one question: is the previous index in `outputDir` safe to use as the
 * graph baseline for affected-neighborhood selection? Cache compatibility alone
 * does not prove that `cache-metadata.json`, `manifest.json`, `symbol-index.json`
 * and `code-graph.json` describe the same build, so this loader additionally
 * checks the SHA-256 identities recorded in cache schema 1.2.0 against the exact
 * bytes on disk (each artifact is hashed and parsed from a single read).
 *
 * The result is a structured internal value, not a public contract: later
 * batches convert non-trusted results into a truthful full fallback.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { isInsideRoot, toForwardSlash } from '../io/pathUtils.js'
import { CODE_GRAPH_SCHEMA_VERSION, type CodeGraph } from '../graph/codeGraphTypes.js'
import { SCHEMA_VERSION as SYMBOL_INDEX_SCHEMA_VERSION, type SymbolIndex } from '../symbol-index/types.js'
import {
  checkCacheCompatibility,
  readCacheMetadata,
  sha256Hex,
  type CacheMetadata,
} from './cacheMetadata.js'
import type { IndexManifest } from './manifestTypes.js'

export type TrustedBaselineStatus = 'trusted' | 'unavailable' | 'incompatible' | 'unsafe'

export type TrustedBaselineReason =
  | 'cache-missing'
  | 'cache-invalid'
  | 'cache-incompatible'
  | 'project-root-mismatch'
  | 'source-root-mismatch'
  | 'config-mismatch'
  | 'manifest-missing'
  | 'manifest-unreadable'
  | 'manifest-incompatible'
  | 'symbol-index-missing'
  | 'symbol-index-unreadable'
  | 'symbol-index-incompatible'
  | 'code-graph-missing'
  | 'code-graph-unreadable'
  | 'code-graph-incompatible'
  | 'artifact-path-escape'
  | 'manifest-hash-mismatch'
  | 'symbol-index-hash-mismatch'
  | 'code-graph-hash-mismatch'

export interface TrustedBaseline {
  cache: CacheMetadata
  manifest: IndexManifest
  symbolIndex: SymbolIndex
  codeGraph: CodeGraph
}

export type TrustedBaselineResult =
  | { status: 'trusted'; baseline: TrustedBaseline }
  | { status: 'unavailable' | 'incompatible' | 'unsafe'; reason: TrustedBaselineReason; detail: string }

export interface LoadTrustedBaselineInput {
  /** Index output directory holding `cache-metadata.json` and the manifest-registered artifacts. */
  outputDir: string
  projectRoot: string
  /** Normalized source roots as used by the current run. */
  sourceRoots: readonly string[]
  /** Configuration fingerprint computed for the current run. */
  configFingerprint: string
}

function fail(
  status: 'unavailable' | 'incompatible' | 'unsafe',
  reason: TrustedBaselineReason,
  detail: string
): TrustedBaselineResult {
  return { status, reason, detail }
}

function normalizeRoot(value: string): string {
  const normalized = toForwardSlash(path.resolve(value))
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
}

function normalizeSourceRoots(values: readonly string[]): string[] {
  return values.map((value) => toForwardSlash(value).replace(/^\.\//, '').replace(/\/+$/, '')).sort()
}

function sameSourceRoots(a: readonly string[], b: readonly string[]): boolean {
  const left = normalizeSourceRoots(a)
  const right = normalizeSourceRoots(b)
  return left.length === right.length && left.every((value, index) => value === right[index])
}

type ReadBytes = { ok: true; bytes: Buffer } | { ok: false; reason: 'missing' | 'unreadable' }

function readBytes(filePath: string): ReadBytes {
  if (!fs.existsSync(filePath)) return { ok: false, reason: 'missing' }
  try {
    return { ok: true, bytes: fs.readFileSync(filePath) }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

function parseJson(bytes: Buffer): unknown | undefined {
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown
  } catch {
    return undefined
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function loadTrustedBaseline(input: LoadTrustedBaselineInput): TrustedBaselineResult {
  const outputDir = path.resolve(input.outputDir)

  const cacheRead = readCacheMetadata(outputDir)
  if (cacheRead.status === 'missing') return fail('unavailable', 'cache-missing', 'Cache metadata is missing.')
  if (cacheRead.status === 'invalid') return fail('incompatible', 'cache-invalid', cacheRead.reason)
  const cache = cacheRead.metadata

  const compatibility = checkCacheCompatibility(cache)
  if (!compatibility.compatible) {
    return fail('incompatible', 'cache-incompatible', compatibility.reason ?? 'Cache metadata is incompatible.')
  }
  if (normalizeRoot(cache.projectRoot) !== normalizeRoot(input.projectRoot)) {
    return fail('incompatible', 'project-root-mismatch', 'Cache project root differs from the current project root.')
  }
  if (!Array.isArray(cache.sourceRoots) || !sameSourceRoots(cache.sourceRoots, input.sourceRoots)) {
    return fail('incompatible', 'source-root-mismatch', 'Cache source roots differ from the current source roots.')
  }
  if (cache.configFingerprint !== input.configFingerprint) {
    return fail('incompatible', 'config-mismatch', 'Cache configuration fingerprint differs from the current configuration.')
  }

  // Manifest: the authority for which symbol-index / code-graph files belong to the baseline.
  const manifestRead = readBytes(path.join(outputDir, 'manifest.json'))
  if (!manifestRead.ok) {
    return manifestRead.reason === 'missing'
      ? fail('unavailable', 'manifest-missing', 'manifest.json is missing.')
      : fail('unsafe', 'manifest-unreadable', 'manifest.json could not be read.')
  }
  if (sha256Hex(manifestRead.bytes) !== cache.baselineArtifacts.manifestSha256) {
    return fail('unsafe', 'manifest-hash-mismatch', 'manifest.json does not match the SHA-256 recorded in the cache.')
  }
  const manifestJson = parseJson(manifestRead.bytes)
  if (manifestJson === undefined) return fail('unsafe', 'manifest-unreadable', 'manifest.json is not valid JSON.')
  const manifestShapeError = validateManifestShape(manifestJson)
  if (manifestShapeError) return fail('incompatible', 'manifest-incompatible', manifestShapeError)
  const manifest = manifestJson as unknown as IndexManifest

  if (normalizeRoot(manifest.projectRoot) !== normalizeRoot(input.projectRoot)) {
    return fail('incompatible', 'project-root-mismatch', 'Manifest project root differs from the current project root.')
  }
  if (!sameSourceRoots(manifest.sourceRoots, input.sourceRoots)) {
    return fail('incompatible', 'source-root-mismatch', 'Manifest source roots differ from the current source roots.')
  }

  const symbolIndexPath = path.resolve(outputDir, manifest.artifacts.symbolIndex)
  const codeGraphPath = path.resolve(outputDir, manifest.artifacts.codeGraph)
  if (!isInsideRoot(outputDir, symbolIndexPath) || !isInsideRoot(outputDir, codeGraphPath)) {
    return fail('unsafe', 'artifact-path-escape', 'A manifest-referenced artifact path escapes the index directory.')
  }

  const symbolRead = readBytes(symbolIndexPath)
  if (!symbolRead.ok) {
    return symbolRead.reason === 'missing'
      ? fail('unavailable', 'symbol-index-missing', 'Manifest-referenced symbol index is missing.')
      : fail('unsafe', 'symbol-index-unreadable', 'Manifest-referenced symbol index could not be read.')
  }
  const graphRead = readBytes(codeGraphPath)
  if (!graphRead.ok) {
    return graphRead.reason === 'missing'
      ? fail('unavailable', 'code-graph-missing', 'Manifest-referenced code graph is missing.')
      : fail('unsafe', 'code-graph-unreadable', 'Manifest-referenced code graph could not be read.')
  }

  if (sha256Hex(symbolRead.bytes) !== cache.baselineArtifacts.symbolIndexSha256) {
    return fail('unsafe', 'symbol-index-hash-mismatch', 'Symbol index does not match the SHA-256 recorded in the cache.')
  }
  if (sha256Hex(graphRead.bytes) !== cache.baselineArtifacts.codeGraphSha256) {
    return fail('unsafe', 'code-graph-hash-mismatch', 'Code graph does not match the SHA-256 recorded in the cache.')
  }

  const symbolIndexJson = parseJson(symbolRead.bytes)
  if (symbolIndexJson === undefined) return fail('unsafe', 'symbol-index-unreadable', 'Symbol index is not valid JSON.')
  if (
    !isObject(symbolIndexJson) ||
    symbolIndexJson.schemaVersion !== SYMBOL_INDEX_SCHEMA_VERSION ||
    !Array.isArray(symbolIndexJson.files)
  ) {
    return fail('incompatible', 'symbol-index-incompatible', 'Symbol index schema is unsupported or its files array is missing.')
  }

  const codeGraphJson = parseJson(graphRead.bytes)
  if (codeGraphJson === undefined) return fail('unsafe', 'code-graph-unreadable', 'Code graph is not valid JSON.')
  if (
    !isObject(codeGraphJson) ||
    codeGraphJson.artifactKind !== 'code-graph' ||
    codeGraphJson.schemaVersion !== CODE_GRAPH_SCHEMA_VERSION ||
    !Array.isArray(codeGraphJson.nodes) ||
    !Array.isArray(codeGraphJson.edges)
  ) {
    return fail('incompatible', 'code-graph-incompatible', 'Code graph kind/schema is unsupported or nodes/edges are missing.')
  }

  return {
    status: 'trusted',
    baseline: {
      cache,
      manifest,
      symbolIndex: symbolIndexJson as unknown as SymbolIndex,
      codeGraph: codeGraphJson as unknown as CodeGraph,
    },
  }
}

function validateManifestShape(value: unknown): string | null {
  if (!isObject(value)) return 'Manifest is not an object.'
  if (value.artifactKind !== 'my-dev-kit-v1-manifest') return 'Manifest artifactKind is not my-dev-kit-v1-manifest.'
  if (typeof value.projectRoot !== 'string' || !value.projectRoot) return 'Manifest projectRoot is missing.'
  if (!Array.isArray(value.sourceRoots) || value.sourceRoots.some((root) => typeof root !== 'string')) {
    return 'Manifest sourceRoots is missing or malformed.'
  }
  const artifacts = value.artifacts
  if (
    !isObject(artifacts) ||
    typeof artifacts.symbolIndex !== 'string' ||
    !artifacts.symbolIndex ||
    typeof artifacts.codeGraph !== 'string' ||
    !artifacts.codeGraph
  ) {
    return 'Manifest artifacts.symbolIndex / artifacts.codeGraph are missing.'
  }
  return null
}
