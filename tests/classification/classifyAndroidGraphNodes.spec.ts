/**
 * v1.12.0 Batch 1/2: classification rules for android-project/android-module
 * and Batch 2 manifest/navigation/resource/Compose/test/generated-path
 * graph-node targets. TST-003 through TST-217 (see per-test tags).
 */
import { describe, expect, it } from 'vitest'
import { buildAndroidGraphNodeClassifications } from '../../src/classification/classifyAndroidGraphNodes.js'
import { ANDROID_PROJECT_ROOT_NODE_ID } from '../../src/android/buildAndroidArtifactRelationships.js'
import type { CodeGraphEdge, CodeGraphNode } from '../../src/graph/codeGraphTypes.js'

function entryFor(entries: ReturnType<typeof buildAndroidGraphNodeClassifications>['entries'], targetId: string) {
  const entry = entries.find((e) => e.targetId === targetId)
  if (!entry) throw new Error(`no entry for ${targetId}`)
  return entry
}

function projectRootNode(): CodeGraphNode {
  return { id: ANDROID_PROJECT_ROOT_NODE_ID, kind: 'android-project', label: 'Android project' }
}

function moduleNode(id: string, moduleType: 'app' | 'library' | 'unknown'): CodeGraphNode {
  return { id, kind: 'android-module', label: id, path: id.replace('android-module:', ''), androidMetadata: { moduleType } }
}

describe('buildAndroidGraphNodeClassifications', () => {
  it('TST-003: classifies the project root as android-project / read-only-reference / ready / certain', () => {
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [projectRootNode()] })
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.targetId).toBe(ANDROID_PROJECT_ROOT_NODE_ID)
    expect(entry.targetKind).toBe('graph-node')
    expect(entry.classifications.map((c) => c.role)).toEqual(['android-project'])
    expect(entry.editGuidance).toBe('read-only-reference')
    expect(entry.readiness).toBe('ready')
    expect(entry.uncertainty).toBe('certain')
    expect(entry.evidence.length).toBeGreaterThan(0)
  })

  it('TST-004: classifies an app module as gradle-module + android-app-module / inspect-before-edit / ready / certain', () => {
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [moduleNode('android-module:app', 'app')] })
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.classifications.map((c) => c.role).sort()).toEqual(['android-app-module', 'gradle-module'].sort())
    expect(entry.editGuidance).toBe('inspect-before-edit')
    expect(entry.readiness).toBe('ready')
    expect(entry.uncertainty).toBe('certain')
  })

  it('TST-005: classifies a library module as gradle-module + android-library-module / inspect-before-edit / ready / certain', () => {
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [moduleNode('android-module:lib', 'library')] })
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.classifications.map((c) => c.role).sort()).toEqual(['android-library-module', 'gradle-module'].sort())
    expect(entry.editGuidance).toBe('inspect-before-edit')
    expect(entry.readiness).toBe('ready')
    expect(entry.uncertainty).toBe('certain')
  })

  it('TST-006: an unknown module gets only gradle-module, needs-more-context, possible - never app/library', () => {
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [moduleNode('android-module:mystery', 'unknown')] })
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.classifications.map((c) => c.role)).toEqual(['gradle-module'])
    expect(entry.classifications.some((c) => c.role === 'android-app-module')).toBe(false)
    expect(entry.classifications.some((c) => c.role === 'android-library-module')).toBe(false)
    expect(entry.editGuidance).toBe('inspect-before-edit')
    expect(entry.readiness).toBe('needs-more-context')
    expect(entry.uncertainty).toBe('possible')
    expect(entry.warnings.length).toBeGreaterThan(0)
  })

  it('TST-007: every entry ID/targetId is stable and matches the projected node ID for parity with compact refs', () => {
    const nodes = [projectRootNode(), moduleNode('android-module:app', 'app'), moduleNode('android-module:lib', 'library')]
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: nodes })
    expect(entries).toHaveLength(3)
    for (const entry of entries) {
      expect(entry.nodeId).toBe(entry.targetId)
      expect(entry.id).toBe(`classification:graph-node:${entry.targetId}`)
    }
  })

  it('TST-014: only classifies nodes actually present in graphNodes - never invents a target for a non-Android node', () => {
    const { entries } = buildAndroidGraphNodeClassifications({
      graphNodes: [{ id: 'file:src/a.ts', kind: 'file', label: 'a.ts', path: 'src/a.ts' }],
    })
    expect(entries).toHaveLength(0)
  })

  it('deterministic ordering: entries are sorted by ID regardless of input node order', () => {
    const nodes = [moduleNode('android-module:zeta', 'app'), projectRootNode(), moduleNode('android-module:alpha', 'library')]
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: nodes })
    const ids = entries.map((e) => e.id)
    expect(ids).toEqual([...ids].sort())
  })
})

