import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, cpSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertTestProcessSucceeded,
  reportTestProcessTiming,
  reportTestStageTiming,
  runTestProcess,
} from '../helpers/cliProcessDiagnostics.js'

const JAVA_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'java', 'basic')
const tempDirs: string[] = []
const CHANGED_SYMBOL_TEST_NAME =
  'reports a changed Java symbol node when its declaration line/kind shifts'

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

function copyFixture(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `my-dev-kit-v1-java-graphdiff-${label}-`))
  tempDirs.push(root)
  cpSync(JAVA_FIXTURE, root, { recursive: true })
  return root
}

function indexInto(root: string, out: string) {
  const result = runCli(['index', '--root', root, '--src', 'src', '--out', out, '--json'])
  expect(result.status).toBe(0)
  return join(root, out)
}

function measureStage<T>(stage: string, operation: () => T): T {
  const startedAt = new Date()
  const startTime = performance.now()
  try {
    return operation()
  } finally {
    reportTestStageTiming({
      testName: CHANGED_SYMBOL_TEST_NAME,
      stage,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Math.round((performance.now() - startTime) * 100) / 100,
    })
  }
}

function runDiagnosedCli(
  stage: string,
  args: string[],
  fixturePath: string,
  indexPaths: string[],
  expectedPaths: string[]
) {
  const result = runTestProcess({
    executable: process.execPath,
    args: [tsxCliPath(), 'src/cli.ts', ...args],
    cwd: process.cwd(),
    context: {
      testName: CHANGED_SYMBOL_TEST_NAME,
      stage,
      fixturePath,
      outputPath: indexPaths.at(-1),
      indexPaths,
      expectedPaths,
    },
  })
  reportTestProcessTiming(result)
  assertTestProcessSucceeded(result)
  return result
}

function indexIntoDiagnosed(root: string, out: string) {
  const indexPath = join(root, out)
  runDiagnosedCli(
    `${out} index generation`,
    ['index', '--root', root, '--src', 'src', '--out', out, '--json'],
    root,
    [indexPath],
    [join(indexPath, 'manifest.json'), join(indexPath, 'code-graph.json')]
  )
  return indexPath
}

afterEach(() => {
  const startedAt = new Date()
  const startTime = performance.now()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
  const testName = expect.getState().currentTestName
  if (testName?.endsWith(CHANGED_SYMBOL_TEST_NAME)) {
    reportTestStageTiming({
      testName,
      stage: 'cleanup',
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Math.round((performance.now() - startTime) * 100) / 100,
    })
  }
})

describe('graph-diff Java compatibility', () => {
  it('reports an added Java file/symbol node with no Java-specific special-casing needed', () => {
    const root = copyFixture('added')
    const before = indexInto(root, 'before')

    writeFileSync(join(root, 'src', 'Extra.java'), 'package com.example.models;\n\npublic class ExtraThing {\n}\n')
    const after = indexInto(root, 'after')

    const result = runCli(['graph-diff', '--before', before, '--after', after, '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)

    expect(parsed.nodes.added.map((n: { id: string }) => n.id)).toEqual(
      expect.arrayContaining(['file:src/Extra.java', 'symbol:src/Extra.java#ExtraThing'])
    )
  })

  // The macOS Node 22 four-worker candidate suite measured 20.622s versus
  // 4.04s isolated, 8.24s for this full file, and 4.05s serialized. This
  // intentionally three-process integration case completed every child
  // successfully, so keep measured contention headroom local to this test.
  it(CHANGED_SYMBOL_TEST_NAME, () => {
    const root = measureStage('fixture creation', () => copyFixture('changed'))
    const before = indexIntoDiagnosed(root, 'before')

    measureStage('fixture mutation', () =>
      writeFileSync(join(root, 'src', 'Extras.java'), 'package com.example.models;\n\npublic interface RenamedWidget {\n}\n')
    )
    const after = indexIntoDiagnosed(root, 'after')

    const result = runDiagnosedCli(
      'graph-diff invocation',
      ['graph-diff', '--before', before, '--after', after, '--json'],
      root,
      [before, after],
      [join(before, 'code-graph.json'), join(after, 'code-graph.json')]
    )
    const parsed = measureStage('output parsing', () => JSON.parse(result.stdout))

    measureStage('assertions', () => {
      expect(parsed.nodes.removed.some((n: { id: string }) => n.id === 'symbol:src/Extras.java#BaseWidget')).toBe(true)
      expect(parsed.nodes.added.some((n: { id: string }) => n.id === 'symbol:src/Extras.java#RenamedWidget')).toBe(true)
    })
  }, 30_000)
})
