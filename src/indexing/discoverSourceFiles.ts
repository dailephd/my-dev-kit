import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { TextDecoder } from 'node:util'
import { toForwardSlash } from '../io/pathUtils.js'
import { createDefaultRegistry, type LanguageRegistry } from '../languages/registry.js'
import { readSourceBytes } from '../lookup/getSourceSlice.js'
import { AUDIT_CONTENT_MAX_BYTES } from '../symbol-index/auditEvidenceTypes.js'

export const DEFAULT_IGNORED_DIRECTORY_NAMES = [
  'node_modules',
  'target',
  '.next',
  'dist',
  'build',
  'coverage',
  'playwright-report',
  'test-results',
  'output',
  'out',
  '.cache',
  '.turbo',
  '.vercel',
  '.git',
  '.pytest_cache',
  '__pycache__',
  '.venv',
  'venv',
  '.my-dev-kit',
  '.gradle',
] as const

/**
 * Directory name prefixes ignored by default, in addition to the exact
 * names in DEFAULT_IGNORED_DIRECTORY_NAMES. Covers custom/smoke output
 * directories such as `.my-dev-kit-web` or `.my-dev-kit-dry-run-smoke`.
 */
export const DEFAULT_IGNORED_DIRECTORY_PREFIXES = ['.my-dev-kit-'] as const

/**
 * Filename patterns excluded from core indexing by default. Only declaration
 * files are excluded: supported `.test.`/`.spec.` files beneath an explicitly
 * selected source root are ordinary indexed files (v1.12.4). Part of the
 * incremental-cache configuration fingerprint so a cache built under a
 * different exclusion policy is never reused as equivalent.
 */
export const DEFAULT_FILE_EXCLUDE_PATTERNS = ['.d.ts'] as const
const SAMPLE_LIMIT = 20
const LARGEST_FILE_LIMIT = 10

export interface SourceFileDiscoveryOptions {
  repoRoot: string
  sourceRoots: string[]
  userExcludes?: string[]
  registry?: LanguageRegistry
  onProgress?: (event: SourceDiscoveryProgressEvent) => void
}

export interface SourceDiscoveryProgressEvent {
  phase: 'scan-start' | 'scan-source-root' | 'scan-progress' | 'scan-complete'
  message: string
  elapsedMs: number
  currentSourceRoot?: string
  filesDiscovered: number
  filesEligible: number
  filesSkipped: number
}

export interface DiscoveredSourceFile {
  relPath: string
  absPath: string
  sizeBytes: number
}

export interface SkippedPathSample {
  path: string
  reason: 'default-ignore' | 'user-exclude' | 'file-pattern' | 'unsupported'
}

export interface LargestFileSample {
  path: string
  sizeBytes: number
}

/** How a selected regular file was classified during discovery (v1.15.0 audit ledger). */
export type AuditSelectionStatus =
  | 'supported'
  | 'unsupported'
  | 'unreadable'

/** One selected regular file after configured exclusions, including unsupported and unreadable files. */
export interface AuditSelectedFile {
  relPath: string
  absPath: string
  sizeBytes: number | null
  selectionStatus: AuditSelectionStatus
  /** Raw content identity only; never makes an unsupported file a semantic indexing input. */
  contentSha256?: string
}

/** Narrow raw test-input eligibility, separate from the programming-language registry. */
export function isAuditJsonContentPath(relPath: string): boolean {
  const segments = toForwardSlash(relPath).split('/').map(segment => segment.toLowerCase())
  const basename = segments.pop() ?? ''
  if (!basename.endsWith('.json') || ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'tsconfig.json', 'jsconfig.json'].includes(basename) || basename.endsWith('.lock.json')) return false
  if (segments.some(segment => segment === 'generated' || segment === 'vendor' ||
    (DEFAULT_IGNORED_DIRECTORY_NAMES as readonly string[]).includes(segment) ||
    DEFAULT_IGNORED_DIRECTORY_PREFIXES.some(prefix => segment.startsWith(prefix)))) return false
  return segments.some(segment => ['test', 'tests', '__tests__', 'fixtures'].includes(segment))
}

