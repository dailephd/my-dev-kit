import { describe, expect, it } from 'vitest'
import { buildClassificationArtifact } from '../../src/classification/buildClassificationArtifact.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'

function buildSymbolIndex(): SymbolIndex {
  return {
    schemaVersion: '2',
    buildTime: '2026-01-01T00:00:00.000Z',
    repoRoot: '/repo',
    sourceRoots: ['src'],
    fileCount: 1,
    symbolCount: 1,
    files: [
      {
        path: 'src/models.ts',
        language: 'typescript',
        lineCount: 5,
        imports: [],
        exports: ['User'],
        symbols: [
          {
            name: 'User',
            kind: 'interface',
            location: { file: 'src/models.ts', line: 1 },
            exported: true,
          },
        ],
        hasCallGraphEntries: false,
      },
    ],
  }
}

function buildCodeGraph(): CodeGraph {
  return {
    artifactKind: 'code-graph',
    schemaVersion: '1.0.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    nodes: [
      { id: 'file:src/models.ts', kind: 'file', label: 'models.ts', path: 'src/models.ts' },
      { id: 'symbol:src/models.ts#User', kind: 'symbol', label: 'User', path: 'src/models.ts' },
    ],
    edges: [],
    summary: { nodeCount: 2, edgeCount: 0, fileNodeCount: 1, symbolNodeCount: 1 },
  }
}

describe('classification graceful degradation (INV-004 / missing optional artifacts)', () => {
  it('does not throw when dataModel, frontendSemantic, and frontendReachability are all null', () => {
    expect(() =>
      buildClassificationArtifact({
        symbolIndex: buildSymbolIndex(),
        codeGraph: buildCodeGraph(),
        dataModel: null,
        frontendSemantic: null,
        frontendReachability: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    ).not.toThrow()
  })

  it('still produces a well-formed artifact with entries for every file and symbol when all optional artifacts are absent', () => {
    const { artifact } = buildClassificationArtifact({
      symbolIndex: buildSymbolIndex(),
      codeGraph: buildCodeGraph(),
      dataModel: null,
      frontendSemantic: null,
      frontendReachability: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    expect(artifact.schemaVersion).toBe('1.1.0')
    expect(artifact.summary.fileEntryCount).toBe(1)
    expect(artifact.summary.symbolEntryCount).toBe(1)
    // No dataModel means no existing-semantic-role evidence, so the User symbol
    // is correctly unresolved (uncertain), not fabricated as a database-model guess.
    const userEntry = artifact.entries.find((entry) => entry.targetId === 'symbol:src/models.ts#User')
    expect(userEntry?.classifications).toEqual([])
    expect(userEntry?.uncertainty).toBe('unknown')
    expect(userEntry?.editGuidance).toBe('uncertain')
  })
})
