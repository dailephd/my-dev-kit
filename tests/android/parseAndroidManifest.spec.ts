import { describe, expect, it } from 'vitest'
import { parseXml, findAndroidNamespacePrefix, getAndroidAttr, findChildren } from '../../src/android/xml/parseXml.js'
import { parseAndroidManifest, resolveNameAgainstManifestPackage } from '../../src/android/parseAndroidManifest.js'
import type { ParseAndroidManifestContext } from '../../src/android/parseAndroidManifest.js'

function ctx(overrides: Partial<ParseAndroidManifestContext> = {}): ParseAndroidManifestContext {
  return {
    filePath: 'app/src/main/AndroidManifest.xml',
    moduleId: 'android-module:app',
    gradlePath: ':app',
    sourceSet: 'main',
    discoverySource: 'default-convention',
    gradleNamespace: null,
    applicationId: null,
    ...overrides,
  }
}

const ANDROID_NS = 'xmlns:android="http://schemas.android.com/apk/res/android"'

describe('parseXml', () => {
  it('parses a well-formed manifest into an element tree with line numbers', () => {
    const text = `<?xml version="1.0"?>\n<manifest ${ANDROID_NS} package="com.example">\n  <application android:label="App" />\n</manifest>\n`
    const { root, error } = parseXml(text)
    expect(error).toBeNull()
    expect(root?.name).toBe('manifest')
    const app = findChildren(root!, 'application')[0]
    expect(app?.line).toBe(3)
    const prefix = findAndroidNamespacePrefix(root!)
    expect(prefix).toBe('android')
    expect(getAndroidAttr(app!, 'label', prefix)).toBe('App')
  })

  it('handles a non-standard android namespace prefix', () => {
    const text = `<manifest xmlns:a="http://schemas.android.com/apk/res/android" package="com.example"><application a:label="App"/></manifest>`
    const { root } = parseXml(text)
    const prefix = findAndroidNamespacePrefix(root!)
    expect(prefix).toBe('a')
    const app = findChildren(root!, 'application')[0]
    expect(getAndroidAttr(app!, 'label', prefix)).toBe('App')
  })

  it('captures direct text content on an element without affecting manifest attribute parsing (Batch 3 regression guard)', () => {
    const text = `<manifest package="x"><application android:label="App">Some text<activity android:name=".A"/></application></manifest>`
    const { root, error } = parseXml(text)
    expect(error).toBeNull()
    const app = findChildren(root!, 'application')[0]!
    expect(app.text).toBe('Some text')
    expect(app.attributes['android:label']).toBe('App')
    expect(findChildren(app, 'activity')).toHaveLength(1)
  })

  it('strips comments without treating them as elements', () => {
    const text = `<manifest package="x"><!-- comment <application/> --><application/></manifest>`
    const { root, error } = parseXml(text)
    expect(error).toBeNull()
    expect(findChildren(root!, 'application')).toHaveLength(1)
  })

  it('reports a bounded error for malformed XML instead of throwing', () => {
    const text = `<manifest package="x"><application></manifest>`
    const { root, error } = parseXml(text)
    expect(root).toBeNull()
    expect(error).toBeTruthy()
  })

  it('reports a bounded error for an unclosed element', () => {
    const { root, error } = parseXml(`<manifest package="x"><application>`)
    expect(root).toBeNull()
    expect(error).toContain('unclosed')
  })
})

describe('resolveNameAgainstManifestPackage', () => {
  it('treats a dotted name with no leading dot as fully qualified', () => {
    const result = resolveNameAgainstManifestPackage('com.example.app.MainActivity', 'com.example.app', null)
    expect(result).toEqual({ raw: 'com.example.app.MainActivity', resolved: 'com.example.app.MainActivity', basis: 'fully-qualified', warning: null })
  })

  it('resolves a dot-prefixed name against the manifest package', () => {
    const result = resolveNameAgainstManifestPackage('.MainActivity', 'com.example.app', null)
    expect(result).toEqual({ raw: '.MainActivity', resolved: 'com.example.app.MainActivity', basis: 'manifest-package', warning: null })
  })

  it('resolves an unqualified name against the Gradle namespace when no manifest package is present', () => {
    const result = resolveNameAgainstManifestPackage('MainActivity', null, 'com.example.ns')
    expect(result).toEqual({ raw: 'MainActivity', resolved: 'com.example.ns.MainActivity', basis: 'gradle-namespace', warning: null })
  })

  it('prefers the manifest package over the Gradle namespace when both are present', () => {
    const result = resolveNameAgainstManifestPackage('.MainActivity', 'com.example.manifestpkg', 'com.example.nsonly')
    expect(result.resolved).toBe('com.example.manifestpkg.MainActivity')
    expect(result.basis).toBe('manifest-package')
  })

  it('leaves the name unresolved with a warning when neither package nor namespace is available', () => {
    const result = resolveNameAgainstManifestPackage('.MainActivity', null, null)
    expect(result.resolved).toBeNull()
    expect(result.basis).toBe('unresolved')
    expect(result.warning).toBeTruthy()
  })
})

