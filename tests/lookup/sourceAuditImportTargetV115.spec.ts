import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { readSourceAuditEvidence, SourceAuditEvidenceError } from '../../src/lookup/readSourceAuditEvidence.js'
import { isBoundedReferenceSpecifier, ReferencePremises, resolveAuditImportTarget } from '../../src/lookup/resolveAuditImportTarget.js'
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
async function build(root: string, src: string[] = ['src'], exclude: string[] = [], sourceAuditSchema?: '1.2.0'): Promise<string> {
  const out = join(root, 'out')
  await runIndexCommand({ root, src, out, sourceAuditSchema, ...(exclude.length ? { exclude } : {}) })
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

const rawHash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex')
const extensions = ['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']
const directAndIndex = (base: string) => extensions.flatMap(ext => [base + ext, base + '/index' + ext]).sort()
const ordinary = 'src/main.ts'
const selectedSource = 'export const value = 1\n'
const extended = (root: string, exclude: string[] = []) => build(root, ['src'], exclude, '1.2.0')
const selectedReference = (targetPath: string) => ({
  targetPath, targetContentSha256: rawHash(selectedSource), referenceKind: 'selected-source-reference',
})
const inspect = (out: string, specifier: string) => resolveAuditImportTarget(out, importId(out, ordinary, specifier))
const unknown = (proof: ReturnType<typeof inspect>) => {
  expect(proof.sourceReferenceProof).toMatchObject({
    candidateEnumerationComplete: false, candidateDomain: null, qualifiedReference: null, reasonCode: expect.stringMatching(/^[A-Z_]+$/),
  })
}

const nodeNextOptions = {
  target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', rootDir: '.', outDir: 'dist',
  strict: true, esModuleInterop: true, forceConsistentCasingInFileNames: true, skipLibCheck: true,
  resolveJsonModule: true, types: ['node', 'vitest/globals'],
}
const modulePackage = '{"type":"module"}\r\n'
const nodeNextConfig = JSON.stringify({ compilerOptions: nodeNextOptions })

describe('bounded NodeNext ordinary references', () => {
  it.each([
    ['Lab', nodeNextOptions, ['src/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.ts', 'benchmarks/**/*.ts']],
    ['Kit', { ...nodeNextOptions, lib: ['ES2022'] }, ['src/**/*.ts', 'tests/**/*.ts', 'tsup.config.ts', 'vitest.config.ts']],
  ] as const)('qualifies the %s configuration and immediate re-export from authenticated bytes', async (_owner, compilerOptions, include) => {
    const config = JSON.stringify({ compilerOptions, include }, null, 2)
    const root = makeProject({
      'package.json': modulePackage, 'tsconfig.json': config,
      [ordinary]: 'import { value } from "./sub/peer.js"\nexport { value as forwarded } from "./sub/peer.js"\n',
      'src/sub/peer.ts': selectedSource,
    })
    const out = await extended(root)
    const origin = readSourceAuditEvidence(out).files.find(entry => entry.path === ordinary)!
    const facts = origin.facts.filter(fact => fact.sourceSpecifier === './sub/peer.js')
    expect(facts.map(fact => fact.kind)).toEqual(['import', 'export'])
    for (const fact of facts) {
      const result = resolveAuditImportTarget(out, fact.id).sourceReferenceProof!
      expect(result).toMatchObject({
        profile: 'js-ts-selected-source-reference-v1', candidateEnumerationComplete: true,
        candidateDomain: ['src/sub/peer.js', 'src/sub/peer.jsx', 'src/sub/peer.ts', 'src/sub/peer.tsx'],
        qualifiedReference: selectedReference('src/sub/peer.ts'), reasonCode: null,
      })
      expect(result.premiseRefs).toEqual(expect.arrayContaining([
        { role: 'config', path: 'tsconfig.json', state: 'file', contentSha256: rawHash(config) },
        { role: 'config', path: 'src/jsconfig.json', state: 'absent', contentSha256: null },
        { role: 'config', path: 'src/tsconfig.json', state: 'absent', contentSha256: null },
        { role: 'package-metadata', path: 'package.json', state: 'file', contentSha256: rawHash(modulePackage) },
        { role: 'package-metadata', path: 'src/package.json', state: 'absent', contentSha256: null },
        { role: 'package-metadata', path: 'src/sub/package.json', state: 'absent', contentSha256: null },
      ]))
    }
  })

  it('admits explicit suffix families and absence under relative inheritance and a paired effective override', async () => {
    const base = '{/* defaults */"compilerOptions":{"module":"Node16","types":["node"]}}\r\n'
    const root = makeProject({
      'tsconfig.json': '{"extends":"./cfg/base","compilerOptions":{"module":"NodeNext"}}',
      'cfg/base.json': base,
      'src/main.mts': ['view.jsx', 'esm.mjs', 'cjs.cjs', 'absent.js'].map(name => `import "./${name}"\n`).join(''),
      'src/view.tsx': selectedSource, 'src/esm.mts': selectedSource, 'src/cjs.cts': selectedSource,
    })
    const out = await extended(root)
    const read = (specifier: string) => resolveAuditImportTarget(out, importId(out, 'src/main.mts', specifier)).sourceReferenceProof!
    for (const [specifier, target, candidates] of [
      ['./view.jsx', 'src/view.tsx', ['src/view.js', 'src/view.jsx', 'src/view.ts', 'src/view.tsx']],
      ['./esm.mjs', 'src/esm.mts', ['src/esm.mjs', 'src/esm.mts']],
      ['./cjs.cjs', 'src/cjs.cts', ['src/cjs.cjs', 'src/cjs.cts']],
    ] as const) {
      expect(read(specifier)).toMatchObject({
        candidateDomain: candidates, candidateEnumerationComplete: true, qualifiedReference: selectedReference(target),
      })
    }
    expect(read('./absent.js')).toMatchObject({
      candidateEnumerationComplete: true, qualifiedReference: null, reasonCode: null,
    })
    expect(read('./absent.js').premiseRefs).toEqual(expect.arrayContaining([
      { role: 'config', path: 'cfg/base.json', state: 'file', contentSha256: rawHash(base) },
      { role: 'config', path: 'cfg/base', state: 'absent', contentSha256: null },
      { role: 'package-metadata', path: 'package.json', state: 'absent', contentSha256: null },
    ]))
    writeFileSync(join(root, 'cfg/base.json'), '{"compilerOptions":{"moduleResolution":"Node16"}}')
    expect(read('./esm.mjs').reasonCode).toBe('UNQUALIFIED_CONFIGURATION_OR_MAPPING')
  })

  it('conservatively handles incompatible config and fresh, incompatible or ambiguous package changes', async () => {
    const root = makeProject({
      [ordinary]: 'import "./nested/peer.js"\n', 'src/nested/peer.ts': selectedSource,
      'package.json': modulePackage, 'tsconfig.json': nodeNextConfig,
    })
    const out = await extended(root)
    const read = () => inspect(out, './nested/peer.js')
    const editedPackage = '{"type":"module","name":"edited"}'
    expect(read().sourceReferenceProof?.qualifiedReference).toEqual(selectedReference('src/nested/peer.ts'))
    writeFileSync(join(root, 'package.json'), editedPackage)
    expect(read().sourceReferenceProof?.premiseRefs).toContainEqual({
      role: 'package-metadata', path: 'package.json', state: 'file', contentSha256: rawHash(editedPackage),
    })
    for (const other of ['{}', '{"type":"commonjs"}', '{"type":"esnext"}', '{"type":"commonjs","type":"module"}', '{']) {
      writeFileSync(join(root, 'src/package.json'), other)
      unknown(read())
    }
    rmSync(join(root, 'src/package.json'))
    writeFileSync(join(root, 'src/nested/package.json'), modulePackage)
    expect(read().sourceReferenceProof?.reasonCode).toBe('UNQUALIFIED_NODENEXT_PACKAGE_BOUNDARY')
    rmSync(join(root, 'src/nested/package.json'))
    for (const overrides of [
      { module: 'ESNext' }, { module: 'Node18' }, { moduleResolution: 'Bundler' },
      { module: 'Node16', moduleResolution: 'Node16' }, { moduleResolution: 'Node10' },
      { moduleResolution: 'invalid' }, { rootDirs: ['src', 'other'] }, { customConditions: ['custom'] },
      { moduleSuffixes: ['.native', ''] }, { paths: { alias: ['./src/nested/peer.ts'] } },
    ]) {
      writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { ...nodeNextOptions, ...overrides } }))
      expect(read().sourceReferenceProof?.reasonCode).toBe('UNQUALIFIED_CONFIGURATION_OR_MAPPING')
    }
  })

  it('withholds positives for unsupported specifiers, require modes and unqualified candidates', async () => {
    const root = makeProject({
      'tsconfig.json': nodeNextConfig, 'package.json': modulePackage,
      [ordinary]: [
        'import "./peer"', 'import "./dir.js"', 'import "./multi.js"', 'import "./excluded.js"',
        'import "./declared.js"', 'import "./alias.d.js"', 'import "outside-package"', 'import "../../escape.js"',
        'import legacy = require("./peer.js")', 'require("./require-me.js")',
        'import type { T } from "./typed.js" with { "resolution-mode": "require" }',
        'export type { T } from "./reexport.js" with { "resolution-mode": "require" }',
        'const modulePath = "./computed.js"; void import(modulePath)', 'import "./link/peer.js"',
      ].join('\n'),
      'src/peer.ts': selectedSource, 'src/dir.js/index.ts': selectedSource, 'src/multi.ts': selectedSource,
      'src/multi.jsx': selectedSource, 'src/excluded.js': selectedSource, 'src/excluded.ts': selectedSource,
      'src/declared.d.ts': 'export declare const value: number', 'src/alias.d.ts': 'export {}',
      'src/require-me.ts': selectedSource, 'src/typed.ts': 'export type T = string',
      'src/reexport.ts': 'export type T = string', 'src/computed.ts': selectedSource,
    })
    const out = await extended(root, ['src/excluded.js'])
    symlinkSync(realpathSync(join(root, 'src')), join(root, 'src/link'), process.platform === 'win32' ? 'junction' : 'dir')
    for (const specifier of ['./peer', './dir.js', './excluded.js', './declared.js', './alias.d.js', 'outside-package',
      '../../escape.js', './peer.js', './require-me.js', './typed.js', './computed.js', './link/peer.js']) unknown(inspect(out, specifier))
    const reexport = readSourceAuditEvidence(out).files.find(entry => entry.path === ordinary)!.facts
      .find(fact => fact.sourceSpecifier === './reexport.js')!
    unknown(resolveAuditImportTarget(out, reexport.id))
    expect(inspect(out, './multi.js').sourceReferenceProof).toMatchObject({
      candidateEnumerationComplete: true, qualifiedReference: null, reasonCode: null,
    })
  })
})

