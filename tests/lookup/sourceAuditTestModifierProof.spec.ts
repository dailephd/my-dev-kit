import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { getSourceAuditFilePage, readFreshSourceAuditFilePage, readSourceAuditEvidence } from '../../src/lookup/readSourceAuditEvidence.js'
import { resolveAuditImportTargetFromArtifact } from '../../src/lookup/resolveAuditImportTarget.js'
import { validateSourceAuditEvidence, validateSourceAuditFilePage } from '../../src/symbol-index/validateAuditEvidence.js'

const direct = 'import { test } from "@playwright/test";\n'
const base = 'import { test as base } from "@playwright/test";\n'
const wrapper = base + 'export const test = base.extend({});\n'
const hook = direct + 'test.beforeEach(() => {\n  test.skip(flag, "guard");\n});\ntest("title", () => {\n  test.only("focus", () => {});\n});\n'
const imported = 'import { test } from "./support/fixture";\ntest.skip(flag, "guard");\n'
const local = base + 'const test = base.extend({});\ntest.only("focus", () => {});\n'
const noisy = direct + 'it.skip("legacy");\n' + 'it(dynamicTitle, () => {});\n'.repeat(32) + 'test.skip(flag, "condition");\n'
const supportedNames = ['vitest', '@jest/globals', 'node:test']
const legacySources = Object.fromEntries(supportedNames.map((module, index) => [
  `src/legacy-${index}.ts`, direct + `import { it } from "${module}";\nit.skip("legacy");\ntest.only();\n`,
]))
const files = {
  'src/direct.spec.ts': hook,
  'src/direct.js': direct + 'test.only();\n',
  'src/local.ts': local,
  'src/wrapped.ts': 'import { helper } from "./support/helper";\n' + imported,
  'src/support/fixture.ts': wrapper,
  'src/support/helper.ts': 'export const helper = true\n',
  'src/support/unexported.ts': local,
  'src/support/reexport.ts': 'export { test } from "./fixture";\n',
  'src/support/recursive.ts': 'import { test as base } from "./fixture";\nexport const test = base.extend({});\n',
  'src/support/factory.ts': base + 'export const test = makeRunner(base);\n',
  'src/support/replaced.ts': wrapper + 'Object.assign(test, { skip: another });\n',
  'src/support/altered-base.ts': 'import { test as base } from "@playwright/test";\nbase.extend = factory;\nexport const test = base.extend({});\n',
  'src/support/dual.ts': wrapper,
  'src/support/dual.js': wrapper,
  'src/unexported.ts': imported.replace('support/fixture','support/unexported'),
  'src/reexport.ts': imported.replace('support/fixture','support/reexport'),
  'src/recursive.ts': imported.replace('support/fixture','support/recursive'),
  'src/factory.ts': imported.replace('support/fixture','support/factory'),
  'src/replaced-wrapper.ts': imported.replace('support/fixture','support/replaced'),
  'src/altered-base-wrapper.ts': imported.replace('support/fixture','support/altered-base'),
  'src/missing.ts': imported.replace('support/fixture','support/missing'),
  'src/ambiguous.ts': imported.replace('support/fixture','support/dual'),
  'src/outside.ts': imported.replace('./support/fixture','../outside/fixture'),
  'outside/fixture.ts': wrapper,
  'src/wrong-import.ts': imported.replace('{ test }','{ helper as test }'),
  'src/type-only.ts': direct.replace('import {','import type {') + 'test.skip();\n',
  'src/specifier-type-only.ts': direct.replace('{ test }','{ type test }') + 'test.skip();\n',
  'src/unrelated.ts': 'const base = { extend: value => value };\nconst test = base.extend({});\ntest.skip();\n',
  'src/using.ts': base + 'await using test = base.extend({});\ntest.skip();\n',
  'src/shadow.ts': direct + 'function f(test: unknown) { test.skip(); }\ntest.only();\n',
  'src/competing.ts': direct + 'const test = candidate;\ntest.skip();\n',
  'src/competing-namespace.ts': direct + 'namespace test { export const skip = replacement; }\ntest.skip();\n',
  'src/competing-var.ts': direct + 'if (guard) { var test = replacement; }\ntest.only();\n',
  'src/mutate.ts': direct + 'test.skip = replacement;\ntest.skip();\n',
  'src/reassign.ts': direct + 'test = replacement;\ntest.only();\n',
  'src/escape.ts': direct + 'const alias = test;\nalias.skip();\ntest.only();\n',
  'src/shorthand-escape.ts': direct + 'const capture = { test };\ntest.skip();\n',
  'src/alias-mutation.ts': direct + 'import { test as alias } from "@playwright/test";\nalias.skip = replacement;\ntest.skip();\n',
  'src/partial.ts': direct + 'test.only();\ntest["skip"](flag);\ntest.skip?.(flag);\ntest?.only();\ntest.describe.only("nested", () => {});\ntest.skip().only();\n',
  'src/unqualified-legacy.ts': direct + 'const it = unknownRunner;\nit.skip();\ntest.only();\n',
  'src/mutated-legacy.ts': direct + 'it.skip = replacement;\nit.skip();\ntest.only();\n',
  'src/conventional.ts': direct + 'it.skip("legacy");\ndescribe.only("legacy");\ntest.skip(flag);\n',
  'src/no-runtime.ts': base + 'const test = base.extend({ x: () => { throw new Error("fixture ran"); } });\nthrow new Error("module ran");\ntest.only("never runs", () => { throw new Error("test ran"); });\n',
  'src/uncertain-import.ts': direct + 'const target = getValue();\nvoid import(target);\ntest.skip(flag);\n',
  'src/recovery.ts': direct + 'test.skip(\n',
  'src/foreign.py': 'print("test.skip()")\n',
  'src/budget.ts': direct + 'test.only();\n'.repeat(1025),
  'src/noisy.spec.ts': noisy,
  'src/noisy-unsupported.spec.ts': noisy + 'test.skip?.(flag);\n',
  'src/bundler/tsconfig.json': '{"compilerOptions":{"module":"esnext","moduleResolution":"bundler"}}\n',
  'src/bundler/fixture.ts': wrapper,
  'src/bundler/wrapped.ts': imported.replace('./support/fixture', './fixture'),
  'src/bundler/invalid.ts': imported.replace('./support/fixture', './unexported'),
  'src/bundler/unexported.ts': local,
  ...legacySources,
}

