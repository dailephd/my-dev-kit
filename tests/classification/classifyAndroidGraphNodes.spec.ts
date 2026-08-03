/**
 * v1.12.0 Batch 1: classification rules for android-project/android-module
 * graph-node targets. TST-003, TST-004, TST-005, TST-006, TST-007, TST-014.
 */
import { describe, expect, it } from 'vitest'
import { buildAndroidGraphNodeClassifications } from '../../src/classification/classifyAndroidGraphNodes.js'
import { ANDROID_PROJECT_ROOT_NODE_ID } from '../../src/android/buildAndroidArtifactRelationships.js'
import type { CodeGraphNode } from '../../src/graph/codeGraphTypes.js'

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
