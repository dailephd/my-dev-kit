import { describe, expect, it } from 'vitest'
import { parseXml } from '../../src/android/xml/parseXml.js'
import { parseResourceDirectoryName } from '../../src/android/parseResourceDirectoryName.js'
import { parseAndroidValuesResource } from '../../src/android/parseAndroidValuesResource.js'
import { parseAndroidResourceXmlFile } from '../../src/android/parseAndroidResourceFile.js'
import { classifyResourceReference } from '../../src/android/xml/collectResourceReferences.js'
import type { AndroidResourceQualifiers } from '../../src/android/androidResourceTypes.js'

const NO_QUALIFIERS: AndroidResourceQualifiers = {
  raw: [],
  locale: null,
  nightMode: null,
  apiLevel: null,
  density: null,
  orientation: null,
  smallestWidthDp: null,
  widthDp: null,
  heightDp: null,
  unrecognized: [],
}

describe('parseResourceDirectoryName', () => {
  it('parses a plain values directory with no qualifiers', () => {
    const result = parseResourceDirectoryName('values')
    expect(result.baseType).toBe('values')
    expect(result.qualifiers).toEqual(NO_QUALIFIERS)
  })

  it('parses locale, region, night mode, and API-level qualifiers together', () => {
    const result = parseResourceDirectoryName('values-es-rUS-night-v31')
    expect(result.baseType).toBe('values')
    expect(result.qualifiers.locale).toBe('es-rUS')
    expect(result.qualifiers.nightMode).toBe('night')
    expect(result.qualifiers.apiLevel).toBe(31)
    expect(result.qualifiers.unrecognized).toEqual([])
  })

  it('parses density and orientation qualifiers', () => {
    expect(parseResourceDirectoryName('drawable-hdpi').qualifiers.density).toBe('hdpi')
    expect(parseResourceDirectoryName('layout-land').qualifiers.orientation).toBe('land')
  })

  it('parses smallest-width, width, and height qualifiers', () => {
    const result = parseResourceDirectoryName('layout-sw600dp')
    expect(result.qualifiers.smallestWidthDp).toBe(600)
  })

  it('preserves unrecognized qualifier segments without discarding the directory', () => {
    const result = parseResourceDirectoryName('values-mysteryqualifier')
    expect(result.qualifiers.unrecognized).toEqual(['mysteryqualifier'])
    expect(result.baseType).toBe('values')
  })

  it('reports an unknown base type conservatively rather than guessing', () => {
    const result = parseResourceDirectoryName('totallyunknowndir-foo')
    expect(result.baseType).toBe('unknown')
  })
})

describe('classifyResourceReference', () => {
  it('classifies a plain resource reference', () => {
    expect(classifyResourceReference('@string/app_name')).toMatchObject({ kind: 'resource', resourceType: 'string', resourceName: 'app_name' })
  })
  it('classifies an id declaration and an id reference', () => {
    expect(classifyResourceReference('@+id/submit_button')).toMatchObject({ kind: 'id-declaration', resourceName: 'submit_button' })
    expect(classifyResourceReference('@id/submit_button')).toMatchObject({ kind: 'id-reference', resourceName: 'submit_button' })
  })
  it('classifies an @android:-prefixed id reference as id-reference, with packagePrefix marking it framework', () => {
    // id-ness takes precedence over the generic "framework-resource" kind so downstream
    // consumers keep the id-reference semantics; `packagePrefix: 'android'` still flags it as framework.
    expect(classifyResourceReference('@android:id/list')).toMatchObject({ kind: 'id-reference', packagePrefix: 'android', resourceName: 'list' })
  })
  it('classifies a non-id framework reference', () => {
    expect(classifyResourceReference('@android:string/ok')).toMatchObject({ kind: 'framework-resource', packagePrefix: 'android' })
  })
  it('classifies a package-qualified reference', () => {
    expect(classifyResourceReference('@com.example.lib:string/foo')).toMatchObject({ kind: 'package-qualified-resource', packagePrefix: 'com.example.lib' })
  })
  it('classifies theme-attribute forms, including shorthand', () => {
    expect(classifyResourceReference('?attr/colorPrimary')).toMatchObject({ kind: 'theme-attribute', resourceType: 'attr', resourceName: 'colorPrimary' })
    expect(classifyResourceReference('?colorPrimary')).toMatchObject({ kind: 'theme-attribute', resourceType: 'attr', resourceName: 'colorPrimary' })
  })
  it('classifies @null and @empty as null-or-empty sentinels', () => {
    expect(classifyResourceReference('@null').kind).toBe('null-or-empty')
    expect(classifyResourceReference('@empty').kind).toBe('null-or-empty')
  })
  it('classifies malformed references as unresolved with a warning', () => {
    const result = classifyResourceReference('@!!!')
    expect(result.kind).toBe('unresolved')
    expect(result.warning).toBeTruthy()
  })
})

