export const ANDROID_NAVIGATION_ARTIFACT_KIND = 'my-dev-kit-v1-android-navigation'
export const ANDROID_NAVIGATION_SCHEMA_VERSION = '1.0.0'
export const ANDROID_NAVIGATION_FILENAME = 'android-navigation.json'

export interface AndroidNavigationSourceRef {
  file: string
  line: number
  column: number
}

/** Re-exported shape (structurally identical to Batch 3's `AndroidResourceQualifiers`) so navigation records carry the same qualifier evidence without importing the resource artifact's full type surface. */
export interface AndroidNavigationQualifiers {
  raw: string[]
  locale: string | null
  nightMode: 'night' | 'notnight' | null
  apiLevel: number | null
  density: string | null
  orientation: 'land' | 'port' | null
  smallestWidthDp: number | null
  widthDp: number | null
  heightDp: number | null
  unrecognized: string[]
}

export type NavigationReferenceKind =
  | 'resource'
  | 'id-declaration'
  | 'id-reference'
  | 'theme-attribute'
  | 'framework-resource'
  | 'package-qualified-resource'
  | 'null-or-empty'
  | 'unresolved'

/** A navigation-attribute resource reference (`android:id`, `app:startDestination`, `app:destination`, ...), reusing Batch 3's reference-classification contract without importing `android-resources.json`'s type surface directly. */
export interface AndroidNavigationResourceReference {
  id: string
  raw: string
  kind: NavigationReferenceKind
  packagePrefix: string | null
  resourceType: string | null
  resourceName: string | null
  source: AndroidNavigationSourceRef
  candidateTargetIds: string[]
  warnings: string[]
}

export type AndroidNavigationDestinationKind = 'fragment' | 'activity' | 'dialog' | 'custom'

export interface AndroidNavigationArgumentDefault {
  raw: string | null
  classification: 'literal' | 'resource-reference' | 'null' | 'unresolved'
  reference: AndroidNavigationResourceReference | null
}

export interface AndroidNavigationArgument {
  id: string
  parentId: string
  name: string | null
  argType: string | null
  nullable: boolean | null
  defaultValue: AndroidNavigationArgumentDefault | null
  moduleId: string
  sourceSet: string
  qualifiers: AndroidNavigationQualifiers
  file: string
  source: AndroidNavigationSourceRef
  warnings: string[]
}

export interface AndroidNavigationDeepLink {
  id: string
  parentId: string
  uriPattern: string | null
  action: string | null
  mimeType: string | null
  autoVerify: boolean | null
  scheme: string | null
  host: string | null
  port: string | null
  hasPlaceholder: boolean
  moduleId: string
  sourceSet: string
  qualifiers: AndroidNavigationQualifiers
  file: string
  source: AndroidNavigationSourceRef
  warnings: string[]
}

export interface AndroidNavigationActionAnimRefs {
  enterAnim: AndroidNavigationResourceReference | null
  exitAnim: AndroidNavigationResourceReference | null
  popEnterAnim: AndroidNavigationResourceReference | null
  popExitAnim: AndroidNavigationResourceReference | null
}

export interface AndroidNavigationAction {
  id: string
  parentId: string
  rawId: string | null
  logicalKey: string | null
  destinationRaw: string | null
  candidateDestinationIds: string[]
  popUpToRaw: string | null
  candidatePopUpToIds: string[]
  popUpToInclusive: boolean | null
  popUpToSaveState: boolean | null
  launchSingleTop: boolean | null
  restoreState: boolean | null
  anim: AndroidNavigationActionAnimRefs
  moduleId: string
  sourceSet: string
  qualifiers: AndroidNavigationQualifiers
  file: string
  source: AndroidNavigationSourceRef
  warnings: string[]
}

export interface AndroidNavigationDestination {
  id: string
  kind: AndroidNavigationDestinationKind
  rawElementName: string
  rawId: string | null
  logicalKey: string | null
  androidName: string | null
  resolvedClassName: string | null
  route: string | null
  label: AndroidNavigationResourceReference | { kind: 'literal'; value: string } | null
  toolsLayout: AndroidNavigationResourceReference | null
  parentGraphId: string
  argumentIds: string[]
  actionIds: string[]
  deepLinkIds: string[]
  nestedGraphId: string | null
  moduleId: string
  sourceSet: string
  qualifiers: AndroidNavigationQualifiers
  file: string
  source: AndroidNavigationSourceRef
  warnings: string[]
}

