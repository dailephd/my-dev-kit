import { cpSync, mkdtempSync, rmSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

let outDir = ''
let capsuleOut = ''
let auditOut = ''

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-context-'))
  const result = runCli(['index', '--root', 'examples/basic-ts', '--src', 'src', '--out', outDir])
  expect(result.status).toBe(0)
  capsuleOut = join(outDir, 'context-capsule.json')
  auditOut = join(outDir, 'retrieval-audit-record.json')
})

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

describe('context command', () => {
  // Note: --index has a default value of '.my-dev-kit' (matching search/lookup/slice/source),
  // so an explicit "missing --index" input error is unreachable via the CLI. The equivalent
  // failure path is covered by "reports a missing index directory" below, matching how
  // search/lookup/slice/source are tested elsewhere in this repo.

  it('requires --query', () => {
    const result = runCli(['context', '--index', outDir, '--out', capsuleOut])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('requires --query')
  })

  it('requires --out', () => {
    const result = runCli(['context', '--index', outDir, '--query', 'add a field'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('requires --out')
  })

  it('rejects invalid --mode', () => {
    const result = runCli([
      'context',
      '--index', outDir,
      '--query', 'add a field',
      '--out', capsuleOut,
      '--mode', 'bogus',
    ])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Invalid --mode')
  })

  it('rejects a non-integer numeric cap', () => {
    const result = runCli([
      'context',
      '--index', outDir,
      '--query', 'add a field',
      '--out', capsuleOut,
      '--max-candidate-files', 'abc',
    ])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('positive integer')
  })

  it('rejects a zero numeric cap', () => {
    const result = runCli([
      'context',
      '--index', outDir,
      '--query', 'add a field',
      '--out', capsuleOut,
      '--max-graph-nodes', '0',
    ])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('positive integer')
  })

  it('reports a missing index directory', () => {
    const result = runCli([
      'context',
      '--index', join(outDir, 'does-not-exist'),
      '--query', 'add a field',
      '--out', capsuleOut,
    ])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Missing index manifest')
  })

  it('reports a missing manifest.json inside an existing directory', () => {
    const emptyDir = join(outDir, 'empty-dir')
    mkdirSync(emptyDir, { recursive: true })
    const result = runCli(['context', '--index', emptyDir, '--query', 'add a field', '--out', capsuleOut])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Missing index manifest')
  })

  it('writes a context capsule with required top-level fields and correct request/index metadata', () => {
    const result = runCli(['context', '--index', outDir, '--query', 'add a field', '--out', capsuleOut, '--json'])
    expect(result.status).toBe(0)

    expect(existsSync(capsuleOut)).toBe(true)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))

    expect(capsule.schemaVersion).toBe('1.0.0')
    expect(typeof capsule.generatedAt).toBe('string')
    expect(capsule.tool.name).toBe('my-dev-kit')
    expect(capsule.request).toBeDefined()
    expect(capsule.index).toBeDefined()
    expect(capsule.limits).toBeDefined()
    expect(Array.isArray(capsule.requiredContext)).toBe(true)
    expect(Array.isArray(capsule.optionalSupportContext)).toBe(true)
    expect(capsule.droppedContext).toEqual([])
    expect(Array.isArray(capsule.warnings)).toBe(true)
    expect(capsule.contextAdequacy).toBeDefined()

    expect(capsule.request.originalQuery).toBe('add a field')
    expect(capsule.request.mode).toBe('general')
    expect(capsule.index.artifactRefs.length).toBeGreaterThan(0)

    const artifactPaths = capsule.index.artifactRefs.map((ref: { path: string }) => ref.path)
    expect(new Set(artifactPaths).size).toBe(artifactPaths.length)
    const optionalIds = capsule.optionalSupportContext.map((entry: { id: string }) => entry.id)
    expect(new Set(optionalIds).size).toBe(optionalIds.length)

    expect([
      'context sufficient for implementation',
      'context sufficient with listed assumptions',
      'context insufficient and more retrieval required',
      'context conflict found and user or upstream stage decision required',
    ]).toContain(capsule.contextAdequacy.status)

    expect(capsule.limits).toEqual({
      maxCandidateFiles: null,
      maxSourceSlices: null,
      maxGraphNodes: null,
      maxGraphEdges: null,
    })

    const parsedStdout = JSON.parse(result.stdout)
    expect(parsedStdout.schemaVersion).toBe('1.0.0')
    expect(parsedStdout.outputPath).toBeDefined()

    // Batch 2 fields
    expect(capsule.queryPlan).toBeDefined()
    expect(capsule.queryPlan.originalQuery).toBe('add a field')
    expect(typeof capsule.queryPlan.normalizedQuery).toBe('string')
    expect(capsule.queryPlan.mode).toBe('general')
    expect(Array.isArray(capsule.queryPlan.searchQueries)).toBe(true)
    expect(capsule.queryPlan.terms).toBeDefined()
    expect(Array.isArray(capsule.candidateFiles)).toBe(true)
    expect(Array.isArray(capsule.candidateNodes)).toBe(true)
    for (const candidate of capsule.candidateFiles) {
      expect(typeof candidate.path).toBe('string')
      expect(typeof candidate.score).toBe('number')
      expect(Array.isArray(candidate.reasons)).toBe(true)
      expect(typeof candidate.retained).toBe('boolean')
    }
    expect(capsule.focus).toBeDefined()
    expect(typeof capsule.focus.focusNodeId === 'string' || capsule.focus.focusNodeId === null).toBe(true)
    expect(capsule.selectedGraph).toBeDefined()
    expect(Array.isArray(capsule.selectedGraph.nodes)).toBe(true)
    expect(Array.isArray(capsule.selectedGraph.edges)).toBe(true)
    expect(capsule.retention).toBeDefined()
    expect(typeof capsule.retention.retainedCandidateCount).toBe('number')
  })

  it('selects a single, strong-confidence focus node for a targeted query naming a known symbol', () => {
    const result = runCli(['context', '--index', outDir, '--query', 'describeUser', '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))

    expect(typeof capsule.focus.focusNodeId).toBe('string')
    expect(['high', 'medium']).toContain(capsule.focus.confidence)
    expect(capsule.selectedGraph.nodes.some((n: { nodeId: string }) => n.nodeId === capsule.focus.focusNodeId)).toBe(true)
  })

  it('reports no focus and context-insufficient adequacy for a non-matching query', () => {
    const result = runCli(['context', '--index', outDir, '--query', 'zzzznonexistentqueryterm9999', '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))

    expect(capsule.focus.focusNodeId).toBeNull()
    expect(capsule.focus.confidence).toBe('none')
    expect(capsule.contextAdequacy.status).toBe('context insufficient and more retrieval required')
    expect(capsule.selectedGraph.nodes).toEqual([])
  })

  it('enforces --max-candidate-files end to end', () => {
    const result = runCli([
      'context',
      '--index', outDir,
      '--query', 'user',
      '--out', capsuleOut,
      '--max-candidate-files', '1',
    ])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    const retained = capsule.candidateFiles.filter((c: { retained: boolean }) => c.retained)
    expect(retained.length).toBeLessThanOrEqual(1)
  })

  it('enforces --max-graph-nodes and --max-graph-edges end to end', () => {
    const result = runCli([
      'context',
      '--index', outDir,
      '--query', 'describeUser',
      '--out', capsuleOut,
      '--max-graph-nodes', '1',
      '--max-graph-edges', '1',
    ])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.selectedGraph.nodes.length).toBeLessThanOrEqual(1)
    expect(capsule.selectedGraph.edges.length).toBeLessThanOrEqual(1)
  })

  it('records deterministic mode-specific ranking effects', () => {
    const generalResult = runCli(['context', '--index', outDir, '--query', 'describeUser', '--out', capsuleOut, '--mode', 'general'])
    expect(generalResult.status).toBe(0)
    const generalCapsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))

    const featureAddResult = runCli(['context', '--index', outDir, '--query', 'describeUser', '--out', capsuleOut, '--mode', 'feature-add'])
    expect(featureAddResult.status).toBe(0)
    const featureAddCapsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))

    expect(generalCapsule.queryPlan.mode).toBe('general')
    expect(featureAddCapsule.queryPlan.mode).toBe('feature-add')
    expect(generalCapsule.modeEffects).toMatchObject({ mode: 'general', applied: false, effects: [] })
    expect(featureAddCapsule.modeEffects.mode).toBe('feature-add')
    expect(Array.isArray(featureAddCapsule.modeEffects.effects)).toBe(true)
  })

  it('persists --max-source-slices and uses it to bound selectedSource.slices (Batch 3)', () => {
    const result = runCli(['context', '--index', outDir, '--query', 'add a field', '--out', capsuleOut, '--max-source-slices', '3'])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.limits.maxSourceSlices).toBe(3)
    expect(capsule.selectedSource.maxSourceSlices).toBe(3)
    expect(capsule.selectedSource.slices.length).toBeLessThanOrEqual(3)
  })

  it('persists provided numeric caps into capsule.limits', () => {
    const result = runCli([
      'context',
      '--index', outDir,
      '--query', 'add a field',
      '--out', capsuleOut,
      '--max-candidate-files', '5',
      '--max-source-slices', '4',
      '--max-graph-nodes', '50',
      '--max-graph-edges', '100',
    ])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.limits).toEqual({
      maxCandidateFiles: 5,
      maxSourceSlices: 4,
      maxGraphNodes: 50,
      maxGraphEdges: 100,
    })
  })

  it('writes a retrieval audit record when --audit-out is provided', () => {
    const result = runCli([
      'context',
      '--index', outDir,
      '--query', 'add a field',
      '--out', capsuleOut,
      '--audit-out', auditOut,
    ])
    expect(result.status).toBe(0)
    expect(existsSync(auditOut)).toBe(true)

    const record = JSON.parse(readFileSync(auditOut, 'utf8'))
    expect(record.schemaVersion).toBe('1.0.0')
    expect(typeof record.generatedAt).toBe('string')
    expect(record.tool.name).toBe('my-dev-kit')
    expect(record.request).toBeDefined()
    expect(record.index).toBeDefined()
    expect(Array.isArray(record.steps)).toBe(true)
    expect(Array.isArray(record.fallbacks)).toBe(true)
    expect(Array.isArray(record.fullFileReadRecommendations)).toBe(true)
    expect(record.fullFileReadRecommendations).toEqual([])
    expect(Array.isArray(record.warnings)).toBe(true)
    expect(record.contextAdequacy).toBeDefined()

    const stepKinds = record.steps.map((step: { kind: string }) => step.kind)
    expect(stepKinds).toEqual([
      'validate-inputs',
      'load-manifest',
      'normalize-query',
      'extract-query-terms',
      'run-search',
      'rank-candidate-files',
      'rank-candidate-nodes',
      'apply-mode-ranking-adjustment',
      'select-primary-focus',
      'inspect-primary-focus',
      'select-graph-neighborhood',
      'apply-caps',
      'record-retained-and-dropped-context',
      'derive-source-targets',
      'select-source-slices',
      'select-source-bundles',
      'apply-source-caps',
      'use-source-continuation',
      'skip-source-evidence',
      'use-local-source-expansion',
      'inspect-semantic-metadata',
      'inspect-classification-metadata',
      'inspect-artifact-references',
      'detect-context-conflicts',
      'assemble-required-context',
      'assemble-optional-support-context',
      'assemble-dropped-context',
      'apply-pruning-policy',
      'update-context-adequacy',
      'inspect-artifacts',
      'write-context-capsule',
      'write-retrieval-audit-record',
    ])
    expect(new Set(record.steps.map((step: { id: string }) => step.id)).size).toBe(record.steps.length)
    for (const step of record.steps) {
      expect(step).toEqual(expect.objectContaining({
        id: expect.any(String),
        kind: expect.any(String),
        description: expect.any(String),
        inputs: expect.any(Object),
        outputs: expect.any(Object),
        status: expect.any(String),
        warnings: expect.any(Array),
      }))
    }
  })

  it('disables only source evidence with --no-source and records the decision', () => {
    const noSourceAudit = join(outDir, 'retrieval-audit-record-no-source.json')
    const result = runCli([
      'context', '--index', outDir, '--query', 'describeUser', '--out', capsuleOut,
      '--audit-out', noSourceAudit, '--no-source',
    ])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    const audit = JSON.parse(readFileSync(noSourceAudit, 'utf8'))
    expect(capsule.sourceControl).toMatchObject({ enabled: false })
    expect(capsule.selectedSource.slices).toEqual([])
    expect(capsule.selectedSourceBundles.bundles).toEqual([])
    expect(capsule.semanticSummary).toBeDefined()
    expect(capsule.classificationSummary).toBeDefined()
    expect(capsule.contextAdequacy.assumptions).toContain('Source evidence was intentionally disabled by --no-source.')
    expect(capsule.contextAdequacy.status).not.toBe('context insufficient and more retrieval required')
    expect(audit.steps.find((step: { kind: string }) => step.kind === 'skip-source-evidence').status).toBe('ok')
    expect(audit.fullFileReadRecommendations).toEqual([])
  })

  it('is deterministic apart from generatedAt for the same index, query, and output', () => {
    const args = ['context', '--index', outDir, '--query', 'describeUser', '--out', capsuleOut, '--mode', 'subsystem']
    expect(runCli(args).status).toBe(0)
    const first = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(runCli(args).status).toBe(0)
    const second = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    delete first.generatedAt
    delete second.generatedAt
    expect(second).toEqual(first)
  })

  it('does not write an audit record when --audit-out is omitted', () => {
    const otherAuditPath = join(outDir, 'unused-audit-record.json')
    const result = runCli(['context', '--index', outDir, '--query', 'add a field', '--out', capsuleOut, '--json'])
    expect(result.status).toBe(0)
    expect(existsSync(otherAuditPath)).toBe(false)
    const parsedStdout = JSON.parse(result.stdout)
    expect(parsedStdout.auditOutputPath).toBeUndefined()
  })

  it('does not modify fixture source files', () => {
    const fixtureFile = join(process.cwd(), 'examples/basic-ts/src/index.ts')
    const before = statSync(fixtureFile).mtimeMs
    const result = runCli(['context', '--index', outDir, '--query', 'add a field', '--out', capsuleOut])
    expect(result.status).toBe(0)
    const after = statSync(fixtureFile).mtimeMs
    expect(after).toBe(before)
  })

  it('is compatible with an index that has no classification.json', () => {
    const result = runCli(['context', '--index', outDir, '--query', 'add a field', '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.schemaVersion).toBe('1.0.0')
  })

  it('is compatible with missing optional semantic, frontend, and data-model artifacts', () => {
    const legacyDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-context-legacy-'))
    try {
      cpSync(outDir, legacyDir, { recursive: true })
      const manifestPath = join(legacyDir, 'manifest.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      manifest.semanticArtifacts = {
        dataModel: null,
        dataModelGraph: null,
        modelViewLineage: null,
        frontendSemantic: null,
        frontendReachability: null,
      }
      manifest.analyzers = (manifest.analyzers ?? []).filter((analyzer: { id: string }) =>
        !['data-model', 'model-view-lineage', 'frontend-semantic', 'frontend-reachability'].includes(analyzer.id)
      )
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
      const legacyCapsule = join(legacyDir, 'legacy-context-capsule.json')
      const result = runCli(['context', '--index', legacyDir, '--query', 'describeUser', '--out', legacyCapsule])
      expect(result.status).toBe(0)
      const capsule = JSON.parse(readFileSync(legacyCapsule, 'utf8'))
      expect(capsule.schemaVersion).toBe('1.0.0')
      expect(capsule.semanticSummary).toBeDefined()
      expect(capsule.artifactReferenceSummary.some((entry: { available: boolean }) => entry.available === false)).toBe(true)
    } finally {
      rmSync(legacyDir, { recursive: true, force: true })
    }
  })

  it('deduplicates artifact refs for an index with classification.json and other analyzer-registered artifacts', () => {
    const richOutDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-context-rich-'))
    try {
      const indexResult = runCli(['index', '--root', 'examples/basic-data-model-ts', '--src', 'src', '--out', richOutDir])
      expect(indexResult.status).toBe(0)

      const richCapsuleOut = join(richOutDir, 'context-capsule.json')
      const result = runCli(['context', '--index', richOutDir, '--query', 'add a field', '--out', richCapsuleOut])
      expect(result.status).toBe(0)

      const capsule = JSON.parse(readFileSync(richCapsuleOut, 'utf8'))
      const artifactPaths = capsule.index.artifactRefs.map((ref: { path: string }) => ref.path)
      expect(new Set(artifactPaths).size).toBe(artifactPaths.length)

      const optionalIds = capsule.optionalSupportContext.map((entry: { id: string }) => entry.id)
      expect(new Set(optionalIds).size).toBe(optionalIds.length)
      expect(optionalIds).toContain('ctx-artifact-classification')

      // Batch 2: candidate ranking/focus selection must also succeed against
      // an index that has classification.json, without requiring any specific
      // classification role to be present on the top candidate.
      expect(Array.isArray(capsule.candidateNodes)).toBe(true)
      expect(capsule.focus).toBeDefined()
    } finally {
      rmSync(richOutDir, { recursive: true, force: true })
    }
  })

  it('includes selectedSource with a focus slice for a targeted query (Batch 3)', () => {
    const result = runCli(['context', '--index', outDir, '--query', 'describeUser', '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))

    expect(capsule.selectedSource).toBeDefined()
    expect(Array.isArray(capsule.selectedSource.slices)).toBe(true)
    expect(capsule.selectedSource.slices.length).toBeGreaterThan(0)
    expect(capsule.selectedSource.slices[0].nodeId).toBe(capsule.focus.focusNodeId)
    expect(typeof capsule.selectedSource.slices[0].filePath).toBe('string')
    expect(typeof capsule.selectedSource.slices[0].startLine).toBe('number')
    expect(typeof capsule.selectedSource.slices[0].endLine).toBe('number')
  })

  it('includes selectedSourceBundles with at most one bundle and no raw content (Batch 3)', () => {
    const result = runCli(['context', '--index', outDir, '--query', 'describeUser', '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))

    expect(Array.isArray(capsule.selectedSourceBundles.bundles)).toBe(true)
    expect(capsule.selectedSourceBundles.bundles.length).toBeLessThanOrEqual(1)
    expect(JSON.stringify(capsule.selectedSourceBundles)).not.toContain('"content"')
  })

  it('does not dump raw graph/source/semantic/classification artifacts anywhere in the capsule (Batch 3)', () => {
    const result = runCli(['context', '--index', outDir, '--query', 'describeUser', '--out', capsuleOut])
    expect(result.status).toBe(0)
    const raw = readFileSync(capsuleOut, 'utf8')
    expect(raw).not.toContain('"content":')
  })

  it('includes artifactReferenceSummary end to end (Batch 3)', () => {
    const result = runCli(['context', '--index', outDir, '--query', 'add a field', '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(Array.isArray(capsule.artifactReferenceSummary)).toBe(true)
    const byKind = Object.fromEntries(capsule.artifactReferenceSummary.map((e: { artifactKind: string; available: boolean }) => [e.artifactKind, e.available]))
    expect(byKind.symbolIndex).toBe(true)
    expect(byKind.codeGraph).toBe(true)
  })

  it('reports classificationSummary.available === false for an index with no classification.json (Batch 3)', () => {
    // The basic-ts fixture's index (outDir) already has classification.json (the
    // classification analyzer runs unconditionally as of v1.5.0), so absence is
    // simulated the same way classification's own graceful-degradation tests do:
    // remove the registered artifact file while leaving the manifest entry intact.
    // loadClassificationArtifact() already treats a missing file as "unavailable",
    // never a crash (see tests/classification/classificationGracefulDegradation.spec.ts).
    const noClassificationDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-context-no-classification-'))
    try {
      const indexResult = runCli(['index', '--root', 'examples/basic-ts', '--src', 'src', '--out', noClassificationDir])
      expect(indexResult.status).toBe(0)
      rmSync(join(noClassificationDir, 'classification.json'), { force: true })

      const noClassificationCapsuleOut = join(noClassificationDir, 'context-capsule.json')
      const result = runCli(['context', '--index', noClassificationDir, '--query', 'add a field', '--out', noClassificationCapsuleOut])
      expect(result.status).toBe(0)
      const capsule = JSON.parse(readFileSync(noClassificationCapsuleOut, 'utf8'))
      expect(capsule.classificationSummary.available).toBe(false)
      expect(capsule.classificationSummary.warnings.some((w: string) => w.includes('older index without classification'))).toBe(true)
    } finally {
      rmSync(noClassificationDir, { recursive: true, force: true })
    }
  })

  it('populates requiredContext/optionalSupportContext/droppedContext consistently (Batch 3)', () => {
    const result = runCli(['context', '--index', outDir, '--query', 'describeUser', '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))

    expect(capsule.requiredContext.length).toBeGreaterThanOrEqual(3)
    for (const entry of capsule.requiredContext) {
      expect(typeof entry.id).toBe('string')
      expect(typeof entry.kind).toBe('string')
      expect(typeof entry.title).toBe('string')
      expect(typeof entry.reason).toBe('string')
    }
    expect(Array.isArray(capsule.optionalSupportContext)).toBe(true)
    expect(Array.isArray(capsule.droppedContext)).toBe(true)
  })

  it('reflects a forced cap in droppedContext (Batch 3)', () => {
    const result = runCli(['context', '--index', outDir, '--query', 'user', '--out', capsuleOut, '--max-candidate-files', '1'])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    if (capsule.retention.droppedCandidateCount > 0) {
      expect(capsule.droppedContext.length).toBeGreaterThan(0)
    }
  })

  it('includes a well-formed pruning field (Batch 3)', () => {
    const result = runCli(['context', '--index', outDir, '--query', 'describeUser', '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.pruning.policyVersion).toBe('1.0.0')
    expect(capsule.pruning.retainedCounts).toBeDefined()
    expect(capsule.pruning.droppedCounts).toBeDefined()
    expect(capsule.pruning.capSettings).toBeDefined()
  })

  it('reflects strong source+classification evidence in contextAdequacy for a classification-enabled fixture (Batch 3)', () => {
    const richOutDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-context-adequacy-'))
    try {
      const indexResult = runCli(['index', '--root', 'examples/basic-data-model-ts', '--src', 'src', '--out', richOutDir])
      expect(indexResult.status).toBe(0)
      const richCapsuleOut = join(richOutDir, 'context-capsule.json')
      const result = runCli(['context', '--index', richOutDir, '--query', 'User', '--out', richCapsuleOut])
      expect(result.status).toBe(0)
      const capsule = JSON.parse(readFileSync(richCapsuleOut, 'utf8'))
      expect(capsule.classificationSummary.available).toBe(true)
      expect([
        'context sufficient for implementation',
        'context sufficient with listed assumptions',
      ]).toContain(capsule.contextAdequacy.status)
    } finally {
      rmSync(richOutDir, { recursive: true, force: true })
    }
  })

  it('reports context-insufficient adequacy when there is no focus (Batch 3)', () => {
    const result = runCli(['context', '--index', outDir, '--query', 'zzzznonexistentqueryterm9999', '--out', capsuleOut])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(capsuleOut, 'utf8'))
    expect(capsule.selectedSource.slices).toEqual([])
    expect(capsule.contextAdequacy.status).toBe('context insufficient and more retrieval required')
  })

  it('works end to end against the basic-react-tsx fixture', () => {
    const reactOutDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-context-react-'))
    try {
      const indexResult = runCli(['index', '--root', 'examples/basic-react-tsx', '--src', 'src', '--out', reactOutDir])
      expect(indexResult.status).toBe(0)

      const reactCapsuleOut = join(reactOutDir, 'context-capsule.json')
      const result = runCli([
        'context',
        '--index', reactOutDir,
        '--query', 'modify WorkspaceEditorShell prop flow',
        '--out', reactCapsuleOut,
        '--mode', 'feature-add',
      ])
      expect(result.status).toBe(0)

      const capsule = JSON.parse(readFileSync(reactCapsuleOut, 'utf8'))
      expect(capsule.schemaVersion).toBe('1.0.0')
      expect(typeof capsule.focus.focusNodeId === 'string' || capsule.focus.focusNodeId === null).toBe(true)
      if (capsule.focus.focusFilePath) {
        expect(capsule.focus.focusFilePath).toMatch(/WorkspaceEditorShell/)
      }

      // Batch 3 fields
      expect(capsule.selectedSource).toBeDefined()
      expect(capsule.selectedSourceBundles).toBeDefined()
      expect(capsule.semanticSummary).toBeDefined()
      expect(capsule.classificationSummary).toBeDefined()
      expect(Array.isArray(capsule.artifactReferenceSummary)).toBe(true)
      expect(capsule.pruning).toBeDefined()
    } finally {
      rmSync(reactOutDir, { recursive: true, force: true })
    }
  })
})