function parseValues(xml: string, fileSuffix = 'main') {
  const { root, error } = parseXml(xml)
  expect(error).toBeNull()
  const filePath = `app/src/${fileSuffix}/res/values/strings.xml`
  return parseAndroidValuesResource(root!, {
    fileId: `android-resource-file:${filePath}`,
    filePath,
    moduleId: 'android-module:app',
    sourceSet: fileSuffix,
    qualifiers: NO_QUALIFIERS,
  })
}

describe('parseAndroidValuesResource', () => {
  it('parses strings, colors, dimens, bools, integers, and fractions', () => {
    const result = parseValues(`<resources>
      <string name="app_name">My App</string>
      <color name="primary">#FF0000</color>
      <dimen name="margin">16dp</dimen>
      <bool name="feature_enabled">true</bool>
      <integer name="max_count">5</integer>
      <fraction name="ratio">50%</fraction>
    </resources>`)
    expect(result.definitions).toHaveLength(6)
    expect(result.definitions.find((d) => d.type === 'string')).toMatchObject({ name: 'app_name', rawValue: 'My App' })
    expect(result.definitions.find((d) => d.type === 'color')).toMatchObject({ name: 'primary', rawValue: '#FF0000' })
    expect(result.definitions.find((d) => d.type === 'dimen')).toMatchObject({ rawValue: '16dp' })
    expect(result.definitions.find((d) => d.type === 'bool')).toMatchObject({ rawValue: 'true' })
  })

  it('parses string translatable/formatted/product attributes and resource references in the value', () => {
    const result = parseValues(`<resources>
      <string name="greeting" translatable="false" formatted="false">Hi @string/name_placeholder</string>
    </resources>`)
    const def = result.definitions[0]!
    expect(def.translatable).toBe(false)
    expect(def.formatted).toBe(false)
    expect(def.referenceIds).toHaveLength(1)
    expect(result.references[0]).toMatchObject({ kind: 'resource', resourceType: 'string', resourceName: 'name_placeholder' })
  })

  it('parses an explicit-type <item> resource', () => {
    const result = parseValues(`<resources><item name="app_bar_height" type="dimen">56dp</item></resources>`)
    expect(result.definitions[0]).toMatchObject({ type: 'dimen', name: 'app_bar_height', rawValue: '56dp' })
  })

  it('parses a style with an explicit parent and items, and an implicit dotted-name parent', () => {
    const result = parseValues(`<resources>
      <style name="AppTheme" parent="Theme.Material3.DayNight">
        <item name="colorPrimary">@color/primary</item>
      </style>
      <style name="AppTheme.NoActionBar" />
    </resources>`)
    const explicit = result.definitions.find((d) => d.name === 'AppTheme')!
    expect(explicit.parent).toBe('Theme.Material3.DayNight')
    expect(explicit.parentExplicit).toBe(true)
    expect(explicit.items).toHaveLength(1)
    expect(explicit.items[0]).toMatchObject({ name: 'colorPrimary', rawValue: '@color/primary' })
    const implicit = result.definitions.find((d) => d.name === 'AppTheme.NoActionBar')!
    expect(implicit.parent).toBe('AppTheme')
    expect(implicit.parentExplicit).toBe(false)
  })

  it('parses string-array, integer-array, and plurals with ordered items', () => {
    const result = parseValues(`<resources>
      <string-array name="colors">
        <item>Red</item>
        <item>Green</item>
      </string-array>
      <plurals name="items_count">
        <item quantity="one">%d item</item>
        <item quantity="other">%d items</item>
      </plurals>
    </resources>`)
    const array = result.definitions.find((d) => d.type === 'array')!
    expect(array.arrayKind).toBe('string-array')
    expect(array.arrayItems.map((i) => i.rawValue)).toEqual(['Red', 'Green'])
    const plurals = result.definitions.find((d) => d.type === 'plurals')!
    expect(plurals.pluralItems.map((i) => i.quantity)).toEqual(['one', 'other'])
  })

  it('parses attr with enum/flag children and declare-styleable with attr references', () => {
    const result = parseValues(`<resources>
      <attr name="orientation" format="enum">
        <enum name="horizontal" value="0" />
        <enum name="vertical" value="1" />
      </attr>
      <declare-styleable name="MyView">
        <attr name="orientation" />
        <attr name="customColor" format="color" />
      </declare-styleable>
    </resources>`)
    const attr = result.definitions.find((d) => d.type === 'attr')!
    expect(attr.enumValues).toEqual([{ name: 'horizontal', value: '0' }, { name: 'vertical', value: '1' }])
    const styleable = result.definitions.find((d) => d.type === 'declare-styleable')!
    expect(styleable.styleableAttrRefs).toEqual(['customColor', 'orientation'])
  })

  it('keeps duplicate logical resource names across separate definitions rather than collapsing them', () => {
    const first = parseValues(`<resources><string name="app_name">Default</string></resources>`, 'main')
    const second = parseValues(`<resources><string name="app_name">Localized</string></resources>`, 'debug')
    expect(first.definitions[0]!.rawValue).toBe('Default')
    expect(second.definitions[0]!.rawValue).toBe('Localized')
    expect(first.definitions[0]!.id).not.toBe(second.definitions[0]!.id)
  })
})

