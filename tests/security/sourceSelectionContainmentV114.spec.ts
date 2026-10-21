import { describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import mutableFs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { getSourceSlice } from '../../src/lookup/getSourceSlice.js'

const task = path.resolve('.my-dev-kit-workflow/tmp/v1.14.0-b15-20261021/tests')
const cli = process.env.B15_SOURCE_CLI ?? path.resolve('dist/cli.js')
const sentinel = 'ESCAPED_SOURCE_SENTINEL'
const harness = await import(pathToFileURL(path.resolve('scripts/qualification/v114RustMatrix.mjs')).href)
function next() {
  fs.mkdirSync(task, { recursive: true })
  for (let n = 1; ; n++) {
    const root = path.join(task, `source-containment-${String(n).padStart(3, '0')}`)
    if (!fs.existsSync(root)) { fs.mkdirSync(root); return root }
  }
}
function put(root: string, file: string, text: string) {
  const full = path.join(root, file)
  fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, text, { flag: 'wx' })
}
async function project(file = 'selected.ts', text = 'export function selected() { return "SELECTED"; }\n') {
  const parent = next(), root = path.join(parent, 'project'), out = path.join(parent, 'index')
  put(root, 'src/' + file, text)
  await runIndexCommand({ root, src: ['src'], out })
  return { parent, root, out, file: 'src/' + file }
}
function invoke(parent: string, args: string[]) {
  const guard = path.join(parent, `guard-${fs.readdirSync(parent).length}.cjs`)
  fs.writeFileSync(guard, harness.guardSource, { flag: 'wx' })
  const attempts = guard + '.attempts', resources = guard + '.resources.json'
  const result = spawnSync(process.execPath, ['--require', guard, cli, 'source', ...args], {
    encoding: 'utf8', windowsHide: true,
    env: { ...process.env, PATH: '', NODE_PATH: '', NODE_OPTIONS: '', TEMP: parent, TMP: parent, TMPDIR: parent, B15_ATTEMPTS: attempts, B15_TELEMETRY: resources },
  })
  expect(fs.existsSync(attempts)).toBe(false)
  fs.writeFileSync(guard + '.result.json', JSON.stringify({ args, exit: result.status, stdout: result.stdout, stderr: result.stderr }, null, 2), { flag: 'wx' })
  return result
}
function rejected(result: ReturnType<typeof invoke>, forbidden = sentinel) {
  expect(result.status, result.stdout + result.stderr).not.toBe(0)
  expect(result.stdout + result.stderr).not.toContain(forbidden)
  expect(result.stderr).not.toMatch(/--start is required|--end is required|unknown option/i)
}
function linkDirectory(target: string, link: string) { fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir') }

describe('B15 indexed selection and physical source containment', () => {
  it('rejects the original unselected F07 workspace member with valid line arguments', async () => {
    const parent = next(), root = path.join(parent, 'project'), out = path.join(parent, 'index')
    fs.cpSync(path.resolve('tests/fixtures/v114-language/rust/F07-cargo-workspaces'), root, { recursive: true, force: false })
    await runIndexCommand({ root, src: ['crates/core/src'], out })
    rejected(invoke(parent, ['--index', out, '--file', 'crates/cli/src/main.rs', '--start', '1', '--end', '1', '--max-lines', '1', '--format', 'json']), 'fn main() {}')
  })

  it('rejects the original linked-ancestor source escape without reading its target', async () => {
    const p = await project('lib.rs', 'pub fn selected() {}\n')
    put(p.parent, 'outside/escape.rs', `pub fn ${sentinel}() {}\n`)
    linkDirectory(path.join(p.parent, 'outside'), path.join(p.root, 'src/linked'))
    rejected(invoke(p.parent, ['--index', p.out, '--file', 'src/linked/escape.rs', '--start', '1', '--end', '1', '--max-lines', '1', '--format', 'json']))
  })

  it.each([
    ['new file inside selected directory', 'src/new.ts'],
    ['same-name unselected file', 'other/selected.ts'],
  ])('rejects %s rather than inferring selection from its location or name', async (_, file) => {
    const p = await project(); put(p.root, file, `export const value = '${sentinel}';\n`)
    rejected(invoke(p.parent, ['--index', p.out, '--file', file, '--start', '1', '--end', '1', '--max-lines', '1', '--format', 'json']))
  })

  it.each(['../outside/escape.ts', 'absolute'])('rejects outside-root request %s', async file => {
    const p = await project(); put(p.parent, 'outside/escape.ts', `export const value = '${sentinel}';\n`)
    const request = file === 'absolute' ? path.join(p.parent, 'outside/escape.ts') : file
    rejected(invoke(p.parent, ['--index', p.out, '--file', request, '--start', '1', '--end', '1', '--max-lines', '1', '--format', 'json']))
  })

  it.each([
    ['continuation', ['--file', 'src/new.ts', '--continue-from', '1', '--max-lines', '1']],
    ['fabricated node', ['--node', 'file:src/new.ts']],
    ['missing exact symbol', ['--file', 'src/new.ts', '--symbol', 'selected']],
  ])('rejects unselected source through %s', async (_, args) => {
    const p = await project(); put(p.root, 'src/new.ts', `export function selected() { return '${sentinel}'; }\n`)
    rejected(invoke(p.parent, ['--index', p.out, ...args, '--format', 'json']))
  })

  it.each([
    ['line-range', ['--file', 'src/selected.tsx', '--start', '1', '--end', '1', '--max-lines', '1']],
    ['symbol', ['--file', 'src/selected.tsx', '--symbol', 'App']],
    ['file node', ['--node', 'file:src/selected.tsx']],
    ['node continuation', ['--node', 'file:src/selected.tsx', '--continue']],
    ['symbol continuation', ['--file', 'src/selected.tsx', '--symbol', 'App', '--continue']],
    ['continue-from', ['--file', 'src/selected.tsx', '--continue-from', '1', '--max-lines', '1']],
    ['exact-match', ['--contains', sentinel]],
    ['source bundle', ['--file', 'src/selected.tsx', '--symbol', 'App', '--include-local-deps']],
    ['React region', ['--file', 'src/selected.tsx', '--react-region', 'App']],
    ['local component tree', ['--file', 'src/selected.tsx', '--symbol', 'App', '--include-local-component-tree']],
  ])('rejects an indexed path whose ancestor becomes an escaping link in %s mode', async (_, args) => {
    const p = await project('selected.tsx', 'export function App() { return <div>SELECTED</div>; }\n')
    put(p.parent, 'outside/selected.tsx', `export function App() { return <div>${sentinel}</div>; }\n`)
    fs.renameSync(path.join(p.root, 'src'), path.join(p.root, 'source-before-link'))
    linkDirectory(path.join(p.parent, 'outside'), path.join(p.root, 'src'))
    rejected(invoke(p.parent, ['--index', p.out, ...args, '--format', 'json']))
  })

  it('rejects a selected source whose physical file is missing', async () => {
    const p = await project(); fs.renameSync(path.join(p.root, p.file), path.join(p.root, 'retained-source.ts'))
    rejected(invoke(p.parent, ['--index', p.out, '--file', p.file, '--start', '1', '--end', '1', '--max-lines', '1', '--format', 'json']))
  })

  it('rejects an escaping Compose tree source read', async () => {
    const parent = next(), root = path.join(parent, 'project'), out = path.join(parent, 'index')
    fs.cpSync(path.resolve('tests/fixtures/compose-retrieval/basic-app'), root, { recursive: true, force: false, filter: file => !path.basename(file).startsWith('.my-dev-kit') })
    await runIndexCommand({ root, src: ['app/src/main'], out })
    const source = path.join(root, 'app/src/main'), outside = path.join(parent, 'outside-main')
    fs.renameSync(source, outside); linkDirectory(outside, source)
    rejected(invoke(parent, ['--index', out, '--composable', 'HomeScreen', '--json']))
    rejected(invoke(parent, ['--index', out, '--composable', 'HomeScreen', '--include-compose-tree', '--json']))
  })

  it.each([['--route', '/settings'], ['--storage-key', 'auth_token'], ['--ui', 'dashboard-panel']])('rejects an escaping frontend %s source', async (selector, query) => {
    const parent = next(), root = path.join(parent, 'project'), out = path.join(parent, 'index')
    fs.cpSync(path.resolve('examples/basic-react-tsx'), root, { recursive: true, force: false, filter: file => !path.basename(file).startsWith('.my-dev-kit') })
    await runIndexCommand({ root, src: ['src'], out })
    const args = ['--index', out, selector, query, '--context', '0', '--max-lines', '1', '--json']
    const positive = invoke(parent, args)
    expect(positive.status, positive.stderr).toBe(0); expect(JSON.parse(positive.stdout).blocks.length).toBeGreaterThan(0)
    const outside = path.join(parent, 'outside-src')
    fs.renameSync(path.join(root, 'src'), outside); linkDirectory(outside, path.join(root, 'src'))
    rejected(invoke(parent, args))
  })

  it('preserves exact Android test artifact source while rejecting direct selection and physical escape', async () => {
    const parent = next(), root = path.join(parent, 'project'), out = path.join(parent, 'index')
    fs.cpSync(path.resolve('tests/fixtures/android-test-semantic/basic-app'), root, { recursive: true, force: false, filter: file => !path.basename(file).startsWith('.my-dev-kit') })
    await runIndexCommand({ root, src: ['app/src/main'], out })
    const file = 'app/src/androidTest/kotlin/com/example/HomeScreenTest.kt'
    const graph = JSON.parse(fs.readFileSync(path.join(out, 'code-graph.json'), 'utf8'))
    const manifest = graph.nodes.find((value: {kind:string}) => value.kind === 'android-manifest-file')
    expect(manifest).toBeDefined()
    const manifestSource = invoke(parent, ['--index', out, '--node', manifest.id, '--json'])
    expect(manifestSource.status, manifestSource.stderr).toBe(0); expect(JSON.parse(manifestSource.stdout).content).toContain('<manifest')
    rejected(invoke(parent, ['--index', out, '--file', manifest.path, '--start', '1', '--end', '1', '--max-lines', '1', '--json']))
    const node = `android-test-method:${file}#HomeScreenTest.showsLoginButtonAndWelcomeText`
    expect(JSON.parse(fs.readFileSync(path.join(out, 'symbol-index.json'), 'utf8')).files.some((value: {path:string}) => value.path === file)).toBe(false)
    const positive = invoke(parent, ['--index', out, '--node', node, '--json'])
    expect(positive.status, positive.stderr).toBe(0); expect(JSON.parse(positive.stdout).content).toContain('onNodeWithTag')
    rejected(invoke(parent, ['--index', out, '--file', file, '--start', '1', '--end', '1', '--max-lines', '1', '--json']))
    const source = path.join(root, 'app/src/androidTest'), outside = path.join(parent, 'outside-tests')
    fs.renameSync(source, outside); linkDirectory(outside, source)
    rejected(invoke(parent, ['--index', out, '--node', node, '--json']))
  })

  it('does not use arbitrary graph metadata as source selection authority', async () => {
    const p = await project(); put(p.root, 'private.ts', `export const value = '${sentinel}';\n`)
    const graphPath = path.join(p.out, 'code-graph.json'), graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'))
    graph.nodes.push({ id: 'file:private.ts', kind: 'file', path: 'private.ts', label: 'private.ts' })
    fs.writeFileSync(graphPath, JSON.stringify(graph))
    rejected(invoke(p.parent, ['--index', p.out, '--node', 'file:private.ts', '--format', 'json']))
  })

  it('rejects a selected file replaced by an escaping file symlink', async () => {
    const p = await project(); put(p.parent, 'outside.ts', `export const value = '${sentinel}';\n`)
    fs.renameSync(path.join(p.root, p.file), path.join(p.root, 'retained.ts'))
    // Failure to create the mandatory fixture is a test failure, never a skipped security gate.
    fs.symlinkSync(path.join(p.parent, 'outside.ts'), path.join(p.root, p.file), 'file')
    rejected(invoke(p.parent, ['--index', p.out, '--file', p.file, '--start', '1', '--end', '1', '--max-lines', '1', '--json']))
  })

  it('preserves a selected path through a physically contained linked ancestor', async () => {
    const p = await project(); fs.renameSync(path.join(p.root, 'src'), path.join(p.root, 'retained'))
    linkDirectory(path.join(p.root, 'retained'), path.join(p.root, 'src'))
    const result = invoke(p.parent, ['--index', p.out, '--file', p.file, '--start', '1', '--end', '1', '--max-lines', '1', '--json'])
    expect(result.status, result.stderr).toBe(0); expect(JSON.parse(result.stdout).content).toContain('SELECTED')
  })

  it('uses platform-correct path casing for selected source authority', async () => {
    const p = await project()
    const file = process.platform === 'win32' ? p.file.toUpperCase() : 'src/Selected.ts'
    const result = invoke(p.parent, ['--index', p.out, '--file', file, '--start', '1', '--end', '1', '--max-lines', '1', '--json'])
    if (process.platform === 'win32') { expect(result.status, result.stderr).toBe(0); expect(JSON.parse(result.stdout).content).toContain('SELECTED') }
    else { rejected(result); expect(result.stderr).toContain('selected source inventory') }
  })

  it('detects a file substitution between validation and descriptor open', async () => {
    const p = await project(), target = path.join(p.root, p.file)
    const open = fs.openSync
    const spy = vi.spyOn(mutableFs, 'openSync').mockImplementation((...args: Parameters<typeof fs.openSync>) => {
      spy.mockRestore()
      syncBuiltinESMExports()
      fs.renameSync(target, target + '.retained')
      fs.writeFileSync(target, sentinel, { flag: 'wx' })
      return open(...args)
    })
    syncBuiltinESMExports()
    try {
      expect(() => getSourceSlice({ indexDir: p.out, projectRoot: p.root, filePath: p.file, startLine: 1, endLine: 1, maxLines: 1, mode: 'line-range' })).toThrow(/substitution/)
    } finally { spy.mockRestore(); syncBuiltinESMExports() }
  })

  it('detects changes to the open file before returning source bytes', async () => {
    const p = await project(), target = path.join(p.root, p.file), read = fs.readFileSync
    const spy = vi.spyOn(mutableFs, 'readFileSync').mockImplementation((...args: Parameters<typeof fs.readFileSync>) => {
      if (typeof args[0] === 'number') fs.appendFileSync(target, sentinel)
      return read(...args)
    })
    syncBuiltinESMExports()
    try {
      expect(() => getSourceSlice({ indexDir: p.out, projectRoot: p.root, filePath: p.file, startLine: 1, endLine: 1, maxLines: 1, mode: 'line-range' })).toThrow(/substitution/)
    } finally { spy.mockRestore(); syncBuiltinESMExports() }
  })

  it.each(['src', 'src/nested'])('allows only actual selected Cargo package manifest provenance for %s', async selection => {
    const p = await project('lib.rs', 'pub fn selected() {}\n')
    put(p.root, 'Cargo.toml', '[package]\nname="selected"\nversion="0.1.0"\nedition="2021"\n')
    put(p.root, 'src/nested/mod.rs', 'pub fn nested() {}\n')
    await runIndexCommand({ root: p.root, src: [selection], out: p.out })
    const result = invoke(p.parent, ['--index', p.out, '--node', 'rust-package:Cargo.toml', '--json'])
    expect(result.status, result.stderr).toBe(0); expect(JSON.parse(result.stdout).content).toContain('[package]')
    rejected(invoke(p.parent, ['--index', p.out, '--file', 'Cargo.toml', '--start', '1', '--end', '1', '--max-lines', '1', '--json']))
  })

  it.each([
    ['selected.ts', 'export function selected() { return 1; }\n'],
    ['selected.js', 'export function selected() { return 1; }\n'],
    ['selected.cjs', 'function selected() { return 1; }\nmodule.exports = { selected };\n'],
    ['selected.py', 'def selected():\n    return 1\n'],
    ['selected.rs', 'pub fn selected() {}\n'],
    ['Selected.kt', 'class Selected {}\n'],
    ['Selected.java', 'class Selected {}\n'],
  ])('preserves selected %s source', async (file, text) => {
    const p = await project(file, text)
    const result = invoke(p.parent, ['--index', p.out, '--file', p.file, '--start', '1', '--end', '1', '--max-lines', '1', '--format', 'json'])
    expect(result.status, result.stderr).toBe(0); expect(JSON.parse(result.stdout).content).toBe(text.split('\n')[0])
  })
})
