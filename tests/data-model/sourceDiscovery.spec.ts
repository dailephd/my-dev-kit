import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverSourceFiles } from '../../src/indexing/discoverSourceFiles.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function makeTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'mdk-source-discovery-'))
  tempDirs.push(root)
  mkdirSync(join(root, 'src'), { recursive: true })
  return root
}

function write(relativePath: string, contents: string, root: string): void {
  const fullPath = join(root, relativePath)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, contents, 'utf8')
}

describe('data-model source discovery audit', () => {
  it('discovers .ts, .tsx, .js, .jsx, and .py files through the existing indexing path', () => {
    const root = makeTempRepo()
    write('src/model.ts', 'export interface User { id: string }\n', root)
    write('src/view.tsx', 'export interface CardModel { title: string }\nexport const Card = () => <div />\n', root)
    write('src/util.js', 'export const value = 1\n', root)
    write('src/component.jsx', 'export const Widget = () => <div />\n', root)
    write('src/tasks.py', 'def task():\n    return 1\n', root)

    const result = discoverSourceFiles({
      repoRoot: root,
      sourceRoots: ['src'],
    })

    const paths = result.files.map((file) => file.relPath)
    expect(paths).toContain('src/model.ts')
    expect(paths).toContain('src/view.tsx')
    expect(paths).toContain('src/util.js')
    expect(paths).toContain('src/component.jsx')
    expect(paths).toContain('src/tasks.py')
  })

  it('keeps ignored generated, cache, and dependency directories out of discovery', () => {
    const root = makeTempRepo()
    write('src/node_modules/pkg/ignored.ts', 'export const a = 1\n', root)
    write('src/.cache/ignored.ts', 'export const b = 1\n', root)
    write('src/coverage/ignored.ts', 'export const c = 1\n', root)
    write('src/__pycache__/ignored.py', 'def ignored():\n    pass\n', root)
    write('src/real.ts', 'export const real = 1\n', root)

    const result = discoverSourceFiles({
      repoRoot: root,
      sourceRoots: ['src'],
    })

    const paths = result.files.map((file) => file.relPath)
    expect(paths).toContain('src/real.ts')
    expect(paths.some((filePath) => filePath.includes('node_modules'))).toBe(false)
    expect(paths.some((filePath) => filePath.includes('.cache'))).toBe(false)
    expect(paths.some((filePath) => filePath.includes('coverage'))).toBe(false)
    expect(paths.some((filePath) => filePath.includes('__pycache__'))).toBe(false)
  })

  it('currently excludes .prisma and .sql files as unsupported by the general indexing path', () => {
    const root = makeTempRepo()
    write('src/schema.prisma', 'model User { id String @id }\n', root)
    write('src/query.sql', 'select * from users;\n', root)
    write('src/model.ts', 'export interface User { id: string }\n', root)

    const result = discoverSourceFiles({
      repoRoot: root,
      sourceRoots: ['src'],
    })

    const indexedPaths = result.files.map((file) => file.relPath)
    const skippedPaths = result.sampleSkippedFiles.map((file) => file.path)
    expect(indexedPaths).toContain('src/model.ts')
    expect(indexedPaths).not.toContain('src/schema.prisma')
    expect(indexedPaths).not.toContain('src/query.sql')
    expect(result.skippedUnsupportedFiles).toBeGreaterThanOrEqual(2)
    expect(skippedPaths).toContain('src/schema.prisma')
    expect(skippedPaths).toContain('src/query.sql')
  })

  it('documents the MVP extraction decision: use indexed TypeScript files and defer schema sources', () => {
    const root = makeTempRepo()
    write('src/a.ts', 'export interface A { id: string }\n', root)
    write('src/b.tsx', 'export type B = { id: string }\n', root)
    write('src/schema.prisma', 'model User { id String @id }\n', root)

    const result = discoverSourceFiles({
      repoRoot: root,
      sourceRoots: ['src'],
    })

    const indexedPaths = result.files.map((file) => file.relPath).sort()
    // Current decision: the extraction MVP can safely consume indexed .ts/.tsx files.
    // Prisma and SQL remain deferred until a separate discovery or parser path exists.
    expect(indexedPaths.filter((filePath) => filePath.endsWith('.ts') || filePath.endsWith('.tsx'))).toEqual([
      'src/a.ts',
      'src/b.tsx',
    ])
    expect(indexedPaths.some((filePath) => filePath.endsWith('.prisma'))).toBe(false)
  })
})
