import * as fs from 'node:fs'
import * as path from 'node:path'
import { ensureInsideProjectRoot } from '../lookup/getSourceSlice.js'
import { resolveFileNodeTarget, resolveSymbolTarget } from '../lookup/resolveSourceTarget.js'
import { toForwardSlash } from '../io/pathUtils.js'
import type { CodeGraph } from '../graph/codeGraphTypes.js'
import type { SymbolIndex, SymbolDefinition, FileSummary } from '../symbol-index/types.js'
import type {
  FrontendSemanticArtifact,
  FrontendSourceRef,
  FrontendFileResult,
} from '../frontend/frontendTypes.js'
import type {
  SourceExpansionBlock,
  SkippedBlock,
  SourceBundle,
  BundleTarget,
  ExpansionBlockKind,
  ExpansionReason,
  BundleContinuationCursor,
} from './sourceBundleTypes.js'

export interface SourceBundleOptions {
  indexDir: string
  projectRoot: string
  filePath?: string
  symbolName?: string
  nodeId?: string
  startLine?: number
  endLine?: number
  maxLinesPerBlock: number
  maxLinesPerBundle: number
  maxBlocks: number
  includeImports: boolean
  includeLocalTypes: boolean
  includeProps: boolean
  includeLocalComponents: boolean
  includeLocalDeps: boolean
  symbolIndex: SymbolIndex
  codeGraph?: CodeGraph
  frontendArtifact: FrontendSemanticArtifact | null
}

interface ResolvedPrimaryTarget {
  filePath: string
  absolutePath: string
  symbolName: string | null
  startLine: number
  endLine: number
  symbolBoundaryKnown: boolean
  targetKind: string
  nodeId?: string
  warnings: string[]
}

// ---------- File utilities ----------

function readFileLineCount(absolutePath: string): number {
  const raw = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/)
  return raw.length > 0 && raw[raw.length - 1] === '' ? raw.length - 1 : raw.length
}

function readFileLines(absolutePath: string): string[] {
  const raw = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/)
  if (raw.length > 0 && raw[raw.length - 1] === '') return raw.slice(0, -1)
  return raw
}

function normalizeFilePath(filePath: string): string {
  return toForwardSlash(filePath).replace(/\\/g, '/')
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/')
}

// ---------- Frontend-semantic helpers ----------

function findFileResult(
  frontendArtifact: FrontendSemanticArtifact | null,
  filePath: string
): FrontendFileResult | null {
  if (!frontendArtifact) return null
  const norm = normalize(filePath)
  return frontendArtifact.files.find((f) => normalize(f.filePath) === norm) ?? null
}

function findFrontendSourceRef(
  fileResult: FrontendFileResult | null,
  symbolName: string
): FrontendSourceRef | null {
  if (!fileResult) return null
  for (const c of fileResult.components) {
    if (c.name === symbolName) return c.sourceRef
  }
  for (const c of fileResult.localComponents) {
    if (c.name === symbolName) return c.sourceRef
  }
  for (const pt of fileResult.propTypes) {
    if (pt.name === symbolName) return pt.sourceRef
  }
  return null
}

// ---------- Symbol end-line estimation ----------

function estimateSymbolEndLine(
  sym: SymbolDefinition,
  fileSummary: FileSummary,
  fileResult: FrontendFileResult | null,
  maxLines: number,
  fileLineCount: number,
): { endLine: number; confidence: 'high' | 'medium' | 'low'; fallbackReason?: string } {
  // Try frontend-semantic first (exact end line)
  const feRef = findFrontendSourceRef(fileResult, sym.name)
  if (feRef) {
    return { endLine: Math.min(feRef.endLine, fileLineCount), confidence: 'high' }
  }

  // Next-symbol heuristic: end before the next symbol in the file
  const sortedSymbols = [...fileSummary.symbols].sort((a, b) => a.location.line - b.location.line)
  const idx = sortedSymbols.findIndex((s) => s.name === sym.name && s.location.line === sym.location.line)
  if (idx >= 0 && idx + 1 < sortedSymbols.length) {
    const nextStart = sortedSymbols[idx + 1].location.line
    const endLine = Math.min(nextStart - 1, sym.location.line + maxLines - 1, fileLineCount)
    return { endLine, confidence: 'medium', fallbackReason: 'symbol-index-next-symbol-heuristic' }
  }

  // Last symbol or not found: cap at maxLines
  const endLine = Math.min(sym.location.line + maxLines - 1, fileLineCount)
  return { endLine, confidence: 'low', fallbackReason: 'symbol-index-start-only' }
}

