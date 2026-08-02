/**
 * Bounded Compose child-composable-tree source bundle (v1.11.0 Batch 4),
 * `source --composable <name> --include-compose-tree`.
 *
 * Structurally mirrors `localComponentTreeSource.ts`'s React precedent (root
 * block + deduplicated reachable-child blocks + block/line caps + skipped-
 * block reasons) but walks the already-projected `code-graph.json`
 * `composable-calls-composable` edges (Batch 4's graph projection of Batch
 * 1's `childCalls[]`) instead of a separate frontend artifact - no second
 * Compose parser, no second tree-walking engine.
 *
 * Batch 1's own child-call resolution already never records an ambiguous or
 * unresolved child call as a `childCalls[]` entry (it degrades to a
 * declaration-level warning instead - see `buildAndroidComposeSemanticProject.ts`),
 * so `composable-calls-composable` edges are exact-resolved relationships by
 * construction. Any such warning already present on a composable reached by
 * this walk is surfaced in the result's `warnings[]` rather than inventing a
 * pseudo-target for the unresolved call.
 */

import * as fs from 'node:fs'
import { ensureInsideProjectRoot } from '../lookup/getSourceSlice.js'
import { toForwardSlash } from '../io/pathUtils.js'
import type { AndroidGraphData } from '../android/index.js'
import type { CodeGraphNode } from '../graph/codeGraphTypes.js'
import type { SourceOutputFormat } from './renderSourceOutput.js'
import { renderNumberedSource } from './renderSourceOutput.js'

export const COMPOSE_TREE_MAX_BLOCKS = 40

export interface ComposeTreeSourceBlock {
  id: string
  kind: 'root-composable' | 'child-composable'
  owner: string | null
  filePath: string
  startLine: number
  endLine: number
  lineCount: number
  relationshipReason: string
  relatedEdgeIds: string[]
  content: string
}

export interface ComposeTreeSkippedBlock {
  id: string
  kind: string
  owner: string | null
  sourceStart?: number
  sourceEnd?: number
  reason: string
}

export interface ComposeTreeSourceResult {
  status: 'ok'
  mode: 'compose-tree'
  requestedComposable: string
  rootComposable: { id: string; name: string }
  sourceFile: string
  absolutePath: string
  includedBlocks: ComposeTreeSourceBlock[]
  skippedBlocks: ComposeTreeSkippedBlock[]
  warnings: string[]
  truncation: {
    truncated: boolean
    reason?: string
    emittedLineCount: number
    omittedBlockCount: number
  }
  maxLineCap: number
  sufficiencyNotes: string[]
}

export interface BuildComposeTreeSourceOptions {
  projectRoot: string
  graphData: AndroidGraphData
  rootNodeId: string
  requestedComposable: string
  maxLines: number
}

interface CandidateBlock {
  id: string
  kind: ComposeTreeSourceBlock['kind']
  owner: string | null
  filePath: string
  startLine: number
  endLine: number
  relationshipReason: string
  relatedEdgeIds: string[]
  order: number
}

export function buildComposeTreeSource(options: BuildComposeTreeSourceOptions): ComposeTreeSourceResult {
  const { projectRoot, graphData, rootNodeId, requestedComposable, maxLines } = options
  const nodeById = new Map(graphData.codeGraph.nodes.map((n) => [n.id, n]))
  const root = nodeById.get(rootNodeId)
  if (!root || root.kind !== 'android-composable') {
    throw new Error(`Compose tree root node not found or not a composable: ${rootNodeId}`)
  }

  const warnings: string[] = []
  const candidates: CandidateBlock[] = []
  candidates.push(nodeToCandidate(root, 'root-composable', 'root composable requested by --composable', [], 0))

  // BFS over `composable-calls-composable` edges only, deterministic
  // root-first level order (ties broken by node id), each descendant
  // included at most once, with cycle protection via `visited`.
  const visited = new Set<string>([root.id])
  let frontier: CodeGraphNode[] = [root]
  let level = 1
  while (frontier.length > 0 && level < 64) {
    const nextFrontier: CodeGraphNode[] = []
    const outgoingByParent = frontier
      .map((parent) => ({
        parent,
        edges: graphData.codeGraph.edges
          .filter((e) => e.source === parent.id && e.kind === 'composable-calls-composable')
          .sort((a, b) => a.target.localeCompare(b.target)),
      }))
      .sort((a, b) => a.parent.id.localeCompare(b.parent.id))

    for (const { parent, edges } of outgoingByParent) {
      for (const edge of edges) {
        if (visited.has(edge.target)) continue
        const child = nodeById.get(edge.target)
        if (!child || child.kind !== 'android-composable') continue
        visited.add(edge.target)
        nextFrontier.push(child)
        candidates.push(
          nodeToCandidate(
            child,
            'child-composable',
            `${parent.label} calls ${child.label}`,
            [edge.id],
            level
          )
        )
      }
    }
    frontier = nextFrontier
    level++
  }

  // Surface any declaration-level warning belonging to a reached composable
  // (e.g. an ambiguous/unresolved child call Batch 1 already recorded) -
  // never inventing new ambiguity evidence, only forwarding what the
  // artifact already knows.
  for (const id of visited) {
    const node = nodeById.get(id)
    const nodeWarnings = graphData.codeGraph.edges
      .filter((e) => e.target === id && e.kind === 'composable-calls-composable' && e.metadata?.candidate === true)
      .map((e) => `Ambiguous child-composable call recorded on the way to "${node?.label}" (${id}); every candidate is preserved as a separate edge, not one target.`)
    warnings.push(...nodeWarnings)
  }

  const absolutePath = ensureInsideProjectRoot(projectRoot, root.path!)
  const lines = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/)
  const selected = selectBlocks(candidates, lines, maxLines)

  return {
    status: 'ok',
    mode: 'compose-tree',
    requestedComposable,
    rootComposable: { id: root.id, name: root.label },
    sourceFile: toForwardSlash(root.path!),
    absolutePath: toForwardSlash(absolutePath),
    includedBlocks: selected.included,
    skippedBlocks: selected.skipped,
    warnings: [...new Set(warnings)].sort(),
    truncation: {
      truncated: selected.skipped.some((block) => block.reason.includes('max-line')),
      reason: selected.skipped.some((block) => block.reason.includes('max-line')) ? `Output reached the line cap ${maxLines}.` : undefined,
      emittedLineCount: selected.lineCount,
      omittedBlockCount: selected.skipped.length,
    },
    maxLineCap: maxLines,
    sufficiencyNotes: [
      'Static Compose child-call evidence only; a call site does not prove the child is always rendered or ever visible.',
      'Only composables reachable via exact same-file child-composable calls are included; unrelated composables in the same file are excluded.',
    ],
  }
}

