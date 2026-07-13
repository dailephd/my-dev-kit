export const ANDROID_MANIFEST_ARTIFACT_KIND = 'my-dev-kit-v1-android-manifest'
export const ANDROID_MANIFEST_SCHEMA_VERSION = '1.0.0'
export const ANDROID_MANIFEST_FILENAME = 'android-manifest.json'

export interface AndroidManifestSourceRef {
  file: string
  line: number
  column: number
}

export type ManifestDiscoverySource = 'default-convention' | 'gradle-override'

/** A manifest resource/attr reference (`@type/name`, `@package:type/name`, `?attr/name`), preserved but never resolved in this batch. */
export interface AndroidManifestResourceReference {
  raw: string
  referenceKind: 'resource' | 'attr'
  resourceType: string | null
  resourceName: string | null
  packagePrefix: string | null
  isFrameworkReference: boolean
  warning: string | null
}

/** Every manifest attribute value is one of these — a resolved value is never invented for a placeholder/unresolved/absent attribute. */
export type AndroidManifestAttributeValue =
  | { kind: 'literal'; value: string }
  | { kind: 'resource-reference'; reference: AndroidManifestResourceReference }
  | { kind: 'placeholder'; raw: string }
  | { kind: 'unresolved'; raw: string; warning: string }
  | { kind: 'absent' }

export type ManifestNameResolutionBasis =
  | 'fully-qualified'
  | 'manifest-package'
  | 'gradle-namespace'
  | 'unresolved'

export interface ResolvedComponentName {
  raw: string
  resolved: string | null
  basis: ManifestNameResolutionBasis
  warning: string | null
}

export type ExportedState = 'true' | 'false' | 'unspecified'

export interface AndroidManifestActionEvidence {
  id: string
  name: string
  source: AndroidManifestSourceRef
}

export interface AndroidManifestCategoryEvidence {
  id: string
  name: string
  source: AndroidManifestSourceRef
}

export interface AndroidManifestDataEvidence {
  id: string
  scheme: string | null
  host: string | null
  port: string | null
  path: string | null
  pathPrefix: string | null
  pathPattern: string | null
  pathAdvancedPattern: string | null
  pathSuffix: string | null
  mimeType: string | null
  ssp: string | null
  sspPrefix: string | null
  sspPattern: string | null
  source: AndroidManifestSourceRef
}

export interface AndroidManifestIntentFilterEvidence {
  id: string
  parentComponentId: string
  autoVerify: boolean | null
  priority: number | null
  order: number | null
  actions: AndroidManifestActionEvidence[]
  categories: AndroidManifestCategoryEvidence[]
  data: AndroidManifestDataEvidence[]
  source: AndroidManifestSourceRef
  warnings: string[]
}

export type MetadataParentType = 'application' | 'component'

export interface AndroidManifestMetadataEvidence {
  id: string
  parentType: MetadataParentType
  parentId: string
  name: string | null
  value: AndroidManifestAttributeValue
  resource: AndroidManifestAttributeValue
  source: AndroidManifestSourceRef
  warnings: string[]
}

export interface AndroidManifestGrantUriPermissionEvidence {
  id: string
  path: string | null
  pathPrefix: string | null
  pathPattern: string | null
  source: AndroidManifestSourceRef
}

export interface AndroidManifestPathPermissionEvidence {
  id: string
  path: string | null
  pathPrefix: string | null
  pathPattern: string | null
  permission: string | null
  readPermission: string | null
  writePermission: string | null
  source: AndroidManifestSourceRef
}

export type AndroidManifestComponentKind = 'activity' | 'activity-alias' | 'service' | 'receiver' | 'provider'

export interface AndroidManifestComponentEvidence {
  id: string
  kind: AndroidManifestComponentKind
  rawName: string | null
  resolvedName: ResolvedComponentName | null
  targetActivity: ResolvedComponentName | null
  authorities: string[]
  exported: ExportedState
  exportedExplicit: boolean
  hasIntentFilter: boolean
  enabled: AndroidManifestAttributeValue
  permission: AndroidManifestAttributeValue
  readPermission: AndroidManifestAttributeValue
  writePermission: AndroidManifestAttributeValue
  process: AndroidManifestAttributeValue
  directBootAware: AndroidManifestAttributeValue
  isolatedProcess: AndroidManifestAttributeValue
  foregroundServiceType: AndroidManifestAttributeValue
  grantUriPermissionsAttr: AndroidManifestAttributeValue
  multiprocess: AndroidManifestAttributeValue
  taskAffinity: AndroidManifestAttributeValue
  launchMode: AndroidManifestAttributeValue
  screenOrientation: AndroidManifestAttributeValue
  configChanges: AndroidManifestAttributeValue
  parentActivityName: AndroidManifestAttributeValue
  theme: AndroidManifestAttributeValue
  label: AndroidManifestAttributeValue
  icon: AndroidManifestAttributeValue
  syncable: AndroidManifestAttributeValue
  initOrder: AndroidManifestAttributeValue
  moduleId: string
  sourceSet: string
  manifestFileId: string
  source: AndroidManifestSourceRef
  intentFilterIds: string[]
  metadataIds: string[]
  grantUriPermissions: AndroidManifestGrantUriPermissionEvidence[]
  pathPermissions: AndroidManifestPathPermissionEvidence[]
  warnings: string[]
}

