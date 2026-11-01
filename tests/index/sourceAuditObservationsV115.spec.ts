import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildSourceAuditEvidence } from '../../src/indexing/buildSourceAuditEvidence.js'
import { buildCacheFileEntries, classifyChangedFilePaths } from '../../src/indexing/cacheMetadata.js'
import { discoverSourceFiles } from '../../src/indexing/discoverSourceFiles.js'
import { buildPartialSymbolIndex } from '../../src/indexing/partialRebuild.js'
import { createDefaultRegistry } from '../../src/languages/registry.js'
import { prepareRustParser } from '../../src/languages/rust/parser.js'
import type { SourceAuditFact, SourceAuditFactKind, SourceAuditObservationKind } from '../../src/symbol-index/auditEvidenceTypes.js'
import { boundedAuditLiteral, extractAuditObservations, type SourceAuditExtractionPayload } from '../../src/symbol-index/auditObservations.js'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { assignDeclarationIdentities } from '../../src/symbol-index/declarationIdentity.js'
import { validateSourceAuditEvidence } from '../../src/symbol-index/validateAuditEvidence.js'

const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'v115-source-audit')
const registry = createDefaultRegistry()
const tempDirs: string[] = []
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop() as string, { recursive: true, force: true })
})
beforeAll(async () => {
  await prepareRustParser()
})

const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

function makeProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v115-obs-'))
  tempDirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

function audit(relPath: string, text: string): SourceAuditExtractionPayload {
  const extraction = registry.adapterForFile(relPath)!.extractFromSource(relPath, text)
  extraction.symbols = assignDeclarationIdentities(relPath, extraction.symbols)
  return extractAuditObservations(relPath, text, extraction)
}

const of = (payload: SourceAuditExtractionPayload, kind: SourceAuditFactKind, observationKind?: SourceAuditObservationKind): SourceAuditFact[] =>
  payload.facts.filter((fact) => fact.kind === kind && (observationKind === undefined || fact.observationKind === observationKind))
const pairs = (facts: SourceAuditFact[]): Array<[string | undefined, string | null | undefined]> => facts.map((fact) => [fact.name, fact.value])
const codes = (payload: SourceAuditExtractionPayload): string[] => payload.diagnostics.map((d) => d.code)

const OBS = audit('src/obs.ts', fixture('observations-typescript.ts'))

describe('v1.15.0 Batch 3 identifier and registry literals', () => {
  it('emits exact identifier literals and one-hop constant bindings with source spans, without inferring registry membership', () => {
    const ids = of(OBS, 'identifier-literal', 'registry-id')
    expect(pairs(ids)).toEqual(expect.arrayContaining([
      ['DETECTOR_ID', 'dup-impl'],
      ['id', 'detector-one'],
      ['detectorId<-DETECTOR_ID', 'dup-impl'],
    ]))
    // A name such as "detectors" never makes its keys registry ids: no fact, partial capability, explicit diagnostic.
    expect(ids.some((fact) => fact.name === 'detectors')).toBe(false)
    expect(OBS.capabilities['identifier-literals']).toBe('partial')
    expect(codes(OBS)).toContain('registry-membership-unsupported')
    const direct = ids.find((fact) => fact.name === 'DETECTOR_ID')!
    expect(direct.span).toMatchObject({ path: 'src/obs.ts', startLine: 7, startColumn: 20, endLine: 7, endColumn: 30 })
    expect(direct.extractionMethod).toBe('typescript-ast')
  })

  it('keeps duplicate identifier values as separate observations without grouping them', () => {
    const duplicates = of(OBS, 'identifier-literal').filter((fact) => fact.name === 'id' && fact.value === 'detector-one')
    expect(duplicates).toHaveLength(2)
    expect(new Set(duplicates.map((fact) => fact.id)).size).toBe(2)
    expect(duplicates.every((fact) => !('count' in fact) && fact.observationKind === 'registry-id')).toBe(true)
  })

  it('does not evaluate dynamic values and reports partial coverage instead of inventing an identifier', () => {
    const payload = audit('src/dyn.ts', "const a = 'x'\nexport const o = { id: a + 'y', ruleId: make() }\nexport const KIND_ID = `k-${a}`\n")
    expect(of(payload, 'identifier-literal')).toEqual([])
    expect(payload.capabilities['identifier-literals']).toBe('partial')
    expect(codes(payload)).toContain('dynamic-identifier-value')
  })

  it('does not treat unrelated strings, comments or shadowed bindings as identifiers', () => {
    const payload = audit('src/n.ts', "// const FAKE_ID = 'in-comment'\nconst note = 'id: \"fake\"'\nconst LOCAL_ID = 'x'\nfunction f(LOCAL_ID: string) { return { id: LOCAL_ID } }\n")
    expect(pairs(of(payload, 'identifier-literal'))).toEqual([['LOCAL_ID', 'x']])
    // The shadowed reference is ambiguous, so the family is partial rather than complete.
    expect(payload.capabilities['identifier-literals']).toBe('partial')
  })

  it('is complete only when the profile is exhausted, including with no facts', () => {
    const clean = audit('src/clean.ts', "export const DETECTOR_ID = 'a'\nexport const unrelated = 3\n")
    expect(clean.capabilities['identifier-literals']).toBe('complete')
    expect(audit('src/empty.ts', 'export const unrelated = 3\n').capabilities['identifier-literals']).toBe('complete')
    expect(of(audit('src/num.ts', 'export const o = { id: 5 }\n'), 'identifier-literal')).toEqual([])
    expect(audit('src/num.ts', 'export const o = { id: 5 }\n').capabilities['identifier-literals']).toBe('complete')
  })
})

