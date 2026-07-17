import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

// v1.10.1 Batch 2: changed-surface intake (caller-supplied changedFiles/changedSymbols
// and beforeIndex/afterIndex graph-diff reuse).
// Responsibility IDs: TST-B2-006, 007, 012, 013, 014, 015, 016, 017, 027, 028.

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function createTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(root)
  return root
}

function writeBeforeAfter(root: string): { beforeOut: string; afterOut: string } {
  const beforeSrc = join(root, 'before', 'src')
  const afterSrc = join(root, 'after', 'src')
  mkdirSync(beforeSrc, { recursive: true })
  mkdirSync(afterSrc, { recursive: true })

  // before: formatUser + legacyHelper
  writeFileSync(
    join(beforeSrc, 'userService.ts'),
    "export function formatUser(name: string): string { return name }\nexport function legacyHelper(): string { return 'legacy' }\n"
  )
  writeFileSync(join(beforeSrc, 'userService.spec.ts'), "import { formatUser } from './userService'\nexport const check = formatUser\n")

  // after: formatUser changed, legacyHelper removed, newFeature added
  writeFileSync(join(afterSrc, 'userService.ts'), "export function formatUser(name: string): string { return name.toUpperCase() }\n")
  writeFileSync(join(afterSrc, 'userService.spec.ts'), "import { formatUser } from './userService'\nexport const check = formatUser\n")
  writeFileSync(join(afterSrc, 'newFeature.ts'), 'export function newFeature(): number { return 1 }\n')

  const beforeOut = join(root, 'before', '.my-dev-kit')
  const afterOut = join(root, 'after', '.my-dev-kit')
  const beforeResult = runCli(['index', '--root', join(root, 'before'), '--src', 'src', '--out', beforeOut])
  expect(beforeResult.status).toBe(0)
  const afterResult = runCli(['index', '--root', join(root, 'after'), '--src', 'src', '--out', afterOut])
  expect(afterResult.status).toBe(0)
  return { beforeOut, afterOut }
}

