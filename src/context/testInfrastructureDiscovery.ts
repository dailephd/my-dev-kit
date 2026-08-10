/**
 * v1.10.1 Batch 3: bounded, conservative discovery of existing test infrastructure.
 *
 * IMPORTANT architectural note: the existing indexer (`discoverSourceFiles.ts`)
 * hard-excludes any path containing ".test." or ".spec." from the symbol index
 * and code graph by default (`DEFAULT_FILE_EXCLUDE_PATTERNS`) — this is a
 * pre-existing Batch 1/1.10.0 boundary, not something Batch 3 introduces. That
 * means the code graph can never contain a `*.spec.ts`/`*.test.ts` node, so
 * related-test discovery cannot be implemented purely via graph edges (one
 * endpoint would never exist). Instead this module performs a bounded,
 * read-only directory walk restricted to the index's own `sourceRoots`
 * (reusing `discoverSourceFiles.ts`'s ignored-directory list rather than a
 * second one) to find test-shaped files, then does a lightweight, bounded,
 * regex-based import-specifier scan (never executes/evaluates the file) to
 * resolve which already-indexed production/fixture/mock/factory files each
 * test file references. This is not a second index: nothing is persisted,
 * no symbols are extracted, and only test-shaped files are ever read.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { toForwardSlash } from '../io/pathUtils.js'
import { DEFAULT_IGNORED_DIRECTORY_NAMES, DEFAULT_IGNORED_DIRECTORY_PREFIXES } from '../indexing/discoverSourceFiles.js'
import type { SymbolIndex } from '../symbol-index/types.js'
import { isFactoryLike, isFixtureLike, isMockLike, isSetupLike, isTestLike } from './evidenceClassification.js'
import type {
  ContextRole,
  EvidenceItemRef,
  PackageScriptEvidenceEntry,
  RequestedEvidenceKind,
  TestCommandEvidenceEntry,
  TestConfigurationEvidenceEntry,
  UnresolvedEvidenceItem,
} from './types.js'

export interface BoundedList<T> {
  /** Complete bounded discovery inventory used by the downstream shared allocator.
   * This field is internal and is never serialized into a context capsule/audit. */
  candidates: T[]
  items: T[]
  availableCount: number
  limit: number
  truncated: boolean
  droppedCount: number
}

function bound<T>(sorted: T[], limit: number): BoundedList<T> {
  const items = sorted.slice(0, limit)
  return {
    candidates: sorted,
    items,
    availableCount: sorted.length,
    limit,
    truncated: sorted.length > limit,
    droppedCount: Math.max(0, sorted.length - limit),
  }
}

export const DEFAULT_TEST_INFRA_LIMITS = {
  relatedTests: 20,
  fixtures: 20,
  factories: 15,
  mocks: 15,
  setupFiles: 10,
  testConfigurations: 10,
  packageScripts: 12,
  testCommands: 8,
} as const

export type TestInfraLimits = typeof DEFAULT_TEST_INFRA_LIMITS

export interface DiscoverTestInfrastructureOptions {
  role: ContextRole | null
  symbolIndex: SymbolIndex
  /** Production file paths (project-relative, forward-slash) the caller wants related evidence for. */
  filesOfInterest: string[]
  /** Production symbol IDs (`symbol:<path>#<name>`) the caller wants related evidence for. */
  symbolsOfInterest: string[]
  requestedEvidenceKinds: RequestedEvidenceKind[]
  repoRoot: string
  limits?: Partial<TestInfraLimits>
}

export interface DiscoverTestInfrastructureResult {
  relatedTests: BoundedList<EvidenceItemRef>
  fixtures: BoundedList<EvidenceItemRef>
  factories: BoundedList<EvidenceItemRef>
  mocks: BoundedList<EvidenceItemRef>
  setupFiles: BoundedList<EvidenceItemRef>
  testConfigurations: BoundedList<TestConfigurationEvidenceEntry>
  packageScripts: BoundedList<PackageScriptEvidenceEntry>
  testCommands: BoundedList<TestCommandEvidenceEntry>
  unresolved: UnresolvedEvidenceItem[]
  warnings: string[]
}

