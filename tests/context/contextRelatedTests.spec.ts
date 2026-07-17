import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

// v1.10.1 Batch 3: bounded related-test discovery via import-specifier evidence.
// Responsibility IDs: TST-B3-007, 008, 009.

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

function writeRequest(root: string, name: string, body: unknown): string {
  const filePath = join(root, name)
  writeFileSync(filePath, JSON.stringify(body, null, 2))
  return filePath
}

describe('related-test discovery', () => {
  it('TST-B3-007: a test importing a selected production symbol by name is discovered', () => {
    const root = createTempRoot('my-dev-kit-v1-relatedtest-symbol-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(
      join(src, 'widgetRegistry.ts'),
      "export function registerWidget(name: string): void { /* entry point */ }\nexport function otherThing(): void {}\n"
    )
    writeFileSync(join(src, 'widgetRegistry.spec.ts'), "import { registerWidget } from './widgetRegistry'\nexport const check = registerWidget\n")
    writeFileSync(join(src, 'unrelatedThing.spec.ts'), 'export const unrelated = 1\n')

    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'test-implementation',
      focusSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const match = capsule.testInfrastructure.relatedTests.find((t: { path: string }) => t.path === 'src/widgetRegistry.spec.ts')
    expect(match).toBeDefined()
    expect(match.relationship).toBe('references-selected-production-symbol')
  })

  it('TST-B3-008: a test related through file import (no symbol match) is discovered', () => {
    const root = createTempRoot('my-dev-kit-v1-relatedtest-file-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'widgetRegistry.ts'), 'export function registerWidget(name: string): void {}\n')
    writeFileSync(
      join(src, 'widgetRegistry.spec.ts'),
      "import * as registry from './widgetRegistry'\nexport const check = registry\n"
    )
    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'test-implementation',
      changedFiles: ['src/widgetRegistry.ts'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const match = capsule.testInfrastructure.relatedTests.find((t: { path: string }) => t.path === 'src/widgetRegistry.spec.ts')
    expect(match).toBeDefined()
    expect(match.relationship).toBe('imports-selected-production-file')
  })

  it('TST-B3-009: an unrelated test under a test-shaped path is never included solely for being test-shaped', () => {
    const root = createTempRoot('my-dev-kit-v1-relatedtest-unrelated-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'widgetRegistry.ts'), 'export function registerWidget(name: string): void {}\n')
    writeFileSync(join(src, 'widgetRegistry.spec.ts'), "import { registerWidget } from './widgetRegistry'\nexport const check = registerWidget\n")
    writeFileSync(join(src, 'completelyUnrelated.spec.ts'), "export const noImportsHere = 42\n")
    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'test-implementation',
      changedFiles: ['src/widgetRegistry.ts'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const paths = capsule.testInfrastructure.relatedTests.map((t: { path: string }) => t.path)
    expect(paths).toContain('src/widgetRegistry.spec.ts')
    expect(paths).not.toContain('src/completelyUnrelated.spec.ts')
  })
})
