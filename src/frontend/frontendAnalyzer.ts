import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import * as ts from 'typescript'
import {
  FRONTEND_SEMANTIC_ARTIFACT_KIND,
  FRONTEND_SEMANTIC_SCHEMA_VERSION,
  type FrontendFileResult,
  type FrontendSemanticArtifact,
  type FrontendSemanticSummary,
  type FrontendWarning,
  type ReactComponentCandidate,
  type LocalComponentCandidate,
  type PropTypeCandidate,
  type HookCandidate,
  type JsxRegionCandidate,
  type EventHandlerCandidate,
  type UiStringCandidate,
  type TestBlockCandidate,
  type LocatorCandidate,
  type RouteStringCandidate,
  type FrontendSourceRef,
} from './frontendTypes.js'
import type { SymbolIndex } from '../symbol-index/types.js'

const FRONTEND_EXTENSIONS = new Set(['.tsx', '.jsx', '.ts', '.js'])
const JSX_EXTENSIONS = new Set(['.tsx', '.jsx'])
const TEST_FILE_PATTERNS = [/\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /\/__tests__\//]
const REACT_HOOKS = new Set(['useState', 'useEffect', 'useRef', 'useCallback', 'useMemo', 'useContext', 'useReducer', 'useLayoutEffect', 'useImperativeHandle'])
const JSX_EVENT_ATTRS = new Set(['onClick', 'onChange', 'onFocus', 'onBlur', 'onMouseEnter', 'onMouseLeave', 'onSubmit', 'onKeyDown', 'onKeyUp', 'onKeyPress', 'onMouseDown', 'onMouseUp', 'onDoubleClick', 'onContextMenu', 'onInput', 'onReset', 'onSelect'])
const UI_STR_ATTRS = new Set(['aria-label', 'aria-labelledby', 'placeholder', 'title', 'alt'])
const MAX_UI_STRING_LENGTH = 200
const ROUTE_LIKE = /^\/[a-zA-Z0-9_\-/]*$/

export interface RunFrontendAnalyzerOptions {
  symbolIndex: SymbolIndex
  repoRoot: string
  createdAt: string
}

export interface RunFrontendAnalyzerResult {
  artifact: FrontendSemanticArtifact
  warningCount: number
  errorCount: number
}

export function runFrontendAnalyzer(options: RunFrontendAnalyzerOptions): RunFrontendAnalyzerResult {
  const fileResults: FrontendFileResult[] = []
  let totalWarnings = 0
  let totalErrors = 0

  for (const file of options.symbolIndex.files) {
    const ext = nodePath.extname(file.path).toLowerCase()
    if (!FRONTEND_EXTENSIONS.has(ext)) continue

    let sourceText: string | null = null
    try {
      sourceText = fs.readFileSync(nodePath.join(options.repoRoot, file.path), 'utf8')
    } catch {
      // File unreadable
    }

    if (sourceText === null) {
      const isTestFile = TEST_FILE_PATTERNS.some((p) => p.test(file.path))
      fileResults.push({
        filePath: file.path,
        hasJsx: JSX_EXTENSIONS.has(ext),
        isTestFile,
        parseError: true,
        components: [],
        localComponents: [],
        propTypes: [],
        hooks: [],
        jsxRegions: [],
        eventHandlers: [],
        uiStrings: [],
        testBlocks: [],
        locators: [],
        routeStrings: [],
        warnings: [{ kind: 'parse-error', message: `Could not read file: ${file.path}` }],
      })
      totalWarnings += 1
      totalErrors += 1
      continue
    }

    const result = analyzeFile(file.path, sourceText)
    fileResults.push(result)
    totalWarnings += result.warnings.length
    if (result.parseError) totalErrors += 1
  }

  const summary = buildSummary(fileResults, totalWarnings, totalErrors)

  return {
    artifact: {
      artifactKind: FRONTEND_SEMANTIC_ARTIFACT_KIND,
      schemaVersion: FRONTEND_SEMANTIC_SCHEMA_VERSION,
      createdAt: options.createdAt,
      files: fileResults,
      summary,
      warnings: [],
    },
    warningCount: totalWarnings,
    errorCount: totalErrors,
  }
}

function analyzeFile(filePath: string, sourceText: string): FrontendFileResult {
  const ext = nodePath.extname(filePath).toLowerCase()
  const isJsxExt = JSX_EXTENSIONS.has(ext)
  const isTestFile = TEST_FILE_PATTERNS.some((pattern) => pattern.test(filePath))

  const emptyResult: FrontendFileResult = {
    filePath,
    hasJsx: false,
    isTestFile,
    parseError: false,
    components: [],
    localComponents: [],
    propTypes: [],
    hooks: [],
    jsxRegions: [],
    eventHandlers: [],
    uiStrings: [],
    testBlocks: [],
    locators: [],
    routeStrings: [],
    warnings: [],
  }

  if (!sourceText) return emptyResult

  let sourceFile: ts.SourceFile
  try {
    const scriptKind = isJsxExt
      ? ext === '.tsx'
        ? ts.ScriptKind.TSX
        : ts.ScriptKind.JSX
      : ext === '.ts'
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS

    sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind)
  } catch {
    return {
      ...emptyResult,
      parseError: true,
      warnings: [{ kind: 'parse-error', message: `Failed to parse file: ${filePath}` }],
    }
  }

  const hasJsx = isJsxExt || fileContainsJsx(sourceFile)

  const extractor = new FrontendExtractor(filePath, sourceFile, isTestFile)
  extractor.extract()

  return {
    filePath,
    hasJsx,
    isTestFile,
    parseError: false,
    components: extractor.components,
    localComponents: extractor.localComponents,
    propTypes: extractor.propTypes,
    hooks: extractor.hooks,
    jsxRegions: extractor.jsxRegions,
    eventHandlers: extractor.eventHandlers,
    uiStrings: extractor.uiStrings,
    testBlocks: extractor.testBlocks,
    locators: extractor.locators,
    routeStrings: extractor.routeStrings,
    warnings: extractor.warnings,
  }
}

