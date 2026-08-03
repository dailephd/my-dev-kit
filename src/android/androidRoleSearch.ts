/**
 * v1.12.0 Batch 5: `search --android-role <role>` - one exact, non-fuzzy
 * classification-role selector layered onto the existing `search` command
 * and its existing `SearchIndexResult` artifact shape. Reuses
 * `code-graph.json`'s already-projected compact `classificationRoles`
 * (Batches 1-2) directly - never rescans source, never re-runs
 * classification, never creates a second search index or result artifact.
 */
import type { CodeGraph, CodeGraphNode } from '../graph/codeGraphTypes.js'
import type { ResolvedIndexManifest } from '../indexing/readIndexManifest.js'
import type { SearchIndexResult, SearchMatchReason, SearchResultItem } from '../search/searchTypes.js'
import type { ClassificationRoleName } from '../classification/classificationTypes.js'

/**
 * The fixed, central Android-role search allowlist. Each entry is checked
 * against `ClassificationRoleName` at compile time (`satisfies`), so a typo
 * or an unsupported/renamed category fails the build rather than silently
 * becoming acceptable input. Deliberately excludes generic non-Android-only
 * categories (`configuration-file`, `test-block`, `test-fixture`) and every
 * prohibited synonym.
 */
export const ANDROID_ROLE_SEARCH_VALUES = [
  'android-project',
  'gradle-module',
  'android-app-module',
  'android-library-module',
  'android-manifest',
  'manifest-component',
  'navigation-route',
  'resource-file',
  'xml-layout',
  'activity',
  'fragment',
  'compose-screen',
  'compose-ui-component',
  'view-model',
  'ui-only-state',
  'ui-event',
  'repository',
  'use-case',
  'room-entity',
  'room-dao',
  'room-database',
  'retrofit-service',
  'hilt-module',
  'worker',
  'broadcast-receiver',
  'service',
  'content-provider',
  'android-unit-test',
  'instrumented-test',
  'compose-ui-test',
  'generated-file',
] as const satisfies readonly ClassificationRoleName[]

export type AndroidRoleSearchValue = (typeof ANDROID_ROLE_SEARCH_VALUES)[number]

const ANDROID_ROLE_SEARCH_SET: ReadonlySet<string> = new Set(ANDROID_ROLE_SEARCH_VALUES)

export function isAndroidRoleSearchValue(value: string): value is AndroidRoleSearchValue {
  return ANDROID_ROLE_SEARCH_SET.has(value)
}

/**
 * Android-provenance filter (section 10.5): an `android-*`-kind graph node is
 * always Android-backed; a `symbol`-kind node qualifies only when it carries
 * grounded Android component-role provenance (`androidComponentRefs`) - a
 * plain TypeScript/JS symbol that merely happens to share an overlapping
 * generic classification category (`repository`, `service`, `generated-file`,
 * `ui-only-state`, ...) is never included. Path/filename is never consulted.
 */
function hasGroundedAndroidProvenance(node: CodeGraphNode): boolean {
  if (node.kind.startsWith('android-')) return true
  if (node.kind === 'symbol' && (node.androidComponentRefs?.length ?? 0) > 0) return true
  return false
}

const EXACT_MATCH_SCORE = 100

export interface BuildAndroidRoleSearchResultOptions {
  resolved: ResolvedIndexManifest
  codeGraph: CodeGraph
  role: AndroidRoleSearchValue
  limit: number
  createdAt?: string
}

export function buildAndroidRoleSearchResult(options: BuildAndroidRoleSearchResultOptions): SearchIndexResult {
  const { resolved, codeGraph, role, limit, createdAt } = options

  const matches = codeGraph.nodes
    .filter((node) => hasGroundedAndroidProvenance(node) && node.classificationRoles?.some((r) => r.role === role))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))

  const limited = matches.slice(0, limit)
  const results: SearchResultItem[] = limited.map((node) => buildResultItem(node, role))

  return {
    artifactKind: 'my-dev-kit-v1-search-result',
    version: '1.0.0',
    createdAt: createdAt ?? new Date().toISOString(),
    indexDir: resolved.indexDir,
    query: `android-role:${role}`,
    normalizedTerms: [role],
    limit,
    results,
    androidRole: role,
    summary: {
      resultCount: results.length,
      totalMatchCount: matches.length,
      searchedFileCount: 0,
      searchedSymbolCount: 0,
      searchedEdgeCount: codeGraph.edges.length,
    },
    artifactPaths: {
      manifest: resolved.manifestPath,
      symbolIndex: resolved.artifactPaths.symbolIndex,
      codeGraph: resolved.artifactPaths.codeGraph,
    },
    warnings: [],
  }
}

function buildResultItem(node: CodeGraphNode, role: AndroidRoleSearchValue): SearchResultItem {
  const matchReasons: SearchMatchReason[] = [
    { field: 'classificationRole', term: role, weight: EXACT_MATCH_SCORE, text: `classificationRole:${role}` },
  ]
  return {
    kind: node.kind,
    id: node.id,
    label: node.label,
    path: node.path,
    score: EXACT_MATCH_SCORE,
    matchReasons,
    nodeId: node.id,
    semanticRoles: node.semanticRoles,
    artifactRefs: node.artifactRefs,
    classificationRoles: node.classificationRoles,
    classificationRefs: node.classificationRefs,
    androidComponentRoles: node.androidComponentRoles,
    androidComponentRefs: node.androidComponentRefs,
    androidArtifactId: node.androidArtifactId,
    androidMetadata: node.androidMetadata,
  }
}