describe('v1.15.0 Batch 3 test observations', () => {
  it('emits literal titles and skip/only modifiers with exact spans', () => {
    const titles = of(OBS, 'test-observation', 'test-title')
    expect(pairs(titles)).toEqual([['describe', 'suite'], ['it', 'runs a case'], ['it', 'skipped case'], ['test', 'focused case']])
    expect(titles[0]!.span).toMatchObject({ startLine: 18, startColumn: 9, endColumn: 16 })
    expect(of(OBS, 'test-observation', 'test-modifier-skip').map((fact) => fact.name)).toEqual(['it'])
    expect(of(OBS, 'test-observation', 'test-modifier-only').map((fact) => fact.name)).toEqual(['test'])
    expect(OBS.capabilities['test-observations']).toBe('complete')
  })

  it('does not turn comments or strings into declarations', () => {
    const payload = audit('src/c.ts', "// it('in comment', () => {})\nconst s = \"test('in string', () => {})\"\n")
    expect(of(payload, 'test-observation')).toEqual([])
    expect(payload.capabilities['test-observations']).toBe('complete')
  })

  it('keeps dynamic titles unresolved and the family partial', () => {
    const payload = audit('src/d.test.ts', "const n = 'x'\nit(n, () => {})\nit(`t-${n}`, () => {})\nit.only(n + 'y', () => {})\n")
    expect(of(payload, 'test-observation', 'test-title')).toEqual([])
    expect(of(payload, 'test-observation', 'test-modifier-only')).toHaveLength(1)
    expect(payload.capabilities['test-observations']).toBe('partial')
    expect(codes(payload)).toContain('dynamic-test-title')
  })

  it('does not attribute a shadowed or locally defined call to a test runner', () => {
    const shadowed = audit('src/s.ts', "function test(name: string) { return name }\ntest('not a runner')\n")
    expect(of(shadowed, 'test-observation')).toEqual([])
    expect(shadowed.capabilities['test-observations']).toBe('partial')
    expect(codes(shadowed)).toContain('test-call-shadowed')
    const param = audit('src/p.ts', "export function run(it: (n: string) => void) { it('param call') }\n")
    expect(of(param, 'test-observation')).toEqual([])
    const imported = audit('src/i.ts', "import { it } from 'vitest'\nit('imported runner', () => {})\n")
    expect(pairs(of(imported, 'test-observation'))).toEqual([['it', 'imported runner']])
  })

  it('marks unsupported test syntax partial instead of guessing', () => {
    for (const source of ["it.each([1])('x', () => {})\n", "test.describe('x', () => {})\n", "xit('x', () => {})\n", "describe.todo('x')\n"]) {
      const payload = audit('src/u.test.ts', source)
      expect(of(payload, 'test-observation', 'test-title')).toEqual([])
      expect(payload.capabilities['test-observations']).toBe('partial')
    }
  })

  it('reports unsupported test syntax for other languages without inventing ownership', () => {
    for (const [name, text] of [
      ['src/obs.py', fixture('observations-python.py')], ['src/Obs.java', fixture('observations-java.java')],
      ['src/Obs.kt', fixture('observations-kotlin.kt')], ['src/obs.rs', fixture('observations-rust.rs')],
    ] as const) {
      const payload = audit(name, text)
      for (const family of ['identifier-literals', 'test-observations', 'fixture-references', 'process-observations'] as const) {
        expect(payload.capabilities[family]).toBe('unsupported')
      }
      expect(payload.facts.filter((fact) => fact.kind === 'identifier-literal' || fact.kind === 'test-observation' || fact.kind === 'fixture-reference' || fact.kind === 'process-observation')).toEqual([])
    }
  })

  it('does not run, validate or label embedded commands', () => {
    const commands = of(OBS, 'test-observation', 'embedded-test-command')
    expect(pairs(commands)).toEqual([['npm run build:docs', 'npm run build:docs']])
    expect(commands[0]!.span).toMatchObject({ startLine: 24 })
  })
})

