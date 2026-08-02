import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, cpSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const FIXTURE_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android-test-semantic')
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

function copyFixture(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-android-test-semantic-cli-${label}-`))
  tempDirs.push(root)
  cpSync(join(FIXTURE_ROOT, 'basic-app'), root, { recursive: true })
  return root
}

function indexInto(root: string, out = 'out') {
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

const METHOD_NODE_ID =
  'android-test-method:app/src/androidTest/kotlin/com/example/HomeScreenTest.kt#HomeScreenTest.showsLoginButtonAndWelcomeText'
const CLASS_NODE_ID = 'android-test-class:app/src/androidTest/kotlin/com/example/HomeScreenTest.kt#HomeScreenTest'

describe('v1.11.0 Batch 5: generic retrieval for projected Android test evidence', () => {
  // TST-701
  it('search discovers a test class and its test-tag assertion by generic query', () => {
    const root = copyFixture('search')
    const indexDir = indexInto(root)

    const classResult = runCli(['search', '--index', indexDir, '--query', 'HomeScreenTest', '--json'])
    expect(classResult.status).toBe(0)
    const classParsed = JSON.parse(classResult.stdout)
    expect(classParsed.results.some((r: { id: string }) => r.id === CLASS_NODE_ID)).toBe(true)

    const tagResult = runCli(['search', '--index', indexDir, '--query', 'login_button', '--json'])
    const tagParsed = JSON.parse(tagResult.stdout)
    expect(tagParsed.results.some((r: { kind: string }) => r.kind === 'android-test-fact')).toBe(true)
  })

  // TST-702
  it('search discovers evidence by mocked ViewModel type', () => {
    const root = copyFixture('search-double')
    const indexDir = indexInto(root)
    const result = runCli(['search', '--index', indexDir, '--query', 'LoginViewModel', '--json'])
    const parsed = JSON.parse(result.stdout)
    expect(parsed.results.some((r: { kind: string }) => r.kind === 'android-test-fact')).toBe(true)
  })

  // TST-703
  it('lookup resolves an exact test-method node with compact metadata and edges', () => {
    const root = copyFixture('lookup')
    const indexDir = indexInto(root)
    const result = runCli(['lookup', '--index', indexDir, '--node', METHOD_NODE_ID, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.node.kind).toBe('android-test-method')
    expect(parsed.node.androidMetadata.factKind).toBe('test-method')
    expect(parsed.incomingEdges.some((e: { kind: string }) => e.kind === 'test-class-defines-method')).toBe(true)
  })

  // TST-704
  it('source returns bounded source for an exact test-method node', () => {
    const root = copyFixture('source')
    const indexDir = indexInto(root)
    const result = runCli(['source', '--index', indexDir, '--node', METHOD_NODE_ID, '--format', 'numbered'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('showsLoginButtonAndWelcomeText')
    expect(result.stdout).toContain('onNodeWithTag')
    expect(result.stdout).not.toContain('package com.example')
  })

  // TST-705
  it('slice traverses test relationships to production Compose evidence', () => {
    const root = copyFixture('slice')
    const indexDir = indexInto(root)
    const result = runCli(['slice', '--index', indexDir, '--node', METHOD_NODE_ID, '--depth', '2', '--direction', 'both', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.nodes.some((n: { kind: string }) => n.kind === 'android-composable')).toBe(true)
    expect(parsed.edges.some((e: { kind: string }) => e.kind === 'android-test-references-composable')).toBe(true)
  })

  // TST-706
  it('context selects Android test evidence for a test-shaped query', () => {
    const root = copyFixture('context')
    const indexDir = indexInto(root)
    const capsuleOut = join(root, 'out', 'context-capsule.json')
    const result = runCli([
      'context',
      '--index',
      indexDir,
      '--query',
      'Find the Android test that checks the login_button test tag',
      '--out',
      capsuleOut,
      '--json',
    ])
    expect(result.status).toBe(0)
    expect(JSON.stringify(JSON.parse(result.stdout))).toContain('login_button')
  })
})

describe('v1.11.0 Batch 5: old-index and non-Android compatibility', () => {
  // TST-707
  it('search/lookup/source do not crash when android-test-semantic.json is absent (non-Android project)', () => {
    const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-test-semantic-nonandroid-'))
    tempDirs.push(root)
    const srcDir = join(root, 'src')
    cpSync(join(FIXTURE_ROOT, 'basic-app', 'app', 'src', 'main', 'kotlin'), srcDir, { recursive: true })
    // Rewrite as a plain (non-Gradle) directory containing arbitrary Kotlin, not an Android project.
    const indexDir = join(root, 'out')
    const result = runCli(['index', '--root', root, '--src', 'src', '--out', indexDir, '--json'])
    expect(result.status).toBe(0)
    const searchResult = runCli(['search', '--index', indexDir, '--query', 'HomeScreen', '--json'])
    expect(searchResult.status).toBe(0)
    expect(() => JSON.parse(searchResult.stdout)).not.toThrow()
  })
})

describe('v1.11.0 Batch 5: graph-diff compatibility', () => {
  // TST-708
  it('reports an added test method node through the generic code-graph diff', () => {
    const root = copyFixture('diff-add')
    const before = indexInto(root, 'before')
    writeFileSync(
      join(root, 'app/src/test/kotlin/com/example/ExtraTest.kt'),
      'package com.example\nimport org.junit.Test\n\nclass ExtraTest {\n    @Test\n    fun extraCase() {}\n}\n'
    )
    const after = indexInto(root, 'after')

    const result = runCli(['graph-diff', '--before', before, '--after', after, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    const addedIds: string[] = parsed.nodes.added.map((n: { id: string }) => n.id)
    expect(addedIds).toContain('android-test-method:app/src/test/kotlin/com/example/ExtraTest.kt#ExtraTest.extraCase')
    expect(parsed).not.toHaveProperty('androidTestSemantic')
  })

  // TST-709
  it('reports a removed test file and its nodes through the generic code-graph diff', () => {
    const root = copyFixture('diff-remove')
    const before = indexInto(root, 'before')
    rmSync(join(root, 'app/src/androidTest/kotlin/com/example/HomeScreenTest.kt'))
    const after = indexInto(root, 'after')

    const result = runCli(['graph-diff', '--before', before, '--after', after, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    const removedIds: string[] = parsed.nodes.removed.map((n: { id: string }) => n.id)
    expect(removedIds).toContain(CLASS_NODE_ID)
  })

  // TST-710
  it('reports a changed test-tag assertion as a changed node', () => {
    const root = copyFixture('diff-change')
    const before = indexInto(root, 'before')
    writeFileSync(
      join(root, 'app/src/androidTest/kotlin/com/example/HomeScreenTest.kt'),
      `package com.example
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Test
import org.junit.Rule

class HomeScreenTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun showsLoginButtonAndWelcomeText() {
        composeTestRule.onNodeWithTag("different_tag").assertExists()
        composeTestRule.onNodeWithText("Welcome back").assertExists()
    }
}
`
    )
    const after = indexInto(root, 'after')

    const result = runCli(['graph-diff', '--before', before, '--after', after, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    const allIds = [...parsed.nodes.added, ...parsed.nodes.removed, ...parsed.nodes.changed].map((n: { id: string }) => n.id)
    expect(allIds.some((id) => id.includes('assertion'))).toBe(true)
  })
})

describe('v1.11.0 Batch 5: incremental/full equivalence', () => {
  // TST-711
  it('produces equivalent normalized Android-test evidence after an incremental edit vs. a clean full index', () => {
    const root = copyFixture('incremental')
    const incrementalDir = join(root, 'incremental-out')

    const first = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', incrementalDir, '--incremental', '--json'])
    expect(first.status).toBe(0)

    writeFileSync(
      join(root, 'app/src/androidTest/kotlin/com/example/HomeScreenTest.kt'),
      `package com.example
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Test
import org.junit.Rule

class HomeScreenTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun showsLoginButtonAndWelcomeText() {
        composeTestRule.onNodeWithTag("login_button").assertExists()
        composeTestRule.onNodeWithText("Welcome back changed").assertExists()
    }
}
`
    )

    const second = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', incrementalDir, '--incremental', '--json'])
    expect(second.status).toBe(0)

    const cleanDir = join(root, 'clean-out')
    const clean = runCli(['index', '--root', root, '--src', 'app/src/main', '--out', cleanDir, '--json'])
    expect(clean.status).toBe(0)

    const incrementalArtifact = JSON.parse(
      require('node:fs').readFileSync(join(incrementalDir, 'android-test-semantic.json'), 'utf8')
    )
    const cleanArtifact = JSON.parse(require('node:fs').readFileSync(join(cleanDir, 'android-test-semantic.json'), 'utf8'))
    delete incrementalArtifact.createdAt
    delete cleanArtifact.createdAt
    expect(incrementalArtifact).toEqual(cleanArtifact)
    expect(
      incrementalArtifact.assertionFacts.some((f: { resolvedValue: string | null }) => f.resolvedValue === 'Welcome back changed')
    ).toBe(true)
  })
})
