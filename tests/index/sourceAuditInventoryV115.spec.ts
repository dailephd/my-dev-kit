import { createHash } from 'node:crypto'
import fs, {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildSourceAuditEvidence,
  SOURCE_AUDIT_EXTRACTOR_CONTRACT_REVISION,
  type BuildSourceAuditEvidenceInput,
} from '../../src/indexing/buildSourceAuditEvidence.js'
import { discoverSourceFiles, type SourceDiscoveryResult } from '../../src/indexing/discoverSourceFiles.js'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { SOURCE_AUDIT_CAPABILITIES } from '../../src/symbol-index/auditEvidenceTypes.js'
import { validateSourceAuditEvidence } from '../../src/symbol-index/validateAuditEvidence.js'
import { SCHEMA_VERSION } from '../../src/symbol-index/types.js'
import type { FileSummary, SymbolIndex } from '../../src/symbol-index/types.js'

const tempDirs: string[] = []
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

afterEach(() => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  while (tempDirs.length > 0) rmSync(tempDirs.pop() as string, { recursive: true, force: true })
})

function makeProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v115-audit-'))
  tempDirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function project(
  root: string,
  opts: { sourceRoots?: string[]; excludes?: string[]; projectRoot?: string; producerVersion?: string } = {},
) {
  const sourceRoots = opts.sourceRoots ?? ['src']
  const built = buildIndex({ repoRoot: root, sourceRoots, excludePatterns: opts.excludes })
  const input: BuildSourceAuditEvidenceInput = {
    projectRoot: opts.projectRoot ?? root,
    sourceRoots,
    excludes: opts.excludes ?? [],
    discovery: built.discovery,
    symbolIndex: built.index,
    fileHashes: built.fileContentHashes,
    producerVersion: opts.producerVersion ?? '1.14.0',
  }
  return { built, input, result: buildSourceAuditEvidence(input) }
}

function summary(path: string, extra: Partial<FileSummary> = {}): FileSummary {
  return { path, language: 'typescript', lineCount: 3, imports: [], exports: [], symbols: [], hasCallGraphEntries: false, ...extra } as FileSummary
}

function fakeDiscovery(overrides: Partial<SourceDiscoveryResult['auditSelection']> & { selected?: SourceDiscoveryResult['auditSelection']['selectedFiles'] } = {}): SourceDiscoveryResult {
  const { selected, ...ledger } = overrides
  return {
    files: [],
    defaultIgnoredDirectoryNames: ['node_modules'],
    userExcludes: [],
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
      selectedFiles: selected ?? [],
      excludedPathCount: 0,
      inaccessibleDirectoryCount: 0,
      incompleteReasons: [],
      ...ledger,
    },
  }
}

function fakeIndex(files: FileSummary[]): SymbolIndex {
  return { schemaVersion: SCHEMA_VERSION, buildTime: 't', repoRoot: '/r', sourceRoots: ['src'], fileCount: files.length, symbolCount: 0, files } as unknown as SymbolIndex
}

function pure(overrides: Partial<BuildSourceAuditEvidenceInput> = {}) {
  const input: BuildSourceAuditEvidenceInput = {
    projectRoot: '/r',
    sourceRoots: ['src'],
    excludes: [],
    discovery: fakeDiscovery(),
    symbolIndex: fakeIndex([]),
    fileHashes: new Map(),
    producerVersion: '1.14.0',
    ...overrides,
  }
  return buildSourceAuditEvidence(input)
}

