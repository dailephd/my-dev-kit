export const ANDROID_TEST_SEMANTIC_ARTIFACT_KIND = 'my-dev-kit-v1-android-test-semantic'
export const ANDROID_TEST_SEMANTIC_SCHEMA_VERSION = '1.0.0'
export const ANDROID_TEST_SEMANTIC_FILENAME = 'android-test-semantic.json'

export type AndroidTestSourceSetCategory = 'unit' | 'instrumented'
export type AndroidTestLanguage = 'kotlin' | 'java'
export type AndroidTestFramework = 'junit4' | 'junit5' | 'compose-ui' | 'espresso' | 'robolectric' | 'unknown'

export interface AndroidTestSourceRange {
  file: string
  startLine: number
  endLine: number
}

export interface AndroidTestAnnotationEvidence {
  raw: string
}

export interface AndroidTestFileEntry {
  id: string
  path: string
  moduleId: string | null
  sourceSet: string
  category: AndroidTestSourceSetCategory
  language: AndroidTestLanguage
  frameworks: AndroidTestFramework[]
  source: { file: string; line: number }
  warnings: string[]
}

export interface AndroidTestClassEntry {
  id: string
  fileId: string
  name: string
  sourceRange: AndroidTestSourceRange
  annotations: AndroidTestAnnotationEvidence[]
  frameworks: AndroidTestFramework[]
  superclassOrRunner: string | null
  warnings: string[]
}

export interface AndroidTestMethodEntry {
  id: string
  classId: string
  name: string
  sourceRange: AndroidTestSourceRange
  annotations: AndroidTestAnnotationEvidence[]
  category: AndroidTestSourceSetCategory
  frameworks: AndroidTestFramework[]
  assertionFactIds: string[]
  routeFactIds: string[]
  testDoubleFactIds: string[]
  warnings: string[]
}

export type AndroidTestRuleKind =
  | 'createComposeRule'
  | 'createAndroidComposeRule'
  | 'createEmptyComposeRule'
  | 'other'

export type AndroidTestFactResolutionStatus = 'resolved' | 'unresolved'

export interface AndroidTestRuleEntry {
  id: string
  classId: string
  variableName: string | null
  ruleKind: AndroidTestRuleKind
  activityType: string | null
  sourceRange: AndroidTestSourceRange
  status: AndroidTestFactResolutionStatus
  warnings: string[]
}

export type AndroidTestAssertionKind = 'visible-text' | 'test-tag'

export interface AndroidTestAssertionFactEntry {
  id: string
  methodId: string
  kind: AndroidTestAssertionKind
  api: string
  resolvedValue: string | null
  rawExpression: string
  sourceRange: AndroidTestSourceRange
  status: AndroidTestFactResolutionStatus
  candidateProductionFactIds: string[]
  candidateComposableIds: string[]
  warnings: string[]
}

export type AndroidTestRouteType = 'string-route' | 'resolved-local-constant-route' | 'type-safe-route' | 'unresolved-recognized-call'

export interface AndroidTestRouteFactEntry {
  id: string
  methodId: string
  rawExpression: string | null
  resolvedRoute: string | null
  routeType: AndroidTestRouteType
  sourceRange: AndroidTestSourceRange
  candidateNavigationIds: string[]
  candidateComposableIds: string[]
  status: AndroidTestFactResolutionStatus
  warnings: string[]
}

export type AndroidTestDoubleKind = 'fake' | 'mock' | 'stub' | 'spy' | 'unknown'
export type AndroidTestDoubleConfidence = 'high' | 'medium' | 'low'

export interface AndroidTestDoubleFactEntry {
  id: string
  ownerId: string
  kind: AndroidTestDoubleKind
  variableName: string | null
  referencedType: string | null
  dependencyCategory: string | null
  candidateSymbolIds: string[]
  sourceRange: AndroidTestSourceRange
  confidence: AndroidTestDoubleConfidence
  warnings: string[]
}

export interface AndroidTestSemanticSummary {
  testFileCount: number
  unitTestFileCount: number
  instrumentedTestFileCount: number
  testClassCount: number
  testMethodCount: number
  junitAnnotationCount: number
  composeRuleCount: number
  composeUiTestCount: number
  espressoTestCount: number
  robolectricTestCount: number
  visibleTextAssertionCount: number
  testTagAssertionCount: number
  routeReferenceCount: number
  fakeCount: number
  mockCount: number
  unresolvedFactCount: number
  warningCount: number
}

export interface AndroidTestSemanticArtifact {
  artifactKind: typeof ANDROID_TEST_SEMANTIC_ARTIFACT_KIND
  schemaVersion: typeof ANDROID_TEST_SEMANTIC_SCHEMA_VERSION
  createdAt: string
  projectRoot: string
  detected: boolean
  testFiles: AndroidTestFileEntry[]
  testClasses: AndroidTestClassEntry[]
  testMethods: AndroidTestMethodEntry[]
  testRules: AndroidTestRuleEntry[]
  assertionFacts: AndroidTestAssertionFactEntry[]
  routeFacts: AndroidTestRouteFactEntry[]
  testDoubleFacts: AndroidTestDoubleFactEntry[]
  warnings: string[]
  summary: AndroidTestSemanticSummary
}

export interface BuildAndroidTestSemanticProjectResult {
  artifact: AndroidTestSemanticArtifact
}