function fileContainsJsx(sourceFile: ts.SourceFile): boolean {
  let found = false
  function visit(node: ts.Node): void {
    if (found) return
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  // sourceFile's direct children include top-level statements; JSX is deeper
  ts.forEachChild(sourceFile, visit)
  return found
}

function buildSummary(files: FrontendFileResult[], warningCount: number, errorCount: number): FrontendSemanticSummary {
  let componentCount = 0
  let hookCount = 0
  let testBlockCount = 0
  let uiStringCount = 0
  let locatorCount = 0
  let jsxFileCount = 0
  let testFileCount = 0

  for (const file of files) {
    if (file.hasJsx) jsxFileCount += 1
    if (file.isTestFile) testFileCount += 1
    componentCount += file.components.length + file.localComponents.length
    hookCount += file.hooks.length
    testBlockCount += file.testBlocks.length
    uiStringCount += file.uiStrings.length
    locatorCount += file.locators.length
  }

  return {
    fileCount: files.length,
    jsxFileCount,
    testFileCount,
    componentCount,
    hookCount,
    testBlockCount,
    uiStringCount,
    locatorCount,
    warningCount,
    errorCount,
  }
}

// ---------------------------------------------------------------------------
// Helper: does a node contain JSX in its body?
// ---------------------------------------------------------------------------

function nodeContainsJsx(node: ts.Node): boolean {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
    return true
  }
  let found = false
  function visit(n: ts.Node): void {
    if (found) return
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
      found = true
      return
    }
    ts.forEachChild(n, visit)
  }
  ts.forEachChild(node, visit)
  return found
}

function isPascalCase(name: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(name)
}

function isHookName(name: string): boolean {
  return /^use[A-Z]/.test(name)
}

function getStringLiteral(node: ts.Node | undefined): string | null {
  if (!node) return null
  if (ts.isStringLiteral(node)) return node.text
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return null
}

// ---------------------------------------------------------------------------
// Main extractor
// ---------------------------------------------------------------------------

class FrontendExtractor {
  readonly components: ReactComponentCandidate[] = []
  readonly localComponents: LocalComponentCandidate[] = []
  readonly propTypes: PropTypeCandidate[] = []
  readonly hooks: HookCandidate[] = []
  readonly jsxRegions: JsxRegionCandidate[] = []
  readonly eventHandlers: EventHandlerCandidate[] = []
  readonly uiStrings: UiStringCandidate[] = []
  readonly testBlocks: TestBlockCandidate[] = []
  readonly locators: LocatorCandidate[] = []
  readonly routeStrings: RouteStringCandidate[] = []
  readonly warnings: FrontendWarning[] = []

