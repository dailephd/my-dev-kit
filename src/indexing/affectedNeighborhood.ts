/**
 * Affected-neighborhood selection (v1.12.5 Batch 1, internal and pure).
 *
 * Given a trusted baseline (previous symbol index + code graph) and the
 * existing detailed added/changed/removed/unchanged classification, computes the
 * exact one-hop, both-direction neighborhood of the modified and removed
 * baseline files and maps it back to surviving current files. It performs no
 * I/O, does not detect file changes, and is not wired into partial rebuild yet:
 * later batches consume `AffectedNeighborhoodSelection`.
 *
 * Identities are Kit's own producer identities (`buildCodeGraph`):
 * `file:<path>` and `symbol:<path>#<name>`.
 */

import { toForwardSlash } from '../io/pathUtils.js'
import type { CodeGraphEdge, CodeGraphNode } from '../graph/codeGraphTypes.js'
import type { ChangedFilePaths } from './cacheMetadata.js'
import type { TrustedBaselineReason, TrustedBaselineResult } from './trustedBaseline.js'

export type AffectedNeighborhoodUnsafeReason =
  | 'malformed-node'
  | 'conflicting-duplicate-node'
  | 'malformed-edge'
  | 'conflicting-duplicate-edge'
  | 'dangling-edge'
  | 'malformed-file-ownership'
  | 'malformed-symbol-ownership'
  | 'seed-file-node-missing'
  | 'inconsistent-file-identity'
  | 'inconsistent-symbol-identity'

export interface AffectedNeighborhoodEvidence {
  /** Baseline file paths that produced a file-node seed, sorted. */
  seedFilePaths: string[]
  seedFileCount: number
  /** Baseline symbol nodes seeded through their owning file. */
  seedSymbolCount: number
  /** Modified/removed paths with no baseline file entry (never fabricated into seeds), sorted. */
  unseededPaths: string[]
  /** Seeds plus the opposite endpoint of every valid edge incident to a seed, sorted. */
  affectedNodeIds: string[]
  affectedNodeCount: number
  /** Distinct valid edges incident to at least one original seed. */
  affectedEdgeCount: number
  /** Surviving current files owning an affected file/symbol node (may include modified files themselves), sorted. */
  selectedCurrentFilePaths: string[]
  /** `selectedCurrentFilePaths` minus current added/changed files: the files that would be newly forced to fresh extraction, sorted. */
  unchangedNeighborFilePaths: string[]
  /** Affected nodes that did not yield a grounded surviving current file. */
  unmappedAffectedNodeCount: number
}

export type AffectedNeighborhoodSelection =
  | ({ status: 'selected' } & AffectedNeighborhoodEvidence)
  | ({ status: 'no-seeds' } & AffectedNeighborhoodEvidence)
  | { status: 'unsafe'; reason: AffectedNeighborhoodUnsafeReason; detail: string }
  | { status: 'baseline-not-trusted'; baselineStatus: 'unavailable' | 'incompatible' | 'unsafe'; reason: TrustedBaselineReason; detail: string }

export interface SelectAffectedNeighborhoodInput {
  baseline: TrustedBaselineResult
  /** Existing detailed classification (from `classifyChangedFilePaths`). */
  classification: ChangedFilePaths
  /** Surviving current indexed/discovered paths. Removed files must not be present. */
  currentPaths: Iterable<string>
  /** When given, selected paths must lie under one of these source roots. */
  sourceRoots?: readonly string[]
}

const unsafe = (reason: AffectedNeighborhoodUnsafeReason, detail: string): AffectedNeighborhoodSelection => ({
  status: 'unsafe',
  reason,
  detail,
})

const sortedUnique = (values: Iterable<string>): string[] => [...new Set(values)].sort()

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

const fileNodeId = (filePath: string): string => `file:${filePath}`
const symbolNodeId = (filePath: string, name: string): string => `symbol:${filePath}#${name}`

