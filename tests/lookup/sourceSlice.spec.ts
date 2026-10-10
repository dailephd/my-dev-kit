import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureInsideProjectRoot, getSourceSlice, validateLineRange } from '../../src/lookup/getSourceSlice.js'
import { resolveSymbolTarget } from '../../src/lookup/resolveSourceTarget.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-source-slice-'))
  tempDirs.push(root)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'a.ts'), 'one\ntwo\nthree\nfour\n')
  return root
}

describe('source slice helpers', () => {
  it('normalizes and contains project-root paths', () => {
    const root = fixture()
    expect(ensureInsideProjectRoot(root, 'src/a.ts')).toContain('src')
    expect(() => ensureInsideProjectRoot(root, '../secret.txt')).toThrow('escapes')
  })

  it('slices a line range with deterministic output shape', () => {
    const root = fixture()
    const slice = getSourceSlice({
      indexDir: '.my-dev-kit-v1',
      projectRoot: root,
      filePath: 'src/a.ts',
      startLine: 2,
      endLine: 3,
      maxLines: 10,
      mode: 'line-range',
    })
    expect(slice.content).toBe('two\nthree')
    expect(slice.lineCount).toBe(2)
  })

  it('enforces max line cap', () => {
    expect(() => validateLineRange(1, 3, 2)).toThrow('exceeds --max-lines')
  })

  it('resolves symbol target when fixture has location data', () => {
    const symbolIndex: SymbolIndex = {
      schemaVersion: '2',
      buildTime: 'now',
      repoRoot: '/repo',
      sourceRoots: ['src'],
      fileCount: 1,
      symbolCount: 1,
      files: [{
        path: 'src/a.ts',
        language: 'typescript',
        lineCount: 4,
        imports: [],
        exports: ['hello'],
        hasCallGraphEntries: false,
        symbols: [{ name: 'hello', kind: 'function', exported: true, location: { file: 'src/a.ts', line: 2 } }],
      }],
    }
    expect(resolveSymbolTarget(symbolIndex, 'src/a.ts', 'hello', 160).startLine).toBe(2)
  })
})

function indexWith(location: { line: number; endLine?: number }, lineCount = 40): SymbolIndex {
  return {
    schemaVersion: '2',
    buildTime: 'now',
    repoRoot: '/repo',
    sourceRoots: ['src'],
    fileCount: 1,
    symbolCount: 1,
    files: [{
      path: 'src/a.ts',
      language: 'typescript',
      lineCount,
      imports: [],
      exports: ['hello'],
      hasCallGraphEntries: false,
      symbols: [{ name: 'hello', kind: 'function', exported: true, location: { file: 'src/a.ts', ...location } }],
    }],
  }
}

describe('resolveSymbolTarget known versus unknown boundaries', () => {
  it('uses the exact end, uncapped by the 20-line preview, for a valid boundary', () => {
    const target = resolveSymbolTarget(indexWith({ line: 2, endLine: 31 }), 'src/a.ts', 'hello', 160)
    expect(target.startLine).toBe(2)
    expect(target.endLine).toBe(31)
    expect(target.symbolEndLine).toBe(31)
    expect(target.warnings).toEqual([])
  })

  it('caps a known window at maxLines', () => {
    const target = resolveSymbolTarget(indexWith({ line: 2, endLine: 31 }), 'src/a.ts', 'hello', 8)
    expect(target.endLine).toBe(9)
    expect(target.symbolEndLine).toBe(31)
  })

  it.each([
    ['absent endLine', { line: 2 }],
    ['endLine before start', { line: 5, endLine: 4 }],
    ['endLine beyond file', { line: 2, endLine: 41 }],
    ['non-integer endLine', { line: 2, endLine: 3.5 }],
  ])('retains the conservative preview for %s', (_label, location) => {
    const target = resolveSymbolTarget(indexWith(location), 'src/a.ts', 'hello', 160)
    expect(target.symbolEndLine).toBeUndefined()
    expect(target.endLine).toBe(Math.min(40, location.line + 19))
    expect(target.warnings[0]).toContain('start line only')
  })
})

describe('getSourceSlice with a known symbol end', () => {
  function longFile(): string {
    const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-source-slice-end-'))
    tempDirs.push(root)
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'a.ts'), Array.from({ length: 12 }, (_, i) => `line${i + 1}`).join('\n') + '\n')
    return root
  }
  const base = { indexDir: '.idx', filePath: 'src/a.ts', mode: 'symbol' as const, maxLines: 10 }

  it('emits a known-boundary window-capped cursor while the symbol is incomplete', () => {
    const slice = getSourceSlice({ ...base, projectRoot: longFile(), startLine: 1, endLine: 4, symbolEndLine: 8 })
    expect(slice.continuationCursor).toMatchObject({ nextStartLine: 5, symbolBoundaryKnown: true, reason: 'window-capped', eof: false })
  })

  it('stops at the symbol end and emits no cursor into the following declaration', () => {
    const slice = getSourceSlice({ ...base, projectRoot: longFile(), startLine: 5, endLine: 10, symbolEndLine: 8 })
    expect(slice.endLine).toBe(8)
    expect(slice.content).toBe('line5\nline6\nline7\nline8')
    expect(slice.continuationCursor).toBeUndefined()
  })

  it('fails with a stale mismatch when the file is shorter than the indexed end', () => {
    expect(() =>
      getSourceSlice({ ...base, projectRoot: longFile(), startLine: 1, endLine: 4, symbolEndLine: 30 })
    ).toThrow('Stale index/source mismatch')
  })

  it('keeps the unknown-boundary cursor when no symbol end is supplied', () => {
    const slice = getSourceSlice({ ...base, projectRoot: longFile(), startLine: 1, endLine: 4 })
    expect(slice.continuationCursor).toMatchObject({ symbolBoundaryKnown: false, reason: 'symbol-end-unknown' })
  })
})
