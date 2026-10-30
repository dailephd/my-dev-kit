import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

// B15 qualification only: no production imports and no target program execution.
export const taskRoot = '.my-dev-kit-workflow/tmp/v1.14.0-b15-20261021'
export const grammarHash = 'd98c6aa1db69cfd204bf07dfefb2451b987160cbb2db95ddac8ac04b5f1eb1d0'
export const methodId = 'symbolq:src%2Fimpls.rs#rust%3Aimpl%3Acrate%3A%3Aalpha%3A%3AWorker%3Atrait%3Acrate%3A%3Aalpha%3A%3ARunner%404%3A64#run#0'
const implId = 'rust-impl:src%2Fimpls.rs#rust%3Aimpl%3Acrate%3A%3Aalpha%3A%3AWorker%3Atrait%3Acrate%3A%3Aalpha%3A%3ARunner%404%3A64#0'
export const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export function verifyCheckout(root, script) {
  assert.equal(path.relative(fs.realpathSync(root), fs.realpathSync(path.resolve(path.dirname(script), '../..'))), '', 'Run the committed checkout harness')
}
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2), { flag: 'wx' })

export function contained(root, target) {
  const absolute = path.resolve(target), relative = path.relative(path.resolve(root), absolute)
  assert(relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative), 'Path outside task owner')
  let ancestor = absolute
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor)
  const realRoot = fs.realpathSync(root), real = fs.realpathSync(ancestor)
  const realRelative = path.relative(realRoot, real)
  assert(!realRelative.startsWith('..' + path.sep) && realRelative !== '..' && !path.isAbsolute(realRelative), 'Symlink escapes task owner')
  return absolute
}

export function newRun(root, family) {
  const parent = contained(root, path.join(root, taskRoot, family))
  fs.mkdirSync(parent, { recursive: true })
  for (let n = 1; ; n++) {
    const out = contained(root, path.join(parent, `run-${String(n).padStart(3, '0')}`))
    if (!fs.existsSync(out)) { fs.mkdirSync(out); return out }
  }
}

// The eight approved public example files (52 baseline entries + these eight = 60). Only these exact paths are exempt from the private-name check below.
export const publicRustExample = [
  'examples/basic-rust-workspace/Cargo.toml', 'examples/basic-rust-workspace/README.md',
  'examples/basic-rust-workspace/crates/cli/Cargo.toml', 'examples/basic-rust-workspace/crates/cli/src/main.rs',
  'examples/basic-rust-workspace/crates/core/Cargo.toml', 'examples/basic-rust-workspace/crates/core/src/lib.rs',
  'examples/basic-rust-workspace/crates/core/src/tasks.rs', 'examples/basic-rust-workspace/crates/core/tests/worker_tests.rs',
]
export function verifyInventory(files) {
  assert.equal(files.length, 60, 'Frozen npm inventory count changed')
  for (const { path: name } of files) {
    assert(!name.includes('..') && !name.includes('\\'), 'Unsafe package entry')
    assert(/^(?:dist\/|docs\/|examples\/|package\.json$|README\.md$|CHANGELOG\.md$|LICENSE$)/.test(name), `Private package entry: ${name}`)
    if (publicRustExample.includes(name)) continue
    assert(!/(?:^|\/)(?:node_modules|\.my-dev-kit[^/]*|reports|tests|manifest\.txt|AGENTS\.md|agents\.txt|CLAUDE\.md|claude\.txt)(?:\/|$)/.test(name), `Private package entry: ${name}`)
  }
  for (const name of ['dist/cli.js', 'dist/assets/tree-sitter-rust-orchard.wasm', 'dist/assets/tree-sitter-rust-orchard.LICENSE']) assert(files.some(f => f.path === name), `Missing ${name}`)
  for (const name of publicRustExample) assert.equal(files.filter(f => f.path === name).length, 1, `Expected exactly one ${name}`)
}

export function verifyPinned(root, document = fs.readFileSync(path.join(root, 'SOURCE.md'), 'utf8'), load = fs.readFileSync) {
  const rows = [...document.matchAll(/^\| ([^|]+) \| ([^|]+) \| (\d+) \| ([a-f0-9]{64}) \| ([a-f0-9]{40}) \|$/gm)]
  assert(rows.length >= 8, 'Missing pinned corpus integrity rows')
  return rows.map(([, upstream, local, size, hash, blob]) => {
    const file = contained(root, path.join(root, local.trim())), bytes = load(file)
    assert.equal(bytes.length, Number(size), `Pinned size: ${local}`)
    assert.equal(sha(bytes), hash, `Pinned SHA-256: ${local}`)
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), blob, `Pinned Git blob: ${local}`)
    if (local.endsWith('.rs')) assert(bytes.length <= 65536)
    return { upstream: upstream.trim(), local: local.trim(), bytes: bytes.length, sha256: hash }
  })
}

