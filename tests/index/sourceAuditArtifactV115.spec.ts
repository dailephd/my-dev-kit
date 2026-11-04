import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CACHE_SCHEMA_VERSION } from '../../src/indexing/cacheMetadata.js'
import { SOURCE_AUDIT_EVIDENCE_FILENAME, MANAGED_INDEX_ARTIFACT_FILENAMES } from '../../src/indexing/managedArtifacts.js'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { writeIndexArtifacts } from '../../src/indexing/writeIndexManifest.js'
import { buildIndexManifest } from '../../src/indexing/buildIndexManifest.js'
import { serializeSourceAuditEvidence } from '../../src/indexing/buildSourceAuditEvidence.js'
import { readSourceAuditEvidence } from '../../src/lookup/readSourceAuditEvidence.js'
import { validateSourceAuditEvidence } from '../../src/symbol-index/validateAuditEvidence.js'

const tempDirs: string[] = []
const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')

function makeProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v115-b4-'))
  tempDirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), content)
  }
  return root
}

const BASE = {
  'src/a.ts': "import { b } from './b'\nexport const A_ID = 'alpha'\nexport function a() { return b() }\n",
  'src/b.ts': 'export function b() { return 1 }\n',
}

async function index(root: string, extra: { incremental?: boolean; resetCache?: boolean } = {}) {
  return runIndexCommand({ root, src: ['src'], out: join(root, 'out'), ...extra })
}
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'))

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

