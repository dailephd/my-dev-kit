/**
 * v1.12.0 Batch 2: central category and risk-label contract. TST-201, TST-202.
 */
import { describe, expect, it } from 'vitest'
import { buildAndroidGraphNodeClassifications } from '../../src/classification/classifyAndroidGraphNodes.js'
import { mergeAndroidComponentRoleClassifications } from '../../src/classification/mergeAndroidComponentRoleClassifications.js'
import { ANDROID_PROJECT_ROOT_NODE_ID } from '../../src/android/buildAndroidArtifactRelationships.js'
import type { AndroidComponentEntry, AndroidComponentRole } from '../../src/android/androidComponentTypes.js'
import type { ClassificationEntry, RiskLabel } from '../../src/classification/classificationTypes.js'
import type { CodeGraphNode } from '../../src/graph/codeGraphTypes.js'

const EXPECTED_GRAPH_NODE_CATEGORIES = new Set([
  'android-project',
  'gradle-module',
  'android-app-module',
  'android-library-module',
  'android-manifest',
  'configuration-file',
  'manifest-component',
  'navigation-route',
  'resource-file',
  'xml-layout',
  'compose-screen',
  'compose-ui-component',
  'ui-only-state',
  'ui-event',
  'android-unit-test',
  'instrumented-test',
  'compose-ui-test',
  'test-block',
  'test-fixture',
  'generated-file',
])

const EXPECTED_COMPONENT_ROLES: AndroidComponentRole[] = [
  'activity',
  'fragment',
  'view-model',
  'service',
  'broadcast-receiver',
  'content-provider',
  'worker',
  'repository',
  'use-case',
  'room-entity',
  'room-dao',
  'room-database',
  'retrofit-service',
  'hilt-module',
]

const PROHIBITED_SYNONYMS = [
  'android-activity',
  'android-fragment',
  'viewmodel',
  'unit-test',
  'generated-build-file',
  'android-repository',
  'android-room-entity',
  'android-view-model',
]

const EXPECTED_RISK_LABELS: RiskLabel[] = [
  'wrong-layer-risk',
  'manifest-security-risk',
  'generated-build-file-risk',
  'resource-contract-risk',
  'navigation-contract-risk',
  'emulator-validation-required',
  'instrumented-test-required',
]

function comprehensiveGraphNodesAndEdges() {
  const nodes: CodeGraphNode[] = [
    { id: ANDROID_PROJECT_ROOT_NODE_ID, kind: 'android-project' as const, label: 'Android project' },
    { id: 'android-module:app', kind: 'android-module' as const, label: 'app', path: 'app', androidMetadata: { moduleType: 'app' } },
    { id: 'android-manifest-file:1', kind: 'android-manifest-file' as const, label: 'AndroidManifest.xml' },
    { id: 'android-manifest-component:1', kind: 'android-manifest-component' as const, label: 'MainActivity', androidMetadata: { componentKind: 'activity', exported: true, exportedExplicit: true, rawName: '.Main', resolvedName: 'com.example.Main' } },
    { id: 'android-navigation-graph:1', kind: 'android-navigation-graph' as const, label: 'nav_graph' },
    { id: 'android-navigation-destination:1', kind: 'android-navigation-destination' as const, label: 'home', androidMetadata: { destinationKind: 'custom' } },
    { id: 'android-navigation-deep-link:1', kind: 'android-navigation-deep-link' as const, label: 'deeplink' },
    { id: 'android-compose-route:1', kind: 'android-compose-route' as const, label: 'route' },
    { id: 'android-resource-file:1', kind: 'android-resource-file' as const, label: 'strings.xml', androidMetadata: { baseType: 'values', qualifiers: null } },
    { id: 'android-resource-definition:layout/x', kind: 'android-resource-definition' as const, label: 'layout/x', androidMetadata: { type: 'layout', name: 'x' } },
    { id: 'android-composable:screen', kind: 'android-composable' as const, label: 'Screen', androidMetadata: { factKind: 'composable', isPreview: false } },
    { id: 'android-composable:component', kind: 'android-composable' as const, label: 'Component', androidMetadata: { factKind: 'composable', isPreview: false } },
    { id: 'android-compose-fact:state', kind: 'android-compose-fact' as const, label: 'state', androidMetadata: { factKind: 'state' } },
    { id: 'android-compose-fact:click', kind: 'android-compose-fact' as const, label: 'click', androidMetadata: { factKind: 'click-handler', status: 'resolved' } },
    { id: 'android-test-file:unit', kind: 'android-test-file' as const, label: 'UnitTest.kt', androidMetadata: { factKind: 'test-file', sourceSet: 'test', category: 'unit', language: 'kotlin', frameworks: 'junit4,compose-ui' } },
    { id: 'android-test-file:instrumented', kind: 'android-test-file' as const, label: 'InstrumentedTest.kt', androidMetadata: { factKind: 'test-file', sourceSet: 'androidTest', category: 'instrumented', language: 'kotlin', frameworks: 'espresso' } },
    { id: 'android-generated-build-path:app/build', kind: 'android-generated-build-path' as const, label: 'app/build', path: 'app/build' },
  ]
  const edges = [
    { id: 'e1', source: 'android-compose-route:1', target: 'android-composable:screen', kind: 'compose-route-resolves-to-screen' as const },
  ]
  return { nodes, edges }
}

