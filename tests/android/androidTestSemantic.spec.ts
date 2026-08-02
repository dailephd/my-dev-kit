import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectAndroidProject } from '../../src/android/detectAndroidProject.js'
import { buildAndroidTestSemanticProject } from '../../src/android/buildAndroidTestSemanticProject.js'
import type { AndroidTestSemanticArtifact } from '../../src/android/androidTestTypes.js'

const tempDirs: string[] = []
function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-test-semantic-'))
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

function writeTestFile(root: string, relDir: string, name: string, text: string): void {
  const dir = join(root, ...relDir.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), text)
}

function buildArtifact(root: string): AndroidTestSemanticArtifact {
  const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
  return buildAndroidTestSemanticProject({ projectRoot: root, androidProject }).artifact
}

describe('buildAndroidTestSemanticProject -- source-set discovery', () => {
  // TST-601
  it('discovers a JVM unit test under src/test/kotlin', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(
      root,
      'app/src/test/kotlin/com/example',
      'HomeViewModelTest.kt',
      `package com.example
import org.junit.Test

class HomeViewModelTest {
    @Test
    fun loadsData() {
    }
}
`
    )
    const artifact = buildArtifact(root)
    expect(artifact.detected).toBe(true)
    expect(artifact.testFiles).toHaveLength(1)
    expect(artifact.testFiles[0]).toMatchObject({ category: 'unit', language: 'kotlin', sourceSet: 'test' })
  })

  // TST-602
  it('discovers a JVM unit test under src/test/java', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(
      root,
      'app/src/test/java/com/example',
      'HomeViewModelTest.java',
      `package com.example;
import org.junit.Test;

public class HomeViewModelTest {
    @Test
    public void loadsData() {
    }
}
`
    )
    const artifact = buildArtifact(root)
    expect(artifact.testFiles).toHaveLength(1)
    expect(artifact.testFiles[0]).toMatchObject({ category: 'unit', language: 'java' })
  })

  // TST-603
  it('discovers an instrumented test under src/androidTest/kotlin', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(
      root,
      'app/src/androidTest/kotlin/com/example',
      'HomeScreenTest.kt',
      `package com.example
import org.junit.Test

class HomeScreenTest {
    @Test
    fun rendersScreen() {
    }
}
`
    )
    const artifact = buildArtifact(root)
    expect(artifact.testFiles[0]).toMatchObject({ category: 'instrumented', sourceSet: 'androidTest' })
  })

  // TST-604
  it('discovers an instrumented test under src/androidTest/java', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(
      root,
      'app/src/androidTest/java/com/example',
      'HomeScreenTest.java',
      `package com.example;
import org.junit.Test;

public class HomeScreenTest {
    @Test
    public void rendersScreen() {
    }
}
`
    )
    const artifact = buildArtifact(root)
    expect(artifact.testFiles[0]).toMatchObject({ category: 'instrumented', language: 'java' })
  })

  // TST-605
  it('excludes a generated/build directory under the test root', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(root, 'app/src/test/kotlin/com/example', 'RealTest.kt', 'package com.example\nimport org.junit.Test\nclass RealTest { @Test fun a() {} }\n')
    writeTestFile(root, 'app/src/test/kotlin/build/generated', 'GeneratedTest.kt', 'package generated\nimport org.junit.Test\nclass GeneratedTest { @Test fun a() {} }\n')
    const artifact = buildArtifact(root)
    expect(artifact.testFiles.map((f) => f.path)).toEqual(['app/src/test/kotlin/com/example/RealTest.kt'])
  })

  // TST-606
  it('produces no artifact when the Android project has no test/androidTest files', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    const artifact = buildArtifact(root)
    expect(artifact.detected).toBe(false)
    expect(artifact.testFiles).toEqual([])
  })

  // TST-607
  it('produces no artifact for a non-Android project', () => {
    const root = createTempRoot()
    mkdirSync(join(root, 'src', 'test'), { recursive: true })
    writeFileSync(join(root, 'src', 'test', 'Foo.kt'), 'class Foo { @Test fun a() {} }\n')
    const { artifact: androidProject } = detectAndroidProject({ projectRoot: root })
    expect(androidProject.detected).toBe(false)
    const artifact = buildAndroidTestSemanticProject({ projectRoot: root, androidProject }).artifact
    expect(artifact.detected).toBe(false)
  })
})

