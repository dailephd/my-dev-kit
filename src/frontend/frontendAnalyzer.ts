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
      const ext = nodePath.extname(file.path).toLowerCase()
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

  const extractor = new FrontendExtractor(filePath, sourceFile)
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
// Extractor — Prompt 1 skeleton: empty extraction, wired for Prompt 2/3
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

  constructor(
    private readonly filePath: string,
    private readonly sourceFile: ts.SourceFile
  ) {}

  extract(): void {
    // Prompt 1: skeleton only. Extraction logic added in Prompt 2 and 3.
  }

  protected nextId(prefix: string): string {
    this.idCounter += 1
    return `${prefix}:${this.filePath}#${this.idCounter}`
  }

  protected sourceRef(node: ts.Node): FrontendSourceRef {
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