// Loaded by the installed CLI process before its ESM modules. Attempts are recorded
// even if a consumer catches the guard exception. syncBuiltinESMExports covers named imports.
export const guardSource = `
const fs = require('node:fs');
let blockedProvenanceProbes = 0;
const deny = name => function () { fs.appendFileSync(process.env.B15_ATTEMPTS, name+'\\n'); throw Error('B15 forbidden '+name); };
for (const mod of ['child_process','http','https','http2','net','tls','dns','dgram']) {
 const api = require('node:'+mod);
 for (const key of ['exec','execFile','spawn','fork','execSync','execFileSync','spawnSync','request','get','connect','createConnection','createServer','createSocket','lookup','resolve','resolve4','resolve6']) if(typeof api[key]==='function') api[key]=function(...args) {
   // Existing optional freshness probe: deliberately unavailable, never executed.
   // Record it separately from target execution/network attempts. No Git response is fabricated.
   if(mod==='child_process' && key==='execFileSync' && args[0]==='git' && JSON.stringify(args[1])==='["rev-parse","HEAD"]') { blockedProvenanceProbes++; throw Error('B15 optional Git provenance unavailable'); }
   return deny(mod+'.'+key)();
 };
 if(api.promises) for(const key of Object.keys(api.promises)) if(typeof api.promises[key]==='function') api.promises[key]=deny(mod+'.promises.'+key);
}
globalThis.fetch = deny('fetch');
if(globalThis.WebSocket) globalThis.WebSocket = deny('WebSocket');
require('node:module').syncBuiltinESMExports();
process.on('exit', () => fs.writeFileSync(process.env.B15_TELEMETRY, JSON.stringify({ maxRSSKiB:process.resourceUsage().maxRSS, rssAtExit:process.memoryUsage().rss, cpu:process.cpuUsage(), blockedProvenanceProbes })));
`

export function graphIntegrity(graph) {
  assert.equal(graph.schemaVersion, '1.1.0')
  const ids = new Set(graph.nodes.map(n => n.id))
  assert.equal(ids.size, graph.nodes.length, 'Duplicate graph node IDs')
  assert.equal(new Set(graph.edges.map(e => e.id)).size, graph.edges.length, 'Duplicate graph edge IDs')
  for (const e of graph.edges) assert(ids.has(e.source) && ids.has(e.target), `Dangling endpoint: ${e.id}`)
  assert(!graph.edges.some(e => e.kind === 'calls'), 'Deferred Rust call inference appeared')
  for (const n of graph.nodes.filter(n => n.kind === 'rust-module' && n.rustMetadata?.status !== 'RESOLVED')) {
    assert(!graph.edges.some(e => e.source === n.id && e.kind === 'rust-module-resolves-to-file'), 'Fabricated conditional module edge')
  }
}

export function assertSourceRejected(response, label) {
  assert.notEqual(response.status, 0, `${label}: installed source returned excluded content`)
  assert(!/--start is required|--end is required|unknown option|invalid.*option|cannot combine/i.test(response.stderr ?? ''), `${label}: argument validation did not exercise containment`)
}