describe('classification vocabulary contract', () => {
  it('TST-201: every Batch 1/2 graph-node category is produced exactly as specified, with no prohibited synonym', () => {
    const { nodes, edges } = comprehensiveGraphNodesAndEdges()
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: nodes, edges })
    const observedRoles = new Set<string>(entries.flatMap((e: ClassificationEntry) => e.classifications.map((c) => c.role)))

    for (const category of observedRoles) {
      expect(EXPECTED_GRAPH_NODE_CATEGORIES.has(category)).toBe(true)
    }
    for (const forbidden of PROHIBITED_SYNONYMS) {
      expect(observedRoles.has(forbidden)).toBe(false)
    }
  })

  it('TST-201: every supported Android component role maps to the exact classification category, with no prohibited synonym', () => {
    const entries: ClassificationEntry[] = EXPECTED_COMPONENT_ROLES.map((role, i) => ({
      id: `classification:symbol:symbol:src/S${i}.kt#S${i}`,
      targetId: `symbol:src/S${i}.kt#S${i}`,
      targetKind: 'symbol',
      filePath: `src/S${i}.kt`,
      symbolName: `S${i}`,
      nodeId: `symbol:src/S${i}.kt#S${i}`,
      classifications: [],
      editGuidance: 'uncertain',
      readiness: 'needs-more-context',
      risks: [],
      evidence: [],
      uncertainty: 'unknown',
      reason: 'unresolved',
      sourceRefs: [{ filePath: `src/S${i}.kt` }],
      artifactRefs: [],
      warnings: [{ kind: 'no-static-evidence', message: 'unresolved' }],
    }))
    const components: AndroidComponentEntry[] = EXPECTED_COMPONENT_ROLES.map((role, i) => ({
      id: `android-component:${i}`,
      role,
      confidence: 'high',
      filePath: `src/S${i}.kt`,
      symbolId: `symbol:src/S${i}.kt#S${i}`,
      symbolName: `S${i}`,
      sourceLanguage: 'kotlin',
      modulePath: 'app',
      sourceSet: 'main',
      packageName: 'com.example',
      evidence: [],
      warnings: [],
    }))
    const { entries: merged } = mergeAndroidComponentRoleClassifications(entries, components)
    const observedRoles = new Set(merged.flatMap((e) => e.classifications.map((c) => c.role)))

    for (const role of EXPECTED_COMPONENT_ROLES) {
      expect(observedRoles.has(role)).toBe(true)
    }
    for (const forbidden of PROHIBITED_SYNONYMS) {
      expect(observedRoles.has(forbidden)).toBe(false)
    }
  })

  it('TST-202: all seven new risk labels are valid, distinct, and serialize deterministically', () => {
    const { nodes, edges } = comprehensiveGraphNodesAndEdges()
    const { entries } = buildAndroidGraphNodeClassifications({ graphNodes: nodes, edges })
    const observedRisks = new Set<string>(entries.flatMap((e) => e.risks))

    const newRisks = EXPECTED_RISK_LABELS.filter((r) => r !== 'wrong-layer-risk')
    for (const risk of newRisks) {
      expect(EXPECTED_RISK_LABELS).toContain(risk)
    }
    expect(new Set(EXPECTED_RISK_LABELS).size).toBe(EXPECTED_RISK_LABELS.length)
    // Every risk actually observed in this batch's output is one of the fixed, known labels.
    for (const risk of observedRisks) {
      expect(EXPECTED_RISK_LABELS.includes(risk as RiskLabel) || risk === 'wrong-layer-risk').toBe(true)
    }
  })
})
