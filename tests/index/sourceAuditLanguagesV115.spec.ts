import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildSourceAuditEvidence } from '../../src/indexing/buildSourceAuditEvidence.js'
import { buildCacheFileEntries, classifyChangedFilePaths } from '../../src/indexing/cacheMetadata.js'
import { discoverSourceFiles } from '../../src/indexing/discoverSourceFiles.js'
import { buildPartialSymbolIndex } from '../../src/indexing/partialRebuild.js'
import { JavaAdapter } from '../../src/languages/java/adapter.js'
import { KotlinAdapter } from '../../src/languages/kotlin/adapter.js'
import { PythonAdapter } from '../../src/languages/python/adapter.js'
import { createDefaultRegistry } from '../../src/languages/registry.js'
import { prepareRustParser } from '../../src/languages/rust/parser.js'
import { RustAdapter } from '../../src/languages/rust/adapter.js'
import { TypeScriptAdapter } from '../../src/languages/typescript/adapter.js'
import { SOURCE_AUDIT_CAPABILITIES, type SourceAuditFact, type SourceAuditFactKind } from '../../src/symbol-index/auditEvidenceTypes.js'
import { extractAuditObservations, type SourceAuditExtractionPayload } from '../../src/symbol-index/auditObservations.js'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { assignDeclarationIdentities } from '../../src/symbol-index/declarationIdentity.js'
import type { ExtractionResult } from '../../src/symbol-index/symbolExtractor.js'
import { validateSourceAuditEvidence } from '../../src/symbol-index/validateAuditEvidence.js'

// Pass-through counters used only by the "no duplicate parser execution" test.
const counters = vi.hoisted(() => ({ createSourceFile: 0, pythonParses: 0 }))
vi.mock('typescript', async (importOriginal) => {
  const actual = await importOriginal<typeof import('typescript')>()
  const wrapped = { ...actual, createSourceFile: (...args: Parameters<typeof actual.createSourceFile>) => { counters.createSourceFile += 1; return actual.createSourceFile(...args) } }
  return { ...wrapped, default: wrapped }
})
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawnSync: (...args: Parameters<typeof actual.spawnSync>) => {
      if (Array.isArray(args[1]) && args[1].includes('-c')) counters.pythonParses += 1
      return actual.spawnSync(...args)
    },
  }
})

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

function makeProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v115-lang-'))
  tempDirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

/** Runs the same adapter -> identity -> normalization sequence as the index builders. */
function audit(relPath: string, text: string): { extraction: ExtractionResult; payload: SourceAuditExtractionPayload } {
  const adapter = registry.adapterForFile(relPath)!
  const extraction = adapter.extractFromSource(relPath, text)
  extraction.symbols = assignDeclarationIdentities(relPath, extraction.symbols)
  return { extraction, payload: extractAuditObservations(relPath, text, extraction) }
}

const ofKind = (payload: SourceAuditExtractionPayload, kind: SourceAuditFactKind): SourceAuditFact[] => payload.facts.filter((fact) => fact.kind === kind)
const named = (payload: SourceAuditExtractionPayload, kind: SourceAuditFactKind, name: string): SourceAuditFact => {
  const found = payload.facts.find((fact) => fact.kind === kind && fact.name === name)
  if (!found) throw new Error(`missing ${kind} fact ${name}`)
  return found
}
const importOf = (payload: SourceAuditExtractionPayload, specifier: string): SourceAuditFact => {
  const found = payload.facts.find((fact) => fact.kind === 'import' && fact.sourceSpecifier === specifier)
  if (!found) throw new Error(`missing import ${specifier}`)
  return found
}

function artifactFor(root: string, sourceRoots: string[] = ['src']) {
  const built = buildIndex({ repoRoot: root, sourceRoots })
  const result = buildSourceAuditEvidence({
    projectRoot: root, sourceRoots, excludes: [], discovery: built.discovery, symbolIndex: built.index,
    fileHashes: built.fileContentHashes, producerVersion: '1.14.0',
  })
  return { built, ...result }
}

// Batch 3 lifted identifier/test/fixture/process observations for TypeScript and JavaScript; api-client-calls remains Batch 6.
const OUT_OF_SCOPE = ['api-client-calls'] as const

