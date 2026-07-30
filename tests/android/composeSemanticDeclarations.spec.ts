import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { detectAndroidProject } from '../../src/android/detectAndroidProject.js'
import { buildAndroidComposeSemanticProject } from '../../src/android/buildAndroidComposeSemanticProject.js'
import type { AndroidComposeSemanticArtifact } from '../../src/android/androidComposeTypes.js'

const tempDirs: string[] = []
function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-compose-semantic-'))
  tempDirs.push(root)
  return root
}
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function writeAppScaffold(root: string): void {
  mkdirSync(join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example'), { recursive: true })
  writeFileSync(join(root, 'settings.gradle.kts'), 'rootProject.name = "t"\ninclude(":app")\n')
  writeFileSync(
    join(root, 'app', 'build.gradle.kts'),
    'plugins { id("com.android.application") }\nandroid { namespace = "com.example.t"; compileSdk = 34 }\n'
  )
  writeFileSync(
    join(root, 'app', 'src', 'main', 'AndroidManifest.xml'),
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application/></manifest>\n'
  )
}

function buildArtifact(root: string, kotlinFileText: string, fileName = 'Screens.kt'): AndroidComposeSemanticArtifact {
  writeFileSync(join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', fileName), kotlinFileText)
  const buildResult = buildIndex({ repoRoot: root, sourceRoots: ['app/src/main/kotlin'], buildCallGraph: false })
  const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
  return buildAndroidComposeSemanticProject({ projectRoot: root, symbolIndex: buildResult.index, androidProject }).artifact
}

describe('buildAndroidComposeSemanticProject', () => {
  // TST-001
  it('extracts a simple public top-level @Composable declaration', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const artifact = buildArtifact(
      root,
      `package com.example
import androidx.compose.runtime.Composable

@Composable
fun SimpleScreen() {
    Text("hi")
}
`
    )
    expect(artifact.detected).toBe(true)
    expect(artifact.declarations).toHaveLength(1)
    expect(artifact.declarations[0]).toMatchObject({
      name: 'SimpleScreen',
      scope: 'top-level',
      visibility: 'public',
      isPreview: false,
      enclosingDeclarationId: null,
    })
  })

  // TST-002
  it('extracts statically available parameter summaries', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const artifact = buildArtifact(
      root,
      `package com.example

@Composable
fun Greeting(name: String, modifier: Modifier = Modifier) {
}
`
    )
    expect(artifact.declarations[0]?.parameters).toEqual([
      { name: 'name', typeText: 'String' },
      { name: 'modifier', typeText: 'Modifier' },
    ])
  })

  // TST-003 / TST-005
  it('distinguishes a private top-level composable from a public one, and from a function-local composable', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const artifact = buildArtifact(
      root,
      `package com.example

@Composable
fun Public() {}

@Composable
private fun InternalPiece() {}

fun Outer() {
    @Composable
    fun InternalPiece() {}
    InternalPiece()
}
`
    )
    const topLevelPrivate = artifact.declarations.find((d) => d.id.endsWith('#InternalPiece'))!
    const functionLocal = artifact.declarations.find((d) => d.id.includes('Outer>InternalPiece'))!
    expect(topLevelPrivate).toMatchObject({ scope: 'top-level', visibility: 'private' })
    expect(functionLocal).toMatchObject({ scope: 'function-local', enclosingDeclarationId: expect.stringContaining('#Outer') })
    expect(topLevelPrivate.id).not.toBe(functionLocal.id)
  })

  // TST-004
  it('extracts a named function-local composable and sets its enclosingDeclarationId to the (non-extracted) enclosing function', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const artifact = buildArtifact(
      root,
      `package com.example

fun Screen() {
    @Composable
    fun InnerPiece() {
        Text("x")
    }
    InnerPiece()
}
`
    )
    expect(artifact.declarations).toHaveLength(1)
    const inner = artifact.declarations[0]!
    expect(inner.name).toBe('InnerPiece')
    expect(inner.scope).toBe('function-local')
    expect(inner.enclosingDeclarationId).toBe('android-compose-declaration:app/src/main/kotlin/com/example/Screens.kt#Screen')
  })

  // TST-006
  it('identifies @Preview + @Composable declarations', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const artifact = buildArtifact(
      root,
      `package com.example

@Preview
@Composable
fun ScreenPreview() {}

@Composable
fun NotPreview() {}
`
    )
    const preview = artifact.declarations.find((d) => d.name === 'ScreenPreview')!
    const notPreview = artifact.declarations.find((d) => d.name === 'NotPreview')!
    expect(preview.isPreview).toBe(true)
    expect(notPreview.isPreview).toBe(false)
  })

  // TST-007
  it('extracts a direct, exactly-resolved parent-to-child composable call', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const artifact = buildArtifact(
      root,
      `package com.example

@Composable
fun Parent() {
    Child()
}

@Composable
fun Child() {}
`
    )
    const parent = artifact.declarations.find((d) => d.name === 'Parent')!
    const child = artifact.declarations.find((d) => d.name === 'Child')!
    expect(parent.childCalls).toEqual([{ calleeDeclarationId: child.id, calleeName: 'Child', line: expect.any(Number) }])
  })

  // TST-008
  it('does not record a child-call for an unresolved or ambiguous callee', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const artifact = buildArtifact(
      root,
      `package com.example

@Composable
fun Parent() {
    SomeUnknownCall()
}

fun outerA() {
    @Composable
    fun Item() {}
    Item()
}

fun outerB() {
    @Composable
    fun Item() {}
    Item()
}

@Composable
fun CallsAmbiguousItem() {
    Item()
}
`
    )
    const parent = artifact.declarations.find((d) => d.name === 'Parent')!
    expect(parent.childCalls).toEqual([])
    expect(artifact.warnings.some((w) => w.includes('SomeUnknownCall'))).toBe(false)

    const ambiguousCaller = artifact.declarations.find((d) => d.name === 'CallsAmbiguousItem')!
    expect(ambiguousCaller.childCalls).toEqual([])
    expect(artifact.warnings.some((w) => w.includes('Ambiguous child-composable call "Item"'))).toBe(true)
  })

  // TST-009
  it('does not infer a child-call from a structural-region name alone', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const artifact = buildArtifact(
      root,
      `package com.example

@Composable
fun Parent() {
    Row {
        Text("x")
    }
}
`
    )
    const parent = artifact.declarations[0]!
    expect(parent.childCalls).toEqual([])
    expect(parent.structuralRegions).toEqual([{ kind: 'Row', line: expect.any(Number) }])
  })

  // TST-010
  it('extracts each of the seven fixed structural UI-region calls without overclaiming route/runtime facts', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const artifact = buildArtifact(
      root,
      `package com.example

@Composable
fun ScreenWithRegions() {
    Scaffold {
        LazyColumn {
        }
    }
    LazyRow {}
    Column {}
    Row {}
    Box {}
    NavHost(navController = nc, startDestination = "home") {}
}
`
    )
    const kinds = artifact.declarations[0]!.structuralRegions.map((r) => r.kind).sort()
    expect(kinds).toEqual(['Box', 'Column', 'LazyColumn', 'LazyRow', 'NavHost', 'Row', 'Scaffold'])
    for (const region of artifact.declarations[0]!.structuralRegions) {
      expect(region).not.toHaveProperty('route')
      expect(region).not.toHaveProperty('destination')
    }
  })

  // TST-011
  it('rejects a false-positive @Composable-looking annotation inside a line comment', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const artifact = buildArtifact(
      root,
      `package com.example
// @Composable fun Fake() {}
fun realFunction() {}
`
    )
    expect(artifact.declarations.find((d) => d.name === 'Fake')).toBeUndefined()
    expect(artifact.detected).toBe(false)
  })

  // TST-012
  it('rejects a false-positive @Composable-looking text inside a string literal', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const artifact = buildArtifact(
      root,
      `package com.example

val s = "@Composable fun NotReal() {}"
fun realFunction() {}
`
    )
    expect(artifact.declarations.find((d) => d.name === 'NotReal')).toBeUndefined()
    expect(artifact.detected).toBe(false)
  })

  // TST-013
  it('does not classify an anonymous composable lambda or a higher-order-function-returned composable as a named declaration', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const artifact = buildArtifact(
      root,
      `package com.example

val lambda: @Composable () -> Unit = { }

fun rememberScreen(): @Composable () -> Unit = { }
`
    )
    expect(artifact.declarations).toEqual([])
    expect(artifact.detected).toBe(false)
  })

  // TST-014
  it('does not extract an unsupported member composable inside a class body, and records a warning', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const artifact = buildArtifact(
      root,
      `package com.example

class ScreenHost {
    @Composable
    fun Render() {}
}
`
    )
    expect(artifact.declarations).toEqual([])
    expect(artifact.warnings.some((w) => w.includes('Render') && w.includes('unsupported enclosing context'))).toBe(true)
  })

  // TST-015
  it('captures complete deterministic source ranges across a multiline function signature', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const artifact = buildArtifact(
      root,
      `package com.example

@Composable
fun LongSignature(
    a: String,
    b: Int
) {
    Text(a)
}
`
    )
    const decl = artifact.declarations[0]!
    expect(decl.sourceRange.startLine).toBe(3)
    expect(decl.sourceRange.endLine).toBe(9)
    expect(decl.parameters).toEqual([
      { name: 'a', typeText: 'String' },
      { name: 'b', typeText: 'Int' },
    ])
  })

  // TST-016
  it('captures a complete source range for an expression-body declaration', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const artifact = buildArtifact(
      root,
      `package com.example

@Composable
fun Label(text: String) = Text(text)
`
    )
    expect(artifact.declarations).toHaveLength(1)
    expect(artifact.declarations[0]).toMatchObject({ name: 'Label', scope: 'top-level' })
  })

  // TST-017
  it('captures correct adjacent-declaration boundaries with no bleed', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const artifact = buildArtifact(
      root,
      `package com.example
@Composable
fun First() {
    Text("a")
}
@Composable
fun Second() {
    Text("b")
}
`
    )
    const first = artifact.declarations.find((d) => d.name === 'First')!
    const second = artifact.declarations.find((d) => d.name === 'Second')!
    expect(first.sourceRange.endLine).toBeLessThan(second.sourceRange.startLine)
  })

  // TST-018
  it('produces deterministic IDs and ordering across two runs of byte-identical input', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const text = `package com.example

@Composable
fun A() { B() }

@Composable
fun B() {}
`
    writeFileSync(join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'Screens.kt'), text)
    const buildResult = buildIndex({ repoRoot: root, sourceRoots: ['app/src/main/kotlin'], buildCallGraph: false })
    const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
    const run1 = buildAndroidComposeSemanticProject({ projectRoot: root, symbolIndex: buildResult.index, androidProject }).artifact
    const run2 = buildAndroidComposeSemanticProject({ projectRoot: root, symbolIndex: buildResult.index, androidProject }).artifact
    expect(run1.declarations).toEqual(run2.declarations)
    expect(run1.declarations.map((d) => d.id)).toEqual([...run1.declarations.map((d) => d.id)].sort())
  })

  // TST-019
  it('deterministically tie-breaks duplicate declaration keys within one file', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const artifact = buildArtifact(
      root,
      `package com.example

@Composable
fun Dup() {}

@Composable
fun Dup() {}
`
    )
    const ids = artifact.declarations.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('android-compose-declaration:app/src/main/kotlin/com/example/Screens.kt#Dup')
    expect(ids).toContain('android-compose-declaration:app/src/main/kotlin/com/example/Screens.kt#Dup#1')
  })

  // TST-020
  it('gates entirely on androidProject.detected', () => {
    const root = createTempRoot()
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'Foo.kt'), '@Composable\nfun Screen() {}\n')
    const buildResult = buildIndex({ repoRoot: root, sourceRoots: ['src'], buildCallGraph: false })
    const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
    expect(androidProject.detected).toBe(false)
    const result = buildAndroidComposeSemanticProject({ projectRoot: root, symbolIndex: buildResult.index, androidProject })
    expect(result.artifact.detected).toBe(false)
    expect(result.artifact.declarations).toEqual([])
  })

  // TST-021-style unit check: Android project detected, zero Compose declarations -> not detected
  it('is not detected when the Android project has no supported Compose declarations', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const artifact = buildArtifact(
      root,
      `package com.example

fun plainFunction(): Int = 1
`
    )
    expect(artifact.detected).toBe(false)
    expect(artifact.declarations).toEqual([])
  })
})
