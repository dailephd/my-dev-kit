import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'
import { classifyFreshness } from '../../src/context/contextFreshness.js'

// v1.10.1 Batch 4: freshness classification.
// Responsibility IDs: TST-B4-031, 032, 033, 034, 035.

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
  writeFileSync(join(beforeSrc, 'userService.ts'), "export function formatUser(name: string): string { return name }\n")
  writeFileSync(join(afterSrc, 'userService.ts'), "export function formatUser(name: string): string { return name.toUpperCase() }\n")
  const beforeOut = join(root, 'before', '.my-dev-kit')
  const afterOut = join(root, 'after', '.my-dev-kit')
  expect(runCli(['index', '--root', join(root, 'before'), '--src', 'src', '--out', beforeOut]).status).toBe(0)
  expect(runCli(['index', '--root', join(root, 'after'), '--src', 'src', '--out', afterOut]).status).toBe(0)
  return { beforeOut, afterOut }
}

function writeRequest(root: string, name: string, body: unknown): string {
  const filePath = join(root, name)
  writeFileSync(filePath, JSON.stringify(body, null, 2))
  return filePath
}

describe('freshness classification (CLI, end-to-end)', () => {
  it('TST-B4-034: the active index matching the supplied afterIndex is classified fresh', () => {
    const root = createTempRoot('my-dev-kit-v1-fresh-after-')
    const { beforeOut, afterOut } = writeBeforeAfter(root)
    const requestPath = writeRequest(root, 'req.json', { schemaVersion: '1.0.0', query: 'formatUser', role: 'implementation', beforeIndex: beforeOut, afterIndex: afterOut })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', afterOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.freshness.state).toBe('fresh')
  })

  it('TST-B4-032: the active index matching the supplied beforeIndex, after production changes, is classified stale', () => {
    const root = createTempRoot('my-dev-kit-v1-fresh-before-')
    const { beforeOut, afterOut } = writeBeforeAfter(root)
    const requestPath = writeRequest(root, 'req.json', { schemaVersion: '1.0.0', query: 'formatUser', role: 'test-implementation', beforeIndex: beforeOut, afterIndex: afterOut })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', beforeOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.freshness.state).toBe('stale')
    expect(capsule.freshness.relevantChangedPaths.length).toBeGreaterThan(0)
  })

  it('TST-B4-033: no repository/before/after identity at all is classified unknown, never fresh', () => {
    const root = createTempRoot('my-dev-kit-v1-fresh-unknown-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'plain.ts'), 'export const value = 1\n')
    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--query', 'value', '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.freshness.state).toBe('unknown')
  })

  it('TST-B4-035: a before/after diff whose active index matches neither side is classified unknown, not fabricated as fresh', () => {
    const root = createTempRoot('my-dev-kit-v1-fresh-neither-')
    const { beforeOut, afterOut } = writeBeforeAfter(root)
    // A third, separately-indexed active index that is neither before nor after.
    const otherSrc = join(root, 'other', 'src')
    mkdirSync(otherSrc, { recursive: true })
    writeFileSync(join(otherSrc, 'userService.ts'), "export function formatUser(name: string): string { return name }\n")
    const otherOut = join(root, 'other', '.my-dev-kit')
    expect(runCli(['index', '--root', join(root, 'other'), '--src', 'src', '--out', otherOut]).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', { schemaVersion: '1.0.0', query: 'formatUser', role: 'implementation', beforeIndex: beforeOut, afterIndex: afterOut })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', otherOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    expect(capsule.freshness.state).toBe('unknown')
  })
})

describe('freshness classification (unit-level)', () => {
  it('TST-B4-031/033: caller-supplied changed-surface with no before/after diff never counts as fresh proof', () => {
    const fresh = classifyFreshness({
      role: 'test-implementation',
      activeIndexPath: '/repo/.my-dev-kit',
      beforeIndexPath: null,
      afterIndexPath: null,
      diffRequested: false,
      changedSurface: { available: true, diffRequested: false, files: [{ path: 'src/a.ts', status: 'unknown', provenance: 'caller' }], symbols: [], conflicts: [], warnings: [] },
      readRepositoryHeadCommitFn: () => null,
      repoRoot: '/repo',
    })
    expect(fresh.state).toBe('unknown')

    const noEvidence = classifyFreshness({
      role: null,
      activeIndexPath: '/repo/.my-dev-kit',
      beforeIndexPath: null,
      afterIndexPath: null,
      diffRequested: false,
      changedSurface: { available: false, diffRequested: false, files: [], symbols: [], conflicts: [], warnings: [] },
      readRepositoryHeadCommitFn: () => null,
      repoRoot: '/repo',
    })
    expect(noEvidence.state).toBe('unknown')
  })

  it('section 21.6: the real (non-injected) readRepositoryHeadCommit wraps Git and never throws, even outside a repository', () => {
    // Uses the real default reader (no readRepositoryHeadCommitFn override) against a
    // freshly created temp directory that is never a Git repository.
    const root = createTempRoot('my-dev-kit-v1-fresh-git-safe-')
    expect(() =>
      classifyFreshness({
        role: null,
        activeIndexPath: join(root, '.my-dev-kit'),
        beforeIndexPath: null,
        afterIndexPath: null,
        diffRequested: false,
        changedSurface: { available: false, diffRequested: false, files: [], symbols: [], conflicts: [], warnings: [] },
        repoRoot: root,
      })
    ).not.toThrow()
  })
})