// ---------- Block construction ----------

function makeBlockId(filePath: string, startLine: number, endLine: number, kind: ExpansionBlockKind): string {
  return `${filePath}:${startLine}-${endLine}:${kind}`
}

function makeDedupeKey(filePath: string, startLine: number, endLine: number): string {
  return `${filePath}:${startLine}-${endLine}`
}

function makeBlock(
  filePath: string,
  absolutePath: string,
  startLine: number,
  endLine: number,
  kind: ExpansionBlockKind,
  reasons: ExpansionReason[],
  confidence: 'high' | 'medium' | 'low',
  fileLines: string[],
  targetRelationship: string,
  warnings: string[] = [],
  fallbackReason?: string,
): SourceExpansionBlock {
  const safeEnd = Math.min(endLine, fileLines.length)
  const content = fileLines.slice(startLine - 1, safeEnd).join('\n')
  return {
    id: makeBlockId(filePath, startLine, safeEnd, kind),
    filePath,
    absolutePath,
    startLine,
    endLine: safeEnd,
    lineCount: safeEnd - startLine + 1,
    content,
    kind,
    targetRelationship,
    expansionReasons: reasons,
    confidence,
    fallbackReason,
    warnings,
    dedupeKey: makeDedupeKey(filePath, startLine, safeEnd),
  }
}

function makeSkipped(
  kind: ExpansionBlockKind,
  reason: string,
  reasonCode: SkippedBlock['reasonCode'],
  filePath?: string,
  sourceStart?: number,
  sourceEnd?: number,
  owner?: string,
): SkippedBlock {
  const id = `skipped:${kind}:${filePath ?? 'unknown'}:${sourceStart ?? 0}`
  return { id, kind, filePath, sourceStart, sourceEnd, owner, reason, reasonCode }
}

// ---------- Primary target resolution ----------

function resolvePrimaryTarget(options: SourceBundleOptions): ResolvedPrimaryTarget {
  const warnings: string[] = []

  if (options.startLine !== undefined && options.endLine !== undefined && options.filePath) {
    const filePath = normalizeFilePath(options.filePath)
    const absolutePath = ensureInsideProjectRoot(options.projectRoot, options.filePath)
    return {
      filePath,
      absolutePath: toForwardSlash(absolutePath),
      symbolName: null,
      startLine: options.startLine,
      endLine: options.endLine,
      symbolBoundaryKnown: true,
      targetKind: 'line-range',
      warnings,
    }
  }

  if (options.nodeId) {
    const nodeTarget = resolveFileNodeTarget(options.codeGraph!, options.nodeId, options.maxLinesPerBlock)
    if (nodeTarget.mode === 'symbol') {
      return resolveSymbolPrimary(
        nodeTarget.filePath,
        nodeTarget.symbolName!,
        options,
        warnings,
        'node',
        options.nodeId,
      )
    }
    // File node
    const filePath = normalizeFilePath(nodeTarget.filePath)
    const absolutePath = ensureInsideProjectRoot(options.projectRoot, nodeTarget.filePath)
    const fileLineCount = readFileLineCount(toForwardSlash(absolutePath))
    const endLine = Math.min(options.maxLinesPerBlock, fileLineCount)
    return {
      filePath,
      absolutePath: toForwardSlash(absolutePath),
      symbolName: null,
      startLine: 1,
      endLine,
      symbolBoundaryKnown: false,
      targetKind: 'node',
      nodeId: options.nodeId,
      warnings: ['File node retrieval returns a capped preview, not the whole file.'],
    }
  }

  if (options.filePath && options.symbolName) {
    return resolveSymbolPrimary(options.filePath, options.symbolName, options, warnings, 'symbol')
  }

  throw new Error('SourceBundle requires --file --symbol, --node, or --file --start --end.')
}

