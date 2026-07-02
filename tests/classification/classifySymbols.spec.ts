import { describe, expect, it } from 'vitest'
import { classifySymbol } from '../../src/classification/classifySymbols.js'
import type { SymbolEvidenceBundle } from '../../src/classification/gatherSymbolEvidence.js'
import type { SymbolDefinition } from '../../src/symbol-index/types.js'

function buildSymbol(overrides: Partial<SymbolDefinition>): SymbolDefinition {
  return {
    name: 'Example',
    kind: 'interface',
    location: { file: 'src/models.ts', line: 1 },
    exported: true,
    ...overrides,
  }
}

function emptyEvidence(overrides: Partial<SymbolEvidenceBundle> = {}): SymbolEvidenceBundle {
  return { existingRole: null, matchedExistingCategory: null, frontendReachabilityFact: null, ...overrides }
}

describe('classifySymbol', () => {
  it('TST-012: reuses an existing semantic role category verbatim via subtype (only role ever produced is data-entity)', () => {
    const symbol = buildSymbol({ name: 'User' })
    const entry = classifySymbol(
      'src/models.ts',
      symbol,
      emptyEvidence({
        existingRole: {
          role: 'data-entity',
          subtype: 'database-model',
          confidence: 'explicit',
          source: 'typescript-model-analyzer',
        },
        matchedExistingCategory: 'database-model',
      })
    )

    expect(entry.classifications).toEqual([
      expect.objectContaining({ role: 'database-model', confidence: 'certain' }),
    ])
    expect(entry.uncertainty).toBe('certain')
  })

  it('TST-013: view-model classification maps to safe-primary-edit-target when certain/likely', () => {
    const symbol = buildSymbol({ name: 'UserViewModel' })
    const entry = classifySymbol(
      'src/viewModels.ts',
      symbol,
      emptyEvidence({
        existingRole: {
          role: 'data-entity',
          subtype: 'view-model',
          confidence: 'explicit',
          source: 'typescript-model-analyzer',
        },
        matchedExistingCategory: 'view-model',
      })
    )

    expect(entry.classifications).toEqual([expect.objectContaining({ role: 'view-model' })])
    expect(entry.editGuidance).toBe('safe-primary-edit-target')
  })

  it('database-model classification maps to avoid-primary-edit-target when certain, and carries wrong-layer-risk', () => {
    const symbol = buildSymbol({ name: 'UserRecord' })
    const entry = classifySymbol(
      'src/models.ts',
      symbol,
      emptyEvidence({
        existingRole: {
          role: 'data-entity',
          subtype: 'database-model',
          confidence: 'explicit',
          source: 'typescript-model-analyzer',
        },
        matchedExistingCategory: 'database-model',
      })
    )

    expect(entry.editGuidance).toBe('avoid-primary-edit-target')
    expect(entry.risks).toContain('wrong-layer-risk')
  })

  it('TST-014: ui-only-state classification via a frontend-reachability fact', () => {
    const symbol = buildSymbol({ name: 'useModalState' })
    const entry = classifySymbol(
      'src/components/Modal.tsx',
      symbol,
      emptyEvidence({
        frontendReachabilityFact: { factKind: 'ui-reachability', inferredRole: 'ui-only-state', hasReachabilityGate: true },
      })
    )

    expect(entry.classifications).toEqual([
      expect.objectContaining({ role: 'ui-only-state', confidence: 'likely' }),
    ])
  })

  it('AC-007: a symbol with no existing role and no static evidence still receives a documented-absence entry', () => {
    const symbol = buildSymbol({ name: 'formatUser' })
    const entry = classifySymbol('src/service.ts', symbol, emptyEvidence())

    expect(entry.classifications).toEqual([])
    expect(entry.uncertainty).toBe('unknown')
    expect(entry.editGuidance).toBe('uncertain')
    expect(entry.warnings).toEqual([expect.objectContaining({ kind: 'no-static-evidence' })])
  })
})
