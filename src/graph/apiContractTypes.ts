/**
 * v1.15.0 KIT-API-01 static API relationship contract (Batch 0).
 *
 * Type contract only. These node/edge kinds are intentionally distinct unions
 * and are NOT yet members of CodeGraphNodeKind / CodeGraphEdgeKind (that
 * integration belongs to a later batch). Nothing here extracts client calls,
 * matches routes, or builds graph nodes or edges.
 *
 * Identity model: API call IDs derive from a canonical relative file path and
 * an exact source occurrence; existing graph node IDs remain opaque; data
 * entity and field bridge IDs reference exact existing model IDs. A same-name
 * string match is not proof of a connection, and a static association does
 * not prove runtime reachability or authorization.
 */

export const API_CONTRACT_NODE_KINDS = ['api-client-call', 'api-data-entity-ref', 'api-data-field-ref'] as const
export type ApiContractNodeKind = (typeof API_CONTRACT_NODE_KINDS)[number]

export const API_CONTRACT_EDGE_KINDS = [
  'api-call-originates-in-component',
  'api-call-targets-route',
  'api-handler-references-schema',
  'api-handler-uses-data-entity',
  'api-schema-maps-data-entity',
  'api-entity-has-field',
] as const
export type ApiContractEdgeKind = (typeof API_CONTRACT_EDGE_KINDS)[number]

export const API_RESOLUTION_STATUSES = [
  'resolved-static',
  'ambiguous',
  'dynamic',
  'external',
  'outside-selected-roots',
  'unsupported',
] as const

export type ApiResolutionStatus =
  | 'resolved-static'
  | 'ambiguous'
  | 'dynamic'
  | 'external'
  | 'outside-selected-roots'
  | 'unsupported'

export const API_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'UNKNOWN'] as const
export const API_CLIENT_KINDS = ['fetch', 'axios'] as const

export interface ApiClientCallEvidence {
  id: string
  filePath: string
  startLine: number
  startColumn: number
  owningSymbolId: string | null
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'UNKNOWN'
  observedUrl: string | null
  staticPath: string | null
  clientKind: 'fetch' | 'axios'
  resolutionStatus: ApiResolutionStatus
  sourceFactId: string
}

export interface ApiUnresolvedEvidence {
  subjectId: string
  status: Exclude<ApiResolutionStatus, 'resolved-static'>
  reasonCode: string
  candidateNodeIds: string[]
  sourceFactIds: string[]
}
