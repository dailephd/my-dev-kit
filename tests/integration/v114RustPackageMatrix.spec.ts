import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const harness = await import(pathToFileURL(path.resolve('scripts/qualification/v114RustMatrix.mjs')).href)
const root = path.resolve('.')

describe('B15 installed-package qualification boundaries', () => {
  it('uses a short task-contained TEMP alias without overwriting an existing owner', () => {
    const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')
    const script = workflow.match(/- name: Prepare B15 task environment\s+run: node -e "([^\r\n]+)"/)?.[1]
    expect(script).toBeDefined()
    const run = harness.newRun(root, 'tests'), checkout = path.join(run, 'checkout'), envFile = path.join(run, 'github-env')
    fs.mkdirSync(checkout)
    const invoke = () => spawnSync(process.execPath, ['--eval', script!], {
      cwd: checkout, windowsHide: true, encoding: 'utf8', env: { ...process.env, GITHUB_ENV: envFile },
    })
    const result = invoke()
    expect(result.status, result.stderr).toBe(0)
    const alias = path.join(checkout, '.my-dev-kit-workflow/b15-tmp')
    const target = path.join(checkout, harness.taskRoot, 'tests/temp')
    expect(fs.realpathSync(alias)).toBe(fs.realpathSync(target))
    const environment = fs.readFileSync(envFile, 'utf8')
    for (const name of ['TEMP', 'TMP', 'TMPDIR']) expect(environment).toContain(`${name}=${alias}\n`)
    expect(invoke().status).not.toBe(0)
    expect(fs.realpathSync(alias)).toBe(fs.realpathSync(target))
    for (const prefix of ['/home/runner/work/my-dev-kit/my-dev-kit', '/Users/runner/work/my-dev-kit/my-dev-kit']) {
      expect(Buffer.byteLength(path.posix.join(prefix, '.my-dev-kit-workflow/b15-tmp/tsx-1001/123456.pipe'))).toBeLessThan(100)
    }
  })

  it('does not accept argument rejection as source-containment evidence', () => {
    expect(() => harness.assertSourceRejected({ status: 2, stderr: '--start is required when --end is provided.' }, 'escape')).toThrow('did not exercise containment')
    expect(() => harness.assertSourceRejected({ status: 0, stdout: 'excluded source', stderr: '' }, 'escape')).toThrow('returned excluded content')
    expect(() => harness.assertSourceRejected({ status: 2, stderr: 'File path escapes the indexed project root' }, 'escape')).not.toThrow()
  })
  it('accepts its checkout identity and rejects another script root', () => {
    const script = path.resolve('scripts/qualification/v114RustMatrix.mjs')
    expect(() => harness.verifyCheckout(root, script)).not.toThrow()
    if (process.platform === 'win32') expect(() => harness.verifyCheckout(root.toUpperCase(), script)).not.toThrow()
    expect(() => harness.verifyCheckout(path.resolve('tests'), script)).toThrow('committed checkout harness')
  })
  it('rejects lexical escape and owner root aliases', () => {
    expect(() => harness.contained(root, path.join(root, '..', 'outside'))).toThrow('outside task owner')
    expect(() => harness.contained(root, root)).toThrow('outside task owner')
  })

  it('preserves earlier runs and allocates numbered task-owned children', () => {
    const first = harness.newRun(root, 'tests'), second = harness.newRun(root, 'tests')
    expect(first).not.toBe(second)
    expect(fs.existsSync(first)).toBe(true)
    expect(second.startsWith(path.join(root, harness.taskRoot, 'tests'))).toBe(true)
  })

  it('rejects realpath escape through directory links', () => {
    const run = harness.newRun(root, 'tests'), owner = path.join(run, 'owner'), outside = path.join(run, 'outside')
    fs.mkdirSync(owner); fs.mkdirSync(outside)
    fs.symlinkSync(outside, path.join(owner, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => harness.contained(owner, path.join(owner, 'link', 'new-file'))).toThrow('Symlink escapes')
  })

  it('verifies every pinned source/license blob and detects corruption', () => {
    const fixture = path.resolve('tests/fixtures/v114-language/rust/F14-licensed-corpus/async-service')
    expect(harness.verifyPinned(fixture)).toHaveLength(9)
    expect(() => harness.verifyPinned(fixture, fs.readFileSync(path.join(fixture, 'SOURCE.md'), 'utf8'), () => Buffer.from('corrupted'))).toThrow('Pinned size')
  })

  it('rejects private package data and missing assets', () => {
    expect(() => harness.verifyInventory(Array.from({ length: 52 }, () => ({ path: 'reports/private.md' })))).toThrow('Private package entry')
    expect(() => harness.verifyInventory(Array.from({ length: 52 }, () => ({ path: 'README.md' })))).toThrow('Missing dist/cli.js')
  })

  it('rejects duplicate identities, dangling endpoints and deferred calls', () => {
    const graph = { schemaVersion: '1.1.0', nodes: [{ id: 'a' }], edges: [] }
    expect(() => harness.graphIntegrity(graph)).not.toThrow()
    expect(() => harness.graphIntegrity({ ...graph, nodes: [{ id: 'a' }, { id: 'a' }] })).toThrow('Duplicate graph node')
    expect(() => harness.graphIntegrity({ ...graph, edges: [{ id: 'e', source: 'a', target: 'missing' }] })).toThrow('Dangling endpoint')
    expect(() => harness.graphIntegrity({ ...graph, edges: [{ id: 'e', source: 'a', target: 'a', kind: 'calls' }] })).toThrow('Deferred Rust call')
  })

  it.each([
    "require('node:child_process').spawnSync('cargo', ['--version'])",
    "require('node:child_process').execFileSync('git', ['status'])",
    "require('node:https').get('https://example.invalid')",
    "fetch('https://example.invalid')",
  ])('guards the actual Node child before forbidden operation: %s', expression => {
    const run = harness.newRun(root, 'tests'), guard = path.join(run, 'guard.cjs')
    const attempts = path.join(run, 'attempts.txt'), telemetry = path.join(run, 'resources.json')
    fs.writeFileSync(guard, harness.guardSource, { flag: 'wx' })
    const result = spawnSync(process.execPath, ['--require', guard, '--eval', expression], {
      windowsHide: true, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', B15_ATTEMPTS: attempts, B15_TELEMETRY: telemetry, TEMP: run, TMP: run, TMPDIR: run },
    })
    expect(result.status).not.toBe(0)
    expect(fs.readFileSync(attempts, 'utf8')).toMatch(/child_process|https|fetch/)
    expect(JSON.parse(fs.readFileSync(telemetry, 'utf8')).maxRSSKiB).toBeGreaterThan(0)
  })

  it('keeps only the exact optional Git freshness probe unavailable without executing it', () => {
    const run = harness.newRun(root, 'tests'), guard = path.join(run, 'guard.cjs'), attempts = path.join(run, 'attempts.txt'), telemetry = path.join(run, 'resources.json')
    fs.writeFileSync(guard, harness.guardSource, { flag: 'wx' })
    const result = spawnSync(process.execPath, ['--require', guard, '--eval', "require('node:child_process').execFileSync('git',['rev-parse','HEAD'])"], {
      windowsHide: true, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', B15_ATTEMPTS: attempts, B15_TELEMETRY: telemetry, TEMP: run, TMP: run, TMPDIR: run },
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('optional Git provenance unavailable')
    expect(fs.existsSync(attempts)).toBe(false)
    expect(JSON.parse(fs.readFileSync(telemetry, 'utf8')).blockedProvenanceProbes).toBe(1)
  })
})