  private idCounter = 0
  /** Map from component ID to the component candidate, for linking hooks/regions */
  private componentById = new Map<string, ReactComponentCandidate>()
  /** Map from interface/type-alias name to prop type candidate */
  private propTypeByName = new Map<string, PropTypeCandidate>()

  constructor(
    private readonly filePath: string,
    private readonly sourceFile: ts.SourceFile,
    private readonly isTestFile: boolean
  ) {}

  extract(): void {
    // Pass 1: collect prop-type interfaces/aliases and component candidates
    ts.forEachChild(this.sourceFile, (node) => {
      this.visitTopLevel(node)
    })

    // Pass 2: extract test blocks when this is a test file
    if (this.isTestFile) {
      this.extractTestBlocks()
    }

    // Pass 3: link prop types to components
    for (const comp of this.components) {
      if (comp.propTypeName) {
        const pt = this.propTypeByName.get(comp.propTypeName)
        if (pt && !pt.usedByComponentIds.includes(comp.id)) {
          pt.usedByComponentIds.push(comp.id)
        }
      }
    }
  }

  private extractTestBlocks(): void {
    /** Stack of parent describe block IDs for nesting tracking. */
    const parentStack: string[] = []
    const self = this

    function visitForTests(node: ts.Node): void {
      if (!ts.isCallExpression(node)) {
        ts.forEachChild(node, visitForTests)
        return
      }

      const callInfo = extractTestCallInfo(node)
      if (!callInfo) {
        ts.forEachChild(node, visitForTests)
        return
      }

      const { baseName, modifier, isSetup } = callInfo

      if (isSetup) {
        // beforeEach/afterEach/beforeAll/afterAll
        const kind = baseName as TestBlockCandidate['kind']
        const setupId = self.nextId('testblock')
        self.testBlocks.push({
          id: setupId,
          kind,
          title: null,
          framework: null,
          modifier: null,
          parentId: parentStack.length > 0 ? parentStack[parentStack.length - 1] : null,
          sourceRef: self.sourceRef(node),
          warnings: [],
        })
        // Recurse into setup body for nested calls AND extract locators/routes
        for (const arg of node.arguments) {
          if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
            ts.forEachChild(arg, visitForTests)
            self.extractLocatorsAndRoutes(arg, setupId)
          }
        }
        return
      }

      // describe/test/it
      const title = extractFirstStringArg(node)
      const framework = detectFramework(node)
      const kind = baseName.startsWith('describe') ? 'describe' : baseName === 'test' ? 'test' : 'it'

      const parentId = parentStack.length > 0 ? parentStack[parentStack.length - 1] : null
      const blockId = self.nextId('testblock')

      // Detect route-like strings in test titles
      if (title && ROUTE_LIKE.test(title)) {
        self.routeStrings.push({
          id: self.nextId('route'),
          value: title,
          testBlockId: blockId,
          sourceRef: self.sourceRef(node),
        })
      }

      self.testBlocks.push({
        id: blockId,
        kind,
        title: title ?? null,
        framework,
        modifier: modifier ?? null,
        parentId,
        sourceRef: self.sourceRef(node),
        warnings: title === null ? [{ kind: 'unsupported-pattern', message: 'Test block has no static title' }] : [],
      })

      // Recurse into the callback body for nested blocks, locators, and route strings
      for (const arg of node.arguments) {
        if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
          if (kind === 'describe') {
            parentStack.push(blockId)
            ts.forEachChild(arg, visitForTests)
            parentStack.pop()
          } else {
            // test/it body — look for locators and route strings
            self.extractLocatorsAndRoutes(arg, blockId)
          }
        }
      }
    }

    ts.forEachChild(this.sourceFile, visitForTests)
  }

  private extractLocatorsAndRoutes(callbackNode: ts.Node, testBlockId: string): void {
    const self = this
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        // Playwright locators: page.getByRole/getByText/getByLabel/getByPlaceholder/getByTestId
        // Also: locator(...), expect(...).toHaveText(...)
        const locatorInfo = extractLocatorInfo(node)
        if (locatorInfo) {
          self.locators.push({
            id: self.nextId('locator'),
            kind: locatorInfo.kind,
            value: locatorInfo.value ?? null,
            testBlockId,
            sourceRef: self.sourceRef(node),
            warnings: locatorInfo.value === null
              ? [{ kind: 'dynamic-value', message: 'Locator value is dynamic or not a string literal' }]
              : [],
          })
        }

        // page.goto("/path") → route string
        const routeStr = extractGotoRouteString(node)
        if (routeStr) {
          self.routeStrings.push({
            id: self.nextId('route'),
            value: routeStr,
            testBlockId,
            sourceRef: self.sourceRef(node),
          })
        }

        // Also look for string literals in assertions that look like routes
        extractStringArgsAsRoutes(node, testBlockId, self)
      }
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(callbackNode, visit)
  }

  private visitTopLevel(node: ts.Node): void {
    // Function declarations: function Foo() { ... }
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text
      const isExported = hasExportModifier(node)
      const isDefault = hasDefaultModifier(node)
      if (isPascalCase(name) && !isHookName(name) && nodeContainsJsx(node)) {
        this.registerComponent(node, name, 'function', isExported || isDefault, isDefault ? 'default' : isExported ? 'named' : 'local', node)
      }
      return
    }

    // Variable declarations: const Foo = () => ... or export default function
    if (ts.isVariableStatement(node)) {
      const isExported = hasExportModifier(node)
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue
        const name = decl.name.text
        if (!isPascalCase(name) || isHookName(name)) continue
        const init = decl.initializer
        if (!init) continue
        if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && nodeContainsJsx(init)) {
          this.registerComponent(node, name, 'arrow-function', isExported, isExported ? 'named' : 'local', init)
        }
      }
      return
    }

    // export default function/arrow
    if (ts.isExportAssignment(node)) {
      const expr = node.expression
      if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
        if (nodeContainsJsx(expr)) {
          this.registerComponent(node, '__default__', 'arrow-function', true, 'default', expr)
        }
      }
      // handle: export default Foo (identifier) — skip, it's just a reference
      return
    }

    // Interface / type alias for prop types
    if (ts.isInterfaceDeclaration(node) && node.name) {
      this.registerPropType(node, node.name.text, 'interface')
      return
    }
    if (ts.isTypeAliasDeclaration(node) && node.name) {
      this.registerPropType(node, node.name.text, 'type-alias')
      return
    }
  }

  private registerComponent(
    declarationNode: ts.Node,
    name: string,
    kind: ReactComponentCandidate['kind'],
    exported: boolean,
    exportKind: ReactComponentCandidate['exportKind'],
    functionBody: ts.Node
  ): void {
    const id = this.nextId('component')
    const ref = this.sourceRef(declarationNode)
    const propTypeName = this.detectPropTypeName(functionBody)

    const candidate: ReactComponentCandidate = {
      id,
      name,
      kind,
      exportKind,
      isDefaultExport: exportKind === 'default',
      propTypeName: propTypeName ?? null,
      exported,
      sourceRef: ref,
      warnings: [],
    }
    this.components.push(candidate)
    this.componentById.set(id, candidate)

    // Extract hooks, JSX regions, event handlers, UI strings within this component
    this.extractFromComponentBody(functionBody, id)

    // Extract local sub-components (functions inside this component)
    this.extractLocalComponents(functionBody, id)
  }

  private detectPropTypeName(functionBody: ts.Node): string | null {
    // Check function parameters for prop type annotation
    let params: ts.NodeArray<ts.ParameterDeclaration> | undefined

    if (ts.isFunctionDeclaration(functionBody) || ts.isFunctionExpression(functionBody) || ts.isArrowFunction(functionBody)) {
      params = functionBody.parameters
    }

    if (!params || params.length === 0) return null

    const firstParam = params[0]
    if (!firstParam.type) return null

    // { label, onClick }: ButtonProps → type reference
    if (ts.isTypeReferenceNode(firstParam.type)) {
      const typeName = firstParam.type.typeName
      if (ts.isIdentifier(typeName)) return typeName.text
    }

    return null
  }

  private registerPropType(node: ts.Node, name: string, kind: 'interface' | 'type-alias'): void {
    const id = this.nextId('proptype')
    const candidate: PropTypeCandidate = {
      id,
      name,
      kind,
      usedByComponentIds: [],
      sourceRef: this.sourceRef(node),
      warnings: [],
    }
    this.propTypes.push(candidate)
    this.propTypeByName.set(name, candidate)
  }

  private extractFromComponentBody(functionBody: ts.Node, componentId: string): void {
    const self = this
    function visit(node: ts.Node): void {
      // Don't walk into nested function/arrow definitions at full depth
      // (those become local component candidates or hook arguments)
      if (isNestedFunctionLike(node)) return

      // Hook calls: useState(...), useEffect(...), etc.
      if (ts.isCallExpression(node)) {
        self.tryExtractHookCall(node, componentId)
        // Continue to visit call arguments (for hooks with callbacks like useEffect)
        ts.forEachChild(node, visit)
        return
      }

      // Return statements with JSX — record the region, then recurse into the expression
      if (ts.isReturnStatement(node)) {
        if (node.expression && nodeContainsJsx(node.expression)) {
          self.extractJsxReturnRegion(node, componentId)
          // Visit inside the return expression for ternary/logical branches and UI strings
          visitJsxExpression(node.expression)
        }
        return
      }

      ts.forEachChild(node, visit)
    }

    // Separate visitor for inside JSX expressions to find branches and UI strings
    function visitJsxExpression(node: ts.Node): void {
      // Don't recurse into nested functions inside JSX
      if (isNestedFunctionLike(node)) return

      // Ternary JSX branches
      if (ts.isConditionalExpression(node)) {
        if (nodeContainsJsx(node.whenTrue) || nodeContainsJsx(node.whenFalse)) {
          self.extractTernaryJsxBranches(node, componentId)
        }
        // Recurse into branches to find nested branches and UI strings
        visitJsxExpression(node.whenTrue)
        visitJsxExpression(node.whenFalse)
        return
      }

      // Logical && JSX branches
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        if (nodeContainsJsx(node.right)) {
          self.extractLogicalBranch(node, componentId)
        }
        visitJsxExpression(node.right)
        return
      }

      // JSX text and attribute extraction
      if (ts.isJsxText(node)) {
        const text = node.text.trim()
        if (text.length > 0 && text.length <= MAX_UI_STRING_LENGTH) {
          self.uiStrings.push({
            id: self.nextId('uistr'),
            kind: 'visible-text',
            value: text,
            componentId,
            jsxRegionId: null,
            sourceRef: self.sourceRef(node),
            warnings: [],
          })
        }
        return
      }

      if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
        const attrName = node.name.text
        const value = node.initializer

        if (attrName === 'data-testid' && value) {
          const strVal = extractJsxAttrStringValue(value)
          if (strVal) {
            self.uiStrings.push({
              id: self.nextId('uistr'),
              kind: 'data-testid',
              value: strVal,
              componentId,
              jsxRegionId: null,
              sourceRef: self.sourceRef(node),
              warnings: [],
            })
          }
          return
        }

        if (UI_STR_ATTRS.has(attrName) && value) {
          const strVal = extractJsxAttrStringValue(value)
          if (strVal) {
            const kind = attrName === 'aria-label' ? 'aria-label'
              : attrName === 'aria-labelledby' ? 'aria-labelledby'
                : attrName === 'placeholder' ? 'placeholder'
                  : 'accessible-text'
            self.uiStrings.push({
              id: self.nextId('uistr'),
              kind,
              value: strVal,
              componentId,
              jsxRegionId: null,
              sourceRef: self.sourceRef(node),
              warnings: [],
            })
          }
          return
        }

        if (JSX_EVENT_ATTRS.has(attrName) && value) {
          self.extractJsxEventHandler(node, attrName, value, componentId)
          return
        }
      }

      ts.forEachChild(node, visitJsxExpression)
    }

    // Event handler local variables: const handleClick = () => {}
    function visitForHandlers(node: ts.Node): void {
      if (isNestedFunctionLike(node)) return
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const name = node.name.text
        if (/^(handle|on)[A-Z]/.test(name) || /Handler$/.test(name)) {
          self.eventHandlers.push({
            id: self.nextId('handler'),
            name,
            kind: 'arrow-const',
            componentId,
            sourceRef: self.sourceRef(node),
            warnings: [],
          })
        }
      }
      ts.forEachChild(node, visitForHandlers)
    }

    ts.forEachChild(functionBody, visit)
    ts.forEachChild(functionBody, visitForHandlers)
  }

  private tryExtractHookCall(node: ts.CallExpression, componentId: string): boolean {
    const expr = node.expression
    let hookName: string | null = null

    if (ts.isIdentifier(expr)) {
      hookName = expr.text
    } else if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
      // React.useState etc.
      hookName = expr.name.text
    }

    if (!hookName) return false
    if (!REACT_HOOKS.has(hookName) && !isHookName(hookName)) return false

    const kind = (
      hookName === 'useState' ? 'useState'
        : hookName === 'useEffect' ? 'useEffect'
          : hookName === 'useRef' ? 'useRef'
            : hookName === 'useCallback' ? 'useCallback'
              : hookName === 'useMemo' ? 'useMemo'
                : hookName === 'useContext' ? 'useContext'
                  : isHookName(hookName) ? 'custom'
                    : 'unknown'
    ) satisfies HookCandidate['kind']

    let stateVarName: string | null = null
    let setterName: string | null = null

    // Detect: const [count, setCount] = useState(0)
    const parent = node.parent
    if (parent && ts.isVariableDeclaration(parent)) {
      if (ts.isArrayBindingPattern(parent.name) && parent.name.elements.length >= 1) {
        const first = parent.name.elements[0]
        const second = parent.name.elements[1]
        if (first && ts.isBindingElement(first) && ts.isIdentifier(first.name)) {
          stateVarName = first.name.text
        }
        if (second && ts.isBindingElement(second) && ts.isIdentifier(second.name)) {
          setterName = second.name.text
        }
      } else if (ts.isIdentifier(parent.name)) {
        stateVarName = parent.name.text
      }
    }

    this.hooks.push({
      id: this.nextId('hook'),
      hookName,
      kind,
      componentId,
      stateVarName,
      setterName,
      sourceRef: this.sourceRef(node),
      warnings: [],
    })
    return true
  }

  private extractJsxReturnRegion(returnNode: ts.ReturnStatement, componentId: string): void {
    const regionId = this.nextId('jsxregion')
    this.jsxRegions.push({
      id: regionId,
      kind: 'return',
      componentId,
      conditionText: null,
      sourceRef: this.sourceRef(returnNode),
      warnings: [],
    })
  }

  private extractTernaryJsxBranches(node: ts.ConditionalExpression, componentId: string): void {
    const conditionText = this.extractBoundedText(node.condition)
    if (nodeContainsJsx(node.whenTrue)) {
      this.jsxRegions.push({
        id: this.nextId('jsxregion'),
        kind: 'ternary-branch',
        componentId,
        conditionText,
        sourceRef: this.sourceRef(node.whenTrue),
        warnings: [],
      })
    }
    if (nodeContainsJsx(node.whenFalse)) {
      this.jsxRegions.push({
        id: this.nextId('jsxregion'),
        kind: 'ternary-branch',
        componentId,
        conditionText: conditionText ? `!(${conditionText})` : null,
        sourceRef: this.sourceRef(node.whenFalse),
        warnings: [],
      })
    }
  }

  private extractLogicalBranch(node: ts.BinaryExpression, componentId: string): void {
    const conditionText = this.extractBoundedText(node.left)
    this.jsxRegions.push({
      id: this.nextId('jsxregion'),
      kind: 'logical-branch',
      componentId,
      conditionText,
      sourceRef: this.sourceRef(node.right),
      warnings: [],
    })
  }

  private extractBoundedText(node: ts.Node): string | null {
    const text = node.getText(this.sourceFile)
    if (text.length > 80) return null
    // Skip dynamic expressions
    if (text.includes('(') && !ts.isCallExpression(node)) return null
    return text
  }

  private extractJsxEventHandler(
    attrNode: ts.JsxAttribute,
    eventAttr: string,
    value: ts.JsxAttributeValue,
    componentId: string
  ): void {
    let kind: EventHandlerCandidate['kind'] = 'unknown'
    let name: string | undefined

    if (ts.isJsxExpression(value) && value.expression) {
      const expr = value.expression
      if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
        kind = 'inline'
      } else if (ts.isIdentifier(expr)) {
        kind = 'reference'
        name = expr.text
      } else {
        kind = 'reference'
      }
    }

    this.eventHandlers.push({
      id: this.nextId('handler'),
      name: name ?? null,
      eventAttr,
      kind,
      componentId,
      sourceRef: this.sourceRef(attrNode),
      warnings: [],
    })
  }

  private extractLocalComponents(functionBody: ts.Node, parentComponentId: string): void {
    const self = this

    function visitForLocalComponents(node: ts.Node, depth: number): void {
      if (depth === 0) {
        ts.forEachChild(node, (child) => visitForLocalComponents(child, 0))
        return
      }

      // Local function inside component body
      if (ts.isFunctionDeclaration(node) && node.name) {
        const name = node.name.text
        if (isPascalCase(name) && !isHookName(name) && nodeContainsJsx(node)) {
          const id = self.nextId('local-component')
          self.localComponents.push({
            id,
            name,
            kind: 'function',
            parentComponentId,
            sourceRef: self.sourceRef(node),
            warnings: [],
          })
          return
        }
      }

      // Local const arrow component
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const name = node.name.text
        const init = node.initializer
        if (isPascalCase(name) && !isHookName(name) && init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
          nodeContainsJsx(init)) {
          const id = self.nextId('local-component')
          self.localComponents.push({
            id,
            name,
            kind: 'arrow-function',
            parentComponentId,
            sourceRef: self.sourceRef(node),
            warnings: [],
          })
          return
        }
      }

      ts.forEachChild(node, (child) => visitForLocalComponents(child, depth))
    }

    // Walk the function body (block), not the function node itself
    if (ts.isBlock(functionBody)) {
      ts.forEachChild(functionBody, (child) => visitForLocalComponents(child, 1))
    } else if (ts.isFunctionDeclaration(functionBody) || ts.isFunctionExpression(functionBody) || ts.isArrowFunction(functionBody)) {
      const body = functionBody.body
      if (body && ts.isBlock(body)) {
        ts.forEachChild(body, (child) => visitForLocalComponents(child, 1))
      }
    }
  }

  nextId(prefix: string): string {
    this.idCounter += 1
    return `${prefix}:${this.filePath}#${this.idCounter}`
  }

  sourceRef(node: ts.Node): FrontendSourceRef {
    const start = this.sourceFile.getLineAndCharacterOfPosition(node.getStart(this.sourceFile))
    const end = this.sourceFile.getLineAndCharacterOfPosition(node.getEnd())
    return {
      filePath: this.filePath,
      line: start.line + 1,
      endLine: end.line + 1,
      column: start.character + 1,
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false
  const modifiers = ts.getModifiers(node)
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

function hasDefaultModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false
  const modifiers = ts.getModifiers(node)
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false
}

function isNestedFunctionLike(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  )
}