describe('v1.15.0 Batch 4 source-audit artifact generation', () => {
  it('writes a valid artifact whose manifest reference matches the exact serialized bytes', async () => {
    const root = makeProject(BASE)
    await index(root)
    const out = join(root, 'out')
    const bytes = readFileSync(join(out, SOURCE_AUDIT_EVIDENCE_FILENAME))
    const manifest = readJson(join(out, 'manifest.json'))
    const artifact = JSON.parse(bytes.toString('utf8'))
    expect(() => validateSourceAuditEvidence(artifact)).not.toThrow()
    expect(manifest.version).toBe('1.0.0')
    expect(manifest.sourceAuditEvidence).toEqual({
      path: 'source-audit-evidence.json',
      schemaVersion: '1.1.0',
      sha256: sha256(bytes),
      snapshotId: artifact.source.snapshotId,
    })
    // Exact repository JSON convention, and the semantic snapshot id is not the file checksum.
    expect(bytes.toString('utf8')).toBe(`${JSON.stringify(artifact, null, 2)}\n`)
    expect(manifest.sourceAuditEvidence.sha256).not.toBe(manifest.sourceAuditEvidence.snapshotId)
    expect(artifact.artifactKind).toBe('my-dev-kit-v1-source-audit-evidence')
    expect(artifact.files.map((file: { path: string }) => file.path)).toEqual(['src/a.ts', 'src/b.ts'])
    const aFile = artifact.files[0]
    expect(aFile.contentSha256).toBe(sha256(readFileSync(join(root, 'src/a.ts'))))
    expect(aFile.capabilities.declarations).toBe('complete')
    expect(aFile.capabilities['api-client-calls']).not.toBe('complete')
    expect(readSourceAuditEvidence(out).source.snapshotId).toBe(manifest.sourceAuditEvidence.snapshotId)
  })

  it('registers the artifact as Kit-managed output and keeps public schemas unchanged', async () => {
    expect(MANAGED_INDEX_ARTIFACT_FILENAMES).toContain(SOURCE_AUDIT_EVIDENCE_FILENAME)
    const root = makeProject(BASE)
    await index(root)
    const out = join(root, 'out')
    expect(readJson(join(out, 'symbol-index.json')).schemaVersion).toBe('3')
    expect(readJson(join(out, 'code-graph.json')).schemaVersion).toBe('1.1.0')
  })

  it('writes truthful empty coverage for an empty selection', async () => {
    const root = makeProject({})
    mkdirSync(join(root, 'src'))
    await index(root)
    const artifact = readSourceAuditEvidence(join(root, 'out'))
    expect(artifact.files).toEqual([])
    expect(artifact.coverage.selectedFileCount).toBe(0)
    expect(artifact.coverage.recordedFileCount).toBe(0)
  })

  it('records an unsupported file without claiming a content hash it never analyzed', async () => {
    const root = makeProject({ ...BASE, 'src/notes.xyz': 'unsupported\n' })
    await index(root)
    const artifact = readSourceAuditEvidence(join(root, 'out'))
    const records = artifact.files.map((file) => file.path)
    expect(records).toEqual(expect.arrayContaining(['src/a.ts', 'src/b.ts', 'src/notes.xyz']))
    const unsupported = artifact.files.find((file) => file.path === 'src/notes.xyz')!
    expect(unsupported).toMatchObject({ status: 'unsupported', contentSha256: null })
    expect(unsupported.capabilities.declarations).toBe('unsupported')
    expect(artifact.coverage.inventoryComplete).toBe(true)
    for (const file of artifact.files) {
      if (file.status === 'parsed') expect(file.contentSha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})

describe('v1.15.0 Batch 4 cache schema and full/incremental behaviour', () => {
  it('uses private cache schema 1.4.0 and records the extractor revision in the fingerprint', async () => {
    expect(CACHE_SCHEMA_VERSION).toBe('1.4.0')
    const root = makeProject(BASE)
    await index(root, { incremental: true })
    expect(readJson(join(root, 'out', 'cache-metadata.json')).cacheSchemaVersion).toBe('1.4.0')
  })

  it('produces equivalent facts and snapshot ids for full, incremental and partial builds', async () => {
    const root = makeProject(BASE)
    await index(root, { incremental: true })
    const full = readSourceAuditEvidence(join(root, 'out'))
    writeFileSync(join(root, 'src/b.ts'), 'export function b() { return 2 }\n')
    const partial = await index(root, { incremental: true })
    expect(partial.mode === 'index' && partial.cache?.mode).toMatch(/incremental-partial/)
    const afterPartial = readSourceAuditEvidence(join(root, 'out'))
    const fresh = makeProject({ ...BASE, 'src/b.ts': 'export function b() { return 2 }\n' })
    await index(fresh)
    const freshArtifact = readSourceAuditEvidence(join(fresh, 'out'))
    expect(afterPartial.source.snapshotId).toBe(freshArtifact.source.snapshotId)
    expect(afterPartial.files.map((f) => ({ ...f, contentSha256: f.contentSha256 }))).toEqual(freshArtifact.files.map((f) => ({ ...f })))
    expect(afterPartial.source.snapshotId).not.toBe(full.source.snapshotId)
    // The unchanged file's facts are identical to the earlier full build (trusted reuse).
    expect(afterPartial.files.find((f) => f.path === 'src/a.ts')!.facts).toEqual(full.files.find((f) => f.path === 'src/a.ts')!.facts)
  })

  it('removes facts of a deleted source file', async () => {
    const root = makeProject(BASE)
    await index(root, { incremental: true })
    rmSync(join(root, 'src/b.ts'))
    writeFileSync(join(root, 'src/a.ts'), "export const A_ID = 'alpha'\n")
    await index(root, { incremental: true })
    const artifact = readSourceAuditEvidence(join(root, 'out'))
    expect(artifact.files.map((f) => f.path)).toEqual(['src/a.ts'])
    expect(JSON.stringify(artifact)).not.toContain('src/b.ts')
  })

  it('reuses a valid no-change index and reports the actual mode', async () => {
    const root = makeProject(BASE)
    await index(root, { incremental: true })
    const before = readFileSync(join(root, 'out', SOURCE_AUDIT_EVIDENCE_FILENAME))
    const again = await index(root, { incremental: true })
    expect(again.mode === 'index' && again.cache?.mode).toBe('incremental-no-change')
    expect(readFileSync(join(root, 'out', SOURCE_AUDIT_EVIDENCE_FILENAME)).equals(before)).toBe(true)
  })

  it('does not return no-change success when the audit artifact is missing, corrupt or tampered', async () => {
    for (const damage of ['delete', 'corrupt', 'tamper'] as const) {
      const root = makeProject(BASE)
      await index(root, { incremental: true })
      const target = join(root, 'out', SOURCE_AUDIT_EVIDENCE_FILENAME)
      if (damage === 'delete') rmSync(target)
      else if (damage === 'corrupt') writeFileSync(target, '{ not json')
      else writeFileSync(target, `${readFileSync(target, 'utf8')} `)
      const again = await index(root, { incremental: true })
      expect(again.mode === 'index' && again.cache?.mode).toBe('incremental-full-cache-incompatible')
      expect(again.mode === 'index' && again.cache?.invalidationReason).toMatch(/Source-audit evidence/)
      expect(() => readSourceAuditEvidence(join(root, 'out'))).not.toThrow()
    }
  })

  it('treats a v1.14-style cache (schema 1.3.0, no audit artifact) as incompatible', async () => {
    const root = makeProject(BASE)
    await index(root, { incremental: true })
    const out = join(root, 'out')
    const cachePath = join(out, 'cache-metadata.json')
    const cache = readJson(cachePath)
    cache.cacheSchemaVersion = '1.3.0'
    writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`)
    rmSync(join(out, SOURCE_AUDIT_EVIDENCE_FILENAME))
    const again = await index(root, { incremental: true })
    expect(again.mode === 'index' && again.cache?.mode).not.toBe('incremental-no-change')
    expect(readSourceAuditEvidence(out).files).toHaveLength(2)
  })
})

describe('v1.15.0 Batch 4 write order and failure safety', () => {
  const stubManifest = (reference?: { sha256: string; snapshotId: string }) =>
    buildIndexManifest({
      projectRoot: '/p',
      sourceRoots: ['src'],
      languages: [],
      callGraphEnabled: false,
      callGraphProduced: false,
      symbolIndex: { fileCount: 0, symbolCount: 0, files: [], schemaVersion: '3' } as never,
      codeGraph: { summary: { edgeCount: 0 }, schemaVersion: '1.1.0', nodes: [], edges: [] } as never,
      warnings: [],
      errors: [],
      ...(reference ? { sourceAuditEvidence: { path: 'source-audit-evidence.json', schemaVersion: '1.1.0', ...reference } } : {}),
    })

  it('never publishes a manifest that points at a mismatched artifact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v115-b4-write-'))
    tempDirs.push(dir)
    const manifest = stubManifest({ sha256: 'a'.repeat(64), snapshotId: 'b'.repeat(64) })
    expect(() =>
      writeIndexArtifacts({
        outputDir: dir,
        manifest,
        symbolIndex: { schemaVersion: '3' } as never,
        codeGraph: { schemaVersion: '1.1.0' } as never,
        callGraph: null,
        sourceAuditEvidenceJson: '{"different":true}\n',
      })
    ).toThrow(/does not match the SHA-256/)
    expect(existsSync(join(dir, 'manifest.json'))).toBe(false)
  })

  it('fails closed when the manifest references audit evidence that was not supplied', () => {
    const dir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v115-b4-write-'))
    tempDirs.push(dir)
    expect(() =>
      writeIndexArtifacts({
        outputDir: dir,
        manifest: stubManifest({ sha256: 'a'.repeat(64), snapshotId: 'b'.repeat(64) }),
        symbolIndex: { schemaVersion: '3' } as never,
        codeGraph: { schemaVersion: '1.1.0' } as never,
        callGraph: null,
      })
    ).toThrow(/no serialized artifact/)
    expect(existsSync(join(dir, 'manifest.json'))).toBe(false)
  })

  it('refuses to serialize an invalid artifact', () => {
    expect(() => serializeSourceAuditEvidence({ artifactKind: 'wrong' } as never)).toThrow()
  })

  it('keeps unknown user files in the output directory', async () => {
    const root = makeProject(BASE)
    mkdirSync(join(root, 'out'), { recursive: true })
    writeFileSync(join(root, 'out', 'user-notes.txt'), 'mine')
    await index(root)
    expect(readFileSync(join(root, 'out', 'user-notes.txt'), 'utf8')).toBe('mine')
  })
})

beforeAll(() => undefined)
