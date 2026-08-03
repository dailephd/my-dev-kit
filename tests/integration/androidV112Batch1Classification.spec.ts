/**
 * v1.12.0 Batch 1 integration gate: android-project:root node,
 * android-project-contains-module edges, project/module classification,
 * compact/detailed parity, combined classification.json schema 1.1.0, single
 * classification analyzer, lookup resolution, and non-Android compatibility.
 * TST-001, TST-002, TST-003, TST-004, TST-005, TST-007, TST-009, TST-010,
 * TST-011, TST-012, TST-013.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'
import { CANONICAL_FIXTURE_ROOT } from './androidV110CombinedFixture.spec.js'

const tempDirs: string[] = []
function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-v112-batch1-'))
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

function readJson(relPath: string): any {
  return JSON.parse(readFileSync(join(outDir, relPath), 'utf8'))
}

describe('v1.12.0 Batch 1: android-project:root and android-project-contains-module', () => {
  it('TST-001/TST-002: exactly one project root node, one edge per module, no missing/invented targets', () => {
    const graph = readJson('code-graph.json')
    const projectNodes = graph.nodes.filter((n: any) => n.id === 'android-project:root')
    expect(projectNodes).toHaveLength(1)
    expect(projectNodes[0].kind).toBe('android-project')

    const moduleNodes = graph.nodes.filter((n: any) => n.kind === 'android-module')
    expect(moduleNodes.length).toBeGreaterThanOrEqual(2)

    const edges = graph.edges.filter((e: any) => e.kind === 'android-project-contains-module')
    expect(edges).toHaveLength(moduleNodes.length)
    expect(edges.every((e: any) => e.source === 'android-project:root')).toBe(true)
    const edgeTargets = edges.map((e: any) => e.target).sort()
    expect(edgeTargets).toEqual(moduleNodes.map((n: any) => n.id).sort())
  })
})

describe('v1.12.0 Batch 1: classification schema, analyzer, and combined artifact', () => {
  it('TST-011: classification.json reports schema 1.1.0, manifest reports one classification analyzer', () => {
    const classification = readJson('classification.json')
    expect(classification.schemaVersion).toBe('1.1.0')

    const manifest = readJson('manifest.json')
    const classificationAnalyzers = manifest.analyzers.filter((a: any) => a.id === 'classification')
    expect(classificationAnalyzers).toHaveLength(1)
    expect(classificationAnalyzers[0].schemaVersion).toBe('1.1.0')
    expect(classificationAnalyzers[0].summary.entryCount).toBe(classification.entries.length)
    expect(classificationAnalyzers[0].warningCount).toBe(classification.summary.warningCount)
  })

  it('TST-003/TST-004/TST-005: project root, app module, and library module receive the required Batch 1 classifications', () => {
    const classification = readJson('classification.json')
    const projectEntry = classification.entries.find((e: any) => e.targetId === 'android-project:root')
    expect(projectEntry).toBeTruthy()
    expect(projectEntry.classifications.map((c: any) => c.role)).toEqual(['android-project'])
    expect(projectEntry.editGuidance).toBe('read-only-reference')
    expect(projectEntry.readiness).toBe('ready')
    expect(projectEntry.uncertainty).toBe('certain')

    const graph = readJson('code-graph.json')
    const appModuleNode = graph.nodes.find((n: any) => n.kind === 'android-module' && n.androidMetadata?.moduleType === 'app')
    const libModuleNode = graph.nodes.find((n: any) => n.kind === 'android-module' && n.androidMetadata?.moduleType === 'library')
    expect(appModuleNode).toBeTruthy()
    expect(libModuleNode).toBeTruthy()

    const appEntry = classification.entries.find((e: any) => e.targetId === appModuleNode.id)
    expect(appEntry.classifications.map((c: any) => c.role).sort()).toEqual(['android-app-module', 'gradle-module'].sort())
    expect(appEntry.editGuidance).toBe('inspect-before-edit')
    expect(appEntry.readiness).toBe('ready')
    expect(appEntry.uncertainty).toBe('certain')

    const libEntry = classification.entries.find((e: any) => e.targetId === libModuleNode.id)
    expect(libEntry.classifications.map((c: any) => c.role).sort()).toEqual(['android-library-module', 'gradle-module'].sort())
    expect(libEntry.editGuidance).toBe('inspect-before-edit')
    expect(libEntry.readiness).toBe('ready')
    expect(libEntry.uncertainty).toBe('certain')
  })

  it('TST-007: compact classificationRoles/classificationRefs on graph nodes match the detailed classification.json entries', () => {
    const graph = readJson('code-graph.json')
    const classification = readJson('classification.json')

    const projectNode = graph.nodes.find((n: any) => n.id === 'android-project:root')
    expect(projectNode.classificationRoles).toBeTruthy()
    expect(projectNode.classificationRefs).toBeTruthy()
    const projectRefId = projectNode.classificationRefs[0].id
    const projectEntry = classification.entries.find((e: any) => e.id === projectRefId)
    expect(projectEntry.targetId).toBe('android-project:root')
    expect(projectNode.classificationRoles.map((r: any) => r.role).sort()).toEqual(
      projectEntry.classifications.map((c: any) => c.role).sort()
    )

    for (const moduleNode of graph.nodes.filter((n: any) => n.kind === 'android-module')) {
      expect(moduleNode.classificationRoles).toBeTruthy()
      const refId = moduleNode.classificationRefs[0].id
      const entry = classification.entries.find((e: any) => e.id === refId)
      expect(entry.targetId).toBe(moduleNode.id)
      expect(moduleNode.classificationRoles.map((r: any) => r.role).sort()).toEqual(
        entry.classifications.map((c: any) => c.role).sort()
      )
    }
  })

  it('TST-012: lookup --resolve-classification resolves detailed classification for the project root and a module', () => {
    const projectResult = runCli(['lookup', '--index', outDir, '--node', 'android-project:root', '--resolve-classification', '--json'])
    expect(projectResult.status).toBe(0)
    const projectParsed = json(projectResult)
    expect(projectParsed.classificationDetail).toMatchObject({
      targetId: 'android-project:root',
      targetKind: 'graph-node',
      classifications: [expect.objectContaining({ role: 'android-project' })],
    })

    const graph = readJson('code-graph.json')
    const appModuleId = graph.nodes.find((n: any) => n.kind === 'android-module' && n.androidMetadata?.moduleType === 'app').id
    const moduleResult = runCli(['lookup', '--index', outDir, '--node', appModuleId, '--resolve-classification', '--json'])
    expect(moduleResult.status).toBe(0)
    const moduleParsed = json(moduleResult)
    expect(moduleParsed.classificationDetail.targetId).toBe(appModuleId)
    expect(moduleParsed.classificationDetail.classifications.some((c: any) => c.role === 'android-app-module')).toBe(true)
  })

  it('TST-010: a repeated index run produces identical project/module classification entry IDs and ordering', () => {
    const secondRoot = createTempRoot()
    const secondOut = join(secondRoot, 'out')
    const secondResult = runCli([
      'index', '--root', CANONICAL_FIXTURE_ROOT,
      '--src', 'app/src/main', '--src', 'core/src/main',
      '--out', secondOut, '--json',
    ])
    expect(secondResult.status).toBe(0)

    const first = readJson('classification.json')
    const second = JSON.parse(readFileSync(join(secondOut, 'classification.json'), 'utf8'))
    const graphNodeIds = (artifact: any) =>
      artifact.entries.filter((e: any) => e.targetKind === 'graph-node').map((e: any) => e.id)
    expect(graphNodeIds(first)).toEqual(graphNodeIds(second))
  })
})

describe('v1.12.0 Batch 1: non-Android compatibility and stale-output removal', () => {
  it('TST-009: a non-Android project produces no project root, no project/module edges, no Android classifications', () => {
    const root = createTempRoot()
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'index.ts'), 'export const x = 1\n')
    const nonAndroidOut = join(root, 'out')

    const result = runCli(['index', '--root', root, '--src', 'src', '--out', nonAndroidOut, '--json'])
    expect(result.status).toBe(0)

    const graph = JSON.parse(readFileSync(join(nonAndroidOut, 'code-graph.json'), 'utf8'))
    expect(graph.nodes.some((n: any) => n.id === 'android-project:root')).toBe(false)
    expect(graph.edges.some((e: any) => e.kind === 'android-project-contains-module')).toBe(false)

    const classification = JSON.parse(readFileSync(join(nonAndroidOut, 'classification.json'), 'utf8'))
    expect(classification.schemaVersion).toBe('1.1.0')
    expect(classification.entries.some((e: any) => e.targetKind === 'graph-node')).toBe(false)
  })

  it('TST-013: rebuilding a non-Android project into an output directory that previously had Android classifications removes them', () => {
    const root = createTempRoot()
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'index.ts'), 'export const x = 1\n')
    const reusedOut = join(root, 'out')

    const androidResult = runCli([
      'index', '--root', CANONICAL_FIXTURE_ROOT,
      '--src', 'app/src/main', '--src', 'core/src/main',
      '--out', reusedOut, '--json',
    ])
    expect(androidResult.status).toBe(0)
    const beforeGraph = JSON.parse(readFileSync(join(reusedOut, 'code-graph.json'), 'utf8'))
    expect(beforeGraph.nodes.some((n: any) => n.id === 'android-project:root')).toBe(true)

    const nonAndroidResult = runCli(['index', '--root', root, '--src', 'src', '--out', reusedOut, '--json'])
    expect(nonAndroidResult.status).toBe(0)

    const afterGraph = JSON.parse(readFileSync(join(reusedOut, 'code-graph.json'), 'utf8'))
    expect(afterGraph.nodes.some((n: any) => n.id === 'android-project:root')).toBe(false)
    expect(afterGraph.edges.some((e: any) => e.kind === 'android-project-contains-module')).toBe(false)

    const afterClassification = JSON.parse(readFileSync(join(reusedOut, 'classification.json'), 'utf8'))
    expect(afterClassification.entries.some((e: any) => e.targetKind === 'graph-node')).toBe(false)
  })
})
