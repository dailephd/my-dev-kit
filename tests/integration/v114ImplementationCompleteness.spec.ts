import { beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { allocateV114OutputDir } from '../helpers/v114OutputRoot.js'

// B16 end-to-end witness: one task-owned project spanning Python, TypeScript, FastAPI, Express and Rust.
// Every expected identity below is derived from the independently authored fixture text, never from generated output.
const fixture = resolve('tests/fixtures/v114-language/rust/F10-mixed-language')
const tsx = resolve('node_modules/tsx/dist/cli.mjs')
const enc = encodeURIComponent
const SECRET = 'B16-UNSELECTED-SOURCE-MARKER'

const apiPy = "import pathlib\npathlib.Path('EXECUTED-python.txt').write_text('x')\nfrom fastapi import FastAPI\napp = FastAPI()\n\n@app.get('/ping')\ndef ping():\n    return {'ok': True}\n"
const webTs = "require('node:fs').writeFileSync('EXECUTED-typescript.txt', 'x')\nimport express from 'express'\nconst app = express()\nfunction listItems(req, res) { res.end('[]') }\napp.get('/items', listItems)\n"
const buildRs = "fn main() { std::fs::write(\"EXECUTED-build-script.txt\", \"x\").unwrap(); }\n"
const secretRs = `pub fn leaked() -> &'static str { "${SECRET}" }\n`
const secretPy = `LEAKED = "${SECRET}"\n`

function write(root: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
}
function cli(args: string[]) {
  return spawnSync(process.execPath, [tsx, 'src/cli.ts', ...args], { encoding: 'utf8', shell: false, windowsHide: true })
}
function cliJson(args: string[]) {
  const result = cli(args)
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}
function readJson(file: string) { return JSON.parse(readFileSync(file, 'utf8')) }

const sharedFiles = ['src/Worker.java', 'src/Worker.kt', 'src/worker.py', 'src/worker.ts', 'src/api.py', 'src/web.ts']

describe('B16 cross-language implementation completeness', () => {
  let root: string
  let index: string
  let graph: { schemaVersion: string; nodes: Array<Record<string, any>>; edges: Array<Record<string, any>> }
  let symbols: { schemaVersion: string; files: Array<{ path: string; language: string; symbols: Array<{ name: string }> }> }
  let manifest: Record<string, any>
  let rustImplId: string
  let rustMethodId: string
  const routeId = (file: string, framework: string, handler: string, method: string, route: string) =>
    'framework-route:' + [file, framework, handler, method, route].map(enc).join('#') + '#0'

  beforeAll(() => {
    root = mkdtempSync(join(allocateV114OutputDir('implementation-completeness-v114'), 'project-'))
    cpSync(fixture, root, { recursive: true })
    write(root, {
      'src/api.py': apiPy,
      'src/web.ts': webTs,
      'build.rs': buildRs,
      'private/secret.rs': secretRs,
      'private/secret.py': secretPy,
    })
    // An out-of-selection #[path] target must not be read even though it lies inside the project root.
    write(root, { 'src/lib.rs': readFileSync(join(root, 'src/lib.rs'), 'utf8') + '#[path = "../private/secret.rs"]\nmod secret;\n' })
    index = join(root, 'index')
    const indexed = cli(['index', '--root', root, '--src', 'src', '--out', index, '--json'])
    expect(indexed.status, indexed.stderr).toBe(0)
    graph = readJson(join(index, 'code-graph.json'))
    symbols = readJson(join(index, 'symbol-index.json'))
    manifest = readJson(join(index, 'manifest.json'))
    // The Rust impl identity is the line and UTF-16 offset of `impl Worker` in the authored fixture text.
    const rust = readFileSync(join(root, 'src/worker.rs'), 'utf8')
    const offset = rust.indexOf('impl Worker')
    const line = rust.slice(0, offset).split('\n').length
    const implKey = `rust:impl:Worker@${line}:${offset}`
    rustImplId = `rust-impl:${enc('src/worker.rs')}#${enc(implKey)}#0`
    rustMethodId = `symbolq:${enc('src/worker.rs')}#${enc(implKey)}#run#0`
  }, 120_000)

  it('inventories every selected source file with its own language and no unselected source', () => {
    expect(symbols.files.map(f => [f.path, f.language]).sort()).toEqual([
      ['src/Worker.java', 'java'], ['src/Worker.kt', 'kotlin'], ['src/api.py', 'python'], ['src/lib.rs', 'rust'],
      ['src/web.ts', 'typescript'], ['src/worker.py', 'python'], ['src/worker.rs', 'rust'], ['src/worker.ts', 'typescript'],
    ])
    expect(graph.nodes.some(n => String(n.path ?? '').startsWith('private/') || n.path === 'build.rs')).toBe(false)
    expect(manifest.sourceRoots).toEqual(['src'])
  })

  it('keeps existing schema and artifact families', () => {
    expect(symbols.schemaVersion).toBe('3')
    expect(graph.schemaVersion).toBe('1.1.0')
    expect(manifest.artifactKind).toBe('my-dev-kit-v1-manifest')
    expect(manifest.artifacts).toMatchObject({ symbolIndex: 'symbol-index.json', codeGraph: 'code-graph.json', callGraph: null })
    expect(readdirSync(index).sort()).toEqual(['classification.json', 'code-graph.json', 'data-model-graph.json', 'data-model.json', 'frontend-reachability.json', 'frontend-semantic.json', 'manifest.json', 'symbol-index.json'])
    expect(manifest.analyzers.map((a: { id: string }) => a.id)).toContain('rust-structure')
  })

  it('has exact Python, TypeScript, framework and Rust owner nodes', () => {
    const at = (id: string) => graph.nodes.find(n => n.id === id)
    expect(at('symbol:src/api.py#ping')).toMatchObject({ kind: 'symbol', path: 'src/api.py', line: 7 })
    expect(at(`symbolq:${enc('src/worker.py')}#${enc('python/class:Worker')}#run#0`)).toMatchObject({ kind: 'symbol', path: 'src/worker.py', line: 2 })
    expect(at('symbol:src/worker.ts#Worker')).toMatchObject({ kind: 'symbol', path: 'src/worker.ts', line: 1 })
    expect(at('symbol:src/worker.ts#run')).toMatchObject({ kind: 'symbol', path: 'src/worker.ts', line: 4 })
    expect(at('symbol:src/worker.rs#Worker')).toMatchObject({ kind: 'symbol', path: 'src/worker.rs', line: 1 })
    expect(at(rustImplId)).toMatchObject({ kind: 'rust-impl', path: 'src/worker.rs', line: 2 })
    expect(at(rustMethodId)).toMatchObject({ kind: 'symbol', path: 'src/worker.rs', line: 3 })
  })

  it('projects FastAPI and Express routes with exact handler and file edges and no runtime claims', () => {
    const cases = [
      [routeId('src/api.py', 'fastapi', 'symbol:src/api.py#ping', 'GET', '/ping'), 'src/api.py', 'symbol:src/api.py#ping', 'fastapi', '/ping'],
      [routeId('src/web.ts', 'express', 'symbol:src/web.ts#listItems', 'GET', '/items'), 'src/web.ts', 'symbol:src/web.ts#listItems', 'express', '/items'],
    ] as const
    for (const [id, file, handler, framework, observedPath] of cases) {
      expect(graph.nodes.find(n => n.id === id)).toMatchObject({ kind: 'framework-route', path: file, routeMetadata: { framework, method: 'GET', observedPath, handlerId: handler, pathStatus: 'static' } })
      expect(graph.edges.find(e => e.source === id && e.kind === 'framework-route-handled-by-symbol')?.target).toBe(handler)
      expect(graph.edges.find(e => e.source === id && e.kind === 'framework-route-defined-in-file')?.target).toBe('file:' + file)
    }
    expect(JSON.stringify(graph)).not.toMatch(/authenticated|reachable|executed/i)
  })

  it('links the Rust impl to its own type, module and file through existing generic relationships', () => {
    const target = `rust-target:Cargo.toml#lib#mixed#${enc('src/lib.rs')}`
    const workerModule = `rust-module:${enc(target)}#${enc('crate::worker')}`
    const edge = (kind: string, source: string) => graph.edges.filter(e => e.kind === kind && e.source === source).map(e => e.target)
    expect(edge('rust-impl-for-type', rustImplId)).toEqual(['symbol:src/worker.rs#Worker'])
    expect(edge('rust-impl-defines-symbol', rustImplId)).toEqual([rustMethodId])
    expect(edge('rust-module-resolves-to-file', workerModule)).toEqual(['file:src/worker.rs'])
    expect(edge('rust-module-defines-symbol', workerModule)).toEqual(['symbol:src/worker.rs#Worker'])
    // build.rs is modelled only as a Cargo target from the manifest; it is neither read as a selected source nor executed.
    expect(edge('rust-package-has-target', 'rust-package:Cargo.toml').sort()).toEqual(['rust-target:Cargo.toml#build-script#build-script-build#build.rs', target])
    expect(edge('rust-target-root-file', target)).toEqual(['file:src/lib.rs'])
  })

  it('creates no edge between files of different languages despite identical first names', () => {
    const language = (file: string) => symbols.files.find(f => f.path === file)?.language
    const files = new Map(graph.nodes.map(n => [n.id, n.path as string | undefined]))
    const crossing = graph.edges.filter(e => {
      const from = files.get(e.source), to = files.get(e.target)
      return from && to && from !== to && language(from) !== language(to)
    })
    expect(crossing).toEqual([])
    const workers = graph.nodes.filter(n => n.kind === 'symbol' && n.id.endsWith('#Worker')).map(n => n.id).sort()
    expect(workers).toEqual(['symbol:src/Worker.java#Worker', 'symbol:src/Worker.kt#Worker', 'symbol:src/worker.py#Worker', 'symbol:src/worker.rs#Worker', 'symbol:src/worker.ts#Worker'])
  })

  it.each([
    ['symbol:src/api.py#ping', 'src/api.py', 'def ping():'],
    ['symbol:src/worker.ts#run', 'src/worker.ts', 'export function run(): void {}'],
    ['symbol:src/worker.rs#Worker', 'src/worker.rs', 'pub struct Worker;'],
  ])('retrieves exact bounded source for %s', (id, file, snippet) => {
    const result = cliJson(['source', '--index', index, '--node', id, '--max-lines', '8', '--format', 'json'])
    expect(result).toMatchObject({ status: 'ok', filePath: file })
    expect(result.content).toContain(snippet)
    expect(result.content).not.toContain(SECRET)
    expect(result.endLine - result.startLine + 1).toBeLessThanOrEqual(8)
  })

  it('retrieves the exact Rust impl method range and continues from the real window end', () => {
    const method = cliJson(['source', '--index', index, '--node', rustMethodId, '--max-lines', '5', '--format', 'json'])
    expect(method).toMatchObject({ filePath: 'src/worker.rs', startLine: 3, endLine: 3 })
    expect(method.content).toContain('pub fn run(&self) {}')
    const first = cliJson(['source', '--index', index, '--node', rustImplId, '--max-lines', '1', '--format', 'json'])
    expect(first).toMatchObject({ filePath: 'src/worker.rs', startLine: 2, endLine: 2 })
    expect(first.continuationCursor).toMatchObject({ nextStartLine: 3, symbolBoundaryKnown: true })
    const more = cliJson(['source', '--index', index, '--node', rustImplId, '--max-lines', '2', '--continue', '--format', 'json'])
    // With two-line windows the impl (lines 2-4) continues at line 4 - never at the file beginning.
    expect(more).toMatchObject({ startLine: 4, endLine: 4 })
    expect(more.content).toBe('}')
  })

  it('ranks the language-owned symbol first for ownership-oriented queries', () => {
    const ids = (query: string, extra: string[] = []) => cliJson(['search', '--index', index, '--query', query, '--limit', '20', '--json', ...extra]).results.map((r: { id: string }) => r.id)
    expect(ids('impl Worker run', ['--intent', 'ownership'])[0]).toBe(rustMethodId)
    expect(ids('ping')[0]).toBe('symbol:src/api.py#ping')
    const worker = ids('Worker')
    for (const id of ['symbol:src/worker.ts#Worker', 'symbol:src/Worker.java#Worker', 'symbol:src/Worker.kt#Worker', 'symbol:src/worker.py#Worker', 'symbol:src/worker.rs#Worker']) expect(worker).toContain(id)
    expect(new Set(worker).size).toBe(worker.length)
  })

  it('bounds lookup and slice to the exact same-language neighborhood', () => {
    const lookup = cliJson(['lookup', '--index', index, '--node', rustImplId, '--depth', '1', '--json'])
    expect(lookup.node.id).toBe(rustImplId)
    const slice = cliJson(['slice', '--index', index, '--node', rustImplId, '--depth', '1', '--json'])
    const ids = (slice.nodes ?? slice.slice?.nodes ?? []).map((n: { id: string }) => n.id)
    expect(ids).toEqual(expect.arrayContaining([rustImplId, rustMethodId, 'symbol:src/worker.rs#Worker']))
    expect(ids.filter((id: string) => /\.(py|ts|kt|java)#/.test(id))).toEqual([])
  })

  it('selects a context focus with explicit freshness uncertainty', () => {
    const out = join(root, 'context.json')
    cliJson(['context', '--index', index, '--query', 'Worker run implementation', '--out', out, '--json'])
    const capsule = readJson(out)
    expect(capsule.schemaVersion).toBe('1.0.0')
    expect(capsule.tool.version).toBe(JSON.parse(readFileSync('package.json', 'utf8')).version)
    expect(capsule.focus).toMatchObject({ focusNodeId: rustMethodId, focusFilePath: 'src/worker.rs', confidence: 'high' })
    expect(capsule.candidateNodes.map((n: { nodeId: string }) => n.nodeId)).toEqual(expect.arrayContaining(['symbol:src/worker.ts#Worker', 'symbol:src/worker.py#Worker']))
    expect(capsule.freshness.state).toBe('unknown')
    expect(capsule.selectedSource.slices[0]).toMatchObject({ nodeId: rustMethodId, filePath: 'src/worker.rs', startLine: 3 })
  })

  it('never reads or discloses unselected source, build scripts or out-of-root paths', () => {
    for (const file of readdirSync(index)) expect(readFileSync(join(index, file), 'utf8')).not.toContain(SECRET)
    // The out-of-selection #[path] module is reported unresolved and never resolves to a file.
    expect(graph.nodes.filter(n => n.path === 'private/secret.rs' || n.id.startsWith('file:private/'))).toEqual([])
    expect(graph.nodes.find(n => n.kind === 'rust-module' && n.label === 'crate::secret')?.rustMetadata).toMatchObject({ status: 'UNRESOLVED_SELECTED_ROOTS', candidates: [] })
    expect(graph.edges.filter(e => e.kind === 'rust-module-resolves-to-file' && /secret/.test(e.source))).toEqual([])
    for (const file of ['private/secret.py', 'private/secret.rs', '../secret.py', 'build.rs']) {
      const result = cli(['source', '--index', index, '--file', file, '--max-lines', '5', '--format', 'json'])
      expect(result.stdout).not.toContain(SECRET)
      expect(result.stdout).not.toContain('EXECUTED-build-script')
      expect(result.status === 0 && result.stdout.includes('"status": "ok"')).toBe(false)
    }
  })

  it('never executes target Python, TypeScript or Cargo build code', () => {
    for (const marker of ['EXECUTED-python.txt', 'EXECUTED-typescript.txt', 'EXECUTED-build-script.txt']) {
      expect(existsSync(join(root, marker)), marker).toBe(false)
      expect(existsSync(resolve(marker)), marker).toBe(false)
    }
  })

  it('retains non-Rust identities and omits Rust analyzers when no Rust source exists', () => {
    const plain = mkdtempSync(join(dirname(root), 'plain-'))
    write(plain, { 'src/api.py': apiPy, 'src/web.ts': webTs })
    for (const file of sharedFiles.filter(f => f !== 'src/api.py' && f !== 'src/web.ts')) cpSync(join(fixture, file), join(plain, file))
    const out = join(plain, 'index')
    expect(cli(['index', '--root', plain, '--src', 'src', '--out', out, '--json']).status).toBe(0)
    const plainGraph = readJson(join(out, 'code-graph.json'))
    const plainManifest = readJson(join(out, 'manifest.json'))
    expect(plainManifest.analyzers.map((a: { id: string }) => a.id)).not.toContain('rust-structure')
    expect(plainGraph.nodes.some((n: { kind: string }) => n.kind.startsWith('rust-'))).toBe(false)
    const nonRust = (g: { nodes: Array<Record<string, any>> }) => g.nodes.filter(n => n.path && !n.path.endsWith('.rs') && !n.id.startsWith('rust-')).map(n => n.id).sort()
    expect(nonRust(plainGraph)).toEqual(nonRust(graph))
  })
})
