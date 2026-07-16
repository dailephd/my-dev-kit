import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

// v1.10.1 Batch 2: focus-file and focus-symbol intake operationalization.
// Responsibility IDs: TST-B2-008, TST-B2-009, TST-B2-010, TST-B2-011, TST-B2-029.

let outDir = ''
let capsuleOut = ''

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-context-focus-'))
  const result = runCli(['index', '--root', 'examples/basic-ts', '--src', 'src', '--out', outDir])
  expect(result.status).toBe(0)
  capsuleOut = join(outDir, 'context-capsule.json')
})

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

function writeRequestFile(name: string, body: unknown): string {
  const filePath = join(outDir, name)
  writeFileSync(filePath, JSON.stringify(body, null, 2))
  return filePath
}

describe('context focus intake', () => {
  it('TST-B2-008: a valid indexed focus file resolves and contributes candidates', () => {
    const requestPath = writeRequestFile('focus-file-valid.json', {
      schemaVersion: '1.0.0',
      query: 'describeUser',
      role: 'implementation',
      focusFiles: ['src/userTypes.ts'],
    })
    const result = runCli(['context', '--index', outDir, '--request', requestPath, '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.roleContext.focus.focusFiles).toEqual([
      {
        path: 'src/userTypes.ts',
        resolved: true,
        matchedFilePaths: ['src/userTypes.ts'],
        containedSymbolIds: ['symbol:src/userTypes.ts#User', 'symbol:src/userTypes.ts#UserRole'],
      },
    ])
    expect(capsule.roleContext.focus.unresolvedFocusFiles).toEqual([])
    const userTypesCandidate = capsule.candidateFiles.find((f: { path: string }) => f.path === 'src/userTypes.ts')
    expect(userTypesCandidate).toBeDefined()
    expect(userTypesCandidate.focusMatch).toBe(true)
  })

  it('TST-B2-009: a valid but missing focus file is reported honestly, no evidence invented', () => {
    const requestPath = writeRequestFile('focus-file-missing.json', {
      schemaVersion: '1.0.0',
      query: 'describeUser',
      role: 'implementation',
      focusFiles: ['src/does-not-exist.ts'],
    })
    const result = runCli(['context', '--index', outDir, '--request', requestPath, '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.roleContext.focus.unresolvedFocusFiles).toEqual(['src/does-not-exist.ts'])
    expect(capsule.roleContext.focus.focusFiles[0]).toEqual({
      path: 'src/does-not-exist.ts',
      resolved: false,
      matchedFilePaths: [],
      containedSymbolIds: [],
    })
    expect(capsule.warnings.some((w: string) => w.includes('src/does-not-exist.ts') && w.includes('did not match'))).toBe(true)
    expect(capsule.candidateFiles.some((f: { path: string }) => f.path === 'src/does-not-exist.ts')).toBe(false)
  })

  it('TST-B2-010: an exact stable-ID focus symbol resolves deterministically', () => {
    const requestPath = writeRequestFile('focus-symbol-exact.json', {
      schemaVersion: '1.0.0',
      query: 'unrelated query text',
      role: 'implementation',
      focusSymbols: ['symbol:src/userService.ts#formatUser'],
    })
    const first = runCli(['context', '--index', outDir, '--request', requestPath, '--out', capsuleOut])
    expect(first.status).toBe(0)
    const firstCapsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(firstCapsule.roleContext.focus.focusSymbols).toEqual([
      { symbol: 'symbol:src/userService.ts#formatUser', resolved: true, ambiguous: false, matchedNodeIds: ['symbol:src/userService.ts#formatUser'] },
    ])
    expect(firstCapsule.focus.focusNodeId).toBe('symbol:src/userService.ts#formatUser')

    const second = runCli(['context', '--index', outDir, '--request', requestPath, '--out', capsuleOut])
    expect(second.status).toBe(0)
    const secondCapsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(secondCapsule.focus.focusNodeId).toBe(firstCapsule.focus.focusNodeId)
    expect(secondCapsule.candidateNodes.map((n: { nodeId: string; score: number }) => [n.nodeId, n.score])).toEqual(
      firstCapsule.candidateNodes.map((n: { nodeId: string; score: number }) => [n.nodeId, n.score])
    )
  })

  it('TST-B2-011: an ambiguous simple-name focus symbol preserves ambiguity (no auto-selection)', () => {
    const ambiguousRoot = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-context-focus-ambiguous-'))
    try {
      const src = join(ambiguousRoot, 'src')
      const subA = join(src, 'a')
      const subB = join(src, 'b')
      mkdirSync(subA, { recursive: true })
      mkdirSync(subB, { recursive: true })
      writeFileSync(join(subA, 'ownerA.ts'), 'export function run(): number { return 1 }\n')
      writeFileSync(join(subB, 'ownerB.ts'), 'export function run(): number { return 2 }\n')
      const ambIndex = join(ambiguousRoot, '.my-dev-kit')
      const indexResult = runCli(['index', '--root', ambiguousRoot, '--src', 'src', '--out', ambIndex])
      expect(indexResult.status).toBe(0)

      const requestPath = join(ambiguousRoot, 'focus-symbol-ambiguous.json')
      writeFileSync(
        requestPath,
        JSON.stringify({ schemaVersion: '1.0.0', query: 'run', role: 'implementation', focusSymbols: ['run'] }, null, 2)
      )
      const capsulePath = join(ambiguousRoot, 'capsule.json')
      const result = runCli(['context', '--index', ambIndex, '--request', requestPath, '--out', capsulePath])
      expect(result.status).toBe(0)
      const capsule = JSON.parse(readFileSync(capsulePath, 'utf8'))
      expect(capsule.roleContext.focus.ambiguousFocusSymbols).toEqual(['run'])
      const resolution = capsule.roleContext.focus.focusSymbols[0]
      expect(resolution.resolved).toBe(false)
      expect(resolution.ambiguous).toBe(true)
      expect(resolution.matchedNodeIds.length).toBe(2)
      expect(capsule.warnings.some((w: string) => w.includes('"run"') && w.includes('ambiguity was preserved'))).toBe(true)
    } finally {
      rmSync(ambiguousRoot, { recursive: true, force: true })
    }
  })

  it('TST-B2-029: focus paths with spaces and normalized separators resolve correctly', () => {
    const spacedRoot = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-context-focus-spaces-'))
    try {
      const src = join(spacedRoot, 'src', 'has spaces')
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, 'owner file.ts'), 'export function ownerFn(): number { return 1 }\n')
      const spacedIndex = join(spacedRoot, '.my-dev-kit')
      const indexResult = runCli(['index', '--root', spacedRoot, '--src', 'src', '--out', spacedIndex])
      expect(indexResult.status).toBe(0)

      const requestPath = join(spacedRoot, 'focus-spaces.json')
      writeFileSync(
        requestPath,
        JSON.stringify(
          { schemaVersion: '1.0.0', query: 'ownerFn', role: 'implementation', focusFiles: ['src/has spaces/owner file.ts'] },
          null,
          2
        )
      )
      const capsulePath = join(spacedRoot, 'out with spaces', 'capsule.json')
      const result = runCli(['context', '--index', spacedIndex, '--request', requestPath, '--out', capsulePath])
      expect(result.status).toBe(0)
      expect(existsSync(capsulePath)).toBe(true)
      const capsule = JSON.parse(readFileSync(capsulePath, 'utf8'))
      expect(capsule.roleContext.focus.focusFiles[0].resolved).toBe(true)
      expect(capsule.roleContext.focus.unresolvedFocusFiles).toEqual([])
    } finally {
      rmSync(spacedRoot, { recursive: true, force: true })
    }
  })
})
