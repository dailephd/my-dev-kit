import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import type {
  FrontendFileResult,
  FrontendSemanticArtifact,
  FrontendSourceRef,
  ReactComponentCandidate,
} from '../frontend/index.js'
import {
  mergeConfidence,
  normalizeRoutePath,
  type ReachabilityConfidence,
  type ReachabilityEvidenceRef,
  type ReachabilityWarning,
  type RouteFact,
  type RouteFactKind,
  type RouteSourceDeclaration,
} from './types.js'

const ROUTE_LIKE = /^\/[a-zA-Z0-9_\-/:*?[\]()]+$/
/** JSX attributes that commonly carry route paths. */
const ROUTE_ATTR_REGEX =
  /\b(?:path|to|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)\s*\})/g

interface RouteCandidate {
  rawValue: string
  kind: RouteFactKind
  componentId: string | null
  sourceRef: FrontendSourceRef
  isDynamic: boolean
  declaration?: RouteSourceDeclaration
}

export interface ExtractRouteFactsOptions {
  frontendArtifact: FrontendSemanticArtifact
  /** Optional repo root. When provided, JSX route attributes are scanned from source. */
  repoRoot?: string
}

/**
 * Extracts RouteFact[] from a FrontendSemanticArtifact.
 *
 * Sources:
 *  - RouteStringCandidate in test files → test-mentioned-route (medium)
 *  - Static JSX path=/to=/href= attributes with route-like strings → link/navigation-target (high)
 *  - Next.js pages/ convention → page (medium)
 *  - Dynamic (${...}) values → low confidence + dynamic-route warning
 */
export function extractRouteFacts(options: ExtractRouteFactsOptions): RouteFact[] {
  const { frontendArtifact, repoRoot } = options
  const routeMap = new Map<string, RouteFact>()

  for (const file of [...frontendArtifact.files].sort((a, b) => a.filePath.localeCompare(b.filePath))) {
    for (const candidate of collectRouteCandidates(file, repoRoot)) {
      upsertRouteFact(routeMap, candidate)
    }
  }

  for (const route of routeMap.values()) {
    const pages = route.declarations?.filter((d) => d.kind === 'page') ?? []
    if (route.declarations?.some((d) => d.convention)) {
      const appPages = pages.filter((d) => d.convention === 'app-page' && d.status === 'supported')
      route.componentIds = !route.declarationsTruncated && appPages.length === 1 && appPages[0].componentId
        ? [appPages[0].componentId]
        : []
    }
    if (pages.length > 1) {
      route.warnings.push({ kind: 'ambiguous-component-ownership', factId: route.id, message: `Conflicting page candidates: ${pages.slice(0, 20).map((d) => d.sourceRef.filePath).join(', ')}${pages.length > 20 ? ' (truncated)' : ''}` })
      route.componentIds = []
    }
    const supported = route.declarations?.filter((d) => (d.kind === 'page' || d.kind === 'route-definition') && d.status === 'supported') ?? []
    route.testEvidenceRefs = []
    if (supported.length !== 1 || route.declarationsTruncated || pages.length > 1 || /[\[\]:*]/.test(route.path)) continue
    for (const file of frontendArtifact.files) {
      for (const rs of file.routeStrings ?? []) {
        if (rs.evidenceKind !== 'literal-goto' || rs.value !== route.path) continue
        const block = file.testBlocks.find((b) => b.id === rs.testBlockId && (b.kind === 'test' || b.kind === 'it') && b.framework === 'playwright' && rs.sourceRef.line >= b.sourceRef.line && rs.sourceRef.endLine <= b.sourceRef.endLine)
        if (!block) continue
        if (route.testEvidenceRefs.length >= 32) {
          if (!route.warnings.some((w) => w.kind === 'partial-extraction')) route.warnings.push({ kind: 'partial-extraction', message: 'Route test evidence truncated at 32 references', factId: route.id })
          break
        }
        route.testEvidenceRefs.push({ filePath: file.filePath, line: rs.sourceRef.line, locatorKind: 'goto', locatorValue: rs.value, testBlockId: block.id, testBlockTitle: block.title, testFramework: block.framework })
      }
    }
  }
  return [...routeMap.values()].sort((a, b) => a.path.localeCompare(b.path))
}

function collectRouteCandidates(file: FrontendFileResult, repoRoot?: string): RouteCandidate[] {
  const candidates: RouteCandidate[] = []
  if (file.parseError) return candidates

  // Source 1: RouteStringCandidate (extracted from test files by frontendAnalyzer)
  for (const rs of file.routeStrings ?? []) {
    candidates.push({
      rawValue: rs.value,
      kind: 'test-mentioned-route',
      componentId: null,
      sourceRef: rs.sourceRef,
      isDynamic: false,
    })
  }

  // Source 2: Static JSX route attributes (requires source text).
  if (repoRoot) {
    candidates.push(...collectJsxRouteAttributes(file, repoRoot))
  }

  // Source 3: Next.js / Astro file path convention.
  const pageRoute = derivePageRoute(file)
  if (pageRoute) {
    candidates.push(pageRoute)
  }
  const appRoute = deriveAppRoute(file)
  if (appRoute) candidates.push(appRoute)

  return candidates
}