let root: string
let index: string
let artifact: ReturnType<typeof readSourceAuditEvidence>
let artifactBytes: Buffer
let manifestBytes: Buffer
const sha = (content: string) => createHash('sha256').update(content).digest('hex')
const span = (path: string, line: number, startColumn: number, endColumn: number) => ({
  path, startLine: line, startColumn, endLine: line, endColumn,
})
const write = (path: string, body: string) => {
  const destination = join(root, path)
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, body)
}
const page = (path: string, position = 0, current = artifact, negotiate = true) =>
  readFreshSourceAuditFilePage(current, path, position, resolveAuditImportTargetFromArtifact, negotiate ? true : undefined)
const get = (path: string) => page(path).testModifierProof

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'kit-a4-'))
  index = join(root, 'i')
  for (const [path, text] of Object.entries(files)) write(path, text)
  await runIndexCommand({ root, src: ['src'], out: index, sourceAuditSchema: '1.2.0' })
  artifact = readSourceAuditEvidence(index)
  artifactBytes = readFileSync(join(index, 'source-audit-evidence.json'))
  manifestBytes = readFileSync(join(index, 'manifest.json'))
})

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

it('returns the exact direct proof and keeps legacy pages, facts and title uncertainty', () => {
  const path = 'src/direct.spec.ts'
  const result = page(path)
  const { testModifierProof, ...legacy } = result
  expect(legacy).toEqual(getSourceAuditFilePage(artifact, path, 0))
  expect(page(path, 0, artifact, false)).toEqual(legacy)
  expect(result.file?.capabilities).toMatchObject({ 'direct-test-modifiers': 'partial', 'test-observations': 'partial' })
  expect(result.facts.map(fact => fact.observationKind)).toContain('test-modifier-skip')
  expect(testModifierProof).toEqual({
    schemaVersion: '1.0.0', profile: 'js-ts-playwright-direct-extended-modifiers-v1',
    snapshotId: artifact.source.snapshotId, selectionFingerprint: artifact.source.selectionFingerprint,
    selectedDomainDigest: sha(JSON.stringify(Object.keys(files).filter(file => file.startsWith('src/')).sort())),
    originFile: path, originContentSha256: sha(hook), coverage: 'complete',
    runnerBinding: {
      kind: 'direct-playwright', localName: 'test', bindingSpan: span(path, 1, 9, 13),
      baseLocalName: 'test', baseImportSpan: span(path, 1, 9, 13), extensionSpan: null, wrapper: null,
    },
    observations: [
      { modifier: 'skip', calleeSpan: span(path, 3, 2, 11), callSpan: span(path, 3, 2, 26) },
      { modifier: 'only', calleeSpan: span(path, 6, 2, 11), callSpan: span(path, 6, 2, 30) },
    ],
    reasonCodes: [],
  })
  expect(get('src/direct.js')).toMatchObject({ coverage: 'complete', observations: [{ modifier: 'only' }] })
})

