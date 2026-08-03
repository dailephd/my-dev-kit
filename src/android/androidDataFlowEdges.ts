/**
 * v1.12.0 Batch 5: `slice --include-data-flow` - the fixed, central allowlist
 * of Android ownership/data-flow edge kinds eligible for the opt-in secondary
 * bounded traversal. Each entry is checked against `CodeGraphEdgeKind` at
 * compile time (`satisfies`), so a typo or unsupported/renamed edge kind
 * fails the build rather than silently becoming acceptable input.
 *
 * Covers exactly: Activity -> Compose (hosting), Compose -> ViewModel
 * (reference and state-read ownership), ViewModel -> Repository, Repository
 * -> DAO/Service, DAO -> Entity, Room Database -> DAO, and route -> screen
 * resolution (Compose and XML navigation). Never a synonym, never a fuzzy
 * match, never a repository-wide scan.
 */
import type { CodeGraphEdgeKind } from '../graph/codeGraphTypes.js'

export const ANDROID_DATA_FLOW_EDGE_KINDS = [
  'activity-hosts-composable',
  'composable-references-viewmodel',
  'compose-state-reads-viewmodel',
  'viewmodel-uses-repository',
  'repository-uses-dao',
  'repository-uses-service',
  'dao-uses-entity',
  'room-database-exposes-dao',
  'compose-route-resolves-to-screen',
  'navigation-destination-resolves-to-screen',
] as const satisfies readonly CodeGraphEdgeKind[]

export type AndroidDataFlowEdgeKind = (typeof ANDROID_DATA_FLOW_EDGE_KINDS)[number]

export const ANDROID_DATA_FLOW_EDGE_KIND_SET: ReadonlySet<string> = new Set(ANDROID_DATA_FLOW_EDGE_KINDS)