describe('buildAndroidGraphNodeClassifications — v1.12.0 Batch 2 manifest and platform', () => {
  it('TST-206: manifest file gets android-manifest + configuration-file, inspect-before-edit, and manifest-security-risk when a component is exported', () => {
    const file: CodeGraphNode = { id: 'android-manifest-file:app/AndroidManifest.xml', kind: 'android-manifest-file', label: 'AndroidManifest.xml', path: 'app/src/main/AndroidManifest.xml' }
    const component: CodeGraphNode = {
      id: 'android-manifest-component:1',
      kind: 'android-manifest-component',
      label: 'MainActivity',
      androidMetadata: { componentKind: 'activity', exported: true, exportedExplicit: true, rawName: '.MainActivity', resolvedName: 'com.example.MainActivity' },
    }
    const edges: CodeGraphEdge[] = [{ id: 'e1', source: file.id, target: component.id, kind: 'manifest-declares-component' }]
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [file, component], edges })
    const fileEntry = entryFor(entries, file.id)
    expect(fileEntry.classifications.map((c) => c.role).sort()).toEqual(['android-manifest', 'configuration-file'].sort())
    expect(fileEntry.editGuidance).toBe('inspect-before-edit')
    expect(fileEntry.risks).toContain('manifest-security-risk')
  })

  it('TST-206: manifest file with no security-relevant component evidence gets no manifest-security-risk', () => {
    const file: CodeGraphNode = { id: 'android-manifest-file:app/AndroidManifest.xml', kind: 'android-manifest-file', label: 'AndroidManifest.xml' }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [file], edges: [] })
    expect(entryFor(entries, file.id).risks).not.toContain('manifest-security-risk')
  })

  it('TST-207: manifest component with exact identity is ready/certain and always carries the fixed platform-boundary risks', () => {
    const component: CodeGraphNode = {
      id: 'android-manifest-component:1',
      kind: 'android-manifest-component',
      label: 'MainActivity',
      androidMetadata: { componentKind: 'activity', exported: false, exportedExplicit: false, rawName: '.MainActivity', resolvedName: 'com.example.MainActivity' },
    }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [component], edges: [] })
    const entry = entryFor(entries, component.id)
    expect(entry.classifications.map((c) => c.role)).toEqual(['manifest-component'])
    expect(entry.readiness).toBe('ready')
    expect(entry.uncertainty).toBe('certain')
    expect(entry.risks).toEqual(expect.arrayContaining(['emulator-validation-required', 'instrumented-test-required']))
  })

  it('TST-207: manifest component with incomplete resolved identity is needs-more-context/possible with a warning', () => {
    const component: CodeGraphNode = {
      id: 'android-manifest-component:2',
      kind: 'android-manifest-component',
      label: 'MissingActivity',
      androidMetadata: { componentKind: 'activity', exported: false, exportedExplicit: false, rawName: 'MissingActivity', resolvedName: null },
    }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [component], edges: [] })
    const entry = entryFor(entries, component.id)
    expect(entry.readiness).toBe('needs-more-context')
    expect(entry.uncertainty).toBe('possible')
    expect(entry.warnings.length).toBeGreaterThan(0)
  })
})