describe('v1.15.0 Batch 1 discovery ledger', () => {
  const layout = {
    'src/a.ts': 'export const a = 1\n',
    'src/b.py': 'def b():\n    return 1\n',
    'src/notes.md': '# notes\n',
    'src/types.d.ts': 'export declare const t: number\n',
    'src/node_modules/dep/index.ts': 'export const d = 1\n',
    'src/node_modules/dep/two.ts': 'export const e = 1\n',
    'src/skip/y.ts': 'export const y = 1\n',
  }

  it('records supported, unsupported and excluded entries while preserving existing discovery fields', () => {
    const root = makeProject(layout)
    const result = discoverSourceFiles({ repoRoot: root, sourceRoots: ['src'], userExcludes: ['skip'] })
    expect(result.files.map((f) => f.relPath).sort()).toEqual(['src/a.ts', 'src/b.py'])
    expect(result.skippedUnsupportedFiles).toBe(1)
    expect(result.skippedByFilePattern).toBe(1)
    expect(result.skippedByDefaultIgnore).toBe(1)
    expect(result.skippedByUserExclude).toBe(1)
    expect(result.totalFilesEligibleForIndexing).toBe(2)

    const ledger = result.auditSelection
    expect(ledger.selectedFiles.map((f) => [f.relPath, f.selectionStatus])).toEqual([
      ['src/a.ts', 'supported'],
      ['src/b.py', 'supported'],
      ['src/notes.md', 'unsupported'],
    ])
    expect(ledger.selectedFiles.every((f) => f.absPath.length > 0 && typeof f.sizeBytes === 'number')).toBe(true)
    // node_modules (once, not its two descendants), the user-excluded directory and the .d.ts file.
    expect(ledger.excludedPathCount).toBe(3)
    expect(ledger.inaccessibleDirectoryCount).toBe(0)
    expect(ledger.incompleteReasons).toEqual([])
  })

  it('deduplicates overlapping source roots by canonical path and keeps stable ordering', () => {
    const root = makeProject({ 'src/z.ts': 'export const z = 1\n', 'src/sub/a.ts': 'export const a = 1\n', 'src/m.txt': 'x' })
    const forward = discoverSourceFiles({ repoRoot: root, sourceRoots: ['src', 'src/sub'] })
    const reverse = discoverSourceFiles({ repoRoot: root, sourceRoots: ['src/sub', 'src'] })
    // Existing extraction input is untouched (overlap still visible there)...
    expect(forward.files.filter((f) => f.relPath === 'src/sub/a.ts')).toHaveLength(2)
    // ...but the audit ledger represents each path once, in canonical order.
    const paths = forward.auditSelection.selectedFiles.map((f) => f.relPath)
    expect(paths).toEqual(['src/m.txt', 'src/sub/a.ts', 'src/z.ts'])
    expect(reverse.auditSelection.selectedFiles.map((f) => f.relPath)).toEqual(paths)
  })

  it('reports a directory traversal failure as incomplete coverage instead of an empty discovery', () => {
    const root = makeProject({ 'src/a.ts': 'export const a = 1\n' })
    const result = discoverSourceFiles({ repoRoot: root, sourceRoots: ['src', 'missing-root'] })
    expect(result.auditSelection.inaccessibleDirectoryCount).toBe(1)
    expect(result.auditSelection.incompleteReasons).toContain('directory-enumeration-failed')
    expect(result.files.map((f) => f.relPath)).toEqual(['src/a.ts'])

    const { result: evidence } = project(root, { sourceRoots: ['src', 'missing-root'] })
    expect(evidence.artifact.coverage.inventoryComplete).toBe(false)
    expect(evidence.artifact.coverage.exclusionsAreExplicit).toBe(false)
    expect(evidence.incompleteReasons).toContain('directory-enumeration-failed')
    expect(() => validateSourceAuditEvidence(evidence.artifact)).not.toThrow()
  })

  it('does not follow symlinked or junctioned directories to discover additional targets', () => {
    const outside = makeProject({ 'secret/escape.ts': 'export const s = 1\n' })
    const root = makeProject({ 'src/a.ts': 'export const a = 1\n' })
    try {
      symlinkSync(join(outside, 'secret'), join(root, 'src', 'linked'), 'junction')
    } catch {
      return // Link creation is not permitted in this environment; nothing to contain.
    }
    expect(existsSync(join(root, 'src', 'linked', 'escape.ts'))).toBe(true)
    const result = discoverSourceFiles({ repoRoot: root, sourceRoots: ['src'] })
    expect(result.auditSelection.selectedFiles.map((f) => f.relPath)).toEqual(['src/a.ts'])
    expect(result.files.map((f) => f.relPath)).toEqual(['src/a.ts'])
  })

  it('keeps a selected file whose stat fails as unreadable instead of dropping it', () => {
    const root = makeProject({ 'src/a.ts': 'export const a = 1\n', 'src/b.ts': 'export const b = 1\n' })
    const realStat = fs.statSync
    vi.spyOn(fs, 'statSync').mockImplementation(((p: unknown, ...rest: unknown[]) => {
      if (String(p).replace(/\\/g, '/').endsWith('src/b.ts')) throw new Error('EACCES')
      return (realStat as (...a: unknown[]) => unknown)(p, ...rest)
    }) as typeof fs.statSync)
    syncBuiltinESMExports()
    const result = discoverSourceFiles({ repoRoot: root, sourceRoots: ['src'] })
    vi.restoreAllMocks()
    syncBuiltinESMExports()

    expect(result.files.map((f) => f.relPath)).toEqual(['src/a.ts']) // existing extraction input unchanged
    const b = result.auditSelection.selectedFiles.find((f) => f.relPath === 'src/b.ts')
    expect(b).toMatchObject({ selectionStatus: 'unreadable', sizeBytes: null })
  })
})