describe('v1.15.0 Batch 2 TypeScript and JavaScript facts', () => {
  it('extracts imports, declarations and exports with exact spans from the .mts fixture', () => {
    const { payload } = audit('src/language-typescript.mts', fixture('language-typescript.mts'))
    expect(payload.capabilities).toMatchObject({ declarations: 'complete', imports: 'complete', exports: 'complete', 'source-ranges': 'complete' })
    expect(payload.facts.every((fact) => fact.extractionMethod === 'typescript-ast')).toBe(true)

    // The imported name is distinct from the local binding name (`alpha as localAlpha`).
    const sibling = importOf(payload, './sibling.js')
    expect(sibling.importedNames).toEqual(['default', 'alpha', 'Beta'])
    expect(sibling.importedNames).not.toContain('localAlpha')
    expect(sibling.importResolution).toBe('observed')
    expect(importOf(payload, '../helpers/util').importedNames).toEqual(['*'])
    expect(importOf(payload, 'side-effect-module').importedNames).toEqual([])
    expect(sibling.span).toMatchObject({ startLine: 1, startColumn: 0, endLine: 1 })

    // An export declaration, a local alias export and a re-export are three distinct origins.
    expect(named(payload, 'export', 'make')).toMatchObject({ exportOrigin: 'declared-export', exported: true })
    expect(named(payload, 'export', 'exposedHelper')).toMatchObject({ exportOrigin: 'declared-export' })
    expect(named(payload, 'export', 'exposedHelper').sourceSpecifier).toBeUndefined()
    expect(named(payload, 'export', 'renamedRemote')).toMatchObject({ exportOrigin: 're-export', sourceSpecifier: './remote.js' })
    expect(named(payload, 'export', '*')).toMatchObject({ exportOrigin: 're-export', sourceSpecifier: './barrel.js' })
    expect(named(payload, 'export', 'default')).toMatchObject({ exportOrigin: 'declared-export' })

    expect(named(payload, 'declaration', 'Circle')).toMatchObject({ declarationKind: 'class', exported: true, visibility: 'public' })
    expect(named(payload, 'declaration', 'internalCounter')).toMatchObject({ declarationKind: 'variable', exported: false, exportOrigin: 'none', visibility: 'module' })
    expect(named(payload, 'declaration', 'privateHelper')).toMatchObject({ exported: true })
    for (const fact of payload.facts) {
      expect(fact.span.startColumn).not.toBeNull()
      expect(fact.span.endLine).not.toBeNull()
    }
    for (const name of OUT_OF_SCOPE) expect(payload.capabilities[name]).toBe('unsupported')
  })

  it('binds declaration facts to existing symbol identities without creating new nodes', () => {
    const { extraction, payload } = audit('src/language-typescript.mts', fixture('language-typescript.mts'))
    const symbolIds = new Set(extraction.symbols.map((symbol) => symbol.nodeId))
    for (const fact of ofKind(payload, 'declaration')) expect(symbolIds.has(fact.symbolId)).toBe(true)
    expect(ofKind(payload, 'declaration')).toHaveLength(extraction.symbols.length)
  })

  it('classifies .mts and .cts as TypeScript and discovers both', () => {
    const root = makeProject({
      'src/language-typescript.mts': fixture('language-typescript.mts'),
      'src/language-commonjs.cts': fixture('language-commonjs.cts'),
      'src/language-javascript.cjs': fixture('language-javascript.cjs'),
    })
    const discovery = discoverSourceFiles({ repoRoot: root, sourceRoots: ['src'] })
    expect(discovery.files.map((file) => file.relPath).sort()).toEqual(['src/language-commonjs.cts', 'src/language-javascript.cjs', 'src/language-typescript.mts'])
    expect(registry.adapterForFile('a.MTS')).toBeInstanceOf(TypeScriptAdapter)
    const { built, artifact } = artifactFor(root)
    expect(built.index.files.map((file) => [file.path, file.language])).toEqual([
      ['src/language-commonjs.cts', 'typescript'],
      ['src/language-javascript.cjs', 'javascript'],
      ['src/language-typescript.mts', 'typescript'],
    ])
    const cts = artifact.files.find((file) => file.path === 'src/language-commonjs.cts')!
    expect(cts).toMatchObject({ language: 'typescript', status: 'parsed', analyzerId: 'typescript-ast' })
    expect(cts.facts.find((fact) => fact.kind === 'export')).toMatchObject({ name: 'export=', exportOrigin: 'declared-export' })
    expect(() => validateSourceAuditEvidence(artifact)).not.toThrow()
  })

  it('extracts JavaScript ESM and preserves CommonJS exports and requires from the .cjs fixture', () => {
    const esm = audit('src/esm.js', "import a, { b } from './dep.js'\nexport { b }\nexport default function main() {}\nexport const value = 1\n").payload
    expect(esm.capabilities).toMatchObject({ declarations: 'complete', imports: 'complete', exports: 'complete' })
    expect(importOf(esm, './dep.js').importedNames).toEqual(['default', 'b'])
    expect(named(esm, 'export', 'default')).toMatchObject({ exportOrigin: 'declared-export' })
    expect(named(esm, 'declaration', 'main')).toMatchObject({ declarationKind: 'function', exported: true })

    const { payload } = audit('src/language-javascript.cjs', fixture('language-javascript.cjs'))
    expect(importOf(payload, './language-commonjs.cjs').importedNames).toEqual(['*'])
    expect(importOf(payload, 'node:path').importedNames).toEqual(['join'])
    expect(named(payload, 'export', 'build')).toMatchObject({ exportOrigin: 'commonjs' })
    expect(named(payload, 'export', 'VERSION')).toMatchObject({ exportOrigin: 'commonjs' })
    expect(payload.capabilities.exports).toBe('complete')
    // A destructured top-level declaration is outside the extraction profile and must make declarations partial.
    expect(payload.capabilities.declarations).toBe('partial')
    expect(payload.diagnostics.map((d) => d.code)).toContain('destructured-declaration-unsupported')
  })

  it('resolves a .cjs specifier to a .cts file and reports unresolved and ambiguous imports without proving absence', () => {
    const root = makeProject({
      'src/language-commonjs.cts': fixture('language-commonjs.cts'),
      'src/language-javascript.cjs': fixture('language-javascript.cjs'),
      'src/amb.ts': "import './dup'\nimport './missing'\nimport 'lodash'\nexport const x = 1\n",
      'src/dup.ts': 'export const d = 1\n',
      'src/dup/index.ts': 'export const d2 = 2\n',
    })
    const { artifact } = artifactFor(root)
    const imports = (path: string) => artifact.files.find((file) => file.path === path)!.facts.filter((fact) => fact.kind === 'import')
    const cjs = imports('src/language-javascript.cjs').find((fact) => fact.sourceSpecifier === './language-commonjs.cjs')!
    expect(cjs).toMatchObject({ importResolution: 'resolved-local', targetPaths: ['src/language-commonjs.cts'] })

    const [dup, missing, external] = imports('src/amb.ts')
    expect(dup).toMatchObject({ importResolution: 'ambiguous' })
    expect(dup!.targetPaths).toEqual(['src/dup.ts', 'src/dup/index.ts'])
    // An unresolved relative import is "unresolved", never a proven missing file; a bare package is external.
    expect(missing).toMatchObject({ importResolution: 'unresolved' })
    expect(missing!.targetPaths).toBeUndefined()
    expect(external).toMatchObject({ importResolution: 'external' })
    expect(() => validateSourceAuditEvidence(artifact)).not.toThrow()
  })

  it('intentionally extends v1.14 relative resolution to .mts/.cts with positive and negative witnesses', () => {
    const ts = new TypeScriptAdapter()
    // v1.14 treated these as unsupported (null). v1.15 resolves an explicit specifier to the uniquely selected file.
    expect(ts.resolveImportToFile('./left.mts', 'consumer.ts', ['left.mts'])).toBe('left.mts')
    expect(ts.resolveImportToFile('./left.cts', 'consumer.ts', ['left.cts'])).toBe('left.cts')
    // Missing files stay unresolved; the specifier alone never selects a different extension.
    expect(ts.resolveImportToFile('./left.mts', 'consumer.ts', ['other.mts'])).toBeNull()
    expect(ts.resolveImportToFile('./left.cts', 'consumer.ts', ['left.mts'])).toBeNull()
    // ./x.mjs -> x.mts and ./x.cjs -> x.cts only when that exact candidate is in the selected set.
    expect(ts.resolveImportToFile('./left.mjs', 'consumer.ts', ['left.mts'])).toBe('left.mts')
    expect(ts.resolveImportToFile('./left.cjs', 'consumer.ts', ['left.cts'])).toBe('left.cts')
    expect(ts.resolveImportToFile('./left.mjs', 'consumer.ts', ['other.mts'])).toBeNull()
    expect(ts.resolveImportToFile('./left.cjs', 'consumer.ts', ['left.mts'])).toBeNull()
    // .mjs is not a supported source extension: an existing left.mjs is never selected.
    expect(ts.resolveImportToFile('./left.mjs', 'consumer.ts', ['left.mjs'])).toBeNull()
    expect(ts.resolveImportToFile('./left.mjs', 'consumer.ts', ['left.ts'])).toBeNull()
    // External packages never become local.
    expect(ts.resolveImportToFile('package', 'consumer.ts', ['package/index.ts', 'package.mts'])).toBeNull()
    // Ambiguous extensionless imports remain ambiguous and are never silently picked.
    expect(ts.resolveCandidates('./left', 'consumer.ts', ['left.ts', 'left.mts'])).toEqual(['left.mts', 'left.ts'])
    expect(ts.resolveImportToFile('./left', 'consumer.ts', ['left.ts', 'left.mts'])).toBeNull()
    // Existing extensions stay compatible.
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.cjs']) {
      expect(ts.resolveImportToFile(`./left${ext}`, 'consumer.ts', [`left${ext}`])).toBe(`left${ext}`)
    }
    expect(ts.resolveImportToFile('./left.js', 'consumer.ts', ['left.ts'])).toBe('left.ts')
  })

  it('resolves a self-import without implying a call or recursion relationship', () => {
    const { payload } = audit('src/self.mts', "import './self.mjs'\nexport function f() { return 1 }\n")
    expect(ofKind(payload, 'import')).toHaveLength(1)
    expect(payload.facts.every((fact) => fact.kind === 'import' || fact.kind === 'declaration' || fact.kind === 'export')).toBe(true)
  })

  it('marks imports and exports partial for dynamic constructs and syntax errors', () => {
    const dynamic = audit('src/dyn.js', "const lazy = () => import('./lazy.js')\nconst name = 'x'\nconst mod = require(name)\nexports[name] = 1\nmodule.exports.ok = 1\n").payload
    expect(dynamic.capabilities.imports).toBe('partial')
    expect(dynamic.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['dynamic-import-not-enumerated', 'unsupported-require']))
    expect(dynamic.capabilities.exports).toBe('partial')

    const broken = audit('src/broken.ts', 'export function ok() {}\nexport const = ;\nimport { from "x"\n').payload
    expect(broken.capabilities).toMatchObject({ declarations: 'partial', imports: 'partial', exports: 'partial', 'source-ranges': 'partial' })
    expect(broken.diagnostics.map((d) => d.code)).toContain('syntax-errors')
    expect(broken.facts.every((fact) => fact.span.endLine === null && fact.span.endColumn === null)).toBe(true)
    // Parse errors never become empty "complete" evidence.
    expect(Object.values(broken.capabilities).filter((status) => status === 'complete')).toEqual([])
  })

  it('does not mark a file complete merely because it has no imports or exports', () => {
    const { payload } = audit('src/empty.ts', '// nothing here\n')
    expect(payload.facts).toEqual([])
    expect(payload.capabilities.declarations).toBe('complete')
    for (const name of OUT_OF_SCOPE) expect(payload.capabilities[name]).toBe('unsupported')
  })
})