describe('buildAndroidGraphNodeClassifications — v1.12.0 Batch 2 navigation', () => {
  it('TST-208: a destination with exactly one screen resolution is navigation-route / ready / certain', () => {
    const destination: CodeGraphNode = { id: 'nav-dest:1', kind: 'android-navigation-destination', label: 'home', androidMetadata: { destinationKind: 'fragment' } }
    const edges: CodeGraphEdge[] = [{ id: 'e1', source: destination.id, target: 'symbol:Home.kt#HomeFragment', kind: 'navigation-destination-resolves-to-screen' }]
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [destination], edges })
    const entry = entryFor(entries, destination.id)
    expect(entry.classifications.map((c) => c.role)).toEqual(['navigation-route'])
    expect(entry.readiness).toBe('ready')
    expect(entry.uncertainty).toBe('certain')
    expect(entry.risks).not.toContain('navigation-contract-risk')
  })

  it('TST-208: a destination with more than one screen candidate is needs-more-context/possible with navigation-contract-risk', () => {
    const destination: CodeGraphNode = { id: 'nav-dest:2', kind: 'android-navigation-destination', label: 'home', androidMetadata: { destinationKind: 'fragment' } }
    const edges: CodeGraphEdge[] = [
      { id: 'e1', source: destination.id, target: 'symbol:A.kt#Home', kind: 'navigation-destination-resolves-to-screen' },
      { id: 'e2', source: destination.id, target: 'symbol:B.kt#Home', kind: 'navigation-destination-resolves-to-screen' },
    ]
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [destination], edges })
    const entry = entryFor(entries, destination.id)
    expect(entry.readiness).toBe('needs-more-context')
    expect(entry.uncertainty).toBe('possible')
    expect(entry.risks).toContain('navigation-contract-risk')
  })

  it('TST-208: an unresolved destination (no screen edge) is needs-more-context/possible', () => {
    const destination: CodeGraphNode = { id: 'nav-dest:3', kind: 'android-navigation-destination', label: 'unresolved', androidMetadata: { destinationKind: 'fragment' } }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [destination], edges: [] })
    const entry = entryFor(entries, destination.id)
    expect(entry.readiness).toBe('needs-more-context')
    expect(entry.uncertainty).toBe('possible')
  })

  it('TST-208: a custom destination with no screen edge is still ready/certain (nothing to resolve)', () => {
    const destination: CodeGraphNode = { id: 'nav-dest:4', kind: 'android-navigation-destination', label: 'custom', androidMetadata: { destinationKind: 'custom' } }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [destination], edges: [] })
    expect(entryFor(entries, destination.id).readiness).toBe('ready')
  })

  it('TST-208: a Compose route with exactly one screen resolution is ready/certain; zero or multiple are ambiguous', () => {
    const resolved: CodeGraphNode = { id: 'compose-route:1', kind: 'android-compose-route', label: 'home' }
    const unresolved: CodeGraphNode = { id: 'compose-route:2', kind: 'android-compose-route', label: 'unknown' }
    const ambiguous: CodeGraphNode = { id: 'compose-route:3', kind: 'android-compose-route', label: 'dup' }
    const edges: CodeGraphEdge[] = [
      { id: 'e1', source: resolved.id, target: 'symbol:Home.kt#HomeScreen', kind: 'compose-route-resolves-to-screen' },
      { id: 'e2', source: ambiguous.id, target: 'symbol:A.kt#Dup', kind: 'compose-route-resolves-to-screen' },
      { id: 'e3', source: ambiguous.id, target: 'symbol:B.kt#Dup', kind: 'compose-route-resolves-to-screen' },
    ]
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [resolved, unresolved, ambiguous], edges })
    expect(entryFor(entries, resolved.id).uncertainty).toBe('certain')
    expect(entryFor(entries, unresolved.id).uncertainty).toBe('possible')
    const ambiguousEntry = entryFor(entries, ambiguous.id)
    expect(ambiguousEntry.uncertainty).toBe('possible')
    expect(ambiguousEntry.risks).toContain('navigation-contract-risk')
  })

  it('TST-208: a deep link matched by more than one manifest deep-link candidate is ambiguous', () => {
    const deepLink: CodeGraphNode = { id: 'nav-deep-link:1', kind: 'android-navigation-deep-link', label: 'https://example.com' }
    const edges: CodeGraphEdge[] = [
      { id: 'e1', source: 'android-manifest-component:1', target: deepLink.id, kind: 'manifest-deep-link-matches-navigation-deep-link' },
      { id: 'e2', source: 'android-manifest-component:2', target: deepLink.id, kind: 'manifest-deep-link-matches-navigation-deep-link' },
    ]
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [deepLink], edges })
    const entry = entryFor(entries, deepLink.id)
    expect(entry.uncertainty).toBe('possible')
    expect(entry.risks).toContain('navigation-contract-risk')
  })

  it('does not classify android-navigation-action nodes as navigation-route', () => {
    const action: CodeGraphNode = { id: 'nav-action:1', kind: 'android-navigation-action', label: 'toHome' }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [action], edges: [] })
    expect(entries).toHaveLength(0)
  })
})