function insideSourceRoots(filePath: string, sourceRoots: readonly string[] | undefined): boolean {
  if (!sourceRoots) return true
  return sourceRoots.some((root) => {
    const normalized = toForwardSlash(root).replace(/^\.\//, '').replace(/\/+$/, '')
    return normalized === '' || normalized === '.' || filePath === normalized || filePath.startsWith(`${normalized}/`)
  })
}

interface GraphModel {
  nodes: Map<string, CodeGraphNode>
  edges: Map<string, CodeGraphEdge>
}

/**
 * Structural validation of the baseline graph. Identical repeated records collapse.
 * Node duplicates that differ only in non-identity fields (e.g. `line` for
 * overloaded symbols, which `buildCodeGraph` emits under one ID) are not
 * conflicts; differing kind/path/symbolName is. Edge duplicates conflict when
 * source, target or kind differ.
 */
function buildGraphModel(rawNodes: unknown[], rawEdges: unknown[]): GraphModel | AffectedNeighborhoodSelection {
  const nodes = new Map<string, CodeGraphNode>()
  for (const raw of rawNodes) {
    const node = raw as Partial<CodeGraphNode> | null
    if (!node || typeof node !== 'object' || !isNonEmptyString(node.id) || !isNonEmptyString(node.kind)) {
      return unsafe('malformed-node', 'A baseline code-graph node lacks a string id/kind.')
    }
    const existing = nodes.get(node.id)
    if (existing) {
      if (existing.kind !== node.kind || existing.path !== node.path || existing.symbolName !== node.symbolName) {
        return unsafe('conflicting-duplicate-node', `Baseline node id "${node.id}" is repeated with conflicting identity.`)
      }
      continue
    }
    nodes.set(node.id, node as CodeGraphNode)
  }

  const edges = new Map<string, CodeGraphEdge>()
  for (const raw of rawEdges) {
    const edge = raw as Partial<CodeGraphEdge> | null
    if (
      !edge ||
      typeof edge !== 'object' ||
      !isNonEmptyString(edge.id) ||
      !isNonEmptyString(edge.source) ||
      !isNonEmptyString(edge.target) ||
      !isNonEmptyString(edge.kind)
    ) {
      return unsafe('malformed-edge', 'A baseline code-graph edge lacks a string id/source/target/kind.')
    }
    const existing = edges.get(edge.id)
    if (existing) {
      if (existing.source !== edge.source || existing.target !== edge.target || existing.kind !== edge.kind) {
        return unsafe('conflicting-duplicate-edge', `Baseline edge id "${edge.id}" is repeated with conflicting endpoints/kind.`)
      }
      continue
    }
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      return unsafe('dangling-edge', `Baseline edge "${edge.id}" references a node that is not in the graph.`)
    }
    edges.set(edge.id, edge as CodeGraphEdge)
  }
  return { nodes, edges }
}

