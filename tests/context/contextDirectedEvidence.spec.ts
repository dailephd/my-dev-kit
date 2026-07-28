import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

// v1.10.3 Batch 4: directed file-level dependency/caller evidence correction.
// Confirmed Batch 3 finding: `EvidenceItemRef.id` for a plain file item is a bare
// repository-relative path, but code-graph file nodes (and therefore edge
// source/target) use `file:<path>`. `splitDependenciesAndCallers` indexed evidence
// by the bare ID, so file-level directed matches always failed and the group fell
// back to the full undirected adjacency set — silently classifying a *caller* as a
// *dependency* (and vice versa) whenever any directed relationship existed at all.
// Responsibility IDs: TST-B1304-001..007.

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function createTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(root)
  return root
}

function writeRequest(root: string, name: string, body: unknown): string {
  const filePath = join(root, name)
  writeFileSync(filePath, JSON.stringify(body, null, 2))
  return filePath
}

function runContext(indexOut: string, requestPath: string, outPath: string, extraArgs: string[] = []) {
  return runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath, ...extraArgs])
}

function groupItemPaths(capsule: { evidenceGroups: { kind: string; items: { path?: string }[] }[] }, kind: string): string[] {
  const group = capsule.evidenceGroups.find((g) => g.kind === kind)
  if (!group) throw new Error(`group ${kind} not found`)
  return group.items.map((i) => i.path).filter((p): p is string => !!p)
}

