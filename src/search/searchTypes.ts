import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from '../graph/codeGraphTypes.js'
import type { FrontendSemanticArtifact } from '../frontend/frontendTypes.js'
import type { ResolvedIndexManifest } from '../indexing/readIndexManifest.js'
import type { SemanticArtifactRef, SemanticRole } from '../semantics/index.js'
import type { ClassificationRoleRef } from '../classification/classificationTypes.js'
import type { SymbolIndex } from '../symbol-index/types.js'

export type SearchResultKind = 'file' | 'symbol' | 'edge'

export type SearchMatchField =
  | 'path'
  | 'label'
  | 'symbolName'
  | 'symbolKind'
  | 'import'
  | 'export'
  | 'edgeKind'
  | 'nodeId'
  | 'neighbor'
  | 'semanticRole'
  | 'semanticSubtype'
  | 'semanticSource'
  | 'semanticArtifactRef'
  | 'frontendValue'
  | 'classificationRole'
  | 'classificationEditGuidance'

export interface SearchMatchReason {
  field: SearchMatchField
  term: string
  weight: number
  text: string
}

export interface SearchResultItem {
  kind: SearchResultKind
  id: string
  label: string
  path?: string
  score: number
  matchReasons: SearchMatchReason[]
  nodeId?: string
  edge?: {
    source: string
    target: string
    kind: string
  }
  semanticRoles?: SemanticRole[]
  artifactRefs?: SemanticArtifactRef[]
  classificationRoles?: ClassificationRoleRef[]
  classificationRefs?: SemanticArtifactRef[]
}

export interface SearchIndexOptions {
  query: string
  limit?: number
  createdAt?: string
}

export interface SearchIndexInput extends SearchIndexOptions {
  resolved: ResolvedIndexManifest
  symbolIndex: SymbolIndex
  codeGraph: CodeGraph
  /** Optional frontend semantic artifact for enriching search with UI strings, test IDs, etc. */
  frontendArtifact?: FrontendSemanticArtifact | null
}

export interface SearchIndexSummary {
  resultCount: number
  searchedFileCount: number
  searchedSymbolCount: number
  searchedEdgeCount: number
}

export interface SearchIndexResult {
  artifactKind: 'my-dev-kit-v1-search-result'
  version: '1.0.0'
  createdAt: string
  indexDir: string
  query: string
  normalizedTerms: string[]
  limit: number
  results: SearchResultItem[]
  summary: SearchIndexSummary
  artifactPaths: {
    manifest: string
    symbolIndex: string
    codeGraph: string
  }
  warnings: string[]
}

export interface SearchCandidateField {
  field: SearchMatchField
  text: string
  weight: number
}

export interface SearchCandidate {
  item: Omit<SearchResultItem, 'score' | 'matchReasons'>
  fields: SearchCandidateField[]
}

export interface SearchArtifacts {
  resolved: ResolvedIndexManifest
  symbolIndex: SymbolIndex
  codeGraph: CodeGraph
}

export type SearchableGraphNode = CodeGraphNode
export type SearchableGraphEdge = CodeGraphEdge