export function selectAffectedNeighborhood(input: SelectAffectedNeighborhoodInput): AffectedNeighborhoodSelection {
  if (input.baseline.status !== 'trusted') {
    return {
      status: 'baseline-not-trusted',
      baselineStatus: input.baseline.status,
      reason: input.baseline.reason,
      detail: input.baseline.detail,
    }
  }
  const { symbolIndex, codeGraph } = input.baseline.baseline

  const model = buildGraphModel(codeGraph.nodes as unknown[], codeGraph.edges as unknown[])
  if ('status' in model) return model

  // Baseline file ownership: file path -> symbol names, validated for the files we may seed from.
  const ownership = new Map<string, unknown>()
  for (const file of symbolIndex.files as unknown[]) {
    const entry = file as { path?: unknown; symbols?: unknown } | null
    if (!entry || typeof entry !== 'object' || !isNonEmptyString(entry.path)) {
      return unsafe('malformed-file-ownership', 'A baseline symbol-index file entry lacks a string path.')
    }
    if (ownership.has(entry.path)) {
      return unsafe('malformed-file-ownership', `Baseline symbol-index path "${entry.path}" appears more than once.`)
    }
    ownership.set(entry.path, entry)
  }

  const seedPaths = sortedUnique([...input.classification.changed, ...input.classification.removed].map(toForwardSlash))
  const seedNodeIds = new Set<string>()
  const seedFilePaths: string[] = []
  const unseededPaths: string[] = []
  let seedSymbolCount = 0

  for (const seedPath of seedPaths) {
    const entry = ownership.get(seedPath) as { path: string; symbols?: unknown } | undefined
    if (!entry) {
      unseededPaths.push(seedPath)
      continue
    }
    const fileId = fileNodeId(seedPath)
    const fileNode = model.nodes.get(fileId)
    if (!fileNode) return unsafe('seed-file-node-missing', `Baseline file "${seedPath}" has no file node in the code graph.`)
    if (fileNode.kind !== 'file' || fileNode.path !== seedPath) {
      return unsafe('inconsistent-file-identity', `Baseline file node "${fileId}" disagrees with its file path.`)
    }
    if (!Array.isArray(entry.symbols)) {
      return unsafe('malformed-symbol-ownership', `Baseline file "${seedPath}" has no symbols array.`)
    }

    seedNodeIds.add(fileId)
    seedFilePaths.push(seedPath)

    const seededForFile = new Set<string>()
    for (const rawSymbol of entry.symbols as unknown[]) {
      const symbol = rawSymbol as { name?: unknown } | null
      if (!symbol || typeof symbol !== 'object' || !isNonEmptyString(symbol.name)) {
        return unsafe('malformed-symbol-ownership', `Baseline file "${seedPath}" has a symbol without a string name.`)
      }
      const symbolId = symbolNodeId(seedPath, symbol.name)
      const symbolNode = model.nodes.get(symbolId)
      if (!symbolNode) continue // no graph node: never fabricate a seed
      if (symbolNode.kind !== 'symbol' || symbolNode.path !== seedPath || symbolNode.symbolName !== symbol.name) {
        return unsafe('inconsistent-symbol-identity', `Baseline symbol node "${symbolId}" disagrees with its owning file.`)
      }
      seedNodeIds.add(symbolId)
      seededForFile.add(symbolId)
    }
    seedSymbolCount += seededForFile.size
  }

  // Exactly one hop, both directions, every valid edge kind; neighbors never become seeds.
  const affectedNodeIds = new Set(seedNodeIds)
  let affectedEdgeCount = 0
  for (const edge of model.edges.values()) {
    const sourceIsSeed = seedNodeIds.has(edge.source)
    const targetIsSeed = seedNodeIds.has(edge.target)
    if (!sourceIsSeed && !targetIsSeed) continue
    affectedEdgeCount += 1
    affectedNodeIds.add(edge.source)
    affectedNodeIds.add(edge.target)
  }

  // Map affected file/symbol nodes to grounded, surviving, in-root current files.
  const currentPaths = new Set([...input.currentPaths].map(toForwardSlash))
  const selected = new Set<string>()
  let unmapped = 0
  for (const nodeId of affectedNodeIds) {
    const node = model.nodes.get(nodeId)
    const ownerPath = node ? groundedOwnerPath(node, ownership) : null
    if (ownerPath !== null && currentPaths.has(ownerPath) && insideSourceRoots(ownerPath, input.sourceRoots)) {
      selected.add(ownerPath)
    } else {
      unmapped += 1
    }
  }

  const freshPaths = new Set([...input.classification.added, ...input.classification.changed].map(toForwardSlash))
  const selectedCurrentFilePaths = [...selected].sort()
  const evidence: AffectedNeighborhoodEvidence = {
    seedFilePaths: seedFilePaths.sort(),
    seedFileCount: seedFilePaths.length,
    seedSymbolCount,
    unseededPaths,
    affectedNodeIds: [...affectedNodeIds].sort(),
    affectedNodeCount: affectedNodeIds.size,
    affectedEdgeCount,
    selectedCurrentFilePaths,
    unchangedNeighborFilePaths: selectedCurrentFilePaths.filter((filePath) => !freshPaths.has(filePath)),
    unmappedAffectedNodeCount: unmapped,
  }
  return { status: seedNodeIds.size === 0 ? 'no-seeds' : 'selected', ...evidence }
}

/** Owning file path only when the node's own identity fields and the baseline ownership agree; never from labels. */
function groundedOwnerPath(node: CodeGraphNode, ownership: ReadonlyMap<string, unknown>): string | null {
  if (!isNonEmptyString(node.path) || !ownership.has(node.path)) return null
  if (node.kind === 'file') return node.id === fileNodeId(node.path) ? node.path : null
  if (node.kind === 'symbol') {
    return isNonEmptyString(node.symbolName) && node.id === symbolNodeId(node.path, node.symbolName) ? node.path : null
  }
  return null
}