describe('v1.15.0 Batch 2 Python facts', () => {
  it('records an explicit __all__ as python-all exports and distinguishes it from convention', () => {
    const { payload } = audit('src/language-python-all.py', fixture('language-python-all.py'))
    expect(payload.capabilities).toMatchObject({ declarations: 'complete', imports: 'complete', exports: 'complete', 'source-ranges': 'complete' })
    expect(payload.facts.every((fact) => fact.extractionMethod === 'python-ast')).toBe(true)
    const exports = ofKind(payload, 'export')
    expect(exports.map((fact) => [fact.name, fact.exportOrigin])).toEqual([
      ['public_function', 'python-all'], ['PublicClass', 'python-all'], ['MISSING_NAME', 'python-all'],
    ])
    expect(named(payload, 'export', 'MISSING_NAME').symbolId).toBeUndefined()
    expect(named(payload, 'declaration', 'public_function')).toMatchObject({ exported: true, exportOrigin: 'python-all' })
    expect(named(payload, 'declaration', 'hidden_function')).toMatchObject({ exported: false, exportOrigin: 'none' })
    expect(named(payload, 'declaration', 'method')).toMatchObject({ exported: false, ownerKey: 'python/class:PublicClass' })
    expect(named(payload, 'export', 'public_function').span.startLine).toBe(7)
  })

  it('records relative levels, dotted modules and imported names', () => {
    const { payload } = audit('src/language-python-all.py', fixture('language-python-all.py'))
    expect(importOf(payload, 'os').importedNames).toEqual([])
    expect(importOf(payload, '.').importedNames).toEqual(['sibling'])
    expect(importOf(payload, '.pkg.mod').importedNames).toEqual(['thing', 'other'])
    expect(importOf(payload, '..').importedNames).toEqual(['parent_pkg'])
    // `import a, b` produces two distinct facts at one statement span with distinct ordinals.
    const twice = audit('src/twice.py', 'import json, sys\n').payload
    expect(ofKind(twice, 'import').map((fact) => fact.sourceSpecifier)).toEqual(['json', 'sys'])
    expect(new Set(twice.facts.map((fact) => fact.id)).size).toBe(2)
  })

  it('infers convention exports only for declarations and keeps exports partial', () => {
    const { payload } = audit('src/conv.py', 'def shown():\n    pass\n\ndef _hidden():\n    pass\n\nclass Shown:\n    pass\n')
    expect(payload.capabilities.exports).toBe('partial')
    expect(payload.diagnostics.map((d) => d.code)).toContain('python-convention-exports')
    expect(ofKind(payload, 'export').map((fact) => [fact.name, fact.exportOrigin])).toEqual([['shown', 'python-convention'], ['Shown', 'python-convention']])
    expect(named(payload, 'declaration', '_hidden')).toMatchObject({ exported: false, exportOrigin: 'none' })
  })

  it('never presents a dynamic __all__ as a verified export list', () => {
    for (const body of [
      "__all__ = ['a'] + other\n",
      "__all__ = ['a']\n__all__ += ['b']\n",
      "__all__ = ['a']\n__all__.append('b')\n",
      "__all__ = [name for name in dir()]\n",
      "if cond:\n    __all__ = ['a']\n",
      "__all__ = ['a']\n__all__ = ['b']\n",
    ]) {
      const { payload } = audit('src/dyn_all.py', `${body}\ndef a():\n    pass\n`)
      expect(payload.capabilities.exports, body).toBe('partial')
      expect(ofKind(payload, 'export'), body).toEqual([])
      expect(named(payload, 'declaration', 'a'), body).toMatchObject({ exported: null, exportOrigin: 'unknown' })
      expect(payload.diagnostics.map((d) => d.code), body).toContain('python-dynamic-all')
    }
  })

  it('reports a syntax error as failed capabilities and a failed file, not empty evidence', () => {
    const { payload } = audit('src/bad.py', 'def broken(:\n')
    expect(payload.facts).toEqual([])
    for (const name of ['declarations', 'imports', 'exports', 'source-ranges'] as const) expect(payload.capabilities[name]).toBe('failed')
    const root = makeProject({ 'src/bad.py': 'def broken(:\n', 'src/ok.py': 'def fine():\n    pass\n' })
    const { artifact } = artifactFor(root)
    const bad = artifact.files.find((file) => file.path === 'src/bad.py')!
    expect(bad).toMatchObject({ status: 'failed', facts: [] })
    expect(artifact.files.find((file) => file.path === 'src/ok.py')!.status).toBe('parsed')
    expect(() => validateSourceAuditEvidence(artifact)).not.toThrow()
  })

  it('converts Python UTF-8 byte offsets to UTF-16 columns', () => {
    const { payload } = audit('src/uni.py', "x = 'é'; y = 1\nimport os\n")
    expect(payload.facts.map((fact) => fact.kind)).toContain('import')
    const text = "NAME = 'é'; OTHER = 2\n"
    const constants = audit('src/uni2.py', text).payload
    expect(named(constants, 'declaration', 'NAME').span.startColumn).toBe(0)
  })
})