describe('buildAndroidGraphNodeClassifications — v1.12.0 Batch 2 resources', () => {
  it('TST-209: a values resource file is resource-file / safe-primary-edit-target', () => {
    const file: CodeGraphNode = { id: 'android-resource-file:1', kind: 'android-resource-file', label: 'strings.xml', androidMetadata: { baseType: 'values', qualifiers: null } }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [file], edges: [] })
    const entry = entryFor(entries, file.id)
    expect(entry.classifications.map((c) => c.role)).toEqual(['resource-file'])
    expect(entry.editGuidance).toBe('safe-primary-edit-target')
  })

  it('TST-209: an xml-baseType resource file (platform-sensitive) is resource-file / inspect-before-edit / resource-contract-risk', () => {
    const file: CodeGraphNode = { id: 'android-resource-file:2', kind: 'android-resource-file', label: 'network_security_config.xml', androidMetadata: { baseType: 'xml', qualifiers: null } }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [file], edges: [] })
    const entry = entryFor(entries, file.id)
    expect(entry.editGuidance).toBe('inspect-before-edit')
    expect(entry.risks).toContain('resource-contract-risk')
  })

  it('TST-209: a layout resource definition gets resource-file + xml-layout, safe-primary-edit-target, and resource-contract-risk', () => {
    const def: CodeGraphNode = { id: 'android-resource-definition:layout/activity_main', kind: 'android-resource-definition', label: 'layout/activity_main', androidMetadata: { type: 'layout', name: 'activity_main' } }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [def], edges: [] })
    const entry = entryFor(entries, def.id)
    expect(entry.classifications.map((c) => c.role).sort()).toEqual(['resource-file', 'xml-layout'].sort())
    expect(entry.editGuidance).toBe('safe-primary-edit-target')
    expect(entry.risks).toContain('resource-contract-risk')
  })

  it('TST-209: two resource definitions sharing the same (type, name) key are ambiguous with resource-contract-risk', () => {
    const defA: CodeGraphNode = { id: 'android-resource-definition:a', kind: 'android-resource-definition', label: 'string/app_name', androidMetadata: { type: 'string', name: 'app_name' } }
    const defB: CodeGraphNode = { id: 'android-resource-definition:b', kind: 'android-resource-definition', label: 'string/app_name', androidMetadata: { type: 'string', name: 'app_name' } }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [defA, defB], edges: [] })
    for (const id of [defA.id, defB.id]) {
      const entry = entryFor(entries, id)
      expect(entry.uncertainty).toBe('possible')
      expect(entry.risks).toContain('resource-contract-risk')
    }
  })

  it('a single string resource definition (no ambiguity) is ready/certain with no resource-contract-risk', () => {
    const def: CodeGraphNode = { id: 'android-resource-definition:c', kind: 'android-resource-definition', label: 'string/app_name', androidMetadata: { type: 'string', name: 'app_name' } }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [def], edges: [] })
    const entry = entryFor(entries, def.id)
    expect(entry.uncertainty).toBe('certain')
    expect(entry.risks).not.toContain('resource-contract-risk')
  })
})

