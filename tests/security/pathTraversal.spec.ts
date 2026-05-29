import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureInsideProjectRoot } from '../../src/lookup/getSourceSlice.js'
import { isInsideRoot } from '../../src/io/pathUtils.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function makeTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mdk-sec-path-'))
  tempDirs.push(dir)
  return dir
}

describe('path traversal guards', () => {
  describe('ensureInsideProjectRoot', () => {
    it('accepts paths inside the project root', () => {
      const root = makeTemp()
      mkdirSync(join(root, 'src'))
      writeFileSync(join(root, 'src', 'a.ts'), '')
      expect(() => ensureInsideProjectRoot(root, 'src/a.ts')).not.toThrow()
    })

    it('accepts the root directory itself', () => {
      const root = makeTemp()
      writeFileSync(join(root, 'index.ts'), '')
      expect(() => ensureInsideProjectRoot(root, 'index.ts')).not.toThrow()
    })

    it('rejects simple parent traversal: ../', () => {
      const root = makeTemp()
      expect(() => ensureInsideProjectRoot(root, '../secret.txt')).toThrow('escapes')
    })

    it('rejects chained parent traversal: ../../etc/passwd', () => {
      const root = makeTemp()
      expect(() => ensureInsideProjectRoot(root, '../../etc/passwd')).toThrow('escapes')
    })

    it('rejects traversal that starts with a valid segment: src/../../etc', () => {
      const root = makeTemp()
      expect(() => ensureInsideProjectRoot(root, 'src/../../etc/passwd')).toThrow('escapes')
    })

    it('rejects absolute paths that escape the root', () => {
      const root = makeTemp()
      expect(() => ensureInsideProjectRoot(root, '/etc/passwd')).toThrow('escapes')
    })
  })

  describe('isInsideRoot utility', () => {
    it('returns true for a child path', () => {
      const root = makeTemp()
      expect(isInsideRoot(root, join(root, 'child', 'file.json'))).toBe(true)
    })

    it('returns true for the root itself', () => {
      const root = makeTemp()
      expect(isInsideRoot(root, root)).toBe(true)
    })

    it('returns false for parent traversal', () => {
      const root = makeTemp()
      expect(isInsideRoot(root, join(root, '..', 'sibling'))).toBe(false)
    })

    it('returns false for an unrelated absolute path', () => {
      const root = makeTemp()
      expect(isInsideRoot(root, tmpdir())).toBe(false)
    })
  })
})