/**
 * Additive audit ledger populated during the single discovery traversal.
 * `excludedPathCount` counts unique excluded path entries actually observed
 * (an excluded directory counts once; its contents are never scanned).
 */
export interface AuditSelectionLedger {
  selectedFiles: AuditSelectedFile[]
  excludedPathCount: number
  inaccessibleDirectoryCount: number
  incompleteReasons: string[]
}

export interface SourceDiscoveryResult {
  files: DiscoveredSourceFile[]
  defaultIgnoredDirectoryNames: string[]
  userExcludes: string[]
  totalFilesDiscovered: number
  totalFilesEligibleForIndexing: number
  totalFilesSkipped: number
  skippedByDefaultIgnore: number
  skippedByUserExclude: number
  skippedByFilePattern: number
  skippedUnsupportedFiles: number
  languageCounts: Record<string, number>
  largestFiles: LargestFileSample[]
  sampleIndexedFiles: string[]
  sampleSkippedFiles: SkippedPathSample[]
  auditSelection: AuditSelectionLedger
}

interface DiscoveryState {
  repoRoot: string
  registry: LanguageRegistry
  defaultIgnoredDirectoryNames: Set<string>
  userExcludeRules: ExcludeRule[]
  userExcludes: string[]
  startTime: number
  lastProgressTime: number
  onProgress?: (event: SourceDiscoveryProgressEvent) => void
  result: SourceDiscoveryResult
  selectedByPath: Map<string, AuditSelectedFile>
  excludedPaths: Set<string>
  incompleteReasons: Set<string>
}

interface ExcludeRule {
  normalized: string
  isPath: boolean
}

export function discoverSourceFiles(options: SourceFileDiscoveryOptions): SourceDiscoveryResult {
  const registry = options.registry ?? createDefaultRegistry()
  const state: DiscoveryState = {
    repoRoot: options.repoRoot,
    registry,
    defaultIgnoredDirectoryNames: new Set(DEFAULT_IGNORED_DIRECTORY_NAMES.map((name) => name.toLowerCase())),
    userExcludeRules: normalizeExcludeRules(options.userExcludes ?? []),
    userExcludes: (options.userExcludes ?? []).map(normalizePathInput),
    startTime: Date.now(),
    lastProgressTime: 0,
    onProgress: options.onProgress,
    result: {
      files: [],
      defaultIgnoredDirectoryNames: [
        ...DEFAULT_IGNORED_DIRECTORY_NAMES,
        ...DEFAULT_IGNORED_DIRECTORY_PREFIXES.map((prefix) => `${prefix}*`),
      ],
      userExcludes: (options.userExcludes ?? []).map(normalizePathInput),
      totalFilesDiscovered: 0,
      totalFilesEligibleForIndexing: 0,
      totalFilesSkipped: 0,
      skippedByDefaultIgnore: 0,
      skippedByUserExclude: 0,
      skippedByFilePattern: 0,
      skippedUnsupportedFiles: 0,
      languageCounts: {},
      largestFiles: [],
      sampleIndexedFiles: [],
      sampleSkippedFiles: [],
      auditSelection: {
        selectedFiles: [],
        excludedPathCount: 0,
        inaccessibleDirectoryCount: 0,
        incompleteReasons: [],
      },
    },
    selectedByPath: new Map(),
    excludedPaths: new Set(),
    incompleteReasons: new Set(),
  }

  emitProgress(state, 'scan-start', 'Scanning source roots')
  for (const root of options.sourceRoots) {
    emitProgress(state, 'scan-source-root', `Scanning ${root}`, root)
    collectFiles(path.resolve(options.repoRoot, root), state, root)
  }
  emitProgress(state, 'scan-complete', 'Source scan completed')

  state.result.largestFiles.sort((a, b) => b.sizeBytes - a.sizeBytes)
  finalizeAuditSelection(state)
  return state.result
}