function extractJsxAttrStringValue(value: ts.JsxAttributeValue): string | null {
  if (ts.isStringLiteral(value)) return value.text
  if (ts.isJsxExpression(value) && value.expression) {
    return getStringLiteral(value.expression)
  }
  return null
}

// ---------------------------------------------------------------------------
// Test block helpers
// ---------------------------------------------------------------------------

const TEST_CALL_BASES = new Set(['describe', 'test', 'it', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll'])
const SETUP_CALL_BASES = new Set(['beforeEach', 'afterEach', 'beforeAll', 'afterAll'])
const PLAYWRIGHT_LOCATOR_METHODS = new Set(['getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByTestId', 'locator'])

interface TestCallInfo {
  baseName: string
  modifier: 'skip' | 'only' | null
  isSetup: boolean
}

function extractTestCallInfo(node: ts.CallExpression): TestCallInfo | null {
  const expr = node.expression

  // Simple: describe('...', ...) or test('...', ...)
  if (ts.isIdentifier(expr)) {
    const name = expr.text
    if (TEST_CALL_BASES.has(name)) {
      return { baseName: name, modifier: null, isSetup: SETUP_CALL_BASES.has(name) }
    }
    return null
  }

  // Qualified: test.skip, describe.only, test.describe (Playwright), test.beforeEach (Playwright), etc.
  if (ts.isPropertyAccessExpression(expr)) {
    const obj = expr.expression
    const prop = expr.name.text
    if (ts.isIdentifier(obj)) {
      const base = obj.text
      if (TEST_CALL_BASES.has(base)) {
        // test.describe / test.beforeEach / test.afterEach etc. — prop is the real call
        if (TEST_CALL_BASES.has(prop)) {
          return { baseName: prop, modifier: null, isSetup: SETUP_CALL_BASES.has(prop) }
        }
        // test.skip, describe.only
        if (prop === 'skip' || prop === 'only') {
          return { baseName: base, modifier: prop as 'skip' | 'only', isSetup: false }
        }
        // test.each, test.todo, test.concurrent — treat as regular test call
        if (!SETUP_CALL_BASES.has(base)) {
          return { baseName: base, modifier: null, isSetup: false }
        }
      }
    }
  }

  return null
}

function extractFirstStringArg(node: ts.CallExpression): string | null {
  const first = node.arguments[0]
  if (!first) return null
  return getStringLiteral(first)
}

function detectFramework(node: ts.CallExpression): TestBlockCandidate['framework'] {
  // Playwright: test() where 'test' was imported from @playwright/test
  // Vitest: describe/it/test from 'vitest'
  // We can't do import resolution statically here, so use heuristics:
  // - If file contains page.goto or expect(page)... → playwright
  // We leave this as generic since we don't have import info in extractor
  return 'generic'
}

interface LocatorInfo {
  kind: LocatorCandidate['kind']
  value: string | null
}

function extractLocatorInfo(node: ts.CallExpression): LocatorInfo | null {
  const expr = node.expression
  if (!ts.isPropertyAccessExpression(expr)) return null

  const methodName = expr.name.text

  if (PLAYWRIGHT_LOCATOR_METHODS.has(methodName)) {
    const firstArg = node.arguments[0]
    const value = firstArg ? getStringLiteral(firstArg) : null
    const kind = (
      methodName === 'getByRole' ? 'getByRole'
        : methodName === 'getByText' ? 'getByText'
          : methodName === 'getByLabel' ? 'getByLabel'
            : methodName === 'getByPlaceholder' ? 'getByPlaceholder'
              : methodName === 'getByTestId' ? 'getByTestId'
                : 'locator'
    ) satisfies LocatorCandidate['kind']
    return { kind, value }
  }

  // expect(...).toHaveText(...) or expect(...).toContainText(...)
  if (methodName === 'toHaveText' || methodName === 'toContainText') {
    const firstArg = node.arguments[0]
    const value = firstArg ? getStringLiteral(firstArg) : null
    return { kind: 'expect-text', value }
  }

  return null
}

function extractGotoRouteString(node: ts.CallExpression): string | null {
  const expr = node.expression
  if (!ts.isPropertyAccessExpression(expr)) return null
  if (expr.name.text !== 'goto') return null

  const firstArg = node.arguments[0]
  if (!firstArg) return null
  const value = getStringLiteral(firstArg)
  if (!value) return null

  // Only record meaningful paths (starts with /, not a URL, length > 1)
  if (value.length > 1 && value.startsWith('/') && !value.startsWith('//') && !value.includes('://')) {
    return value
  }
  return null
}

function extractStringArgsAsRoutes(
  node: ts.CallExpression,
  testBlockId: string,
  extractor: { routeStrings: RouteStringCandidate[]; nextId: (prefix: string) => string; sourceRef: (node: ts.Node) => FrontendSourceRef }
): void {
  // Don't add routes for known non-route calls
  const expr = node.expression
  if (ts.isPropertyAccessExpression(expr)) {
    const method = expr.name.text
    // Skip locator methods already handled
    if (PLAYWRIGHT_LOCATOR_METHODS.has(method) || method === 'goto') return
  }

  for (const arg of node.arguments) {
    const strVal = getStringLiteral(arg)
    if (strVal && ROUTE_LIKE.test(strVal) && strVal.length > 1) {
      extractor.routeStrings.push({
        id: extractor.nextId('route'),
        value: strVal,
        testBlockId,
        sourceRef: extractor.sourceRef(arg),
      })
    }
  }
}
