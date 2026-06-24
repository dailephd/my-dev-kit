import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { runFrontendAnalyzer } from '../../src/frontend/frontendAnalyzer.js'
import type { FrontendSemanticArtifact } from '../../src/frontend/index.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'

export interface FixtureFile {
  path: string
  content: string
}

export interface BuiltFrontendFixture {
  repoRoot: string
  artifact: FrontendSemanticArtifact
}

const tracked: string[] = []

export function makeReachabilityTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-reach-fx-'))
  tracked.push(dir)
  return dir
}

export function cleanupReachabilityTempDirs(): void {
  while (tracked.length > 0) {
    const dir = tracked.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
}

function stubSymbolIndex(repoRoot: string, files: FixtureFile[]): SymbolIndex {
  return {
    schemaVersion: '2',
    buildTime: new Date().toISOString(),
    repoRoot,
    sourceRoots: ['src'],
    fileCount: files.length,
    symbolCount: 0,
    files: files.map((f) => ({
      path: f.path,
      language: 'typescript' as const,
      lineCount: f.content.split('\n').length,
      imports: [],
      exports: [],
      symbols: [],
      hasCallGraphEntries: false,
    })),
  }
}

/** Writes fixture files to a temp dir and runs the frontend analyzer over them. */
export function buildFrontendFixture(files: FixtureFile[]): BuiltFrontendFixture {
  const repoRoot = makeReachabilityTempDir()
  for (const file of files) {
    const abs = join(repoRoot, file.path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, file.content, 'utf8')
  }
  const result = runFrontendAnalyzer({
    symbolIndex: stubSymbolIndex(repoRoot, files),
    repoRoot,
    createdAt: '2026-01-01T00:00:00.000Z',
  })
  return { repoRoot, artifact: result.artifact }
}