describe('buildAndroidGraphNodeClassifications — v1.12.0 Batch 2 Compose', () => {
  it('TST-210: a composable targeted by exactly one Compose route is compose-screen / safe-primary-edit-target / ready / certain', () => {
    const composable: CodeGraphNode = { id: 'composable:Home', kind: 'android-composable', label: 'HomeScreen', androidMetadata: { factKind: 'composable', isPreview: false } }
    const edges: CodeGraphEdge[] = [{ id: 'e1', source: 'compose-route:1', target: composable.id, kind: 'compose-route-resolves-to-screen' }]
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [composable], edges })
    const entry = entryFor(entries, composable.id)
    expect(entry.classifications.map((c) => c.role)).toEqual(['compose-screen'])
    expect(entry.editGuidance).toBe('safe-primary-edit-target')
    expect(entry.readiness).toBe('ready')
    expect(entry.uncertainty).toBe('certain')
  })

  it('TST-210: a composable targeted by more than one route is compose-screen but needs-more-context/possible with navigation-contract-risk', () => {
    const composable: CodeGraphNode = { id: 'composable:Shared', kind: 'android-composable', label: 'Shared', androidMetadata: { factKind: 'composable', isPreview: false } }
    const edges: CodeGraphEdge[] = [
      { id: 'e1', source: 'compose-route:1', target: composable.id, kind: 'compose-route-resolves-to-screen' },
      { id: 'e2', source: 'nav-dest:1', target: composable.id, kind: 'navigation-destination-resolves-to-screen' },
    ]
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [composable], edges })
    const entry = entryFor(entries, composable.id)
    expect(entry.classifications.map((c) => c.role)).toEqual(['compose-screen'])
    expect(entry.readiness).toBe('needs-more-context')
    expect(entry.risks).toContain('navigation-contract-risk')
  })

  it('TST-211: a non-screen production composable is compose-ui-component / safe-primary-edit-target / ready / certain', () => {
    const composable: CodeGraphNode = { id: 'composable:Button', kind: 'android-composable', label: 'PrimaryButton', androidMetadata: { factKind: 'composable', isPreview: false } }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [composable], edges: [] })
    const entry = entryFor(entries, composable.id)
    expect(entry.classifications.map((c) => c.role)).toEqual(['compose-ui-component'])
    expect(entry.editGuidance).toBe('safe-primary-edit-target')
  })

  it('a @Preview composable is compose-ui-component but read-only-reference, never a production screen', () => {
    const preview: CodeGraphNode = { id: 'composable:Preview', kind: 'android-composable', label: 'HomePreview', androidMetadata: { factKind: 'composable', isPreview: true } }
    const edges: CodeGraphEdge[] = [{ id: 'e1', source: 'compose-route:1', target: preview.id, kind: 'compose-route-resolves-to-screen' }]
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [preview], edges })
    const entry = entryFor(entries, preview.id)
    expect(entry.classifications.map((c) => c.role)).toEqual(['compose-ui-component'])
    expect(entry.editGuidance).toBe('read-only-reference')
  })

  it('TST-212: a Compose local-state fact is ui-only-state / safe-primary-edit-target / ready / certain', () => {
    const fact: CodeGraphNode = { id: 'fact:state1', kind: 'android-compose-fact', label: 'remember', androidMetadata: { factKind: 'state', composableId: 'composable:Home' } }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [fact], edges: [] })
    const entry = entryFor(entries, fact.id)
    expect(entry.classifications.map((c) => c.role)).toEqual(['ui-only-state'])
    expect(entry.editGuidance).toBe('safe-primary-edit-target')
    // No ViewModel-ownership inference in this batch.
    expect(entry.classifications.some((c) => c.role === 'view-model')).toBe(false)
  })

  it('TST-213: a resolved click-handler fact is ui-event / inspect-before-edit / ready / certain, with wrong-layer-risk as a usage site', () => {
    const fact: CodeGraphNode = { id: 'fact:click1', kind: 'android-compose-fact', label: 'onClick', androidMetadata: { factKind: 'click-handler', status: 'resolved' } }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [fact], edges: [] })
    const entry = entryFor(entries, fact.id)
    expect(entry.classifications.map((c) => c.role)).toEqual(['ui-event'])
    expect(entry.editGuidance).toBe('inspect-before-edit')
    expect(entry.readiness).toBe('ready')
    expect(entry.risks).toContain('wrong-layer-risk')
  })

  it('TST-213: a click-handler fact statically connected to navigation evidence gets navigation-contract-risk', () => {
    const fact: CodeGraphNode = { id: 'fact:click2', kind: 'android-compose-fact', label: 'onClick', androidMetadata: { factKind: 'click-handler', status: 'resolved' } }
    const edges: CodeGraphEdge[] = [{ id: 'e1', source: fact.id, target: 'fact:navcall1', kind: 'click-handler-contains-navigation-call' }]
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [fact], edges })
    expect(entryFor(entries, fact.id).risks).toContain('navigation-contract-risk')
  })

  it('TST-213: an unresolved click-handler fact is needs-more-context/possible with a warning', () => {
    const fact: CodeGraphNode = { id: 'fact:click3', kind: 'android-compose-fact', label: 'onClick', androidMetadata: { factKind: 'click-handler', status: 'unresolved' } }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [fact], edges: [] })
    const entry = entryFor(entries, fact.id)
    expect(entry.readiness).toBe('needs-more-context')
    expect(entry.uncertainty).toBe('possible')
    expect(entry.warnings.length).toBeGreaterThan(0)
  })

  it('does not classify unrelated Compose fact kinds (e.g. effect, string-resource) in this batch', () => {
    const fact: CodeGraphNode = { id: 'fact:effect1', kind: 'android-compose-fact', label: 'LaunchedEffect', androidMetadata: { factKind: 'effect' } }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [fact], edges: [] })
    expect(entries).toHaveLength(0)
  })
})