const MAX_SCANNED_TEST_FILES = 400
const MAX_READ_BYTES = 400_000

function isIgnoredDirName(name: string): boolean {
  if ((DEFAULT_IGNORED_DIRECTORY_NAMES as readonly string[]).includes(name)) return true
  return (DEFAULT_IGNORED_DIRECTORY_PREFIXES as readonly string[]).some((prefix) => name.startsWith(prefix))
}

/** Bounded, read-only directory walk restricted to the index's own `sourceRoots`,
 * reusing the indexer's own ignored-directory list. Only collects paths matching
 * `isTestLike` — never parses, indexes, or persists anything. */
function listTestShapedFiles(repoRoot: string, sourceRoots: string[]): string[] {
  const results = new Set<string>()
  const roots = sourceRoots.length > 0 ? sourceRoots : ['.']

  function walk(dir: string): void {
    if (results.size >= MAX_SCANNED_TEST_FILES) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      if (results.size >= MAX_SCANNED_TEST_FILES) return
      if (entry.isDirectory()) {
        if (isIgnoredDirName(entry.name)) continue
        walk(path.join(dir, entry.name))
      } else if (entry.isFile()) {
        const relPath = toForwardSlash(path.relative(repoRoot, path.join(dir, entry.name)))
        if (isTestLike(relPath)) results.add(relPath)
      }
    }
  }

  for (const root of roots) walk(path.resolve(repoRoot, root))
  return [...results].sort()
}

function readBoundedText(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size > MAX_READ_BYTES) return null
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
}

interface ImportClause {
  specifier: string
  names: string[]
}

const IMPORT_CLAUSE_PATTERN = /import\s+(?:type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g
const REQUIRE_CALL_PATTERN = /require\(\s*['"]([^'"]+)['"]\s*\)/g

/** Bounded, regex-based import-specifier scan. Never parses/evaluates the file as code. */
function extractImportClauses(text: string): ImportClause[] {
  const results: ImportClause[] = []
  IMPORT_CLAUSE_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = IMPORT_CLAUSE_PATTERN.exec(text))) {
    const clause = match[1].trim()
    const specifier = match[2]
    const names: string[] = []
    const braceMatch = /\{([^}]*)\}/.exec(clause)
    if (braceMatch) {
      for (const part of braceMatch[1].split(',')) {
        const trimmed = part.trim()
        if (!trimmed) continue
        const asMatch = /^(\w+)\s+as\s+(\w+)$/.exec(trimmed)
        names.push(asMatch ? asMatch[1] : (trimmed.split(/\s+/)[0] ?? trimmed))
      }
    }
    if (clause.length > 0 && !clause.startsWith('{') && !clause.startsWith('*')) {
      const defaultMatch = /^(\w+)/.exec(clause)
      if (defaultMatch) names.push(defaultMatch[1])
    }
    results.push({ specifier, names })
  }
  REQUIRE_CALL_PATTERN.lastIndex = 0
  while ((match = REQUIRE_CALL_PATTERN.exec(text))) {
    results.push({ specifier: match[1], names: [] })
  }
  return results
}

/** TypeScript NodeNext/Node16 moduleResolution requires source files to import each
 * other using the emitted-JS extension (e.g. `./completion.js`) even though the source
 * on disk is `./completion.ts` — the specifier's extension is deliberately not the
 * source file's extension. Maps an emitted-style extension to the source extension(s)
 * that may legitimately produce it, in resolution-preference order. */
const JS_EMIT_EXTENSION_TO_SOURCE_EXTENSIONS: Record<string, readonly string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
}

function stripKnownEmitExtension(value: string): { base: string; ext: string } | null {
  for (const ext of Object.keys(JS_EMIT_EXTENSION_TO_SOURCE_EXTENSIONS)) {
    if (value.endsWith(ext)) return { base: value.slice(0, value.length - ext.length), ext }
  }
  return null
}

