import * as fs from 'node:fs'
import * as path from 'node:path'
import { toForwardSlash } from '../io/pathUtils.js'
import { createDefaultRegistry, type LanguageRegistry } from '../languages/registry.js'

export const DEFAULT_IGNORED_DIRECTORY_NAMES = [
  'node_modules',
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
] as const

const DEFAULT_FILE_EXCLUDE_PATTERNS = ['.d.ts', '.test.', '.spec.']
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
      defaultIgnoredDirectoryNames: [...DEFAULT_IGNORED_DIRECTORY_NAMES],
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
    },
  }

  emitProgress(state, 'scan-start', 'Scanning source roots')
  for (const root of options.sourceRoots) {
    emitProgress(state, 'scan-source-root', `Scanning ${root}`, root)
    collectFiles(path.resolve(options.repoRoot, root), state, root)
  }
  emitProgress(state, 'scan-complete', 'Source scan completed')

  state.result.largestFiles.sort((a, b) => b.sizeBytes - a.sizeBytes)
  return state.result
}

function collectFiles(dir: string, state: DiscoveryState, currentSourceRoot: string): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
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
      if (state.defaultIgnoredDirectoryNames.has(entry.name.toLowerCase())) {
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
      continue
    }

    if (shouldExcludeByFilePattern(relPath)) {
      recordSkipped(state, relPath, 'file-pattern')
      continue
    }

    if (!state.registry.supportsFile(entry.name)) {
      recordSkipped(state, relPath, 'unsupported')
      continue
    }

    state.result.files.push({ relPath, absPath, sizeBytes: stat.size })
    state.result.totalFilesEligibleForIndexing += 1
    incrementLanguageCount(state.result.languageCounts, relPath)
    pushSample(state.result.sampleIndexedFiles, relPath)
    trackLargestFile(state.result.largestFiles, { path: relPath, sizeBytes: stat.size })
    maybeEmitProgress(state, currentSourceRoot)
  }
}

function recordSkipped(
  state: DiscoveryState,
  relPath: string,
  reason: SkippedPathSample['reason']
): void {
  state.result.totalFilesSkipped += 1
  if (reason === 'default-ignore') state.result.skippedByDefaultIgnore += 1
  if (reason === 'user-exclude') state.result.skippedByUserExclude += 1
  if (reason === 'file-pattern') state.result.skippedByFilePattern += 1
  if (reason === 'unsupported') state.result.skippedUnsupportedFiles += 1
  pushSample(state.result.sampleSkippedFiles, { path: relPath, reason })
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

function incrementLanguageCount(languageCounts: Record<string, number>, relPath: string): void {
  const ext = path.extname(relPath).toLowerCase()
  const language =
    ext === '.py' ? 'python' :
    ext === '.ts' || ext === '.tsx' ? 'typescript' :
    ext === '.js' || ext === '.jsx' ? 'javascript' :
    'unknown'
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