describe('buildAndroidGraphNodeClassifications — v1.12.0 Batch 2 Android tests', () => {
  it('TST-214: a unit test file gets android-unit-test + test-block + test-fixture, test-only, ready, certain', () => {
    const file: CodeGraphNode = { id: 'test-file:1', kind: 'android-test-file', label: 'MainActivityTest.kt', androidMetadata: { factKind: 'test-file', sourceSet: 'test', category: 'unit', language: 'kotlin', frameworks: 'junit4' } }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [file], edges: [] })
    const entry = entryFor(entries, file.id)
    expect(entry.classifications.map((c) => c.role).sort()).toEqual(['android-unit-test', 'test-block', 'test-fixture'].sort())
    expect(entry.editGuidance).toBe('test-only')
    expect(entry.readiness).toBe('ready')
    expect(entry.uncertainty).toBe('certain')
  })

  it('TST-215: an instrumented test file gets instrumented-test + test-block + test-fixture', () => {
    const file: CodeGraphNode = { id: 'test-file:2', kind: 'android-test-file', label: 'MainActivityInstrumentedTest.kt', androidMetadata: { factKind: 'test-file', sourceSet: 'androidTest', category: 'instrumented', language: 'kotlin', frameworks: 'espresso' } }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [file], edges: [] })
    expect(entryFor(entries, file.id).classifications.map((c) => c.role).sort()).toEqual(['instrumented-test', 'test-block', 'test-fixture'].sort())
  })

  it('TST-216: a unit test file with Compose-UI framework evidence additionally gets compose-ui-test', () => {
    const file: CodeGraphNode = { id: 'test-file:3', kind: 'android-test-file', label: 'HomeScreenTest.kt', androidMetadata: { factKind: 'test-file', sourceSet: 'test', category: 'unit', language: 'kotlin', frameworks: 'junit4,compose-ui' } }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [file], edges: [] })
    const roles = entryFor(entries, file.id).classifications.map((c) => c.role)
    expect(roles).toEqual(expect.arrayContaining(['android-unit-test', 'compose-ui-test', 'test-block', 'test-fixture']))
  })

  it('TST-214: a test method carries its own category directly', () => {
    const method: CodeGraphNode = { id: 'test-method:1', kind: 'android-test-method', label: 'testLaunch', androidMetadata: { factKind: 'test-method', endLine: 10, category: 'unit', frameworks: 'junit4' } }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [method], edges: [] })
    expect(entryFor(entries, method.id).classifications.map((c) => c.role)).toContain('android-unit-test')
  })

  it('a test class derives its category from its owning test file via defines-test-class', () => {
    const file: CodeGraphNode = { id: 'test-file:4', kind: 'android-test-file', label: 'MainTest.kt', androidMetadata: { factKind: 'test-file', sourceSet: 'androidTest', category: 'instrumented', language: 'kotlin', frameworks: 'espresso' } }
    const cls: CodeGraphNode = { id: 'test-class:1', kind: 'android-test-class', label: 'MainTest', androidMetadata: { factKind: 'test-class', endLine: 20, superclassOrRunner: null, frameworks: 'espresso' } }
    const edges: CodeGraphEdge[] = [{ id: 'e1', source: file.id, target: cls.id, kind: 'defines-test-class' }]
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [file, cls], edges })
    expect(entryFor(entries, cls.id).classifications.map((c) => c.role)).toContain('instrumented-test')
  })
})

