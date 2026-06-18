import type {
  FrontendSemanticArtifact,
  FrontendFileResult,
  FrontendSourceRef,
} from '../frontend/frontendTypes.js'
import { toForwardSlash } from '../io/pathUtils.js'

export type ReactRegionMatchKind =
  | 'component'
  | 'local-component'
  | 'jsx-region'
  | 'hook'
  | 'prop-type'

export interface ReactRegionMatch {
  matchedKind: ReactRegionMatchKind
  matchedId: string
  matchedName: string
  filePath: string
  startLine: number
  endLine: number
  warnings: string[]
}

export interface ReactRegionResult {
  region: string
  filePath: string
  match: ReactRegionMatch
  candidates: ReactRegionCandidate[]
}

export interface ReactRegionCandidate {
  kind: ReactRegionMatchKind
  id: string
  name: string
  startLine: number
  endLine: number
}

/** Thrown when no match is found or the file is not in the frontend artifact. */
export class ReactRegionNotFoundError extends Error {
  constructor(
    public readonly region: string,
    public readonly filePath: string,
    public readonly available: ReactRegionCandidate[],
  ) {
    super(
      `React region "${region}" not found in ${filePath}.` +
        (available.length > 0
          ? `\nAvailable regions:\n${available.map((c) => `  ${c.kind}: ${c.name} (lines ${c.startLine}–${c.endLine})`).join('\n')}`
          : '\nNo named regions found in this file.'),
    )
  }
}

/**
 * Find a named React region in the frontend artifact for a given file.
 * Resolution priority: component → local-component → jsx-region → hook → prop-type.
 * Matching is case-insensitive on name; exact match is preferred.
 */
export function findReactRegion(options: {
  region: string
  filePath: string
  frontendArtifact: FrontendSemanticArtifact
}): ReactRegionResult {
  const { region, frontendArtifact } = options
  const filePath = toForwardSlash(options.filePath)

  const fileResult = frontendArtifact.files.find(
    (f) => toForwardSlash(f.filePath) === filePath,
  )
  if (!fileResult) {
    throw new ReactRegionNotFoundError(region, filePath, [])
  }

  const all = gatherCandidates(fileResult)
  const match = resolveMatch(region, all)
  if (!match) {
    throw new ReactRegionNotFoundError(region, filePath, all)
  }

  return {
    region,
    filePath,
    match,
    candidates: all,
  }
}

function gatherCandidates(fileResult: FrontendFileResult): ReactRegionCandidate[] {
  const out: ReactRegionCandidate[] = []

  for (const c of fileResult.components) {
    if (!c.sourceRef || !c.name) continue
    out.push(candidate('component', c.id, c.name, c.sourceRef))
  }

  for (const c of fileResult.localComponents) {
    if (!c.sourceRef || !c.name) continue
    out.push(candidate('local-component', c.id, c.name, c.sourceRef))
  }

  for (const r of fileResult.jsxRegions) {
    if (!r.sourceRef) continue
    const name = r.id
    out.push(candidate('jsx-region', r.id, name, r.sourceRef))
  }

  for (const h of fileResult.hooks) {
    if (!h.sourceRef) continue
    const name = h.stateVarName ?? h.hookName
    out.push(candidate('hook', h.id, name, h.sourceRef))
  }

  for (const p of fileResult.propTypes) {
    if (!p.sourceRef || !p.name) continue
    out.push(candidate('prop-type', p.id, p.name, p.sourceRef))
  }

  return out
}

function candidate(
  kind: ReactRegionMatchKind,
  id: string,
  name: string,
  sourceRef: FrontendSourceRef,
): ReactRegionCandidate {
  return { kind, id, name, startLine: sourceRef.line, endLine: sourceRef.endLine }
}

function resolveMatch(
  region: string,
  candidates: ReactRegionCandidate[],
): ReactRegionMatch | null {
  const lowerRegion = region.toLowerCase()

  // Priority order for kind
  const kindOrder: ReactRegionMatchKind[] = [
    'component',
    'local-component',
    'jsx-region',
    'hook',
    'prop-type',
  ]

  // Exact match by name first, then case-insensitive, then by ID
  for (const kind of kindOrder) {
    const byKind = candidates.filter((c) => c.kind === kind)

    const exactByName = byKind.find((c) => c.name === region)
    if (exactByName) return toMatch(exactByName)

    const caseInsensitiveName = byKind.find((c) => c.name.toLowerCase() === lowerRegion)
    if (caseInsensitiveName) return toMatch(caseInsensitiveName)

    const exactById = byKind.find((c) => c.id === region)
    if (exactById) return toMatch(exactById)

    const caseInsensitiveId = byKind.find((c) => c.id.toLowerCase() === lowerRegion)
    if (caseInsensitiveId) return toMatch(caseInsensitiveId)
  }

  return null
}

function toMatch(c: ReactRegionCandidate): ReactRegionMatch {
  return {
    matchedKind: c.kind,
    matchedId: c.id,
    matchedName: c.name,
    filePath: '',
    startLine: c.startLine,
    endLine: c.endLine,
    warnings: [],
  }
}
