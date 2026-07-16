import { describe, expect, it } from 'vitest'
import { applyRoleAwareCandidates } from '../../src/context/roleCandidates.js'
import type { CandidateFile, CandidateNode, ChangedSurface, ContextFocusIntake } from '../../src/context/types.js'
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'

// v1.10.1 Batch 2: module-level ranking unit coverage (complements the CLI-level
// tests in contextRoleCandidates.spec.ts). Responsibility IDs: TST-B2-021, TST-B2-022.

const emptyFocus: ContextFocusIntake = {
  focusFiles: [],
  focusSymbols: [],
  unresolvedFocusFiles: [],
  unresolvedFocusSymbols: [],
  ambiguousFocusSymbols: [],
  warnings: [],
}

const emptyChangedSurface: ChangedSurface = {
  available: false,
  diffRequested: false,
  files: [],
  symbols: [],
  conflicts: [],
  warnings: [],
}

const emptyGraph: CodeGraph = {
  artifactKind: 'code-graph',
  schemaVersion: '1.0.0',
  createdAt: '2026-01-01T00:00:00.000Z',
  nodes: [],
  edges: [],
  summary: { nodeCount: 0, edgeCount: 0, fileNodeCount: 0, symbolNodeCount: 0 },
}

function candidateFile(path: string, score: number): CandidateFile {
  return { path, score, reasons: [], matchedTerms: [], retained: true }
}

function candidateNode(nodeId: string, score: number): CandidateNode {
  return { nodeId, kind: 'file', label: nodeId, score, reasons: [], matchedTerms: [], retained: true }
}

describe('applyRoleAwareCandidates (unit)', () => {
  it('TST-B2-021: tied scores tie-break by path/nodeId, not insertion order', () => {
    const candidateFiles: CandidateFile[] = [candidateFile('src/z.ts', 10), candidateFile('src/a.ts', 10), candidateFile('src/m.ts', 10)]
    const candidateNodes: CandidateNode[] = [candidateNode('file:src/z.ts', 10), candidateNode('file:src/a.ts', 10)]

    const result = applyRoleAwareCandidates({
      role: null,
      candidateFiles,
      candidateNodes,
      focusIntake: emptyFocus,
      changedSurface: emptyChangedSurface,
      requestedEvidenceKinds: [],
      codeGraph: emptyGraph,
      maxCandidateFiles: null,
    })

    expect(result.candidateFiles.map((f) => f.path)).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts'])
    expect(result.candidateNodes.map((n) => n.nodeId)).toEqual(['file:src/a.ts', 'file:src/z.ts'])
  })

  it('TST-B2-022: injected focus/changed-surface file candidates respect --max-candidate-files', () => {
    const candidateFiles: CandidateFile[] = [candidateFile('src/existing.ts', 5)]
    const focusIntake: ContextFocusIntake = {
      ...emptyFocus,
      focusFiles: [{ path: 'src/focus.ts', resolved: true, matchedFilePaths: ['src/focus.ts'], containedSymbolIds: [] }],
    }
    const changedSurface: ChangedSurface = {
      ...emptyChangedSurface,
      available: true,
      files: [{ path: 'src/changed.ts', status: 'modified', provenance: 'caller' }],
    }

    const result = applyRoleAwareCandidates({
      role: 'implementation',
      candidateFiles,
      candidateNodes: [],
      focusIntake,
      changedSurface,
      requestedEvidenceKinds: [],
      codeGraph: emptyGraph,
      maxCandidateFiles: 1,
    })

    const retained = result.candidateFiles.filter((f) => f.retained)
    expect(retained.length).toBe(1)
    // The highest-boosted candidate (explicit focus file) wins the single retained slot.
    expect(retained[0].path).toBe('src/focus.ts')
  })

  it('legacy (role === null) behavior leaves unrelated candidates untouched', () => {
    const candidateFiles: CandidateFile[] = [candidateFile('src/one.ts', 7), candidateFile('src/two.ts', 3)]
    const result = applyRoleAwareCandidates({
      role: null,
      candidateFiles,
      candidateNodes: [],
      focusIntake: emptyFocus,
      changedSurface: emptyChangedSurface,
      requestedEvidenceKinds: [],
      codeGraph: emptyGraph,
      maxCandidateFiles: null,
    })
    expect(result.candidateFiles).toEqual(candidateFiles)
  })
})
