/**
 * v1.12.0 Batch 1: `android-project:root` node and
 * `android-project-contains-module` edges added to
 * buildAndroidArtifactRelationships. TST-001, TST-002, TST-009, TST-010.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { detectAndroidProject } from '../../src/android/detectAndroidProject.js'
import { buildAndroidGradleProject } from '../../src/android/buildAndroidGradleProject.js'
import { buildAndroidManifestProject } from '../../src/android/buildAndroidManifestProject.js'
import { buildAndroidResourceProject } from '../../src/android/buildAndroidResourceProject.js'
import { buildAndroidNavigationProject } from '../../src/android/buildAndroidNavigationProject.js'
import { buildAndroidArtifactRelationships, ANDROID_PROJECT_ROOT_NODE_ID } from '../../src/android/buildAndroidArtifactRelationships.js'

const tempDirs: string[] = []
function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-project-node-'))
  tempDirs.push(root)
  return root
}
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function write(root: string, relPath: string, content: string): void {
  const full = join(root, ...relPath.split('/'))
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

function buildRelationships(root: string, sourceRoots: string[]) {
  const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
  const { artifact: androidGradle } = buildAndroidGradleProject({ projectRoot: root, androidProject })
  const { artifact: androidManifest } = buildAndroidManifestProject({ projectRoot: root, androidProject, androidGradle })
  const { artifact: androidResources } = buildAndroidResourceProject({ projectRoot: root, androidProject, androidGradle })
  const buildResult = buildIndex({ repoRoot: root, sourceRoots, buildCallGraph: false })
  const { artifact: androidNavigation } = buildAndroidNavigationProject({
    projectRoot: root,
    androidProject,
    androidGradle,
    androidResources,
    symbolIndex: buildResult.index,
  })
  return buildAndroidArtifactRelationships({
    projectRoot: root,
    androidProject,
    androidGradle,
    androidManifest,
    androidResources,
    androidNavigation,
    symbolIndex: buildResult.index,
  })
}

function scaffoldSingleModule(root: string, namespace = 'com.example'): void {
  write(root, 'settings.gradle.kts', 'rootProject.name = "t"\ninclude(":app")\n')
  write(
    root,
    'app/build.gradle.kts',
    `plugins {\n    id("com.android.application")\n}\n\nandroid {\n    namespace = "${namespace}"\n    compileSdk = 34\n}\n`
  )
  write(root, 'app/src/main/AndroidManifest.xml', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application/></manifest>\n')
  write(root, 'app/src/main/kotlin/com/example/X.kt', 'package com.example\nclass X\n')
}

function scaffoldAppAndLibrary(root: string): void {
  write(root, 'settings.gradle.kts', 'rootProject.name = "t"\ninclude(":app")\ninclude(":lib")\n')
  write(
    root,
    'app/build.gradle.kts',
    'plugins {\n    id("com.android.application")\n}\n\nandroid {\n    namespace = "com.example.app"\n    compileSdk = 34\n}\n'
  )
  write(
    root,
    'lib/build.gradle.kts',
    'plugins {\n    id("com.android.library")\n}\n\nandroid {\n    namespace = "com.example.lib"\n    compileSdk = 34\n}\n'
  )
  write(root, 'app/src/main/AndroidManifest.xml', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application/></manifest>\n')
  write(root, 'lib/src/main/AndroidManifest.xml', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"/>\n')
  write(root, 'app/src/main/kotlin/com/example/app/X.kt', 'package com.example.app\nclass X\n')
  write(root, 'lib/src/main/kotlin/com/example/lib/Y.kt', 'package com.example.lib\nclass Y\n')
}

describe('buildAndroidArtifactRelationships — android-project:root (v1.12.0 Batch 1)', () => {
  it('TST-001: adds exactly one android-project:root node with the required kind and label', () => {
    const root = createTempRoot()
    scaffoldSingleModule(root)
    const result = buildRelationships(root, ['app/src/main/kotlin'])

    const rootNodes = result.nodes.filter((n) => n.id === ANDROID_PROJECT_ROOT_NODE_ID)
    expect(rootNodes).toHaveLength(1)
    expect(rootNodes[0]!.kind).toBe('android-project')
    expect(rootNodes[0]!.label).toBe('Android project')
    expect(ANDROID_PROJECT_ROOT_NODE_ID).toBe('android-project:root')
    // No machine-specific absolute path leaks into the stable ID or label.
    expect(rootNodes[0]!.id).not.toContain(root)
    expect(rootNodes[0]!.label).not.toContain(root)
  })

  it('TST-002: adds exactly one android-project-contains-module edge per current module, no duplicates, no missing module', () => {
    const root = createTempRoot()
    scaffoldAppAndLibrary(root)
    const result = buildRelationships(root, ['app/src/main/kotlin', 'lib/src/main/kotlin'])

    const edges = result.edges.filter((e) => e.kind === 'android-project-contains-module')
    expect(edges).toHaveLength(2)
    expect(edges.every((e) => e.source === ANDROID_PROJECT_ROOT_NODE_ID)).toBe(true)
    const targets = edges.map((e) => e.target).sort()
    expect(targets).toEqual(['android-module:app', 'android-module:lib'].sort())
    // Every edge target actually exists as a node - no invented/missing module.
    for (const edge of edges) {
      expect(result.nodes.some((n) => n.id === edge.target && n.kind === 'android-module')).toBe(true)
    }
    // No duplicate edge IDs.
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length)
  })

  it('TST-009: a non-Android project produces no android-project:root node and no project-to-module edges', () => {
    const root = createTempRoot()
    write(root, 'settings.gradle.kts', 'rootProject.name = "t"\n')
    write(root, 'src/index.ts', 'export const x = 1\n')
    const result = buildRelationships(root, ['src'])

    expect(result.nodes.some((n) => n.id === ANDROID_PROJECT_ROOT_NODE_ID)).toBe(false)
    expect(result.edges.some((e) => e.kind === 'android-project-contains-module')).toBe(false)
  })

  it('TST-010: repeated runs over the same input produce identical project/edge IDs and ordering', () => {
    const root = createTempRoot()
    scaffoldAppAndLibrary(root)
    const first = buildRelationships(root, ['app/src/main/kotlin', 'lib/src/main/kotlin'])
    const second = buildRelationships(root, ['app/src/main/kotlin', 'lib/src/main/kotlin'])

    const projectEdgeIds = (r: typeof first) => r.edges.filter((e) => e.kind === 'android-project-contains-module').map((e) => e.id)
    expect(projectEdgeIds(first)).toEqual(projectEdgeIds(second))
    expect(first.nodes.map((n) => n.id)).toEqual(second.nodes.map((n) => n.id))
  })
})

describe('buildAndroidArtifactRelationships — android-generated-build-path (v1.12.0 Batch 2)', () => {
  const GENERATED_BUILD_OUTPUT_FIXTURE_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android', 'generated-build-output')

  it('TST-217: adds a bounded android-generated-build-path node for the existing app/build directory, no file enumeration', () => {
    const result = buildRelationships(GENERATED_BUILD_OUTPUT_FIXTURE_ROOT, ['app/src/main/kotlin'])
    const generatedNodes = result.nodes.filter((n) => n.kind === 'android-generated-build-path')
    expect(generatedNodes.length).toBeGreaterThan(0)
    expect(generatedNodes.some((n) => n.id === 'android-generated-build-path:app/build')).toBe(true)
    // Bounded: only the directory itself is a node, never its contents (Generated.java, intermediates/fake/*).
    expect(generatedNodes.every((n) => !n.id.includes('Generated.java') && !n.id.includes('intermediates'))).toBe(true)
    for (const node of generatedNodes) {
      expect(node.path).not.toMatch(/^[A-Za-z]:/)
    }
  })

  it('TST-223: the generated-build-path node disappears when the directory disappears (stale-evidence removal)', () => {
    const root = createTempRoot()
    write(root, 'settings.gradle.kts', 'rootProject.name = "t"\ninclude(":app")\n')
    write(root, 'app/build.gradle.kts', 'plugins {\n    id("com.android.application")\n}\n\nandroid {\n    namespace = "com.example"\n    compileSdk = 34\n}\n')
    write(root, 'app/src/main/AndroidManifest.xml', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application/></manifest>\n')
    write(root, 'app/src/main/kotlin/com/example/X.kt', 'package com.example\nclass X\n')
    write(root, 'app/build/.keep', '')

    const before = buildRelationships(root, ['app/src/main/kotlin'])
    expect(before.nodes.some((n) => n.id === 'android-generated-build-path:app/build')).toBe(true)

    rmSync(join(root, 'app', 'build'), { recursive: true, force: true })
    const after = buildRelationships(root, ['app/src/main/kotlin'])
    expect(after.nodes.some((n) => n.id === 'android-generated-build-path:app/build')).toBe(false)
  })
})
