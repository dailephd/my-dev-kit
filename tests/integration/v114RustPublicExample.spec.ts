import { describe, expect, it, beforeAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { allocateV114OutputDir } from '../helpers/v114OutputRoot.js'

// Public example: examples/basic-rust-workspace. Expected identities come from the authored example text,
// not from generated output. Cargo and the example program are never run.
const example = resolve('examples/basic-rust-workspace')
const tsx = resolve('node_modules/tsx/dist/cli.mjs')
const distCli = resolve('dist/cli.js')
const enc = encodeURIComponent
const roots = ['crates/core/src', 'crates/core/tests', 'crates/cli/src']
const approved = [
  'examples/basic-rust-workspace/Cargo.toml',
  'examples/basic-rust-workspace/README.md',
  'examples/basic-rust-workspace/crates/cli/Cargo.toml',
  'examples/basic-rust-workspace/crates/cli/src/main.rs',
  'examples/basic-rust-workspace/crates/core/Cargo.toml',
  'examples/basic-rust-workspace/crates/core/src/lib.rs',
  'examples/basic-rust-workspace/crates/core/src/tasks.rs',
  'examples/basic-rust-workspace/crates/core/tests/worker_tests.rs',
]

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name)
    return entry.name.startsWith('.my-dev-kit') ? [] : entry.isDirectory() ? listFiles(full) : [full]
  })
}
const tsxCli = (args: string[]) => spawnSync(process.execPath, [tsx, 'src/cli.ts', ...args], { encoding: 'utf8', shell: false, windowsHide: true })
function json(args: string[]) {
  const result = tsxCli(args)
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
const normalize = (graph: Record<string, unknown>) => ({ ...graph, createdAt: undefined, generatedAt: undefined, buildTime: undefined })

describe('v1.14 public Rust workspace example', () => {
  let project: string
  let index: string
  let graph: { schemaVersion: string; nodes: Array<Record<string, any>>; edges: Array<Record<string, any>> }
  let symbols: { files: Array<{ path: string; language: string }>; sourceRoots: string[] }
  let attempts: string
  const tasksText = readFileSync(join(example, 'crates/core/src/tasks.rs'), 'utf8')
  const position = (needle: string) => {
    const offset = tasksText.indexOf(needle)
    expect(offset, needle).toBeGreaterThanOrEqual(0)
    return `${tasksText.slice(0, offset).split('\n').length}:${offset}`
  }
  const core = 'crates/core/Cargo.toml', cli = 'crates/cli/Cargo.toml'
  const target = (manifest: string, kind: string, name: string, root: string) => `rust-target:${enc(manifest)}#${kind}#${name}#${enc(root)}`
  const lib = target(core, 'lib', 'basic_rust_core', 'crates/core/src/lib.rs')
  const bin = target(cli, 'bin', 'basic-rust-cli', 'crates/cli/src/main.rs')
  const moduleId = (targetId: string, modulePath: string) => `rust-module:${enc(targetId)}#${enc(modulePath)}`
  const traitImplKey = () => `rust:impl:Worker:trait:Runner@${position('impl Runner for Worker')}`
  const runImpl = () => `symbolq:${enc('crates/core/src/tasks.rs')}#${enc(traitImplKey())}#run#0`
  const implNode = () => `rust-impl:${enc('crates/core/src/tasks.rs')}#${enc(traitImplKey())}#0`
  const runTrait = () => `symbolq:${enc('crates/core/src/tasks.rs')}#${enc(`rust:trait_item:Runner@${position('/// Something that can run')}`)}#run#0`
  const edges = (kind: string, source: string) => graph.edges.filter(e => e.kind === kind && e.source === source).map(e => e.target).sort()

  beforeAll(() => {
    // Work on a task-owned copy so the tracked example stays untouched by generated output.
    project = mkdtempSync(join(allocateV114OutputDir('rust-public-example-v114'), 'example-'))
    cpSync(example, project, { recursive: true })
    index = join(project, 'index')
    attempts = join(project, 'guard.attempts')
    const guard = join(project, 'guard.cjs')
    expect(existsSync(distCli), 'dist/cli.js is required (npm run build) for the guarded index run').toBe(true)
    return import(pathToFileURL(resolve('scripts/qualification/v114RustMatrix.mjs')).href).then(mod => {
      writeFileSync(guard, mod.guardSource, { flag: 'wx' })
      const result = spawnSync(process.execPath, ['--require', guard, distCli, 'index', '--root', project, ...roots.flatMap(r => ['--src', r]), '--out', index, '--json'], {
        encoding: 'utf8', windowsHide: true,
        env: { ...process.env, PATH: '', NODE_PATH: '', NODE_OPTIONS: '', B15_ATTEMPTS: attempts, B15_TELEMETRY: join(project, 'guard.resources.json') },
      })
      expect(result.status, result.stderr).toBe(0)
      graph = readJson(join(index, 'code-graph.json'))
      symbols = readJson(join(index, 'symbol-index.json'))
    })
  }, 120_000)

  it('ships exactly the eight approved example files', () => {
    const files = listFiles(example).map(file => relative(resolve('.'), file).split(sep).join('/')).sort()
    expect(files).toEqual(approved)
    expect(existsSync(join(example, 'Cargo.lock'))).toBe(false)
    expect(existsSync(join(example, 'build.rs'))).toBe(false)
  })

  it('declares only local path dependencies in a two-member workspace without build scripts or macros', () => {
    expect(readFileSync(join(example, 'Cargo.toml'), 'utf8')).toMatch(/members = \["crates\/core", "crates\/cli"\]/)
    const cliManifest = readFileSync(join(example, 'crates/cli/Cargo.toml'), 'utf8')
    expect(cliManifest).toContain('basic-rust-core = { path = "../core" }')
    for (const manifest of ['Cargo.toml', 'crates/core/Cargo.toml', 'crates/cli/Cargo.toml']) {
      const text = readFileSync(join(example, manifest), 'utf8')
      expect(text).not.toMatch(/proc-macro|build\s*=|version\s*=\s*"[\^~=]|registry|git\s*=/)
      expect(text).not.toMatch(/\[dependencies\][\s\S]*(serde|tokio)/)
    }
  })

  it('selects exactly the three source roots and four Rust files', () => {
    expect(symbols.sourceRoots).toEqual(roots)
    expect(symbols.files.map(f => [f.path, f.language]).sort()).toEqual([
      ['crates/cli/src/main.rs', 'rust'], ['crates/core/src/lib.rs', 'rust'], ['crates/core/src/tasks.rs', 'rust'], ['crates/core/tests/worker_tests.rs', 'rust'],
    ])
    expect(graph.nodes.some(n => n.path === 'Cargo.toml' || String(n.id).startsWith('file:Cargo.toml'))).toBe(false)
  })

  it('records exact local package and target identities', () => {
    const testTarget = target(core, 'test', 'worker_tests', 'crates/core/tests/worker_tests.rs')
    for (const id of [`rust-package:${enc(core)}`, `rust-package:${enc(cli)}`, lib, bin, testTarget]) expect(graph.nodes.find(n => n.id === id), id).toMatchObject({ language: 'rust', rustMetadata: { status: 'RESOLVED' } })
    expect(edges('rust-package-has-target', `rust-package:${enc(core)}`)).toEqual([lib, testTarget].sort())
    expect(edges('rust-package-has-target', `rust-package:${enc(cli)}`)).toEqual([bin])
    expect(edges('rust-target-root-file', lib)).toEqual(['file:crates/core/src/lib.rs'])
    expect(edges('rust-target-root-file', bin)).toEqual(['file:crates/cli/src/main.rs'])
    expect(graph.nodes.filter(n => n.kind === 'rust-package').map(n => n.id).sort()).toEqual([`rust-package:${enc(cli)}`, `rust-package:${enc(core)}`].sort())
  })

  it('extracts the trait, type, impls and exactly one concrete run method per owner', () => {
    expect(graph.nodes.find(n => n.id === 'symbol:crates/core/src/tasks.rs#Runner')).toMatchObject({ path: 'crates/core/src/tasks.rs', line: 1 })
    expect(graph.nodes.find(n => n.id === 'symbol:crates/core/src/tasks.rs#Worker')).toMatchObject({ path: 'crates/core/src/tasks.rs', line: 6 })
    expect(graph.nodes.find(n => n.id === implNode())).toMatchObject({ kind: 'rust-impl', line: Number(position('impl Runner for Worker').split(':')[0]), rustMetadata: { status: 'RESOLVED' } })
    expect(graph.nodes.find(n => n.id === runImpl())).toMatchObject({ kind: 'symbol', path: 'crates/core/src/tasks.rs', line: 18 })
    expect(graph.nodes.find(n => n.id === runTrait())).toMatchObject({ kind: 'symbol', path: 'crates/core/src/tasks.rs', line: 3 })
    expect(runImpl()).not.toBe(runTrait())
    expect(graph.nodes.filter(n => n.kind === 'symbol' && n.id.endsWith('#run#0')).length).toBe(2)
    expect(edges('rust-impl-for-type', implNode())).toEqual(['symbol:crates/core/src/tasks.rs#Worker'])
    expect(edges('rust-impl-of-trait', implNode())).toEqual(['symbol:crates/core/src/tasks.rs#Runner'])
    expect(edges('rust-impl-defines-symbol', implNode())).toEqual([runImpl()])
  })

  it('links modules, re-exports and the local dependency use through existing edge kinds', () => {
    const libRoot = moduleId(lib, 'crate'), tasks = moduleId(lib, 'crate::tasks'), cliRoot = moduleId(bin, 'crate')
    expect(edges('rust-module-contains-module', libRoot)).toEqual([tasks])
    expect(edges('rust-module-resolves-to-file', tasks)).toEqual(['file:crates/core/src/tasks.rs'])
    expect(edges('rust-module-reexports-symbol', libRoot)).toEqual(['symbol:crates/core/src/tasks.rs#Runner', 'symbol:crates/core/src/tasks.rs#Worker'])
    expect(edges('rust-module-uses-module', cliRoot)).toContain(tasks)
    expect(graph.edges.some(e => e.kind === 'calls')).toBe(false)
  })

  it('retrieves exact bounded source and lookup for the qualified method', () => {
    const source = json(['source', '--index', index, '--node', runImpl(), '--max-lines', '10', '--format', 'json'])
    expect(source).toMatchObject({ filePath: 'crates/core/src/tasks.rs', startLine: 18, endLine: 20 })
    expect(source.content).toBe('    fn run(&self) -> u32 {\n        self.id * 2\n    }')
    const lookup = json(['lookup', '--index', index, '--node', runImpl(), '--depth', '1', '--json'])
    expect(lookup.node.id).toBe(runImpl())
    const search = json(['search', '--index', index, '--query', 'impl Runner for Worker run', '--intent', 'ownership', '--limit', '5', '--json'])
    expect(search.results[0].id).toBe(runImpl())
  })

  it('returns a bounded graph slice around the impl', () => {
    const slice = json(['slice', '--index', index, '--node', implNode(), '--depth', '1', '--json'])
    const ids = (slice.nodes ?? slice.slice?.nodes ?? []).map((n: { id: string }) => n.id)
    expect(ids).toEqual(expect.arrayContaining([implNode(), runImpl(), 'symbol:crates/core/src/tasks.rs#Worker', 'symbol:crates/core/src/tasks.rs#Runner']))
    expect(ids.length).toBeLessThan(15)
  })

  it('produces a valid context capsule focused on the method', () => {
    const out = join(project, 'context.json')
    json(['context', '--index', index, '--query', 'impl Runner for Worker run', '--out', out, '--json'])
    const capsule = readJson(out)
    expect(capsule.schemaVersion).toBe('1.0.0')
    expect(capsule.focus).toMatchObject({ focusNodeId: runImpl(), focusFilePath: 'crates/core/src/tasks.rs' })
    expect(capsule.freshness.state).toBe('unknown')
  })

  it('never executes target code or touches the network', () => {
    expect(existsSync(attempts)).toBe(false)
    for (const name of ['target', 'Cargo.lock']) expect(existsSync(join(project, name)), name).toBe(false)
    expect(statSync(join(index, 'code-graph.json')).isFile()).toBe(true)
  })

  it('keeps full and incremental output identical', () => {
    const second = join(project, 'incremental')
    const args = (extra: string[]) => ['index', '--root', project, ...roots.flatMap(r => ['--src', r]), '--out', second, '--json', ...extra]
    expect(tsxCli(args([])).status).toBe(0)
    const incremental = tsxCli(args(['--incremental']))
    expect(incremental.status, incremental.stderr).toBe(0)
    expect(normalize(readJson(join(second, 'code-graph.json')))).toEqual(normalize(graph))
    expect(readJson(join(second, 'symbol-index.json')).files).toEqual((readJson(join(index, 'symbol-index.json'))).files)
  })

  it('is covered by the explicit npm files allowlist exactly once per approved path', () => {
    const files: string[] = JSON.parse(readFileSync('package.json', 'utf8')).files
    const entries = files.filter(f => f.startsWith('examples/basic-rust-workspace'))
    expect(entries.sort()).toEqual(approved)
    expect(new Set(files).size).toBe(files.length)
    expect(files.filter(f => f.includes('.my-dev-kit') || f.includes('Cargo.lock'))).toEqual([])
  })
})