function deriveAppRoute(file: FrontendFileResult): RouteCandidate | null {
  const path = file.filePath.replace(/\\/g, '/')
  if (file.isTestFile || path.split('/').some((s) => s === '..' || s === '.') || !/^(?:src\/)?app\//.test(path)) return null
  const rest = path.replace(/^(?:src\/)?app\//, '')
  const parts = rest.split('/')
  const filename = parts.pop()!
  if (!/^(?:page\.[jt]sx?|route\.[jt]s)$/.test(filename) || parts.some((s) => s.startsWith('_') || s.toLowerCase().startsWith('%5f'))) return null
  const handler = filename.startsWith('route.')
  const unsupported = parts.some((s) => s.startsWith('@') || /^\(\./.test(s))
  const groups = parts.filter((s) => /^\([^.)][^/]*\)$/.test(s))
  const segments = parts.filter((s) => !groups.includes(s))
  const segmentKinds: NonNullable<RouteSourceDeclaration['segmentKinds']> = segments.map((s) => /^\[\[\.\.\.[^\]]+\]\]$/.test(s) ? 'optional-catch-all' : /^\[\.\.\.[^\]]+\]$/.test(s) ? 'catch-all' : /^\[[^\]]+\]$/.test(s) ? 'dynamic' : 'static')
  const raw = '/' + segments.join('/')
  const partial = raw.length > 256 || segments.length > 32 || groups.length > 32
  const warnings: ReachabilityWarning[] = []
  if (unsupported) warnings.push({ kind: 'unsupported-pattern', message: 'Parallel/intercepting directory: lexical pattern only; effective URL composition unresolved' })
  if (partial) warnings.push({ kind: 'partial-extraction', message: 'App convention evidence truncated; complete route pattern not established' })
  const defaults = file.components.filter((c) => c.isDefaultExport && c.sourceRef.filePath === file.filePath)
  const componentId = !handler && !unsupported && !partial && defaults.length === 1 ? defaults[0].id : null
  const sourceRef = { filePath: file.filePath, line: 1, endLine: 1 }
  const methods = (file.routeHandlerMethods ?? []).slice(0, 32).map((m) => ({ method: m.method, sourceRef: toEvidenceRef(m.sourceRef) }))
  if (file.routeHandlerMethodsTruncated || (file.routeHandlerMethods?.length ?? 0) > 32) warnings.push({ kind: 'partial-extraction', message: 'Observed HTTP method declarations truncated at 32' })
  if (handler && methods.length === 0) warnings.push({ kind: 'partial-extraction', message: 'No supported named exported HTTP implementation established; dynamic exports unresolved' })
  const isDynamic = segmentKinds.some((s) => s !== 'static')
  return {
    rawValue: raw.slice(0, 256), kind: handler ? 'route-definition' : 'page', componentId, sourceRef, isDynamic,
    declaration: { kind: handler ? 'route-definition' : 'page', sourceRef: toEvidenceRef(sourceRef), pattern: raw.slice(0, 256), convention: handler ? 'app-route-handler' : 'app-page', segmentKinds: segmentKinds.slice(0, 32), routeGroups: groups.slice(0, 32), status: unsupported ? 'unsupported' : warnings.some((w) => w.kind === 'partial-extraction') ? 'partial' : 'supported', componentId, ...(handler ? { methods } : {}), confidence: isDynamic || unsupported || partial ? 'low' : 'medium', warnings },
  }
}

function collectJsxRouteAttributes(file: FrontendFileResult, repoRoot: string): RouteCandidate[] {
  if (file.isTestFile) return []
  let sourceText: string
  try {
    sourceText = fs.readFileSync(nodePath.join(repoRoot, file.filePath), 'utf8')
  } catch {
    return []
  }

  const candidates: RouteCandidate[] = []
  const lines = sourceText.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    ROUTE_ATTR_REGEX.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = ROUTE_ATTR_REGEX.exec(line)) !== null) {
      const template = match[5]
      const literal = match[1] ?? match[2] ?? match[3] ?? match[4]
      if (template !== undefined) {
        // Template literal — dynamic if it contains an interpolation.
        const isDynamic = template.includes('${')
        if (!isDynamic && !ROUTE_LIKE.test(template)) continue
        candidates.push({
          rawValue: template,
          kind: 'navigation-target',
          componentId: findOwningComponentId(file, i + 1),
          sourceRef: { filePath: file.filePath, line: i + 1, endLine: i + 1 },
          isDynamic,
        })
        continue
      }
      if (literal === undefined) continue
      if (!ROUTE_LIKE.test(literal)) continue
      candidates.push({
        rawValue: literal,
        kind: 'link-target',
        componentId: findOwningComponentId(file, i + 1),
        sourceRef: { filePath: file.filePath, line: i + 1, endLine: i + 1 },
        isDynamic: false,
      })
    }
  }
  return candidates
}

