import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { loadRetrievalRegressionConfig } from '../../src/retrievalRegression/configLoader.js'
import { executeTask } from '../../src/retrievalRegression/taskExecutor.js'
import { evaluateTaskAssertions, loadAssertionEvidence } from '../../src/retrievalRegression/assertions.js'
import { computeTaskVerdict } from '../../src/retrievalRegression/verdict.js'
import { allocateV114OutputDir } from '../helpers/v114OutputRoot.js'

const configPath = path.resolve('benchmarks/retrieval/v1.14/rust.json')
const config = loadRetrievalRegressionConfig(configPath)
const expectedIds = [
  'f13-ownership-method', 'f13-exact-lookup', 'f13-method-source', 'f13-impl-slice',
  'f13-architecture-context', 'f13-implementation-context', 'f13-test-context',
  'f13-ambiguous-name', 'f13-unresolved-import', 'f10-mixed-language',
  'f14-async-service', 'f14-cli', 'f14-multi-crate', 'f14-partial-selection',
].map(id => `rust-v114-${id}`)
const temp = allocateV114OutputDir('rust-suite-v114')

describe('B14 existing-runner Rust suite', () => {
  it('freezes all fourteen tasks and existing execution/expectation contracts', () => {
    expect(config.schemaVersion).toBe('1.0.0')
    expect(config.suiteId).toBe('rust-v1.14')
    expect(config.target).toBe('my-dev-kit')
    expect(config.tasks.map(t => t.id)).toEqual(expectedIds)
    for (const task of config.tasks) {
      expect(task.skip).not.toBe(true)
      expect(task.expectations).toBeDefined()
      expect(fs.existsSync(path.resolve(path.dirname(configPath), task.fixtureRoot!))).toBe(true)
    }
    expect(new Set(config.tasks.map(t => t.execution?.kind ?? 'context'))).toEqual(new Set(['search', 'lookup', 'source', 'slice', 'context']))
    expect(config.tasks.at(-1)?.expectations?.adequacy).toMatchObject({ expectedStatus: 'context insufficient and more retrieval required', required: true })
  })

  it.each(config.tasks)('executes every mandatory assertion for $id', async task => {
    fs.mkdirSync(temp, { recursive: true })
    let ordinal = 1
    while (fs.existsSync(path.join(temp, `044-suite-${ordinal}`))) ordinal++
    const outputDir = path.join(temp, `044-suite-${ordinal}`)
    fs.mkdirSync(outputDir)
    const result = await executeTask({ repoRoot: process.cwd(), configPath, outputDir, task, config })
    expect(result.errors).toEqual([])
    expect(result.status).toBe('executed')
    expect(result.skip).toBe(false)
    expect(result.assertionResults?.length).toBeGreaterThan(0)
    expect(result.assertionResults?.filter(a => a.status !== 'pass')).toEqual([])
    expect(result.verdict).toBe('PASS')
    expect(result.assertionSummary).toMatchObject({ failed: 0, blocked: 0, skipped: 0, requiredFailed: 0 })
    // A wrong independent oracle must produce an actual regression, not a silent pass.
    const evidence = loadAssertionEvidence({ capsulePath: result.artifactPaths?.capsulePath, auditPath: result.artifactPaths?.auditPath, commandResultPath: result.artifactPaths?.stdoutPath })
    if (task.execution?.kind === 'context' && task.execution.role) {
      const capsule = evidence.capsule!
      expect(capsule.request.role).toBe(task.execution.role)
      expect(capsule.roleContext.role).toBe(task.execution.role)
      expect(capsule.request.requestFilePath).toBe(path.join(outputDir, 'tasks', task.id, 'context-request.json').replaceAll('\\', '/'))
      expect(capsule.roleAdequacy.status).not.toBe('unknown')
      expect(capsule.provenance.length).toBeGreaterThan(0)
      expect(capsule.evidenceGroups.every(g => typeof g.required === 'boolean')).toBe(true)
      const malformed = structuredClone(capsule)
      delete (malformed as unknown as Record<string, unknown>).roleAdequacy
      expect(evaluateTaskAssertions(task.id, { adequacy: { required: true } }, { ...evidence, capsule: malformed })[0].status).toBe('blocked')
      if (task.id === 'rust-v114-f14-partial-selection') {
        const missing = 'symbol:tracing-subscriber/src/layer/mod.rs#Layer'
        expect(capsule.roleContext.focus.unresolvedFocusSymbols).toContain(missing)
        expect(capsule.roleContext.focus.unresolvedFocusFiles).toContain('tracing-subscriber/src/layer/mod.rs')
        expect(capsule.selectedGraph.nodes.some(n => n.nodeId === missing)).toBe(false)
        expect(capsule.selectedOwners.some(n => n.id === missing)).toBe(false)
        expect(capsule.selectedSource.slices.some(s => s.filePath.startsWith('tracing-subscriber/'))).toBe(false)
        expect(capsule.roleAdequacy.status).toBe('context insufficient and more retrieval required')
      } else if (task.id === 'rust-v114-f13-architecture-context') {
        expect(capsule.roleContext.focus.focusSymbols).toContainEqual(expect.objectContaining({ symbol: task.query, resolved: true, matchedNodeIds: [task.query] }))
      } else if (task.execution.role === 'implementation') {
        expect(capsule.roleContext.focus.focusSymbols).toContainEqual(expect.objectContaining({ symbol: task.query, resolved: true, matchedNodeIds: [task.query] }))
      } else if (task.execution.role === 'test-implementation') {
        expect(capsule.testInfrastructure.relatedTests).toContainEqual(expect.objectContaining({ path: 'tests/owner_tests.rs', basis: 'symbol:src/alpha.rs#Worker' }))
        expect(capsule.testInfrastructure.relatedTests.every(t => !t.basis.includes('Runner%404%3A64#run#0'))).toBe(true)
        const changed = task.execution.changedSymbols ?? []
        expect(capsule.roleContext.changedSurface.symbols.some(s => changed.includes(s.symbolId))).toBe(true)
      }
    }
    const negative = task.execution && task.execution.kind !== 'context'
      ? { ...task.expectations, commandResult: task.execution.kind === 'lookup'
        ? { lookup: { expectedNodeId: 'symbol:absent.rs#never' }, required: true }
        : task.execution.kind === 'slice'
          ? { slice: { requiredNodeIds: ['symbol:absent.rs#never'] }, required: true }
          : task.execution.kind === 'source'
            ? { expectedStartLine: 999999, required: true }
            : { requiredResultIds: ['symbol:absent.rs#never'], required: true } }
      : { ...task.expectations, focus: { nodeId: 'symbol:absent.rs#never', required: true } }
    const failed = evaluateTaskAssertions(task.id, negative, evidence)
    expect(failed.some(a => a.status === 'fail' && a.severity === 'required')).toBe(true)
    expect(computeTaskVerdict({ executionBlocked: false, assertionResults: failed })).toBe('REGRESSION')
  })
})