function collectFiles(dir: string, state: DiscoveryState, currentSourceRoot: string): void {
  const relativeDir = toForwardSlash(path.relative(state.repoRoot, dir))
  if (relativeDir.split('/').some(segment => segment.toLowerCase() === 'target')) {
    recordSkipped(state, relativeDir, 'default-ignore')
    return
  }
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    // The subtree is unreadable: never report it as covered.
    state.result.auditSelection.inaccessibleDirectoryCount += 1
    state.incompleteReasons.add('directory-enumeration-failed')
    return
  }

  for (const entry of entries) {
    const absPath = path.join(dir, entry.name)
    const relPath = toForwardSlash(path.relative(state.repoRoot, absPath))

    if (entry.isDirectory()) {
      const userExclude = matchesUserExclude(relPath, entry.name, state.userExcludeRules)
      if (userExclude) {
        recordSkipped(state, relPath, 'user-exclude')
        continue
      }
      if (isDefaultIgnoredDirectory(entry.name, state.defaultIgnoredDirectoryNames)) {
        recordSkipped(state, relPath, 'default-ignore')
        continue
      }
      collectFiles(absPath, state, currentSourceRoot)
      continue
    }

    if (!entry.isFile()) continue

    const userExclude = matchesUserExclude(relPath, entry.name, state.userExcludeRules)
    if (userExclude) {
      recordSkipped(state, relPath, 'user-exclude')
      continue
    }

    state.result.totalFilesDiscovered += 1

    let stat: fs.Stats
    try {
      stat = fs.statSync(absPath)
    } catch {
      // Existing behavior is unchanged for counters; the audit ledger keeps the
      // known path as unreadable so it can never silently disappear.
      if (shouldExcludeByFilePattern(relPath)) state.excludedPaths.add(relPath)
      else recordSelected(state, { relPath, absPath, sizeBytes: null, selectionStatus: 'unreadable' })
      continue
    }

    if (shouldExcludeByFilePattern(relPath)) {
      recordSkipped(state, relPath, 'file-pattern')
      continue
    }

    if (!state.registry.supportsFile(entry.name)) {
      recordSkipped(state, relPath, 'unsupported')
      let contentSha256: string | undefined
      if (isAuditJsonContentPath(relPath) && stat.size <= AUDIT_CONTENT_MAX_BYTES) {
        try {
          const bytes = readSourceBytes(state.repoRoot, relPath, AUDIT_CONTENT_MAX_BYTES)
          // Fatal decoding rejects invalid UTF-8 instead of authenticating replacement-character text.
          new TextDecoder('utf-8', { fatal: true }).decode(bytes)
          if (!bytes.includes(0) && bytes.length === stat.size) contentSha256 = createHash('sha256').update(bytes).digest('hex')
        } catch {
          // Keep the selected unsupported record without a hash; absence can never be complete.
        }
      }
      recordSelected(state, { relPath, absPath, sizeBytes: stat.size, selectionStatus: 'unsupported', contentSha256 })
      continue
    }

    recordSelected(state, { relPath, absPath, sizeBytes: stat.size, selectionStatus: 'supported' })
    state.result.files.push({ relPath, absPath, sizeBytes: stat.size })
    state.result.totalFilesEligibleForIndexing += 1
    incrementLanguageCount(state.result.languageCounts, relPath)
    pushSample(state.result.sampleIndexedFiles, relPath)
    trackLargestFile(state.result.largestFiles, { path: relPath, sizeBytes: stat.size })
    maybeEmitProgress(state, currentSourceRoot)
  }
}

function isDefaultIgnoredDirectory(name: string, exactNames: Set<string>): boolean {
  const lowerName = name.toLowerCase()
  if (exactNames.has(lowerName)) return true
  return DEFAULT_IGNORED_DIRECTORY_PREFIXES.some((prefix) => lowerName.startsWith(prefix))
}

function recordSkipped(
  state: DiscoveryState,
  relPath: string,
  reason: SkippedPathSample['reason']
): void {
  state.result.totalFilesSkipped += 1
  if (reason !== 'unsupported') state.excludedPaths.add(relPath)
  if (reason === 'default-ignore') state.result.skippedByDefaultIgnore += 1
  if (reason === 'user-exclude') state.result.skippedByUserExclude += 1
  if (reason === 'file-pattern') state.result.skippedByFilePattern += 1
  if (reason === 'unsupported') state.result.skippedUnsupportedFiles += 1
  pushSample(state.result.sampleSkippedFiles, { path: relPath, reason })
}