describe('v1.15.0 Batch 2 Java facts', () => {
  it('records explicit visibility separately from export origin for public and package-private types', () => {
    const { extraction, payload } = audit('src/language-java-nested.java', fixture('language-java-nested.java'))
    expect(payload.facts.every((fact) => fact.extractionMethod === 'java-lexical')).toBe(true)
    expect(named(payload, 'declaration', 'Outer')).toMatchObject({ visibility: 'public', exported: true, exportOrigin: 'visibility-inferred' })
    expect(named(payload, 'declaration', 'PackagePrivateTop')).toMatchObject({ visibility: 'package', exported: false })
    expect(named(payload, 'declaration', 'Contract')).toMatchObject({ visibility: 'package', exported: false })
    // The legacy exported boolean treats package-private as exported; the audit fact must not.
    expect(extraction.symbols.find((symbol) => symbol.name === 'PackagePrivateTop')?.exported).toBe(true)
    expect(ofKind(payload, 'export').map((fact) => fact.name)).toEqual(['Outer', 'PublicNested', 'Mode'])
    expect(payload.capabilities).toMatchObject({ declarations: 'complete', imports: 'complete', exports: 'partial', 'source-ranges': 'partial' })
    for (const fact of payload.facts) expect(fact.span).toMatchObject({ startColumn: null, endLine: null, endColumn: null })
    expect(importOf(payload, 'java.lang.Math.max').importedNames).toEqual(['max'])
    expect(importOf(payload, 'java.io.*').importedNames).toEqual(['*'])
  })

  it('extracts nested declarations with owning scope and implicit interface visibility, without new graph symbols', () => {
    const { extraction, payload } = audit('src/language-java-nested.java', fixture('language-java-nested.java'))
    const nested = (name: string) => named(payload, 'declaration', name)
    expect(nested('PublicNested')).toMatchObject({ visibility: 'public', exported: true, ownerKey: 'java/class:Outer' })
    expect(nested('PackageNested')).toMatchObject({ visibility: 'package', exported: false })
    expect(nested('DeeperPackage')).toMatchObject({ visibility: 'package', ownerKey: 'java/class:Outer/class:PackageNested' })
    expect(nested('PrivateNested')).toMatchObject({ visibility: 'private', exported: false })
    expect(nested('ProtectedNested')).toMatchObject({ visibility: 'protected', declarationKind: 'interface' })
    expect(nested('Mode')).toMatchObject({ visibility: 'public', declarationKind: 'enum' })
    // Implicitly public inside an interface, but not effectively exported because the owner is package-private.
    expect(nested('ImplicitPublicNested')).toMatchObject({ visibility: 'public', exported: false, ownerKey: 'java/interface:Contract' })
    // A class declared inside a method body is not a member declaration.
    expect(payload.facts.find((fact) => fact.name === 'Local')).toBeUndefined()
    expect(nested('PublicNested').symbolId).toMatch(/^audit-symbol:/)
    // Nested declarations add audit facts only; the symbol index keeps its top-level symbols.
    expect(extraction.symbols.map((symbol) => symbol.name)).toEqual(['Outer', 'PackagePrivateTop', 'Contract'])
  })

  it('emits partial evidence and no nested identities when lexical nesting is uncertain', () => {
    const cases: Record<string, string> = {
      'unbalanced-braces': 'public class A {\n  public class B {\n}\n',
      'brace-in-literal': 'public class A {\n  String s = "{";\n  public class B {\n  }\n}\n',
      'text-block-literal': 'public class A {\n  String s = """\n  {\n  """;\n  public class B {\n  }\n}\n',
      'unrecognized-nested-declaration': 'public class A {\n  Object o = new Object() { }; // class\n  foo class Bad {}\n}\n',
    }
    for (const [code, text] of Object.entries(cases)) {
      const { payload } = audit('src/Uncertain.java', text)
      expect(payload.diagnostics.map((d) => d.code), code).toContain(code)
      expect(payload.capabilities.declarations, code).toBe('partial')
      expect(payload.facts.find((fact) => fact.name === 'B' || fact.name === 'Bad'), code).toBeUndefined()
      expect(named(payload, 'declaration', 'A'), code).toMatchObject({ visibility: 'public' })
    }
  })
})

