import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

// v1.10.1 Batch 3: deterministic per-group truncation and repeated-run stability.
// Responsibility IDs: TST-B3-025 (plus cross-platform path smoke, section 31.8).

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

describe('deterministic per-group truncation and stability', () => {
  it('TST-B3-025: truncation is deterministic and preserves stable (sorted) order across repeated runs', () => {
    const root = createTempRoot('my-dev-kit-v1-det-truncation-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    for (let i = 0; i < 12; i++) {
      const suffix = String(i).padStart(2, '0')
      writeFileSync(join(src, `widgetError${suffix}.ts`), `export class WidgetError${suffix} extends Error {}\n`)
    }
    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', { schemaVersion: '1.0.0', query: 'widget error', role: 'implementation' })
    const outPath = join(root, 'capsule.json')

    const runs = [0, 1, 2].map(() => {
      const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
      expect(result.status).toBe(0)
      const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
      delete capsule.generatedAt
      return capsule
    })

    expect(runs[1].evidenceGroups).toEqual(runs[0].evidenceGroups)
    expect(runs[2].evidenceGroups).toEqual(runs[0].evidenceGroups)
    expect(runs[1].groupTruncation).toEqual(runs[0].groupTruncation)

    const errorsGroup = runs[0].evidenceGroups.find((g: { kind: string }) => g.kind === 'errors')
    expect(errorsGroup).toBeDefined()
    if (errorsGroup.truncated) {
      const paths = errorsGroup.items.map((i: { path: string }) => i.path)
      // With no score-based signal beyond identical naming heuristics, ties are
      // broken by path — so the retained subset must be a stable, sorted prefix.
      const sorted = [...paths].sort((a, b) => a.localeCompare(b))
      const scores = errorsGroup.items.map((i: { metadata?: { score?: number } }) => i.metadata?.score ?? 0)
      const allTied = scores.every((s: number) => s === scores[0])
      if (allTied) expect(paths).toEqual(sorted)
    }
  })

  it('cross-platform path smoke: a project root containing spaces indexes and retrieves evidence groups correctly', () => {
    const root = createTempRoot('my-dev-kit-v1-det-spaces ')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'widgetRegistry.ts'), 'export function registerWidget(name: string): void {}\n')
    writeFileSync(join(src, 'widgetRegistry.spec.ts'), "import { registerWidget } from './widgetRegistry'\nexport const check = registerWidget\n")
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'space-fixture', version: '0.0.0', scripts: { test: 'vitest run' } }, null, 2))
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

    expect(capsule.testInfrastructure.relatedTests.some((t: { path: string }) => t.path === 'src/widgetRegistry.spec.ts')).toBe(true)
    expect(capsule.testInfrastructure.testCommands.some((c: { commandText: string | null }) => c.commandText === 'vitest run src/widgetRegistry.spec.ts')).toBe(true)
    // Every path in the capsule stays forward-slash-normalized and project-relative,
    // never leaking a native (backslash) absolute temp path into stable evidence.
    // (Escaped JSON quotes such as \" are not path separators and are excluded here.)
    const serialized = JSON.stringify(capsule.testInfrastructure)
    expect(/[A-Za-z]:\\|\\[A-Za-z]/.test(serialized)).toBe(false)
  })
})
