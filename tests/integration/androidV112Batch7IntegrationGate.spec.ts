/**
 * v1.12.0 Batch 7 final implementation gate: full-versus-incremental
 * equivalence, graph-diff, and determinism across the complete v1.12.0
 * Android artifact family (classification, component dependencies, Compose
 * ownership) over the canonical combined-app fixture. Locks in two real
 * ordering defects found and fixed during this batch:
 *
 * 1. `classification.json`'s `entries[]` had no final deterministic sort
 *    after concatenating base + Android graph-node classifications
 *    (runIndexCommand.ts) - same entries, same content, different array
 *    order between a full rebuild and an incremental partial rebuild.
 * 2. `symbol-index.json`'s `files[]` relied on raw directory-walk order with
 *    no final sort (symbol-index/builder.ts), while the incremental partial
 *    rebuild path (partialRebuild.ts) already sorted by path - so the same
 *    file set could serialize in a different order between the two paths.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, cpSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CANONICAL_FIXTURE_ROOT } from './androidV110CombinedFixture.spec.js'

const tempDirs: string[] = []

function runCli(args: string[]) {
  return spawnSync(process.execPath, [tsxCliPath(), 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
  })
}

function tsxCliPath(): string {
  return join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
}

function copyFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-android-v112-batch7-'))
  tempDirs.push(root)
  cpSync(CANONICAL_FIXTURE_ROOT, root, { recursive: true })
  return root
}

function runIndex(root: string, out: string, extra: string[] = []) {
  const result = runCli(['index', '--root', root, '--src', 'app/src/main', '--src', 'core/src/main', '--out', out, '--json', ...extra])
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout)
}

function runIncremental(root: string, out: string) {
  return runIndex(root, out, ['--incremental'])
}

function readArtifact(root: string, out: string, filename: string) {
  return JSON.parse(readFileSync(join(root, out, filename), 'utf8'))
}

const VOLATILE_KEYS = new Set(['createdAt', 'generatedAt', 'buildTime', 'buildTimeMs', 'projectRoot', 'indexDir'])

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (VOLATILE_KEYS.has(key)) continue
      out[key] = normalize((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

function expectSemanticallyEqual(a: unknown, b: unknown, label: string): void {
  expect(normalize(a), label).toEqual(normalize(b))
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('v1.12.0 Batch 7: full versus incremental equivalence over the complete artifact family', () => {
  it('TST-702: clean full and initial-incremental output are semantically identical for every v1.12.0 artifact', () => {
    const root = copyFixture()
    runIndex(root, 'full')
    const incResult = runIncremental(root, 'incremental')
    expect(incResult.cache.mode).toBe('incremental-full-initial')

    for (const file of [
      'symbol-index.json',
      'code-graph.json',
      'classification.json',
      'android-project.json',
      'android-components.json',
      'android-gradle.json',
      'android-manifest.json',
      'android-resources.json',
      'android-navigation.json',
      'android-compose-semantic.json',
    ]) {
      expectSemanticallyEqual(readArtifact(root, 'full', file), readArtifact(root, 'incremental', file), file)
    }
  })

  it('TST-703: a no-change incremental run reports no drift', () => {
    const root = copyFixture()
    runIncremental(root, 'incremental')
    const second = runIncremental(root, 'incremental')
    expect(second.cache.mode).toBe('incremental-no-change')
    expect(second.cache.changedFileSummary).toMatchObject({ addedCount: 0, changedCount: 0, removedCount: 0 })
  })

  it('TST-706: a ViewModel-to-repository dependency mutation converges between full and incremental rebuilds, with the stale edge/fact removed and graph-diff reporting the change', () => {
    const root = copyFixture()
    runIncremental(root, 'incremental')
    runIndex(root, 'before')

    const viewModelPath = join(root, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'combined', 'UserViewModel.kt')
    writeFileSync(
      viewModelPath,
      ['package com.example.combined', '', 'import androidx.lifecycle.ViewModel', '', 'class UserViewModel : ViewModel()', ''].join('\n')
    )

    const incMutated = runIncremental(root, 'incremental')
    expect(incMutated.cache.mode).toBe('incremental-partial')
    expect(incMutated.cache.changedFileSummary.changedCount).toBe(1)
    runIndex(root, 'full-mutated')

    for (const file of ['symbol-index.json', 'code-graph.json', 'classification.json', 'android-components.json']) {
      expectSemanticallyEqual(readArtifact(root, 'full-mutated', file), readArtifact(root, 'incremental', file), file)
    }

    const mutatedComponents = readArtifact(root, 'incremental', 'android-components.json')
    expect(mutatedComponents.dependencyFacts.some((f: { relationshipKind: string }) => f.relationshipKind === 'viewmodel-uses-repository')).toBe(false)
    const mutatedGraph = readArtifact(root, 'incremental', 'code-graph.json')
    expect(mutatedGraph.edges.some((e: { kind: string }) => e.kind === 'viewmodel-uses-repository')).toBe(false)

    const diffResult = runCli(['graph-diff', '--before', join(root, 'before'), '--after', join(root, 'full-mutated'), '--json'])
    expect(diffResult.status).toBe(0)
    const diff = JSON.parse(diffResult.stdout)
    expect(diff.edges.removed.some((e: { kind: string }) => e.kind === 'viewmodel-uses-repository')).toBe(true)
    expect(diff.classification.changed.length).toBeGreaterThan(0)
  })
})

describe('v1.12.0 Batch 7: artifact determinism', () => {
  it('TST-722: three clean full indexes of byte-identical input produce semantically identical artifacts (ordering-sensitive)', () => {
    const root = copyFixture()
    runIndex(root, 'run1')
    runIndex(root, 'run2')
    runIndex(root, 'run3')

    for (const file of ['symbol-index.json', 'code-graph.json', 'classification.json', 'android-components.json', 'android-compose-semantic.json']) {
      const a = normalize(readArtifact(root, 'run1', file))
      const b = normalize(readArtifact(root, 'run2', file))
      const c = normalize(readArtifact(root, 'run3', file))
      expect(a, `${file} run1 vs run2`).toEqual(b)
      expect(b, `${file} run2 vs run3`).toEqual(c)
    }
  })
})