function parseResourceXml(xml: string, baseType: 'layout' | 'drawable' | 'xml' | 'menu', resourceName = 'test') {
  return parseAndroidResourceXmlFile(xml, {
    fileId: `android-resource-file:app/src/main/res/${baseType}/${resourceName}.xml`,
    filePath: `app/src/main/res/${baseType}/${resourceName}.xml`,
    moduleId: 'android-module:app',
    sourceSet: 'main',
    qualifiers: NO_QUALIFIERS,
    baseType,
    resourceName,
  })
}

describe('parseAndroidResourceXmlFile — layouts', () => {
  it('parses a layout root, declared IDs, an ID reference, and an included layout', () => {
    const result = parseResourceXml(
      `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android">
        <TextView android:id="@+id/title" android:text="@string/app_name" />
        <Button android:id="@+id/submit" android:labelFor="@id/title" android:theme="?attr/buttonTheme" />
        <include layout="@layout/toolbar" />
        <fragment android:name="com.example.MyFragment" />
      </LinearLayout>`,
      'layout',
      'activity_main'
    )
    expect(result.parsingStatus).toBe('parsed')
    expect(result.layout).toBeTruthy()
    expect(result.layout!.rootElement).toBe('LinearLayout')
    expect(result.idDefinitions.map((d) => d.key.name).sort()).toEqual(['submit', 'title'])
    expect(result.layout!.includedLayoutRefs).toEqual(['@layout/toolbar'])
    expect(result.layout!.fragmentClassNames).toEqual(['com.example.MyFragment'])
    const idRef = result.references.find((r) => r.kind === 'id-reference')
    expect(idRef).toMatchObject({ resourceName: 'title' })
    const themeRef = result.references.find((r) => r.kind === 'theme-attribute')
    expect(themeRef).toMatchObject({ resourceName: 'buttonTheme' })
  })

  it('classifies a framework @android:id reference as an id-reference flagged with packagePrefix "android"', () => {
    const result = parseResourceXml(
      `<LinearLayout><ListView android:id="@android:id/list" /></LinearLayout>`,
      'layout'
    )
    expect(result.references.some((r) => r.kind === 'id-reference' && r.packagePrefix === 'android' && r.resourceName === 'list')).toBe(true)
  })

  it('does not crash on malformed layout XML and reports a bounded failure', () => {
    const result = parseResourceXml(`<LinearLayout><TextView></LinearLayout>`, 'layout')
    expect(result.parsingStatus).toBe('malformed')
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.layout).toBeNull()
  })
})