it('qualifies the local declaration and actual aliased base without executing source', () => {
  const path = 'src/local.ts'
  expect(get(path)).toMatchObject({
    originContentSha256: sha(local), coverage: 'complete', reasonCodes: [],
    observations: [{ modifier: 'only', calleeSpan: span(path, 3, 0, 9), callSpan: span(path, 3, 0, 28) }],
  })
  expect(get(path)?.runnerBinding).toEqual({
    kind: 'local-extended-playwright', localName: 'test', bindingSpan: span(path, 2, 6, 28),
    baseLocalName: 'base', baseImportSpan: span(path, 1, 9, 21),
    extensionSpan: span(path, 2, 13, 28), wrapper: null,
  })
  expect(get('src/no-runtime.ts')).toMatchObject({ coverage: 'complete', observations: [{ modifier: 'only' }] })
})

it('embeds the exact existing A2 ordinary proof for the immediate extensionless wrapper', () => {
  const path = 'src/wrapped.ts'
  const fixture = 'src/support/fixture.ts'
  const result = page(path)
  const fact = result.facts.find(item => item.kind === 'import' && item.sourceSpecifier === './support/fixture')!
  const embedded = result.testModifierProof?.runnerBinding.wrapper?.importTargetProof
  expect(result.testModifierProof).toMatchObject({
    coverage: 'complete', reasonCodes: [],
    observations: [{ modifier: 'skip', calleeSpan: span(path, 3, 0, 9), callSpan: span(path, 3, 0, 24) }],
  })
  expect(result.testModifierProof?.runnerBinding).toEqual({
    kind: 'imported-extended-playwright', localName: 'test', bindingSpan: span(path, 2, 9, 13),
    baseLocalName: 'base', baseImportSpan: span(fixture, 1, 9, 21), extensionSpan: span(fixture, 2, 20, 35),
    wrapper: { path: fixture, contentSha256: sha(wrapper), exportBindingSpan: span(fixture, 2, 13, 35), importTargetProof: embedded },
  })
  expect(embedded).toEqual(resolveAuditImportTargetFromArtifact(artifact, fact.id))
  const suffixes = ['cjs', 'cts', 'js', 'jsx', 'mjs', 'mts', 'ts', 'tsx']
  const candidates = suffixes.flatMap(ext => [`src/support/fixture.${ext}`, `src/support/fixture/index.${ext}`]).sort()
  expect(embedded).toMatchObject({
    originFile: path, importFactId: 'audit-fact:src%2Fwrapped.ts#import#2#0#0', sourceSpecifier: './support/fixture',
    sourceReferenceProof: {
      schemaVersion: '1.0.0', profile: 'js-ts-selected-source-reference-v1', candidateEnumerationComplete: true,
      candidateDomain: candidates, qualifiedReference: {
        targetPath: fixture, targetContentSha256: sha(wrapper), referenceKind: 'selected-source-reference',
      },
      premiseRefs: expect.arrayContaining([
        { role: 'candidate', path: fixture, state: 'file', contentSha256: sha(wrapper) },
        { role: 'candidate', path: 'src/support/fixture.js', state: 'absent', contentSha256: null },
        { role: 'config', path: 'tsconfig.json', state: 'absent', contentSha256: null },
      ]),
    },
  })
})

