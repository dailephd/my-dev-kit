import { toForwardSlash } from '../io/pathUtils.js'
import { loadGraphDiffArtifacts } from '../graph-diff/loadGraphDiffArtifacts.js'
import { buildSymbolIndexDiff } from '../graph-diff/buildSymbolIndexDiff.js'
import type { SymbolIndex } from '../symbol-index/types.js'
import type { ChangedFileEntry, ChangedSurface, ChangedSurfaceStatus, ChangedSymbolEntry } from './types.js'
import { declarationNodeId, parseDeclarationNodeId } from '../symbol-index/declarationIdentity.js'

function normalizePath(value: string): string {
  return toForwardSlash(value).replace(/^\.\//, '')
}

function basenameOf(forwardSlashPath: string): string {
  const parts = forwardSlashPath.split('/')
  return parts[parts.length - 1] ?? forwardSlashPath
}

interface MutableFileEntry {
  path: string
  status: ChangedSurfaceStatus
  provenance: 'caller' | 'graph-diff' | 'both'
}

interface MutableSymbolEntry {
  symbolId: string
  status: ChangedSurfaceStatus
  provenance: 'caller' | 'graph-diff' | 'both'
  filePath?: string
  name?: string
  kind?: string
}

function lookupBeforeSymbol(before: SymbolIndex | null, filePath: string, symbolId: string): { kind?: string } {
  if (!before) return {}
  const file = before.files.find((entry) => entry.path === filePath)
  const matches = file?.symbols.filter((entry) => declarationNodeId(filePath, entry) === symbolId) ?? []
  const symbol = matches.length === 1 ? matches[0] : undefined
  return symbol ? { kind: symbol.kind } : {}
}

/**
 * Merges caller-supplied `changedFiles`/`changedSymbols` with an optional
 * before/after graph-diff comparison into one deterministic changed-surface
 * model. Reuses `buildSymbolIndexDiff` (Batch 1/v1.10.0 graph-diff) for the
 * diff itself — this module only normalizes and merges, it never re-derives
 * file/symbol differences on its own.
 *
 * Throws (consistent with `runGraphDiff`/`readIndexManifest` error
 * conventions) when: only one of `beforeIndex`/`afterIndex` is supplied;
 * either index is missing its symbol index; or the two indexes' project
 * roots are incompatible.
 */
export function buildChangedSurface(options: {
  changedFiles: string[]
  changedSymbols: string[]
  beforeIndex: string | null
  afterIndex: string | null
}): ChangedSurface {
  const { changedFiles, changedSymbols, beforeIndex, afterIndex } = options

  if ((beforeIndex && !afterIndex) || (!beforeIndex && afterIndex)) {
    throw new Error(
      'Both beforeIndex and afterIndex must be supplied together to compute a changed-surface graph diff; only one was provided.'
    )
  }

  const files = new Map<string, MutableFileEntry>()
  const symbols = new Map<string, MutableSymbolEntry>()
  const warnings: string[] = []
  const conflicts: string[] = []

  for (const rawPath of changedFiles) {
    const key = normalizePath(rawPath)
    files.set(key, { path: rawPath, status: 'unknown', provenance: 'caller' })
  }
  for (const rawSymbol of changedSymbols) {
    const match = parseDeclarationNodeId(rawSymbol)
    symbols.set(rawSymbol, {
      symbolId: rawSymbol,
      status: 'unknown',
      provenance: 'caller',
      ...(match ? { filePath: match.filePath, name: match.symbolName } : {}),
    })
  }

  let diffRequested = false
  if (beforeIndex && afterIndex) {
    diffRequested = true
    const loadSide = (index: string) => {
      try {
        return loadGraphDiffArtifacts(index)
      } catch (error) {
        // Preserve the context pair's established error contract while the shared loader
        // remains the sole authority for individual artifact-version compatibility.
        if (error instanceof Error && error.message.includes('Unsupported symbol index schema version:')) {
          throw new Error(`Incompatible beforeIndex/afterIndex symbol-index schema versions: ${error.message}`)
        }
        throw error
      }
    }
    const before = loadSide(beforeIndex)
    const after = loadSide(afterIndex)

    // Note: unlike a hard failure, differing absolute project roots are the *normal*
    // case (before/after are almost always distinct directories/checkouts of the
    // same logical project) — `runGraphDiff` never enforces root equality either, it
    // only warns on incompatibilities it can't safely reconcile (e.g. manifest schema
    // version). We follow the same soft convention: warn, don't throw, unless the
    // symbol-index schema itself is incompatible (checked below).
    const beforeRoot = toForwardSlash(before.resolved.manifest.projectRoot)
    const afterRoot = toForwardSlash(after.resolved.manifest.projectRoot)
    if (beforeRoot !== afterRoot && basenameOf(beforeRoot) !== basenameOf(afterRoot)) {
      warnings.push(
        `beforeIndex/afterIndex project roots differ (before: "${beforeRoot}", after: "${afterRoot}"); the changed-surface diff proceeded using only safe file/symbol-identity comparisons.`
      )
    }
    if (!before.symbolIndex || !after.symbolIndex) {
      throw new Error(
        'beforeIndex/afterIndex changed-surface diff requires a symbol index on both sides; symbol-index.json is missing from at least one side.'
      )
    }
    // Both individual versions have been validated by the shared loader; schema 2/3
    // comparisons are supported and must not be rejected merely for differing versions.

    const symbolDiff = buildSymbolIndexDiff(before.symbolIndex, after.symbolIndex)

    for (const path of symbolDiff.filesAdded) mergeFile(files, path, 'added', conflicts)
    for (const path of symbolDiff.filesRemoved) mergeFile(files, path, 'removed', conflicts)
    for (const path of symbolDiff.filesChanged) mergeFile(files, path, 'modified', conflicts)

    for (const symbolId of symbolDiff.symbolsAdded) mergeSymbol(symbols, symbolId, 'added', after.symbolIndex, conflicts)
    for (const symbolId of symbolDiff.symbolsRemoved) mergeSymbol(symbols, symbolId, 'removed', before.symbolIndex, conflicts)
    for (const symbolId of symbolDiff.symbolsChanged) mergeSymbol(symbols, symbolId, 'modified', after.symbolIndex, conflicts)
  }

  const sortedFiles: ChangedFileEntry[] = [...files.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((entry) => ({ path: entry.path, status: entry.status, provenance: entry.provenance }))
  const sortedSymbols: ChangedSymbolEntry[] = [...symbols.values()]
    .sort((a, b) => a.symbolId.localeCompare(b.symbolId))
    .map((entry) => ({ ...entry }))

  return {
    available: sortedFiles.length > 0 || sortedSymbols.length > 0,
    diffRequested,
    files: sortedFiles,
    symbols: sortedSymbols,
    conflicts,
    warnings,
  }
}

function mergeFile(files: Map<string, MutableFileEntry>, path: string, diffStatus: ChangedSurfaceStatus, conflicts: string[]): void {
  const key = normalizePath(path)
  const existing = files.get(key)
  if (!existing) {
    files.set(key, { path, status: diffStatus, provenance: 'graph-diff' })
    return
  }
  if (existing.provenance === 'caller' && existing.status === 'unknown' && diffStatus === 'removed') {
    conflicts.push(
      `Changed-surface conflict: "${path}" was supplied as a caller changedFiles entry but the beforeIndex/afterIndex diff shows it removed; the removed status was preserved.`
    )
  }
  files.set(key, { path: existing.path, status: diffStatus, provenance: 'both' })
}

function mergeSymbol(
  symbols: Map<string, MutableSymbolEntry>,
  symbolId: string,
  diffStatus: ChangedSurfaceStatus,
  referenceSymbolIndex: SymbolIndex,
  conflicts: string[]
): void {
  const match = parseDeclarationNodeId(symbolId)
  const filePath = match?.filePath
  const name = match?.symbolName
  const kindInfo = filePath && name ? lookupBeforeSymbol(referenceSymbolIndex, filePath, symbolId) : {}

  const existing = symbols.get(symbolId)
  if (!existing) {
    symbols.set(symbolId, {
      symbolId,
      status: diffStatus,
      provenance: 'graph-diff',
      ...(filePath ? { filePath } : {}),
      ...(name ? { name } : {}),
      ...(kindInfo.kind ? { kind: kindInfo.kind } : {}),
    })
    return
  }
  if (existing.provenance === 'caller' && existing.status === 'unknown' && diffStatus === 'removed') {
    conflicts.push(
      `Changed-surface conflict: "${symbolId}" was supplied as a caller changedSymbols entry but the beforeIndex/afterIndex diff shows it removed; the removed status was preserved.`
    )
  }
  symbols.set(symbolId, {
    ...existing,
    status: diffStatus,
    provenance: 'both',
    ...(kindInfo.kind ? { kind: kindInfo.kind } : {}),
  })
}
