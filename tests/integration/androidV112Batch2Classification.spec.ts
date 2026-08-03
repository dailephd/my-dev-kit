/**
 * v1.12.0 Batch 2 integration gate: complete Android classification vocabulary,
 * edit guidance, risk labels, and generated-build-path evidence over the
 * canonical combined Android fixture (app + core library modules).
 * TST-203, TST-206, TST-207, TST-208, TST-209, TST-220, TST-221, TST-222,
 * TST-223, TST-224, TST-225, TST-226.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'
import { CANONICAL_FIXTURE_ROOT } from './androidV110CombinedFixture.spec.js'

const tempDirs: string[] = []
function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-v112-batch2-'))
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

function readJson(dir: string, relPath: string): any {
  return JSON.parse(readFileSync(join(dir, relPath), 'utf8'))
}

describe('v1.12.0 Batch 2: schema, analyzer, and Batch 1 preservation', () => {
  it('TST-203/TST-211: schema stays 1.1.0 (not bumped), one classification analyzer, Batch 1 project/module classifications unchanged', () => {
    const classification = readJson(outDir, 'classification.json')
    expect(classification.schemaVersion).toBe('1.1.0')

    const manifest = readJson(outDir, 'manifest.json')
    expect(manifest.analyzers.filter((a: any) => a.id === 'classification')).toHaveLength(1)

    const projectEntry = classification.entries.find((e: any) => e.targetId === 'android-project:root')
    expect(projectEntry.classifications).toEqual([{ role: 'android-project', subtype: null, confidence: 'certain' }])
    expect(projectEntry.editGuidance).toBe('read-only-reference')
  })

  it('TST-206/TST-207: manifest file and component classifications appear with fixed categories and advisory risks', () => {
    const classification = readJson(outDir, 'classification.json')
    const manifestFileEntries = classification.entries.filter((e: any) => e.classifications.some((c: any) => c.role === 'android-manifest'))
    expect(manifestFileEntries.length).toBeGreaterThan(0)
    for (const entry of manifestFileEntries) {
      expect(entry.classifications.map((c: any) => c.role).sort()).toEqual(['android-manifest', 'configuration-file'].sort())
      expect(entry.editGuidance).toBe('inspect-before-edit')
    }

    const componentEntries = classification.entries.filter((e: any) => e.classifications.some((c: any) => c.role === 'manifest-component'))
    expect(componentEntries.length).toBeGreaterThan(0)
    for (const entry of componentEntries) {
      expect(entry.risks).toEqual(expect.arrayContaining(['emulator-validation-required', 'instrumented-test-required']))
    }
    // The combined fixture declares exported/permission/intent-filter evidence, so at least one manifest artifact carries the security risk.
    expect(classification.entries.some((e: any) => e.risks.includes('manifest-security-risk'))).toBe(true)
  })

  it('TST-208: navigation graph/destination/deep-link/compose-route nodes get navigation-route classifications', () => {
    const classification = readJson(outDir, 'classification.json')
    const navEntries = classification.entries.filter((e: any) => e.classifications.some((c: any) => c.role === 'navigation-route'))
    expect(navEntries.length).toBeGreaterThan(0)
    for (const entry of navEntries) {
      expect(entry.editGuidance).toBe('inspect-before-edit')
      expect(entry.risks).toEqual(expect.arrayContaining(['emulator-validation-required', 'instrumented-test-required']))
    }
    // android-navigation-action is explicitly excluded from navigation-route.
    const graph = readJson(outDir, 'code-graph.json')
    const actionNodeIds = new Set(graph.nodes.filter((n: any) => n.kind === 'android-navigation-action').map((n: any) => n.id))
    expect(navEntries.some((e: any) => actionNodeIds.has(e.targetId))).toBe(false)
  })

  it('TST-209: resource files and definitions get resource-file/xml-layout with platform-sensitive guidance', () => {
    const classification = readJson(outDir, 'classification.json')
    const layoutEntries = classification.entries.filter((e: any) => e.classifications.some((c: any) => c.role === 'xml-layout'))
    expect(layoutEntries.length).toBeGreaterThan(0)
    for (const entry of layoutEntries) {
      expect(entry.classifications.map((c: any) => c.role)).toEqual(expect.arrayContaining(['resource-file', 'xml-layout']))
      expect(entry.editGuidance).toBe('safe-primary-edit-target')
    }
    // network_security_config.xml / file_paths.xml are baseType 'xml' resource files -> platform-sensitive.
    const graph = readJson(outDir, 'code-graph.json')
    const xmlFileNodes = graph.nodes.filter((n: any) => n.kind === 'android-resource-file' && n.androidMetadata?.baseType === 'xml')
    expect(xmlFileNodes.length).toBeGreaterThan(0)
    for (const node of xmlFileNodes) {
      const entry = classification.entries.find((e: any) => e.targetId === node.id)
      expect(entry.editGuidance).toBe('inspect-before-edit')
      expect(entry.risks).toContain('resource-contract-risk')
    }
  })

  it('detailed/compact parity: every classified android-* graph node resolves to a matching detailed entry', () => {
    const classification = readJson(outDir, 'classification.json')
    const graph = readJson(outDir, 'code-graph.json')
    const androidNodes = graph.nodes.filter((n: any) => typeof n.kind === 'string' && n.kind.startsWith('android-') && n.classificationRoles)
    expect(androidNodes.length).toBeGreaterThan(0)
    for (const node of androidNodes) {
      const refId = node.classificationRefs[0].id
      const entry = classification.entries.find((e: any) => e.id === refId)
      expect(entry).toBeTruthy()
      expect(node.classificationRoles.map((r: any) => r.role).sort()).toEqual(entry.classifications.map((c: any) => c.role).sort())
      expect(node.classificationRoles[0].editGuidance).toBe(entry.editGuidance)
      expect(node.classificationRoles[0].readiness).toBe(entry.readiness)
      expect(node.classificationRoles[0].uncertainty).toBe(entry.uncertainty)
    }
  })

  it('TST-225: generic lookup --resolve-classification resolves a manifest-file classification', () => {
    const graph = readJson(outDir, 'code-graph.json')
    const manifestFileNode = graph.nodes.find((n: any) => n.kind === 'android-manifest-file')
    const result = runCli(['lookup', '--index', outDir, '--node', manifestFileNode.id, '--resolve-classification', '--json'])
    expect(result.status).toBe(0)
    const parsed = json(result)
    expect(parsed.classificationDetail.classifications.map((c: any) => c.role)).toEqual(expect.arrayContaining(['android-manifest']))
  })

  it('TST-226: a repeated index run produces identical Batch 2 classification entry IDs and ordering', () => {
    const secondRoot = createTempRoot()
    const secondOut = join(secondRoot, 'out')
    const result = runCli([
      'index', '--root', CANONICAL_FIXTURE_ROOT,
      '--src', 'app/src/main', '--src', 'core/src/main',
      '--out', secondOut, '--json',
    ])
    expect(result.status).toBe(0)
    const first = readJson(outDir, 'classification.json')
    const second = readJson(secondOut, 'classification.json')
    expect(first.entries.map((e: any) => e.id)).toEqual(second.entries.map((e: any) => e.id))
    expect(first.entries.map((e: any) => e.classifications)).toEqual(second.entries.map((e: any) => e.classifications))
  })
})

describe('v1.12.0 Batch 2: non-Android compatibility and stale-evidence removal', () => {
  it('TST-220: a non-Android project produces no Batch 2 categories and an unchanged file/symbol classification shape', () => {
    const root = createTempRoot()
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'models.ts'), 'export interface User {\n  id: string\n}\n')
    const nonAndroidOut = join(root, 'out')
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', nonAndroidOut, '--json'])
    expect(result.status).toBe(0)

    const classification = readJson(nonAndroidOut, 'classification.json')
    expect(classification.schemaVersion).toBe('1.1.0')
    const batch2Categories = ['android-manifest', 'manifest-component', 'navigation-route', 'resource-file', 'xml-layout', 'compose-screen', 'compose-ui-component', 'ui-event', 'android-unit-test', 'instrumented-test', 'compose-ui-test']
    expect(classification.entries.some((e: any) => e.classifications.some((c: any) => batch2Categories.includes(c.role)))).toBe(false)
  })

  it('TST-221: missing optional Android artifacts (no manifest/navigation/resources/Compose/tests) degrade safely', () => {
    const root = createTempRoot()
    write(root, 'settings.gradle.kts', 'rootProject.name = "t"\ninclude(":app")\n')
    write(root, 'app/build.gradle.kts', 'plugins {\n    id("com.android.application")\n}\n\nandroid {\n    namespace = "com.example"\n    compileSdk = 34\n}\n')
    write(root, 'app/src/main/AndroidManifest.xml', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application/></manifest>\n')
    write(root, 'app/src/main/kotlin/com/example/X.kt', 'package com.example\nclass X\n')
    const out = join(root, 'out')
    const result = runCli(['index', '--root', root, '--src', 'app/src/main/kotlin', '--out', out, '--json'])
    expect(result.status).toBe(0)
    const classification = readJson(out, 'classification.json')
    expect(classification.entries.some((e: any) => e.targetId === 'android-module:app')).toBe(true)
    expect(classification.entries.some((e: any) => e.classifications.some((c: any) => c.role === 'compose-screen'))).toBe(false)
  })

  it('TST-223/TST-224: removing a resource definition removes its stale classification and is reported by the existing graph-diff', () => {
    const root = createTempRoot()
    write(root, 'settings.gradle.kts', 'rootProject.name = "t"\ninclude(":app")\n')
    write(root, 'app/build.gradle.kts', 'plugins {\n    id("com.android.application")\n}\n\nandroid {\n    namespace = "com.example"\n    compileSdk = 34\n}\n')
    write(root, 'app/src/main/AndroidManifest.xml', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application/></manifest>\n')
    write(root, 'app/src/main/res/values/strings.xml', '<resources><string name="app_name">Demo</string></resources>\n')
    write(root, 'app/src/main/kotlin/com/example/X.kt', 'package com.example\nclass X\n')

    const beforeOut = join(root, 'before')
    const beforeResult = runCli(['index', '--root', root, '--src', 'app/src/main/kotlin', '--out', beforeOut, '--json'])
    expect(beforeResult.status).toBe(0)
    const beforeClassification = readJson(beforeOut, 'classification.json')
    const removedEntry = beforeClassification.entries.find((e: any) => e.classifications.some((c: any) => c.subtype === 'string'))
    expect(removedEntry).toBeTruthy()

    rmSync(join(root, 'app', 'src', 'main', 'res', 'values', 'strings.xml'))
    const afterOut = join(root, 'after')
    const afterResult = runCli(['index', '--root', root, '--src', 'app/src/main/kotlin', '--out', afterOut, '--json'])
    expect(afterResult.status).toBe(0)
    const afterClassification = readJson(afterOut, 'classification.json')
    expect(afterClassification.entries.some((e: any) => e.id === removedEntry.id)).toBe(false)

    const diffResult = runCli(['graph-diff', '--before', beforeOut, '--after', afterOut, '--json'])
    expect(diffResult.status).toBe(0)
    const diff = json(diffResult)
    expect(diff.classification.removed).toContain(removedEntry.id)
    expect(diff.nodes.removed.map((n: any) => n.id)).toContain(removedEntry.targetId)
  })
})

function write(root: string, relPath: string, content: string): void {
  const full = join(root, ...relPath.split('/'))
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}
