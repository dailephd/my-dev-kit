import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const harness = await import(pathToFileURL(path.resolve('scripts/qualification/v114RustMatrix.mjs')).href)
const root = path.resolve('.')

describe('B15 installed-package qualification boundaries', () => {
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
})
