export const ANDROID_COMPOSE_SEMANTIC_ARTIFACT_KIND = 'my-dev-kit-v1-android-compose-semantic'
export const ANDROID_COMPOSE_SEMANTIC_SCHEMA_VERSION = '1.3.0'
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

/** v1.12.0 Batch 4: reuses the exact same match-status vocabulary `android-navigation.json`'s navigation-call candidate matching already established. */
export type ComposeStateOwnerCandidateMatchStatus = 'exact-one' | 'ambiguous' | 'no-match' | 'not-attempted'

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
  /** v1.12.0 Batch 4: the bounded exact direct member-access chain immediately before `.collectAsState(...)`/`.collectAsStateWithLifecycle(...)` (e.g. `"viewModel.uiState"`). Always `null` for `remember`/`rememberSaveable` (no ownership is ever attempted), and `null` for an unsupported receiver shape (function call, indexed access, safe-call, cast, etc.). */
  receiverText: string | null
  /** v1.12.0 Batch 4: the first exact identifier in `receiverText` (e.g. `"viewModel"`). `null` whenever `receiverText` is `null`. */
  receiverRootName: string | null
  /** v1.12.0 Batch 4: every exact same-composable `viewModelReferences[]` entry ID whose `variableOrParameterName` equals `receiverRootName`, deterministically sorted. */
  matchedViewModelReferenceIds: string[]
  /** v1.12.0 Batch 4: exact indexed class-symbol candidates resolved from the matched ViewModel reference(s), using the same resolver `composable-references-viewmodel` already uses. */
  candidateViewModelSymbolIds: string[]
  /** v1.12.0 Batch 4: `"not-attempted"` for `remember`/`rememberSaveable` and unsupported receivers; `"no-match"` when a same-composable ViewModel reference matched but resolved to zero symbol candidates; `"exact-one"`/`"ambiguous"` otherwise. */
  candidateMatchStatus: ComposeStateOwnerCandidateMatchStatus
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

// ---------------------------------------------------------------------------
// v1.11.0 Batch 3 -- click-handler and navigation-call usage evidence.
// `android-navigation.json` remains the sole owner of route/destination
// *definitions*; these facts record only Compose call-site *usage* evidence,
// cross-referenced to that artifact's existing IDs through exact static
// matching (never fuzzy, never a single guessed winner from an ambiguous set).
// ---------------------------------------------------------------------------

export type ComposeClickApiForm = 'clickable-trailing-lambda' | 'clickable-onClick-arg' | 'onClick-arg'
export type ComposeClickCallbackForm = 'lambda' | 'function-reference' | 'identifier' | 'unresolved'

export interface ComposeClickHandlerFactEntry {
  id: string
  composableId: string
  sourceRange: ComposeSourceRange
  apiForm: ComposeClickApiForm
  callbackForm: ComposeClickCallbackForm
  rawCallbackSummary: string | null
  handlerName: string | null
  status: ComposeFactResolutionStatus
  navigationCallIds: string[]
  warnings: string[]
}

/** Reuses `android-navigation.json`'s own `ComposeRouteEvidenceKind` vocabulary so a route-definition and a route-usage site are always classified with identical terminology. */
export type ComposeNavigationRouteClassification = 'string-route' | 'resolved-local-constant-route' | 'type-safe-route' | 'unresolved-recognized-call'

export type ComposeNavigationCandidateMatchStatus = 'exact-one' | 'ambiguous' | 'no-match' | 'not-attempted'

export interface ComposeNavigationCallFactEntry {
  id: string
  composableId: string
  clickHandlerId: string | null
  sourceRange: ComposeSourceRange
  receiverText: string | null
  callName: string
  rawRouteExpression: string | null
  routeClassification: ComposeNavigationRouteClassification
  resolvedRoute: string | null
  typeRouteName: string | null
  status: ComposeFactResolutionStatus
  candidateIds: string[]
  candidateMatchStatus: ComposeNavigationCandidateMatchStatus
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
  clickHandlerFactCount: number
  navigationCallFactCount: number
  warningCount: number
  /** v1.12.0 Batch 4: additive. Number of emitted `activityHostFacts`. */
  activityHostFactCount?: number
  /** v1.12.0 Batch 4: additive. `stateFacts` with `candidateMatchStatus === 'exact-one'`. */
  viewModelOwnedStateFactCount?: number
  /** v1.12.0 Batch 4: additive. `stateFacts` with `candidateMatchStatus === 'ambiguous'`. */
  ambiguousStateOwnerFactCount?: number
  /** v1.12.0 Batch 4: additive. `collectAsState`/`collectAsStateWithLifecycle` facts with `candidateMatchStatus` of `'no-match'` or `'not-attempted'`. */
  unresolvedStateOwnerFactCount?: number
}

/** v1.12.0 Batch 4: direct Activity `setContent(...)` hosting evidence. */
export type ComposeActivityHostApiForm = 'setContent-trailing-lambda' | 'setContent-content-argument'
export type ComposeActivityHostStatus = 'resolved' | 'unresolved'

export interface ComposeActivityHostFactEntry {
  id: string
  activityComponentId: string
  activitySymbolId: string
  sourceRange: ComposeSourceRange
  apiForm: ComposeActivityHostApiForm
  rawContentSummary: string | null
  hostedCallName: string | null
  status: ComposeActivityHostStatus
  candidateComposableIds: string[]
  candidateMatchStatus: ComposeStateOwnerCandidateMatchStatus
  warnings: string[]
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
  clickHandlerFacts: ComposeClickHandlerFactEntry[]
  navigationCallFacts: ComposeNavigationCallFactEntry[]
  /** v1.12.0 Batch 4: additive. Empty when no supported Activity `setContent` evidence is found. */
  activityHostFacts: ComposeActivityHostFactEntry[]
  warnings: string[]
  summary: ComposeSemanticSummary
}

export interface BuildAndroidComposeSemanticProjectResult {
  artifact: AndroidComposeSemanticArtifact
}
