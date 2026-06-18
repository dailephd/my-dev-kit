export const FRONTEND_SEMANTIC_SCHEMA_VERSION = '1.0.0'
export const FRONTEND_SEMANTIC_ARTIFACT_KIND = 'my-dev-kit-v1-frontend-semantic'

export type FrontendAnalyzerId = 'frontend-semantic'

/** Source location within a file. */
export interface FrontendSourceRef {
  filePath: string
  line: number
  endLine: number
  column?: number | null
  symbolId?: string | null
}

/** A non-fatal warning emitted during frontend extraction. */
export interface FrontendWarning {
  kind:
    | 'unsupported-pattern'
    | 'ambiguous-component'
    | 'parse-error'
    | 'dynamic-value'
    | 'partial-extraction'
    | 'unknown'
  message: string
  sourceRef?: FrontendSourceRef | null
}

/**
 * A React component candidate detected by static analysis.
 * Conservative: only includes patterns where component identity is unambiguous.
 */
export interface ReactComponentCandidate {
  id: string
  name: string
  kind: 'function' | 'arrow-function' | 'unknown'
  exportKind: 'named' | 'default' | 'local' | 'none'
  isDefaultExport: boolean
  /** Detected prop type name (interface/type alias) if statically known. */
  propTypeName?: string | null
  /** Whether the component is exported (named or default). */
  exported: boolean
  sourceRef: FrontendSourceRef
  warnings: FrontendWarning[]
}

/**
 * A local sub-component defined within the same file.
 * Same detection rules as ReactComponentCandidate but explicitly scoped to a parent.
 */
export interface LocalComponentCandidate {
  id: string
  name: string
  kind: 'function' | 'arrow-function' | 'unknown'
  parentComponentId?: string | null
  sourceRef: FrontendSourceRef
  warnings: FrontendWarning[]
}

/** A prop type or local interface/type alias that appears to be used for props. */
export interface PropTypeCandidate {
  id: string
  name: string
  kind: 'interface' | 'type-alias' | 'unknown'
  members?: PropMemberCandidate[]
  /** Component IDs that reference this prop type. */
  usedByComponentIds: string[]
  sourceRef: FrontendSourceRef
  warnings: FrontendWarning[]
}

export interface PropMemberCandidate {
  name: string
  optional: boolean
  typeText?: string | null
  sourceRef: FrontendSourceRef
}

/** A React hook or state call within a component. */
export interface HookCandidate {
  id: string
  hookName: string
  kind: 'useState' | 'useEffect' | 'useRef' | 'useCallback' | 'useMemo' | 'useContext' | 'custom' | 'unknown'
  /** Parent component ID. */
  componentId?: string | null
  /** State variable name(s) from destructuring, if useState. */
  stateVarName?: string | null
  setterName?: string | null
  sourceRef: FrontendSourceRef
  warnings: FrontendWarning[]
}

/** A JSX render region within a component. */
export interface JsxRegionCandidate {
  id: string
  kind: 'return' | 'ternary-branch' | 'logical-branch' | 'early-return' | 'fragment' | 'helper' | 'unknown'
  /** Component ID this region belongs to. */
  componentId?: string | null
  /** Static condition text if this is a branch (bounded, no dynamic expressions). */
  conditionText?: string | null
  sourceRef: FrontendSourceRef
  warnings: FrontendWarning[]
}

/** An event handler attached to JSX or defined locally in a component. */
export interface EventHandlerCandidate {
  id: string
  name?: string | null
  /** JSX event attribute name, e.g. "onClick". */
  eventAttr?: string | null
  kind: 'named-function' | 'arrow-const' | 'inline' | 'reference' | 'unknown'
  componentId?: string | null
  sourceRef: FrontendSourceRef
  warnings: FrontendWarning[]
}

