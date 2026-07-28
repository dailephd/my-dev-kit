import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertTestProcessSucceeded,
  runTestProcess,
  type TestProcessResult,
} from './cliProcessDiagnostics.js'

const cleanupPaths: string[] = []

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-cli-diagnostics-'))
  cleanupPaths.push(root)
  return root
}

function runNode(source: string, fixturePath?: string) {
  return runTestProcess({
    executable: process.execPath,
    args: ['-e', source],
    cwd: process.cwd(),
    context: {
      testName: expect.getState().currentTestName ?? 'cli process diagnostic helper',
      fixturePath,
      expectedPaths: fixturePath ? [join(fixturePath, 'expected.txt')] : [],
    },
  })
}

function captureFailure(result: TestProcessResult): string {
  try {
    assertTestProcessSucceeded(result)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('Expected process assertion to fail.')
}

afterEach(() => {
  vi.restoreAllMocks()
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop()
    if (path) rmSync(path, { recursive: true, force: true })
  }
})

describe('CLI process failure diagnostics', () => {
  it('keeps a successful process successful and quiet', () => {
    const stderr = vi.spyOn(process.stderr, 'write')
    const stdout = vi.spyOn(process.stdout, 'write')
    const result = runNode("process.stdout.write('ok')")

    expect(() => assertTestProcessSucceeded(result)).not.toThrow()
    expect(result.stdout).toBe('ok')
    expect(stderr).not.toHaveBeenCalled()
    expect(stdout).not.toHaveBeenCalled()
  })

  it('reports a nonzero exit with process, path, output, and artifact evidence', () => {
    const root = fixture()
    writeFileSync(join(root, 'expected.txt'), 'artifact')
    const result = runNode(
      "process.stdout.write('stdout-marker'); process.stderr.write('stderr-marker'); process.exit(7)",
      root
    )

    const message = captureFailure(result)
    expect(message).toContain('"exitCode": 7')
    expect(message).toContain('"signal": null')
    expect(message).toContain('"spawnError": null')
    expect(message).toContain('stdout-marker')
    expect(message).toContain('stderr-marker')
    expect(message).toContain(`"executable": ${JSON.stringify(process.execPath)}`)
    expect(message).toContain('"arguments":')
    expect(message).toContain('"readableCommand":')
    expect(message).toContain(`"cwd": ${JSON.stringify(process.cwd())}`)
    expect(message).toContain(`"fixturePath": ${JSON.stringify(root)}`)
    expect(message).toContain('"expectedArtifacts":')
    expect(message).toContain('"exists": true')
    expect(message).toContain('"entries":')
    expect(message).toContain('"path": "expected.txt"')
    expect(message).toContain('"truncated": false')
  })

  it('distinguishes a spawn failure from a normal nonzero exit', () => {
    const result = runTestProcess({
      executable: join(tmpdir(), 'definitely-missing-my-dev-kit-executable'),
      args: ['--not-run'],
      cwd: process.cwd(),
      context: { testName: 'spawn failure' },
    })

    const message = captureFailure(result)
    expect(result.spawnError).not.toBeNull()
    expect(result.exitCode).toBeNull()
    expect(message).toContain('"spawnError": {')
    expect(message).toContain('"exitCode": null')
  })

  it('does not let diagnostic collection failure replace the process failure', () => {
    const root = fixture()
    const result = runNode("process.stderr.write('original-error'); process.exit(9)", root)

    expect(() =>
      assertTestProcessSucceeded(result, {
        inspectFixture: () => {
          throw new Error('fixture inspector failed')
        },
      })
    ).toThrowError(/original-error[\s\S]*fixture inspection failed: Error: fixture inspector failed/)
  })
})