/** Records a selected file once per canonical relative path; a conflicting re-observation marks the ledger incomplete. */
function recordSelected(state: DiscoveryState, file: AuditSelectedFile): void {
  const existing = state.selectedByPath.get(file.relPath)
  if (!existing) {
    state.selectedByPath.set(file.relPath, file)
    return
  }
  if (existing.selectionStatus !== file.selectionStatus || existing.sizeBytes !== file.sizeBytes || existing.contentSha256 !== file.contentSha256) {
    state.incompleteReasons.add('conflicting-selection-identity')
  }
}

function finalizeAuditSelection(state: DiscoveryState): void {
  const ledger = state.result.auditSelection
  ledger.selectedFiles = [...state.selectedByPath.values()].sort((a, b) =>
    a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0
  )
  ledger.excludedPathCount = state.excludedPaths.size
  ledger.incompleteReasons = [...state.incompleteReasons].sort()
}

function shouldExcludeByFilePattern(relPath: string): boolean {
  return DEFAULT_FILE_EXCLUDE_PATTERNS.some((pattern) => relPath.includes(pattern))
}

function normalizeExcludeRules(values: string[]): ExcludeRule[] {
  return values
    .map(normalizePathInput)
    .filter((value) => value.length > 0)
    .map((value) => ({
      normalized: value,
      isPath: value.includes('/'),
    }))
}

function normalizePathInput(value: string): string {
  return toForwardSlash(value.trim()).replace(/^\/+|\/+$/g, '')
}

function matchesUserExclude(relPath: string, basename: string, rules: ExcludeRule[]): boolean {
  const normalizedRelPath = normalizePathInput(relPath)
  const segments = normalizedRelPath.split('/')
  return rules.some((rule) => {
    if (rule.isPath) {
      return normalizedRelPath === rule.normalized || normalizedRelPath.startsWith(`${rule.normalized}/`)
    }
    return basename === rule.normalized || segments.includes(rule.normalized)
  })
}

/** Language name for a path by extension; 'unknown' when the extension has no registered language family. */
export function languageNameForPath(relPath: string): string {
  const ext = path.extname(relPath).toLowerCase()
  return (
    ext === '.py' ? 'python' :
    ext === '.ts' || ext === '.tsx' ? 'typescript' :
    ext === '.js' || ext === '.jsx' ? 'javascript' :
    ext === '.kt' ? 'kotlin' :
    ext === '.java' ? 'java' :
    ext === '.rs' ? 'rust' :
    'unknown'
  )
}

function incrementLanguageCount(languageCounts: Record<string, number>, relPath: string): void {
  const language = languageNameForPath(relPath)
  languageCounts[language] = (languageCounts[language] ?? 0) + 1
}

function pushSample<T>(samples: T[], sample: T): void {
  if (samples.length < SAMPLE_LIMIT) samples.push(sample)
}

function trackLargestFile(samples: LargestFileSample[], sample: LargestFileSample): void {
  samples.push(sample)
  samples.sort((a, b) => b.sizeBytes - a.sizeBytes)
  if (samples.length > LARGEST_FILE_LIMIT) samples.pop()
}

function maybeEmitProgress(state: DiscoveryState, currentSourceRoot: string): void {
  const now = Date.now()
  if (now - state.lastProgressTime < 1000) return
  state.lastProgressTime = now
  emitProgress(state, 'scan-progress', 'Scanning source files', currentSourceRoot)
}

function emitProgress(
  state: DiscoveryState,
  phase: SourceDiscoveryProgressEvent['phase'],
  message: string,
  currentSourceRoot?: string
): void {
  if (!state.onProgress) return
  state.onProgress({
    phase,
    message,
    currentSourceRoot,
    elapsedMs: Date.now() - state.startTime,
    filesDiscovered: state.result.totalFilesDiscovered,
    filesEligible: state.result.totalFilesEligibleForIndexing,
    filesSkipped: state.result.totalFilesSkipped,
  })
}