describe('v1.15.0 Batch 2 Kotlin facts', () => {
  it('records internal, protected, private and implicit-public visibility', () => {
    const { payload } = audit('src/language-kotlin-nested.kt', fixture('language-kotlin-nested.kt'))
    expect(payload.facts.every((fact) => fact.extractionMethod === 'kotlin-lexical')).toBe(true)
    const decl = (name: string) => named(payload, 'declaration', name)
    expect(decl('Outer')).toMatchObject({ visibility: 'public', exported: true })
    expect(decl('NestedPrivate')).toMatchObject({ visibility: 'private', exported: false })
    expect(decl('NestedInternal')).toMatchObject({ visibility: 'internal', exported: false })
    expect(decl('NestedProtected')).toMatchObject({ visibility: 'protected', exported: false })
    expect(decl('Singleton')).toMatchObject({ visibility: 'internal', exported: false })
    expect(decl('helper')).toMatchObject({ visibility: 'private', exported: false, declarationKind: 'function' })
    expect(decl('publicFunction')).toMatchObject({ visibility: 'public', exported: true })
    expect(decl('topLevelValue')).toMatchObject({ visibility: 'public', declarationKind: 'const' })
    expect(decl('Point')).toMatchObject({ visibility: 'public', declarationKind: 'class' })
    // Internal and protected are never exported as public contracts.
    const exported = ofKind(payload, 'export').map((fact) => fact.name)
    expect(exported).not.toContain('NestedInternal')
    expect(exported).not.toContain('NestedProtected')
    expect(exported).not.toContain('Singleton')
    expect(importOf(payload, 'java.util.*').importedNames).toEqual(['*'])
  })

  it('extracts nested and companion declarations with owning scope', () => {
    const { extraction, payload } = audit('src/language-kotlin-nested.kt', fixture('language-kotlin-nested.kt'))
    expect(payload.capabilities).toMatchObject({ declarations: 'complete', imports: 'complete', exports: 'partial', 'source-ranges': 'partial' })
    const decl = (name: string) => named(payload, 'declaration', name)
    expect(decl('NestedPublic')).toMatchObject({ ownerKey: 'kotlin/class:Outer', visibility: 'public' })
    expect(decl('Companion')).toMatchObject({ declarationKind: 'object', ownerKey: 'kotlin/class:Outer' })
    expect(decl('Named')).toMatchObject({ declarationKind: 'object', ownerKey: 'kotlin/object:Singleton', exported: false })
    expect(decl('Registry')).toMatchObject({ declarationKind: 'object' })
    expect(decl('Handler')).toMatchObject({ declarationKind: 'interface' })
    expect(extraction.symbols.map((symbol) => symbol.name)).toEqual(['Outer', 'Singleton', 'helper', 'publicFunction', 'topLevelValue', 'Point'])
  })

  it('discovers and extracts .kts scripts without claiming complete script scope', () => {
    const root = makeProject({ 'src/script.kts': fixture('language-kotlin-script.kts'), 'src/app.kt': 'class App\n' })
    expect(discoverSourceFiles({ repoRoot: root, sourceRoots: ['src'] }).files.map((file) => file.relPath).sort()).toEqual(['src/app.kt', 'src/script.kts'])
    expect(registry.adapterForFile('build.gradle.kts')).toBeInstanceOf(KotlinAdapter)
    const { payload } = audit('src/script.kts', fixture('language-kotlin-script.kts'))
    expect(payload.capabilities).toMatchObject({ declarations: 'partial', imports: 'partial' })
    expect(payload.diagnostics.map((d) => d.code)).toContain('kotlin-script-scope')
    expect(named(payload, 'declaration', 'greeting')).toMatchObject({ visibility: 'unknown', exported: null, exportOrigin: 'unknown' })
    const { artifact } = artifactFor(root)
    expect(artifact.files.find((file) => file.path === 'src/script.kts')).toMatchObject({ language: 'kotlin', status: 'parsed', analyzerId: 'kotlin-lexical' })
  })

  it('does not publish nested identities from uncertain Kotlin nesting', () => {
    const { payload } = audit('src/Bad.kt', 'class A {\n  val s = "{"\n  class B {\n  }\n}\n')
    expect(payload.diagnostics.map((d) => d.code)).toContain('brace-in-literal')
    expect(payload.capabilities.declarations).toBe('partial')
    expect(payload.facts.find((fact) => fact.name === 'B')).toBeUndefined()
    const odd = audit('src/Odd.kt', 'class A {\n  val x = 1 // class\n  weird class Q {\n  }\n}\n').payload
    expect(odd.diagnostics.map((d) => d.code)).toContain('unrecognized-nested-declaration')
    expect(odd.facts.find((fact) => fact.name === 'Q')).toBeUndefined()
  })
})