function resolveSymbolPrimary(
  filePath: string,
  symbolName: string,
  options: SourceBundleOptions,
  warnings: string[],
  targetKind: string,
  nodeId?: string,
): ResolvedPrimaryTarget {
  const fileSummary = options.symbolIndex.files.find((f) => normalize(f.path) === normalize(filePath))
  if (!fileSummary) throw new Error(`File not found in symbol index: ${filePath}`)
  const symbol = fileSummary.symbols.find((s) => s.name === symbolName)
  if (!symbol) throw new Error(`Symbol not found in ${filePath}: ${symbolName}`)

  const absolutePath = ensureInsideProjectRoot(options.projectRoot, filePath)
  const fileLineCount = readFileLineCount(toForwardSlash(absolutePath))
  const normalizedFilePath = normalizeFilePath(filePath)
  const fileResult = findFileResult(options.frontendArtifact, normalizedFilePath)

  // Try frontend-semantic for exact end line
  const feRef = findFrontendSourceRef(fileResult, symbolName)
  let endLine: number
  let symbolBoundaryKnown: boolean
  if (feRef) {
    endLine = Math.min(feRef.endLine, fileLineCount)
    symbolBoundaryKnown = true
  } else {
    endLine = Math.min(symbol.location.line + options.maxLinesPerBlock - 1, fileLineCount)
    symbolBoundaryKnown = false
    warnings.push(
      `Symbol end line is not available in the current index (symbol-index.json stores start line only). ` +
        `Returning a bounded preview from line ${symbol.location.line}. Use --continue-from ${endLine + 1} to retrieve more.`
    )
  }

  return {
    filePath: normalizedFilePath,
    absolutePath: toForwardSlash(absolutePath),
    symbolName,
    startLine: symbol.location.line,
    endLine,
    symbolBoundaryKnown,
    targetKind,
    nodeId,
    warnings,
  }
}

// ---------- Local dependency expansion ----------

function resolveLocalTypeCandidates(
  primary: ResolvedPrimaryTarget,
  primaryContent: string,
  fileSummary: FileSummary,
  fileResult: FrontendFileResult | null,
  options: SourceBundleOptions,
  fileLines: string[],
  skipped: SkippedBlock[],
): SourceExpansionBlock[] {
  const typeSymbols = fileSummary.symbols.filter((s) => ['interface', 'type', 'enum'].includes(s.kind))
  const blocks: SourceExpansionBlock[] = []

  for (const sym of typeSymbols) {
    const startLine = sym.location.line
    // Skip if inside the primary window
    if (startLine >= primary.startLine && startLine <= primary.endLine) {
      skipped.push(makeSkipped('local-type', 'Inside primary window', 'inside-primary-window', primary.filePath, startLine, undefined, sym.name))
      continue
    }
    // Check if referenced in primary window
    if (!new RegExp(`\\b${escapeRegex(sym.name)}\\b`).test(primaryContent)) continue

    const { endLine, confidence, fallbackReason } = estimateSymbolEndLine(
      sym,
      fileSummary,
      fileResult,
      options.maxLinesPerBlock,
      fileLines.length,
    )

    blocks.push(
      makeBlock(
        primary.filePath,
        primary.absolutePath,
        startLine,
        endLine,
        'local-type',
        ['local-type'],
        confidence,
        fileLines,
        `type ${sym.name} referenced in primary window`,
        [],
        fallbackReason,
      )
    )
  }

  return blocks
}