describe('buildAndroidGraphNodeClassifications — v1.12.0 Batch 2 generated build paths', () => {
  it('TST-217: a generated build path node is generated-file / generated-do-not-edit / ready / certain / generated-build-file-risk', () => {
    const node: CodeGraphNode = { id: 'android-generated-build-path:app/build', kind: 'android-generated-build-path', label: 'app/build', path: 'app/build' }
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: [node], edges: [] })
    const entry = entryFor(entries, node.id)
    expect(entry.classifications.map((c) => c.role)).toEqual(['generated-file'])
    expect(entry.editGuidance).toBe('generated-do-not-edit')
    expect(entry.readiness).toBe('ready')
    expect(entry.uncertainty).toBe('certain')
    expect(entry.risks).toEqual(['generated-build-file-risk'])
    // No absolute path leaks into the stable ID.
    expect(entry.targetId).not.toContain('C:')
    expect(entry.targetId).not.toContain('Z:')
  })
})

describe('buildAndroidGraphNodeClassifications — v1.12.0 Batch 2 determinism and risk contract', () => {
  it('TST-226: repeated calls over the same input produce identical entries and ordering', () => {
    const nodes: CodeGraphNode[] = [
      { id: 'android-resource-definition:a', kind: 'android-resource-definition', label: 'x', androidMetadata: { type: 'string', name: 'app_name' } },
      { id: 'android-generated-build-path:app/build', kind: 'android-generated-build-path', label: 'app/build', path: 'app/build' },
    ]
    const first = buildAndroidGraphNodeClassifications({ graphNodes: nodes, edges: [] })
    const second = buildAndroidGraphNodeClassifications({ graphNodes: nodes, edges: [] })
    expect(first.entries).toEqual(second.entries)
  })

  it('TST-202: every new risk label is a valid, distinct string value', () => {
    const risks = [
      'manifest-security-risk',
      'generated-build-file-risk',
      'resource-contract-risk',
      'navigation-contract-risk',
      'emulator-validation-required',
      'instrumented-test-required',
    ]
    expect(new Set(risks).size).toBe(risks.length)
  })
})