/** Resolves a relative (`./`/`../`) import specifier against already-indexed file paths
 * using the same extension/index-file conventions the language adapters use. Non-relative
 * (package) specifiers are never resolved (they can't reach a project-local test/fixture).
 *
 * Handles the NodeNext/Node16 case where the specifier already carries an emitted-JS
 * extension (`./completion.js`) but the real source is TypeScript (`./completion.ts`):
 * the literal specifier target is still tried first (an actual `.js`/`.jsx` file at that
 * exact path takes precedence when one is indexed), then its NodeNext source
 * correspondence, then the pre-existing extensionless-import candidate list. */
export function resolveRelativeSpecifier(fromPath: string, specifier: string, knownPaths: Set<string>): string | null {
  if (!specifier.startsWith('.')) return null
  const fromDir = path.posix.dirname(fromPath)
  const joined = path.posix.normalize(path.posix.join(fromDir, specifier)).replace(/^\.\//, '')
  const candidates = [joined]
  const stripped = stripKnownEmitExtension(joined)
  if (stripped) {
    for (const sourceExt of JS_EMIT_EXTENSION_TO_SOURCE_EXTENSIONS[stripped.ext] ?? []) {
      candidates.push(`${stripped.base}${sourceExt}`)
    }
  }
  candidates.push(
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.js`,
    `${joined}.jsx`,
    `${joined}.mjs`,
    `${joined}.cjs`,
    `${joined}/index.ts`,
    `${joined}/index.tsx`,
    `${joined}/index.js`,
  )
  for (const candidate of candidates) {
    if (knownPaths.has(candidate)) return candidate
  }
  return null
}

interface TestFileAnalysis {
  testPath: string
  resolvedImports: Array<{ path: string; names: string[] }>
}

/** One bounded read+scan pass per test-shaped file, reused by related-test, fixture,
 * factory, mock, and setup-fallback discovery so each file is only read once. */
function analyzeTestShapedFiles(options: { repoRoot: string; sourceRoots: string[]; knownPaths: Set<string> }): TestFileAnalysis[] {
  const { repoRoot, sourceRoots, knownPaths } = options
  const testPaths = listTestShapedFiles(repoRoot, sourceRoots)
  const analyses: TestFileAnalysis[] = []
  for (const testPath of testPaths) {
    const text = readBoundedText(path.join(repoRoot, testPath))
    if (text === null) continue
    const resolvedImports: Array<{ path: string; names: string[] }> = []
    for (const clause of extractImportClauses(text)) {
      const resolved = resolveRelativeSpecifier(testPath, clause.specifier, knownPaths)
      if (resolved && resolved !== testPath) resolvedImports.push({ path: resolved, names: clause.names })
    }
    analyses.push({ testPath, resolvedImports })
  }
  return analyses
}

interface RelatedTestMatch {
  testPath: string
  relationship: 'references-selected-production-symbol' | 'imports-selected-production-file'
  basis: string[]
}

/**
 * Rank compact related-test references for bounded selection.
 *
 * Discovery relationships are request-scoped rather than responsibility-specific:
 * `testResponsibilityRefs` is intentionally only a string-ID contract, so assigning
 * a particular test to a particular responsibility would fabricate semantics. The
 * honest coverage signal available here is the set of changed/focus symbols or files
 * each test imports. Greedily retain references that add previously unseen request
 * evidence before redundant references, then prefer direct symbol references and
 * stable paths. This order matters only when the real aggregate bound overflows.
 */
function rankRelatedTestMatches(matches: RelatedTestMatch[]): RelatedTestMatch[] {
  const remaining = [...matches]
  const selected: RelatedTestMatch[] = []
  const coveredBasis = new Set<string>()

  while (remaining.length > 0) {
    remaining.sort((a, b) => {
      const aNew = a.basis.filter((basis) => !coveredBasis.has(basis)).length
      const bNew = b.basis.filter((basis) => !coveredBasis.has(basis)).length
      return (
        bNew - aNew ||
        (a.relationship === b.relationship
          ? 0
          : a.relationship === 'references-selected-production-symbol'
            ? -1
            : 1) ||
        a.testPath.localeCompare(b.testPath)
      )
    })
    const next = remaining.shift()
    if (!next) break
    selected.push(next)
    for (const basis of next.basis) coveredBasis.add(basis)
  }

  return selected
}

/** Parses `symbol:<path>#<name>` IDs into a path -> simple-name-set lookup. */
function symbolsOfInterestByPath(symbolsOfInterest: string[]): Map<string, Set<string>> {
  const byPath = new Map<string, Set<string>>()
  const pattern = /^symbol:(.+)#(.+)$/
  for (const id of symbolsOfInterest) {
    const match = pattern.exec(id)
    if (!match) continue
    const [, filePath, name] = match
    const set = byPath.get(filePath) ?? new Set<string>()
    set.add(name)
    byPath.set(filePath, set)
  }
  return byPath
}

/**
 * Discovers related tests via a bounded import-specifier scan only (TST-B3-007/008):
 * a test file either imports a symbol-of-interest by name from a file of interest, or
 * imports a file of interest at all. A file under `tests/`/`__tests__` with neither
 * relationship is never included (TST-B3-009).
 */
function findRelatedTests(options: {
  analyses: TestFileAnalysis[]
  filesOfInterestSet: Set<string>
  symbolsByPath: Map<string, Set<string>>
}): RelatedTestMatch[] {
  const { analyses, filesOfInterestSet, symbolsByPath } = options
  const matches: RelatedTestMatch[] = []

  for (const analysis of analyses) {
    const symbolBasis = new Set<string>()
    const fileBasis = new Set<string>()
    for (const imp of analysis.resolvedImports) {
      const wantedNames = symbolsByPath.get(imp.path)
      if (wantedNames) {
        for (const name of imp.names) {
          if (wantedNames.has(name)) symbolBasis.add(`symbol:${imp.path}#${name}`)
        }
      }
      // A file-level match is also evidence in its own right (a symbol-of-interest
      // implies its containing file is of interest too, even when the caller only
      // supplied `focusSymbols`/`changedSymbols` and no `focusFiles`/`changedFiles`).
      if (filesOfInterestSet.has(imp.path) || wantedNames) fileBasis.add(imp.path)
    }
    if (symbolBasis.size > 0) {
      matches.push({ testPath: analysis.testPath, relationship: 'references-selected-production-symbol', basis: [...symbolBasis].sort() })
    } else if (fileBasis.size > 0) {
      matches.push({ testPath: analysis.testPath, relationship: 'imports-selected-production-file', basis: [...fileBasis].sort() })
    }
  }

  return rankRelatedTestMatches(matches)
}

function toEvidenceItem(options: {
  path: string
  itemKind: EvidenceItemRef['itemKind']
  relationship: string
  basis: string
  provenance: string
  metadata?: Record<string, string | number | boolean | null>
}): EvidenceItemRef {
  return {
    id: options.path,
    itemKind: options.itemKind,
    path: options.path,
    sourceLocation: { filePath: options.path },
    relationship: options.relationship,
    basis: options.basis,
    provenance: options.provenance,
    ...(options.metadata ? { metadata: options.metadata } : {}),
  }
}

/** Files imported (per the bounded import-specifier scan) by any of the given related
 * test paths, matching `predicate`. */
function importedByRelatedTests(options: {
  analyses: TestFileAnalysis[]
  relatedTestPathsSet: Set<string>
  predicate: (p: string) => boolean
}): Map<string, string[]> {
  const { analyses, relatedTestPathsSet, predicate } = options
  const matched = new Map<string, string[]>()
  for (const analysis of analyses) {
    if (!relatedTestPathsSet.has(analysis.testPath)) continue
    for (const imp of analysis.resolvedImports) {
      if (!predicate(imp.path)) continue
      const importedBy = matched.get(imp.path) ?? []
      importedBy.push(analysis.testPath)
      matched.set(imp.path, importedBy)
    }
  }
  return matched
}

const CONFIG_FILENAME_RULES: ReadonlyArray<{ pattern: RegExp; framework: string; supported: boolean }> = [
  { pattern: /^vitest\.config\.(ts|js|mjs|cjs)$/i, framework: 'vitest', supported: true },
  { pattern: /^vite\.config\.(ts|js|mjs|cjs)$/i, framework: 'vitest', supported: true },
  { pattern: /^jest\.config\.(ts|js|cjs|json)$/i, framework: 'jest', supported: false },
  { pattern: /^\.mocharc(\.json|\.ya?ml|\.js|\.cjs)?$/i, framework: 'mocha', supported: false },
  { pattern: /^pytest\.ini$/i, framework: 'pytest', supported: false },
  { pattern: /^tox\.ini$/i, framework: 'tox', supported: false },
]

function extractStringArray(source: string, key: string): string[] {
  const re = new RegExp(`${key}\\s*:\\s*\\[([^\\]]*)\\]`)
  const match = re.exec(source)
  if (!match) return []
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])
}

function extractNumber(source: string, key: string): number | undefined {
  const match = new RegExp(`${key}\\s*:\\s*(\\d+)`).exec(source)
  return match ? Number(match[1]) : undefined
}

function extractString(source: string, key: string): string | undefined {
  const match = new RegExp(`${key}\\s*:\\s*['"]([^'"]+)['"]`).exec(source)
  return match?.[1]
}

/** Bounded, regex-based Vitest config field extraction. Never evaluates the config file. */
function parseVitestConfigFields(source: string): TestConfigurationEvidenceEntry['fields'] {
  const fields: TestConfigurationEvidenceEntry['fields'] = {}
  const include = extractStringArray(source, 'include')
  const exclude = extractStringArray(source, 'exclude')
  const setupFiles = extractStringArray(source, 'setupFiles')
  const testTimeout = extractNumber(source, 'testTimeout')
  const hookTimeout = extractNumber(source, 'hookTimeout')
  const maxWorkers = extractNumber(source, 'maxWorkers')
  const environment = extractString(source, 'environment')
  if (include.length > 0) fields.include = include
  if (exclude.length > 0) fields.exclude = exclude
  if (setupFiles.length > 0) fields.setupFiles = setupFiles
  if (testTimeout !== undefined) fields.testTimeout = testTimeout
  if (hookTimeout !== undefined) fields.hookTimeout = hookTimeout
  if (maxWorkers !== undefined) fields.maxWorkers = maxWorkers
  if (environment !== undefined) fields.environment = environment
  return fields
}

function readTextIfExists(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
}

function discoverTestConfigurations(repoRoot: string): { entries: TestConfigurationEvidenceEntry[]; warnings: string[] } {
  const entries: TestConfigurationEvidenceEntry[] = []
  const warnings: string[] = []
  let dirEntries: string[]
  try {
    dirEntries = fs.readdirSync(repoRoot)
  } catch {
    return { entries, warnings }
  }

  for (const name of [...dirEntries].sort()) {
    const rule = CONFIG_FILENAME_RULES.find((r) => r.pattern.test(name))
    if (!rule) continue
    const fullPath = path.join(repoRoot, name)
    let isFile = false
    try {
      isFile = fs.statSync(fullPath).isFile()
    } catch {
      isFile = false
    }
    if (!isFile) continue

    const text = readTextIfExists(fullPath) ?? ''
    // vite.config.* only counts as a test configuration when it actually has a `test:` block.
    if (/^vite\.config\./i.test(name) && !/\btest\s*:/.test(text)) continue

    if (rule.supported) {
      entries.push({
        path: toForwardSlash(path.relative(repoRoot, fullPath)),
        framework: rule.framework,
        supported: true,
        fields: parseVitestConfigFields(text),
        warnings: [],
      })
    } else {
      const warning = `Detected a possible "${rule.framework}" test configuration at "${toForwardSlash(path.relative(repoRoot, fullPath))}", but this batch only implements Vitest configuration discovery; framework support is unresolved.`
      warnings.push(warning)
      entries.push({
        path: toForwardSlash(path.relative(repoRoot, fullPath)),
        framework: rule.framework,
        supported: false,
        fields: {},
        warnings: [warning],
      })
    }
  }

  entries.sort((a, b) => a.path.localeCompare(b.path))
  if (entries.length > 1) {
    warnings.push(
      `Multiple test-configuration files were detected (${entries.map((e) => e.path).join(', ')}); ambiguity was preserved and no configuration was arbitrarily selected as authoritative.`
    )
  }
  return { entries, warnings }
}

const RELEVANT_SCRIPT_NAME_PATTERN = /^(test|typecheck|build|verify|docs?|documentation|benchmark|security)/i

function discoverPackageScripts(pkg: { scripts?: Record<string, unknown> }, packageJsonPath: string): PackageScriptEvidenceEntry[] {
  const entries: PackageScriptEvidenceEntry[] = []
  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    if (typeof command !== 'string') continue
    if (!RELEVANT_SCRIPT_NAME_PATTERN.test(name)) continue
    entries.push({
      name,
      command,
      reason: `Script name "${name}" matches the test/verification-relevant naming convention.`,
      packageJsonPath,
    })
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  return entries
}

function detectFramework(command: string): string | null {
  if (/\bvitest\b/i.test(command)) return 'vitest'
  if (/\bjest\b/i.test(command)) return 'jest'
  if (/\bmocha\b/i.test(command)) return 'mocha'
  if (/\bpytest\b/i.test(command)) return 'pytest'
  return null
}

const VITEST_RUN_COMMAND_PATTERN = /^(npx\s+)?vitest\s+run\b/i

function deriveTestCommands(options: {
  role: ContextRole | null
  packageScripts: PackageScriptEvidenceEntry[]
  relatedTestPaths: string[]
}): { commands: TestCommandEvidenceEntry[]; unresolved: UnresolvedEvidenceItem[] } {
  const { role, packageScripts, relatedTestPaths } = options
  const commands: TestCommandEvidenceEntry[] = []
  const unresolved: UnresolvedEvidenceItem[] = []

  const testScript = packageScripts.find((s) => s.name === 'test')
  if (!testScript) {
    unresolved.push({
      evidenceKind: 'test-commands',
      role,
      basis: 'package.json scripts',
      reason: 'No package.json "test" script was found; a targeted test command cannot be derived.',
      blocking: false,
    })
    return { commands, unresolved }
  }

  commands.push({
    commandText: testScript.command,
    commandSource: `package.json script "${testScript.name}"`,
    testFiles: [],
    framework: detectFramework(testScript.command),
    scope: 'full-project',
    basis: `Verbatim package.json "${testScript.name}" script.`,
  })

  if (relatedTestPaths.length === 0) {
    unresolved.push({
      evidenceKind: 'test-commands',
      role,
      basis: 'related-test discovery',
      reason: 'No related test file was discovered for the selected/changed production evidence; a targeted (file-scoped) test command cannot be derived.',
      blocking: false,
    })
    return { commands, unresolved }
  }

  if (VITEST_RUN_COMMAND_PATTERN.test(testScript.command)) {
    const files = [...relatedTestPaths].sort()
    commands.push({
      commandText: `${testScript.command} ${files.join(' ')}`,
      commandSource: `package.json script "${testScript.name}" + discovered related test file(s)`,
      testFiles: files,
      framework: 'vitest',
      scope: files.length === 1 ? 'file' : 'suite',
      basis: 'Related test file(s) discovered via graph import/call edges from the selected/changed production evidence.',
    })
  } else {
    unresolved.push({
      evidenceKind: 'test-commands',
      role,
      basis: `package.json script "${testScript.name}": "${testScript.command}"`,
      reason: 'The package.json "test" script does not match a supported runner invocation pattern ("vitest run"); a targeted test command was not invented.',
      blocking: false,
    })
  }

  return { commands, unresolved }
}

export function discoverTestInfrastructure(options: DiscoverTestInfrastructureOptions): DiscoverTestInfrastructureResult {
  const { role, symbolIndex, filesOfInterest, symbolsOfInterest, repoRoot } = options
  const limits = { ...DEFAULT_TEST_INFRA_LIMITS, ...(options.limits ?? {}) }
  const warnings: string[] = []
  const unresolved: UnresolvedEvidenceItem[] = []

  const filesOfInterestSet = new Set(filesOfInterest)
  const knownPaths = new Set(symbolIndex.files.map((f) => f.path))
  const analyses = analyzeTestShapedFiles({ repoRoot, sourceRoots: symbolIndex.sourceRoots, knownPaths })

  const relatedMatches = findRelatedTests({ analyses, filesOfInterestSet, symbolsByPath: symbolsOfInterestByPath(symbolsOfInterest) })
  const relatedTestItems = relatedMatches.map((m) =>
    toEvidenceItem({
      path: m.testPath,
      itemKind: 'test-file',
      relationship: m.relationship,
      basis: m.basis.join(', '),
      provenance: m.relationship === 'references-selected-production-symbol' ? 'import-specifier-scan:named-import' : 'import-specifier-scan:import',
    })
  )
  const relatedTests = bound(relatedTestItems, limits.relatedTests)
  const relatedTestPaths = relatedMatches.map((m) => m.testPath)
  const relatedTestPathsSet = new Set(relatedTestPaths)

  if (relatedTests.items.length === 0) {
    unresolved.push({
      evidenceKind: 'related-tests',
      role,
      basis: `${filesOfInterest.length} file(s) / ${symbolsOfInterest.length} symbol(s) of interest`,
      reason: 'No existing test file could be linked to the selected/changed production evidence via import or call graph edges.',
      blocking: false,
    })
  }

  const fixtureMatches = importedByRelatedTests({ analyses, relatedTestPathsSet, predicate: isFixtureLike })
  const fixtureItems = [...fixtureMatches.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, importedBy]) =>
      toEvidenceItem({
        path: p,
        itemKind: 'fixture',
        relationship: 'imported-by-related-test',
        basis: `imported by: ${[...importedBy].sort().join(', ')}`,
        provenance: 'graph-edge:imports',
      })
    )
  const fixtures = bound(fixtureItems, limits.fixtures)
  if (fixtures.items.length === 0 && relatedTests.items.length > 0) {
    unresolved.push({
      evidenceKind: 'fixtures',
      role,
      basis: `${relatedTests.items.length} related test file(s)`,
      reason: 'No fixture file imported by a related test was found.',
      blocking: false,
    })
  }

  const factoryMatches = importedByRelatedTests({ analyses, relatedTestPathsSet, predicate: isFactoryLike })
  const factoryItems = [...factoryMatches.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, importedBy]) =>
      toEvidenceItem({
        path: p,
        itemKind: 'factory',
        relationship: 'imported-by-related-test',
        basis: `imported by: ${[...importedBy].sort().join(', ')}`,
        provenance: 'graph-edge:imports',
      })
    )
  const factories = bound(factoryItems, limits.factories)

  const mockMatches = importedByRelatedTests({ analyses, relatedTestPathsSet, predicate: isMockLike })
  const mockItems = [...mockMatches.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, importedBy]) =>
      toEvidenceItem({
        path: p,
        itemKind: 'mock',
        relationship: 'imported-by-related-test',
        basis: `imported by: ${[...importedBy].sort().join(', ')}`,
        provenance: 'graph-edge:imports',
      })
    )
  const mocks = bound(mockItems, limits.mocks)

  const { entries: testConfigurationEntries, warnings: configWarnings } = discoverTestConfigurations(repoRoot)
  warnings.push(...configWarnings)
  const testConfigurations = bound(testConfigurationEntries, limits.testConfigurations)
  for (const entry of testConfigurationEntries) {
    if (!entry.supported) {
      unresolved.push({
        evidenceKind: 'test-configuration',
        role,
        basis: entry.path,
        reason: `"${entry.framework}" configuration was detected but is not a supported discovery framework in this batch.`,
        blocking: false,
      })
    }
  }
  if (testConfigurationEntries.length === 0) {
    unresolved.push({
      evidenceKind: 'test-configuration',
      role,
      basis: toForwardSlash(repoRoot),
      reason: 'No supported test configuration file was found at the project root.',
      blocking: false,
    })
  }

  const supportedConfig = testConfigurationEntries.find((e) => e.supported && Array.isArray(e.fields.setupFiles))
  const setupFilePaths = new Set<string>()
  if (supportedConfig) {
    const configDir = path.dirname(path.join(repoRoot, supportedConfig.path))
    for (const raw of (supportedConfig.fields.setupFiles as string[]) ?? []) {
      const resolved = toForwardSlash(path.relative(repoRoot, path.resolve(configDir, raw)))
      if (symbolIndex.files.some((f) => f.path === resolved)) setupFilePaths.add(resolved)
      else setupFilePaths.add(resolved) // still record; discovery does not require it to already be indexed
    }
  }
  let setupItems = [...setupFilePaths].sort().map((p) =>
    toEvidenceItem({
      path: p,
      itemKind: 'setup-file',
      relationship: 'configured-in-test-configuration',
      basis: supportedConfig ? `setupFiles entry in ${supportedConfig.path}` : 'configured setup file',
      provenance: supportedConfig ? `vitest-config:${supportedConfig.path}` : 'vitest-config',
    })
  )
  // Fallback (section 15: "imports from test files"): when the test configuration does not
  // declare setupFiles explicitly, fall back to setup-shaped files imported by a related test.
  if (setupItems.length === 0) {
    const setupMatches = importedByRelatedTests({ analyses, relatedTestPathsSet, predicate: isSetupLike })
    setupItems = [...setupMatches.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([p, importedBy]) =>
        toEvidenceItem({
          path: p,
          itemKind: 'setup-file',
          relationship: 'imported-by-related-test',
          basis: `imported by: ${[...importedBy].sort().join(', ')}`,
          provenance: 'graph-edge:imports',
        })
      )
  }
  const setupFiles = bound(setupItems, limits.setupFiles)
  if (setupFiles.items.length === 0) {
    unresolved.push({
      evidenceKind: 'setup-files',
      role,
      basis: supportedConfig ? supportedConfig.path : 'test configuration',
      reason: 'No configured setup file was found in the discovered test configuration.',
      blocking: false,
    })
  }

  const packageJsonPath = path.join(repoRoot, 'package.json')
  const packageJsonText = readTextIfExists(packageJsonPath)
  let packageScriptEntries: PackageScriptEvidenceEntry[] = []
  if (packageJsonText === null) {
    unresolved.push({
      evidenceKind: 'package-scripts',
      role,
      basis: toForwardSlash(packageJsonPath),
      reason: 'No package.json was found at the project root; package scripts could not be inspected.',
      blocking: false,
    })
  } else {
    try {
      const pkg = JSON.parse(packageJsonText) as { scripts?: Record<string, unknown> }
      packageScriptEntries = discoverPackageScripts(pkg, toForwardSlash(path.relative(repoRoot, packageJsonPath) || 'package.json'))
    } catch (error) {
      warnings.push(`Failed to parse package.json at "${toForwardSlash(packageJsonPath)}": ${(error as Error).message}`)
    }
  }
  const packageScripts = bound(packageScriptEntries, limits.packageScripts)

  const { commands, unresolved: commandUnresolved } = deriveTestCommands({
    role,
    packageScripts: packageScriptEntries,
    relatedTestPaths,
  })
  unresolved.push(...commandUnresolved)
  const testCommands = bound(commands, limits.testCommands)

  return {
    relatedTests,
    fixtures,
    factories,
    mocks,
    setupFiles,
    testConfigurations,
    packageScripts,
    testCommands,
    unresolved,
    warnings,
  }
}