describe('ordinary selected-source reference extension', () => {
  it('qualifies Bundler source references with indexed-access checking and ambient type inclusion', async () => {
    const root = makeProject({
      [ordinary]: 'import "./peer"\n', 'src/peer.ts': selectedSource,
      'tsconfig.json': '{"compilerOptions":{"module":"esnext","moduleResolution":"bundler"}}',
    })
    const out = await extended(root)
    const lookup = () => inspect(out, './peer').sourceReferenceProof
    const config = join(root, 'tsconfig.json')
    const bundler = { module: 'esnext', moduleResolution: 'bundler' }
    for (const extra of [
      {}, { noUncheckedIndexedAccess: true }, { types: ['node'] }, { noUncheckedIndexedAccess: true, types: ['node'] },
    ]) {
      const text = JSON.stringify({ compilerOptions: { ...bundler, ...extra } })
      writeFileSync(config, text)
      const proof = lookup()
      expect(proof, JSON.stringify(extra)).toMatchObject({
        candidateEnumerationComplete: true, qualifiedReference: selectedReference('src/peer.ts'), reasonCode: null,
      })
      expect(proof?.premiseRefs).toContainEqual({
        role: 'config', path: 'tsconfig.json', state: 'file', contentSha256: rawHash(text),
      })
    }
    const typeOptions = { noUncheckedIndexedAccess: true, types: ['node'] }
    for (const unsupported of [
      { ...bundler, ...typeOptions, typeRoots: ['./ambient'] },
      { ...bundler, ...typeOptions, rootDirs: ['src', 'generated'] },
      { ...bundler, ...typeOptions, moduleSuffixes: ['.native', ''] },
      { ...bundler, ...typeOptions, noUncheckedIndexedAccess: 'true' },
      { ...bundler, ...typeOptions, types: 'node' },
      { ...typeOptions, module: 'commonjs', moduleResolution: 'node10' },
    ]) {
      writeFileSync(config, JSON.stringify({ compilerOptions: unsupported }))
      expect(lookup()).toMatchObject({
        candidateEnumerationComplete: false, qualifiedReference: null, reasonCode: 'UNQUALIFIED_CONFIGURATION_OR_MAPPING',
      })
    }
    writeFileSync(config, JSON.stringify({ compilerOptions: { ...bundler, ...typeOptions } }))
    writeFileSync(join(root, 'src/peer.jsx'), selectedSource)
    expect(lookup()).toMatchObject({
      candidateEnumerationComplete: false, qualifiedReference: null, reasonCode: 'UNQUALIFIED_CANDIDATE_STATE',
    })
  })

  it('qualifies bounded relative and configured references with effective Bundler options', async () => {
    const base = '{"compilerOptions":{"module":"commonjs","moduleResolution":"bundler","strict":true,"resolveJsonModule":true,"plugins":[{"name":"unused-language-service-plugin"}]}}\n'
    const config = '{"extends":"./config/base","compilerOptions":{"module":"preserve","paths":{"#no":["./missing"],"local":["./missing","./src/peer"],"lib/*":["./src/*"]}}}\n'
    const specifiers = ['./explicit.ts', './peer', './sub.js', './dir', 'local', 'lib/peer', './multi', './absent',
      'lib/absent', './metadata', './declared', './modern', './asset.json', './peer.d.ts']
    const origin = specifiers.map(name => `import '${name}'\n`).join('') + "export { value } from './forward'\n"
    const root = makeProject({
      [ordinary]: origin, 'config/base.json': base, 'tsconfig.json': config,
      'src/explicit.ts': selectedSource, 'src/peer.ts': selectedSource, 'src/sub.ts': selectedSource,
      'src/dir/index.ts': selectedSource, 'src/forward.ts': 'export const value = 1\n',
      'src/multi.ts': selectedSource, 'src/multi/index.js': selectedSource, 'src/metadata/index.ts': selectedSource,
      'src/metadata/package.json': '{}', 'src/declared.ts': selectedSource, 'src/declared.d.ts': 'export {}\n',
      'src/modern.mts': selectedSource, 'src/asset.json': '{}',
    })
    const out = await extended(root)
    for (const [specifier, target] of Object.entries({
      './explicit.ts': 'src/explicit.ts', './peer': 'src/peer.ts', './sub.js': 'src/sub.ts',
      './dir': 'src/dir/index.ts', './forward': 'src/forward.ts', local: 'src/peer.ts', 'lib/peer': 'src/peer.ts',
    })) {
      const factId = specifier === './forward'
        ? readSourceAuditEvidence(out).files.find(file => file.path === ordinary)!.facts.find(fact => fact.exportOrigin === 're-export')!.id
        : importId(out, ordinary, specifier)
      const proof = resolveAuditImportTarget(out, factId).sourceReferenceProof
      expect(proof).toMatchObject({
        profile: 'js-ts-selected-source-reference-v1', candidateEnumerationComplete: true, reasonCode: null,
        qualifiedReference: {
          targetPath: target, targetContentSha256: rawHash(readFileSync(join(root, target))), referenceKind: 'selected-source-reference',
        },
      })
      expect(proof?.premiseRefs).toEqual(expect.arrayContaining([
        { role: 'config', path: 'src/tsconfig.json', state: 'absent', contentSha256: null },
        { role: 'config', path: 'src/jsconfig.json', state: 'absent', contentSha256: null },
        { role: 'config', path: 'tsconfig.json', state: 'file', contentSha256: rawHash(config) },
        { role: 'config', path: 'config/base', state: 'absent', contentSha256: null },
        { role: 'config', path: 'config/base.json', state: 'file', contentSha256: rawHash(base) },
      ]))
    }
    expect(inspect(out, './peer').sourceReferenceProof?.candidateDomain).toEqual([
      'src/peer.js', 'src/peer.jsx', 'src/peer.ts', 'src/peer.tsx',
      'src/peer/index.js', 'src/peer/index.jsx', 'src/peer/index.ts', 'src/peer/index.tsx',
    ])
    expect(inspect(out, 'local').sourceReferenceProof?.premiseRefs).toContainEqual({
      role: 'candidate', path: 'missing.ts', state: 'absent', contentSha256: null,
    })
    for (const specifier of ['./multi', './absent']) {
      expect(inspect(out, specifier).sourceReferenceProof).toMatchObject({
        candidateEnumerationComplete: true, qualifiedReference: null, reasonCode: null,
      })
    }
    for (const [specifier, reasonCode] of Object.entries({
      'lib/absent': 'BARE_SPECIFIER_FALLBACK_UNKNOWN', './metadata': 'UNSUPPORTED_DIRECTORY_METADATA',
      './declared': 'DECLARATION_RESOLUTION_BLOCKER', './modern': 'UNSUPPORTED_CANDIDATE_SHAPE',
      './asset.json': 'UNSUPPORTED_CANDIDATE_SHAPE', './peer.d.ts': 'DECLARATION_RESOLUTION_BLOCKER',
    })) {
      expect(inspect(out, specifier).sourceReferenceProof).toMatchObject({
        candidateEnumerationComplete: false, candidateDomain: null, qualifiedReference: null, reasonCode,
      })
    }
  })

  it('rechecks Bundler configuration and every competing file before qualifying a reference', async () => {
    const config = '{"compilerOptions":{"target":"es2020","moduleResolution":"bundler"}}'
    const root = makeProject({ [ordinary]: 'import "./peer"\n', 'src/peer.ts': selectedSource, 'tsconfig.json': config })
    const out = await extended(root)
    const read = () => inspect(out, './peer').sourceReferenceProof
    expect(read()?.qualifiedReference).toEqual(selectedReference('src/peer.ts'))
    const incompatible = [
      '{"compilerOptions":{"module":"commonjs","moduleResolution":"bundler"}}',
      '{"compilerOptions":{"module":"nodenext","moduleResolution":"bundler"}}',
      '{"compilerOptions":{"moduleResolution":"bundler"}}',
      '{"compilerOptions":{"target":"es2020","moduleResolution":"bundler","rootDirs":["src","generated"]}}',
      '{"compilerOptions":{"target":"es2020","moduleResolution":"bundler","moduleSuffixes":[".native",""]}}',
      '{"compilerOptions":{"target":"es2020","moduleResolution":"bundler","customConditions":["alternate"]}}',
      '{"extends":"../outside.json"}',
      '{"compilerOptions": {',
    ]
    for (const text of incompatible) {
      writeFileSync(join(root, 'tsconfig.json'), text)
      expect(read()).toMatchObject({ qualifiedReference: null, reasonCode: 'UNQUALIFIED_CONFIGURATION_OR_MAPPING' })
    }
    writeFileSync(join(root, 'tsconfig.json'), config)
    writeFileSync(join(root, 'jsconfig.json'), '{}')
    expect(read()?.reasonCode).toBe('UNQUALIFIED_CONFIGURATION_OR_MAPPING')
    rmSync(join(root, 'jsconfig.json'))
    writeFileSync(join(root, 'src/tsconfig.json'), incompatible[0])
    expect(read()?.reasonCode).toBe('UNQUALIFIED_CONFIGURATION_OR_MAPPING')
    rmSync(join(root, 'src/tsconfig.json'))
    expect(read()?.qualifiedReference).toEqual(selectedReference('src/peer.ts'))
    writeFileSync(join(root, 'src/peer.jsx'), selectedSource)
    expect(read()?.reasonCode).toBe('UNQUALIFIED_CANDIDATE_STATE')
    const excluded = await build(root, ['src'], ['src/peer.jsx'], '1.2.0')
    expect(inspect(excluded, './peer').sourceReferenceProof?.reasonCode).toBe('UNQUALIFIED_CANDIDATE_STATE')
  })

  it('keeps the legacy envelope and emits the exact deterministic wire shape only for the explicit profile', async () => {
    const source = 'import "./peer.ts"\r\n'
    const root = makeProject({ [ordinary]: source, 'src/peer.ts': selectedSource })
    const old = inspect(await build(root), './peer.ts')
    expect(old).not.toHaveProperty('sourceReferenceProof')
    const out = await extended(root)
    const artifact = readSourceAuditEvidence(out)
    const { sourceReferenceProof, ...legacy } = inspect(out, './peer.ts')
    expect(legacy).toEqual({ ...old, snapshotId: artifact.source.snapshotId })
    expect(sourceReferenceProof).toEqual({
      schemaVersion: '1.0.0', profile: 'js-ts-selected-source-reference-v1', pathIdentityProfile: 'selected-source-path-v1',
      snapshotId: artifact.source.snapshotId, selectionFingerprint: artifact.source.selectionFingerprint,
      selectedDomainDigest: rawHash(JSON.stringify(['src/main.ts', 'src/peer.ts'])),
      originFile: ordinary, originContentSha256: rawHash(source), importFactId: legacy.importFactId, sourceSpecifier: './peer.ts',
      resolutionPlatform: process.platform === 'win32' ? 'win32' : 'posix',
      candidateEnumerationComplete: true, candidateDomain: ['src/peer.ts'],
      qualifiedReference: selectedReference('src/peer.ts'),
      premiseRefs: [
        { role: 'candidate', path: 'src/peer.ts', state: 'file', contentSha256: rawHash(selectedSource) },
        ...['jsconfig.json', 'src/jsconfig.json', 'src/tsconfig.json', 'tsconfig.json']
          .map(path => ({ role: 'config', path, state: 'absent', contentSha256: null })),
      ],
      reasonCode: null,
    })
    expect(inspect(out, './peer.ts').sourceReferenceProof).toEqual(sourceReferenceProof)
  })

  it('separates bounded multi-target, absent, directory-index and extension-substituted results', async () => {
    const root = makeProject({
      [ordinary]: ['multi', 'gone', 'dir', 'sub.mjs', 'plain', 'package-name'].map(name =>
        `import "${name === 'package-name' ? name : './' + name}"`).join('\n'),
      'src/multi.ts': selectedSource, 'src/multi/index.jsx': selectedSource,
      'src/dir/index.ts': selectedSource, 'src/sub.mts': selectedSource, 'src/plain': 'extensionless file',
    })
    const out = await extended(root)
    for (const name of ['multi', 'gone', 'dir']) {
      const proof = inspect(out, './' + name).sourceReferenceProof!
      expect(proof).toMatchObject({
        candidateEnumerationComplete: true, candidateDomain: directAndIndex('src/' + name), reasonCode: null,
        qualifiedReference: name === 'dir' ? selectedReference('src/dir/index.ts') : null,
      })
      expect(proof.premiseRefs.filter(ref => ref.role === 'candidate' && ref.state === 'file').map(ref => ref.path))
        .toEqual(name === 'dir' ? ['src/dir/index.ts'] : name === 'multi' ? ['src/multi.ts', 'src/multi/index.jsx'] : [])
    }
    expect(inspect(out, './dir').sourceReferenceProof!.premiseRefs).toEqual(expect.arrayContaining([
      { role: 'path', path: 'src/dir', state: 'directory', contentSha256: null },
      { role: 'path', path: 'src/dir/index.d.ts', state: 'absent', contentSha256: null },
      { role: 'package-metadata', path: 'src/dir/package.json', state: 'absent', contentSha256: null },
    ]))
    expect(inspect(out, './sub.mjs').sourceReferenceProof).toMatchObject({
      candidateDomain: ['src/sub.mjs', 'src/sub.mts'], qualifiedReference: selectedReference('src/sub.mts'),
    })
    unknown(inspect(out, './plain'))
    unknown(inspect(out, 'package-name'))
    writeFileSync(join(root, 'src/dir/package.json'), '{"main":"somewhere.js"}')
    expect(inspect(out, './dir').sourceReferenceProof?.reasonCode).toBe('UNSUPPORTED_DIRECTORY_METADATA')
    rmSync(join(root, 'src/dir/package.json'))
    writeFileSync(join(root, 'src/dir/index.d.ts'), 'export declare const value: string')
    expect(inspect(out, './dir').sourceReferenceProof?.reasonCode).toBe('DECLARATION_RESOLUTION_BLOCKER')
    rmSync(join(root, 'src/dir/index.d.ts'))
    writeFileSync(join(root, 'src/dir/index.json'), '{}')
    expect(inspect(out, './dir').sourceReferenceProof?.reasonCode).toBe('UNSUPPORTED_SOURCE_ENTRY')
    writeFileSync(join(root, 'src/gone.ts'), selectedSource)
    unknown(inspect(out, './gone'))
  })

  it('authenticates raw configuration and inherited bytes, ordered alias fallback and nearer-config absence', async () => {
    const parent = Buffer.from('\ufeff{/* comment */"compilerOptions":{"baseUrl":"..","paths":{"@/*":["missing/*","src/*"]},"strict":true}}\r\n')
    const root = makeProject({
      'tsconfig.json': '{"extends":"./cfg/base"}',
      'cfg/base.json': parent.toString(),
      [ordinary]: 'import "./peer"\nimport "@/peer"\n',
      'src/peer.ts': selectedSource,
    })
    const out = await extended(root)
    const alias = inspect(out, '@/peer')
    expect(inspect(out, './peer').sourceReferenceProof?.qualifiedReference).toEqual(selectedReference('src/peer.ts'))
    expect(alias.sourceReferenceProof).toMatchObject({
      candidateEnumerationComplete: true,
      candidateDomain: [...directAndIndex('missing/peer'), ...directAndIndex('src/peer')].sort(),
      qualifiedReference: selectedReference('src/peer.ts'),
    })
    expect(alias.sourceReferenceProof!.premiseRefs).toEqual(expect.arrayContaining([
      { role: 'config', path: 'cfg/base.json', state: 'file', contentSha256: rawHash(parent) },
      { role: 'config', path: 'cfg/base', state: 'absent', contentSha256: null },
      { role: 'config', path: 'src/tsconfig.json', state: 'absent', contentSha256: null },
    ]))
    const edited = Buffer.concat([parent, Buffer.from('\r\n')])
    writeFileSync(join(root, 'cfg/base.json'), edited)
    expect(inspect(out, '@/peer').sourceReferenceProof!.premiseRefs).toContainEqual({
      role: 'config', path: 'cfg/base.json', state: 'file', contentSha256: rawHash(edited),
    })
    mkdirSync(join(root, 'missing'))
    writeFileSync(join(root, 'missing/peer.ts'), selectedSource)
    unknown(inspect(out, '@/peer')) // an unselected earlier fallback may not be bypassed
    rmSync(join(root, 'missing/peer.ts'))
    writeFileSync(join(root, 'cfg/base.json'), '{"compilerOptions":{"rootDirs":["../src"]}}')
    unknown(inspect(out, '@/peer'))
    unknown(inspect(out, './peer'))
    writeFileSync(join(root, 'cfg/base.json'), parent)
    writeFileSync(join(root, 'src/tsconfig.json'), '{"compilerOptions":{"paths":{"@/*":["./gone"]}}}')
    unknown(inspect(out, '@/peer'))
    writeFileSync(join(root, 'src/jsconfig.json'), '{}')
    unknown(inspect(out, './peer'))
    rmSync(join(root, 'src/tsconfig.json'))
    rmSync(join(root, 'src/jsconfig.json'))
    writeFileSync(join(root, 'tsconfig.json'), '{"extends":"external-config"}')
    unknown(inspect(out, './peer'))
  })

  it('admits a baseUrl route and refuses ambiguous mappings and resolution-changing options', async () => {
    const root = makeProject({ [ordinary]: 'import "peer"\n', 'src/peer.ts': selectedSource, 'tsconfig.json': '{"compilerOptions":{"baseUrl":"./src"}}' })
    const out = await extended(root)
    expect(inspect(out, 'peer').sourceReferenceProof?.qualifiedReference).toEqual(selectedReference('src/peer.ts'))
    for (const compilerOptions of [
      { paths: { '*': ['./src/peer'], '*eer': ['./src/peer'] } },
      { baseUrl: './src', moduleSuffixes: ['.native', ''] },
      { baseUrl: './src', moduleResolution: 'nodenext' },
      { baseUrl: './src', customConditions: ['custom'] },
    ]) {
      writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions }))
      unknown(inspect(out, 'peer'))
    }
  })

  it('rejects excluded candidates, unsafe ancestors and noncanonical Windows spelling', async () => {
    const root = makeProject({
      [ordinary]: 'import "./peer.js"\nimport "./link/child"\nimport "../../../outside"\nimport "./PEER.ts"\n',
      'src/peer.ts': selectedSource, 'src/peer.js': selectedSource,
    })
    const outside = makeProject({ 'child.ts': selectedSource })
    symlinkSync(realpathSync(outside), join(root, 'src/link'), process.platform === 'win32' ? 'junction' : 'dir')
    const out = await extended(root, ['src/peer.js'])
    for (const specifier of ['./peer.js', './link/child', '../../../outside']) unknown(inspect(out, specifier))
    if (process.platform === 'win32') unknown(inspect(out, './PEER.ts'))
    rmSync(join(outside, 'child.ts'))
    rmdirSync(outside)
    unknown(inspect(out, './link/child')) // now dangling; still cannot prove the descendants absent
  })

  it('fails closed when ordered mapping candidates exceed the domain budget', async () => {
    const paths = { alias: [...Array.from({ length: 16 }, (_unused, i) => './missing/' + i), './src/peer'] }
    const root = makeProject({
      [ordinary]: 'import "alias"\n', 'src/peer.ts': selectedSource, 'tsconfig.json': JSON.stringify({ compilerOptions: { paths } }),
    })
    const proof = inspect(await extended(root), 'alias')
    expect(proof.sourceReferenceProof?.reasonCode).toBe('REFERENCE_CANDIDATE_BUDGET_EXCEEDED')
    unknown(proof)
  })

  it('bounds large serialized proof responses without truncating a complete array', async () => {
    // Large in UTF-8 without multiplying native path segments or Windows I/O.
    const deep = Array.from({ length: 8 }, () => '界'.repeat(75)).join('/')
    const paths = { alias: [...Array.from({ length: 15 }, (_unused, i) => './missing' + i + '/' + deep + '/peer'), './src/peer'] }
    const root = makeProject({ [ordinary]: 'import "alias"\n', 'src/peer.ts': selectedSource })
    const out = await extended(root)
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths } }))
    const proof = inspect(out, 'alias')
    expect(proof.sourceReferenceProof?.reasonCode).toBe('REFERENCE_RESPONSE_BUDGET_EXCEEDED')
    unknown(proof)
  })

  it('bounds configuration discovery premises and omits oversized specifiers', async () => {
    const root = makeProject({ [ordinary]: 'import "./peer.ts"\n', 'src/peer.ts': selectedSource })
    const proof = inspect(await extended(root), './peer.ts')
    expect(proof.sourceReferenceProof).toMatchObject({
      qualifiedReference: selectedReference('src/peer.ts'),
      premiseRefs: expect.arrayContaining([
        { role: 'config', path: 'src/tsconfig.json', state: 'absent', contentSha256: null },
      ]),
    })

    // Exercise the real collector with distinct, short config probes under an
    // absent ancestor. Native containment checks still run on every probe.
    const premises = new ReferencePremises(realpathSync.native(root))
    for (let i = 0; i < 1024; i++) premises.capture('config', `absent/d${i}/tsconfig.json`)
    expect(premises.recheck()).toHaveLength(1024)
    expect(() => premises.capture('config', 'absent/d0/tsconfig.json')).not.toThrow()
    expect(() => premises.capture('config', 'absent/d1024/tsconfig.json')).toThrow('REFERENCE_PREMISE_BUDGET_EXCEEDED')

    const atLimit = './' + 'é'.repeat(2047)
    expect(isBoundedReferenceSpecifier(atLimit)).toBe(true)
    expect(isBoundedReferenceSpecifier(atLimit + 'x')).toBe(false)
    const otherRoot = makeProject({ [ordinary]: `import "${atLimit}x"\n` })
    const artifact = readSourceAuditEvidence(await extended(otherRoot))
    expect(artifact.files[0]!.facts.find(fact => fact.sourceSpecifier === atLimit + 'x')).toBeUndefined()
    expect(artifact.files[0]!.capabilities.imports).toBe('partial')
  })

  it('partitions the extension away from Python and JVM proofs on schema 1.2.0', async () => {
    const root = makeProject({
      'src/pkg/__init__.py': '', 'src/pkg/main.py': 'from .peer import value\n', 'src/pkg/peer.py': 'value = 1\n',
      'src/q/Main.java': 'package q;\nimport p.Peer;\npublic class Main {}\n',
      'src/p/Peer.java': 'package p;\npublic class Peer {}\n',
    })
    const out = await extended(root)
    const artifact = readSourceAuditEvidence(out)
    for (const language of ['python', 'java']) {
      const fact = artifact.files.find(file => file.language === language && file.facts.some(fact => fact.kind === 'import'))!
        .facts.find(fact => fact.kind === 'import')!
      const proof = resolveAuditImportTarget(out, fact.id)
      expect(proof).not.toHaveProperty('sourceReferenceProof')
      if (language === 'java') expect(proof.declarationProof).toMatchObject({ scope: 'selected-ordinary-jvm-sources' })
    }
  })

  it.each(["export * from './peer.js'", "export * as ns from './peer.js'", "export { absent as alias } from './peer.js'"])(
    'qualifies the immediate re-export without inferring bindings: %s', async statement => {
      const root = makeProject({ [ordinary]: statement, 'src/peer.ts': selectedSource })
      const out = await extended(root)
      const fact = readSourceAuditEvidence(out).files.find(file => file.path === ordinary)!.facts.find(fact => fact.exportOrigin === 're-export')!
      expect(resolveAuditImportTarget(out, fact.id).sourceReferenceProof).toMatchObject({
        importFactId: fact.id, sourceSpecifier: './peer.js', qualifiedReference: selectedReference('src/peer.ts'),
      })
    },
  )
})

