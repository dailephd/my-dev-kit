export const ANDROID_COMPOSE_SEMANTIC_ARTIFACT_KIND = 'my-dev-kit-v1-android-compose-semantic'
export const ANDROID_COMPOSE_SEMANTIC_SCHEMA_VERSION = '1.1.0'
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

/** Resolution status for a Batch 2 fact: `resolved` means every statically-required piece of
 * evidence was conservatively representable; `unresolved` means the fact was still recorded
 * (never fabricated) but at least one part of it degraded to a bounded raw expression. */
export type ComposeFactResolutionStatus = 'resolved' | 'unresolved'

export type ComposeStateCallKind = 'remember' | 'rememberSaveable' | 'collectAsState' | 'collectAsStateWithLifecycle'
export type ComposeStateBindingForm = 'assignment' | 'delegated' | null

export interface ComposeStateFactEntry {
  id: string
  composableId: string
  kind: ComposeStateCallKind
  callName: ComposeStateCallKind
  sourceRange: ComposeSourceRange
  variableName: string | null
  bindingForm: ComposeStateBindingForm
  staticArguments: string[]
  rawArgumentsSummary: string | null
  status: ComposeFactResolutionStatus
  warnings: string[]
}

export type ComposeEffectKind = 'LaunchedEffect' | 'DisposableEffect'

export interface ComposeEffectKeyEvidence {
  raw: string
  kind: 'literal' | 'identifier'
}

export interface ComposeEffectFactEntry {
  id: string
  composableId: string
  kind: ComposeEffectKind
  sourceRange: ComposeSourceRange
  keys: ComposeEffectKeyEvidence[]
  rawKeyExpression: string | null
  hasOnDispose: boolean | null
  status: ComposeFactResolutionStatus
  warnings: string[]
}

export type ComposeViewModelReferenceKind = 'viewModel-call' | 'hiltViewModel-call' | 'parameter-type'

export interface ComposeViewModelReferenceEntry {
  id: string
  composableId: string
  kind: ComposeViewModelReferenceKind
  variableOrParameterName: string | null
  typeText: string | null
  sourceRange: ComposeSourceRange
  status: ComposeFactResolutionStatus
  warnings: string[]
}

export interface ComposeTestTagFactEntry {
  id: string
  composableId: string
  sourceRange: ComposeSourceRange
  resolvedValue: string | null
  rawExpression: string
  status: ComposeFactResolutionStatus
  warnings: string[]
}

export interface ComposeVisibleTextFactEntry {
  id: string
  composableId: string
  sourceRange: ComposeSourceRange
  callName: string
  text: string
  warnings: string[]
}

export interface ComposeStringResourceFactEntry {
  id: string
  composableId: string
  sourceRange: ComposeSourceRange
  resourceName: string
  resourceIdentifierText: string
  rawFormatArguments: string[]
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
  stateFactCount: number
  effectFactCount: number
  viewModelReferenceCount: number
  testTagFactCount: number
  visibleTextFactCount: number
  stringResourceFactCount: number
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
  stateFacts: ComposeStateFactEntry[]
  effectFacts: ComposeEffectFactEntry[]
  viewModelReferences: ComposeViewModelReferenceEntry[]
  testTagFacts: ComposeTestTagFactEntry[]
  visibleTextFacts: ComposeVisibleTextFactEntry[]
  stringResourceFacts: ComposeStringResourceFactEntry[]
  warnings: string[]
  summary: ComposeSemanticSummary
}

export interface BuildAndroidComposeSemanticProjectResult {
  artifact: AndroidComposeSemanticArtifact
}
