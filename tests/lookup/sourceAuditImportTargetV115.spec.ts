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
      schemaVersion: '1.0.0', mode: 'audit-import-target', originFile: 'src/a.ts', sourceSpecifier: './b',
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

  it('rejects dynamic imports, unknown ids and non-import facts', async () => {
    const root = makeProject(TS_FILES)
    const out = await build(root)
    const record = readSourceAuditEvidence(out).files.find((entry) => entry.path === 'src/a.ts')!
    // import("./dyn") is not enumerated as a static import fact; the file reports it as partial imports.
    expect(record.facts.some((fact) => fact.sourceSpecifier === './dyn')).toBe(false)
    expect(record.capabilities.imports).toBe('partial')
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
    // Duplicated source-set classes are decided by the existing resolvers; existence is never reported missing, and a
    // class under an unselected root is indeterminate because the JVM resolvers cannot enumerate candidates.
    for (const proof of [proofs.javaSourceSet, proofs.kotlinSourceSet]) expect(['present', 'indeterminate']).toContain(proof.status)
    for (const proof of [proofs.javaOutsideRoot, proofs.kotlinOutsideRoot]) {
      expect(proof).toMatchObject({ status: 'indeterminate', reasonCode: 'JVM_CANDIDATES_NOT_ENUMERABLE', candidatePaths: [] })
    }
    expect(Object.values(proofs).some((proof) => proof.status === 'proven-missing')).toBe(false)
    // Measured: both resolvers pick one existing source-set file when two define the class, so source-set ambiguity is not surfaced.
    expect(proofs.javaSourceSet.candidatePaths).toEqual(['src/main/java/com/acme/Dup.java'])
    // Existence proof is not unique target identity: `present` only establishes that at least one eligible candidate exists.
    // src/test also defines the class, yet candidatePaths lists only the resolver's single choice (it may be incomplete for JVM).
    expect(proofs.javaSourceSet).toMatchObject({ status: 'present', reasonCode: 'TARGET_IN_SELECTED_INVENTORY' })
    expect(proofs.kotlinSourceSet).toMatchObject({ status: 'present', reasonCode: 'TARGET_IN_SELECTED_INVENTORY' })
    expect(proofs.kotlinSourceSet.candidatePaths).toEqual(['src/main/kotlin/com/acme/Dupk.kt'])
    expect(proofs.javaSourceSet.candidatePaths).not.toContain('src/test/java/com/acme/Dup.java')
    expect(proofs.kotlinSourceSet.candidatePaths).not.toContain('src/test/kotlin/com/acme/Dupk.kt')
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

  it('keeps Java and Kotlin source-set and nested cases indeterminate unless a selected file resolves', async () => {
    const root = makeProject({
      'src/main/java/com/acme/Util.java': 'package com.acme;\npublic class Util { public static class Inner {} }\n',
      'src/main/java/com/acme/App.java': 'package com.acme;\nimport com.acme.Util;\nimport com.acme.Util.Inner;\nimport com.acme.Missing;\nimport java.util.List;\npublic class App {}\n',
      'src/main/kotlin/com/acme/Tool.kt': 'package com.acme\nclass Tool\n',
      'src/main/kotlin/com/acme/Use.kt': 'package com.acme\nimport com.acme.Tool\nimport com.acme.Absent\nimport kotlin.collections.List\nclass Use\n',
    })
    const out = await build(root)
    const java = (specifier: string) => resolveAuditImportTarget(out, importId(out, 'src/main/java/com/acme/App.java', specifier))
    const kotlin = (specifier: string) => resolveAuditImportTarget(out, importId(out, 'src/main/kotlin/com/acme/Use.kt', specifier))
    expect(java('com.acme.Util').status).toBe('present')
    expect(kotlin('com.acme.Tool').status).toBe('present')
    for (const proof of [java('com.acme.Missing'), java('java.util.List'), kotlin('com.acme.Absent'), kotlin('kotlin.collections.List')]) {
      expect(proof).toMatchObject({ status: 'indeterminate', reasonCode: 'JVM_CANDIDATES_NOT_ENUMERABLE', candidatePaths: [] })
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
