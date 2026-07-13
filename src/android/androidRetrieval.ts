/**
 * Shared Android retrieval helper (v1.10.0 Batch 6).
 *
 * One bounded resolution layer reused by `search --android-route|--permission|--resource|--android-component`,
 * `lookup --android-component`, `source --android-route|--resource`, and
 * `slice --android-route|--android-component`. It never reparses source, never
 * re-runs analyzers, never rebuilds Android artifacts, and never creates a
 * second search index or graph: it only reads the already-built `code-graph.json`
 * (Batch 5's compact `android-*` nodes/edges) through the existing index-loading
 * infrastructure and resolves exact candidates from it.
 *
 * All matching is exact-first: no fuzzy matching, no case folding of
 * fully-qualified names/permission names/resource names/route strings, and
 * every one-to-many match is preserved as a list of candidates rather than a
 * single selected winner.
 */

import type { CodeGraph, CodeGraphNode } from '../graph/codeGraphTypes.js'
import { readIndexManifest } from '../indexing/readIndexManifest.js'
import { readRequiredJson } from '../indexing/loadIndexArtifacts.js'

export interface AndroidGraphData {
  indexDir: string
  codeGraphPath: string
  codeGraph: CodeGraph
  androidNodes: CodeGraphNode[]
}

/** Loads `code-graph.json` through the existing manifest-driven artifact loader and extracts the compact `android-*` node subset. Throws the existing "missing index" / "malformed JSON" errors when the index or code graph is absent or invalid - it never fabricates an empty graph to hide a missing artifact. */
export function loadAndroidGraphData(indexDir: string): AndroidGraphData {
  const resolved = readIndexManifest(indexDir)
  const codeGraph = readRequiredJson<CodeGraph>(resolved.artifactPaths.codeGraph, 'code graph')
  const androidNodes = codeGraph.nodes.filter((node) => node.kind.startsWith('android-'))
  return { indexDir, codeGraphPath: resolved.artifactPaths.codeGraph, codeGraph, androidNodes }
}

function candidateFrom(node: CodeGraphNode, matchKind: string, matchedValue: string): AndroidCandidateBase {
  return {
    graphNodeId: node.id,
    kind: node.kind,
    label: node.label,
    matchKind,
    matchedValue,
    androidArtifactId: node.androidArtifactId,
    androidEntityId: node.androidEntityId,
    moduleId: node.androidModuleId,
    sourceSetId: node.androidSourceSetId,
    path: node.path,
    line: node.line,
    androidMetadata: node.androidMetadata,
  }
}

export interface AndroidCandidateBase {
  graphNodeId: string
  kind: string
  label: string
  matchKind: string
  matchedValue: string
  androidArtifactId?: string
  androidEntityId?: string
  moduleId?: string
  sourceSetId?: string
  path?: string
  line?: number
  androidMetadata?: Record<string, string | number | boolean | null>
}

