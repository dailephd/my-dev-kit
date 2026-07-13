export const ANDROID_RESOURCES_ARTIFACT_KIND = 'my-dev-kit-v1-android-resources'
export const ANDROID_RESOURCES_SCHEMA_VERSION = '1.0.0'
export const ANDROID_RESOURCES_FILENAME = 'android-resources.json'

export interface AndroidResourceSourceRef {
  file: string
  line: number
  column: number
}

/** The Android resource-type family a directory/file/definition belongs to. Mirrors `res/<type>[-qualifiers]/` naming, not the full Android `R` class type set (e.g. `values/` itself contains many logical types — `string`, `color`, `style`, etc. — represented per-definition, not per-directory). */
export type AndroidResourceBaseType =
  | 'values'
  | 'layout'
  | 'drawable'
  | 'mipmap'
  | 'xml'
  | 'raw'
  | 'menu'
  | 'anim'
  | 'animator'
  | 'color'
  | 'font'
  | 'navigation'
  | 'unknown'

/** Logical resource-definition type (the `R.<type>.<name>` type), distinct from `AndroidResourceBaseType` (the directory family). A single `values*` directory can contain many of these. */
export type AndroidResourceType =
  | 'string'
  | 'color'
  | 'style'
  | 'bool'
  | 'integer'
  | 'dimen'
  | 'fraction'
  | 'plurals'
  | 'array'
  | 'attr'
  | 'declare-styleable'
  | 'id'
  | 'layout'
  | 'drawable'
  | 'mipmap'
  | 'xml'
  | 'raw'
  | 'menu'
  | 'anim'
  | 'animator'
  | 'font'
  | 'navigation'
  | 'unknown'

export interface AndroidResourceQualifiers {
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

export interface AndroidResourceDirectoryQualifierInfo {
  baseType: AndroidResourceBaseType
  rawDirectoryName: string
  qualifiers: AndroidResourceQualifiers
}

export type ResourceDiscoverySource = 'default-convention' | 'gradle-override'

export interface AndroidResourceDirectory {
  id: string
  moduleId: string
  gradlePath: string | null
  sourceSet: string
  path: string
  baseType: AndroidResourceBaseType
  rawDirectoryName: string
  qualifiers: AndroidResourceQualifiers
  discoverySource: ResourceDiscoverySource
  warnings: string[]
}

export type AndroidResourceFileKind = 'xml' | 'bitmap' | 'font' | 'raw' | 'unknown'

export interface AndroidResourceFile {
  id: string
  path: string
  moduleId: string
  gradlePath: string | null
  sourceSet: string
  resourceDirectoryId: string
  baseType: AndroidResourceBaseType
  rawDirectoryName: string
  qualifiers: AndroidResourceQualifiers
  filename: string
  extension: string
  resourceName: string | null
  fileKind: AndroidResourceFileKind
  xmlRootElement: string | null
  source: AndroidResourceSourceRef
  parsingStatus: 'parsed' | 'malformed' | 'not-applicable'
  warnings: string[]
  definitionIds: string[]
  idDefinitionIds: string[]
  referenceIds: string[]
  fileProviderPathIds: string[]
  networkSecurityRecordIds: string[]
}

/** `<package-scope>?type/name` — the logical key. Several `ResourceDefinition`s may share the same key across source sets/qualifiers/files; that is expected and preserved, never collapsed. */
export interface AndroidResourceKey {
  packageScope: string | null
  type: AndroidResourceType
  name: string
}

export interface AndroidResourceStyleItem {
  name: string
  rawValue: string
  referenceId: string | null
  source: AndroidResourceSourceRef
}

export interface AndroidResourceArrayItem {
  rawValue: string
  referenceId: string | null
  source: AndroidResourceSourceRef
}

export interface AndroidResourcePluralItem {
  quantity: string
  rawValue: string
  referenceId: string | null
  source: AndroidResourceSourceRef
}

export interface AndroidResourceAttrEnumFlag {
  name: string
  value: string | null
}

export interface AndroidResourceDefinition {
  id: string
  key: AndroidResourceKey
  type: AndroidResourceType
  name: string
  moduleId: string
  sourceSet: string
  qualifiers: AndroidResourceQualifiers
  fileId: string
  file: string
  source: AndroidResourceSourceRef

  /** Populated for simple scalar-valued resources (`string`, `bool`, `integer`, `dimen`, `fraction`, `id`). */
  rawValue: string | null
  /** `string` only. */
  translatable: boolean | null
  formatted: boolean | null
  product: string | null
  hasChildMarkup: boolean

  /** `style` only. */
  parent: string | null
  parentExplicit: boolean
  items: AndroidResourceStyleItem[]

  /** `array`/`plurals` only. */
  arrayKind: 'string-array' | 'integer-array' | 'array' | null
  arrayItems: AndroidResourceArrayItem[]
  pluralItems: AndroidResourcePluralItem[]