describe('v1.15.0 Batch 3 embedded commands', () => {
  it('captures literal commands only in test files or test calls', () => {
    const inTest = audit('tests/a.spec.ts', "const c = 'npm run lint'\n")
    expect(pairs(of(inTest, 'test-observation', 'embedded-test-command'))).toEqual([['npm run lint', 'npm run lint']])
    const inCall = audit('src/a.ts', "it('x', () => { run(`npm run check`) })\nconst help = 'npm run help'\n")
    expect(pairs(of(inCall, 'test-observation', 'embedded-test-command'))).toEqual([['npm run check', 'npm run check']])
  })

  it('does not synthesize dynamic concatenations or templates into commands', () => {
    const payload = audit('tests/b.spec.ts', "const s = 'x'\nconst a = 'npm run ' + s\nconst b = `npm run ${s}`\nconst c = 'npm run build' + ' --silent'\n")
    expect(of(payload, 'test-observation', 'embedded-test-command')).toEqual([])
    expect(payload.capabilities['test-observations']).toBe('partial')
    expect(codes(payload)).toContain('dynamic-test-command')
  })
})

describe('v1.15.0 Batch 3 fixture references', () => {
  it('captures exact fixture specifiers and composed path literals with basename evidence', () => {
    const refs = of(OBS, 'fixture-reference', 'fixture-basename')
    expect(pairs(refs)).toEqual([['./fixtures/helper', 'helper'], ['fixtures/sample.json', 'sample.json']])
    const joined = refs.find((fact) => fact.name === 'fixtures/sample.json')!
    expect(joined.span).toMatchObject({ startLine: 25, endLine: 25 })
    // src/obs.ts is not a test file, so the declared path-literal profile is exhausted.
    expect(OBS.capabilities['fixture-references']).toBe('complete')
    const js = audit('src/obs.js', fixture('observations-javascript.js'))
    expect(pairs(of(js, 'fixture-reference'))).toEqual([['./fixtures/data.json', 'data.json']])
  })

  it('does not claim resolution, existence or usage from a basename', () => {
    const { artifact } = artifactFor(makeProject({
      'src/a.ts': "import './fixtures/missing'\nimport './other/helper'\n",
      'src/fixtures/helper.ts': 'export const h = 1\n',
    }))
    const a = artifact.files.find((file) => file.path === 'src/a.ts')!
    expect(pairs(a.facts.filter((fact) => fact.kind === 'fixture-reference'))).toEqual([['./fixtures/missing', 'missing']])
    const reference = a.facts.find((fact) => fact.kind === 'fixture-reference')!
    expect(reference).not.toHaveProperty('targetPaths')
    expect(reference).not.toHaveProperty('importResolution')
    expect(a.facts.some((fact) => fact.kind === 'fixture-reference' && fact.value === 'helper')).toBe(false)
  })

  it('stays partial in test files because parser-backed literals cannot prove basename absence', () => {
    const payload = audit('tests/a.spec.ts', "import './fixtures/helper'\n")
    expect(pairs(of(payload, 'fixture-reference'))).toEqual([['./fixtures/helper', 'helper']])
    expect(payload.capabilities['fixture-references']).toBe('partial')
    expect(codes(payload)).toContain('fixture-text-occurrence-unavailable')
    expect(audit('tests/b.spec.ts', 'export const x = 1\n').capabilities['fixture-references']).toBe('partial')
  })

  it('keeps dynamic fixture paths partial', () => {
    const payload = audit('src/f.ts', "import { join } from 'node:path'\nconst n = 'x'\njoin('fixtures', n)\njoin(`fixtures/${n}`)\n")
    expect(of(payload, 'fixture-reference')).toEqual([])
    expect(payload.capabilities['fixture-references']).toBe('partial')
    expect(codes(payload)).toContain('dynamic-fixture-path')
  })
})

