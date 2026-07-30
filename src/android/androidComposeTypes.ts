export const ANDROID_COMPOSE_SEMANTIC_ARTIFACT_KIND = 'my-dev-kit-v1-android-compose-semantic'
export const ANDROID_COMPOSE_SEMANTIC_SCHEMA_VERSION = '1.0.0'
export const ANDROID_COMPOSE_SEMANTIC_FILENAME = 'android-compose-semantic.json'

export type ComposeDeclarationScope = 'top-level' | 'function-local'
export type ComposeDeclarationVisibility = 'public' | 'internal' | 'private'

export interface ComposeAnnotationEvidence {
  raw: string
}

export interface ComposeParameterSummary {
  name: string
  typeText: string | null
}

export interface ComposeSourceRange {
  file: string
  startLine: number
  endLine: number
}

export interface ComposeChildCallEvidence {
  calleeDeclarationId: string
  calleeName: string
  line: number
}

export type ComposeStructuralRegionKind = 'Scaffold' | 'LazyColumn' | 'LazyRow' | 'Column' | 'Row' | 'Box' | 'NavHost'

export interface ComposeStructuralRegionEvidence {
  kind: ComposeStructuralRegionKind
  line: number
}

export interface ComposeDeclarationEntry {
  id: string
  name: string
  kind: 'composable'
  scope: ComposeDeclarationScope
  visibility: ComposeDeclarationVisibility
  isPreview: boolean
  enclosingDeclarationId: string | null
  annotations: ComposeAnnotationEvidence[]
  parameters: ComposeParameterSummary[]
  sourceRange: ComposeSourceRange
  moduleId: string | null
  sourceSet: string | null
  childCalls: ComposeChildCallEvidence[]
  structuralRegions: ComposeStructuralRegionEvidence[]
  warnings: string[]
}

export interface ComposeSemanticSummary {
  declarationCount: number
  previewCount: number
  topLevelCount: number
  functionLocalCount: number
  privateTopLevelCount: number
  childCallCount: number
  structuralRegionCallCount: number
  warningCount: number
}

export interface AndroidComposeSemanticArtifact {
  artifactKind: typeof ANDROID_COMPOSE_SEMANTIC_ARTIFACT_KIND
  schemaVersion: typeof ANDROID_COMPOSE_SEMANTIC_SCHEMA_VERSION
  createdAt: string
  projectRoot: string
  detected: boolean
  filesExamined: string[]
  declarations: ComposeDeclarationEntry[]
  warnings: string[]
  summary: ComposeSemanticSummary
}

export interface BuildAndroidComposeSemanticProjectResult {
  artifact: AndroidComposeSemanticArtifact
}