function resolvePropTypeCandidates(
  primary: ResolvedPrimaryTarget,
  primaryContent: string,
  fileSummary: FileSummary,
  fileResult: FrontendFileResult | null,
  options: SourceBundleOptions,
  fileLines: string[],
  skipped: SkippedBlock[],
): SourceExpansionBlock[] {
  if (!fileResult) {
    // Fallback: look for symbols ending in 'Props' or used as first param
    return resolveLocalTypeCandidates(primary, primaryContent, fileSummary, fileResult, options, fileLines, skipped)
      .filter((b) => {
        const sym = fileSummary.symbols.find((s) => s.location.line === b.startLine)
        return sym ? /Props$/.test(sym.name) : false
      })
      .map((b) => ({ ...b, kind: 'prop-type' as ExpansionBlockKind, expansionReasons: ['prop-type'] as ExpansionReason[] }))
  }

  const blocks: SourceExpansionBlock[] = []
  for (const pt of fileResult.propTypes) {
    if (!new RegExp(`\\b${escapeRegex(pt.name)}\\b`).test(primaryContent)) continue
    const startLine = pt.sourceRef.line
    if (startLine >= primary.startLine && startLine <= primary.endLine) {
      skipped.push(makeSkipped('prop-type', 'Inside primary window', 'inside-primary-window', primary.filePath, startLine, undefined, pt.name))
      continue
    }
    blocks.push(
      makeBlock(
        primary.filePath,
        primary.absolutePath,
        startLine,
        Math.min(pt.sourceRef.endLine, fileLines.length),
        'prop-type',
        ['prop-type'],
        'high',
        fileLines,
        `prop type ${pt.name} for primary component`,
      )
    )
  }
  return blocks
}

function resolveLocalComponentCandidates(
  primary: ResolvedPrimaryTarget,
  primaryContent: string,
  fileResult: FrontendFileResult | null,
  options: SourceBundleOptions,
  fileLines: string[],
  skipped: SkippedBlock[],
): SourceExpansionBlock[] {
  if (!fileResult) {
    skipped.push(makeSkipped('local-component', 'frontend-semantic artifact not found. Local component expansion unavailable.', 'artifact-unavailable'))
    return []
  }

  const blocks: SourceExpansionBlock[] = []

  // Use ReactFlowRelationship 'react-renders-local-component' edges for the primary symbol
  const renderEdges = fileResult.relationships.filter(
    (r) =>
      r.kind === 'react-renders-local-component' &&
      (primary.symbolName == null || r.ownerComponentId?.endsWith(`#${primary.symbolName}`) || r.sourceId?.endsWith(`#${primary.symbolName}`))
  )

  const resolvedChildIds = new Set<string>()
  for (const edge of renderEdges) {
    const childId = edge.targetId
    if (!childId || resolvedChildIds.has(childId)) continue
    resolvedChildIds.add(childId)
    const lc = fileResult.localComponents.find((c) => c.id === childId)
    if (!lc) continue
    const startLine = lc.sourceRef.line
    if (startLine >= primary.startLine && startLine <= primary.endLine) {
      skipped.push(makeSkipped('local-component', 'Inside primary window', 'inside-primary-window', primary.filePath, startLine, undefined, lc.name))
      continue
    }
    blocks.push(
      makeBlock(
        primary.filePath,
        primary.absolutePath,
        startLine,
        Math.min(lc.sourceRef.endLine, fileLines.length),
        'local-component',
        ['local-component', 'rendered-child'],
        'high',
        fileLines,
        `local child component rendered by ${primary.symbolName ?? 'primary'}`,
      )
    )
  }

  // Also include unmatched local components referenced by name in primary content
  for (const lc of fileResult.localComponents) {
    if (resolvedChildIds.has(lc.id)) continue
    if (!new RegExp(`\\b${escapeRegex(lc.name)}\\b`).test(primaryContent)) continue
    const startLine = lc.sourceRef.line
    if (startLine >= primary.startLine && startLine <= primary.endLine) continue
    blocks.push(
      makeBlock(
        primary.filePath,
        primary.absolutePath,
        startLine,
        Math.min(lc.sourceRef.endLine, fileLines.length),
        'local-component',
        ['local-component'],
        'high',
        fileLines,
        `local component ${lc.name} referenced in primary window`,
      )
    )
  }

  return blocks
}