describe('v1.15.0 Batch 3 process and path observations', () => {
  it('reports a shell: true option outside a recognised child_process call as unattributed, not as an option fact', () => {
    const payload = audit('src/w.ts', "import { run } from './run'\nrun('x', { shell: true })\n")
    expect(of(payload, 'process-observation', 'process-option')).toEqual([])
    expect(payload.capabilities['process-observations']).toBe('partial')
    expect(codes(payload)).toContain('unattributed-shell-option')
  })

  it('captures bound child_process calls, literal shell: true and exact split literals', () => {
    const invocations = of(OBS, 'process-observation', 'process-invocation')
    expect(pairs(invocations)).toEqual(expect.arrayContaining([['spawnSync', 'git'], ['exec', 'ls']]))
    expect(pairs(of(OBS, 'process-observation', 'process-option'))).toEqual([['shell', 'true']])
    expect(pairs(of(OBS, 'process-observation', 'newline-split'))).toEqual([['split', '\n']])
    expect(pairs(of(OBS, 'process-observation', 'path-separator-split'))).toEqual([['split', '\\']])
    expect(OBS.capabilities['process-observations']).toBe('complete')
    const js = audit('src/obs.js', fixture('observations-javascript.js'))
    expect(pairs(of(js, 'process-observation', 'process-invocation'))).toEqual([['execSync', 'npm run lint']])
  })

  it('does not flag split("/") or unbound exec-style calls', () => {
    const payload = audit('src/p.ts', "const parts = 'a/b'.split('/')\nconst re = /x/.exec('y')\ndb.exec('select 1')\nfunction exec(c: string) { return c }\nexec('local')\n")
    expect(of(payload, 'process-observation')).toEqual([])
    expect(payload.capabilities['process-observations']).toBe('complete')
  })

  it('keeps dynamic invocation targets and options partial without a value', () => {
    const payload = audit('src/dp.ts', "import { exec, spawn } from 'child_process'\nconst cmd = process.argv[2]!\nconst opts = {}\nexec(cmd)\nspawn('git', [], { ...opts })\nspawn('git', [], { shell: Boolean(cmd) })\n")
    const invocations = of(payload, 'process-observation', 'process-invocation')
    expect(invocations).toHaveLength(3)
    expect(invocations[0]).not.toHaveProperty('value')
    expect(invocations[0]).not.toHaveProperty('valueSha256')
    expect(payload.capabilities['process-observations']).toBe('partial')
    expect(codes(payload)).toEqual(expect.arrayContaining(['dynamic-process-target', 'unsupported-process-options', 'dynamic-process-option']))
  })

  it('treats an unrecognised child_process import form as partial', () => {
    const payload = audit('src/lazy.ts', "export function f() { return require('child_process').execSync('ls') }\n")
    expect(payload.capabilities['process-observations']).toBe('partial')
    expect(codes(payload)).toContain('unsupported-process-import')
  })
})