describe('directed dependency/caller evidence correction (Batch 4)', () => {
  it('TST-B1304-001: a file the focus file imports is classified as a directed dependency', () => {
    const root = createTempRoot('my-dev-kit-v1-directed-dep-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'dependency.ts'), "export function dep(): string {\n  return 'dep'\n}\n")
    writeFileSync(join(src, 'focus.ts'), "import { dep } from './dependency'\n\nexport function focusFn(): string {\n  return dep()\n}\n")

    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate the focus function and its dependency',
      focusFiles: ['src/focus.ts'],
      focusSymbols: ['symbol:src/focus.ts#focusFn'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    // Directed matching alone must place the dependency here: this fixture has only
    // one adjacent file, so a broad undirected fallback would happen to produce the
    // same single-item result — the exact-set assertion in TST-B1304-003 is what
    // actually proves directed (not fallback) matching; this test proves the basic
    // positive case works at all.
    expect(groupItemPaths(capsule, 'dependencies')).toEqual(['src/dependency.ts'])
  })

  it('TST-B1304-002: a file that imports the focus file is classified as a directed caller', () => {
    const root = createTempRoot('my-dev-kit-v1-directed-caller-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'focus.ts'), 'export function focusFn(): string {\n  return "ok"\n}\n')
    writeFileSync(join(src, 'caller.ts'), "import { focusFn } from './focus'\n\nexport function callerFn(): string {\n  return focusFn()\n}\n")

    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate the focus function and its caller',
      focusFiles: ['src/focus.ts'],
      focusSymbols: ['symbol:src/focus.ts#focusFn'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    expect(groupItemPaths(capsule, 'callers-and-callees')).toContain('src/caller.ts')
  })

  it('TST-B1304-003: dependency, caller, and an unrelated file are separated correctly — directed matching, not fallback, governs the result', () => {
    const root = createTempRoot('my-dev-kit-v1-directed-separation-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'dependency.ts'), "export function dep(): string {\n  return 'dep'\n}\n")
    writeFileSync(join(src, 'focus.ts'), "import { dep } from './dependency'\n\nexport function focusFn(): string {\n  return dep()\n}\n")
    writeFileSync(join(src, 'caller.ts'), "import { focusFn } from './focus'\n\nexport function callerFn(): string {\n  return focusFn()\n}\n")
    // Adjacent to caller.ts (not to focus.ts) — if the dependencies/callers-and-callees
    // groups ever fell back to the full undirected adjacency set rooted deeper in the
    // graph, or if direction were reversed, this file could leak into the wrong group.
    writeFileSync(join(src, 'unrelated.ts'), "import { callerFn } from './caller'\n\nexport function unrelatedFn(): string {\n  return callerFn()\n}\n")

    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate the focus function, its dependency, and its caller',
      focusFiles: ['src/focus.ts'],
      focusSymbols: ['symbol:src/focus.ts#focusFn'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    // "dependencies" is the one-directional group: it must contain the true
    // dependency, must NOT contain the caller (the historical bug — a caller
    // masquerading as a dependency via the undirected fallback), and must not
    // contain the two-hops-away unrelated file.
    expect(groupItemPaths(capsule, 'dependencies')).toEqual(['src/dependency.ts'])

    // "callers-and-callees" is documented (pre-Batch-4, unchanged) to union both
    // directions, so it legitimately contains both the caller and the dependency —
    // but never the unrelated, non-adjacent file.
    const callersAndCallees = groupItemPaths(capsule, 'callers-and-callees')
    expect(callersAndCallees).toContain('src/caller.ts')
    expect(callersAndCallees).not.toContain('src/unrelated.ts')
  })

  it('TST-B1304-004: symbol-level directed dependency/caller matching (already correct before this batch) remains unchanged', () => {
    const root = createTempRoot('my-dev-kit-v1-directed-symbol-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'dependency.ts'), "export function dep(): string {\n  return 'dep'\n}\n")
    writeFileSync(join(src, 'focus.ts'), "import { dep } from './dependency'\n\nexport function focusFn(): string {\n  return dep()\n}\n")

    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut, '--call-graph']).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate the focus function and its dependency',
      focusSymbols: ['symbol:src/focus.ts#focusFn'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    expect(groupItemPaths(capsule, 'dependencies')).toContain('src/dependency.ts')
  })

  it('TST-B1304-005: the same underlying file is never reported twice across a file candidate and a node candidate', () => {
    const root = createTempRoot('my-dev-kit-v1-directed-dedupe-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'focus.ts'), 'export function focusFn(): string {\n  return "ok"\n}\n')
    writeFileSync(join(src, 'caller.ts'), "import { focusFn } from './focus'\n\nexport function callerFn(): string {\n  return focusFn()\n}\n")

    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate the focus function and its caller',
      focusFiles: ['src/focus.ts'],
      focusSymbols: ['symbol:src/focus.ts#focusFn'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const callersAndCallees = capsule.evidenceGroups.find((g: { kind: string }) => g.kind === 'callers-and-callees')
    const callerEntries = callersAndCallees.items.filter((i: { path?: string }) => i.path === 'src/caller.ts')
    expect(callerEntries.length).toBe(1)
    const ids = callersAndCallees.items.map((i: { id: string }) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('TST-B1304-006: a focus file with no import/depends-on/calls relationships at all produces empty, non-fabricated dependency/caller groups', () => {
    const root = createTempRoot('my-dev-kit-v1-directed-isolated-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'isolated.ts'), 'export function isolatedFn(): void {}\n')

    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'isolatedFn',
      focusFiles: ['src/isolated.ts'],
      focusSymbols: ['symbol:src/isolated.ts#isolatedFn'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    expect(groupItemPaths(capsule, 'dependencies')).toEqual([])
    expect(groupItemPaths(capsule, 'callers-and-callees')).toEqual([])
  })

  it('TST-B1304-007: directed dependency/caller separation is identical for a repository path containing spaces', () => {
    const root = createTempRoot('my-dev-kit-v1-directed-crossplat-')
    const src = join(root, 'src', 'my module')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'dependency.ts'), "export function dep(): string {\n  return 'dep'\n}\n")
    writeFileSync(join(src, 'focus.ts'), "import { dep } from './dependency'\n\nexport function focusFn(): string {\n  return dep()\n}\n")
    writeFileSync(join(src, 'caller.ts'), "import { focusFn } from './focus'\n\nexport function callerFn(): string {\n  return focusFn()\n}\n")

    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      role: 'implementation',
      query: 'Locate the focus function, its dependency, and its caller',
      focusFiles: ['src/my module/focus.ts'],
      focusSymbols: ['symbol:src/my module/focus.ts#focusFn'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runContext(indexOut, requestPath, outPath)
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const deps = groupItemPaths(capsule, 'dependencies')
    expect(deps).toEqual(['src/my module/dependency.ts'])
    for (const p of deps) expect(p.includes('\\')).toBe(false)
    expect(groupItemPaths(capsule, 'callers-and-callees')).toContain('src/my module/caller.ts')
  })
})
