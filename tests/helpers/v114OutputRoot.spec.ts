import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  V114_DEFAULT_OUTPUT_ROOT,
  V114_OUTPUT_ROOT_ENV,
  allocateV114OutputDir,
  isPathWithin,
  resolveV114OutputRoot,
} from './v114OutputRoot.js'

// The allocator's own output hosts the fake projects, so this suite also stays project-contained.
const sandbox = allocateV114OutputDir('allocator-spec')
let counter = 0
function fakeProject(): string {
  const root = path.join(sandbox, `project-${counter++}`)
  mkdirSync(root, { recursive: true })
  return root
}

describe('v114 test output allocator', () => {
  it('accepts an absolute project-contained override root', () => {
    const projectRoot = fakeProject()
    const override = path.join(projectRoot, 'task', 'tests')
    const dir = allocateV114OutputDir('override-suite', { projectRoot, env: { [V114_OUTPUT_ROOT_ENV]: override } })
    expect(path.dirname(dir)).toBe(override)
    expect(statSync(dir).isDirectory()).toBe(true)
    expect(path.isAbsolute(dir)).toBe(true)
  })

  it('uses the project-contained default root when no override is set', () => {
    const projectRoot = fakeProject()
    const root = resolveV114OutputRoot({ projectRoot, env: {} })
    expect(root).toBe(path.join(projectRoot, ...V114_DEFAULT_OUTPUT_ROOT.split('/')))
    const dir = allocateV114OutputDir('default-suite', { projectRoot, env: {} })
    expect(path.dirname(dir)).toBe(root)
    expect(isPathWithin(projectRoot, dir)).toBe(true)
  })

  it('returns a distinct directory for every allocation', () => {
    const projectRoot = fakeProject()
    const dirs = Array.from({ length: 8 }, () => allocateV114OutputDir('same-suite', { projectRoot, env: {} }))
    expect(new Set(dirs).size).toBe(8)
  })

  it('never overwrites existing data in an existing root', () => {
    const projectRoot = fakeProject()
    const root = resolveV114OutputRoot({ projectRoot, env: {} })
    mkdirSync(root, { recursive: true })
    const sentinel = path.join(root, 'existing.txt')
    writeFileSync(sentinel, 'keep')
    const dir = allocateV114OutputDir('keep-suite', { projectRoot, env: {} })
    expect(existsSync(sentinel)).toBe(true)
    expect(statSync(dir).isDirectory()).toBe(true)
    expect(existsSync(path.join(dir, 'existing.txt'))).toBe(false)
  })

  it('keeps different suites in separate directories', () => {
    const projectRoot = fakeProject()
    const first = allocateV114OutputDir('suite-one', { projectRoot, env: {} })
    const second = allocateV114OutputDir('suite-two', { projectRoot, env: {} })
    expect(first).not.toBe(second)
    expect(path.basename(first).startsWith('suite-one-')).toBe(true)
    expect(path.basename(second).startsWith('suite-two-')).toBe(true)
    expect(isPathWithin(first, second)).toBe(false)
    expect(isPathWithin(second, first)).toBe(false)
  })

  it.each(['', 'Upper', 'has space', 'under_score', '-leading', 'x'.repeat(65)])('rejects invalid suite name %j', suite => {
    expect(() => allocateV114OutputDir(suite, { projectRoot: fakeProject(), env: {} })).toThrow(/invalid test suite/)
  })

  it.each(['../escape', 'a/../../b', 'a/b', 'a\\b', '..'])('rejects traversal suite %j', suite => {
    expect(() => allocateV114OutputDir(suite, { projectRoot: fakeProject(), env: {} })).toThrow(/invalid test suite/)
  })

  it('rejects absolute child paths and relative overrides', () => {
    const projectRoot = fakeProject()
    expect(() => allocateV114OutputDir(path.join(projectRoot, 'abs'), { projectRoot, env: {} })).toThrow(/invalid test suite/)
    expect(() => allocateV114OutputDir('/abs', { projectRoot, env: {} })).toThrow(/invalid test suite/)
    expect(() => resolveV114OutputRoot({ projectRoot, env: { [V114_OUTPUT_ROOT_ENV]: 'relative/root' } })).toThrow(/absolute/)
    expect(() => resolveV114OutputRoot({ projectRoot, env: { [V114_OUTPUT_ROOT_ENV]: '' } })).toThrow(/absolute/)
  })

  it('rejects a symbolic-link escape', () => {
    const projectRoot = fakeProject()
    const outside = fakeProject()
    const link = path.join(projectRoot, 'link')
    symlinkSync(outside, link, 'junction')
    const override = path.join(link, 'tests')
    expect(() => allocateV114OutputDir('link-suite', { projectRoot, env: { [V114_OUTPUT_ROOT_ENV]: override } })).toThrow(/symbolic link/)
    expect(existsSync(path.join(outside, 'tests'))).toBe(false)
  })

  it('rejects an override outside the project', () => {
    const projectRoot = fakeProject()
    const outsideProject = fakeProject()
    for (const outside of [outsideProject, os.tmpdir(), path.join(projectRoot, '..', 'sibling'), path.parse(projectRoot).root]) {
      expect(() => resolveV114OutputRoot({ projectRoot, env: { [V114_OUTPUT_ROOT_ENV]: outside } })).toThrow(/escapes the project root/)
    }
  })

  it('normalizes Windows and POSIX paths correctly', () => {
    expect(isPathWithin('C:\\proj', 'c:\\PROJ\\a\\b', path.win32)).toBe(true)
    expect(isPathWithin('C:\\proj', 'C:\\proj\\..\\other', path.win32)).toBe(false)
    expect(isPathWithin('C:\\proj', 'D:\\proj\\a', path.win32)).toBe(false)
    expect(isPathWithin('C:\\proj', 'C:\\projection', path.win32)).toBe(false)
    expect(isPathWithin('/proj', '/proj/a/b', path.posix)).toBe(true)
    expect(isPathWithin('/proj', '/proj/../other', path.posix)).toBe(false)
    expect(isPathWithin('/proj', '/projection', path.posix)).toBe(false)
    // A backslash is an ordinary filename character on POSIX, so it is not a traversal there.
    expect(isPathWithin('/proj', '/proj/a\\..\\b', path.posix)).toBe(true)
    expect(isPathWithin('/proj', '/proj/..\\b', path.posix)).toBe(true)
  })

  it('never selects a historical task root by default and rejects one as an override', () => {
    const projectRoot = fakeProject()
    const root = resolveV114OutputRoot({ projectRoot, env: {} })
    expect(path.relative(projectRoot, root)).not.toMatch(/v1\.14\.0-(b\d{2}|configured-imports)-\d{8}/)
    for (const historical of ['v1.14.0-b04-20261019', 'v1.14.0-b12-20261021', 'v1.14.0-b15-20261021', 'v1.14.0-configured-imports-20261020']) {
      const override = path.join(projectRoot, '.my-dev-kit-workflow', 'tmp', historical, 'tests')
      expect(() => resolveV114OutputRoot({ projectRoot, env: { [V114_OUTPUT_ROOT_ENV]: override } })).toThrow(/historical/)
    }
    const current = path.join(projectRoot, '.my-dev-kit-workflow', 'tmp', 'v1.14.0-b16-20261022', 'tests')
    expect(resolveV114OutputRoot({ projectRoot, env: { [V114_OUTPUT_ROOT_ENV]: current } })).toBe(current)
  })

  it('accepts ordinary current and future task roots', () => {
    const projectRoot = fakeProject()
    for (const name of ['v1.14.0-b16-20261022', 'v1.14.0-b17-20261101', 'v1.15.0-b03-20270101', 'v2.0.0-b01-20270201']) {
      const override = path.join(projectRoot, '.my-dev-kit-workflow', 'tmp', name, 'tests')
      expect(resolveV114OutputRoot({ projectRoot, env: { [V114_OUTPUT_ROOT_ENV]: override } })).toBe(override)
    }
  })

  it('leaves no tracked v1.14 test with an active hardcoded historical task root', () => {
    const pattern = new RegExp('tmp/v1\.14\.0-(b\d{2}|configured-imports)-\d{8}')
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.name === 'fixtures' || entry.name === 'node_modules' ? [] : entry.isDirectory() ? walk(path.join(dir, entry.name)) : /.ts$/.test(entry.name) ? [path.join(dir, entry.name)] : [])
    const offenders = walk(path.resolve('tests')).filter(file => pattern.test(readFileSync(file, 'utf8')))
    expect(offenders.map(file => path.relative(path.resolve('.'), file))).toEqual([])
  })
})
