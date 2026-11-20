import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { getSourceAuditFilePage, readSourceAuditEvidence } from '../../src/lookup/readSourceAuditEvidence.js'
import { resolveAuditImportDomain } from '../../src/lookup/resolveAuditImportDomain.js'
import { validateSourceAuditEvidence } from '../../src/symbol-index/validateAuditEvidence.js'
import { runCli } from './testCli.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

async function indexed(source: (root: string) => string, other: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kit-b2-domain-'))
  roots.push(root)
  mkdirSync(join(root, 'src'))
  const path = 'src/origin.ts'
  writeFileSync(join(root, path), source(root))
  for (const [name, content] of Object.entries(other)) writeFileSync(join(root, 'src', name), content)
  const out = join(root, 'out')
  await runIndexCommand({ root, src: ['src'], out, sourceAuditSchema: '1.2.0' })
  const audit = readSourceAuditEvidence(out)
  const page = getSourceAuditFilePage(audit, path, 0)
  const expressions = page.facts.filter(fact => fact.kind === 'dynamic-import-expression')
  const query = (index: number) => resolveAuditImportDomain(out, expressions[index]!.id)
  return { root, out, audit, page, expressions, query, path }
}

describe('authenticated dynamic import domains and ambient classification', () => {
  it('preserves ordinary facts and records one typed expression per call with exact operands', async () => {
    const fixture = await indexed(() => [
      'export {}; const peer = "./peer";', 'import(peer);', 'import("./peer");',
      'import("./" + "peer");', 'import(globalThis.target);',
    ].join('\n'), { 'peer.ts': 'throw new Error("target must not execute");' })
    expect(fixture.page).toMatchObject({ schemaVersion: '1.2.0', file: { capabilities: { imports: 'partial', 'dynamic-import-expressions': 'complete' } } })
    expect(fixture.expressions.map(fact => fact.operandForm)).toEqual(['qualified-string-binding', 'string-literal', 'computed', 'computed'])
    expect(fixture.expressions[0]).toMatchObject({ operandSpan: { path: fixture.path, startLine: 2, startColumn: 7, endLine: 2, endColumn: 11 } })
    expect(fixture.expressions[0]!.literalImportFactId).toBeTruthy()
    expect(fixture.expressions[1]!.literalImportFactId).toBeTruthy()
    for (const fact of fixture.expressions) expect(fact).not.toHaveProperty('sourceSpecifier')
    expect(fixture.query(0)).toMatchObject({
      outcome: 'finite', domainComplete: true,
      qualifiedPositiveWitnesses: [{ targetPath: 'src/peer.ts', targetProof: { status: 'present' } }],
    })
    expect(fixture.query(2)).toMatchObject({ outcome: 'finite', qualifiedPositiveWitnesses: [] })
    expect(fixture.query(3)).toMatchObject({ outcome: 'indeterminate', domainComplete: false, disjointProof: null })
    const bad = structuredClone(fixture.audit)
    bad.files.find(file => file.path === fixture.path)!.facts.find(fact => fact.kind === 'dynamic-import-expression')!.literalImportFactId = 'wrong'
    expect(() => validateSourceAuditEvidence(bad)).toThrow(/linkage/)
    expect(runCli(['lookup', '--index', fixture.out, '--audit-import-domain', fixture.expressions[0]!.id, '--page', '0', '--json']).status).not.toBe(0)
    writeFileSync(join(fixture.root, fixture.path), 'import("./changed")')
    expect(() => fixture.query(0)).toThrow(/STALE_SOURCE_EVIDENCE/)
  }, 60_000)

  it('retains independent primitive alternatives, template literals and exclusions', async () => {
    const fixture = await indexed(() => [
      'declare const choose: boolean;',
      'const prefix = "./";',
      'import(`'+'${prefix}'+'${choose ? "peer" : "missing"}`);',
      'import(`./peer`);',
      'import("./" + "definitely-absent");',
    ].join('\n'), { 'peer.ts': 'export const x = 1;' })
    expect(fixture.query(0)).toMatchObject({
      outcome: 'finite', domainComplete: true, qualifiedPositiveWitnesses: [],
      operandAlternatives: [
        { alternativeIndex: 0, specifier: './peer', resolution: { status: 'present', candidateEnumerationComplete: true } },
        { alternativeIndex: 1, specifier: './missing', resolution: { status: 'proven-missing', candidateEnumerationComplete: true } },
      ],
    })
    expect(fixture.query(1)).toMatchObject({ outcome: 'finite', operandAlternatives: [{ specifier: './peer' }] })
    expect(fixture.query(2)).toMatchObject({ outcome: 'disjoint-selected-domain', disjointProof: { rule: 'fixed-normalized-path-v1' } })
  })

  it('refuses shadowing, reassignment, mutated builtins, unknown CWD and the website-style runtime operand', async () => {
    const fixture = await indexed(() => [
      'import path from "node:path";',
      'import { pathToFileURL } from "node:url";',
      'const temp = getRuntimeTemp();',
      'copySource(temp, "qpdf.mjs");',
      'import(pathToFileURL(path.join(temp, "qpdf.mjs")).href);',
      'const peer = "./peer";',
      'function shadow(peer: string) { return import(peer); }',
      'const assigned = "./peer";',
      'assigned = "./other";',
      'import(assigned);',
      'import(pathToFileURL("relative.ts").href);',
    ].join('\n'))
    expect(fixture.expressions).toHaveLength(4)
    expect(fixture.expressions[0]).toMatchObject({ operandForm: 'computed', operandSpan: { startLine: 5, startColumn: 7 } })
    for (const i of [0, 1, 2, 3]) expect(fixture.query(i)).toMatchObject({
      outcome: 'indeterminate', domainComplete: false, qualifiedPositiveWitnesses: [], disjointProof: null,
    })
    const mutated = await indexed(() => [
      'import path from "node:path";', 'path.join = runCustom;', 'import(path.join(".", "peer"));',
    ].join('\n'))
    expect(mutated.query(0)).toMatchObject({ outcome: 'indeterminate' })
  })

  const incompleteCall = {
    outcome: 'indeterminate', domainComplete: false, reasonCode: 'INCOMPLETE_REFERENCE_PROFILE',
    operandAlternatives: [], qualifiedPositiveWitnesses: [], disjointProof: null,
  }

  it.each([
    ['shared default exports', [
      "import path from 'node:path';",
      "import alias from 'node:path';",
      "alias.join = () => 'peer.mjs';",
      "void import('./' + path.join('missing.mjs'));",
    ]],
    ['node:path without visible mutation', [
      "import path from 'node:path';",
      "void import('./' + path.join('missing.mjs'));",
    ]],
    ['bare path with computed property mutation', [
      "import path from 'path';",
      "import alias from 'node:path';",
      "alias['jo' + 'in'] = () => 'peer.mjs';",
      "void import('./' + path.join('missing.mjs'));",
    ]],
    ['synchronized named export', [
      "import path, { join as buildPath } from 'node:path';",
      "import { syncBuiltinESMExports } from 'node:module';",
      "path.join = () => 'peer.mjs';",
      "syncBuiltinESMExports();",
      "void import('./' + buildPath('missing.mjs'));",
    ]],
    ['require alias', [
      "import path from 'node:path';",
      "const alias = require('path');",
      "alias.join = () => 'peer.mjs';",
      "void import('./' + path.join('missing.mjs'));",
    ]],
    ['createRequire alias', [
      "import path from 'node:path';",
      "import { createRequire } from 'node:module';",
      "const load = createRequire(import.meta.url);",
      "const alias = load('node:path');",
      "alias.join = () => 'peer.mjs';",
      "void import('./' + path.join('missing.mjs'));",
    ]],
    ['cross-module mutation', [
      "import path from 'node:path';",
      "import './mutate.mjs';",
      "void import('./' + path.join('missing.mjs'));",
    ]],
  ])('fails closed for %s', async (_description, lines) => {
    const fixture = await indexed(() => lines.join('\n'), {
      'peer.mjs': 'throw new Error("target must not execute");',
      'mutate.mjs': "import alias from 'node:path'; alias.join = () => 'peer.mjs';",
    })
    expect(fixture.expressions).toHaveLength(1)
    const result = fixture.query(0)
    expect(result).toMatchObject(incompleteCall)
    expect(fixture.query(0)).toEqual(result)
  })

  it('propagates unqualified calls through bindings, templates, conditionals and file URLs', async () => {
    const fixture = await indexed(root => [
      "import path from 'node:path';",
      "import { fileURLToPath, pathToFileURL as asURL } from 'node:url';",
      "import url from 'url';",
      "const target = path.join('peer.mjs');",
      "void import('./' + target);",
      'void import(`./${path.join("peer.mjs")}`);',
      "void import(flag ? './peer.mjs' : './' + path.join('missing.mjs'));",
      "void import(path.resolve('peer.mjs'));",
      "void import(path.normalize('./peer.mjs'));",
      "void import(asURL(" + JSON.stringify(join(root, 'src', 'peer.mjs')) + ").href);",
      "void import(asURL(path.join('missing.mjs')).href);",
      "void import(fileURLToPath('file:///peer.mjs'));",
      "void import(url.pathToFileURL('peer.mjs').href);",
      "void import(true ? './peer.mjs' : path.join('missing.mjs'));",
    ].join('\n'), { 'peer.mjs': 'throw new Error("target must not execute");' })
    expect(fixture.expressions).toHaveLength(10)
    for (let index = 0; index < 9; index++) expect(fixture.query(index)).toMatchObject(incompleteCall)
    expect(fixture.query(9)).toMatchObject({
      outcome: 'finite', domainComplete: true,
      operandAlternatives: [{ specifier: './peer.mjs', resolution: { status: 'present' } }],
    })
  })

  it('makes overflow indeterminate without truncating a successful domain', async () => {
    const choice = (values: string[]): string => {
      if (values.length === 1) return JSON.stringify(values[0])
      const middle = Math.floor(values.length / 2)
      return '(flag ? ' + choice(values.slice(0, middle)) + ' : ' + choice(values.slice(middle)) + ')'
    }
    const values = Array.from({ length: 65 }, (_, i) => 'pkg' + i)
    const defs = Array.from({ length: 17 }, (_, i) => 'const v' + i + ' = ' + (i === 0 ? '"pkg"' : 'v' + (i - 1)) + ';')
    const long = '\u0001'.repeat(3990)
    const expression = (value: string) => 'import(' + value + ');'
    const fixture = await indexed(() => [
      ...defs, 'const prefix = ' + JSON.stringify(long) + ';',
      expression(choice(values.slice(0, 64))), expression(choice(values)),
      expression('v15'), expression('v16'),
      expression('('.repeat(33) + '"pkg"' + ')'.repeat(33)),
      expression('prefix + ' + choice(values.slice(0, 64))),
      expression(choice(values.slice(0, 32).map(value => './' + value))),
    ].join('\n'))
    expect(fixture.query(0).operandAlternatives).toHaveLength(64)
    expect(fixture.query(2).outcome).toBe('finite')
    for (const index of [1, 3, 4]) expect(fixture.query(index)).toMatchObject({ outcome: 'indeterminate', reasonCode: 'DOMAIN_LIMIT_EXCEEDED' })
    for (const index of [5, 6]) expect(fixture.query(index)).toMatchObject({ outcome: 'indeterminate', reasonCode: 'QUERY_BUDGET_EXCEEDED' })
  }, 60_000)

  it('keeps parse uncertainty and whole-file ambient proof independent of suffix and isolated from the graph', async () => {
    const fixture = await indexed(() => 'import("./peer"); import();', {
      'stub.d.ts': '/* proof */ declare module "server-only"; ;',
      'mixed.d.ts': 'declare module "server-only"; console.log("side effect");',
      'body.d.ts': 'declare module "x" { export type T = number }',
      'augmentation.d.ts': 'export {}; declare module "x";',
      'malformed.d.ts': 'declare module "x',
    })
    expect(fixture.page.file?.capabilities['dynamic-import-expressions']).toBe('partial')
    expect(fixture.query(0)).toMatchObject({ outcome: 'indeterminate', reasonCode: 'INCOMPLETE_REFERENCE_PROFILE' })
    const ambient = (name: string) => fixture.audit.files.find(file => file.path === 'src/' + name)?.ambientClassification
    expect(ambient('stub.d.ts')).toMatchObject({ profile: 'typescript-ambient-stub-v1', scope: 'entire-file', outcome: 'proven-ambient-only', reasonCode: null })
    expect(ambient('stub.d.ts')?.witnessFactIds).toHaveLength(1)
    expect(ambient('mixed.d.ts')).toMatchObject({ outcome: 'not-ambient-only', reasonCode: 'EXECUTABLE_SYNTAX_PRESENT', witnessFactIds: [] })
    for (const file of ['body.d.ts', 'augmentation.d.ts', 'malformed.d.ts']) expect(ambient(file)?.outcome).toBe('undetermined')
  })
})