export interface AndroidManifestLauncherCandidate {
  id: string
  componentId: string
  intentFilterId: string
  manifestFileId: string
  sourceSet: string
  confidence: 'high'
  warnings: string[]
}

export interface AndroidManifestDeepLinkCandidate {
  id: string
  componentId: string
  intentFilterId: string
  autoVerify: boolean | null
  actions: string[]
  categories: string[]
  scheme: string | null
  host: string | null
  port: string | null
  path: string | null
  pathPrefix: string | null
  pathPattern: string | null
  mimeType: string | null
  manifestFileId: string
  sourceSet: string
  source: AndroidManifestSourceRef
  warnings: string[]
}

export interface AndroidManifestPermissionEvidence {
  id: string
  kind: 'uses-permission' | 'uses-permission-sdk-23'
  rawName: string | null
  resolvedName: string | null
  maxSdkVersion: number | null
  usesPermissionFlags: string | null
  moduleId: string
  sourceSet: string
  manifestFileId: string
  source: AndroidManifestSourceRef
  warnings: string[]
}

export interface AndroidManifestDeclaredPermissionEvidence {
  id: string
  name: string | null
  protectionLevel: string | null
  permissionGroup: string | null
  label: AndroidManifestAttributeValue
  description: AndroidManifestAttributeValue
  icon: AndroidManifestAttributeValue
  knownCerts: AndroidManifestAttributeValue
  moduleId: string
  sourceSet: string
  manifestFileId: string
  source: AndroidManifestSourceRef
  warnings: string[]
}

export interface AndroidManifestUsesFeatureEvidence {
  id: string
  name: string | null
  glEsVersion: string | null
  required: 'true' | 'false' | 'unspecified'
  moduleId: string
  sourceSet: string
  manifestFileId: string
  source: AndroidManifestSourceRef
  warnings: string[]
}

export interface AndroidManifestUsesSdkEvidence {
  minSdkVersion: string | null
  targetSdkVersion: string | null
  maxSdkVersion: string | null
  source: AndroidManifestSourceRef
}

export interface AndroidManifestApplicationEvidence {
  id: string
  name: AndroidManifestAttributeValue
  label: AndroidManifestAttributeValue
  icon: AndroidManifestAttributeValue
  roundIcon: AndroidManifestAttributeValue
  theme: AndroidManifestAttributeValue
  allowBackup: AndroidManifestAttributeValue
  debuggable: AndroidManifestAttributeValue
  enabled: AndroidManifestAttributeValue
  extractNativeLibs: AndroidManifestAttributeValue
  fullBackupContent: AndroidManifestAttributeValue
  dataExtractionRules: AndroidManifestAttributeValue
  networkSecurityConfig: AndroidManifestAttributeValue
  usesCleartextTraffic: AndroidManifestAttributeValue
  supportsRtl: AndroidManifestAttributeValue
  hardwareAccelerated: AndroidManifestAttributeValue
  largeHeap: AndroidManifestAttributeValue
  process: AndroidManifestAttributeValue
  permission: AndroidManifestAttributeValue
  requestLegacyExternalStorage: AndroidManifestAttributeValue
  testOnly: AndroidManifestAttributeValue
  manifestFileId: string
  source: AndroidManifestSourceRef
  metadataIds: string[]
  warnings: string[]
}

export interface AndroidManifestFileRecord {
  id: string
  path: string
  moduleId: string
  gradlePath: string | null
  sourceSet: string
  discoverySource: ManifestDiscoverySource
  packageAttr: string | null
  gradleNamespace: string | null
  applicationId: string | null
  versionCode: string | null
  versionName: string | null
  sharedUserId: string | null
  installLocation: string | null
  usesSdk: AndroidManifestUsesSdkEvidence | null
  source: AndroidManifestSourceRef
  parsingStatus: 'parsed' | 'malformed'
  warnings: string[]
  counts: {
    permissionCount: number
    declaredPermissionCount: number
    featureCount: number
    componentCount: number
    intentFilterCount: number
  }
}

export interface AndroidManifestSummary {
  moduleCount: number
  manifestFileCount: number
  applicationCount: number
  componentCount: number
  permissionCount: number
  intentFilterCount: number
  deepLinkCount: number
  warningCount: number
}

export interface AndroidManifestArtifact {
  artifactKind: typeof ANDROID_MANIFEST_ARTIFACT_KIND
  schemaVersion: typeof ANDROID_MANIFEST_SCHEMA_VERSION
  createdAt: string
  projectRoot: string
  detected: boolean
  filesExamined: string[]
  manifests: AndroidManifestFileRecord[]
  applications: AndroidManifestApplicationEvidence[]
  components: AndroidManifestComponentEvidence[]
  intentFilters: AndroidManifestIntentFilterEvidence[]
  launcherCandidates: AndroidManifestLauncherCandidate[]
  deepLinkCandidates: AndroidManifestDeepLinkCandidate[]
  permissions: AndroidManifestPermissionEvidence[]
  declaredPermissions: AndroidManifestDeclaredPermissionEvidence[]
  usesFeatures: AndroidManifestUsesFeatureEvidence[]
  metadata: AndroidManifestMetadataEvidence[]
  warnings: string[]
  summary: AndroidManifestSummary
}

export interface BuildAndroidManifestProjectResult {
  artifact: AndroidManifestArtifact
  /** Deterministic fingerprint of every manifest-relevant fact, for incremental-cache invalidation. */
  evidenceFingerprint: string
}
