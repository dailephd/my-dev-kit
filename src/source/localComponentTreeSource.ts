import * as fs from 'node:fs'
import { ensureInsideProjectRoot } from '../lookup/getSourceSlice.js'
import { toForwardSlash } from '../io/pathUtils.js'
import type {
  FrontendFileResult,
  FrontendSemanticArtifact,
  FrontendSourceRef,
  ReactComponentCandidate,
  ReactFlowRelationship,
  ReactFlowRelationshipKind,
} from '../frontend/index.js'
import type { SourceOutputFormat } from './renderSourceOutput.js'
import { renderNumberedSource } from './renderSourceOutput.js'

export const LOCAL_COMPONENT_TREE_MAX_BLOCKS = 40

export interface LocalComponentTreeSourceResult {
  status: 'ok'
  mode: 'local-component-tree'
  requestedSymbol: string
  rootComponent: {
    id: string
    name: string
  }
  sourceFile: string
  absolutePath: string
  includedBlocks: LocalComponentTreeSourceBlock[]
  skippedBlocks: LocalComponentTreeSkippedBlock[]
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

export interface LocalComponentTreeSourceBlock {
  id: string
  kind:
    | 'root-component'
    | 'root-props-type'
    | 'local-child-component'
    | 'child-props-type'
    | 'prop-assignment'
    | 'callback-invocation'
    | 'event-handler'
    | 'state-access'
    | 'jsx-branch'
    | 'helper-function'
    | 'prop-reference'
    | 'relationship-site'
  owner: string | null
  filePath: string
  startLine: number
  endLine: number
  lineCount: number
  relationshipReason: string
  relatedEdgeIds: string[]
  relationshipSummaries: string[]
  content: string
}

export interface LocalComponentTreeSkippedBlock {
  id: string
  kind: string
  owner: string | null
  sourceStart?: number
  sourceEnd?: number
  reason: string
}

interface CandidateBlock {
  id: string
  kind: LocalComponentTreeSourceBlock['kind']
  owner: string | null
  sourceRef: FrontendSourceRef
  relationshipReason: string
  relatedEdgeIds: string[]
  relationshipSummaries: string[]
  order: number
}

interface BuildOptions {
  indexDir: string
  projectRoot: string
  frontendArtifact: FrontendSemanticArtifact | null | undefined
  symbol: string
  filePath?: string
  maxLines: number
  propName?: string
}

const PROP_FLOW_KINDS = new Set<ReactFlowRelationshipKind>([
  'react-renders-local-component',
  'react-passes-prop',
  'react-passes-callback-prop',
  'react-callback-invoked-by-child',
  'react-helper-computes-prop',
  'react-prop-reference',
])

const EVENT_FLOW_KINDS = new Set<ReactFlowRelationshipKind>([
  'react-event-uses-handler',
  'react-handler-reads-state',
  'react-handler-sets-state',
  'react-state-controls-jsx-branch',
])

export function buildLocalComponentTreeSource(options: BuildOptions): LocalComponentTreeSourceResult {
  if (!options.frontendArtifact) {
    throw new Error(
      'No frontend semantic artifact found. Run `npx @dailephd/my-dev-kit index` on a project with TSX/JSX files first.',
    )
  }

  const rootMatch = resolveRootComponent(options.frontendArtifact, options.symbol, options.filePath)
  const { file, component: root } = rootMatch
  const allComponents = [...file.components, ...file.localComponents]
  const componentById = new Map(allComponents.map((component) => [component.id, component]))
  const componentNameById = new Map(allComponents.map((component) => [component.id, component.name]))
  const rootTreeComponentIds = collectLocalTreeComponentIds(file, root.id)
  const relationships = (file.relationships ?? [])
    .filter((relationship) => relationship.filePath === file.filePath)
    .filter((relationship) => rootTreeComponentIds.has(relationship.ownerComponentId ?? root.id)
      || rootTreeComponentIds.has(relationship.sourceId)
      || (relationship.targetId ? rootTreeComponentIds.has(relationship.targetId) : false))
    .filter((relationship) => !options.propName || relationship.propName === options.propName)

  const warnings = [...(root.warnings ?? []).map((warning) => warning.message)]
  if (options.propName && relationships.length === 0) {
    warnings.push(`No local component-tree relationship references prop "${options.propName}".`)
  }

  const candidates: CandidateBlock[] = []
  const addCandidate = (candidate: CandidateBlock) => candidates.push(candidate)

  addCandidate({
    id: `component:${root.id}`,
    kind: 'root-component',
    owner: root.name,
    sourceRef: root.sourceRef,
    relationshipReason: 'root component requested by --symbol',
    relatedEdgeIds: [],
    relationshipSummaries: [],
    order: 0,
  })

  addPropTypeBlocks(file, root, 'root-props-type', 1, addCandidate)

  for (const childId of [...rootTreeComponentIds].filter((id) => id !== root.id)) {
    const child = componentById.get(childId)
    if (!child) continue
    addCandidate({
      id: `component:${child.id}`,
      kind: 'local-child-component',
      owner: child.name,
      sourceRef: child.sourceRef,
      relationshipReason: `local child component rendered by ${root.name}`,
      relatedEdgeIds: relatedRelationshipIds(relationships, child.id, 'react-renders-local-component'),
      relationshipSummaries: [`${root.name} renders ${child.name}`],
      order: 2,
    })
    addPropTypeBlocks(file, child, 'child-props-type', 3, addCandidate)
  }

  for (const relationship of relationships) {
    addCandidate({
      id: `relationship:${relationship.id}`,
      kind: blockKindForRelationship(relationship.kind),
      owner: ownerName(relationship, componentNameById),
      sourceRef: relationship.sourceRef,
      relationshipReason: reasonForRelationship(relationship),
      relatedEdgeIds: [relationship.id],
      relationshipSummaries: [summarizeRelationship(relationship, componentNameById)],
      order: orderForRelationship(relationship.kind),
    })
  }

  const absolutePath = ensureInsideProjectRoot(options.projectRoot, file.filePath)
  const lines = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/)
  const selected = selectBlocks(candidates, lines, options.maxLines)

