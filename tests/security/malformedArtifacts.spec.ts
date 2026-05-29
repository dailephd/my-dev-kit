import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readIndexManifest } from '../../src/indexing/readIndexManifest.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

function makeIndexDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mdk-sec-artifacts-'))
  tempDirs.push(dir)
  return dir
}

function writeManifest(dir: string, content: unknown): void {
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(content), 'utf8')
}

const validManifest = {
  artifactKind: 'my-dev-kit-v1-manifest',
  version: '1.0.0',
  projectRoot: '/some/project',
  sourceRoots: ['src'],
  artifacts: {
    symbolIndex: 'symbol-index.json',
    codeGraph: 'code-graph.json',
    callGraph: null,
  },
}

describe('malformed artifact handling', () => {
  it('rejects a missing manifest', () => {
    const dir = makeIndexDir()
    expect(() => readIndexManifest(dir)).toThrow('Missing index manifest')
  })

  it('rejects non-JSON manifest content', () => {
    const dir = makeIndexDir()
    writeFileSync(join(dir, 'manifest.json'), 'not json at all { ]', 'utf8')
    expect(() => readIndexManifest(dir)).toThrow('Invalid JSON')
  })

  it('rejects a manifest with wrong artifactKind', () => {
    const dir = makeIndexDir()
    writeManifest(dir, { ...validManifest, artifactKind: 'malicious-kind' })
    expect(() => readIndexManifest(dir)).toThrow('artifactKind')
  })

  it('rejects a manifest missing version', () => {
    const dir = makeIndexDir()
    const { version: _v, ...rest } = validManifest
    writeManifest(dir, rest)
    expect(() => readIndexManifest(dir)).toThrow('version')
  })

  it('rejects a manifest missing projectRoot', () => {
    const dir = makeIndexDir()
    const { projectRoot: _p, ...rest } = validManifest
    writeManifest(dir, rest)
    expect(() => readIndexManifest(dir)).toThrow('projectRoot')
  })

  it('rejects a manifest with non-array sourceRoots', () => {
    const dir = makeIndexDir()
    writeManifest(dir, { ...validManifest, sourceRoots: 'src' })
    expect(() => readIndexManifest(dir)).toThrow('sourceRoots')
  })

  it('rejects a manifest missing symbolIndex artifact path', () => {
    const dir = makeIndexDir()
    writeManifest(dir, {
      ...validManifest,
      artifacts: { ...validManifest.artifacts, symbolIndex: '' },
    })
    expect(() => readIndexManifest(dir)).toThrow('symbolIndex')
  })

  it('rejects a manifest missing codeGraph artifact path', () => {
    const dir = makeIndexDir()
    writeManifest(dir, {
      ...validManifest,
      artifacts: { ...validManifest.artifacts, codeGraph: '' },
    })
    expect(() => readIndexManifest(dir)).toThrow('codeGraph')
  })

  it('rejects artifact paths that escape the index directory via ../', () => {
    const dir = makeIndexDir()
    writeManifest(dir, {
      ...validManifest,
      artifacts: {
        symbolIndex: '../../../etc/symbol-index.json',
        codeGraph: 'code-graph.json',
        callGraph: null,
      },
    })
    expect(() => readIndexManifest(dir)).toThrow('escapes the index directory')
  })

  it('rejects codeGraph artifact path that escapes the index directory', () => {
    const dir = makeIndexDir()
    writeManifest(dir, {
      ...validManifest,
      artifacts: {
        symbolIndex: 'symbol-index.json',
        codeGraph: '../../malicious/code-graph.json',
        callGraph: null,
      },
    })
    expect(() => readIndexManifest(dir)).toThrow('escapes the index directory')
  })

  it('accepts artifact paths that stay within the index directory', () => {
    const dir = makeIndexDir()
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'symbol-index.json'), '{}', 'utf8')
    writeFileSync(join(dir, 'code-graph.json'), '{}', 'utf8')
    writeManifest(dir, {
      ...validManifest,
      artifacts: {
        symbolIndex: 'sub/symbol-index.json',
        codeGraph: 'code-graph.json',
        callGraph: null,
      },
    })
    expect(() => readIndexManifest(dir)).not.toThrow()
  })
})