it('requires import fact correspondence even if a different import can resolve', () => {
  const current = structuredClone(artifact)
  const origin = current.files.find(file => file.path === 'src/wrapped.ts')!
  const fixture = origin.facts.find(fact => fact.kind === 'import' && fact.sourceSpecifier === './support/fixture')!
  fixture.importedNames = ['helper']
  expect(page(origin.path, 0, current).testModifierProof).toBeUndefined()
})

it.each([
  'unexported', 'reexport', 'recursive', 'factory', 'replaced-wrapper', 'altered-base-wrapper', 'missing',
  'ambiguous', 'outside', 'wrong-import', 'type-only', 'specifier-type-only', 'unrelated', 'competing',
  'competing-namespace', 'competing-var', 'using', 'recovery',
])('omits unqualified provenance for %s', name => {
  expect(get(`src/${name}.ts`)).toBeUndefined()
})

it.each(['mutate', 'reassign', 'escape', 'shorthand-escape', 'alias-mutation'])('fails closed on a runner write or escape in %s', name => {
  expect(get(`src/${name}.ts`)).toMatchObject({
    coverage: 'partial', reasonCodes: ['UNRESOLVED_BINDING_USE'], observations: [],
  })
})

it('keeps independent positives under unsupported forms and other unresolved runner sites', () => {
  const cases = [
    ['src/partial.ts', 'UNSUPPORTED_MODIFIER_FORM', 2],
    ['src/unqualified-legacy.ts', 'UNQUALIFIED_RUNNER_BINDING', 4],
    ['src/shadow.ts', 'UNQUALIFIED_RUNNER_BINDING', 3],
    ['src/mutated-legacy.ts', 'UNRESOLVED_BINDING_USE', 4],
  ] as const
  for (const [path, reason, line] of cases) {
    expect(get(path)).toMatchObject({
      coverage: 'partial', reasonCodes: [reason],
      observations: [{ modifier: 'only', calleeSpan: span(path, line, 0, 9), callSpan: span(path, line, 0, 11) }],
    })
  }
})

it('retains legacy observations and does not conflate other capabilities with modifier closure', () => {
  for (const path of [...Object.keys(legacySources), 'src/conventional.ts']) {
    const result = page(path)
    expect(result.testModifierProof?.coverage).toBe('complete')
    expect(result.testModifierProof?.observations).toHaveLength(1)
    expect(result.facts).toEqual(getSourceAuditFilePage(artifact, path, 0).facts)
    expect(result.facts).toContainEqual(expect.objectContaining({ name: 'it', observationKind: 'test-modifier-skip' }))
  }
  expect(get('src/uncertain-import.ts')).toMatchObject({ coverage: 'complete', observations: [{ modifier: 'skip' }] })
})