describe('parseAndroidManifest', () => {
  it('extracts package, application, and a launcher activity with an explicit exported=true', () => {
    const xml = `<manifest ${ANDROID_NS} package="com.example.app">
  <application android:label="@string/app_name" android:icon="@mipmap/ic_launcher" android:theme="@style/AppTheme">
    <meta-data android:name="build.type" android:value="debug" />
    <activity android:name=".MainActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>`
    const result = parseAndroidManifest(xml, ctx())
    expect(result.record.parsingStatus).toBe('parsed')
    expect(result.record.packageAttr).toBe('com.example.app')
    expect(result.applications).toHaveLength(1)
    expect(result.applications[0]?.label).toEqual({
      kind: 'resource-reference',
      reference: { raw: '@string/app_name', referenceKind: 'resource', resourceType: 'string', resourceName: 'app_name', packagePrefix: null, isFrameworkReference: false, warning: null },
    })
    expect(result.applications[0]?.metadataIds).toHaveLength(1)
    expect(result.components).toHaveLength(1)
    const activity = result.components[0]!
    expect(activity.kind).toBe('activity')
    expect(activity.rawName).toBe('.MainActivity')
    expect(activity.resolvedName).toEqual({ raw: '.MainActivity', resolved: 'com.example.app.MainActivity', basis: 'manifest-package', warning: null })
    expect(activity.exported).toBe('true')
    expect(activity.exportedExplicit).toBe(true)
    expect(activity.hasIntentFilter).toBe(true)
    expect(result.launcherCandidates).toHaveLength(1)
    expect(result.launcherCandidates[0]?.componentId).toBe(activity.id)
  })

  it('extracts activity-alias, service, receiver, and provider with process/permission/authorities evidence', () => {
    const xml = `<manifest ${ANDROID_NS} package="com.example.app">
  <application>
    <activity android:name=".MainActivity" />
    <activity-alias android:name=".Alias" android:targetActivity=".MainActivity" android:exported="false" />
    <service android:name=".SyncService" android:process=":sync" android:permission="com.example.PERM" />
    <receiver android:name=".BootReceiver" android:enabled="true" />
    <provider android:name=".AppProvider" android:authorities="com.example.app.provider" android:exported="false" android:grantUriPermissions="true">
      <grant-uri-permission android:pathPrefix="/images" />
      <path-permission android:path="/secret" android:readPermission="com.example.READ" />
    </provider>
  </application>
</manifest>`
    const result = parseAndroidManifest(xml, ctx())
    const byKind = Object.fromEntries(result.components.map((c) => [c.kind, c]))
    expect(byKind['activity-alias']?.targetActivity?.resolved).toBe('com.example.app.MainActivity')
    expect(byKind['activity-alias']?.exported).toBe('false')
    expect(byKind['activity-alias']?.exportedExplicit).toBe(true)
    expect(byKind['service']?.process).toEqual({ kind: 'literal', value: ':sync' })
    expect(byKind['service']?.permission).toEqual({ kind: 'literal', value: 'com.example.PERM' })
    expect(byKind['receiver']?.enabled).toEqual({ kind: 'literal', value: 'true' })
    expect(byKind['provider']?.authorities).toEqual(['com.example.app.provider'])
    expect(byKind['provider']?.grantUriPermissions).toHaveLength(1)
    expect(byKind['provider']?.pathPermissions).toHaveLength(1)
    // MainActivity has no android:exported and no intent-filter — unspecified, not overinterpreted.
    expect(byKind['activity']?.exported).toBe('unspecified')
    expect(byKind['activity']?.exportedExplicit).toBe(false)
    expect(byKind['activity']?.warnings.some((w) => w.includes('exported is unspecified'))).toBe(true)
  })

  it('extracts uses-permission, uses-permission-sdk-23, declared permissions, and uses-feature evidence', () => {
    const xml = `<manifest ${ANDROID_NS} package="com.example.app">
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission-sdk-23 android:name="android.permission.READ_CONTACTS" android:maxSdkVersion="30" />
  <permission android:name="com.example.app.CUSTOM" android:protectionLevel="signature" />
  <uses-feature android:name="android.hardware.camera" android:required="true" />
  <uses-feature android:glEsVersion="0x00020000" android:required="false" />
  <application />
</manifest>`
    const result = parseAndroidManifest(xml, ctx())
    expect(result.permissions).toHaveLength(2)
    expect(result.permissions.find((p) => p.kind === 'uses-permission-sdk-23')?.maxSdkVersion).toBe(30)
    expect(result.declaredPermissions).toHaveLength(1)
    expect(result.declaredPermissions[0]?.protectionLevel).toBe('signature')
    expect(result.usesFeatures).toHaveLength(2)
    expect(result.usesFeatures.find((f) => f.name === 'android.hardware.camera')?.required).toBe('true')
    expect(result.usesFeatures.find((f) => f.glEsVersion === '0x00020000')?.required).toBe('false')
  })

  it('extracts deep-link candidates from VIEW/BROWSABLE intent filters with data specs, and warns on incomplete evidence', () => {
    const xml = `<manifest ${ANDROID_NS} package="com.example.app">
  <application>
    <activity android:name=".DeepLinkActivity">
      <intent-filter android:autoVerify="true">
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="https" android:host="example.com" android:pathPrefix="/articles" />
      </intent-filter>
      <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.BROWSABLE" />
      </intent-filter>
    </activity>
  </application>
</manifest>`
    const result = parseAndroidManifest(xml, ctx())
    expect(result.deepLinkCandidates).toHaveLength(2)
    const withData = result.deepLinkCandidates.find((d) => d.scheme === 'https')!
    expect(withData.host).toBe('example.com')
    expect(withData.pathPrefix).toBe('/articles')
    expect(withData.autoVerify).toBe(true)
    const withoutData = result.deepLinkCandidates.find((d) => d.scheme === null)!
    expect(withoutData.warnings.some((w) => w.includes('no <data> element'))).toBe(true)
  })

  it('preserves FileProvider metadata and network-security/cleartext application attributes without resolving referenced resources', () => {
    const xml = `<manifest ${ANDROID_NS} package="com.example.app">
  <application android:networkSecurityConfig="@xml/network_security_config" android:usesCleartextTraffic="false">
    <provider android:name="androidx.core.content.FileProvider" android:authorities="com.example.app.fileprovider" android:exported="false" android:grantUriPermissions="true">
      <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/file_paths" />
    </provider>
  </application>
</manifest>`
    const result = parseAndroidManifest(xml, ctx())
    expect(result.applications[0]?.networkSecurityConfig).toEqual({
      kind: 'resource-reference',
      reference: { raw: '@xml/network_security_config', referenceKind: 'resource', resourceType: 'xml', resourceName: 'network_security_config', packagePrefix: null, isFrameworkReference: false, warning: null },
    })
    expect(result.applications[0]?.usesCleartextTraffic).toEqual({ kind: 'literal', value: 'false' })
    const provider = result.components.find((c) => c.kind === 'provider')!
    expect(provider.rawName).toBe('androidx.core.content.FileProvider')
    const meta = result.metadata.find((m) => m.name === 'android.support.FILE_PROVIDER_PATHS')!
    expect(meta.resource).toEqual({
      kind: 'resource-reference',
      reference: { raw: '@xml/file_paths', referenceKind: 'resource', resourceType: 'xml', resourceName: 'file_paths', packagePrefix: null, isFrameworkReference: false, warning: null },
    })
  })

  it('classifies manifest placeholders and unknown/malformed resource references without inventing values', () => {
    const xml = `<manifest ${ANDROID_NS} package="com.example.app">
  <application android:label="\${appLabel}">
    <activity android:name=".MainActivity" android:theme="@malformed" />
  </application>
</manifest>`
    const result = parseAndroidManifest(xml, ctx())
    expect(result.applications[0]?.label).toEqual({ kind: 'placeholder', raw: '${appLabel}' })
    const activity = result.components[0]!
    expect(activity.theme.kind).toBe('resource-reference')
    if (activity.theme.kind === 'resource-reference') {
      expect(activity.theme.reference.warning).toBeTruthy()
    }
  })

  it('does not crash on malformed XML and reports a bounded parsing failure', () => {
    const xml = `<manifest package="com.example.app"><application><activity></application></manifest>`
    const result = parseAndroidManifest(xml, ctx())
    expect(result.record.parsingStatus).toBe('malformed')
    expect(result.record.warnings.length).toBeGreaterThan(0)
    expect(result.components).toEqual([])
    expect(result.applications).toEqual([])
  })

  it('produces deterministic output across repeated parses of the same manifest', () => {
    const xml = `<manifest ${ANDROID_NS} package="com.example.app"><application><activity android:name=".A" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>`
    const first = parseAndroidManifest(xml, ctx())
    const second = parseAndroidManifest(xml, ctx())
    expect(first).toEqual(second)
  })
})
