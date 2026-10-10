import { describe, expect, it } from 'vitest'
import { classifyFile } from '../../src/classification/classifyFiles.js'
import type { FileSummary } from '../../src/symbol-index/types.js'

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

describe('classifyFile', () => {
  it('TST-010: classifies a generated-file with generated-do-not-edit edit guidance', () => {
    const entry = classifyFile(buildFile({ path: 'src/graph/schema.generated.ts' }))

    expect(entry.classifications.some((c) => c.role === 'generated-file')).toBe(true)
    expect(entry.editGuidance).toBe('generated-do-not-edit')
  })

  it('TST-011: classifies a configuration-file', () => {
    const entry = classifyFile(buildFile({ path: 'vitest.config.ts' }))

    expect(entry.classifications.some((c) => c.role === 'configuration-file')).toBe(true)
    expect(entry.editGuidance).toBe('inspect-before-edit')
  })

  it('TST-015: classifies test-fixture for a tests/ directory file with certain confidence', () => {
    const entry = classifyFile(buildFile({ path: 'tests/classification/example.spec.ts' }))

    expect(entry.classifications).toEqual([
      expect.objectContaining({ role: 'test-fixture', confidence: 'certain' }),
    ])
    expect(entry.editGuidance).toBe('test-only')
    expect(entry.uncertainty).toBe('certain')
  })

  it('TST-016: classifies command-handler for src/commands/*Command.ts with a register*Command export', () => {
    const entry = classifyFile(
      buildFile({ path: 'src/commands/widgetCommand.ts', exports: ['registerWidgetCommand'] })
    )

    expect(entry.classifications).toEqual([
      expect.objectContaining({ role: 'command-handler', confidence: 'certain' }),
    ])
    expect(entry.editGuidance).toBe('safe-primary-edit-target')
  })

  it('command-handler drops to likely confidence without a matching register*Command export', () => {
    const entry = classifyFile(buildFile({ path: 'src/commands/widgetCommand.ts', exports: ['helper'] }))

    expect(entry.classifications).toEqual([
      expect.objectContaining({ role: 'command-handler', confidence: 'likely' }),
    ])
  })

  it('TST-017: classifies analyzer for a file under an analyzer-producer directory with a matching naming convention', () => {
    const entry = classifyFile(buildFile({ path: 'src/data-model/buildDataModelArtifact.ts' }))

    expect(entry.classifications.some((c) => c.role === 'analyzer' && c.confidence === 'likely')).toBe(true)
  })

  it('does not classify types.ts/index.ts under an analyzer directory as analyzer', () => {
    const entry = classifyFile(buildFile({ path: 'src/data-model/types.ts' }))

    expect(entry.classifications.some((c) => c.role === 'analyzer')).toBe(false)
  })

  it('TST-018: classifies validator with likely confidence when export evidence corroborates the naming convention', () => {
    const entry = classifyFile(
      buildFile({
        path: 'src/io/validation.ts',
        exports: ['requireString', 'requireArray', 'assert'],
      })
    )

    expect(entry.classifications).toEqual([
      expect.objectContaining({ role: 'validator', confidence: 'likely' }),
    ])
  })

  it('validator drops to possible confidence when only the naming convention matches', () => {
    const entry = classifyFile(buildFile({ path: 'src/io/validation.ts', exports: ['unrelatedHelper'] }))

    expect(entry.classifications).toEqual([
      expect.objectContaining({ role: 'validator', confidence: 'possible' }),
    ])
    expect(entry.readiness).toBe('needs-more-context')
    expect(entry.warnings.length).toBeGreaterThan(0)
  })

  it('TST-019: distinguishes public-docs from internal-planning-docs', () => {
    const publicDocs = classifyFile(buildFile({ path: 'docs/COMMANDS.md', language: 'typescript' }))
    const planningDocs = classifyFile(
      buildFile({ path: '.my-dev-kit-orchestrator/v1.5.0/batch-2/artifacts/foo.md', language: 'typescript' })
    )

    expect(publicDocs.classifications).toEqual([expect.objectContaining({ role: 'public-docs' })])
    expect(publicDocs.editGuidance).toBe('docs-only')

    expect(planningDocs.classifications).toEqual([
      expect.objectContaining({ role: 'internal-planning-docs', confidence: 'certain' }),
    ])
    expect(planningDocs.editGuidance).toBe('read-only-reference')
  })

  it('AC-007: a file with zero static evidence still receives a returned entry documenting the absence', () => {
    const entry = classifyFile(buildFile({ path: 'src/misc/plainReExport.ts' }))

    expect(entry.classifications).toEqual([])
    expect(entry.uncertainty).toBe('unknown')
    expect(entry.editGuidance).toBe('uncertain')
    expect(entry.warnings).toEqual([expect.objectContaining({ kind: 'no-static-evidence' })])
  })
})

describe('generic path predicates (v1.12.6 Batch 2 relocation)', () => {
  it('keeps the previously exported context helper names identical to the canonical pure owner', async () => {
    const helpers = await import('../../src/classification/classificationHelpers.js')
    const evidence = await import('../../src/context/evidenceClassification.js')
    const roles = await import('../../src/context/roleCandidates.js')
    for (const name of [
      'basename',
      'stripExt',
      'isTestLike',
      'isTestScoped',
      'isFixtureLike',
      'isGeneratedLike',
      'TEST_LIKE_PATTERN',
      'TEST_SCOPE_DIR_PATTERN',
      'FIXTURE_PATH_PATTERN',
      'GENERATED_PATH_PATTERN',
      'GENERATED_NAME_PATTERN',
    ] as const) {
      expect(evidence[name]).toBe(helpers[name])
    }
    for (const name of ['basename', 'stripExt', 'isTestLike', 'TEST_LIKE_PATTERN'] as const) {
      expect(roles[name]).toBe(helpers[name])
    }
  })

  it('preserves positive and negative generic path classification', async () => {
    const { isFixtureLike, isGeneratedLike, isTestLike, isTestScoped } = await import('../../src/classification/classificationHelpers.js')
    expect(isTestLike('tests/a/b.spec.ts')).toBe(true)
    expect(isTestLike('src/b.ts')).toBe(false)
    expect(isTestScoped('tests/helpers/util.ts')).toBe(true)
    expect(isTestScoped('src/util.ts')).toBe(false)
    expect(isTestScoped(undefined)).toBe(false)
    expect(isFixtureLike('tests/fixtures/x.ts')).toBe(true)
    expect(isFixtureLike('src/x.ts')).toBe(false)
    expect(isGeneratedLike('src/generated/api.ts')).toBe(true)
    expect(isGeneratedLike('src/schema.generated.ts')).toBe(true)
    expect(isGeneratedLike('src/api.ts')).toBe(false)
  })
})
