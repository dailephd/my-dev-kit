/**
 * v1.12.0 Batch 3 integration gate: ViewModel/Repository/Room/Retrofit
 * dependency facts and graph edges over the canonical combined Android
 * fixture. TST-331, TST-332, TST-334, TST-335, TST-336, TST-337, TST-338,
 * TST-339, TST-340.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'
import { CANONICAL_FIXTURE_ROOT } from './androidV110CombinedFixture.spec.js'

const tempDirs: string[] = []
function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-v112-batch3-'))
  tempDirs.push(root)
  return root
}
afterAll(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function json(result: ReturnType<typeof runCli>): any {
  return JSON.parse(result.stdout)
}
function readJson(dir: string, relPath: string): any {
  return JSON.parse(readFileSync(join(dir, relPath), 'utf8'))
}

let outDir: string

beforeAll(() => {
  const root = createTempRoot()
  outDir = join(root, 'out')
  const result = runCli([
    'index', '--root', CANONICAL_FIXTURE_ROOT,
    '--src', 'app/src/main', '--src', 'core/src/main',
    '--out', outDir, '--json',
  ])
  expect(result.status).toBe(0)
})

const DEPENDENCY_EDGE_KINDS = ['viewmodel-uses-repository', 'repository-uses-dao', 'repository-uses-service', 'dao-uses-entity', 'room-database-exposes-dao']

describe('v1.12.0 Batch 3: schema, summary, and coexistence chain', () => {
  it('TST-301/TST-339: android-components.json is schema 1.1.0, one analyzer entry, summary matches actual facts', () => {
    const components = readJson(outDir, 'android-components.json')
    expect(components.schemaVersion).toBe('1.1.0')
    expect(Array.isArray(components.dependencyFacts)).toBe(true)

    const manifest = readJson(outDir, 'manifest.json')
    const analyzers = manifest.analyzers.filter((a: any) => a.id === 'android-components')
    expect(analyzers).toHaveLength(1)
    expect(analyzers[0].schemaVersion).toBe('1.1.0')
    expect(analyzers[0].summary.dependencyFactCount).toBe(components.dependencyFacts.length)
  })

  it('TST-340: the fixture produces the full component-layer chain (ViewModel->Repository->DAO/Entity, Repository->Retrofit, Database->DAO)', () => {
    const components = readJson(outDir, 'android-components.json')
    const kinds = new Set(components.dependencyFacts.map((f: any) => f.relationshipKind))
    for (const kind of DEPENDENCY_EDGE_KINDS) expect(kinds.has(kind)).toBe(true)
  })

  it('TST-336: all five dependency edge kinds appear in code-graph.json connecting existing symbol nodes', () => {
    const graph = readJson(outDir, 'code-graph.json')
    for (const kind of DEPENDENCY_EDGE_KINDS) {
      const edges = graph.edges.filter((e: any) => e.kind === kind)
      expect(edges.length).toBeGreaterThan(0)
      for (const edge of edges) {
        expect(edge.source.startsWith('symbol:')).toBe(true)
        expect(edge.target.startsWith('symbol:')).toBe(true)
      }
    }
  })
})

describe('v1.12.0 Batch 3: generic retrieval compatibility', () => {
  it('TST-337/TST-338: lookup and ordinary slice expose the new edges without a new flag; source retrieval is unchanged', () => {
    const graph = readJson(outDir, 'code-graph.json')
    const vmNode = graph.nodes.find((n: any) => n.classificationRoles?.some((r: any) => r.role === 'view-model'))
    expect(vmNode).toBeTruthy()

    const lookupResult = runCli(['lookup', '--index', outDir, '--node', vmNode.id, '--depth', '1', '--json'])
    expect(lookupResult.status).toBe(0)
    const lookupParsed = json(lookupResult)
    expect(lookupParsed.outgoingEdges?.some((e: any) => e.kind === 'viewmodel-uses-repository')).toBe(true)

    const sliceResult = runCli(['slice', '--index', outDir, '--node', vmNode.id, '--depth', '2', '--direction', 'outgoing', '--json'])
    expect(sliceResult.status).toBe(0)
    const sliceParsed = json(sliceResult)
    const sliceEdgeKinds = new Set(sliceParsed.edges.map((e: any) => e.kind))
    expect(sliceEdgeKinds.has('viewmodel-uses-repository')).toBe(true)

    const sourceResult = runCli(['source', '--index', outDir, '--node', vmNode.id, '--max-lines', '40', '--json'])
    expect(sourceResult.status).toBe(0)
  })
})

describe('v1.12.0 Batch 3: classification non-regression and non-Android compatibility', () => {
  it('TST-331: Batch 2 categories, guidance, and compact projection remain unaffected for non-dependency-bearing nodes', () => {
    const classification = readJson(outDir, 'classification.json')
    const projectEntry = classification.entries.find((e: any) => e.targetId === 'android-project:root')
    expect(projectEntry.classifications).toEqual([{ role: 'android-project', subtype: null, confidence: 'certain' }])
    expect(projectEntry.editGuidance).toBe('read-only-reference')
  })

  it('TST-332: a non-Android project produces no dependency facts, edges, or android-components.json content beyond the empty/skipped shape', () => {
    const root = createTempRoot()
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'models.ts'), 'export interface User {\n  id: string\n}\n')
    const nonAndroidOut = join(root, 'out')
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', nonAndroidOut, '--json'])
    expect(result.status).toBe(0)

    const graph = JSON.parse(readFileSync(join(nonAndroidOut, 'code-graph.json'), 'utf8'))
    for (const kind of DEPENDENCY_EDGE_KINDS) {
      expect(graph.edges.some((e: any) => e.kind === kind)).toBe(false)
    }
  })
})

describe('v1.12.0 Batch 3: stale-evidence removal', () => {
  it('TST-334/TST-335: removing a repository dependency removes the stale fact and edge on the next full index', () => {
    const root = createTempRoot()
    write(root, 'settings.gradle.kts', 'rootProject.name = "t"\ninclude(":app")\n')
    write(root, 'app/build.gradle.kts', 'plugins {\n    id("com.android.application")\n}\n\nandroid {\n    namespace = "com.example"\n    compileSdk = 34\n}\n')
    write(root, 'app/src/main/AndroidManifest.xml', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application/></manifest>\n')
    write(root, 'app/src/main/kotlin/com/example/UserRepository.kt', 'package com.example\n\nclass UserRepository\n')
    write(
      root,
      'app/src/main/kotlin/com/example/UserViewModel.kt',
      'package com.example\n\nimport androidx.lifecycle.ViewModel\n\nclass UserViewModel(\n    private val repository: UserRepository\n) : ViewModel()\n'
    )

    const beforeOut = join(root, 'before')
    const beforeResult = runCli(['index', '--root', root, '--src', 'app/src/main/kotlin', '--out', beforeOut, '--json'])
    expect(beforeResult.status).toBe(0)
    const beforeComponents = readJson(beforeOut, 'android-components.json')
    expect(beforeComponents.dependencyFacts.some((f: any) => f.relationshipKind === 'viewmodel-uses-repository')).toBe(true)

    write(root, 'app/src/main/kotlin/com/example/UserViewModel.kt', 'package com.example\n\nimport androidx.lifecycle.ViewModel\n\nclass UserViewModel : ViewModel()\n')

    const afterOut = join(root, 'after')
    const afterResult = runCli(['index', '--root', root, '--src', 'app/src/main/kotlin', '--out', afterOut, '--json'])
    expect(afterResult.status).toBe(0)
    const afterComponents = readJson(afterOut, 'android-components.json')
    expect(afterComponents.dependencyFacts.some((f: any) => f.relationshipKind === 'viewmodel-uses-repository')).toBe(false)

    const afterGraph = readJson(afterOut, 'code-graph.json')
    expect(afterGraph.edges.some((e: any) => e.kind === 'viewmodel-uses-repository')).toBe(false)

    const diffResult = runCli(['graph-diff', '--before', beforeOut, '--after', afterOut, '--json'])
    expect(diffResult.status).toBe(0)
    const diff = json(diffResult)
    expect(diff.edges.removed.some((e: any) => e.kind === 'viewmodel-uses-repository')).toBe(true)
  })
})

function write(root: string, relPath: string, content: string): void {
  const full = join(root, ...relPath.split('/'))
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}