describe('v1.15.0 Batch 3 literal bounds', () => {
  it('keeps exact values up to the bound and hashes longer literals without a prefix', () => {
    const exact = 'a'.repeat(256)
    const over = 'b'.repeat(257)
    expect(boundedAuditLiteral(exact)).toEqual({ value: exact })
    expect(boundedAuditLiteral(over)).toEqual({ value: null, valueSha256: sha256(over), valueTruncated: true })
    const payload = audit('src/big.ts', `export const BIG_ID = '${over}'\nexport const OK_ID = '${exact}'\nexport const dyn = { id: unknownCall() }\n`)
    const [big, ok] = of(payload, 'identifier-literal')
    expect(big).toMatchObject({ name: 'BIG_ID', value: null, valueSha256: sha256(over), valueTruncated: true })
    expect(ok).toMatchObject({ name: 'OK_ID', value: exact })
    expect(ok).not.toHaveProperty('valueTruncated')
    // An unknown dynamic literal is not a known oversized one: no fact, no hash.
    expect(of(payload, 'identifier-literal')).toHaveLength(2)
    expect(payload.capabilities['identifier-literals']).toBe('partial')
  })

  it('validates oversized literals in a full artifact and rejects prefix exposure', () => {
    const over = 'c'.repeat(300)
    const { artifact } = artifactFor(makeProject({ 'src/big.ts': `export const BIG_ID = '${over}'\n` }))
    expect(() => validateSourceAuditEvidence(artifact)).not.toThrow()
    const fact = artifact.files[0]!.facts.find((entry) => entry.kind === 'identifier-literal')!
    expect(fact.value).toBeNull()
    expect(JSON.stringify(artifact)).not.toContain(over.slice(0, 40))
  })
})