function dedupeCandidates<T extends AndroidCandidateBase>(candidates: T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const candidate of candidates) {
    const key = `${candidate.graphNodeId}::${candidate.matchKind}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(candidate)
  }
  result.sort((a, b) => a.graphNodeId.localeCompare(b.graphNodeId) || a.matchKind.localeCompare(b.matchKind))
  return result
}

// ---------------------------------------------------------------------------
// Route resolution (search/source/slice --android-route)
// ---------------------------------------------------------------------------

export type AndroidRouteMatchKind =
  | 'compose-string-route'
  | 'compose-local-constant-route'
  | 'compose-type-route'
  | 'xml-destination-route'
  | 'xml-destination-id'
  | 'xml-graph-route'
  | 'xml-graph-id'

export interface AndroidRouteCandidate extends AndroidCandidateBase {
  matchKind: AndroidRouteMatchKind
}

/** Exact-match only: `home`, `Home`, `/home`, `home/{id}` are all distinct unless the artifact already normalized them (Batch 4 never does). Dynamic/unresolved Compose route expressions carry no `resolvedRoute` and are never matched. A `type-safe-route` (`composable<RouteType>(...)`) carries no `resolvedRoute` either - it is matched against its own `typeRouteName` field instead (v1.10.0 Batch 7 correction: this field was recorded by Batch 4 but not yet projected into Batch 5's compact `androidMetadata`, and the Batch 6 resolver never matched it - the destination existed in the graph but could never be found by `--android-route`). */
export function resolveAndroidRouteCandidates(graphData: AndroidGraphData, query: string): AndroidRouteCandidate[] {
  const results: AndroidRouteCandidate[] = []
  for (const node of graphData.androidNodes) {
    const meta = node.androidMetadata ?? {}
    if (node.kind === 'android-compose-route') {
      if (meta.evidenceKind === 'type-safe-route') {
        if (typeof meta.typeRouteName === 'string' && meta.typeRouteName === query) {
          results.push({ ...candidateFrom(node, 'compose-type-route', meta.typeRouteName), matchKind: 'compose-type-route' })
        }
      } else if (typeof meta.resolvedRoute === 'string' && meta.resolvedRoute === query) {
        const matchKind: AndroidRouteMatchKind =
          meta.evidenceKind === 'resolved-local-constant-route' ? 'compose-local-constant-route' : 'compose-string-route'
        results.push({ ...candidateFrom(node, matchKind, meta.resolvedRoute), matchKind })
      }
    } else if (node.kind === 'android-navigation-destination') {
      if (typeof meta.route === 'string' && meta.route === query) {
        results.push({ ...candidateFrom(node, 'xml-destination-route', meta.route), matchKind: 'xml-destination-route' })
      }
      if (node.label === query) {
        results.push({ ...candidateFrom(node, 'xml-destination-id', node.label), matchKind: 'xml-destination-id' })
      }
    } else if (node.kind === 'android-navigation-graph') {
      if (typeof meta.route === 'string' && meta.route === query) {
        results.push({ ...candidateFrom(node, 'xml-graph-route', meta.route), matchKind: 'xml-graph-route' })
      }
      if (node.label === query) {
        results.push({ ...candidateFrom(node, 'xml-graph-id', node.label), matchKind: 'xml-graph-id' })
      }
    }
  }
  return dedupeCandidates(results)
}

// ---------------------------------------------------------------------------
// Permission resolution (search --permission)
// ---------------------------------------------------------------------------

export type AndroidPermissionMatchKind = 'declared-permission' | 'permission-reference'

export interface AndroidPermissionCandidate extends AndroidCandidateBase {
  matchKind: AndroidPermissionMatchKind
}

/** Exact permission-name match only - no `android.permission.` prefix inference, no alias resolution. Matches both locally-declared `<permission>` nodes and reference nodes created for any permission attribute/`<uses-permission>` that names it (declared locally or not). */
export function resolveAndroidPermissionCandidates(graphData: AndroidGraphData, query: string): AndroidPermissionCandidate[] {
  const results: AndroidPermissionCandidate[] = []
  for (const node of graphData.androidNodes) {
    if (node.kind !== 'android-permission') continue
    const meta = node.androidMetadata ?? {}
    if (meta.name !== query) continue
    const matchKind: AndroidPermissionMatchKind = meta.local === true ? 'declared-permission' : 'permission-reference'
    results.push({ ...candidateFrom(node, matchKind, query), matchKind })
  }
  return dedupeCandidates(results)
}

/** Returns the component/manifest-file nodes that reference a resolved permission node id, via Batch 5's `component-uses-permission`/`manifest-uses-permission` edges - never a security verdict, only static reference evidence. */
export function findPermissionReferers(graphData: AndroidGraphData, permissionNodeId: string): Array<{ source: string; kind: string; metadata?: Record<string, string | number | boolean | null> }> {
  return graphData.codeGraph.edges
    .filter((edge) => edge.target === permissionNodeId && (edge.kind === 'component-uses-permission' || edge.kind === 'manifest-uses-permission'))
    .map((edge) => ({ source: edge.source, kind: edge.kind, metadata: edge.metadata }))
}

// ---------------------------------------------------------------------------
// Resource resolution (search/source --resource)
// ---------------------------------------------------------------------------

export type AndroidResourceMatchKind = 'canonical-key' | 'bare-name'

export interface AndroidResourceCandidate extends AndroidCandidateBase {
  matchKind: AndroidResourceMatchKind
  resourceType: string
  resourceName: string
}

export interface ParsedResourceSelector {
  type: string | null
  name: string
}

/** Normalizes `@type/name`, `type/name`, and bare `name` selector forms only - never changes what counts as a match beyond stripping the optional `@` prefix and splitting on the first `/`. */
export function parseResourceSelector(selector: string): ParsedResourceSelector {
  const stripped = selector.startsWith('@') ? selector.slice(1) : selector
  const slash = stripped.indexOf('/')
  if (slash === -1) return { type: null, name: stripped }
  return { type: stripped.slice(0, slash), name: stripped.slice(slash + 1) }
}

/** Canonical `type/name` (or `@type/name`) selectors match exactly one logical key. A bare name matches every resource type sharing that name - ambiguity across types is preserved, never narrowed. */
export function resolveAndroidResourceCandidates(graphData: AndroidGraphData, selector: string): AndroidResourceCandidate[] {
  const parsed = parseResourceSelector(selector)
  const results: AndroidResourceCandidate[] = []
  for (const node of graphData.androidNodes) {
    if (node.kind !== 'android-resource-definition') continue
    const meta = node.androidMetadata ?? {}
    const type = typeof meta.type === 'string' ? meta.type : null
    const name = typeof meta.name === 'string' ? meta.name : null
    if (!type || !name) continue
    if (parsed.type !== null) {
      if (type !== parsed.type || name !== parsed.name) continue
      results.push({ ...candidateFrom(node, 'canonical-key', `${type}/${name}`), matchKind: 'canonical-key', resourceType: type, resourceName: name })
    } else {
      if (name !== parsed.name) continue
      results.push({ ...candidateFrom(node, 'bare-name', name), matchKind: 'bare-name', resourceType: type, resourceName: name })
    }
  }
  return dedupeCandidates(results)
}

// ---------------------------------------------------------------------------
// Component resolution (search/lookup/slice --android-component)
// ---------------------------------------------------------------------------

export type AndroidComponentMatchKind = 'resolved-fqcn' | 'raw-manifest-name' | 'simple-name'

export interface AndroidComponentCandidate extends AndroidCandidateBase {
  matchKind: AndroidComponentMatchKind
  sourceClassCandidates: string[]
}

/** Exact matching only, in priority order: resolved fully-qualified name, then raw manifest name (`.MainActivity`, unqualified), then exact simple class name (deliberately ambiguity-prone - every component whose resolved FQCN ends in `.<name>` is returned, never narrowed to one). Source-class candidates come from Batch 5's `manifest-component-resolves-to-source` edges, never re-derived. */
export function resolveAndroidComponentCandidates(graphData: AndroidGraphData, query: string): AndroidComponentCandidate[] {
  const results: AndroidComponentCandidate[] = []
  for (const node of graphData.androidNodes) {
    if (node.kind !== 'android-manifest-component') continue
    const meta = node.androidMetadata ?? {}
    const resolvedName = typeof meta.resolvedName === 'string' ? meta.resolvedName : null
    const rawName = typeof meta.rawName === 'string' ? meta.rawName : null
    const sourceClassCandidates = graphData.codeGraph.edges
      .filter((edge) => edge.source === node.id && edge.kind === 'manifest-component-resolves-to-source')
      .map((edge) => edge.target)
      .sort()

    let matchKind: AndroidComponentMatchKind | null = null
    if (resolvedName !== null && resolvedName === query) {
      matchKind = 'resolved-fqcn'
    } else if (rawName !== null && rawName === query) {
      matchKind = 'raw-manifest-name'
    } else if (resolvedName !== null && simpleClassName(resolvedName) === query) {
      matchKind = 'simple-name'
    }
    if (!matchKind) continue

    results.push({
      ...candidateFrom(node, matchKind, query),
      matchKind,
      sourceClassCandidates,
    })
  }
  return dedupeCandidates(results)
}

function simpleClassName(fullyQualifiedName: string): string {
  const lastDot = fullyQualifiedName.lastIndexOf('.')
  return lastDot === -1 ? fullyQualifiedName : fullyQualifiedName.slice(lastDot + 1)
}

// ---------------------------------------------------------------------------
// Selector-mode dispatch (search/lookup/source/slice --android-route|--permission|--resource|--android-component)
// ---------------------------------------------------------------------------

export type AndroidSelectorMode = 'android-route' | 'permission' | 'resource' | 'android-component'

export interface AndroidSelectorFlags {
  androidRoute?: string
  permission?: string
  resource?: string
  androidComponent?: string
}

/** Mirrors `resolveReachabilityMode`'s mutual-exclusivity contract for the four new Android selector flags. Returns null when none are present. */
export function resolveAndroidSelectorMode(flags: AndroidSelectorFlags): { mode: AndroidSelectorMode; query: string } | null {
  const supplied: Array<{ mode: AndroidSelectorMode; query: string; flag: string }> = []
  if (flags.androidRoute !== undefined) supplied.push({ mode: 'android-route', query: flags.androidRoute, flag: '--android-route' })
  if (flags.permission !== undefined) supplied.push({ mode: 'permission', query: flags.permission, flag: '--permission' })
  if (flags.resource !== undefined) supplied.push({ mode: 'resource', query: flags.resource, flag: '--resource' })
  if (flags.androidComponent !== undefined) supplied.push({ mode: 'android-component', query: flags.androidComponent, flag: '--android-component' })

  if (supplied.length === 0) return null
  if (supplied.length > 1) {
    const flagList = supplied.map((s) => s.flag).join(', ')
    throw new Error(
      `The Android selector flags ${flagList} are mutually exclusive. Provide only one of --android-route, --permission, --resource, or --android-component.`
    )
  }
  return { mode: supplied[0].mode, query: supplied[0].query }
}

export function resolveAndroidCandidates(graphData: AndroidGraphData, mode: AndroidSelectorMode, query: string): AndroidCandidateBase[] {
  if (mode === 'android-route') return resolveAndroidRouteCandidates(graphData, query)
  if (mode === 'permission') return resolveAndroidPermissionCandidates(graphData, query)
  if (mode === 'resource') return resolveAndroidResourceCandidates(graphData, query)
  return resolveAndroidComponentCandidates(graphData, query)
}

// ---------------------------------------------------------------------------
// Search result
// ---------------------------------------------------------------------------

export interface AndroidSearchResultItem {
  graphNodeId: string
  androidArtifactId?: string
  androidEntityId?: string
  kind: string
  matchKind: string
  matchedValue: string
  label: string
  moduleId?: string
  sourceSetId?: string
  path?: string
  line?: number
  androidMetadata?: Record<string, string | number | boolean | null>
  /** `permission` mode only: components/manifests statically referencing this permission. */
  referers?: Array<{ source: string; kind: string }>
  /** `android-component` mode only: exact source-class candidates via `manifest-component-resolves-to-source`. */
  sourceClassCandidates?: string[]
}

export interface AndroidSearchResult {
  artifactKind: 'my-dev-kit-v1-android-search-result'
  version: '1.0.0'
  mode: AndroidSelectorMode
  query: string
  status: 'ok' | 'missing-index'
  results: AndroidSearchResultItem[]
  warnings: string[]
  summary: { resultCount: number }
}

export function buildAndroidSearchResult(graphData: AndroidGraphData, mode: AndroidSelectorMode, query: string): AndroidSearchResult {
  const candidates = resolveAndroidCandidates(graphData, mode, query)
  const results = candidates.map((candidate) => toSearchResultItem(graphData, mode, candidate))
  return {
    artifactKind: 'my-dev-kit-v1-android-search-result',
    version: '1.0.0',
    mode,
    query,
    status: 'ok',
    results,
    warnings: [],
    summary: { resultCount: results.length },
  }
}

function toSearchResultItem(graphData: AndroidGraphData, mode: AndroidSelectorMode, candidate: AndroidCandidateBase): AndroidSearchResultItem {
  const item: AndroidSearchResultItem = {
    graphNodeId: candidate.graphNodeId,
    androidArtifactId: candidate.androidArtifactId,
    androidEntityId: candidate.androidEntityId,
    kind: candidate.kind,
    matchKind: candidate.matchKind,
    matchedValue: candidate.matchedValue,
    label: candidate.label,
    moduleId: candidate.moduleId,
    sourceSetId: candidate.sourceSetId,
    path: candidate.path,
    line: candidate.line,
    androidMetadata: candidate.androidMetadata,
  }
  if (mode === 'permission') {
    item.referers = findPermissionReferers(graphData, candidate.graphNodeId).map((r) => ({ source: r.source, kind: r.kind }))
  }
  if (mode === 'android-component') {
    item.sourceClassCandidates = (candidate as AndroidComponentCandidate).sourceClassCandidates
  }
  return item
}

// ---------------------------------------------------------------------------
// lookup --android-component
// ---------------------------------------------------------------------------

export interface AndroidComponentLookupCandidateSummary {
  graphNodeId: string
  matchKind: AndroidComponentMatchKind
  kind: string
  moduleId?: string
  sourceSetId?: string
  path?: string
  rawName?: string | null
  resolvedName?: string | null
}

export interface AndroidComponentLookupDetail {
  graphNodeId: string
  androidArtifactId?: string
  androidEntityId?: string
  matchKind: AndroidComponentMatchKind
  componentKind: string | null
  rawName: string | null
  resolvedName: string | null
  moduleId?: string
  sourceSetId?: string
  manifestFile?: string
  path?: string
  line?: number
  exported: string | number | boolean | null
  exportedExplicit: string | number | boolean | null
  sourceClassCandidates: string[]
  intentFilterIds: string[]
  permissionEdges: Array<{ target: string; attribute?: string | number | boolean | null; permission?: string | number | boolean | null }>
  deepLinkMatchIds: string[]
  incomingEdgeCount: number
  outgoingEdgeCount: number
  warnings: string[]
}

export interface AndroidComponentLookupResult {
  artifactKind: 'my-dev-kit-v1-android-component-lookup-result'
  version: '1.0.0'
  query: string
  status: 'found' | 'not-found' | 'ambiguous'
  detail: AndroidComponentLookupDetail | null
  candidates: AndroidComponentLookupCandidateSummary[]
  warnings: string[]
}

/** Follows the existing lookup ambiguity contract: a unique exact candidate returns detailed component information, zero candidates returns a `not-found` status, and more than one exact candidate returns `ambiguous` with every candidate's stable ID preserved - never a chosen winner. */
export function buildAndroidComponentLookupResult(graphData: AndroidGraphData, query: string): AndroidComponentLookupResult {
  const candidates = resolveAndroidComponentCandidates(graphData, query)

  if (candidates.length === 0) {
    return {
      artifactKind: 'my-dev-kit-v1-android-component-lookup-result',
      version: '1.0.0',
      query,
      status: 'not-found',
      detail: null,
      candidates: [],
      warnings: [`No exact Android component match for "${query}".`],
    }
  }

  if (candidates.length > 1) {
    return {
      artifactKind: 'my-dev-kit-v1-android-component-lookup-result',
      version: '1.0.0',
      query,
      status: 'ambiguous',
      detail: null,
      candidates: candidates.map((c) => ({
        graphNodeId: c.graphNodeId,
        matchKind: c.matchKind,
        kind: c.kind,
        moduleId: c.moduleId,
        sourceSetId: c.sourceSetId,
        path: c.path,
        rawName: typeof c.androidMetadata?.rawName === 'string' ? c.androidMetadata.rawName : null,
        resolvedName: typeof c.androidMetadata?.resolvedName === 'string' ? c.androidMetadata.resolvedName : null,
      })),
      warnings: [`Multiple exact Android components match "${query}"; no candidate was selected.`],
    }
  }

  const candidate = candidates[0]!
  const node = graphData.androidNodes.find((n) => n.id === candidate.graphNodeId)!
  const meta = node.androidMetadata ?? {}
  const outgoing = graphData.codeGraph.edges.filter((edge) => edge.source === node.id)
  const incoming = graphData.codeGraph.edges.filter((edge) => edge.target === node.id)

  const detail: AndroidComponentLookupDetail = {
    graphNodeId: node.id,
    androidArtifactId: node.androidArtifactId,
    androidEntityId: node.androidEntityId,
    matchKind: candidate.matchKind,
    componentKind: typeof meta.componentKind === 'string' ? meta.componentKind : null,
    rawName: typeof meta.rawName === 'string' ? meta.rawName : null,
    resolvedName: typeof meta.resolvedName === 'string' ? meta.resolvedName : null,
    moduleId: node.androidModuleId,
    sourceSetId: node.androidSourceSetId,
    manifestFile: incoming.find((e) => e.kind === 'manifest-declares-component')?.source,
    path: node.path,
    line: node.line,
    exported: meta.exported ?? null,
    exportedExplicit: meta.exportedExplicit ?? null,
    sourceClassCandidates: candidate.sourceClassCandidates,
    intentFilterIds: outgoing.filter((e) => e.kind === 'component-has-intent-filter').map((e) => e.target).sort(),
    permissionEdges: outgoing
      .filter((e) => e.kind === 'component-uses-permission')
      .map((e) => ({ target: e.target, attribute: e.metadata?.attribute, permission: e.metadata?.permission })),
    deepLinkMatchIds: outgoing.filter((e) => e.kind === 'manifest-deep-link-matches-navigation-deep-link').map((e) => e.target).sort(),
    incomingEdgeCount: incoming.length,
    outgoingEdgeCount: outgoing.length,
    warnings: [
      'Static evidence only: this does not claim the component is registered, reachable, or exported at runtime.',
    ],
  }

  return {
    artifactKind: 'my-dev-kit-v1-android-component-lookup-result',
    version: '1.0.0',
    query,
    status: 'found',
    detail,
    candidates: [],
    warnings: [],
  }
}