function derivePageRoute(file: FrontendFileResult): RouteCandidate | null {
  const normalized = file.filePath.replace(/\\/g, '/')
  let rest: string | null = null
  if (normalized.startsWith('pages/')) rest = normalized.slice('pages/'.length)
  else if (normalized.startsWith('src/pages/')) rest = normalized.slice('src/pages/'.length)
  if (rest === null) return null
  if (file.isTestFile) return null

  // Strip extension.
  rest = rest.replace(/\.[jt]sx?$/, '')
  // index → directory route.
  rest = rest.replace(/\/index$/, '').replace(/^index$/, '')
  const routePath = rest === '' ? '/' : `/${rest}`
  const componentId = file.components[0]?.id ?? null
  return {
    rawValue: routePath,
    kind: 'page',
    componentId,
    sourceRef: { filePath: file.filePath, line: 1, endLine: 1 },
    isDynamic: routePath.includes('[') || routePath.includes(':'),
  }
}

function findOwningComponentId(file: FrontendFileResult, line: number): string | null {
  let best: ReactComponentCandidate | null = null
  for (const component of file.components) {
    const start = component.sourceRef.line
    const end = component.sourceRef.endLine
    if (line >= start && line <= end) {
      if (!best || component.sourceRef.line > best.sourceRef.line) best = component
    }
  }
  // Fall back to the single component in the file when there is exactly one.
  if (!best && file.components.length === 1) best = file.components[0]
  return best?.id ?? null
}

function confidenceFor(candidate: RouteCandidate): ReachabilityConfidence {
  if (candidate.isDynamic) return 'low'
  if (candidate.kind === 'link-target' || candidate.kind === 'navigation-target') return 'high'
  if (candidate.kind === 'page' || candidate.kind === 'test-mentioned-route') return 'medium'
  return 'medium'
}

function toEvidenceRef(sourceRef: FrontendSourceRef): ReachabilityEvidenceRef {
  return {
    filePath: sourceRef.filePath.replace(/\\/g, '/'),
    line: sourceRef.line,
    column: sourceRef.column ?? null,
    symbolId: sourceRef.symbolId ?? null,
  }
}

function upsertRouteFact(map: Map<string, RouteFact>, candidate: RouteCandidate): void {
  const id = `route:${normalizeRoutePath(candidate.rawValue)}`
  const confidence = candidate.declaration?.confidence ?? confidenceFor(candidate)
  const evidenceRef = toEvidenceRef(candidate.sourceRef)
  const warning: ReachabilityWarning | null = candidate.isDynamic
    ? {
        kind: 'dynamic-route',
        message: `Route path "${candidate.rawValue}" contains a dynamic segment`,
        factId: id,
      }
    : null

  const existing = map.get(id)
  const declaration: RouteSourceDeclaration = candidate.declaration ?? { kind: candidate.kind, sourceRef: evidenceRef, pattern: candidate.rawValue.slice(0, 256), status: candidate.isDynamic ? 'partial' : 'supported', componentId: candidate.componentId, confidence, warnings: warning ? [warning] : [] }
  if (existing) {
    if ((existing.declarations?.length ?? 0) >= 32) {
      existing.declarationsTruncated = true
      existing.componentIds = []
      if (!existing.warnings.some((w) => w.kind === 'partial-extraction')) existing.warnings.push({ kind: 'partial-extraction', message: 'Contributing route declarations truncated at 32', factId: id })
      return
    }
    existing.declarations!.push(declaration)
    existing.warnings.push(...(candidate.declaration?.warnings ?? []))
    if (candidate.componentId && !existing.componentIds.includes(candidate.componentId)) {
      existing.componentIds.push(candidate.componentId)
    }
    existing.sourceRefs.push(evidenceRef)
    existing.confidence = mergeConfidence(existing.confidence, confidence)
    if (warning && !existing.warnings.some((w) => w.kind === warning.kind)) {
      existing.warnings.push(warning)
    }
    return
  }

  map.set(id, {
    id,
    path: candidate.rawValue,
    kind: candidate.kind,
    componentIds: candidate.componentId ? [candidate.componentId] : [],
    sourceRefs: [evidenceRef],
    confidence,
    warnings: warning ? [warning] : [],
    declarations: [declaration],
  })
  map.get(id)!.warnings.push(...(candidate.declaration?.warnings ?? []))
}