describe('v1.15.0 Batch 1 coverage projection', () => {
  it('accounts for every selected entry with distinguishable statuses and valid contract structure', () => {
    const root = makeProject({
      'src/a.ts': 'export const a = 1\n',
      'src/notes.md': 'hello\n',
      'src/node_modules/dep/one.ts': '1',
      'src/node_modules/dep/two.ts': '2',
    })
    const { result } = project(root, { excludes: ['skip'] })
    const { artifact } = result
    expect(artifact.files.map((f) => [f.path, f.status])).toEqual([
      ['src/a.ts', 'parsed'],
      ['src/notes.md', 'unsupported'],
    ])
    expect(artifact.coverage).toMatchObject({
      selectedFileCount: 2,
      recordedFileCount: 2,
      unreadableFileCount: 0,
      unsupportedFileCount: 1,
      excludedPathCount: 1,
      inventoryComplete: true,
    })
    expect(artifact.files[1]).toMatchObject({ language: 'unsupported', contentSha256: null, lineCount: null, facts: [] })
    expect(() => validateSourceAuditEvidence(artifact)).not.toThrow()
    // Excluded directory is one observed entry, never an exhaustive scan of its descendants.
    expect(artifact.coverage.excludedPathCount).toBe(1)
  })

  it('never marks out-of-scope capability families complete, even for a complete inventory', () => {
    const root = makeProject({ 'src/a.ts': 'export function f() { return 1 }\n', 'src/b.py': 'def g():\n    return 1\n' })
    const { result } = project(root)
    expect(result.artifact.coverage.inventoryComplete).toBe(true)
    for (const file of result.artifact.files) {
      // Batch 2 evidence exists for the four language families; the Batch 3+ families stay unsupported or not applicable.
      for (const capability of ['identifier-literals', 'test-observations', 'fixture-references', 'process-observations', 'api-client-calls'] as const) {
        expect(file.capabilities[capability]).not.toBe('complete')
        expect(file.capabilities[capability]).not.toBe('partial')
      }
      expect(file.analyzerId).not.toBeNull()
    }
    const ts = result.artifact.files.find((f) => f.path === 'src/a.ts')!
    const py = result.artifact.files.find((f) => f.path === 'src/b.py')!
    expect(ts.capabilities['api-client-calls']).toBe('unsupported')
    expect(py.capabilities['api-client-calls']).toBe('not-applicable')
    expect(ts.capabilities.declarations).toBe('complete')
    expect(ts.facts.some((fact) => fact.kind === 'declaration' && fact.name === 'f')).toBe(true)
  })

  it('represents unreadable selected files as failed and unsupported files as unsupported', () => {
    const { artifact, incompleteReasons } = pure({
      discovery: fakeDiscovery({
        selected: [
          { relPath: 'src/gone.ts', absPath: '/r/src/gone.ts', sizeBytes: null, selectionStatus: 'unreadable' },
          { relPath: 'src/odd.bin', absPath: '/r/src/odd.bin', sizeBytes: 4, selectionStatus: 'unreadable' },
          { relPath: 'src/x.md', absPath: '/r/src/x.md', sizeBytes: 9, selectionStatus: 'unsupported' },
        ],
      }),
    })
    expect(artifact.files.map((f) => [f.path, f.status, f.language])).toEqual([
      ['src/gone.ts', 'failed', 'typescript'],
      ['src/odd.bin', 'failed', 'unsupported'],
      ['src/x.md', 'unsupported', 'unsupported'],
    ])
    expect(artifact.coverage).toMatchObject({ selectedFileCount: 3, recordedFileCount: 3, unreadableFileCount: 2, unsupportedFileCount: 1, inventoryComplete: false })
    expect(incompleteReasons).toContain('selected-file-unreadable')
    expect(artifact.files[0]!.capabilities.declarations).toBe('failed')
    expect(artifact.files[2]!.capabilities.declarations).toBe('unsupported')
    expect(() => validateSourceAuditEvidence(artifact)).not.toThrow()
  })

  it('produces failed evidence when a supported selected file has no FileSummary', () => {
    const selected = [
      { relPath: 'src/hashed.ts', absPath: '/r/src/hashed.ts', sizeBytes: 5, selectionStatus: 'supported' as const },
      { relPath: 'src/nohash.ts', absPath: '/r/src/nohash.ts', sizeBytes: 5, selectionStatus: 'supported' as const },
    ]
    const { artifact, incompleteReasons } = pure({
      discovery: fakeDiscovery({ selected }),
      fileHashes: new Map([['src/hashed.ts', HASH_A]]),
    })
    expect(artifact.files.map((f) => [f.path, f.status, f.diagnostics[0]?.code])).toEqual([
      ['src/hashed.ts', 'failed', 'missing-file-summary'],
      ['src/nohash.ts', 'failed', 'content-unreadable'],
    ])
    expect(artifact.files[0]!.contentSha256).toBe(HASH_A)
    // Only the file with no content identity at all counts as unreadable.
    expect(artifact.coverage.unreadableFileCount).toBe(1)
    expect(artifact.coverage.inventoryComplete).toBe(false)
    expect(incompleteReasons).toContain('content-identity-gap')
    expect(() => validateSourceAuditEvidence(artifact)).not.toThrow()
  })

  it('records noncanonical selected paths as an incomplete reason instead of corrupting the artifact', () => {
    const { artifact, incompleteReasons } = pure({
      discovery: fakeDiscovery({
        selected: [
          { relPath: '../outside/a.ts', absPath: '/o/a.ts', sizeBytes: 1, selectionStatus: 'supported' },
          { relPath: 'src/ok.md', absPath: '/r/src/ok.md', sizeBytes: 1, selectionStatus: 'unsupported' },
        ],
      }),
    })
    expect(artifact.coverage).toMatchObject({ selectedFileCount: 2, recordedFileCount: 1, inventoryComplete: false })
    expect(incompleteReasons).toContain('noncanonical-selected-path')
    expect(() => validateSourceAuditEvidence(artifact)).not.toThrow()
  })

  it('deduplicates identical selections and flags conflicting identities without selecting silently', () => {
    const same = pure({
      discovery: fakeDiscovery({
        selected: [
          { relPath: 'src/a.md', absPath: '/r/src/a.md', sizeBytes: 1, selectionStatus: 'unsupported' },
          { relPath: 'src/a.md', absPath: '/r/src/a.md', sizeBytes: 1, selectionStatus: 'unsupported' },
        ],
      }),
    })
    expect(same.artifact.coverage.selectedFileCount).toBe(1)
    expect(same.incompleteReasons).not.toContain('conflicting-selection-identity')

    const conflict = pure({
      discovery: fakeDiscovery({
        selected: [
          { relPath: 'src/a.ts', absPath: '/r/src/a.ts', sizeBytes: 1, selectionStatus: 'supported' },
          { relPath: 'src/a.ts', absPath: '/r/src/a.ts', sizeBytes: null, selectionStatus: 'unreadable' },
        ],
      }),
    })
    expect(conflict.artifact.coverage.selectedFileCount).toBe(1)
    expect(conflict.artifact.files[0]!.status).toBe('failed')
    expect(conflict.artifact.coverage.inventoryComplete).toBe(false)
    expect(conflict.incompleteReasons).toContain('conflicting-selection-identity')
  })

  it('assigns roles conservatively, leaving fixture content and ambiguous paths unknown', () => {
    const root = makeProject({
      'src/main.ts': 'export const m = 1\n',
      'tests/unit/a.spec.ts': 'export const t = 1\n',
      'tests/helpers/util.ts': 'export const u = 1\n',
      'tests/fixtures/data/sample.ts': 'export const f = 1\n',
      'scripts/run.py': 'x = 1\n',
      'other/loose.ts': 'export const l = 1\n',
    })
    const { result } = project(root, { sourceRoots: ['src', 'tests', 'scripts', 'other'] })
    const roles = Object.fromEntries(result.artifact.files.map((f) => [f.path, f.role]))
    expect(roles).toEqual({
      'other/loose.ts': 'source',
      'scripts/run.py': 'script',
      'src/main.ts': 'source',
      'tests/fixtures/data/sample.ts': 'unknown',
      'tests/helpers/util.ts': 'test',
      'tests/unit/a.spec.ts': 'test',
    })
    const rootOnly = project(root, { sourceRoots: ['.'] }).result.artifact
    const loose = rootOnly.files.find((f) => f.path === 'other/loose.ts')!
    expect(loose.role).toBe('unknown')
  })

  it('records the effective exclusion policy and does not call a default-only index incomplete (planner 5.5)', () => {
    const root = makeProject({ 'src/a.ts': 'x', 'src/node_modules/d/i.ts': 'y' })
    const defaultOnly = project(root).result
    expect(defaultOnly.artifact.coverage.excludedPathCount).toBe(1)
    expect(defaultOnly.artifact.coverage.exclusionsAreExplicit).toBe(true)
    expect(defaultOnly.incompleteReasons).not.toContain('exclusion-rules-not-recorded')
    const rules = defaultOnly.artifact.source.excludes
    expect(rules).toContain('default-directory:node_modules')
    expect(rules).toContain('default-directory-prefix:.my-dev-kit-')
    expect(rules).toContain('default-file-pattern:.d.ts')
    expect(rules.some((rule) => rule.startsWith('user:'))).toBe(false)
    expect(rules).toEqual([...new Set(rules)].sort())
    expect(rules.every((rule) => /^(default-directory|default-directory-prefix|default-file-pattern|user):./.test(rule))).toBe(true)
    expect(() => validateSourceAuditEvidence(defaultOnly.artifact)).not.toThrow()

    const configured = project(root, { excludes: ['generated'] }).result
    expect(configured.artifact.coverage.exclusionsAreExplicit).toBe(true)
    expect(configured.artifact.source.excludes).toContain('user:generated')

    const mismatch = pure({ excludes: ['other-rule'] })
    expect(mismatch.artifact.coverage.exclusionsAreExplicit).toBe(false)
    expect(mismatch.incompleteReasons).toContain('configured-excludes-inconsistent')

    const inconsistent = pure({ discovery: { ...fakeDiscovery(), skippedByUserExclude: 2 } })
    expect(inconsistent.artifact.coverage.exclusionsAreExplicit).toBe(false)
    expect(inconsistent.incompleteReasons).toContain('excluded-path-accounting-inconsistent')
  })
})