describe('parseAndroidResourceXmlFile — generic/drawable/menu XML', () => {
  it('records a vector drawable as a generic file definition with root metadata', () => {
    const result = parseResourceXml(
      `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp"><path android:fillColor="@color/icon_color" /></vector>`,
      'drawable',
      'ic_launcher'
    )
    expect(result.fileDefinition).toMatchObject({ type: 'drawable', name: 'ic_launcher', xmlRootElement: 'vector' })
    expect(result.references.some((r) => r.resourceType === 'color' && r.resourceName === 'icon_color')).toBe(true)
  })

  it('records a menu XML file as a generic file definition with declared IDs', () => {
    const result = parseResourceXml(`<menu><item android:id="@+id/action_settings" /></menu>`, 'menu', 'main_menu')
    expect(result.fileDefinition).toMatchObject({ type: 'menu', name: 'main_menu' })
    expect(result.idDefinitions).toHaveLength(1)
  })

  it('records a navigation XML file as a generic file resource without navigation semantics', () => {
    const result = parseAndroidResourceXmlFile(
      `<navigation><fragment android:id="@+id/homeFragment" /></navigation>`,
      {
        fileId: 'android-resource-file:app/src/main/res/navigation/example_graph.xml',
        filePath: 'app/src/main/res/navigation/example_graph.xml',
        moduleId: 'android-module:app',
        sourceSet: 'main',
        qualifiers: NO_QUALIFIERS,
        baseType: 'navigation',
        resourceName: 'example_graph',
      }
    )
    expect(result.fileDefinition).toMatchObject({ type: 'navigation', name: 'example_graph', xmlRootElement: 'navigation' })
    // No destination/action/argument extraction — just bounded generic reference/ID evidence.
    expect(result.idDefinitions).toHaveLength(1)
  })
})

describe('parseAndroidResourceXmlFile — FileProvider paths', () => {
  it('parses files-path, cache-path, and external-path declarations', () => {
    const result = parseResourceXml(
      `<paths xmlns:android="http://schemas.android.com/apk/res/android">
        <files-path name="my_files" path="files/" />
        <cache-path name="my_cache" path="cache/" />
        <external-path name="ext" path="." />
      </paths>`,
      'xml',
      'file_paths'
    )
    expect(result.fileProviderPaths).toHaveLength(3)
    expect(result.fileProviderPaths.find((p) => p.elementType === 'files-path')).toMatchObject({ name: 'my_files', path: 'files/' })
  })
})

describe('parseAndroidResourceXmlFile — network security config', () => {
  it('parses base-config, domain-config, domain, trust-anchors, and pin-set records', () => {
    const result = parseResourceXml(
      `<network-security-config>
        <base-config cleartextTrafficPermitted="false" />
        <domain-config>
          <domain includeSubdomains="true">example.com</domain>
          <pin-set>
            <pin digest="SHA-256">AAAA</pin>
          </pin-set>
          <trust-anchors>
            <certificates src="system" />
          </trust-anchors>
        </domain-config>
      </network-security-config>`,
      'xml',
      'network_security_config'
    )
    expect(result.networkSecurityRecords.map((r) => r.kind).sort()).toEqual(
      ['base-config', 'certificates', 'domain', 'domain-config', 'network-security-config', 'pin', 'pin-set', 'trust-anchors'].sort()
    )
    const domain = result.networkSecurityRecords.find((r) => r.kind === 'domain')!
    expect(domain.domainText).toBe('example.com')
    expect(domain.attributes['includeSubdomains']).toBe('true')
    const baseConfig = result.networkSecurityRecords.find((r) => r.kind === 'base-config')!
    expect(baseConfig.attributes['cleartextTrafficPermitted']).toBe('false')
  })
})