  /** `attr`/`declare-styleable` only. */
  format: string | null
  enumValues: AndroidResourceAttrEnumFlag[]
  flagValues: AndroidResourceAttrEnumFlag[]
  styleableAttrRefs: string[]

  referenceIds: string[]
  warnings: string[]
}

export type AndroidResourceReferenceKind =
  | 'resource'
  | 'id-declaration'
  | 'id-reference'
  | 'theme-attribute'
  | 'framework-resource'
  | 'package-qualified-resource'
  | 'null-or-empty'
  | 'unresolved'

export interface AndroidResourceReference {
  id: string
  raw: string
  kind: AndroidResourceReferenceKind
  packagePrefix: string | null
  resourceType: string | null
  resourceName: string | null
  sourceFileId: string
  sourceElement: string | null
  sourceAttribute: string | null
  source: AndroidResourceSourceRef
  candidateTargetIds: string[]
  warnings: string[]
}

export interface AndroidResourceIdDefinition {
  id: string
  key: AndroidResourceKey
  rawValue: string
  fileId: string
  file: string
  ownerRecordId: string
  elementName: string
  attributeName: string
  moduleId: string
  sourceSet: string
  qualifiers: AndroidResourceQualifiers
  source: AndroidResourceSourceRef
}

export interface AndroidResourceLayoutViewSummary {
  elementName: string
  idRef: string | null
  source: AndroidResourceSourceRef
}

export interface AndroidResourceLayout {
  id: string
  key: AndroidResourceKey
  rootElement: string
  moduleId: string
  sourceSet: string
  qualifiers: AndroidResourceQualifiers
  fileId: string
  file: string
  source: AndroidResourceSourceRef
  declaredIdIds: string[]
  includedLayoutRefs: string[]
  fragmentClassNames: string[]
  referenceIds: string[]
  views: AndroidResourceLayoutViewSummary[]
  warnings: string[]
}

export interface AndroidResourceFileDefinition {
  id: string
  key: AndroidResourceKey
  type: AndroidResourceType
  name: string
  moduleId: string
  sourceSet: string
  qualifiers: AndroidResourceQualifiers
  fileId: string
  file: string
  extension: string
  xmlRootElement: string | null
  referenceIds: string[]
  declaredIdIds: string[]
  source: AndroidResourceSourceRef
  warnings: string[]
}

export interface AndroidResourceFileProviderPathEntry {
  id: string
  elementType: 'files-path' | 'cache-path' | 'external-path' | 'external-files-path' | 'external-cache-path' | 'external-media-path' | 'root-path'
  name: string | null
  path: string | null
  moduleId: string
  sourceSet: string
  qualifiers: AndroidResourceQualifiers
  fileId: string
  file: string
  source: AndroidResourceSourceRef
  warnings: string[]
}

export type NetworkSecurityRecordKind =
  | 'network-security-config'
  | 'base-config'
  | 'domain-config'
  | 'debug-overrides'
  | 'domain'
  | 'trust-anchors'
  | 'certificates'
  | 'pin-set'
  | 'pin'

export interface AndroidNetworkSecurityRecord {
  id: string
  kind: NetworkSecurityRecordKind
  parentId: string | null
  attributes: Record<string, string>
  domainText: string | null
  moduleId: string
  sourceSet: string
  qualifiers: AndroidResourceQualifiers
  fileId: string
  file: string
  source: AndroidResourceSourceRef
  warnings: string[]
}

export interface AndroidResourcesSummary {
  moduleCount: number
  sourceSetCount: number
  resourceDirectoryCount: number
  resourceFileCount: number
  valueResourceCount: number
  fileResourceCount: number
  layoutCount: number
  viewIdCount: number
  referenceCount: number
  specializedConfigCount: number
  warningCount: number
}

export interface AndroidResourcesArtifact {
  artifactKind: typeof ANDROID_RESOURCES_ARTIFACT_KIND
  schemaVersion: typeof ANDROID_RESOURCES_SCHEMA_VERSION
  createdAt: string
  projectRoot: string
  detected: boolean
  filesExamined: string[]
  resourceDirectories: AndroidResourceDirectory[]
  resourceFiles: AndroidResourceFile[]
  valueDefinitions: AndroidResourceDefinition[]
  fileDefinitions: AndroidResourceFileDefinition[]
  layouts: AndroidResourceLayout[]
  idDefinitions: AndroidResourceIdDefinition[]
  references: AndroidResourceReference[]
  fileProviderPaths: AndroidResourceFileProviderPathEntry[]
  networkSecurityRecords: AndroidNetworkSecurityRecord[]
  warnings: string[]
  summary: AndroidResourcesSummary
}

export interface BuildAndroidResourceProjectResult {
  artifact: AndroidResourcesArtifact
  evidenceFingerprint: string
}