describe('changed-surface intake', () => {
  it('TST-B2-012: caller-provided changedFiles are normalized (deduplicated, sorted, provenance-labeled)', () => {
    const root = createTempRoot('my-dev-kit-v1-changed-files-')
    const { afterOut } = writeBeforeAfter(root)
    const requestPath = join(root, 'req.json')
    writeFileSync(
      requestPath,
      JSON.stringify(
        { schemaVersion: '1.0.0', query: 'formatUser', role: 'test-implementation', changedFiles: ['src/userService.ts', 'src/newFeature.ts', 'src/userService.ts'] },
        null,
        2
      )
    )
    const capsulePath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', afterOut, '--request', requestPath, '--out', capsulePath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsulePath, 'utf8'))
    expect(capsule.roleContext.changedSurface.files).toEqual([
      { path: 'src/newFeature.ts', status: 'unknown', provenance: 'caller' },
      { path: 'src/userService.ts', status: 'unknown', provenance: 'caller' },
    ])
  })

  it('TST-B2-013: caller-provided changedSymbols are normalized (deduplicated, sorted, provenance-labeled)', () => {
    const root = createTempRoot('my-dev-kit-v1-changed-symbols-')
    const { afterOut } = writeBeforeAfter(root)
    const requestPath = join(root, 'req.json')
    writeFileSync(
      requestPath,
      JSON.stringify(
        {
          schemaVersion: '1.0.0',
          query: 'formatUser',
          role: 'test-implementation',
          changedSymbols: ['symbol:src/userService.ts#formatUser', 'symbol:src/newFeature.ts#newFeature', 'symbol:src/userService.ts#formatUser'],
        },
        null,
        2
      )
    )
    const capsulePath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', afterOut, '--request', requestPath, '--out', capsulePath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsulePath, 'utf8'))
    expect(capsule.roleContext.changedSurface.symbols).toEqual([
      { symbolId: 'symbol:src/newFeature.ts#newFeature', status: 'unknown', provenance: 'caller', filePath: 'src/newFeature.ts', name: 'newFeature' },
      { symbolId: 'symbol:src/userService.ts#formatUser', status: 'unknown', provenance: 'caller', filePath: 'src/userService.ts', name: 'formatUser' },
    ])
  })

  it('TST-B2-014/015: beforeIndex/afterIndex graph diff supplies added/removed/changed files and symbols, preserving the removed symbol', () => {
    const root = createTempRoot('my-dev-kit-v1-changed-diff-')
    const { beforeOut, afterOut } = writeBeforeAfter(root)
    const requestPath = join(root, 'req.json')
    writeFileSync(
      requestPath,
      JSON.stringify(
        { schemaVersion: '1.0.0', query: 'formatUser', role: 'test-implementation', beforeIndex: beforeOut, afterIndex: afterOut },
        null,
        2
      )
    )
    const capsulePath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', afterOut, '--request', requestPath, '--out', capsulePath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsulePath, 'utf8'))
    const cs = capsule.roleContext.changedSurface
    expect(cs.diffRequested).toBe(true)

    const fileByPath = (p: string) => cs.files.find((f: { path: string }) => f.path === p)
    expect(fileByPath('src/newFeature.ts')).toMatchObject({ status: 'added', provenance: 'graph-diff' })
    expect(fileByPath('src/userService.ts')).toMatchObject({ status: 'modified', provenance: 'graph-diff' })

    const symbolById = (id: string) => cs.symbols.find((s: { symbolId: string }) => s.symbolId === id)
    expect(symbolById('symbol:src/newFeature.ts#newFeature')).toMatchObject({ status: 'added', provenance: 'graph-diff' })
    expect(symbolById('symbol:src/userService.ts#formatUser')).toMatchObject({ status: 'modified', provenance: 'graph-diff' })
    const removed = symbolById('symbol:src/userService.ts#legacyHelper')
    expect(removed).toMatchObject({ status: 'removed', provenance: 'graph-diff', filePath: 'src/userService.ts', name: 'legacyHelper' })
    expect(removed.kind).toBe('function')
  })

  it('TST-B2-006/007: test-implementation role prioritizes changed production symbols/files over unrelated candidates', () => {
    const root = createTempRoot('my-dev-kit-v1-changed-priority-')
    const { beforeOut, afterOut } = writeBeforeAfter(root)
    const requestPath = join(root, 'req.json')
    writeFileSync(
      requestPath,
      JSON.stringify(
        { schemaVersion: '1.0.0', query: 'user service', role: 'test-implementation', beforeIndex: beforeOut, afterIndex: afterOut },
        null,
        2
      )
    )
    const capsulePath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', afterOut, '--request', requestPath, '--out', capsulePath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsulePath, 'utf8'))

    const changedSymbolNode = capsule.candidateNodes.find((n: { nodeId: string }) => n.nodeId === 'symbol:src/newFeature.ts#newFeature')
    expect(changedSymbolNode).toBeDefined()
    expect(changedSymbolNode.changedSurfaceMatch).toBe(true)

    const changedFileCandidate = capsule.candidateFiles.find((f: { path: string }) => f.path === 'src/userService.ts')
    expect(changedFileCandidate).toBeDefined()
    expect(changedFileCandidate.changedSurfaceMatch).toBe(true)
    // The changed candidate must rank at or above every non-changed-surface candidate.
    for (const other of capsule.candidateFiles) {
      if (other.path === changedFileCandidate.path) continue
      if (!other.changedSurfaceMatch && !other.focusMatch) {
        expect(changedFileCandidate.score).toBeGreaterThanOrEqual(other.score)
      }
    }
  })

  it('TST-B2-016/017: merges caller and graph-diff evidence without duplicate inflation and records a status conflict', () => {
    const root = createTempRoot('my-dev-kit-v1-changed-conflict-')
    const { beforeOut, afterOut } = writeBeforeAfter(root)
    const requestPath = join(root, 'req.json')
    writeFileSync(
      requestPath,
      JSON.stringify(
        {
          schemaVersion: '1.0.0',
          query: 'formatUser',
          role: 'test-implementation',
          beforeIndex: beforeOut,
          afterIndex: afterOut,
          changedSymbols: ['symbol:src/userService.ts#legacyHelper'],
        },
        null,
        2
      )
    )
    const capsulePath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', afterOut, '--request', requestPath, '--out', capsulePath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsulePath, 'utf8'))
    const cs = capsule.roleContext.changedSurface

    const matches = cs.symbols.filter((s: { symbolId: string }) => s.symbolId === 'symbol:src/userService.ts#legacyHelper')
    expect(matches.length).toBe(1) // no duplicate inflation
    expect(matches[0]).toMatchObject({ status: 'removed', provenance: 'both' })
    expect(cs.conflicts.some((c: string) => c.includes('legacyHelper') && c.includes('removed'))).toBe(true)
  })

  it('TST-B2-027: supplying only beforeIndex without afterIndex fails clearly', () => {
    const root = createTempRoot('my-dev-kit-v1-changed-missing-')
    const { beforeOut, afterOut } = writeBeforeAfter(root)
    const requestPath = join(root, 'req.json')
    writeFileSync(
      requestPath,
      JSON.stringify({ schemaVersion: '1.0.0', query: 'formatUser', role: 'test-implementation', beforeIndex: beforeOut }, null, 2)
    )
    const capsulePath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', afterOut, '--request', requestPath, '--out', capsulePath])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Both beforeIndex and afterIndex must be supplied together')
  })

  it('TST-B2-028: incompatible before/after symbol-index schema versions fail through the existing schema-version compatibility contract', () => {
    const root = createTempRoot('my-dev-kit-v1-changed-incompatible-')
    const { beforeOut, afterOut } = writeBeforeAfter(root)
    // Corrupt the after side's declared symbol-index schemaVersion to simulate an incompatible index.
    const afterSymbolIndexPath = join(afterOut, 'symbol-index.json')
    const afterSymbolIndex = JSON.parse(readFileSync(afterSymbolIndexPath, 'utf8'))
    afterSymbolIndex.schemaVersion = '999'
    writeFileSync(afterSymbolIndexPath, JSON.stringify(afterSymbolIndex, null, 2))

    const requestPath = join(root, 'req.json')
    writeFileSync(
      requestPath,
      JSON.stringify(
        { schemaVersion: '1.0.0', query: 'formatUser', role: 'test-implementation', beforeIndex: beforeOut, afterIndex: afterOut },
        null,
        2
      )
    )
    const capsulePath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', afterOut, '--request', requestPath, '--out', capsulePath])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Incompatible beforeIndex/afterIndex symbol-index schema versions')
  })

  it('test-implementation role without any changed-surface input warns rather than falsely claiming post-implementation focus', () => {
    const root = createTempRoot('my-dev-kit-v1-changed-none-')
    const { afterOut } = writeBeforeAfter(root)
    const requestPath = join(root, 'req.json')
    writeFileSync(requestPath, JSON.stringify({ schemaVersion: '1.0.0', query: 'formatUser', role: 'test-implementation' }, null, 2))
    const capsulePath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', afterOut, '--request', requestPath, '--out', capsulePath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsulePath, 'utf8'))
    expect(capsule.roleContext.changedSurface.available).toBe(false)
    expect(capsule.warnings.some((w: string) => w.includes('changed-surface focus is unavailable'))).toBe(true)
  })
})