function nodeToCandidate(
  node: CodeGraphNode,
  kind: ComposeTreeSourceBlock['kind'],
  relationshipReason: string,
  relatedEdgeIds: string[],
  order: number
): CandidateBlock {
  const meta = node.androidMetadata ?? {}
  const endLine = typeof meta.endLine === 'number' ? meta.endLine : (node.line ?? 1)
  return {
    id: node.id,
    kind,
    owner: node.label,
    filePath: node.path ?? '',
    startLine: node.line ?? 1,
    endLine,
    relationshipReason,
    relatedEdgeIds,
    order,
  }
}

function selectBlocks(
  candidates: CandidateBlock[],
  lines: string[],
  maxLines: number
): { included: ComposeTreeSourceBlock[]; skipped: ComposeTreeSkippedBlock[]; lineCount: number } {
  const unique = new Map<string, CandidateBlock>()
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.filePath}:${candidate.startLine}:${candidate.endLine}:${candidate.id}`
    if (!unique.has(key)) unique.set(key, candidate)
  }

  const sorted = [...unique.values()].sort(
    (a, b) => a.order - b.order || a.startLine - b.startLine || a.endLine - b.endLine || a.id.localeCompare(b.id)
  )

  const included: ComposeTreeSourceBlock[] = []
  const skipped: ComposeTreeSkippedBlock[] = []
  let lineCount = 0

  for (const candidate of sorted) {
    if (included.length >= COMPOSE_TREE_MAX_BLOCKS) {
      skipped.push(skippedBlock(candidate, 'max-block cap reached'))
      continue
    }
    const startLine = candidate.startLine
    const endLine = Math.min(candidate.endLine, lines.length)
    const blockLineCount = Math.max(0, endLine - startLine + 1)
    if (blockLineCount <= 0) {
      skipped.push(skippedBlock(candidate, 'invalid source range'))
      continue
    }
    if (lineCount + blockLineCount > maxLines) {
      skipped.push(skippedBlock(candidate, 'max-line cap reached'))
      continue
    }
    included.push({
      id: candidate.id,
      kind: candidate.kind,
      owner: candidate.owner,
      filePath: toForwardSlash(candidate.filePath),
      startLine,
      endLine,
      lineCount: blockLineCount,
      relationshipReason: candidate.relationshipReason,
      relatedEdgeIds: candidate.relatedEdgeIds,
      content: lines.slice(startLine - 1, endLine).join('\n'),
    })
    lineCount += blockLineCount
  }

  return { included, skipped, lineCount }
}

function skippedBlock(candidate: CandidateBlock, reason: string): ComposeTreeSkippedBlock {
  return {
    id: candidate.id,
    kind: candidate.kind,
    owner: candidate.owner,
    sourceStart: candidate.startLine,
    sourceEnd: candidate.endLine,
    reason,
  }
}

export function renderComposeTreeSource(result: ComposeTreeSourceResult, format: SourceOutputFormat): string {
  if (format === 'json') return JSON.stringify(result, null, 2) + '\n'

  const rendered: string[] = []
  for (const block of result.includedBlocks) {
    rendered.push(`### ${block.kind}: ${block.owner ?? block.id} (${block.filePath}:${block.startLine}-${block.endLine})`)
    rendered.push(`# reason: ${block.relationshipReason}`)
    if (format === 'numbered') {
      rendered.push(renderNumberedSource(block.content, block.startLine).trimEnd())
    } else {
      rendered.push(block.content)
    }
    rendered.push('')
  }
  if (result.skippedBlocks.length > 0) {
    rendered.push(`### skipped: ${result.skippedBlocks.length} block(s)`)
    for (const block of result.skippedBlocks) rendered.push(`# ${block.kind} ${block.id}: ${block.reason}`)
  }
  if (result.truncation.truncated) rendered.push(`# truncated: ${result.truncation.reason}`)
  for (const warning of result.warnings) rendered.push(`# warning: ${warning}`)
  return rendered.join('\n').trimEnd() + '\n'
}