it('uses independent modifier closure when title diagnostics reach the shared cap', () => {
  const path = 'src/noisy.spec.ts'
  const result = page(path)
  const record = artifact.files.find(file => file.path === path)!
  expect(record.diagnostics).toContainEqual(expect.objectContaining({ code: 'diagnostics-truncated' }))
  expect(record.diagnostics).toContainEqual(expect.objectContaining({ code: 'dynamic-test-title' }))
  expect(result.testModifierProof).toMatchObject({
    coverage: 'complete', reasonCodes: [],
    observations: [{ modifier: 'skip', calleeSpan: span(path, 35, 0, 9), callSpan: span(path, 35, 0, 28) }],
  })
  const unsupported = 'src/noisy-unsupported.spec.ts'
  expect(artifact.files.find(file => file.path === unsupported)?.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'diagnostics-truncated' }),
  )
  expect(get(unsupported)).toMatchObject({
    coverage: 'partial', reasonCodes: ['UNSUPPORTED_MODIFIER_FORM'],
    observations: [{ modifier: 'skip', calleeSpan: span(unsupported, 35, 0, 9) }],
  })

  // Model a dropped legacy modifier whose diagnostic was beyond the cap.
  const missing = structuredClone(artifact)
  const legacyRecord = missing.files.find(file => file.path === path)!
  legacyRecord.facts = legacyRecord.facts.filter(fact => fact.observationKind !== 'test-modifier-skip' || fact.name !== 'it')
  expect(legacyRecord.facts).toHaveLength(record.facts.length - 1)
  expect(page(path, 0, missing).testModifierProof).toMatchObject({
    coverage: 'partial', reasonCodes: ['INCOMPLETE_SOURCE_ANALYSIS'],
    observations: result.testModifierProof?.observations,
  })
})

it('qualifies an imported wrapper using the embedded Bundler reference and keeps negotiation explicit', () => {
  const path = 'src/bundler/wrapped.ts'
  const config = 'src/bundler/tsconfig.json'
  expect(page(path, 0, artifact, false)).not.toHaveProperty('testModifierProof')
  expect(get(path)).toMatchObject({
    coverage: 'complete', reasonCodes: [],
    runnerBinding: {
      kind: 'imported-extended-playwright', wrapper: {
        path: 'src/bundler/fixture.ts', contentSha256: sha(wrapper),
        importTargetProof: { sourceReferenceProof: {
          sourceSpecifier: './fixture', candidateEnumerationComplete: true,
          qualifiedReference: { targetPath: 'src/bundler/fixture.ts', targetContentSha256: sha(wrapper) },
          premiseRefs: expect.arrayContaining([
            { role: 'config', path: config, state: 'file', contentSha256: sha(files[config]) },
          ]),
        } },
      },
    },
    observations: [{ modifier: 'skip', calleeSpan: span(path, 2, 0, 9) }],
  })
  expect(get('src/bundler/invalid.ts')).toBeUndefined()
})

it('checks stale origin, stale wrapper, a new competing file and changed configuration independently', () => {
  const origin = 'src/wrapped.ts'
  const fixture = 'src/support/fixture.ts'
  try {
    write(origin, files[origin] + '\n')
    expect(() => get(origin)).toThrow(/STALE_SOURCE_EVIDENCE/)
  } finally { write(origin, files[origin]) }
  try {
    write(fixture, wrapper + '\n')
    expect(get(origin)).toBeUndefined()
  } finally { write(fixture, wrapper) }
  const competing = 'src/support/fixture.js'
  try {
    write(competing, wrapper)
    expect(get(origin)).toBeUndefined()
  } finally { rmSync(join(root, competing)) }
  try {
    write('tsconfig.json', '{ "extends": "unqualified-config" }\n')
    expect(get(origin)).toBeUndefined()
  } finally { rmSync(join(root, 'tsconfig.json')) }
  expect(get(origin)?.coverage).toBe('complete')
})

