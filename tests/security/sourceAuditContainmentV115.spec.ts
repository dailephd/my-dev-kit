import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import {
  assertSourceAuditFileFresh,
  getSourceAuditFilePage,
  isCanonicalAuditRelativePath,
  readSourceAuditEvidence,
  SourceAuditEvidenceError,
} from '../../src/lookup/readSourceAuditEvidence.js'

const tempDirs: string[] = []
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})
const sha = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

let root = ''
let out = ''
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v115-b4-sec-'))
  tempDirs.push(root)
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/a.ts'), "export const A_ID = 'alpha'\n")
  out = join(root, 'out')
  await runIndexCommand({ root, src: ['src'], out })
})

const manifestPath = (): string => join(out, 'manifest.json')
const artifactPath = (): string => join(out, 'source-audit-evidence.json')
const readManifest = () => JSON.parse(readFileSync(manifestPath(), 'utf8'))
function rewriteManifest(change: (manifest: Record<string, any>) => void): void {
  const manifest = readManifest()
  change(manifest)
  writeFileSync(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`)
}
/** Rewrites the artifact and, unless told otherwise, keeps the manifest SHA consistent so only the intended defect remains. */
function rewriteArtifact(change: (artifact: Record<string, any>) => void, syncManifest = true): void {
  const artifact = JSON.parse(readFileSync(artifactPath(), 'utf8'))
  change(artifact)
  const json = `${JSON.stringify(artifact, null, 2)}\n`
  writeFileSync(artifactPath(), json)
  if (syncManifest) rewriteManifest((manifest) => { manifest.sourceAuditEvidence.sha256 = sha(Buffer.from(json, 'utf8')) })
}
const code = (action: () => unknown): string => {
  try {
    action()
  } catch (caught) {
    return caught instanceof SourceAuditEvidenceError ? caught.code : `OTHER:${(caught as Error).message}`
  }
  return 'NO_ERROR'
}

describe('v1.15.0 Batch 4 artifact identity verification', () => {
  it('accepts the unmodified artifact', () => {
    expect(readSourceAuditEvidence(out).files).toHaveLength(1)
  })

  it('reports an index without an audit reference as unavailable, not invalid', () => {
    rewriteManifest((manifest) => { delete manifest.sourceAuditEvidence })
    expect(code(() => readSourceAuditEvidence(out))).toBe('AUDIT_EVIDENCE_UNAVAILABLE')
  })

  it.each([
    ['missing artifact', () => rmSync(artifactPath())],
    ['corrupt JSON', () => writeFileSync(artifactPath(), '{ nope')],
    ['serialized SHA mismatch', () => rewriteManifest((m) => { m.sourceAuditEvidence.sha256 = 'f'.repeat(64) })],
    ['snapshot mismatch', () => rewriteManifest((m) => { m.sourceAuditEvidence.snapshotId = 'e'.repeat(64) })],
    ['manifest path escaping the index root', () => rewriteManifest((m) => { m.sourceAuditEvidence.path = '../outside.json' })],
    ['manifest path to another file', () => rewriteManifest((m) => { m.sourceAuditEvidence.path = 'symbol-index.json' })],
    ['manifest schema version', () => rewriteManifest((m) => { m.sourceAuditEvidence.schemaVersion = '9.9.9' })],
    ['malformed manifest sha', () => rewriteManifest((m) => { m.sourceAuditEvidence.sha256 = 'ABC' })],
    ['artifact schema version', () => rewriteArtifact((a) => { a.schemaVersion = '2.0.0' })],
    ['artifact kind', () => rewriteArtifact((a) => { a.artifactKind = 'other-kind' })],
    ['artifact snapshot differs from manifest', () => rewriteArtifact((a) => { a.source.snapshotId = 'd'.repeat(64) })],
    ['artifact project root differs from manifest', () => rewriteArtifact((a) => { a.source.projectRoot = '/elsewhere' })],
    ['structurally invalid artifact', () => rewriteArtifact((a) => { a.coverage.recordedFileCount = 99 })],
    ['duplicate file path', () => rewriteArtifact((a) => { a.files.push(a.files[0]) })],
  ])('rejects %s with AUDIT_EVIDENCE_INVALID', (_name, damage) => {
    damage()
    expect(code(() => readSourceAuditEvidence(out))).toBe('AUDIT_EVIDENCE_INVALID')
  })

  it('rejects an artifact that is a symlink leaving the index directory', (ctx) => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v115-b4-outart-'))
    tempDirs.push(outsideDir)
    const outside = join(outsideDir, 'outside-artifact.json')
    writeFileSync(outside, readFileSync(artifactPath()))
    const targetBefore = readFileSync(outside, 'utf8')
    rmSync(artifactPath())
    try {
      symlinkSync(outside, artifactPath(), 'file')
    } catch {
      // Symlink creation needs privileges on some Windows hosts. Report a visible skip, never a silent pass.
      ctx.skip()
      return
    }
    expect(code(() => readSourceAuditEvidence(out))).toBe('AUDIT_EVIDENCE_INVALID')
    expect(readFileSync(outside, 'utf8')).toBe(targetBefore)
  })

  it('never repairs, rewrites or deletes a damaged artifact on read', () => {
    writeFileSync(artifactPath(), '{ nope')
    const before = readFileSync(artifactPath(), 'utf8')
    expect(code(() => readSourceAuditEvidence(out))).toBe('AUDIT_EVIDENCE_INVALID')
    expect(readFileSync(artifactPath(), 'utf8')).toBe(before)
  })
})

describe('v1.15.0 Batch 4 selected-path and freshness containment', () => {
  it.each(['../secret.ts', 'src/../../secret.ts', '/etc/passwd', 'C:/Windows/win.ini', 'src\\a.ts', './src/a.ts', 'src//a.ts', 'src/./a.ts', '', 'src/a.ts\0'])(
    'rejects non-canonical selected path %j',
    (candidate) => {
      expect(isCanonicalAuditRelativePath(candidate)).toBe(false)
      expect(code(() => getSourceAuditFilePage(readSourceAuditEvidence(out), candidate, 0))).toBe('INVALID_AUDIT_PATH')
    },
  )

  it('detects an altered, deleted or escaping selected file', (ctx) => {
    const artifact = readSourceAuditEvidence(out)
    const file = artifact.files[0]!
    expect(code(() => assertSourceAuditFileFresh(artifact, file))).toBe('NO_ERROR')
    writeFileSync(join(root, 'src/a.ts'), "export const A_ID = 'changed'\n")
    expect(code(() => assertSourceAuditFileFresh(artifact, file))).toBe('STALE_SOURCE_EVIDENCE')
    rmSync(join(root, 'src/a.ts'))
    expect(code(() => assertSourceAuditFileFresh(artifact, file))).toBe('STALE_SOURCE_EVIDENCE')
    const outsideDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v115-b4-outside-'))
    tempDirs.push(outsideDir)
    const outside = join(outsideDir, 'outside.ts')
    writeFileSync(outside, "export const A_ID = 'alpha'\n")
    try {
      symlinkSync(outside, join(root, 'src/a.ts'), 'file')
    } catch {
      ctx.skip() // visible skip: this host cannot create the required link
      return
    }
    // Identical bytes through a symlink that leaves the project tree are still refused.
    expect(code(() => assertSourceAuditFileFresh(artifact, file))).toBe('INVALID_AUDIT_PATH')
    expect(readFileSync(outside, 'utf8')).toBe("export const A_ID = 'alpha'\n")
  })

  it('refuses a selected path that traverses a directory junction leaving the project tree', (ctx) => {
    const artifact = readSourceAuditEvidence(out)
    const file = artifact.files[0]!
    const outsideDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v115-b4-junction-'))
    tempDirs.push(outsideDir)
    writeFileSync(join(outsideDir, 'a.ts'), "export const A_ID = 'alpha'\n")
    rmSync(join(root, 'src'), { recursive: true, force: true })
    try {
      symlinkSync(outsideDir, join(root, 'src'), 'junction')
    } catch {
      ctx.skip()
      return
    }
    expect(code(() => assertSourceAuditFileFresh(artifact, file))).toBe('INVALID_AUDIT_PATH')
    expect(readFileSync(join(outsideDir, 'a.ts'), 'utf8')).toBe("export const A_ID = 'alpha'\n")
  })

  it('does not claim freshness for a file recorded without a content hash', () => {
    const artifact = readSourceAuditEvidence(out)
    expect(code(() => assertSourceAuditFileFresh(artifact, { path: 'src/ghost.xyz', contentSha256: null }))).toBe('NO_ERROR')
  })
})