describe('buildAndroidTestSemanticProject -- classes and methods', () => {
  // TST-608
  it('extracts a Kotlin JUnit4 class and method', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(
      root,
      'app/src/test/kotlin/com/example',
      'FooTest.kt',
      `package com.example
import org.junit.Test
import org.junit.Before

class FooTest {
    @Before
    fun setup() {}

    @Test
    fun doesSomething() {}
}
`
    )
    const artifact = buildArtifact(root)
    expect(artifact.testClasses).toHaveLength(1)
    expect(artifact.testClasses[0]!.name).toBe('FooTest')
    expect(artifact.testMethods.map((m) => m.name).sort()).toEqual(['doesSomething', 'setup'])
  })

  // TST-609
  it('extracts a Java JUnit4 class and method', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(
      root,
      'app/src/test/java/com/example',
      'FooTest.java',
      `package com.example;
import org.junit.Test;

public class FooTest {
    @Test
    public void doesSomething() {
    }
}
`
    )
    const artifact = buildArtifact(root)
    expect(artifact.testMethods).toHaveLength(1)
    expect(artifact.testMethods[0]!.name).toBe('doesSomething')
  })

  // TST-610
  it('extracts a JUnit5 method', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(
      root,
      'app/src/test/kotlin/com/example',
      'FooTest.kt',
      `package com.example
import org.junit.jupiter.api.Test

class FooTest {
    @Test
    fun doesSomething() {}
}
`
    )
    const artifact = buildArtifact(root)
    expect(artifact.testFiles[0]!.frameworks).toContain('junit5')
    expect(artifact.testMethods).toHaveLength(1)
  })

  // TST-611
  it('records @RunWith and @ExtendWith evidence', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(
      root,
      'app/src/test/kotlin/com/example',
      'FooTest.kt',
      `package com.example
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.junit.MockitoJUnitRunner

@RunWith(MockitoJUnitRunner::class)
class FooTest {
    @Test
    fun doesSomething() {}
}
`
    )
    const artifact = buildArtifact(root)
    expect(artifact.testClasses[0]!.superclassOrRunner).toBe('MockitoJUnitRunner')
  })

  // TST-612
  it('excludes a method without @Test or a recognized lifecycle annotation', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(
      root,
      'app/src/test/kotlin/com/example',
      'FooTest.kt',
      `package com.example
import org.junit.Test

class FooTest {
    fun helperMethod() {}

    @Test
    fun doesSomething() {}
}
`
    )
    const artifact = buildArtifact(root)
    expect(artifact.testMethods.map((m) => m.name)).toEqual(['doesSomething'])
  })

  // TST-613
  it('excludes a method merely named testSomething without a test annotation', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(
      root,
      'app/src/test/kotlin/com/example',
      'FooTest.kt',
      `package com.example
import org.junit.Test

class FooTest {
    fun testHelperNotAnnotated() {}

    @Test
    fun doesSomething() {}
}
`
    )
    const artifact = buildArtifact(root)
    expect(artifact.testMethods.map((m) => m.name)).toEqual(['doesSomething'])
  })

  // TST-614
  it('produces stable, deterministic IDs and ordering', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(
      root,
      'app/src/test/kotlin/com/example',
      'FooTest.kt',
      `package com.example
import org.junit.Test

class FooTest {
    @Test
    fun a() {}

    @Test
    fun b() {}
}
`
    )
    const artifact1 = buildArtifact(root)
    const artifact2 = buildArtifact(root)
    expect(artifact1.testMethods.map((m) => m.id)).toEqual(artifact2.testMethods.map((m) => m.id))
    expect(artifact1.testMethods.map((m) => m.id)).toEqual([...artifact1.testMethods.map((m) => m.id)].sort())
    expect(artifact1.testMethods[0]!.id).toBe('android-test-method:app/src/test/kotlin/com/example/FooTest.kt#FooTest.a')
  })
})

describe('buildAndroidTestSemanticProject -- Compose UI test evidence', () => {
  // TST-615
  it('extracts createAndroidComposeRule with a generic Activity type and @get:Rule', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(
      root,
      'app/src/androidTest/kotlin/com/example',
      'HomeScreenTest.kt',
      `package com.example
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Test
import org.junit.Rule

class HomeScreenTest {
    @get:Rule
    val composeTestRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun showsWelcomeText() {
        composeTestRule.onNodeWithText("Welcome back").assertIsDisplayed()
    }
}
`
    )
    const artifact = buildArtifact(root)
    expect(artifact.testRules).toHaveLength(1)
    expect(artifact.testRules[0]).toMatchObject({ ruleKind: 'createAndroidComposeRule', activityType: 'MainActivity', variableName: 'composeTestRule' })
    expect(artifact.testRules[0]!.warnings).toEqual([])
    expect(artifact.assertionFacts).toHaveLength(1)
    expect(artifact.assertionFacts[0]).toMatchObject({ kind: 'visible-text', api: 'onNodeWithText', resolvedValue: 'Welcome back', status: 'resolved' })
  })

  // TST-616
  it('extracts onNodeWithTag and hasTestTag as test-tag assertions', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(
      root,
      'app/src/androidTest/kotlin/com/example',
      'HomeScreenTest.kt',
      `package com.example
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Test
import org.junit.Rule

class HomeScreenTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun showsLoginButton() {
        composeTestRule.onNodeWithTag("login_button").assertExists()
    }
}
`
    )
    const artifact = buildArtifact(root)
    expect(artifact.assertionFacts).toHaveLength(1)
    expect(artifact.assertionFacts[0]).toMatchObject({ kind: 'test-tag', api: 'onNodeWithTag', resolvedValue: 'login_button' })
  })

  // TST-617
  it('leaves a dynamic text/tag assertion unresolved without guessing', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(
      root,
      'app/src/androidTest/kotlin/com/example',
      'HomeScreenTest.kt',
      `package com.example
import org.junit.Test

class HomeScreenTest {
    @Test
    fun showsDynamicText(label: String) {
        composeTestRule.onNodeWithText(label).assertExists()
    }
}
`
    )
    const artifact = buildArtifact(root)
    expect(artifact.assertionFacts).toHaveLength(1)
    expect(artifact.assertionFacts[0]).toMatchObject({ status: 'unresolved', resolvedValue: null })
  })
})