it('respects the artifact schema, page position and unsupported language boundaries', async () => {
  const path = 'src/direct.spec.ts'
  const defaultIndex = join(root, 'default')
  await runIndexCommand({ root, src: ['src'], out: defaultIndex })
  const defaultArtifact = readSourceAuditEvidence(defaultIndex)
  const legacy = page(path, 0, defaultArtifact, false)
  expect(legacy.schemaVersion).toBe('1.1.0')
  expect(legacy).not.toHaveProperty('testModifierProof')
  expect(() => page(path, 0, defaultArtifact)).toThrow(/INVALID_TEST_MODIFIER_PROOF_SCHEMA/)
  expect(() => page('src/budget.ts', 1)).toThrow(/INVALID_TEST_MODIFIER_PROOF_SELECTOR/)
  expect(page('src/budget.ts', 1, artifact, false)).not.toHaveProperty('testModifierProof')
  expect(page('outside/fixture.ts')).toMatchObject({ status: 'not-selected', file: null })
  expect(page('outside/fixture.ts')).not.toHaveProperty('testModifierProof')
  expect(page('src/foreign.py')).not.toHaveProperty('testModifierProof')
  expect(() => validateSourceAuditFilePage({ ...legacy, testModifierProof: get(path) })).toThrow()
  expect(() => validateSourceAuditFilePage({ ...page('src/budget.ts', 1, artifact, false), testModifierProof: get('src/budget.ts') })).toThrow()
})

it('bounds observations with stable order and no complete claim after exhaustion', () => {
  const path = 'src/budget.ts'
  const result = get(path)!
  expect(result.coverage).toBe('partial')
  expect(result.reasonCodes).toEqual(['PROOF_BUDGET_EXCEEDED'])
  expect(result.observations).toHaveLength(1024)
  expect(result.observations.map(item => item.calleeSpan.startLine)).toEqual(Array.from({ length: 1024 }, (_, i) => i + 2))
  expect(JSON.stringify(get(path))).toBe(JSON.stringify(result))
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(1024 * 1024)
})

it('enforces closed page, runner, wrapper, observation and exact span shapes', () => {
  const result = page('src/wrapped.ts')
  const proof = result.testModifierProof!
  expect(() => validateSourceAuditFilePage(result)).not.toThrow()
  const invalid = [
    { ...proof, outcome: 'skipped' },
    { ...proof, coverage: 'partial' },
    { ...proof, coverage: 'partial', reasonCodes: ['UNSUPPORTED_MODIFIER_FORM', 'INCOMPLETE_SOURCE_ANALYSIS'] },
    { ...proof, originContentSha256: '0'.repeat(64) },
    { ...proof, runnerBinding: { ...proof.runnerBinding, baseImportSpan: { ...proof.runnerBinding.baseImportSpan, endColumn: null } } },
    { ...proof, runnerBinding: { ...proof.runnerBinding, escaped: true } },
    { ...proof, runnerBinding: { ...proof.runnerBinding, wrapper: { ...proof.runnerBinding.wrapper, contentSha256: '0'.repeat(64) } } },
    { ...proof, runnerBinding: { ...proof.runnerBinding, wrapper: { ...proof.runnerBinding.wrapper, extra: true } } },
    { ...proof, observations: [...proof.observations, ...proof.observations] },
    { ...proof, observations: [{ ...proof.observations[0], runtime: false }] },
    { ...proof, observations: [{ ...proof.observations[0], callSpan: span('src/wrapped.ts', 4, 0, 2) }] },
    { ...proof, runnerBinding: { ...proof.runnerBinding, baseLocalName: 'a'.repeat(1024 * 1024) } },
  ]
  for (const testModifierProof of invalid) expect(() => validateSourceAuditFilePage({ ...result, testModifierProof })).toThrow()
  expect(() => validateSourceAuditFilePage({ ...result, extra: true })).toThrow()
})

it('keeps proof-time data out of persisted artifact and manifest bytes', () => {
  get('src/direct.spec.ts')
  get('src/wrapped.ts')
  expect(readFileSync(join(index, 'manifest.json'))).toEqual(manifestBytes)
  expect(readFileSync(join(index, 'source-audit-evidence.json'))).toEqual(artifactBytes)
  const changed = structuredClone(artifact)
  Object.assign(changed.files[0]!, { testModifierProof: get('src/wrapped.ts') })
  expect(() => validateSourceAuditEvidence(changed)).toThrow()
})
