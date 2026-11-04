import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { readSourceAuditEvidence, SourceAuditEvidenceError } from '../../src/lookup/readSourceAuditEvidence.js'
import { resolveAuditImportTarget } from '../../src/lookup/resolveAuditImportTarget.js'
import { runCli } from './testCli.js'

const tempDirs: string[] = []
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

function makeProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v115-import-target-'))
  tempDirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), content)
  }
  return root
}
async function build(root: string, src: string[] = ['src'], exclude: string[] = []): Promise<string> {
  const out = join(root, 'out')
  await runIndexCommand({ root, src, out, ...(exclude.length ? { exclude } : {}) })
  return out
}
/** Fact id of the import in `file` whose specifier is `specifier`. */
function importId(out: string, file: string, specifier: string): string {
  const record = readSourceAuditEvidence(out).files.find((entry) => entry.path === file)
  const fact = record?.facts.find((candidate) => candidate.kind === 'import' && candidate.sourceSpecifier === specifier)
  if (!fact) throw new Error(`no import ${specifier} in ${file}`)
  return fact.id
}
function failure(action: () => unknown): SourceAuditEvidenceError {
  try {
    action()
  } catch (caught) {
    return caught as SourceAuditEvidenceError
  }
  throw new Error('expected an error')
}
/** Rewrites the stored artifact and re-pins its manifest hash so the identity check still passes. */
function rewriteArtifact(out: string, mutate: (artifact: any) => void): void {
  const artifactPath = join(out, 'source-audit-evidence.json')
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
  mutate(artifact)
  const text = JSON.stringify(artifact, null, 2) + '\n'
  writeFileSync(artifactPath, text)
  const manifestPath = join(out, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.sourceAuditEvidence.sha256 = createHash('sha256').update(text).digest('hex')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
}

const TS_FILES: Record<string, string> = {
  'src/a.ts': [
    "import { b } from './b'",
    "import { gone } from './gone'",
    "import lodash from 'lodash'",
    "import { o } from '../lib/o'",
    "import { amb } from './amb'",
    "import { v } from './vendor/v'",
    "import data from './data.json'",
    "import { up } from '../../../escape'",
    'export const lazy = () => import("./dyn")',
    'export const all = [b, gone, lodash, o, amb, v, data, up]',
  ].join('\n') + '\n',
  'src/b.ts': 'export const b = 1\n',
  'src/amb.ts': 'export const amb = 1\n',
  'src/amb/index.ts': 'export const amb = 2\n',
  'src/vendor/v.ts': 'export const v = 1\n',
  'lib/o.ts': 'export const o = 1\n',
}

describe('qualified JVM declaration-domain proofs', () => {
  it('proves arbitrary-filename and nested Java declarations and static owners without member binding', async () => {
    const root = makeProject({
      'src/Beta.java': 'package com.example;\npublic class Widget {\n public class Nested {}\n}\n',
      'src/Test.java': 'package com.example;\nimport com.example.Widget;\nimport com.example.Widget.Nested;\nimport com.example.Absent;\nimport static com.example.Widget.unverifiedMember;\nimport com.external.Unknown;\npublic class Test {}\n',
    })
    const out = await build(root)
    const proof = (name: string) => resolveAuditImportTarget(out, importId(out, 'src/Test.java', name))
    expect(proof('com.example.Widget')).toMatchObject({ status: 'present', candidatePaths: [], declarationProof: { scope: 'selected-ordinary-jvm-sources', matchingQualifiedNames: ['com.example.Widget'], matchingSourcePaths: ['src/Beta.java'] } })
    expect(proof('com.example.Widget.Nested')).toMatchObject({ status: 'present', declarationProof: { matchingQualifiedNames: ['com.example.Widget.Nested'] } })
    expect(proof('com.example.Widget.unverifiedMember')).toMatchObject({ status: 'present', declarationProof: { targetKind: 'java-static-owner', targetQualifiedName: 'com.example.Widget' } })
    expect(proof('com.example.Absent')).toMatchObject({ status: 'proven-missing', candidatePaths: [], declarationProof: { domainComplete: true, targetPackageName: 'com.example', matchingDeclarationFactIds: [], incompletenessReasons: [] } })
    expect(proof('com.example.Absent').declarationProof!.packageWitnessFactIds.length).toBeGreaterThan(0)
    expect(proof('com.external.Unknown').status).toBe('indeterminate')
    rewriteArtifact(out, artifact => { artifact.coverage.inventoryComplete = false })
    expect(proof('com.example.Absent')).toMatchObject({ status: 'indeterminate', declarationProof: { domainComplete: false } })
  })

  it('preserves duplicate Kotlin identities, top-level roles, nested owners and script uncertainty', async () => {
    const root = makeProject({
      'src/Alpha.kt': 'package com.example\nclass Widget {\n class Nested\n}\nfun topLevel() = 1\nval property = 1\nobject Singleton { companion object Holder {} }\n',
      'src/Beta.kt': 'package com.example\nclass Widget\n',
      'src/script.kts': 'class ScriptWidget\n',
      'src/Test.kt': 'package com.example\nimport com.example.Widget\nimport com.example.Widget.Nested\nimport com.example.topLevel\nimport com.example.property\nimport com.example.Singleton.Holder\nimport com.example.Absent\nimport com.example.ScriptWidget\nimport com.example.Widget as Alias\nclass Test\n',
    })
    const out = await build(root)
    const proof = (name: string) => resolveAuditImportTarget(out, importId(out, 'src/Test.kt', name))
    expect(proof('com.example.Widget').declarationProof?.matchingDeclarationFactIds).toHaveLength(2)
    for (const name of ['Widget.Nested', 'topLevel', 'property', 'Singleton.Holder']) expect(proof(`com.example.${name}`).status).toBe('present')
    expect(proof('com.example.Absent').status).toBe('proven-missing')
    expect(proof('com.example.ScriptWidget').status).toBe('proven-missing')
    const artifact = readSourceAuditEvidence(out)
    expect(artifact.files.find(file => file.path.endsWith('.kts'))?.capabilities.jvmDeclarations).toBe('unsupported')
    expect(artifact.files.find(file => file.path === 'src/Alpha.kt')?.facts.find(fact => fact.name === 'topLevel')?.jvmDeclaration?.role).toBe('kotlin-top-level-function')
    const alias = artifact.files.find(file => file.path === 'src/Test.kt')!.facts.filter(fact => fact.kind === 'import' && fact.sourceSpecifier === 'com.example.Widget').at(-1)!
    expect(resolveAuditImportTarget(out, alias.id)).toMatchObject({ status: 'indeterminate', declarationProof: { targetKind: 'unsupported' } })
  })

  it.each([
    ['src/Unknown.java', 'package invalid package;\nclass Unknown {}\n'],
    ['src/Partial.java', 'package com.example;\nclass Partial { class Hidden {} }\n'],
    ['src/Unsupported.kt', 'package com.example\ntypealias Alias = Missing\n'],
    ['src/Unicode.kt', 'package com.example\nclass Éligible\n'],
    ['src/Annotated.java', 'package com.example;\n@Deprecated class Hidden {}\n'],
    ['src/Annotated.kt', 'package com.example\n@Deprecated class Hidden\n'],
    ['src/Identifier.java', 'package com.example;\nclass Truncated$Name {}\n'],
  ])('never proves absence with incomplete eligible coverage: %s', async (file, source) => {
    const root = makeProject({ 'src/Test.java': 'package com.example;\nimport com.example.Absent;\nclass Test {}\n', [file]: source })
    const out = await build(root)
    expect(resolveAuditImportTarget(out, importId(out, 'src/Test.java', 'com.example.Absent')).status).toBe('indeterminate')
  })

  it('distinguishes known default package from unknown and rejects malformed closed JVM identities', async () => {
    const root = makeProject({ 'src/Default.java': 'class Default {}\n' })
    const out = await build(root)
    const artifact = readSourceAuditEvidence(out)
    expect(artifact.files[0]).toMatchObject({ jvmPackageName: '', capabilities: { jvmDeclarations: 'complete' } })
    expect(artifact.files[0]!.facts[0]!.jvmDeclaration).toMatchObject({ packageName: '', qualifiedName: 'Default' })
    rewriteArtifact(out, artifact => { artifact.files[0].facts[0].jvmDeclaration.role = 'invented' })
    expect(() => readSourceAuditEvidence(out)).toThrow()
  })
  it.each(['package', 'owner', 'role', 'extra', 'completeness', 'import-target'])('rejects malformed canonical JVM %s evidence', async (invalid) => {
    const out = await build(makeProject({ 'src/Outer.java': 'package com.example;\nimport com.example.Other;\nclass Outer {\n class Nested {}\n}\n' }))
    rewriteArtifact(out, artifact => {
      const file = artifact.files[0]
      const nested = file.facts.find((fact: any) => fact.name === 'Nested' && fact.kind === 'declaration')
      if (invalid === 'package') nested.jvmDeclaration.packageName = 'other'
      if (invalid === 'owner') nested.jvmDeclaration.qualifiedName = 'com.example.Other.Nested'
      if (invalid === 'role') nested.jvmDeclaration.role = 'kotlin-top-level-function'
      if (invalid === 'extra') nested.jvmDeclaration.extra = true
      if (invalid === 'completeness') delete nested.jvmDeclaration
      if (invalid === 'import-target') file.facts.find((fact: any) => fact.kind === 'import').jvmImportTarget.qualifiedName = 'com.example.Guessed'
    })
    expect(() => readSourceAuditEvidence(out)).toThrow()
  })
  it.each([
    ['src/Test.java', 'package com.example;\nimport com.example.*;\nclass Test {}\n', 'com.example.*'],
    ['src/Test.java', 'package com.example;\nimport static com.example.Test.*;\nclass Test {}\n', 'com.example.Test.*'],
    ['src/Test.kt', 'package com.example\nimport com.example.*\nclass Test\n', 'com.example.*'],
  ])('keeps unsupported wildcard syntax indeterminate: %s %s', async (file, source, specifier) => {
    const out = await build(makeProject({ [file]: source }))
    expect(resolveAuditImportTarget(out, importId(out, file, specifier))).toMatchObject({ status: 'indeterminate', declarationProof: { targetKind: 'unsupported', targetQualifiedName: null, domainComplete: false } })
  })
})

describe('v1.15.0 KIT-FACTS-01 import-target existence proof', () => {
  it('preserves the frozen Gate 4B peer.mjs counterexample as present', async () => {
    // Lab kitSourceReaderReplacement.test.ts: exact counterexample for ambiguous::test-rot.
    const root = makeProject({
      'src/peer.mjs': 'export const peer = 1;\n',
      'tests/check.test.ts': 'import "../src/peer";\n',
    })
    const out = await build(root, ['src', 'tests'])
    expect(resolveAuditImportTarget(out, importId(out, 'tests/check.test.ts', '../src/peer')))
      .toMatchObject({ status: 'present', reasonCode: 'TARGET_IN_SELECTED_INVENTORY' })
  })

  it.each([
    ['../src/peer.mjs', 'src/peer.mjs'],
    ['../src/peer.mjs', 'src/peer.mts'],
    ['../src/peer', 'src/peer.mjs'],
    ['../src/peer', 'src/peer/index.mjs'],
    ['../src/peer.cjs', 'src/peer.cts'],
    ['../src/peer.js', 'src/peer.ts'],
    ['../src/peer.jsx', 'src/peer.tsx'],
  ])('proves selected source existence for %s with %s', async (specifier, target) => {
    const root = makeProject({ [target]: 'export const peer = 1;\n', 'tests/check.test.ts': `import "${specifier}";\n` })
    const out = await build(root, ['src', 'tests'])
    const proof = resolveAuditImportTarget(out, importId(out, 'tests/check.test.ts', specifier))
    expect(proof).toMatchObject({ status: 'present', candidatePaths: [target], selectionComplete: true })
    expect(readSourceAuditEvidence(out).files.find(f => f.path === target)?.capabilities.imports).toBe('complete')
  })

  it('preserves all selected .mjs/.mts candidates without a unique-binding claim, deterministically', async () => {
    const root = makeProject({
      'src/peer.mjs': 'export const peer = 1;\n', 'src/peer.mts': 'export const peer = 2;\n',
      'tests/check.test.ts': 'import "../src/peer.mjs";\n',
    })
    const out = await build(root, ['src', 'tests'])
    const id = importId(out, 'tests/check.test.ts', '../src/peer.mjs')
    const first = readSourceAuditEvidence(out)
    const proof = resolveAuditImportTarget(out, id)
    expect(proof).toMatchObject({ status: 'present', reasonCode: 'MULTIPLE_TARGETS_IN_SELECTED_INVENTORY', candidatePaths: ['src/peer.mjs', 'src/peer.mts'] })
    expect(first.files.find(f => f.path === 'tests/check.test.ts')?.facts.find(f => f.id === id))
      .toMatchObject({ importResolution: 'ambiguous', targetPaths: ['src/peer.mjs', 'src/peer.mts'] })
    await build(root, ['src', 'tests'])
    expect(readSourceAuditEvidence(out).files).toEqual(first.files)
    expect(resolveAuditImportTarget(out, id)).toEqual(proof)
  })

  it('covers the frozen ambiguous fixture absence only with all sixteen eligible paths', async () => {
    const root = makeProject({
      'src/peer.js': 'export const peer = 1;\n', 'src/peer.ts': 'export const peer = 2;\n',
      'tests/check.sample.ts': '// @ts-nocheck -- intentionally unresolved audit input, never executed\nimport "../src/peer";\nimport "../src/absent";\n',
    })
    const out = await build(root, ['src', 'tests'])
    const proof = resolveAuditImportTarget(out, importId(out, 'tests/check.sample.ts', '../src/absent'))
    expect(proof.status).toBe('proven-missing')
    expect(proof.candidatePaths).toEqual(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']
      .flatMap(ext => ['src/absent' + ext, 'src/absent/index' + ext]).sort())
  })

  it.each(['../src/peer', '../src/peer.mjs'])('does not prove excluded .mjs absent for %s', async specifier => {
    const root = makeProject({ 'src/peer.mjs': 'export const peer = 1;\n', 'tests/check.test.ts': `import "${specifier}";\n` })
    const out = await build(root, ['src', 'tests'], ['src/peer.mjs'])
    expect(resolveAuditImportTarget(out, importId(out, 'tests/check.test.ts', specifier)))
      .toMatchObject({ status: 'indeterminate', reasonCode: 'CANDIDATE_EXISTS_BUT_NOT_SELECTED' })
    const outside = await build(root, ['tests'])
    expect(resolveAuditImportTarget(outside, importId(outside, 'tests/check.test.ts', specifier)).status).toBe('outside-selected-roots')
  })

  it('keeps unresolved configured targets indeterminate', async () => {
    const root = makeProject({
      'tsconfig.json': '{"extends":"./missing.json","compilerOptions":{"paths":{"@/*":["./src/*"]}}}',
      'src/main.ts': 'import "@/absent";\n',
    })
    const out = await build(root)
    expect(resolveAuditImportTarget(out, importId(out, 'src/main.ts', '@/absent')).status).toBe('indeterminate')
  })

  it('rejects .mjs candidate traversal and a directory symlink escape', async () => {
    const outside = makeProject({ 'peer.mjs': 'export const peer = 1;\n' })
    const root = makeProject({ 'src/main.ts': 'import "./link/peer.mjs";\nimport "../../../peer.mjs";\n' })
    symlinkSync(outside, join(root, 'src/link'), process.platform === 'win32' ? 'junction' : 'dir')
    const out = await build(root)
    for (const specifier of ['./link/peer.mjs', '../../../peer.mjs']) {
      expect(resolveAuditImportTarget(out, importId(out, 'src/main.ts', specifier)))
        .toMatchObject({ status: 'indeterminate', reasonCode: 'CANDIDATE_ESCAPES_PROJECT_ROOT' })
    }
  })

  it('reports present, proven-missing, outside-selected-roots, external, ambiguous and unsupported shapes', async () => {
    const root = makeProject(TS_FILES)
    const out = await build(root)
    const proofOf = (specifier: string) => resolveAuditImportTarget(out, importId(out, 'src/a.ts', specifier))

    expect(proofOf('./b')).toMatchObject({
      schemaVersion: '1.1.0', mode: 'audit-import-target', originFile: 'src/a.ts', sourceSpecifier: './b',
      status: 'present', selectionComplete: true, reasonCode: 'TARGET_IN_SELECTED_INVENTORY',
    })
    expect(proofOf('./b').candidatePaths).toContain('src/b.ts')

    const missing = proofOf('./gone')
    expect(missing).toMatchObject({ status: 'proven-missing', selectionComplete: true, reasonCode: 'ALL_CANDIDATES_ABSENT_IN_COMPLETE_SELECTION' })
    expect(missing.candidatePaths).toEqual([...missing.candidatePaths].sort())
    expect(missing.candidatePaths).toContain('src/gone.ts')
    expect(missing.candidatePaths).toContain('src/gone/index.tsx')

    expect(proofOf('../lib/o')).toMatchObject({ status: 'outside-selected-roots', reasonCode: 'CANDIDATE_OUTSIDE_SELECTED_ROOTS' })
    expect(proofOf('lodash')).toMatchObject({ status: 'indeterminate', reasonCode: 'EXTERNAL_OR_CONFIGURED_SPECIFIER', candidatePaths: [] })
    expect(proofOf('./data.json')).toMatchObject({ status: 'indeterminate', reasonCode: 'UNSUPPORTED_SPECIFIER_SHAPE' })
    // Ambiguity is still existence: both candidates are present, so it is never proven-missing.
    expect(proofOf('./amb')).toMatchObject({ status: 'present', reasonCode: 'MULTIPLE_TARGETS_IN_SELECTED_INVENTORY' })
    // A candidate path leaving the project root is neither followed nor listed.
    expect(proofOf('../../../escape')).toMatchObject({ status: 'indeterminate', reasonCode: 'CANDIDATE_ESCAPES_PROJECT_ROOT' })
    expect(proofOf('../../../escape').candidatePaths.every((p) => !p.startsWith('..'))).toBe(true)
  })

  it('does not turn an excluded-but-existing candidate into proven-missing', async () => {
    const root = makeProject(TS_FILES)
    const out = await build(root, ['src'], ['src/vendor'])
    const proof = resolveAuditImportTarget(out, importId(out, 'src/a.ts', './vendor/v'))
    expect(proof.status).toBe('indeterminate')
    expect(proof.reasonCode).toBe('CANDIDATE_EXISTS_BUT_NOT_SELECTED')
  })

  it('cannot prove absence for a subset of roots, and stays outside-selected-roots for a sibling root', async () => {
    const root = makeProject({ ...TS_FILES, 'lib/x.ts': "import { n } from './nope'\nexport const x = n\n" })
    const out = await build(root, ['src'])
    // Candidate lives under a root that was not selected.
    const outsideFact = importId(out, 'src/a.ts', '../lib/o')
    expect(resolveAuditImportTarget(out, outsideFact).status).toBe('outside-selected-roots')
    // The same module indexed with both roots is present.
    const both = join(root, 'out-both')
    await runIndexCommand({ root, src: ['src', 'lib'], out: both })
    expect(resolveAuditImportTarget(both, importId(both, 'src/a.ts', '../lib/o')).status).toBe('present')
    expect(resolveAuditImportTarget(both, importId(both, 'lib/x.ts', './nope')).status).toBe('proven-missing')
  })

  it('does not treat incomplete discovery as complete', async () => {
    const root = makeProject(TS_FILES)
    const out = await build(root)
    const id = importId(out, 'src/a.ts', './gone')
    rewriteArtifact(out, (artifact) => { artifact.coverage.inventoryComplete = false })
    expect(resolveAuditImportTarget(out, id)).toMatchObject({ status: 'indeterminate', selectionComplete: false, reasonCode: 'SELECTION_INCOMPLETE' })
    rewriteArtifact(out, (artifact) => { artifact.coverage.inventoryComplete = true; artifact.coverage.exclusionsAreExplicit = false })
    expect(resolveAuditImportTarget(out, id)).toMatchObject({ status: 'indeterminate', selectionComplete: false, reasonCode: 'SELECTION_INCOMPLETE' })
  })

  it('qualifies literal dynamic imports while rejecting unknown ids and non-import facts', async () => {
    const root = makeProject(TS_FILES)
    const out = await build(root)
    const record = readSourceAuditEvidence(out).files.find((entry) => entry.path === 'src/a.ts')!
    expect(record.facts.some((fact) => fact.sourceSpecifier === './dyn')).toBe(true)
    expect(record.capabilities.imports).toBe('complete')
    expect(resolveAuditImportTarget(out, importId(out, 'src/a.ts', './dyn')).status).toBe('proven-missing')
    expect(failure(() => resolveAuditImportTarget(out, 'import:does-not-exist')).code).toBe('AUDIT_FACT_NOT_FOUND')
    const declaration = record.facts.find((fact) => fact.kind !== 'import')!
    expect(failure(() => resolveAuditImportTarget(out, declaration.id)).code).toBe('AUDIT_FACT_NOT_IMPORT')
  })

  it('rejects a stale origin file and a vanished present target', async () => {
    const root = makeProject(TS_FILES)
    const out = await build(root)
    const missingId = importId(out, 'src/a.ts', './gone')
    const presentId = importId(out, 'src/a.ts', './b')
    writeFileSync(join(root, 'src/b.ts'), 'export const b = 2\n')
    expect(failure(() => resolveAuditImportTarget(out, presentId)).code).toBe('STALE_SOURCE_EVIDENCE')
    writeFileSync(join(root, 'src/b.ts'), 'export const b = 1\n')
    expect(resolveAuditImportTarget(out, presentId).status).toBe('present')
    writeFileSync(join(root, 'src/a.ts'), TS_FILES['src/a.ts'] + '// changed\n')
    expect(failure(() => resolveAuditImportTarget(out, missingId)).code).toBe('STALE_SOURCE_EVIDENCE')
  })

  it('rejects a tampered fact path traversal and a symlinked origin that escapes the root', async () => {
    const root = makeProject(TS_FILES)
    const out = await build(root)
    const id = importId(out, 'src/a.ts', './gone')
    rewriteArtifact(out, (artifact) => {
      const file = artifact.files.find((entry: any) => entry.path === 'src/a.ts')
      file.path = '../escape.ts'
      for (const fact of file.facts) fact.span.path = '../escape.ts'
    })
    expect(() => resolveAuditImportTarget(out, id)).toThrow()

    const escapeRoot = makeProject({ 'src/a.ts': "import { n } from './nope'\nexport const x = n\n" })
    const outside = makeProject({ 'real.ts': "import { n } from './nope'\nexport const x = n\n" })
    const escapeOut = await build(escapeRoot)
    const escapeId = importId(escapeOut, 'src/a.ts', './nope')
    rmSync(join(escapeRoot, 'src/a.ts'))
    try {
      symlinkSync(join(outside, 'real.ts'), join(escapeRoot, 'src/a.ts'), 'file')
    } catch {
      return // the platform refuses symlink creation; the traversal half above already ran
    }
    expect(failure(() => resolveAuditImportTarget(escapeOut, escapeId)).code).toMatch(/INVALID_AUDIT_PATH|STALE_SOURCE_EVIDENCE/)
  })

  it('measures Java and Kotlin source-set ambiguity and outside-root cases without claiming absence', async () => {
    const root = makeProject({
      'src/main/java/com/acme/Dup.java': 'package com.acme;\npublic class Dup {}\n',
      'src/test/java/com/acme/Dup.java': 'package com.acme;\npublic class Dup {}\n',
      'src/main/java/com/acme/Client.java': 'package com.acme;\nimport com.acme.Dup;\nimport com.other.Out;\nimport static com.acme.Dup.helper;\npublic class Client {}\n',
      'other/java/com/other/Out.java': 'package com.other;\npublic class Out {}\n',
      'src/main/kotlin/com/acme/Dupk.kt': 'package com.acme\nclass Dupk\n',
      'src/test/kotlin/com/acme/Dupk.kt': 'package com.acme\nclass Dupk\n',
      'src/main/kotlin/com/acme/Kc.kt': 'package com.acme\nimport com.acme.Dupk\nimport com.other.Outk\nclass Kc\n',
      'other/kotlin/com/other/Outk.kt': 'package com.other\nclass Outk\n',
    })
    const out = await build(root, ['src'])
    const proofs = {
      javaSourceSet: resolveAuditImportTarget(out, importId(out, 'src/main/java/com/acme/Client.java', 'com.acme.Dup')),
      javaOutsideRoot: resolveAuditImportTarget(out, importId(out, 'src/main/java/com/acme/Client.java', 'com.other.Out')),
      kotlinSourceSet: resolveAuditImportTarget(out, importId(out, 'src/main/kotlin/com/acme/Kc.kt', 'com.acme.Dupk')),
      kotlinOutsideRoot: resolveAuditImportTarget(out, importId(out, 'src/main/kotlin/com/acme/Kc.kt', 'com.other.Outk')),
    }
    // Every qualified duplicate is preserved; unobserved package namespaces remain indeterminate.
    for (const proof of [proofs.javaSourceSet, proofs.kotlinSourceSet]) expect(['present', 'indeterminate']).toContain(proof.status)
    for (const proof of [proofs.javaOutsideRoot, proofs.kotlinOutsideRoot]) {
      expect(proof).toMatchObject({ status: 'indeterminate', reasonCode: 'JVM_DECLARATION_DOMAIN_INCOMPLETE', candidatePaths: [] })
    }
    expect(Object.values(proofs).some((proof) => proof.status === 'proven-missing')).toBe(false)
    // Declaration mode reports every selected definition rather than the legacy resolver's single file.
    expect(proofs.javaSourceSet.declarationProof?.matchingSourcePaths).toEqual(['src/main/java/com/acme/Dup.java', 'src/test/java/com/acme/Dup.java'])
    // Presence is not unique compiler binding, and no filesystem candidate is fabricated.
    expect(proofs.javaSourceSet).toMatchObject({ status: 'present', reasonCode: 'QUALIFIED_DECLARATION_MATCH' })
    expect(proofs.kotlinSourceSet).toMatchObject({ status: 'present', reasonCode: 'QUALIFIED_DECLARATION_MATCH' })
    expect(proofs.kotlinSourceSet.declarationProof?.matchingSourcePaths).toEqual(['src/main/kotlin/com/acme/Dupk.kt', 'src/test/kotlin/com/acme/Dupk.kt'])
  })

  it('is read-only and returns a stable identity across repeated runs', async () => {
    const root = makeProject(TS_FILES)
    const out = await build(root)
    const id = importId(out, 'src/a.ts', './gone')
    const before = readFileSync(join(out, 'source-audit-evidence.json'), 'utf8')
    const first = JSON.stringify(resolveAuditImportTarget(out, id))
    const second = JSON.stringify(resolveAuditImportTarget(out, id))
    expect(second).toBe(first)
    expect(readFileSync(join(out, 'source-audit-evidence.json'), 'utf8')).toBe(before)
    expect(JSON.parse(first).snapshotId).toBe(readSourceAuditEvidence(out).source.snapshotId)
  })

  it('handles Python relative imports where candidates are enumerable', async () => {
    const root = makeProject({
      'src/pkg/__init__.py': '',
      'src/pkg/main.py': 'from . import helper\nfrom .util import thing\nfrom .absent import nothing\nimport os\nimport pkg.util\nfrom ... import toohigh\n',
      'src/pkg/util.py': 'thing = 1\n',
    })
    const out = await build(root)
    const proofOf = (specifier: string) => resolveAuditImportTarget(out, importId(out, 'src/pkg/main.py', specifier))
    expect(proofOf('.util')).toMatchObject({ status: 'present', reasonCode: 'TARGET_IN_SELECTED_INVENTORY' })
    expect(proofOf('.absent')).toMatchObject({ status: 'proven-missing', candidatePaths: ['src/pkg/absent.py', 'src/pkg/absent/__init__.py'] })
    expect(proofOf('os')).toMatchObject({ status: 'indeterminate', reasonCode: 'PYTHON_CANDIDATES_NOT_ENUMERABLE' })
    // `from . import helper` may name an attribute of the package __init__, so absence is never proven.
    expect(proofOf('.').status).toBe('indeterminate')
  })

  it('qualifies targets of literal nested imports without turning incomplete selection into absence', async () => {
    const root = makeProject({
      'src/main.ts': "function load() { require('./present.mjs'); return import('./missing.mjs') }\n",
      'src/present.mjs': 'export const value = 1\n',
    })
    const out = await build(root)
    expect(resolveAuditImportTarget(out, importId(out, 'src/main.ts', './present.mjs')).status).toBe('present')
    const missing = importId(out, 'src/main.ts', './missing.mjs')
    expect(resolveAuditImportTarget(out, missing).status).toBe('proven-missing')
    rewriteArtifact(out, artifact => { artifact.coverage.inventoryComplete = false })
    expect(resolveAuditImportTarget(out, missing)).toMatchObject({ status: 'indeterminate', selectionComplete: false })
  })

  it('keeps the domain indeterminate when an inline nested declaration cannot be completely qualified', async () => {
    const root = makeProject({
      'src/main/java/com/acme/Util.java': 'package com.acme;\npublic class Util { public static class Inner {} }\n',
      'src/main/java/com/acme/App.java': 'package com.acme;\nimport com.acme.Util;\nimport com.acme.Util.Inner;\nimport com.acme.Missing;\nimport java.util.List;\npublic class App {}\n',
      'src/main/kotlin/com/acme/Tool.kt': 'package com.acme\nclass Tool\n',
      'src/main/kotlin/com/acme/Use.kt': 'package com.acme\nimport com.acme.Tool\nimport com.acme.Absent\nimport kotlin.collections.List\nclass Use\n',
    })
    const out = await build(root)
    const java = (specifier: string) => resolveAuditImportTarget(out, importId(out, 'src/main/java/com/acme/App.java', specifier))
    const kotlin = (specifier: string) => resolveAuditImportTarget(out, importId(out, 'src/main/kotlin/com/acme/Use.kt', specifier))
    expect(java('com.acme.Util').status).toBe('indeterminate')
    expect(kotlin('com.acme.Tool').status).toBe('indeterminate')
    for (const proof of [java('com.acme.Missing'), java('java.util.List'), kotlin('com.acme.Absent'), kotlin('kotlin.collections.List')]) {
      expect(proof).toMatchObject({ status: 'indeterminate', reasonCode: 'JVM_DECLARATION_DOMAIN_INCOMPLETE', candidatePaths: [] })
    }
    // Nested declaration import: whatever the resolver reports, it is never proven-missing.
    expect(java('com.acme.Util.Inner').status).not.toBe('proven-missing')
  })

  it('is exposed through lookup --audit-import-target and mutually exclusive with other selectors', async () => {
    const root = makeProject(TS_FILES)
    const out = await build(root)
    const id = importId(out, 'src/a.ts', './gone')
    const ok = runCli(['lookup', '--index', out, '--audit-import-target', id, '--json'])
    expect(ok.status).toBe(0)
    expect(JSON.parse(ok.stdout)).toMatchObject({ mode: 'audit-import-target', status: 'proven-missing', importFactId: id })
    for (const extra of [['--audit-files'], ['--audit-file', 'src/a.ts'], ['--node', 'x'], ['--page', '0']]) {
      const bad = runCli(['lookup', '--index', out, '--audit-import-target', id, '--json', ...extra])
      expect(bad.status).not.toBe(0)
    }
    expect(runCli(['lookup', '--index', out, '--audit-import-target', id]).status).not.toBe(0)
    const unknown = runCli(['lookup', '--index', out, '--audit-import-target', 'nope', '--json'])
    expect(unknown.status).toBe(2)
    expect(unknown.stderr).toContain('AUDIT_FACT_NOT_FOUND')
  }, 60_000)
})
