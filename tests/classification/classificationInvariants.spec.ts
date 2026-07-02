import { describe, expect, it } from 'vitest'
import { classifyFile } from '../../src/classification/classifyFiles.js'
import { classifySymbol } from '../../src/classification/classifySymbols.js'
import type { SymbolEvidenceBundle } from '../../src/classification/gatherSymbolEvidence.js'
import type { FileSummary, SymbolDefinition } from '../../src/symbol-index/types.js'

function buildFile(overrides: Partial<FileSummary>): FileSummary {
  return {
    path: 'src/example.ts',
    language: 'typescript',
    lineCount: 10,
    imports: [],
    exports: [],
    symbols: [],
    hasCallGraphEntries: false,
    ...overrides,
  }
}

function buildSymbol(overrides: Partial<SymbolDefinition>): SymbolDefinition {
  return {
    name: 'Example',
    kind: 'interface',
    location: { file: 'src/models.ts', line: 1 },
    exported: true,
    ...overrides,
  }
}

describe('classification invariants', () => {
  it('TST-030: every certain-tier entry has at least one evidence entry (INV-001)', () => {
    const entry = classifyFile(buildFile({ path: 'tests/example.spec.ts' }))

    expect(entry.uncertainty).toBe('certain')
    expect(entry.evidence.length).toBeGreaterThanOrEqual(1)
  })

  it('TST-031: ambiguous/conflicting evidence caps uncertainty at possible with a conflicting-category warning', () => {
    // A file matching both the generated-file (via directory) and configuration-file
    // (via .config.) conventions at comparable ('likely') evidence strength.
    const entry = classifyFile(buildFile({ path: 'generated/app.config.ts' }))

    expect(entry.uncertainty).toBe('possible')
    expect(entry.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'conflicting-category' })])
    )
    expect(entry.classifications.length).toBeGreaterThanOrEqual(2)
  })

  it('TST-032: a ui-flavored role without a reachability gate never reaches certain/likely tier from that evidence alone', () => {
    const symbol = buildSymbol({ name: 'useUnknownModal' })
    const evidence: SymbolEvidenceBundle = {
      existingRole: null,
      matchedExistingCategory: null,
      frontendReachabilityFact: { factKind: 'ui-reachability', inferredRole: 'ui-only-state', hasReachabilityGate: false },
    }
    const entry = classifySymbol('src/components/Unknown.tsx', symbol, evidence)

    expect(entry.uncertainty).toBe('possible')
    expect(entry.classifications[0]?.confidence).toBe('possible')
  })

  it('TST-033: unknown uncertainty always pairs with uncertain edit guidance (INV-002)', () => {
    const fileEntry = classifyFile(buildFile({ path: 'src/misc/plainReExport.ts' }))
    const symbolEntry = classifySymbol(
      'src/service.ts',
      buildSymbol({ name: 'formatUser' }),
      { existingRole: null, matchedExistingCategory: null, frontendReachabilityFact: null }
    )

    expect(fileEntry.uncertainty).toBe('unknown')
    expect(fileEntry.editGuidance).toBe('uncertain')
    expect(symbolEntry.uncertainty).toBe('unknown')
    expect(symbolEntry.editGuidance).toBe('uncertain')
  })

  it('TST-034: warnings are deterministic across repeated runs on identical input', () => {
    const file = buildFile({ path: 'generated/app.config.ts' })
    const first = classifyFile(file)
    const second = classifyFile(file)

    expect(second.warnings).toEqual(first.warnings)
    expect(second.classifications).toEqual(first.classifications)
    expect(second.uncertainty).toBe(first.uncertainty)
  })

  it('TST-035: possible/unknown-tier entries always carry >=1 warning with a non-empty message', () => {
    const possibleEntry = classifyFile(buildFile({ path: 'generated/app.config.ts' }))
    const unknownEntry = classifyFile(buildFile({ path: 'src/misc/plainReExport.ts' }))

    for (const entry of [possibleEntry, unknownEntry]) {
      expect(entry.warnings.length).toBeGreaterThanOrEqual(1)
      for (const warning of entry.warnings) {
        expect(warning.message.trim().length).toBeGreaterThan(0)
      }
    }
  })
})