/** A UI string, data-testid, ARIA label, or similar accessibility/testability fact. */
export interface UiStringCandidate {
  id: string
  kind:
    | 'visible-text'
    | 'data-testid'
    | 'aria-label'
    | 'aria-labelledby'
    | 'placeholder'
    | 'accessible-text'
    | 'unknown'
  value: string
  componentId?: string | null
  /** JSX region this string belongs to, if detectable. */
  jsxRegionId?: string | null
  sourceRef: FrontendSourceRef
  warnings: FrontendWarning[]
}

/** A test block (describe/test/it) found in a test file. */
export interface TestBlockCandidate {
  id: string
  kind: 'describe' | 'test' | 'it' | 'beforeEach' | 'afterEach' | 'beforeAll' | 'afterAll' | 'unknown'
  title?: string | null
  framework?: 'vitest' | 'playwright' | 'generic' | null
  /** Whether this block is skipped (.skip) or exclusive (.only). */
  modifier?: 'skip' | 'only' | null
  /** Parent describe block ID, if nested. */
  parentId?: string | null
  sourceRef: FrontendSourceRef
  warnings: FrontendWarning[]
}

/** A Playwright locator call in a test. */
export interface LocatorCandidate {
  id: string
  kind:
    | 'getByRole'
    | 'getByText'
    | 'getByLabel'
    | 'getByPlaceholder'
    | 'getByTestId'
    | 'locator'
    | 'expect-text'
    | 'unknown'
  /** Literal locator value, if statically known. */
  value?: string | null
  testBlockId?: string | null
  sourceRef: FrontendSourceRef
  warnings: FrontendWarning[]
}

/** A route-like string found in a test file (e.g. "/dashboard"). */
export interface RouteStringCandidate {
  id: string
  value: string
  /** Test block this route string belongs to. */
  testBlockId?: string | null
  sourceRef: FrontendSourceRef
}

export type ReactFlowRelationshipKind =
  | 'react-renders-local-component'
  | 'react-passes-prop'
  | 'react-passes-callback-prop'
  | 'react-callback-invoked-by-child'
  | 'react-event-uses-handler'
  | 'react-handler-reads-state'
  | 'react-handler-sets-state'
  | 'react-state-controls-jsx-branch'
  | 'react-helper-computes-prop'
  | 'react-prop-reference'

export interface ReactFlowRelationship {
  id: string
  kind: ReactFlowRelationshipKind
  filePath: string
  ownerComponentId?: string | null
  sourceId: string
  targetId?: string | null
  propName?: string | null
  valueSummary?: string | null
  sourceRef: FrontendSourceRef
  metadata?: Record<string, string | number | boolean | null>
  warnings: FrontendWarning[]
}

/** Per-file frontend semantic facts extracted from one source file. */
export interface FrontendFileResult {
  filePath: string
  /** Whether this file contains any JSX syntax. */
  hasJsx: boolean
  /** Whether this file looks like a test file. */
  isTestFile: boolean
  /** Whether the file had a parse error during extraction. */
  parseError: boolean
  components: ReactComponentCandidate[]
  localComponents: LocalComponentCandidate[]
  propTypes: PropTypeCandidate[]
  hooks: HookCandidate[]
  jsxRegions: JsxRegionCandidate[]
  eventHandlers: EventHandlerCandidate[]
  uiStrings: UiStringCandidate[]
  relationships: ReactFlowRelationship[]
  testBlocks: TestBlockCandidate[]
  locators: LocatorCandidate[]
  routeStrings: RouteStringCandidate[]
  warnings: FrontendWarning[]
}

/** The full frontend semantic artifact written to frontend-semantic.json. */
export interface FrontendSemanticArtifact {
  artifactKind: typeof FRONTEND_SEMANTIC_ARTIFACT_KIND
  schemaVersion: string
  createdAt: string
  files: FrontendFileResult[]
  summary: FrontendSemanticSummary
  warnings: FrontendWarning[]
}

export interface FrontendSemanticSummary {
  fileCount: number
  jsxFileCount: number
  testFileCount: number
  componentCount: number
  hookCount: number
  testBlockCount: number
  uiStringCount: number
  relationshipCount: number
  locatorCount: number
  warningCount: number
  errorCount: number
}