describe('buildAndroidTestSemanticProject -- Espresso and Robolectric evidence', () => {
  // TST-618
  it('classifies an Espresso withText assertion as visible-text', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(
      root,
      'app/src/androidTest/kotlin/com/example',
      'EspressoTest.kt',
      `package com.example
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.matcher.ViewMatchers.withText
import org.junit.Test

class EspressoTest {
    @Test
    fun showsGreeting() {
        onView(withId(R.id.greeting)).check(matches(withText("Hello")))
    }
}
`
    )
    const artifact = buildArtifact(root)
    expect(artifact.testFiles[0]!.frameworks).toContain('espresso')
    expect(artifact.assertionFacts.some((f) => f.api === 'Espresso.withText' && f.resolvedValue === 'Hello')).toBe(true)
  })

  // TST-619
  it('classifies @RunWith(RobolectricTestRunner::class) as robolectric', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(
      root,
      'app/src/test/kotlin/com/example',
      'RoboTest.kt',
      `package com.example
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class RoboTest {
    @Test
    fun runsWithRobolectric() {}
}
`
    )
    const artifact = buildArtifact(root)
    expect(artifact.testFiles[0]!.frameworks).toContain('robolectric')
    expect(artifact.testClasses[0]!.frameworks).toContain('robolectric')
  })
})

describe('buildAndroidTestSemanticProject -- test doubles', () => {
  // TST-620
  it('extracts a Fake...Repository declaration', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(
      root,
      'app/src/test/kotlin/com/example',
      'FooTest.kt',
      `package com.example
import org.junit.Test

class FooTest {
    private val repository = FakeUserRepository()

    @Test
    fun doesSomething() {}
}
`
    )
    const artifact = buildArtifact(root)
    expect(artifact.testDoubleFacts.some((f) => f.kind === 'fake' && f.referencedType === 'FakeUserRepository')).toBe(true)
  })

  // TST-621
  it('extracts mockk<T>() and Mockito.mock() forms', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(
      root,
      'app/src/test/kotlin/com/example',
      'FooTest.kt',
      `package com.example
import org.junit.Test

class FooTest {
    private val viewModel = mockk<HomeViewModel>()
    private val repo = Mockito.mock(UserRepository::class.java)

    @Test
    fun doesSomething() {}
}
`
    )
    const artifact = buildArtifact(root)
    expect(artifact.testDoubleFacts.some((f) => f.kind === 'mock' && f.referencedType === 'HomeViewModel')).toBe(true)
    expect(artifact.testDoubleFacts.some((f) => f.kind === 'mock' && f.referencedType === 'UserRepository')).toBe(true)
  })
})

describe('buildAndroidTestSemanticProject -- cross-references and determinism', () => {
  // TST-622
  it('is deterministic across two runs of byte-identical input', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(
      root,
      'app/src/androidTest/kotlin/com/example',
      'HomeScreenTest.kt',
      `package com.example
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Test
import org.junit.Rule

class HomeScreenTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun showsLoginButton() {
        composeTestRule.onNodeWithTag("login_button").assertExists()
        composeTestRule.onNodeWithText("Welcome").assertExists()
    }
}
`
    )
    const run1 = buildArtifact(root)
    const run2 = buildArtifact(root)
    expect({ ...run1, createdAt: null }).toEqual({ ...run2, createdAt: null })
  })

  // TST-623
  it('summary counts equal emitted fact counts', () => {
    const root = createTempRoot()
    writeAppScaffold(root)
    writeTestFile(
      root,
      'app/src/test/kotlin/com/example',
      'FooTest.kt',
      `package com.example
import org.junit.Test

class FooTest {
    private val repo = FakeUserRepository()

    @Test
    fun doesSomething() {}
}
`
    )
    const artifact = buildArtifact(root)
    expect(artifact.summary.testFileCount).toBe(artifact.testFiles.length)
    expect(artifact.summary.testClassCount).toBe(artifact.testClasses.length)
    expect(artifact.summary.testMethodCount).toBe(artifact.testMethods.length)
    expect(artifact.summary.fakeCount).toBe(artifact.testDoubleFacts.filter((f) => f.kind === 'fake').length)
  })
})
