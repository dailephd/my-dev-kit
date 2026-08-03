import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, cpSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const FIXTURES_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android')
const tempDirs: string[] = []

function runCli(args: string[]) {
  return spawnSync(process.execPath, [tsxCliPath(), 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
  })
}

function tsxCliPath(): string {
  return join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
}

function copyFixture(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-android-graphdiff-${name}-`))
  tempDirs.push(root)
  cpSync(join(FIXTURES_ROOT, name), root, { recursive: true })
  return root
}

function indexInto(root: string, out: string) {
  const result = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', out, '--json'])
  expect(result.status).toBe(0)
  return join(root, out)
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('graph-diff Android compatibility', () => {
  it('runs on two identical Android index directories with no crash and no differences', () => {
    const root = copyFixture('basic-kotlin-app')
    const before = indexInto(root, 'before')
    const after = indexInto(root, 'after')

    const result = runCli(['graph-diff', '--before', before, '--after', after, '--json'])

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.summary.nodesAdded).toBe(0)
    expect(parsed.summary.nodesRemoved).toBe(0)
    expect(parsed.manifest.analyzerChanges).toEqual([])
  })

  it('does not crash when android-project.json is present on both sides and reports no analyzer change', () => {
    const root = copyFixture('multi-module-app')
    const before = indexInto(root, 'before')
    const after = indexInto(root, 'after')

    const result = runCli(['graph-diff', '--before', before, '--after', after, '--json'])

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.manifest.analyzerChanges.find((c: { id: string }) => c.id === 'android-project')).toBeUndefined()
  })

  it('does not crash when one side lacks android-project.json and reports the analyzer status change', () => {
    const root = copyFixture('basic-kotlin-app')
    const before = indexInto(root, 'before')

    // Remove Android evidence before the second index run so `after` has no android-project.json.
    rmSync(join(root, 'settings.gradle.kts'), { force: true })
    rmSync(join(root, 'app', 'build.gradle.kts'), { force: true })
    const after = indexInto(root, 'after')

    const result = runCli(['graph-diff', '--before', before, '--after', after, '--json'])

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    const androidChange = parsed.manifest.analyzerChanges.find((c: { id: string }) => c.id === 'android-project')
    expect(androidChange).toEqual({ id: 'android-project', before: 'complete', after: 'skipped' })
  })

  it('reports deterministic, expected differences when a module type changes between two Android indexes', () => {
    const root = copyFixture('basic-kotlin-app')
    const before = indexInto(root, 'before')

    writeFileSync(
      join(root, 'app', 'build.gradle.kts'),
      'plugins {\n    id("com.android.library")\n    id("org.jetbrains.kotlin.android")\n}\n'
    )
    const after = indexInto(root, 'after')

    const result = runCli(['graph-diff', '--before', before, '--after', after, '--json'])

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    // As of v1.10.0 Batch 5, android-project.json's module type is projected
    // onto a compact `android-module` code-graph node (androidMetadata.moduleType),
    // so a plugin-type change is now visible as exactly one changed node —
    // no node is added or removed, since the module itself still exists.
    // (Before Batch 5, android-project.json contributed nothing to
    // code-graph.json at all, so this same edit produced zero node changes.)
    // As of v1.12.0 Batch 1, the module's compact classificationRoles also
    // change alongside androidMetadata, since app/library module type now
    // drives its `android-app-module`/`android-library-module` classification.
    expect(parsed.summary.nodesAdded).toBe(0)
    expect(parsed.summary.nodesChanged).toBe(1)
    expect(parsed.nodes.changed).toEqual([
      {
        id: 'android-module:app',
        kind: 'android-module',
        changedFields: ['androidMetadata', 'classificationRoles'],
        before: {
          androidMetadata: { moduleType: 'app' },
          classificationRoles: [
            { role: 'gradle-module', editGuidance: 'inspect-before-edit', readiness: 'ready', uncertainty: 'certain' },
            { role: 'android-app-module', editGuidance: 'inspect-before-edit', readiness: 'ready', uncertainty: 'certain' },
          ],
        },
        after: {
          androidMetadata: { moduleType: 'library' },
          classificationRoles: [
            { role: 'gradle-module', editGuidance: 'inspect-before-edit', readiness: 'ready', uncertainty: 'certain' },
            { role: 'android-library-module', editGuidance: 'inspect-before-edit', readiness: 'ready', uncertainty: 'certain' },
          ],
        },
      },
    ])
  })
})