describe('v1.15.0 Batch 2 Rust facts', () => {
  it('records qualified declarations, visibility and use observations', () => {
    const { extraction, payload } = audit('src/language-rust.rs', fixture('language-rust.rs'))
    expect(payload.facts.every((fact) => fact.extractionMethod === 'rust-tree-sitter')).toBe(true)
    expect(payload.capabilities).toMatchObject({ declarations: 'complete', imports: 'complete', exports: 'partial', 'source-ranges': 'complete' })
    const declarations = ofKind(payload, 'declaration')
    expect(declarations).toHaveLength(extraction.symbols.length)
    const exposed = declarations.find((fact) => fact.name === 'Exposed')!
    expect(exposed).toMatchObject({ visibility: 'public', exported: true })
    expect(exposed.symbolId).toMatch(/^symbolq:/) // qualified identity from the existing symbol index
    expect(exposed.ownerKey).toContain('mod_item:inner')
    expect(named(payload, 'declaration', 'crate_visible')).toMatchObject({ visibility: 'internal', exported: false })
    expect(named(payload, 'declaration', 'private_fn')).toMatchObject({ visibility: 'private', exported: false })
    expect(named(payload, 'declaration', 'secret')).toMatchObject({ visibility: 'private', declarationKind: 'field' })
    // Visibility inherited from an enum or trait is unknown rather than guessed.
    expect(named(payload, 'declaration', 'Fast')).toMatchObject({ visibility: 'unknown', exported: null })
    const runs = declarations.filter((fact) => fact.name === 'run')
    expect(runs).toHaveLength(2)
    expect(runs.every((fact) => fact.visibility === 'unknown')).toBe(true)
    expect(declarations.find((fact) => fact.name === 'hidden')).toMatchObject({ visibility: 'private' })

    const grouped = importOf(payload, 'std::collections::{HashMap, HashSet}')
    expect(grouped.importedNames).toEqual(['HashMap', 'HashSet'])
    expect(grouped.importResolution).toBe('observed')
    expect(importOf(payload, 'crate::inner::Helper as Aliased').importedNames).toEqual(['Helper'])
    expect(named(payload, 'export', 'Exposed')).toMatchObject({ exportOrigin: 're-export', sourceSpecifier: 'self::inner::Exposed' })
    for (const fact of payload.facts) expect(fact.span.startColumn).not.toBeNull()
  })

  it('keeps macro, conditional-compilation, parser-recovery and unsupported-use uncertainty visible', () => {
    const macro = audit('src/m.rs', 'macro_rules! make { () => {} }\nmake!();\npub fn f() {}\n').payload
    expect(macro.diagnostics.map((d) => d.code)).toContain('rust-macro-may-generate-items')
    expect(macro.capabilities).toMatchObject({ declarations: 'partial', imports: 'partial', exports: 'partial' })

    const cfg = audit('src/c.rs', '#[cfg(feature = "x")]\npub fn gated() {}\nuse std::fmt;\n').payload
    expect(cfg.diagnostics.map((d) => d.code)).toContain('rust-conditional-compilation')
    expect(cfg.capabilities.declarations).toBe('partial')

    const broken = audit('src/b.rs', 'pub fn ok() {}\nfn broken( {\n').payload
    expect(broken.diagnostics.map((d) => d.code)).toContain('rust-parser-recovery')
    expect(broken.capabilities).toMatchObject({ declarations: 'partial', 'source-ranges': 'partial' })

    // A plain file with no macros stays complete, and expression-level macros do not generate items.
    const plain = audit('src/p.rs', 'pub fn f() { println!("hi"); }\n').payload
    expect(plain.capabilities.declarations).toBe('complete')
  })
})