function resolveLocalHelperCandidates(
  primary: ResolvedPrimaryTarget,
  primaryContent: string,
  fileSummary: FileSummary,
  fileResult: FrontendFileResult | null,
  options: SourceBundleOptions,
  fileLines: string[],
  skipped: SkippedBlock[],
): SourceExpansionBlock[] {
  const fnSymbols = fileSummary.symbols.filter((s) => ['function', 'class'].includes(s.kind))
  const blocks: SourceExpansionBlock[] = []

  for (const sym of fnSymbols) {
    // Skip if it IS the primary symbol
    if (sym.name === primary.symbolName) continue
    const startLine = sym.location.line
    // Skip if inside primary window
    if (startLine >= primary.startLine && startLine <= primary.endLine) continue
    // Check if directly called in primary window: look for name( or name (
    if (!new RegExp(`\\b${escapeRegex(sym.name)}\\s*\\(`).test(primaryContent)) continue

    const { endLine, confidence, fallbackReason } = estimateSymbolEndLine(
      sym,
      fileSummary,
      fileResult,
      options.maxLinesPerBlock,
      fileLines.length,
    )

    blocks.push(
      makeBlock(
        primary.filePath,
        primary.absolutePath,
        startLine,
        endLine,
        'local-helper',
        ['local-helper', 'called-helper'],
        confidence,
        fileLines,
        `helper ${sym.name} directly called in primary window`,
        [],
        fallbackReason,
      )
    )
  }

  return blocks
}

function resolveLocalConstantCandidates(
  primary: ResolvedPrimaryTarget,
  primaryContent: string,
  fileSummary: FileSummary,
  options: SourceBundleOptions,
  fileLines: string[],
  skipped: SkippedBlock[],
): SourceExpansionBlock[] {
  // Only constants defined ABOVE the primary symbol
  const constSymbols = fileSummary.symbols.filter(
    (s) => ['const', 'variable'].includes(s.kind) && s.location.line < primary.startLine
  )
  const blocks: SourceExpansionBlock[] = []

  for (const sym of constSymbols) {
    if (!new RegExp(`\\b${escapeRegex(sym.name)}\\b`).test(primaryContent)) continue
    const startLine = sym.location.line
    // Constants are single-line or very short; use line + 2 max unless next symbol is closer
    const sortedSymbols = [...fileSummary.symbols].sort((a, b) => a.location.line - b.location.line)
    const idx = sortedSymbols.findIndex((s) => s.name === sym.name && s.location.line === startLine)
    let endLine: number
    if (idx >= 0 && idx + 1 < sortedSymbols.length) {
      endLine = Math.min(sortedSymbols[idx + 1].location.line - 1, startLine + 4, fileLines.length)
    } else {
      endLine = Math.min(startLine + 4, fileLines.length)
    }

    blocks.push(
      makeBlock(
        primary.filePath,
        primary.absolutePath,
        startLine,
        endLine,
        'local-constant',
        ['local-constant'],
        'medium',
        fileLines,
        `constant ${sym.name} referenced in primary window`,
      )
    )
  }

  return blocks
}