  return {
    status: 'ok',
    mode: 'local-component-tree',
    requestedSymbol: options.symbol,
    rootComponent: {
      id: root.id,
      name: root.name,
    },
    sourceFile: toForwardSlash(file.filePath),
    absolutePath: toForwardSlash(absolutePath),
    includedBlocks: selected.included,
    skippedBlocks: selected.skipped,
    warnings,
    truncation: {
      truncated: selected.skipped.some((block) => block.reason.includes('max-line')),
      reason: selected.skipped.some((block) => block.reason.includes('max-line'))
        ? `Output reached --max-lines ${options.maxLines}.`
        : undefined,
      emittedLineCount: selected.lineCount,
      omittedBlockCount: selected.skipped.length,
    },
    maxLineCap: options.maxLines,
    sufficiencyNotes: [
      'Static local React flow only; no runtime reachability or event ordering is inferred.',
      'Imports and unrelated sibling components are intentionally excluded.',
      'Prop references are conservative candidates, not complete TypeScript language-server references.',
    ],
  }
}

export function renderLocalComponentTreeSource(
  result: LocalComponentTreeSourceResult,
  format: SourceOutputFormat,
): string {
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

export function isReactPropFlowKind(kind: string): boolean {
  return PROP_FLOW_KINDS.has(kind as ReactFlowRelationshipKind)
}

export function isReactEventFlowKind(kind: string): boolean {
  return EVENT_FLOW_KINDS.has(kind as ReactFlowRelationshipKind)
}

function resolveRootComponent(
  artifact: FrontendSemanticArtifact,
  symbol: string,
  filePath?: string,
): { file: FrontendFileResult; component: ReactComponentCandidate } {
  const normalizedFile = filePath ? toForwardSlash(filePath) : null
  const matches: Array<{ file: FrontendFileResult; component: ReactComponentCandidate }> = []

  for (const file of artifact.files) {
    if (normalizedFile && file.filePath !== normalizedFile) continue
    for (const component of file.components) {
      if (component.name === symbol) matches.push({ file, component })
    }
  }

  if (matches.length === 0) {
    throw new Error(`React component symbol not found for local component-tree retrieval: ${symbol}`)
  }
  if (matches.length > 1) {
    const locations = matches.map((match) => `${match.file.filePath}:${match.component.sourceRef.line}`).join(', ')
    throw new Error(`Ambiguous React component symbol "${symbol}". Provide --file. Matches: ${locations}`)
  }
  return matches[0]
}

function collectLocalTreeComponentIds(file: FrontendFileResult, rootId: string): Set<string> {
  const ids = new Set([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const relationship of file.relationships ?? []) {
      if (relationship.kind !== 'react-renders-local-component') continue
      if (!ids.has(relationship.sourceId)) continue
      if (!relationship.targetId || ids.has(relationship.targetId)) continue
      ids.add(relationship.targetId)
      changed = true
    }
  }
  return ids
}

function addPropTypeBlocks(
  file: FrontendFileResult,
  component: { id: string; name: string; propTypeName?: string | null },
  kind: 'root-props-type' | 'child-props-type',
  order: number,
  addCandidate: (candidate: CandidateBlock) => void,
): void {
  if (!component.propTypeName) return
  const propType = file.propTypes.find((candidate) => candidate.name === component.propTypeName)
  if (!propType) return
  addCandidate({
    id: `prop-type:${propType.id}`,
    kind,
    owner: component.name,
    sourceRef: propType.sourceRef,
    relationshipReason: `${component.name} uses local props type ${propType.name}`,
    relatedEdgeIds: [],
    relationshipSummaries: [`${component.name} props type ${propType.name}`],
    order,
  })
}

function selectBlocks(candidates: CandidateBlock[], lines: string[], maxLines: number): {
  included: LocalComponentTreeSourceBlock[]
  skipped: LocalComponentTreeSkippedBlock[]
  lineCount: number
} {
  const unique = new Map<string, CandidateBlock>()
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.sourceRef.filePath}:${candidate.sourceRef.line}:${candidate.sourceRef.endLine}:${candidate.id}`
    if (!unique.has(key)) unique.set(key, candidate)
  }

  const sorted = [...unique.values()].sort((a, b) =>
    a.order - b.order
    || a.sourceRef.line - b.sourceRef.line
    || a.sourceRef.endLine - b.sourceRef.endLine
    || a.id.localeCompare(b.id)
  )

  const included: LocalComponentTreeSourceBlock[] = []
  const skipped: LocalComponentTreeSkippedBlock[] = []
  let lineCount = 0

  for (const candidate of sorted) {
    if (included.length >= LOCAL_COMPONENT_TREE_MAX_BLOCKS) {
      skipped.push(skippedBlock(candidate, 'max-block cap reached'))
      continue
    }
    const startLine = candidate.sourceRef.line
    const endLine = Math.min(candidate.sourceRef.endLine, lines.length)
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
      filePath: toForwardSlash(candidate.sourceRef.filePath),
      startLine,
      endLine,
      lineCount: blockLineCount,
      relationshipReason: candidate.relationshipReason,
      relatedEdgeIds: candidate.relatedEdgeIds,
      relationshipSummaries: candidate.relationshipSummaries,
      content: lines.slice(startLine - 1, endLine).join('\n'),
    })
    lineCount += blockLineCount
  }

  return { included, skipped, lineCount }
}

function skippedBlock(candidate: CandidateBlock, reason: string): LocalComponentTreeSkippedBlock {
  return {
    id: candidate.id,
    kind: candidate.kind,
    owner: candidate.owner,
    sourceStart: candidate.sourceRef.line,
    sourceEnd: candidate.sourceRef.endLine,
    reason,
  }
}

function blockKindForRelationship(kind: ReactFlowRelationshipKind): LocalComponentTreeSourceBlock['kind'] {
  if (kind === 'react-passes-prop' || kind === 'react-passes-callback-prop') return 'prop-assignment'
  if (kind === 'react-callback-invoked-by-child') return 'callback-invocation'
  if (kind === 'react-event-uses-handler') return 'event-handler'
  if (kind === 'react-handler-reads-state' || kind === 'react-handler-sets-state') return 'state-access'
  if (kind === 'react-state-controls-jsx-branch') return 'jsx-branch'
  if (kind === 'react-helper-computes-prop') return 'helper-function'
  if (kind === 'react-prop-reference') return 'prop-reference'
  return 'relationship-site'
}

function orderForRelationship(kind: ReactFlowRelationshipKind): number {
  if (kind === 'react-passes-prop' || kind === 'react-passes-callback-prop') return 4
  if (kind === 'react-callback-invoked-by-child') return 5
  if (kind === 'react-event-uses-handler') return 6
  if (kind === 'react-handler-reads-state' || kind === 'react-handler-sets-state') return 7
  if (kind === 'react-state-controls-jsx-branch') return 8
  if (kind === 'react-helper-computes-prop') return 9
  if (kind === 'react-prop-reference') return 10
  return 11
}

function reasonForRelationship(relationship: ReactFlowRelationship): string {
  const prop = relationship.propName ? ` "${relationship.propName}"` : ''
  if (relationship.kind === 'react-passes-prop') return `parent JSX passes prop${prop} to a local child`
  if (relationship.kind === 'react-passes-callback-prop') return `parent JSX passes callback prop${prop} to a local child`
  if (relationship.kind === 'react-callback-invoked-by-child') return `local child invokes callback prop${prop}`
  if (relationship.kind === 'react-event-uses-handler') return 'JSX event attribute references a handler'
  if (relationship.kind === 'react-handler-reads-state') return 'handler reads React state'
  if (relationship.kind === 'react-handler-sets-state') return 'handler calls React state setter'
  if (relationship.kind === 'react-state-controls-jsx-branch') return 'React state appears in JSX branch condition'
  if (relationship.kind === 'react-helper-computes-prop') return `helper computes prop${prop}`
  if (relationship.kind === 'react-prop-reference') return `removed-prop reference candidate${prop}`
  return relationship.kind
}

function summarizeRelationship(
  relationship: ReactFlowRelationship,
  componentNameById: Map<string, string>,
): string {
  const source = componentNameById.get(relationship.sourceId) ?? relationship.sourceId
  const target = relationship.targetId ? (componentNameById.get(relationship.targetId) ?? relationship.targetId) : 'unknown'
  const prop = relationship.propName ? ` prop=${relationship.propName}` : ''
  return `${relationship.kind}: ${source} -> ${target}${prop}`
}

function ownerName(relationship: ReactFlowRelationship, componentNameById: Map<string, string>): string | null {
  if (relationship.ownerComponentId) return componentNameById.get(relationship.ownerComponentId) ?? relationship.ownerComponentId
  return componentNameById.get(relationship.sourceId) ?? null
}

function relatedRelationshipIds(
  relationships: ReactFlowRelationship[],
  targetId: string,
  kind: ReactFlowRelationshipKind,
): string[] {
  return relationships
    .filter((relationship) => relationship.kind === kind && relationship.targetId === targetId)
    .map((relationship) => relationship.id)
}