export interface AndroidNavigationStartDestinationEvidence {
  raw: string | null
  candidateDestinationIds: string[]
  candidateGraphIds: string[]
  unresolved: boolean
  warnings: string[]
}

export interface AndroidNavigationInclude {
  id: string
  parentGraphId: string
  rawGraphRef: string | null
  logicalKey: string | null
  candidateTargetGraphIds: string[]
  moduleId: string
  sourceSet: string
  qualifiers: AndroidNavigationQualifiers
  file: string
  source: AndroidNavigationSourceRef
  warnings: string[]
}

export type AndroidNavigationGraphKind = 'root' | 'nested'

export interface AndroidNavigationGraph {
  id: string
  kind: AndroidNavigationGraphKind
  rawId: string | null
  logicalKey: string | null
  route: string | null
  startDestination: AndroidNavigationStartDestinationEvidence
  parentGraphId: string | null
  destinationIds: string[]
  actionIds: string[]
  argumentIds: string[]
  deepLinkIds: string[]
  includeIds: string[]
  label: AndroidNavigationResourceReference | { kind: 'literal'; value: string } | null
  moduleId: string
  sourceSet: string
  qualifiers: AndroidNavigationQualifiers
  navigationFileId: string
  file: string
  source: AndroidNavigationSourceRef
  warnings: string[]
}

export interface AndroidNavigationFile {
  id: string
  resourceFileId: string | null
  logicalKey: string | null
  path: string
  moduleId: string
  gradlePath: string | null
  sourceSet: string
  qualifiers: AndroidNavigationQualifiers
  xmlRootElement: string | null
  rootGraphId: string | null
  destinationIds: string[]
  actionIds: string[]
  argumentIds: string[]
  deepLinkIds: string[]
  includeIds: string[]
  parsingStatus: 'parsed' | 'malformed'
  source: AndroidNavigationSourceRef
  warnings: string[]
}

export type ComposeRouteEvidenceKind = 'string-route' | 'resolved-local-constant-route' | 'type-safe-route' | 'unresolved-recognized-call'

export type ComposeNavigationBuilder = 'composable' | 'navigation' | 'dialog' | 'activity' | 'nav-host-start-destination' | 'other'

export interface AndroidComposeScreenCandidate {
  id: string
  routeId: string
  calledScreenName: string
  symbolId: string | null
  source: AndroidNavigationSourceRef
  evidenceBasis: 'direct-top-level-call-in-route-content-lambda'
  confidence: 'high'
  warnings: string[]
}

export interface AndroidComposeRoute {
  id: string
  evidenceKind: ComposeRouteEvidenceKind
  builder: ComposeNavigationBuilder
  rawRouteExpression: string | null
  resolvedRoute: string | null
  typeRouteName: string | null
  moduleId: string | null
  sourceSet: string | null
  file: string
  enclosingSymbol: string | null
  source: AndroidNavigationSourceRef
  screenCandidateIds: string[]
  warnings: string[]
}

export interface AndroidNavigationSummary {
  moduleCount: number
  sourceSetCount: number
  xmlGraphCount: number
  nestedGraphCount: number
  destinationCount: number
  actionCount: number
  argumentCount: number
  xmlDeepLinkCount: number
  includeCount: number
  composeRouteCount: number
  screenCandidateCount: number
  warningCount: number
}

export interface AndroidNavigationArtifact {
  artifactKind: typeof ANDROID_NAVIGATION_ARTIFACT_KIND
  schemaVersion: typeof ANDROID_NAVIGATION_SCHEMA_VERSION
  createdAt: string
  projectRoot: string
  detected: boolean
  filesExamined: string[]
  navigationFiles: AndroidNavigationFile[]
  graphs: AndroidNavigationGraph[]
  destinations: AndroidNavigationDestination[]
  actions: AndroidNavigationAction[]
  arguments: AndroidNavigationArgument[]
  xmlDeepLinks: AndroidNavigationDeepLink[]
  includes: AndroidNavigationInclude[]
  composeRoutes: AndroidComposeRoute[]
  screenCandidates: AndroidComposeScreenCandidate[]
  warnings: string[]
  summary: AndroidNavigationSummary
}

export interface BuildAndroidNavigationProjectResult {
  artifact: AndroidNavigationArtifact
  evidenceFingerprint: string
}