function resolveImportCandidates(
  primary: ResolvedPrimaryTarget,
  fileLines: string[],
  fileSummary: FileSummary,
  skipped: SkippedBlock[],
): SourceExpansionBlock[] {
  const blocks: SourceExpansionBlock[] = []

  for (let i = 0; i < fileLines.length; i++) {
    const line = fileLines[i]
    if (!line.trimStart().startsWith('import ')) continue
    const lineNum = i + 1

    // Dynamic import: import(
    if (/\bimport\s*\(/.test(line)) {
      skipped.push(makeSkipped('import-site', 'Dynamic import() is not supported for expansion', 'dynamic-import', primary.filePath, lineNum))
      continue
    }

    // Check if it's a local import (relative path)
    const fromMatch = line.match(/from\s+['"]([^'"]+)['"]/)
    if (!fromMatch) continue
    const specifier = fromMatch[1]

    if (!specifier.startsWith('.')) {
      // External package
      skipped.push(makeSkipped('import-site', `External package import: ${specifier}`, 'external-package', primary.filePath, lineNum))
      continue
    }

    // Local import — include the import-site line
    blocks.push(
      makeBlock(
        primary.filePath,
        primary.absolutePath,
        lineNum,
        lineNum,
        'import-site',
        ['import-dependency'],
        'high',
        fileLines,
        `import statement (${specifier})`,
      )
    )
  }

  return blocks
}

function resolveLocalDependencyCandidates(
  primary: ResolvedPrimaryTarget,
  primaryContent: string,
  fileSummary: FileSummary,
  fileResult: FrontendFileResult | null,
  options: SourceBundleOptions,
  fileLines: string[],
  skipped: SkippedBlock[],
): SourceExpansionBlock[] {
  return [
    ...resolvePropTypeCandidates(primary, primaryContent, fileSummary, fileResult, options, fileLines, skipped),
    ...resolveLocalTypeCandidates(primary, primaryContent, fileSummary, fileResult, options, fileLines, skipped),
    ...resolveLocalConstantCandidates(primary, primaryContent, fileSummary, options, fileLines, skipped),
    ...resolveLocalHelperCandidates(primary, primaryContent, fileSummary, fileResult, options, fileLines, skipped),
  ]
}

// ---------- Deduplication and sorting ----------

const KIND_ORDER: ExpansionBlockKind[] = [
  'primary-target',
  'continuation',
  'prop-type',
  'local-type',
  'local-constant',
  'local-helper',
  'called-helper',
  'local-component',
  'rendered-child',
  'callback-handler',
  'import-site',
  'imported-symbol',
  'route-owner',
  'storage-owner',
  'ui-marker-owner',
]

function kindOrder(kind: ExpansionBlockKind): number {
  const idx = KIND_ORDER.indexOf(kind)
  return idx >= 0 ? idx : 99
}

function sortExpansionBlocks(blocks: SourceExpansionBlock[]): SourceExpansionBlock[] {
  const primary = blocks.filter((b) => b.kind === 'primary-target')
  const rest = blocks
    .filter((b) => b.kind !== 'primary-target')
    .sort((a, b) => {
      const ko = kindOrder(a.kind) - kindOrder(b.kind)
      if (ko !== 0) return ko
      const fp = a.filePath.localeCompare(b.filePath)
      if (fp !== 0) return fp
      return a.startLine - b.startLine
    })
  return [...primary, ...rest]
}

function dedupeExpansionBlocks(blocks: SourceExpansionBlock[], fileLines: string[]): SourceExpansionBlock[] {
  if (blocks.length === 0) return blocks

  const primary = blocks[0] // primary is never merged
  const rest = blocks.slice(1)

  // Group by filePath, then detect overlaps
  const result: SourceExpansionBlock[] = [primary]
  const added: SourceExpansionBlock[] = []

  for (const block of rest) {
    let merged = false
    for (const existing of added) {
      if (existing.filePath !== block.filePath) continue
      // Check overlap
      if (block.startLine <= existing.endLine && block.endLine >= existing.startLine) {
        // Merge: extend the existing block
        const newStart = Math.min(existing.startLine, block.startLine)
        const newEnd = Math.max(existing.endLine, block.endLine)
        const content = fileLines.slice(newStart - 1, newEnd).join('\n')
        existing.startLine = newStart
        existing.endLine = newEnd
        existing.lineCount = newEnd - newStart + 1
        existing.content = content
        existing.dedupeKey = makeDedupeKey(existing.filePath, newStart, newEnd)
        existing.id = makeBlockId(existing.filePath, newStart, newEnd, existing.kind)
        existing.expansionReasons = [...new Set([...existing.expansionReasons, ...block.expansionReasons])]
        existing.warnings = [...existing.warnings, ...block.warnings]
        if (block.confidence === 'high' && existing.confidence !== 'high') existing.confidence = 'high'
        merged = true
        break
      }
    }
    if (!merged) {
      const copy = { ...block }
      added.push(copy)
      result.push(copy)
    }
  }

  return sortExpansionBlocks(result)
}

// ---------- Limit enforcement ----------

function enforceExpansionLimits(
  blocks: SourceExpansionBlock[],
  skippedIn: SkippedBlock[],
  options: SourceBundleOptions,
): {
  included: SourceExpansionBlock[]
  skipped: SkippedBlock[]
  cursors: BundleContinuationCursor[]
  warnings: string[]
  maxLinesHit: boolean
  maxBlocksHit: boolean
} {
  const included: SourceExpansionBlock[] = []
  const skipped: SkippedBlock[] = [...skippedIn]
  const cursors: BundleContinuationCursor[] = []
  const warnings: string[] = []
  let totalLines = 0
  let maxLinesHit = false
  let maxBlocksHit = false

  for (const block of blocks) {
    if (block.kind === 'primary-target') {
      included.push(block)
      totalLines += block.lineCount
      if (totalLines > options.maxLinesPerBundle) {
        warnings.push(`Primary block (${block.lineCount} lines) exceeds maxLinesPerBundle (${options.maxLinesPerBundle}).`)
      }
      continue
    }
    if (included.length >= options.maxBlocks) {
      skipped.push(makeSkipped(block.kind, `Max blocks (${options.maxBlocks}) reached`, 'max-blocks-reached', block.filePath, block.startLine, block.endLine))
      maxBlocksHit = true
      continue
    }
    if (totalLines + block.lineCount > options.maxLinesPerBundle) {
      skipped.push(makeSkipped(block.kind, `Max bundle lines (${options.maxLinesPerBundle}) reached`, 'max-lines-reached', block.filePath, block.startLine, block.endLine))
      maxLinesHit = true
      continue
    }
    included.push(block)
    totalLines += block.lineCount
  }

  if (maxLinesHit) {
    warnings.push(`Max bundle lines (${options.maxLinesPerBundle}) reached. Some expansion blocks were skipped.`)
  }
  if (maxBlocksHit) {
    warnings.push(`Max blocks (${options.maxBlocks}) reached. Some expansion blocks were skipped.`)
  }

  return { included, skipped, cursors, warnings, maxLinesHit, maxBlocksHit }
}

// ---------- Continuation cursor ----------

function buildBundleCursor(primary: ResolvedPrimaryTarget, fileLineCount: number, options: SourceBundleOptions): BundleContinuationCursor {
  const nextStartLine = primary.endLine + 1
  const exhausted = nextStartLine > fileLineCount
  const reason = exhausted ? 'eof' : primary.symbolBoundaryKnown ? 'window-capped' : 'symbol-end-unknown'
  return {
    filePath: primary.filePath,
    nextStartLine,
    previousEndLine: primary.endLine,
    targetId: primary.symbolName ?? primary.filePath,
    targetKind: primary.targetKind,
    reason,
    exhausted,
    warnings: exhausted ? ['EOF reached.'] : [],
  }
}

// ---------- Utility ----------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function computeStats(included: SourceExpansionBlock[], skipped: SkippedBlock[]) {
  const primary = included.find((b) => b.kind === 'primary-target')
  const expansionBlocks = included.filter((b) => b.kind !== 'primary-target')
  return {
    primaryLineCount: primary?.lineCount ?? 0,
    expansionBlockCount: expansionBlocks.length,
    skippedBlockCount: skipped.length,
    totalLineCount: included.reduce((sum, b) => sum + b.lineCount, 0),
  }
}