it('proves the selected immediate target of one constant import while retaining unknown alternatives', async () => {
  const origin = 'src/loader.ts'
  const source = 'const peer = "./peer.js"\nexport const load = () => import(peer)\nexport const other = (target: string) => import(target)\n'
  const root = makeProject({ [origin]: source, 'src/peer.ts': 'export const value = 1\n' })
  const out = await build(root)
  const artifact = readSourceAuditEvidence(out)
  const record = artifact.files.find(file => file.path === origin)!
  expect(record.capabilities.imports).toBe('partial')
  const imports = record.facts.filter(fact => fact.kind === 'import')
  expect(imports.map(fact => fact.sourceSpecifier)).toEqual(['./peer.js'])
  expect(resolveAuditImportTarget(out, imports[0]!.id)).toMatchObject({
    schemaVersion: '1.1.0', snapshotId: artifact.source.snapshotId,
    originFile: origin, status: 'present', candidatePaths: ['src/peer.ts'],
  })
  writeFileSync(join(root, origin), source.replace('./peer.js', './gone.js'))
  expect(failure(() => resolveAuditImportTarget(out, imports[0]!.id)).code).toBe('STALE_SOURCE_EVIDENCE')
})

describe('qualified immediate re-export target proofs', () => {
  it.each([
    "export { value } from './peer.js'",
    "export { value as alias } from './peer.js'",
    "export * from './peer.js'",
    "export * as namespace from './peer.js'",
  ])('reuses selected target authority for %s without claiming binding', async statement => {
    const out = await build(makeProject({ 'src/barrel.ts': statement, 'src/peer.ts': 'export const value = 1\n' }))
    const artifact = readSourceAuditEvidence(out)
    const fact = artifact.files.find(f => f.path === 'src/barrel.ts')!.facts.find(f => f.kind === 'export' && f.sourceSpecifier)!
    const proof = resolveAuditImportTarget(out, fact.id)
    expect(proof).toMatchObject({ mode: 'audit-import-target', schemaVersion: '1.1.0', importFactId: fact.id,
      snapshotId: artifact.source.snapshotId, status: 'present', candidatePaths: ['src/peer.ts'] })
    expect(proof.declarationProof).toBeUndefined()
    const native = runCli(['lookup', '--index', out, '--audit-import-target', fact.id, '--json'])
    expect(native.status).toBe(0)
    expect(JSON.parse(native.stdout)).toEqual(proof)
  })

  it('preserves chains, cycles, external, unselected and unresolved target boundaries', async () => {
    const out = await build(makeProject({
      'src/a.ts': "export * from './b.js'\nexport * from 'external'\nexport * from '../lib/out.js'\nexport * from './absent.js'\nexport const direct = 1\n",
      'src/b.ts': "export * from './a.js'\nexport * from './c.js'\n",
      'src/c.ts': "export * from 'unresolved-external'\n",
      'lib/out.ts': 'export const outside = 1\n',
      'src/dynamic.ts': 'export const load = (target: string) => import(target)\n',
      'src/unknown.input': 'possible references are not semantic evidence',
    }))
    const artifact = readSourceAuditEvidence(out)
    const proof = (file: string, specifier: string) => resolveAuditImportTarget(out,
      artifact.files.find(f => f.path === file)!.facts.find(f => f.kind === 'export' && f.sourceSpecifier === specifier)!.id)
    for (const [file, specifier] of [['src/a.ts', './b.js'], ['src/b.ts', './a.js'], ['src/b.ts', './c.js']]) {
      expect(proof(file, specifier).status).toBe('present')
    }
    expect(proof('src/a.ts', 'external').status).toBe('indeterminate')
    expect(proof('src/c.ts', 'unresolved-external').status).toBe('indeterminate')
    expect(proof('src/a.ts', '../lib/out.js').status).toBe('outside-selected-roots')
    expect(proof('src/a.ts', './absent.js').status).toBe('proven-missing')
    expect(artifact.coverage.inventoryComplete).toBe(true)
    expect(artifact.files.find(f => f.path === 'src/dynamic.ts')!.capabilities.imports).toBe('partial')
    expect(artifact.files.find(f => f.path === 'src/unknown.input')!.capabilities.imports).toBe('unsupported')
    const direct = artifact.files.find(f => f.path === 'src/a.ts')!.facts.find(f => f.kind === 'export' && f.name === 'direct')!
    expect(failure(() => resolveAuditImportTarget(out, direct.id)).code).toBe('AUDIT_FACT_NOT_IMPORT')
    rewriteArtifact(out, a => { a.coverage.inventoryComplete = false })
    expect(proof('src/a.ts', './absent.js').status).toBe('indeterminate')
    expect(proof('src/a.ts', './b.js').status).toBe('present')
  })
})

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
