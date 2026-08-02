import type { SemanticArtifactRef, SemanticRole } from '../semantics/index.js'
import type { FrontendSourceRef, ReactFlowRelationshipKind } from '../frontend/index.js'
import type { ClassificationRoleRef } from '../classification/classificationTypes.js'
import type { AndroidComponentRoleRef } from '../android/androidComponentTypes.js'

export const CODE_GRAPH_SCHEMA_VERSION = '1.0.0'

export type CodeGraphNodeKind =
  | 'file'
  | 'symbol'
  | 'frontend-fact'
  | 'android-module'
  | 'android-source-set'
  | 'android-manifest-file'
  | 'android-manifest-component'
  | 'android-intent-filter'
  | 'android-permission'
  | 'android-resource-file'
  | 'android-resource-definition'
  | 'android-navigation-graph'
  | 'android-navigation-destination'
  | 'android-navigation-action'
  | 'android-navigation-deep-link'
  | 'android-compose-route'
  | 'android-composable'
  | 'android-compose-fact'
  | 'android-test-file'
  | 'android-test-class'
  | 'android-test-method'
  | 'android-test-fact'

/** Which Batch 1-5 Android artifact (or v1.9.0 android-project/android-components) a compact `android-*` node/edge is backed by (v1.10.0 Batch 5). */
export type AndroidArtifactId =
  | 'android-project'
  | 'android-components'
  | 'android-gradle'
  | 'android-manifest'
  | 'android-resources'
  | 'android-navigation'
  | 'android-compose-semantic'
  | 'android-test-semantic'

export type CodeGraphEdgeKind =
  | 'defines'
  | 'imports'
  | 'exports'
  | 'depends-on'
  | 'calls'
  | 'related-to'
  | ReactFlowRelationshipKind
  | 'module-contains-source-set'
  | 'manifest-declares-component'
  | 'manifest-component-resolves-to-source'
  | 'component-has-intent-filter'
  | 'component-uses-permission'
  | 'manifest-uses-permission'
  | 'resource-defined-in-file'
  | 'source-references-resource'
  | 'navigation-graph-contains-destination'
  | 'navigation-destination-has-action'
  | 'navigation-action-targets-destination'
  | 'navigation-action-pop-up-to-destination'
  | 'navigation-graph-includes-graph'
  | 'navigation-destination-has-deep-link'
  | 'manifest-deep-link-matches-navigation-deep-link'
  | 'navigation-destination-resolves-to-screen'
  | 'compose-route-resolves-to-screen'
  | 'defines-composable'
  | 'composable-calls-composable'
  | 'composable-has-fact'
  | 'composable-references-viewmodel'
  | 'click-handler-contains-navigation-call'
  | 'compose-navigation-targets-route'
  | 'compose-string-references-resource'
  | 'defines-test-class'
  | 'test-class-defines-method'
  | 'test-class-uses-rule'
  | 'test-method-has-fact'
  | 'android-test-references-composable'
  | 'android-test-references-route'
  | 'android-test-references-viewmodel'
  | 'android-test-uses-double'

export interface CodeGraphNode {
  id: string
  kind: CodeGraphNodeKind
  label: string
  path?: string
  symbolName?: string
  symbolKind?: string
  language?: string
  line?: number
  exported?: boolean
  frontendFactKind?: string
  frontendId?: string
  sourceRef?: FrontendSourceRef
  semanticRoles?: SemanticRole[]
  artifactRefs?: SemanticArtifactRef[]
  classificationRoles?: ClassificationRoleRef[]
  classificationRefs?: SemanticArtifactRef[]
  androidComponentRoles?: AndroidComponentRoleRef[]
  androidComponentRefs?: SemanticArtifactRef[]
  /** Which Android artifact backs this compact node, for `android-*` node kinds only (v1.10.0 Batch 5). */
  androidArtifactId?: AndroidArtifactId
  /** The artifact-local stable entity ID this node was projected from (usually identical to `id`, kept separate for clarity). */
  androidEntityId?: string
  /** `android-project.json` module ID, for `android-*` node kinds scoped to a module. */
  androidModuleId?: string
  /** Synthetic `<modulePath>#<sourceSetName>` identity, for `android-*` node kinds scoped to a source set. */
  androidSourceSetId?: string
  /** Compact, entity-specific evidence (e.g. destination kind, resource type/name, permission name) — never a full artifact record. */
  androidMetadata?: Record<string, string | number | boolean | null>
}

export interface CodeGraphEdge {
  id: string
  source: string
  target: string
  kind: CodeGraphEdgeKind
  label?: string
  sourceRef?: FrontendSourceRef
  metadata?: Record<string, string | number | boolean | null>
}

export interface CodeGraph {
  artifactKind: 'code-graph'
  schemaVersion: string
  createdAt: string
  nodes: CodeGraphNode[]
  edges: CodeGraphEdge[]
  summary: {
    nodeCount: number
    edgeCount: number
    fileNodeCount: number
    symbolNodeCount: number
  }
}