// ---------- Main entry point ----------

export function buildSourceBundle(options: SourceBundleOptions): SourceBundle {
  const bundleWarnings: string[] = []

  // 1. Resolve primary target
  const primary = resolvePrimaryTarget(options)
  bundleWarnings.push(...primary.warnings)

  // 2. Read file
  const fileLines = readFileLines(primary.absolutePath)
  const fileLineCount = fileLines.length

  // 3. Find FileSummary + FrontendFileResult
  const fileSummary = options.symbolIndex.files.find((f) => normalize(f.path) === normalize(primary.filePath))
  const fileResult = findFileResult(options.frontendArtifact, primary.filePath)

  // 4. Build primary block
  const primaryBlock = makeBlock(
    primary.filePath,
    primary.absolutePath,
    primary.startLine,
    Math.min(primary.endLine, fileLineCount),
    'primary-target',
    ['primary-target'],
    primary.symbolBoundaryKnown ? 'high' : 'low',
    fileLines,
    'primary source target',
    primary.warnings,
  )

  // 5. Get primary content for scanning
  const primaryContent = primaryBlock.content

  // 6. Collect expansion candidates
  const expansionCandidates: SourceExpansionBlock[] = []
  const skippedBlocks: SkippedBlock[] = []

  if (!options.frontendArtifact && (options.includeLocalComponents || options.includeProps)) {
    bundleWarnings.push(
      'frontend-semantic artifact not found. Local component and prop-type expansion requires a frontend-semantic artifact. Re-run `npx @dailephd/my-dev-kit index` on a project with TSX/JSX files.'
    )
  }

  if (fileSummary) {
    if (options.includeProps) {
      expansionCandidates.push(...resolvePropTypeCandidates(primary, primaryContent, fileSummary, fileResult, options, fileLines, skippedBlocks))
    }
    if (options.includeLocalTypes) {
      expansionCandidates.push(...resolveLocalTypeCandidates(primary, primaryContent, fileSummary, fileResult, options, fileLines, skippedBlocks))
    }
    if (options.includeLocalComponents) {
      expansionCandidates.push(...resolveLocalComponentCandidates(primary, primaryContent, fileResult, options, fileLines, skippedBlocks))
    }
    if (options.includeLocalDeps) {
      // Composite: props + types + constants + helpers
      expansionCandidates.push(...resolveLocalDependencyCandidates(primary, primaryContent, fileSummary, fileResult, options, fileLines, skippedBlocks))
    }
  } else if (options.includeLocalTypes || options.includeProps || options.includeLocalDeps || options.includeLocalComponents) {
    bundleWarnings.push(`File ${primary.filePath} not found in symbol index. Local dependency expansion unavailable.`)
  }

  if (options.includeImports) {
    expansionCandidates.push(...resolveImportCandidates(primary, fileLines, fileSummary ?? { symbols: [], imports: [] } as unknown as FileSummary, skippedBlocks))
  }

  // 7. Dedupe
  const allBlocks = dedupeExpansionBlocks([primaryBlock, ...expansionCandidates], fileLines)

  // 8. Enforce limits
  const { included, skipped, cursors, warnings: limitWarnings, maxLinesHit, maxBlocksHit } =
    enforceExpansionLimits(allBlocks, skippedBlocks, options)
  bundleWarnings.push(...limitWarnings)

  // 9. Always include a continuation cursor for the primary block
  cursors.push(buildBundleCursor(primary, fileLineCount, options))

  // 10. Compute stats
  const stats = computeStats(included, skipped)

  // 11. Build target descriptor
  const target: BundleTarget = {
    kind: primary.targetKind,
    filePath: primary.filePath,
    symbolName: primary.symbolName,
    nodeId: primary.nodeId,
    startLine: primary.startLine,
    endLine: primary.endLine,
  }

  return {
    status: 'ok',
    mode: 'source-bundle',
    indexDir: options.indexDir,
    target,
    primaryBlock: included[0],
    expansionBlocks: included.slice(1),
    skippedBlocks: skipped,
    warnings: bundleWarnings,
    limits: {
      maxLinesPerBundle: options.maxLinesPerBundle,
      maxLinesPerBlock: options.maxLinesPerBlock,
      maxBlocks: options.maxBlocks,
      maxLinesHit,
      maxBlocksHit,
    },
    continuationCursors: cursors,
    stats,
  }
}
