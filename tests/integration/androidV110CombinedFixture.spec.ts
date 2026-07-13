/**
 * Fixture-integrity gate for the canonical v1.10.0 Android integration fixture
 * (v1.10.0 Batch 7). Verifies the fixture itself contains every required
 * evidence category before any integration assertion runs, so a future
 * accidental fixture edit fails here with a clear message instead of causing
 * confusing failures deep inside the other integration suites.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

export const CANONICAL_FIXTURE_ROOT = join(process.cwd(), 'tests', 'fixtures', 'android-retrieval', 'combined-app')

function read(relPath: string): string {
  return readFileSync(join(CANONICAL_FIXTURE_ROOT, relPath), 'utf8')
}

describe('canonical Android integration fixture: modules and Gradle', () => {
  it('has an application module and a library module', () => {
    expect(read('settings.gradle.kts')).toMatch(/include\(":app"\)/)
    expect(read('settings.gradle.kts')).toMatch(/include\(":core"\)/)
    expect(read('app/build.gradle.kts')).toMatch(/com\.android\.application/)
    expect(read('core/build.gradle')).toMatch(/com\.android\.library/)
  })

  it('has a Kotlin DSL and a Groovy Gradle file', () => {
    expect(read('app/build.gradle.kts')).toBeTruthy()
    expect(read('core/build.gradle')).toBeTruthy()
  })

  it('has product flavors, a flavor dimension, and a version catalog', () => {
    const appGradle = read('app/build.gradle.kts')
    expect(appGradle).toMatch(/flavorDimensions/)
    expect(appGradle).toMatch(/productFlavors/)
    expect(appGradle).toMatch(/libs\.core\.ktx/)
    expect(read('gradle/libs.versions.toml')).toMatch(/core-ktx/)
  })

  it('has one intentionally dynamic/unresolved dependency expression', () => {
    expect(read('app/build.gradle.kts')).toMatch(/resolveDynamicVersion\(\)/)
  })

  it('has main and debug manifest source sets', () => {
    expect(read('app/src/main/AndroidManifest.xml')).toBeTruthy()
    expect(read('app/src/debug/AndroidManifest.xml')).toBeTruthy()
  })
})

describe('canonical Android integration fixture: manifest evidence', () => {
  const manifest = () => read('app/src/main/AndroidManifest.xml')

  it('declares activity, activity-alias, service, receiver, and provider components', () => {
    const m = manifest()
    expect(m).toMatch(/<activity android:name="\.MainActivity"/)
    expect(m).toMatch(/<activity-alias/)
    expect(m).toMatch(/<service android:name="\.SyncService"/)
    expect(m).toMatch(/<receiver/)
    expect(m).toMatch(/<provider/)
  })

  it('has explicit exported=true, explicit exported=false, and an unspecified-exported activity', () => {
    const m = manifest()
    expect(m).toMatch(/android:name="\.MainActivity" android:exported="true"/)
    expect(m).toMatch(/android:name="com\.example\.other\.MainActivity"[\s\S]*?android:exported="false"/)
    expect(m).toMatch(/<activity android:name="\.SettingsActivity" \/>/)
  })

  it('has uses-permission, uses-permission-sdk-23, a local custom permission, and component permission attributes', () => {
    const m = manifest()
    expect(m).toMatch(/<uses-permission android:name="android\.permission\.INTERNET"/)
    expect(m).toMatch(/<uses-permission-sdk-23/)
    expect(m).toMatch(/<permission android:name="com\.example\.combined\.permission\.CUSTOM_ACCESS"/)
    expect(m).toMatch(/android:permission="com\.example\.combined\.permission\.CUSTOM_ACCESS"/)
    expect(m).toMatch(/android:readPermission="com\.example\.combined\.permission\.CUSTOM_ACCESS"/)
    expect(m).toMatch(/android:writePermission="com\.example\.combined\.permission\.CUSTOM_ACCESS"/)
  })

  it('has a debug-source-set-only permission', () => {
    expect(read('app/src/debug/AndroidManifest.xml')).toMatch(/DEBUG_LOGGING/)
  })

  it('has uses-feature, application metadata, and component metadata', () => {
    const m = manifest()
    expect(m).toMatch(/<uses-feature/)
    expect(m).toMatch(/<meta-data android:name="com\.example\.combined\.BUILD_FLAVOR"/)
    expect(m).toMatch(/<meta-data android:name="com\.example\.combined\.SCREEN_ID"/)
  })

  it('has an exact deep-link candidate and a host-mismatched non-matching deep link', () => {
    const m = manifest()
    expect(m).toMatch(/android:host="example\.com" android:path="\/details"/)
    expect(m).toMatch(/android:host="other-example\.com" android:path="\/details"/)
  })

  it('references FileProvider paths and a network-security config', () => {
    const m = manifest()
    expect(m).toMatch(/@xml\/file_paths/)
    expect(m).toMatch(/android:networkSecurityConfig="@xml\/network_security_config"/)
  })

  it('has a manifest component with no matching source class', () => {
    expect(manifest()).toMatch(/<activity android:name="\.SettingsActivity" \/>/)
    expect(() => read('app/src/main/kotlin/com/example/combined/SettingsActivity.kt')).toThrow()
  })
})

describe('canonical Android integration fixture: source evidence', () => {
  it('has Kotlin and Java component source classes', () => {
    expect(read('app/src/main/kotlin/com/example/combined/MainActivity.kt')).toMatch(/class MainActivity/)
    expect(read('app/src/main/java/com/example/combined/SyncReceiver.java')).toMatch(/class SyncReceiver/)
  })

  it('has a duplicate simple class name across two packages', () => {
    expect(read('app/src/main/kotlin/com/example/combined/MainActivity.kt')).toMatch(/class MainActivity/)
    expect(read('app/src/main/kotlin/com/example/other/MainActivity.kt')).toMatch(/class MainActivity/)
  })
})

describe('canonical Android integration fixture: resource evidence', () => {
  it('has strings, localized strings, colors (default and night-qualified), styles, arrays, and plurals', () => {
    expect(read('app/src/main/res/values/strings.xml')).toMatch(/app_name/)
    expect(read('app/src/main/res/values-es/strings.xml')).toMatch(/app_name/)
    expect(read('app/src/main/res/values/colors.xml')).toMatch(/brand_primary/)
    expect(read('app/src/main/res/values-night/colors.xml')).toMatch(/brand_primary/)
    expect(read('app/src/main/res/values/styles.xml')).toMatch(/declare-styleable/)
    expect(read('app/src/main/res/values/strings.xml')).toMatch(/string-array/)
    expect(read('app/src/main/res/values/strings.xml')).toMatch(/plurals/)
  })

  it('has a layout with a view ID, a drawable, and a binary mipmap resource', () => {
    expect(read('app/src/main/res/layout/activity_main.xml')).toMatch(/submit_button/)
    expect(read('app/src/main/res/drawable/icon.xml')).toBeTruthy()
    expect(() => read('app/src/main/res/mipmap-xxhdpi/icon.png')).not.toThrow()
  })

  it('has FileProvider paths XML and network-security config XML', () => {
    expect(read('app/src/main/res/xml/file_paths.xml')).toMatch(/files-path/)
    expect(read('app/src/main/res/xml/network_security_config.xml')).toMatch(/domain-config/)
  })

  it('has a bare resource name shared across drawable and mipmap types', () => {
    expect(read('app/src/main/res/drawable/icon.xml')).toBeTruthy()
    expect(() => read('app/src/main/res/mipmap-xxhdpi/icon.png')).not.toThrow()
  })

  it('has Kotlin and Java R references, including a framework and fake reference', () => {
    const kt = read('app/src/main/kotlin/com/example/combined/MainActivity.kt')
    expect(kt).toMatch(/R\.string\.app_name/)
    expect(kt).toMatch(/R\.color\.brand_primary/)
    expect(kt).toMatch(/\/\/ R\.string\.commented_out_reference/)
    expect(kt).toMatch(/"R\.string\.string_literal_reference"/)
    expect(read('app/src/main/java/com/example/combined/SyncReceiver.java')).toMatch(/R\.color\.brand_primary/)
  })
})

describe('canonical Android integration fixture: navigation and Compose evidence', () => {
  it('has a root graph, a nested graph, and an included graph', () => {
    expect(read('app/src/main/res/navigation/nav_graph.xml')).toMatch(/<navigation[\s\S]*<navigation/)
    expect(read('app/src/main/res/navigation/nav_graph.xml')).toMatch(/<include app:graph="@navigation\/nav_graph_included"/)
    expect(read('app/src/main/res/navigation/nav_graph_included.xml')).toBeTruthy()
  })

  it('has fragment, dialog, and custom destinations', () => {
    const nav = read('app/src/main/res/navigation/nav_graph.xml')
    expect(nav).toMatch(/<fragment/)
    expect(nav).toMatch(/<dialog/)
    expect(nav).toMatch(/<widgetPane/)
  })

  it('has an action with popUpTo and a second action referencing a missing target', () => {
    const nav = read('app/src/main/res/navigation/nav_graph.xml')
    expect(nav).toMatch(/app:popUpTo="@id\/homeFragment"/)
    expect(nav).toMatch(/app:destination="@id\/doesNotExistDestination"/)
  })

  it('has an argument and an exact XML deep link', () => {
    const nav = read('app/src/main/res/navigation/nav_graph.xml')
    expect(nav).toMatch(/<argument/)
    expect(nav).toMatch(/<deepLink app:uri="https:\/\/example\.com\/details"/)
  })

  it('has Compose string route, local-const route, dynamic route, ambiguous conditional screen, and a type-safe route', () => {
    const compose = read('app/src/main/kotlin/com/example/combined/AppNav.kt')
    expect(compose).toMatch(/composable\("compose_home"\)/)
    expect(compose).toMatch(/composable\(route = SETTINGS_ROUTE\)/)
    expect(compose).toMatch(/composable\(dynamicRouteName\(\)\)/)
    expect(compose).toMatch(/composable\("ambiguous_route"\)/)
    expect(compose).toMatch(/composable<HomeRoute>\(\)/)
    expect(compose).toMatch(/dialog\("confirm_dialog"\)/)
    expect(compose).toMatch(/navigation\(startDestination = "child_home"/)
  })
})
