/**
 * v1.12.0 Batch 2: merging android-components.json role facts into existing
 * `symbol`-kind classification entries. TST-204, TST-205, TST-218, TST-219.
 */
import { describe, expect, it } from 'vitest'
import { mergeAndroidComponentRoleClassifications } from '../../src/classification/mergeAndroidComponentRoleClassifications.js'
import type { AndroidComponentEntry } from '../../src/android/androidComponentTypes.js'
import type { ClassificationEntry } from '../../src/classification/classificationTypes.js'

function component(overrides: Partial<AndroidComponentEntry> = {}): AndroidComponentEntry {
  return {
    id: 'android-component:1',
    role: 'activity',
    confidence: 'high',
    filePath: 'src/MainActivity.kt',
    symbolId: 'symbol:src/MainActivity.kt#MainActivity',
    symbolName: 'MainActivity',
    sourceLanguage: 'kotlin',
    modulePath: 'app',
    sourceSet: 'main',
    packageName: 'com.example',
    evidence: [],
    warnings: [],
    ...overrides,
  }
}

function unresolvedEntry(targetId: string): ClassificationEntry {
  return {
    id: `classification:symbol:${targetId}`,
    targetId,
    targetKind: 'symbol',
    filePath: 'src/MainActivity.kt',
    symbolName: 'MainActivity',
    nodeId: targetId,
    classifications: [],
    editGuidance: 'uncertain',
    readiness: 'needs-more-context',
    risks: [],
    evidence: [],
    uncertainty: 'unknown',
    reason: 'no existing semantic role and no static evidence found',
    sourceRefs: [{ filePath: 'src/MainActivity.kt' }],
    artifactRefs: [],
    warnings: [{ kind: 'no-static-evidence', message: 'no existing semantic role and no static evidence found' }],
  }
}

function resolvedEntry(targetId: string): ClassificationEntry {
  return {
    ...unresolvedEntry(targetId),
    classifications: [{ role: 'canonical-type', subtype: null, confidence: 'certain' }],
    editGuidance: 'safe-primary-edit-target',
    readiness: 'ready',
    uncertainty: 'certain',
    reason: 'existing semantic role',
    warnings: [],
  }
}

describe('mergeAndroidComponentRoleClassifications', () => {
  it('TST-204/TST-205: high confidence -> ready/certain, safe-primary-edit-target guidance derived from role table', () => {
    const targetId = 'symbol:src/MainActivity.kt#MainActivity'
    const { entries } = mergeAndroidComponentRoleClassifications([unresolvedEntry(targetId)], [component({ confidence: 'high', role: 'activity' })])
    const entry = entries[0]!
    expect(entry.classifications.map((c) => c.role)).toEqual(['activity'])
    expect(entry.uncertainty).toBe('certain')
    expect(entry.readiness).toBe('ready')
    expect(entry.editGuidance).toBe('inspect-before-edit')
  })

  it('TST-205: medium confidence -> ready/likely', () => {
    const targetId = 'symbol:src/MainActivity.kt#MainActivity'
    const { entries } = mergeAndroidComponentRoleClassifications([unresolvedEntry(targetId)], [component({ confidence: 'medium', role: 'repository' })])
    const entry = entries[0]!
    expect(entry.uncertainty).toBe('likely')
    expect(entry.readiness).toBe('ready')
    expect(entry.editGuidance).toBe('safe-primary-edit-target')
  })

  it('TST-205: low confidence -> uncertain guidance, risky-assumption readiness, possible uncertainty, wrong-layer-risk, and a warning', () => {
    const targetId = 'symbol:src/MainActivity.kt#MainActivity'
    const { entries } = mergeAndroidComponentRoleClassifications([unresolvedEntry(targetId)], [component({ confidence: 'low', role: 'activity' })])
    const entry = entries[0]!
    expect(entry.editGuidance).toBe('uncertain')
    expect(entry.readiness).toBe('risky-assumption')
    expect(entry.uncertainty).toBe('possible')
    expect(entry.risks).toContain('wrong-layer-risk')
    expect(entry.warnings.length).toBeGreaterThan(0)
  })

  it('does not upgrade low-confidence evidence merely because only one candidate exists', () => {
    const targetId = 'symbol:src/MainActivity.kt#MainActivity'
    const { entries } = mergeAndroidComponentRoleClassifications([unresolvedEntry(targetId)], [component({ confidence: 'low', role: 'view-model' })])
    expect(entries[0]!.uncertainty).toBe('possible')
  })

  it('TST-219: an already-classified entry keeps its existing category alongside the new Android role (deduplicated coexistence)', () => {
    const targetId = 'symbol:src/MainActivity.kt#MainActivity'
    const { entries } = mergeAndroidComponentRoleClassifications([resolvedEntry(targetId)], [component({ confidence: 'high', role: 'room-entity' })])
    const roles = entries[0]!.classifications.map((c) => c.role)
    expect(roles).toEqual(['canonical-type', 'room-entity'])
    expect(new Set(roles).size).toBe(roles.length)
  })

  it('leaves non-matching entries (no android component for that symbol) untouched', () => {
    const untouched = resolvedEntry('symbol:src/Other.kt#Other')
    const { entries } = mergeAndroidComponentRoleClassifications([untouched], [component({ symbolId: 'symbol:src/MainActivity.kt#MainActivity' })])
    expect(entries[0]).toEqual(untouched)
  })

  it('leaves file-kind entries untouched even if their targetId happens to match a component symbolId', () => {
    const fileEntry: ClassificationEntry = { ...resolvedEntry('symbol:src/MainActivity.kt#MainActivity'), targetKind: 'file' }
    const { entries } = mergeAndroidComponentRoleClassifications([fileEntry], [component()])
    expect(entries[0]).toEqual(fileEntry)
  })

  it('TST-218: the merged entry ID/targetId are unchanged - no new entry is created, only the existing one is updated', () => {
    const targetId = 'symbol:src/MainActivity.kt#MainActivity'
    const original = unresolvedEntry(targetId)
    const { entries } = mergeAndroidComponentRoleClassifications([original], [component()])
    expect(entries).toHaveLength(1)
    expect(entries[0]!.id).toBe(original.id)
    expect(entries[0]!.targetId).toBe(original.targetId)
  })

  it('warningCount reflects the final merged warnings across all entries', () => {
    const targetId = 'symbol:src/MainActivity.kt#MainActivity'
    const { entries, warningCount } = mergeAndroidComponentRoleClassifications([unresolvedEntry(targetId)], [component({ confidence: 'low' })])
    expect(warningCount).toBe(entries.reduce((sum, e) => sum + e.warnings.length, 0))
  })
})