export async function qualify() {
  const rootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true })
  assert.equal(rootResult.status, 0)
  const root = fs.realpathSync(rootResult.stdout.trim())
  verifyCheckout(root, fileURLToPath(import.meta.url))
  const run = newRun(root, 'packed-consumer')
  const evidence = contained(root, path.join(run, 'evidence'))
  fs.mkdirSync(evidence)
  const tests = contained(root, path.join(run, 'tests')); fs.mkdirSync(tests)
  const cache = contained(root, path.join(root, '.my-dev-kit-workflow/npm-cache/v1.14.0-b15-20261021')); fs.mkdirSync(cache, { recursive: true })
  const temporary = path.join(run, 'temp'); fs.mkdirSync(temporary)
  const env = { ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary, npm_config_cache: cache, npm_config_update_notifier: 'false' }
  delete env.NODE_OPTIONS; delete env.NODE_PATH
  const result = { schemaVersion: '1.0.0', verdict: 'FAIL', failures: [], os: process.platform, arch: process.arch, node: process.version, commit: null, commands: [], measurements: [], limitations: ['maxRSS is process-wide peak RSS; per-file parser duration is not exposed by the installed CLI.', 'Mixed-language Python subprocess indexing is covered by the established suite; the guarded mixed smoke selects Rust and TypeScript.'] }
  let sequence = 0
  function command(label, executable, args, options = {}) {
    const number = String(++sequence).padStart(3, '0'), prefix = path.join(evidence, number + '-' + label)
    const start = performance.now()
    const r = spawnSync(executable, args, { cwd: root, env, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 120000, ...options })
    fs.writeFileSync(prefix + '.stdout', r.stdout ?? '', { flag: 'wx' })
    fs.writeFileSync(prefix + '.stderr', r.stderr ?? '', { flag: 'wx' })
    const record = { label, executable, args, exit: r.status, signal: r.signal, error: r.error?.message, durationMs: performance.now() - start }
    result.commands.push(record); write(prefix + '.exit.json', record)
    if (!options.allowFailure) assert.equal(r.status, 0, `${label}: ${r.stderr || r.error || r.stdout}`)
    return { ...r, durationMs: record.durationMs, prefix }
  }
  try {
    assert(/^v24\./.test(process.version), 'Node 24.x required')
    result.commit = command('commit', 'git', ['rev-parse', 'HEAD']).stdout.trim()
    const dirty = command('clean-inputs', 'git', ['status', '--porcelain', '--untracked-files=normal']).stdout
    assert.equal(dirty.trim(), '', 'Qualification requires frozen clean committed inputs')
    const packageFiles = ['package.json', 'package-lock.json']
    const before = Object.fromEntries(packageFiles.map(f => [f, sha(fs.readFileSync(path.join(root, f)))]))
    result.repositoryHashesBefore = before
    const pkg = read(path.join(root, 'package.json'))
    assert.equal(pkg.version, '1.14.0'); assert.equal(pkg.dependencies['web-tree-sitter'], '0.25.10'); assert.equal(pkg.dependencies['smol-toml'], '1.9.1')
    const assets = ['cli.js', 'assets/tree-sitter-rust-orchard.wasm', 'assets/tree-sitter-rust-orchard.LICENSE']
    result.builtAssets = Object.fromEntries(assets.map(f => [f, sha(fs.readFileSync(path.join(root, 'dist', f)))]))
    assert.equal(result.builtAssets[assets[1]], grammarHash)
    assert.equal(fs.statSync(path.join(root, 'dist', assets[1])).size, 2014566)
    assert.equal(sha(fs.readFileSync(path.join(root, 'src/languages/rust/assets/tree-sitter-rust-orchard.wasm'))), grammarHash)
    const npm = process.platform === 'win32' ? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js') : fs.realpathSync(command('npm-location', 'which', ['npm']).stdout.trim())
    assert(fs.existsSync(npm), 'npm CLI not found')
    const pack = JSON.parse(command('pack', process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', run]).stdout)[0]
    verifyInventory(pack.files); result.packageInventory = pack.files
    for (const f of pack.files) {
      assert(f.path === 'package.json' || pkg.files.some(allowed => f.path === allowed || f.path.startsWith(allowed + '/')), `Outside package allowlist: ${f.path}`)
      if (f.path.startsWith('dist/')) assert(assets.includes(f.path.slice(5)), `Unexpected built asset: ${f.path}`)
    }
    const tarball = contained(root, path.join(run, pack.filename)); result.packageHash = sha(fs.readFileSync(tarball))
    const consumer = path.join(run, 'consumer'); fs.mkdirSync(consumer)
    write(path.join(consumer, 'package.json'), { name: 'v114-b15-independent-consumer', version: '1.0.0', private: true, type: 'module', dependencies: { '@dailephd/my-dev-kit': 'file:' + tarball.replaceAll('\\', '/') } })
    command('install', process.execPath, [npm, 'install', '--prefix', consumer, '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], { cwd: consumer })
    result.repositoryHashesAfter = Object.fromEntries(packageFiles.map(f => [f, sha(fs.readFileSync(path.join(root, f)))]))
    assert.deepEqual(result.repositoryHashesAfter, before)
    result.consumerManifestHash = sha(fs.readFileSync(path.join(consumer, 'package.json')))
    result.consumerLockHash = sha(fs.readFileSync(path.join(consumer, 'package-lock.json')))
    const installed = path.join(consumer, 'node_modules/@dailephd/my-dev-kit')
    assert.equal(read(path.join(installed, 'package.json')).version, pkg.version)
    for (const f of assets) assert.equal(sha(fs.readFileSync(path.join(installed, 'dist', f))), result.builtAssets[f])
    for (const [name, version] of [['web-tree-sitter', '0.25.10'], ['smol-toml', '1.9.1']]) assert.equal(read(path.join(consumer, 'node_modules', name, 'package.json')).version, version)
    assert(!fs.existsSync(path.join(consumer, 'node_modules/tsx')), 'Development loader leaked')
    const license = fs.readFileSync(path.join(installed, 'dist', assets[2]), 'utf8')
    for (const text of ['Copyright (c) 2017 Maxim Sokolov', 'Permission is hereby granted, free of charge', 'The above copyright notice and this permission notice shall be included', 'THE SOFTWARE IS PROVIDED "AS IS"', 'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE', 'SOFTWARE.', 'tree-sitter-rust-orchard@0.16.10']) assert(license.includes(text), 'Incomplete MIT notice')
    result.cliHash = result.builtAssets['cli.js']; result.grammarHash = grammarHash; result.grammarBytes = 2014566
    const guard = path.join(run, 'guard.cjs'); fs.writeFileSync(guard, guardSource, { flag: 'wx' })
    const installedCli = path.join(installed, 'dist/cli.js')
    function cli(label, args, allowFailure = false) {
      const key = String(sequence + 1).padStart(3, '0'), telemetry = path.join(evidence, key + '-resources.json'), attempts = path.join(evidence, key + '-forbidden.txt')
      const r = command(label, process.execPath, ['--require', guard, installedCli, ...args], { env: { ...env, PATH: '', NODE_PATH: '', B15_TELEMETRY: telemetry, B15_ATTEMPTS: attempts }, cwd: consumer, allowFailure })
      assert(!fs.existsSync(attempts), `Forbidden API attempted: ${label}`)
      if (fs.existsSync(telemetry)) result.measurements.push({ label, durationMs: r.durationMs, ...read(telemetry) })
      return r
    }
    assert(cli('help', ['--help']).stdout.includes('Usage:'))
    assert.equal(cli('version', ['--version']).stdout.trim(), '1.13.0')
    const tracked = command('fixture-inventory', 'git', ['ls-files', '-z', 'tests/fixtures/v114-language/rust']).stdout.split('\0').filter(Boolean)
    const fixtureHashes = Object.fromEntries(tracked.map(f => [f, sha(fs.readFileSync(path.join(root, f)))]))
    result.fixtureHashes = fixtureHashes
    const copiedSources = {}
    function copyFixture(name, label = name) {
      const prefix = 'tests/fixtures/v114-language/rust/' + name + '/'
      const destination = contained(root, path.join(tests, label)); fs.mkdirSync(destination, { recursive: true })
      for (const f of tracked.filter(f => f.startsWith(prefix))) {
        const to = contained(destination, path.join(destination, f.slice(prefix.length)))
        fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(root, f), to, fs.constants.COPYFILE_EXCL)
        if (f.endsWith('.rs')) copiedSources[to] = sha(fs.readFileSync(to))
      }
      return destination
    }
    const snapshots = new Map(), containmentFailures = []
    result.sourceContainmentChecks = []
    function rejectedSource(label, indexDir, file, end = '1') {
      const response = cli(label, ['source', '--index', indexDir, '--file', file, '--start', '1', '--end', end, '--max-lines', end, '--format', 'json'], true)
      try {
        assertSourceRejected(response, label)
        result.sourceContainmentChecks.push({ label, exit: response.status, verdict: 'PASS' })
      } catch (error) {
        result.sourceContainmentChecks.push({ label, exit: response.status, verdict: 'FAIL', reason: error.message })
        containmentFailures.push(error.message)
      }
    }
    function index(label, fixture, roots, incremental = true, out = path.join(tests, label + '-index'), extra = []) {
      const args = ['index', '--root', fixture, ...roots.flatMap(r => ['--src', r]), '--out', out, '--json', ...(incremental ? ['--incremental'] : []), ...extra]
      const r = cli(label, args), payload = JSON.parse(r.stdout)
      const resource = result.measurements.findLast(m => m.label === label && m.maxRSSKiB)
      if (resource) assert(resource.maxRSSKiB <= 512 * 1024, `RSS safety boundary exceeded: ${label}`)
      const graph = read(path.join(out, 'code-graph.json')), symbols = read(path.join(out, 'symbol-index.json'))
      graphIntegrity(graph); assert.equal(symbols.schemaVersion, '3')
      const entry = { out, fixture, roots, graph, symbols, payload }
      snapshots.set(label, entry)
      result.measurements.push({ label, durationMs: r.durationMs, cache: payload.cache, incrementalRefresh: payload.incrementalRefresh, files: symbols.files.length, rustFiles: symbols.files.filter(f => f.language === 'rust').length, symbols: symbols.files.reduce((n, f) => n + f.symbols.length, 0), nodes: graph.nodes.length, edges: graph.edges.length, graphBytes: fs.statSync(path.join(out, 'code-graph.json')).size, symbolBytes: fs.statSync(path.join(out, 'symbol-index.json')).size, diagnostics: symbols.files.flatMap(f => (f.rustSyntaxFacts ?? []).filter(x => x.kind === 'diagnostic').map(x => ({ file: f.path, status: x.status, text: x.text }))) })
      return entry
    }
    const f13 = copyFixture('F13-retrieval'), exact = index('f13-cold', f13, ['src', 'tests'])
    const discovery = JSON.parse(cli('f13-discovery', ['index', '--root', f13, '--src', 'src', '--src', 'tests', '--out', path.join(tests, 'f13-discovery'), '--dry-run', '--json']).stdout)
    assert(JSON.stringify(discovery).includes('rust'), 'Rust source discovery label missing')
    const warm = index('f13-warm', f13, ['src', 'tests'], true, exact.out)
    assert.equal(warm.payload.cache.mode, 'incremental-no-change'); assert.deepEqual(warm.graph.nodes, exact.graph.nodes); assert.deepEqual(warm.graph.edges, exact.graph.edges)
    assert(exact.graph.edges.some(e => e.source === implId && e.target === methodId && e.kind === 'rust-impl-defines-symbol'))
    for (const kind of ['rust-impl-for-type', 'rust-impl-of-trait']) assert(exact.graph.edges.some(e => e.source === implId && e.kind === kind))
    const query = 'impl crate::alpha::Runner for crate::alpha::Worker run'
    const search = JSON.parse(cli('qualified-search', ['search', '--index', exact.out, '--query', query, '--intent', 'ownership', '--limit', '8', '--json']).stdout)
    assert.equal(search.results[0].id, methodId); result.ownerRank = 1
    const lookup = JSON.parse(cli('lookup', ['lookup', '--index', exact.out, '--node', methodId, '--json']).stdout)
    assert.equal(lookup.status, 'found')
    for (const depth of [1, 2]) cli('slice-' + depth, ['slice', '--index', exact.out, '--node', implId, '--depth', String(depth), '--json'])
    const source = JSON.parse(cli('source', ['source', '--index', exact.out, '--node', methodId, '--max-lines', '20', '--format', 'json']).stdout)
    assert.equal(source.startLine, 5); assert.equal(source.endLine, 7); assert(source.content.includes('        2')); assert(!source.content.includes('        1'))
    const capped = JSON.parse(cli('source-capped', ['source', '--index', exact.out, '--node', methodId, '--max-lines', '1', '--format', 'json']).stdout)
    assert.equal(capped.continuationCursor.nextStartLine, 6); assert.equal(capped.continuationCursor.symbolBoundaryKnown, true)
    const continuation = JSON.parse(cli('source-continuation', ['source', '--index', exact.out, '--file', 'src/impls.rs', '--symbol', methodId, '--continue-from', '6', '--max-lines', '1', '--format', 'json']).stdout)
    assert.equal(continuation.startLine, 6); assert.equal(continuation.endLine, 6)
    const regression = read(path.join(root, 'benchmarks/retrieval/v1.14/rust.json'))
    for (const role of ['architecture', 'implementation', 'test-implementation']) {
      const out = path.join(evidence, role + '-context.json'), audit = path.join(evidence, role + '-audit.json')
      const task = regression.tasks.find(t => t.id.startsWith('rust-v114-f13-') && t.execution?.role === role)
      const { kind, ...request } = task.execution
      const requestFile = path.join(evidence, role + '-request.json')
      write(requestFile, { schemaVersion: '1.0.0', query: task.query, ...request })
      cli(role, ['context', '--index', exact.out, '--request', requestFile, '--max-candidate-files', '12', '--max-source-slices', '6', '--max-graph-nodes', '40', '--max-graph-edges', '70', '--out', out, '--audit-out', audit, '--json'])
      const capsule = read(out); assert.equal(capsule.focus.focusNodeId, task.expectations.focus.nodeId)
      assert(!capsule.truncation.requiredEvidenceLost, `Required context lost: ${role}`)
      assert(task.expectations.adequacy.allowedStatuses.includes(capsule.contextAdequacy.status), `Context adequacy: ${role}`)
      result.measurements.push({ role, capsuleBytes: fs.statSync(out).size, adequacy: capsule.contextAdequacy, truncation: capsule.truncation })
    }
    const f04 = index('f04', copyFixture('F04-traits-impls'), ['src'])
    const runs = f04.symbols.files.flatMap(f => f.symbols).filter(s => s.name === 'run')
    assert.equal(runs.length, 5); assert.equal(new Set(runs.map(s => s.nodeId)).size, 5)
    for (const s of runs) cli('f04-source-' + s.location.line, ['source', '--index', f04.out, '--node', s.nodeId, '--max-lines', '20', '--format', 'json'])
    const workspace = copyFixture('F07-cargo-workspaces')
    const f07 = index('f07', workspace, ['crates/core/src'])
    assert(f07.graph.nodes.some(n => n.kind === 'rust-package')); assert(f07.graph.nodes.some(n => n.kind === 'rust-target'))
    assert(f07.symbols.files.every(f => f.path.startsWith('crates/core/src/')))
    assert(fs.existsSync(path.join(workspace, 'crates/cli/src/main.rs')))
    rejectedSource('source-unselected-workspace', f07.out, 'crates/cli/src/main.rs')
    const f11 = copyFixture('F11-incremental'), beforeIndex = index('f11-before', f11, ['src', 'crates/worker/src'])
    const changedIndex = path.join(tests, 'f11-changed-index'); fs.cpSync(beforeIndex.out, changedIndex, { recursive: true, errorOnExist: true, force: false })
    // Prepare the Cargo-only changed scenario before indexing its changed source.
    // Only generated Cargo metadata changes; original fixture bytes are immutable.
    const cargo = path.join(f11, 'Cargo.toml')
    const previousCargo = fs.readFileSync(cargo, 'utf8')
    assert(previousCargo.includes('cache-fixture'))
    fs.writeFileSync(cargo, previousCargo.replace('cache-fixture', 'b15-qualified-package'))
    const changed = index('f11-cargo-change', f11, ['src', 'crates/worker/src'], true, changedIndex)
    assert.equal(changed.payload.cache.mode, 'incremental-full-config-changed')
    const full = index('f11-full-parity', f11, ['src', 'crates/worker/src'], false)
    assert.deepEqual(changed.graph.nodes, full.graph.nodes); assert.deepEqual(changed.graph.edges, full.graph.edges)
    cli('self-diff', ['graph-diff', '--before', full.out, '--after', full.out, '--json'])
    const diff = JSON.parse(cli('changed-diff', ['graph-diff', '--before', beforeIndex.out, '--after', changed.out, '--json']).stdout)
    assert(JSON.stringify(diff).includes('b15-qualified-package'), 'Changed graph evidence missing')
    const damaged = path.join(tests, 'f11-damaged-index'); fs.cpSync(full.out, damaged, { recursive: true, errorOnExist: true, force: false })
    fs.appendFileSync(path.join(damaged, 'code-graph.json'), 'corrupt')
    const repaired = index('corrupt-cache', f11, ['src', 'crates/worker/src'], true, damaged)
    assert.notEqual(repaired.payload.cache.mode, 'incremental-no-change'); assert.equal(repaired.payload.incrementalRefresh.appliedScope, 'full')
    assert.deepEqual(repaired.graph.nodes, full.graph.nodes); assert.deepEqual(repaired.graph.edges, full.graph.edges)
    result.corpus = []
    for (const [name, roots] of [['async-service', ['src']], ['cli', ['src']], ['multi-crate-library', ['tracing/src', 'tracing-core/src']]]) {
      const fixture = copyFixture('F14-licensed-corpus/' + name, 'f14-' + name)
      result.corpus.push({ name, pinned: verifyPinned(fixture) })
      const cold = index('f14-' + name + '-cold', fixture, roots)
      const reused = index('f14-' + name + '-warm', fixture, roots, true, cold.out)
      assert.equal(reused.payload.cache.mode, 'incremental-no-change'); assert.deepEqual(cold.graph.nodes, reused.graph.nodes); assert.deepEqual(cold.graph.edges, reused.graph.edges)
      assert(cold.graph.nodes.some(n => n.kind === 'rust-module' && n.rustMetadata?.status !== 'RESOLVED'))
      const node = name === 'async-service' ? 'symbol:src/server.rs#run' : name === 'cli' ? 'symbol:src/config.rs#Config' : 'rust-package:tracing-core%2FCargo.toml'
      const source = JSON.parse(cli('f14-' + name + '-source', ['source', '--index', cold.out, '--node', node, '--max-lines', '20', '--format', 'json']).stdout)
      assert.equal(source.status, 'ok')
      const out = path.join(evidence, 'f14-' + name + '-context.json')
      cli('f14-' + name + '-context', ['context', '--index', cold.out, '--query', node, '--role', 'implementation', '--out', out, '--audit-out', path.join(evidence, 'f14-' + name + '-audit.json'), '--json'])
      const capsule = read(out)
      result.measurements.push({ label: 'f14-' + name + '-bounds', sourceLines: source.lineCount, sourceContinuation: source.continuationCursor ?? null, contextAdequacy: capsule.contextAdequacy, contextTruncation: capsule.truncation })
    }
    const mixed = index('f10', copyFixture('F10-mixed-language'), ['src'], true, path.join(tests, 'f10-index'), ['--exclude', 'src/worker.py'])
    assert(mixed.symbols.files.some(f => f.language === 'rust')); assert(mixed.symbols.files.some(f => f.language === 'typescript'))
    const conditional = index('f06', copyFixture('F06-conditional'), ['src'])
    assert(conditional.graph.nodes.some(n => n.rustMetadata?.status === 'CONDITIONAL'))
    const recovery = index('f08', copyFixture('F08-parser-robustness'), ['src'])
    for (const f of recovery.symbols.files) for (const fact of f.rustSyntaxFacts ?? []) if (fact.status === 'parser-error') assert.equal(fact.endLine, undefined, 'False trusted recovery boundary')
    const safe = path.join(tests, 'security'); fs.mkdirSync(path.join(safe, 'src'), { recursive: true })
    const outside = path.join(tests, 'outside'); fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'escape.rs'), 'pub fn escaped() {}\n', { flag: 'wx' })
    fs.symlinkSync(outside, path.join(safe, 'src/linked'), process.platform === 'win32' ? 'junction' : 'dir')
    fs.writeFileSync(path.join(safe, 'src/lib.rs'), 'macro_rules! danger { () => { fn expanded() {} } } danger!(); #[custom::execute] pub fn observed() {}\n', { flag: 'wx' })
    fs.writeFileSync(path.join(safe, 'build.rs'), 'compile_error!("must never run");', { flag: 'wx' })
    const safety = index('security', safe, ['src'])
    assert.deepEqual(safety.symbols.files.map(f => f.path), ['src/lib.rs'])
    assert(!safety.symbols.files.flatMap(f => f.symbols).some(s => ['expanded', 'escaped'].includes(s.name)))
    rejectedSource('source-escape', safety.out, '../outside/escape.rs')
    rejectedSource('source-symlink-escape', safety.out, 'src/linked/escape.rs')
    for (const [f, hash] of Object.entries(fixtureHashes)) assert.equal(sha(fs.readFileSync(path.join(root, f))), hash, `Fixture modified: ${f}`)
    for (const [f, hash] of Object.entries(copiedSources)) assert.equal(sha(fs.readFileSync(f)), hash, `Indexed Rust source modified: ${f}`)
    assert.deepEqual(Object.fromEntries(packageFiles.map(f => [f, sha(fs.readFileSync(path.join(root, f)))])), before)
    assert.equal(containmentFailures.length, 0, `Source containment qualification failed: ${containmentFailures.join('; ')}`)
    result.verdict = 'PASS'
  } catch (error) {
    result.failures.push(error.stack ?? String(error)); process.exitCode = 1
  } finally {
    write(path.join(evidence, 'qualification.json'), result)
    console.log(JSON.stringify({ verdict: result.verdict, commit: result.commit, evidence, failures: result.failures }))
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await qualify()