describe('v1.15.0 Batch 3 identity, malformed source and equivalence', () => {
  it('assigns stable, unique fact ids that are independent of repeated runs', () => {
    const again = audit('src/obs.ts', fixture('observations-typescript.ts'))
    expect(again.facts.map((fact) => fact.id)).toEqual(OBS.facts.map((fact) => fact.id))
    expect(new Set(OBS.facts.map((fact) => fact.id)).size).toBe(OBS.facts.length)
    for (const fact of OBS.facts) expect(fact.id).toMatch(/^audit-fact:src%2Fobs\.ts#[a-z-]+#\d+#(\d+|u)#\d+$/)
    const sameLine = audit('src/two.ts', "it('a', () => {}); it('b', () => {})\n")
    expect(new Set(sameLine.facts.map((fact) => fact.id)).size).toBe(sameLine.facts.length)
  })

  it('keeps ids unique across files and rejects cross-file duplicates in the artifact', () => {
    const { artifact } = artifactFor(makeProject({
      'src/a.ts': "export const A_ID = 'same'\n", 'src/b.ts': "export const A_ID = 'same'\n",
    }))
    const ids = artifact.files.flatMap((file) => file.facts.map((fact) => fact.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(() => validateSourceAuditEvidence(artifact)).not.toThrow()
    const copy = structuredClone(artifact)
    copy.files[1]!.facts[0]!.id = copy.files[0]!.facts[0]!.id
    expect(() => validateSourceAuditEvidence(copy)).toThrow()
  })

  it('degrades to partial on malformed source and never reports complete', () => {
    const payload = audit('src/bad.ts', "describe('open', () => {\n  it('x' \n")
    for (const family of ['identifier-literals', 'test-observations', 'fixture-references', 'process-observations'] as const) {
      expect(payload.capabilities[family]).not.toBe('complete')
    }
    expect(codes(payload)).toContain('syntax-errors')
  })

  it('normalizes missing or invalid producer evidence into dropped facts and downgraded capabilities', () => {
    const extraction = registry.adapterForFile('src/x.ts')!.extractFromSource('src/x.ts', "export const A_ID = 'v'\n")
    extraction.sourceAudit!.facts.push(
      { id: '', kind: 'test-observation', observationKind: 'registry-id', extractionMethod: 'typescript-ast', span: { path: 'src/x.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: 3 } },
      { id: '', kind: 'identifier-literal', observationKind: 'registry-id', extractionMethod: 'typescript-ast', span: { path: 'src/x.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: 3 } },
    )
    const payload = extractAuditObservations('src/x.ts', "export const A_ID = 'v'\n", extraction)
    expect(payload.facts.filter((fact) => fact.kind === 'test-observation')).toEqual([])
    expect(payload.capabilities['test-observations']).toBe('partial')
    expect(payload.capabilities['identifier-literals']).toBe('partial')
    expect(payload.diagnostics.map((d) => d.message).join(' ')).toContain('dropped')
    const missing = extractAuditObservations('src/x.ts', 'x', { ...extraction, sourceAudit: undefined })
    expect(missing.capabilities['test-observations']).toBe('unsupported')
  })
})

function artifactFor(root: string, sourceRoots: string[] = ['src']) {
  const built = buildIndex({ repoRoot: root, sourceRoots })
  const result = buildSourceAuditEvidence({
    projectRoot: root, sourceRoots, excludes: [], discovery: built.discovery, symbolIndex: built.index,
    fileHashes: built.fileContentHashes, producerVersion: '1.14.0',
  })
  return { built, ...result }
}

describe('v1.15.0 Batch 3 artifact projection and full/incremental equivalence', () => {
  it('projects observations with valid capabilities and role-aware applicability', () => {
    const { artifact } = artifactFor(makeProject({
      'src/obs.ts': fixture('observations-typescript.ts'), 'src/plain.ts': "export const NAME_ID = 'n'\n", 'src/obs.py': fixture('observations-python.py'),
    }))
    expect(() => validateSourceAuditEvidence(artifact)).not.toThrow()
    const plain = artifact.files.find((file) => file.path === 'src/plain.ts')!
    expect(plain.capabilities['identifier-literals']).toBe('complete')
    // A production source file with a clean scan keeps test observations not-applicable.
    expect(plain.capabilities['test-observations']).toBe('not-applicable')
    const obs = artifact.files.find((file) => file.path === 'src/obs.ts')!
    expect(['complete', 'partial']).toContain(obs.capabilities['test-observations'])
    expect(obs.facts.some((fact) => fact.kind === 'test-observation')).toBe(true)
    const py = artifact.files.find((file) => file.path === 'src/obs.py')!
    expect(py.capabilities['process-observations']).toBe('unsupported')
    expect(py.facts.some((fact) => fact.kind === 'process-observation')).toBe(false)
  })

  it('reuses unchanged observations, invalidates changed files and leaves no orphan facts', () => {
    const root = makeProject({
      'src/a.ts': "export const A_ID = 'one'\nit('t', () => {})\n", 'src/b.ts': "export const B_ID = 'two'\n",
    })
    const full = buildIndex({ repoRoot: root, sourceRoots: ['src'] })
    const factsOf = (index: typeof full.index, path: string) => index.files.find((file) => file.path === path)!.sourceAudit!.facts.filter((fact) => fact.kind === 'identifier-literal').map((fact) => [fact.id, fact.value])

    const cacheEntries = buildCacheFileEntries(full.discovery.files)
    writeFileSync(join(root, 'src/a.ts'), "export const A_ID = 'changed'\n")
    const discovery = discoverSourceFiles({ repoRoot: root, sourceRoots: ['src'] })
    const classification = classifyChangedFilePaths(cacheEntries, buildCacheFileEntries(discovery.files))
    const partial = buildPartialSymbolIndex({
      repoRoot: root, sourceRoots: ['src'], buildCallGraph: false, discoveryFiles: discovery.files,
      unchangedPaths: new Set(classification.unchanged),
      previousFileSummariesByPath: new Map(full.index.files.map((file) => [file.path, file])),
      previousCacheEntriesByPath: new Map(cacheEntries.map((entry) => [entry.path, entry])),
    })
    const rebuilt = buildIndex({ repoRoot: root, sourceRoots: ['src'] })
    expect(factsOf(partial.index, 'src/b.ts')).toEqual(factsOf(full.index, 'src/b.ts'))
    expect(factsOf(partial.index, 'src/a.ts')).toEqual(factsOf(rebuilt.index, 'src/a.ts'))
    expect(factsOf(partial.index, 'src/a.ts').map((entry) => entry[1])).toEqual(['changed'])
  })
})