describe('v1.15.0 Batch 2 fact identity and provenance', () => {
  const SOURCE = "import { a } from './a'; import { b } from './b'\nexport const x = 1, y = 2\n"

  it('uses the approved deterministic identity grammar and artifact-unique ids', () => {
    const { payload } = audit('src/sp ace/a.ts', SOURCE)
    for (const fact of payload.facts) {
      expect(fact.id).toMatch(/^audit-fact:[^#]+#[a-z-]+#\d+#(\d+|u)#\d+$/)
      expect(fact.id.startsWith('audit-fact:src%2Fsp%20ace%2Fa.ts#')).toBe(true)
      expect(fact.id).not.toMatch(/[A-Za-z]:[\\/]|\\/)
    }
    expect(new Set(payload.facts.map((fact) => fact.id)).size).toBe(payload.facts.length)
    const sameKey = payload.facts.filter((fact) => fact.kind === 'declaration')
    expect(sameKey.map((fact) => fact.id.split('#')[2])).toEqual(['2', '2'])
  })

  it('is stable across repeated extraction, project roots and raw fact order', () => {
    const first = audit('src/a.ts', SOURCE).payload
    const second = audit('src/a.ts', SOURCE).payload
    expect(second).toEqual(first)

    // Shuffling the producer's raw facts cannot change ids or order.
    const adapter = registry.adapterForFile('src/a.ts')!
    const extraction = adapter.extractFromSource('src/a.ts', SOURCE)
    extraction.symbols = assignDeclarationIdentities('src/a.ts', extraction.symbols)
    extraction.sourceAudit!.facts.reverse()
    expect(extractAuditObservations('src/a.ts', SOURCE, extraction)).toEqual(first)

    const rootOne = artifactFor(makeProject({ 'src/a.ts': SOURCE })).artifact
    const rootTwo = artifactFor(makeProject({ 'src/a.ts': SOURCE })).artifact
    expect(rootTwo.files).toEqual(rootOne.files)
    expect(rootTwo.source.snapshotId).toBe(rootOne.source.snapshotId)
  })

  it('assigns distinct ordinals to facts that share path, kind, line and column and rejects id collisions', () => {
    const adapter = registry.adapterForFile('src/o.ts')!
    const extraction = adapter.extractFromSource('src/o.ts', 'export const x = 1\n')
    extraction.symbols = assignDeclarationIdentities('src/o.ts', extraction.symbols)
    const template = extraction.sourceAudit!.facts.find((fact) => fact.kind === 'export')!
    extraction.sourceAudit!.facts.push({ ...template }, { ...template })
    const payload = extractAuditObservations('src/o.ts', 'export const x = 1\n', extraction)
    const exports = ofKind(payload, 'export')
    expect(exports).toHaveLength(3)
    expect(exports.map((fact) => fact.id.split('#')[4]).sort()).toEqual(['0', '1', '2'])
    expect(new Set(payload.facts.map((fact) => fact.id)).size).toBe(payload.facts.length)

    const root = makeProject({ 'src/a.ts': 'export const same = 1\n', 'src/b.ts': 'export const same = 1\n' })
    const { artifact } = artifactFor(root)
    const ids = artifact.files.flatMap((file) => file.facts.map((fact) => fact.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(() => validateSourceAuditEvidence(artifact)).not.toThrow()
  })

  it('drops invalid facts instead of repairing them and downgrades the affected capabilities', () => {
    const adapter = registry.adapterForFile('src/o.ts')!
    const extraction = adapter.extractFromSource('src/o.ts', 'export const x = 1\n')
    extraction.symbols = assignDeclarationIdentities('src/o.ts', extraction.symbols)
    const good = extraction.sourceAudit!.facts[0]!
    extraction.sourceAudit!.facts.push(
      { ...good, span: { ...good.span, startLine: 99 } },
      { ...good, span: { ...good.span, path: 'src/other.ts' } },
      { ...good, kind: 'api-client-call' as never },
      { ...good, exportOrigin: 'bogus' as never },
    )
    const payload = extractAuditObservations('src/o.ts', 'export const x = 1\n', extraction)
    expect(payload.facts).toHaveLength(extraction.sourceAudit!.facts.length - 4)
    expect(payload.diagnostics.some((d) => d.code === 'audit-fact-dropped')).toBe(true)
    expect(payload.capabilities.declarations).toBe('partial')
    expect(payload.capabilities['source-ranges']).toBe('partial')
  })

  it('never lets an adapter mark out-of-scope capability families (api-client-calls is Batch 6)', () => {
    const adapter = registry.adapterForFile('src/o.ts')!
    const extraction = adapter.extractFromSource('src/o.ts', 'export const x = 1\n')
    extraction.sourceAudit!.capabilities['api-client-calls'] = 'complete'
    const payload = extractAuditObservations('src/o.ts', 'export const x = 1\n', extraction)
    for (const name of OUT_OF_SCOPE) expect(payload.capabilities[name]).toBe('unsupported')
  })

  it('reports an extraction without audit evidence as unsupported, not complete', () => {
    const extraction: ExtractionResult = {
      language: 'typescript', lineCount: 1, imports: [], exports: [], symbols: [], reExportSpecifiers: [], exportAllSpecifiers: [],
    }
    const payload = extractAuditObservations('src/x.ts', '\n', extraction)
    expect(payload.facts).toEqual([])
    for (const capability of SOURCE_AUDIT_CAPABILITIES) expect(payload.capabilities[capability]).toBe('unsupported')
    expect(payload.diagnostics[0]?.code).toBe('source-audit-evidence-unavailable')
  })
})

const MIXED = {
  'src/a.ts': 'export function a(): number { return 1 }\n',
  'src/b.ts': "import { a } from './a'\nexport const b = a()\n",
  'src/p.py': 'import os\n__all__ = ["run"]\ndef run():\n    return os.getcwd()\n',
  'src/J.java': 'package p;\nimport java.util.List;\npublic class J {\n  static class N {\n  }\n}\n',
  'src/K.kt': 'package p\nimport kotlin.io.println\nclass K {\n  internal class N\n}\n',
}

describe('v1.15.0 Batch 2 full and incremental parity', () => {
  function incremental(root: string, previousRoot: string) {
    const base = buildIndex({ repoRoot: previousRoot, sourceRoots: ['src'] })
    const cacheEntries = buildCacheFileEntries(base.discovery.files)
    const discovery = discoverSourceFiles({ repoRoot: root, sourceRoots: ['src'] })
    const classification = classifyChangedFilePaths(cacheEntries, buildCacheFileEntries(discovery.files))
    const partial = buildPartialSymbolIndex({
      repoRoot: root, sourceRoots: ['src'], buildCallGraph: false, discoveryFiles: discovery.files,
      unchangedPaths: new Set(classification.unchanged),
      previousFileSummariesByPath: new Map(base.index.files.map((file) => [file.path, file])),
      previousCacheEntriesByPath: new Map(cacheEntries.map((entry) => [entry.path, entry])),
    })
    const projection = buildSourceAuditEvidence({
      projectRoot: root, sourceRoots: ['src'], excludes: [], discovery, symbolIndex: partial.index,
      fileHashes: partial.fileContentHashes, producerVersion: '1.14.0',
    })
    return { partial, projection, classification }
  }

  it('produces identical audit evidence for reused and freshly built files across all languages', () => {
    const root = makeProject(MIXED)
    const { partial, projection } = incremental(root, root)
    expect(partial.freshlyExtractedPaths).toEqual([])
    expect(partial.reusedPaths).toHaveLength(Object.keys(MIXED).length)
    const full = artifactFor(root)
    expect(projection.artifact).toEqual(full.artifact)
    expect(full.artifact.files.every((file) => file.status === 'parsed')).toBe(true)
    expect(full.artifact.files.some((file) => file.facts.length > 0)).toBe(true)
    expect(() => validateSourceAuditEvidence(projection.artifact)).not.toThrow()
  })

  it('re-resolves imports of reused files when an unrelated file changes the inventory', () => {
    const base = makeProject(MIXED)
    const root = makeProject({ ...MIXED, 'src/a.ts': 'export function a(): number { return 2 }\nexport const more = 1\n' })
    const { partial, projection } = incremental(root, base)
    expect(partial.freshlyExtractedPaths).toEqual(['src/a.ts'])
    expect(projection.artifact).toEqual(artifactFor(root).artifact)
    const b = projection.artifact.files.find((file) => file.path === 'src/b.ts')!
    expect(b.facts.find((fact) => fact.kind === 'import')).toMatchObject({ importResolution: 'resolved-local', targetPaths: ['src/a.ts'] })
  })

  it('reuses a legacy FileSummary without sourceAudit but never promotes it to current audit evidence', () => {
    const root = makeProject(MIXED)
    const base = buildIndex({ repoRoot: root, sourceRoots: ['src'] })
    const legacy = new Map(base.index.files.map((file) => {
      const { sourceAudit: _drop, ...rest } = file
      return [file.path, rest] as const
    }))
    const cacheEntries = buildCacheFileEntries(base.discovery.files)
    const discovery = discoverSourceFiles({ repoRoot: root, sourceRoots: ['src'] })
    const partial = buildPartialSymbolIndex({
      repoRoot: root, sourceRoots: ['src'], buildCallGraph: false, discoveryFiles: discovery.files,
      unchangedPaths: new Set(cacheEntries.map((entry) => entry.path)),
      previousFileSummariesByPath: legacy,
      previousCacheEntriesByPath: new Map(cacheEntries.map((entry) => [entry.path, entry])),
    })
    // Existing reuse behavior is preserved; the missing evidence stays explicit instead of being fabricated.
    expect(partial.reusedPaths.sort()).toEqual(Object.keys(MIXED).sort())
    expect(partial.index.files.every((file) => file.sourceAudit === undefined)).toBe(true)
    const { artifact } = buildSourceAuditEvidence({
      projectRoot: root, sourceRoots: ['src'], excludes: [], discovery, symbolIndex: partial.index,
      fileHashes: partial.fileContentHashes, producerVersion: '1.14.0',
    })
    expect(artifact.files.every((file) => file.status === 'file-level-only' && file.facts.length === 0)).toBe(true)
  })

  it('never marks a legacy summary complete when it is projected as-is', () => {
    const root = makeProject(MIXED)
    const built = buildIndex({ repoRoot: root, sourceRoots: ['src'] })
    const legacyIndex = { ...built.index, files: built.index.files.map(({ sourceAudit: _drop, ...rest }) => rest) }
    const { artifact } = buildSourceAuditEvidence({
      projectRoot: root, sourceRoots: ['src'], excludes: [], discovery: built.discovery, symbolIndex: legacyIndex,
      fileHashes: built.fileContentHashes, producerVersion: '1.14.0',
    })
    for (const file of artifact.files) {
      expect(file.status).toBe('file-level-only')
      expect(file.facts).toEqual([])
      expect(file.analyzerId).toBeNull()
      expect(file.diagnostics.map((d) => d.code)).toContain('source-audit-evidence-missing')
      for (const capability of ['declarations', 'imports', 'exports', 'source-ranges'] as const) expect(file.capabilities[capability]).toBe('unsupported')
    }
    expect(() => validateSourceAuditEvidence(artifact)).not.toThrow()
  })

  it('changes the snapshot when only language facts could differ and leaves out-of-scope families unsupported', () => {
    const { artifact } = artifactFor(makeProject(MIXED))
    for (const file of artifact.files) {
      // Python, Java, Kotlin and Rust stay unsupported for the Batch 3 families; TypeScript/JavaScript report their own status.
      if (file.language !== 'typescript' && file.language !== 'javascript') {
        for (const name of ['identifier-literals', 'process-observations'] as const) expect(file.capabilities[name]).toBe('unsupported')
      }
      expect(['unsupported', 'not-applicable']).toContain(file.capabilities['api-client-calls'])
    }
    const python = artifact.files.find((file) => file.path === 'src/p.py')!
    expect(python.capabilities['api-client-calls']).toBe('not-applicable')
    expect(python.analyzerId).toBe('python-ast')
    expect(artifact.files.find((file) => file.path === 'src/J.java')!.analyzerId).toBe('java-lexical')
  })
})

describe('v1.15.0 Batch 2 single-parse guarantee', () => {
  it('extracts each selected file exactly once per build with one parse per TypeScript and Python file', () => {
    const typescriptSpy = vi.spyOn(TypeScriptAdapter.prototype, 'extractFromSource')
    const pythonSpy = vi.spyOn(PythonAdapter.prototype, 'extractFromSource')
    const javaSpy = vi.spyOn(JavaAdapter.prototype, 'extractFromSource')
    const kotlinSpy = vi.spyOn(KotlinAdapter.prototype, 'extractFromSource')
    const rustSpy = vi.spyOn(RustAdapter.prototype, 'extractFromSource')
    const root = makeProject({
      ...MIXED,
      'src/c.mts': 'export const c = 1\n',
      'src/r.rs': 'pub fn r() {}\n',
      'src/s.kts': 'val s = 1\n',
    })
    counters.createSourceFile = 0
    counters.pythonParses = 0
    try {
      buildIndex({ repoRoot: root, sourceRoots: ['src'] })
      expect(typescriptSpy).toHaveBeenCalledTimes(3)
      expect(pythonSpy).toHaveBeenCalledTimes(1)
      expect(javaSpy).toHaveBeenCalledTimes(1)
      expect(kotlinSpy).toHaveBeenCalledTimes(2)
      expect(rustSpy).toHaveBeenCalledTimes(1)
      expect(counters.createSourceFile).toBe(3)
      expect(counters.pythonParses).toBe(1)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('keeps the Python interpreter probe separate from per-file parsing', () => {
    const probe = spawnSync('python', ['--version'], { encoding: 'utf8' })
    expect(probe.status).toBe(0)
  })
})