describe('v1.15.0 Batch 1 hash and snapshot identity', () => {
  it('uses the SHA-256 of the exact analyzed bytes and is deterministic', () => {
    const text = 'export const a = 1\n'
    const root = makeProject({ 'src/a.ts': text })
    const first = project(root).result.artifact
    const second = project(root).result.artifact
    expect(first.files[0]!.contentSha256).toBe(sha256(text))
    expect(first.source.snapshotId).toMatch(/^[0-9a-f]{64}$/)
    expect(second).toEqual(first)
    expect(SOURCE_AUDIT_EXTRACTOR_CONTRACT_REVISION).toBe('source-audit-v1.1.0')
  })

  it('hashes raw bytes rather than decoded text (BOM and invalid UTF-8 stay distinguishable)', () => {
    const root = makeProject({})
    mkdirSync(join(root, 'src'))
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('export const a = 1\n'), Buffer.from([0xff])])
    writeFileSync(join(root, 'src', 'a.ts'), bytes)
    const artifact = project(root).result.artifact
    expect(artifact.files[0]!.contentSha256).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it('changes the snapshot ID when content, selected roots or exclusions change', () => {
    const root = makeProject({ 'src/a.ts': 'export const a = 1\n', 'lib/b.ts': 'export const b = 1\n' })
    const base = project(root).result.artifact
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 2\n')
    const content = project(root).result.artifact
    expect(content.source.snapshotId).not.toBe(base.source.snapshotId)
    expect(content.source.selectionFingerprint).toBe(base.source.selectionFingerprint)

    const roots = project(root, { sourceRoots: ['src', 'lib'] }).result.artifact
    expect(roots.source.selectionFingerprint).not.toBe(content.source.selectionFingerprint)
    expect(roots.source.snapshotId).not.toBe(content.source.snapshotId)

    const excluded = project(root, { excludes: ['nothing-here'] }).result.artifact
    expect(excluded.source.selectionFingerprint).not.toBe(content.source.selectionFingerprint)
    expect(excluded.source.snapshotId).not.toBe(content.source.snapshotId)
  })

  it('is independent of timestamps, project root location, producer version and input ordering', () => {
    const files = { 'src/a.ts': 'export const a = 1\n', 'src/b.ts': 'export const b = 1\n' }
    const one = project(makeProject(files), { projectRoot: '/machine/one', producerVersion: '1.14.0' })
    const two = project(makeProject(files), { projectRoot: 'D:/elsewhere/two', producerVersion: '9.9.9' })
    expect(two.result.artifact.source.snapshotId).toBe(one.result.artifact.source.snapshotId)
    expect(two.result.artifact.source.selectionFingerprint).toBe(one.result.artifact.source.selectionFingerprint)
    expect(JSON.stringify(one.result.artifact)).not.toMatch(/\d{4}-\d{2}-\d{2}T/)

    const reordered = buildSourceAuditEvidence({
      ...one.input,
      sourceRoots: ['src/', './src'],
      discovery: {
        ...one.input.discovery,
        auditSelection: { ...one.input.discovery.auditSelection, selectedFiles: [...one.input.discovery.auditSelection.selectedFiles].reverse() },
      },
      symbolIndex: { ...one.input.symbolIndex, files: [...one.input.symbolIndex.files].reverse() },
    })
    expect(reordered.artifact.source.snapshotId).toBe(one.result.artifact.source.snapshotId)
    expect(reordered.artifact.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('does not turn invalid or missing hashes into successful content identities', () => {
    const selected = [
      { relPath: 'src/a.ts', absPath: '/r/src/a.ts', sizeBytes: 3, selectionStatus: 'supported' as const },
      { relPath: 'src/b.ts', absPath: '/r/src/b.ts', sizeBytes: 3, selectionStatus: 'supported' as const },
      { relPath: 'src/c.ts', absPath: '/r/src/c.ts', sizeBytes: 3, selectionStatus: 'supported' as const },
    ]
    const { artifact, incompleteReasons } = pure({
      discovery: fakeDiscovery({ selected }),
      symbolIndex: fakeIndex([summary('src/a.ts'), summary('src/b.ts'), summary('src/c.ts')]),
      fileHashes: new Map([
        ['src/a.ts', 'NOT-A-HASH'],
        ['src/b.ts', HASH_A.toUpperCase()],
        ['src/c.ts', HASH_B],
      ]),
    })
    expect(artifact.files.map((f) => [f.path, f.contentSha256, f.status])).toEqual([
      ['src/a.ts', null, 'partial'],
      ['src/b.ts', null, 'partial'],
      ['src/c.ts', HASH_B, 'file-level-only'],
    ])
    expect(artifact.files[0]!.diagnostics[0]!.code).toBe('invalid-content-hash')
    expect(artifact.coverage.inventoryComplete).toBe(false)
    expect(incompleteReasons).toContain('content-identity-gap')
    for (const file of artifact.files) for (const c of SOURCE_AUDIT_CAPABILITIES) expect(file.capabilities[c]).not.toBe('complete')
    expect(() => validateSourceAuditEvidence(artifact)).not.toThrow()
  })

  it('marks a supported file with extraction warnings partial without hiding the warnings', () => {
    const { artifact } = pure({
      discovery: fakeDiscovery({ selected: [{ relPath: 'src/a.ts', absPath: '/r/a', sizeBytes: 1, selectionStatus: 'supported' }] }),
      symbolIndex: fakeIndex([summary('src/a.ts', { warnings: ['parse recovered'] })]),
      fileHashes: new Map([['src/a.ts', HASH_A]]),
    })
    expect(artifact.files[0]).toMatchObject({ status: 'partial', warnings: ['parse recovered'], contentSha256: HASH_A })
    expect(artifact.coverage.inventoryComplete).toBe(true)
  })
})

describe('v1.15.0 Batch 1 compatibility', () => {
  it('leaves the symbol-index schema, public index shape and build output unchanged', () => {
    const root = makeProject({ 'src/a.ts': 'export function f() { return 1 }\n' })
    const built = buildIndex({ repoRoot: root, sourceRoots: ['src'] })
    expect(SCHEMA_VERSION).toBe('3')
    expect(Object.keys(built.index).sort()).toEqual(
      ['buildTime', 'fileCount', 'files', 'graph', 'repoRoot', 'schemaVersion', 'sourceRoots', 'symbolCount'].sort(),
    )
    expect(JSON.stringify(built.index)).not.toContain('contentSha256')
    expect(built.index.files.map((f) => f.path)).toEqual(['src/a.ts'])
    expect(built.discovery.files.map((f) => f.relPath)).toEqual(['src/a.ts'])
    expect(readFileSync(join(root, 'src', 'a.ts'), 'utf8')).toContain('function f')
  })

  it('is pure: projecting twice from the same inputs does not mutate them', () => {
    const root = makeProject({ 'src/a.ts': 'export const a = 1\n', 'src/n.md': 'x' })
    const { input } = project(root)
    const before = JSON.stringify({ d: input.discovery.auditSelection, i: input.symbolIndex.files, h: [...input.fileHashes] })
    buildSourceAuditEvidence(input)
    buildSourceAuditEvidence(input)
    expect(JSON.stringify({ d: input.discovery.auditSelection, i: input.symbolIndex.files, h: [...input.fileHashes] })).toBe(before)
  })
})
