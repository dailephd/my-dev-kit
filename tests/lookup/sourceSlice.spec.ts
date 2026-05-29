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
