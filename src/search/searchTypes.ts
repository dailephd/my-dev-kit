import type { CodeGraph, CodeGraphEdge, CodeGraphNode, CodeGraphNodeKind } from '../graph/codeGraphTypes.js'
import type { FrontendSemanticArtifact } from '../frontend/frontendTypes.js'
import type { ResolvedIndexManifest } from '../indexing/readIndexManifest.js'
import type { SemanticArtifactRef, SemanticRole } from '../semantics/index.js'
import type { ClassificationRoleRef } from '../classification/classificationTypes.js'
import type { AndroidComponentRoleRef } from '../android/androidComponentTypes.js'
import type { SymbolIndex } from '../symbol-index/types.js'

export type SearchResultKind = 'file' | 'symbol' | 'edge' | CodeGraphNodeKind

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
  | 'androidComponentRole'
  | 'androidMetadata'

export interface SearchMatchReason {
  field: SearchMatchField
  term: string
  weight: number
  text: string
}

/** v1.12.6 Batch 1: public `search --query --intent` values. Omitted intent is `relevance`. */
export type SearchIntent = 'relevance' | 'ownership'

export const SEARCH_INTENT_VALUES: readonly SearchIntent[] = ['relevance', 'ownership']

export type SearchOwnershipTier = 'direct-owner' | 'production-candidate' | 'supporting-evidence'

export type SearchOwnershipEvidenceKind = 'direct-symbol-name' | 'classified-primary-edit' | 'production-lexical-match'

export interface SearchOwnershipEvidence {
  kind: SearchOwnershipEvidenceKind
  sourceId: string
}

/** Ownership-mode only: static, inspectable tier evidence. `lexicalScore` always equals the result `score`. */
export interface SearchResultOwnership {
  tier: SearchOwnershipTier
  lexicalScore: number
  evidence: SearchOwnershipEvidence[]
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
  androidComponentRoles?: AndroidComponentRoleRef[]
  androidComponentRefs?: SemanticArtifactRef[]
  /** Compact Batch 5 evidence for `android-*` node kinds only (v1.10.0 Batch 6) - never a full artifact record. */
  androidArtifactId?: string
  androidMetadata?: Record<string, string | number | boolean | null>
  /** v1.12.6 Batch 1: present only when `intent: 'ownership'` was requested. */
  ownership?: SearchResultOwnership
}

export interface SearchIndexOptions {
  query: string
  limit?: number
  /** v1.12.6 Batch 1: `relevance` (default, unchanged output) or `ownership`. */
  intent?: SearchIntent
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
  /** v1.12.0 Batch 5: `search --android-role` only - total exact matches before `--limit` is applied. `resultCount` remains the returned (post-limit) count, matching existing convention. */
  totalMatchCount?: number
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
  /** v1.12.0 Batch 5: present only for `search --android-role <role>` - the exact requested role. */
  androidRole?: string
  /** v1.12.6 Batch 1: present only (as `ownership`) when ownership intent was requested. */
  intent?: 'ownership'
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
