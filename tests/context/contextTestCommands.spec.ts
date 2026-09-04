import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

// v1.10.1 Batch 3: grounded exact test-command derivation.
// Responsibility IDs: TST-B3-018, 019, 021, 022.

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

function writeVitestFixture(root: string): { indexOut: string } {
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'widgetRegistry.ts'), 'export function registerWidget(name: string): void {}\n')
  writeFileSync(join(src, 'widgetRegistry.spec.ts'), "import { registerWidget } from './widgetRegistry'\nexport const check = registerWidget\n")
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'cmd-fixture', version: '0.0.0', scripts: { test: 'vitest run' } }, null, 2))
  const indexOut = join(root, '.my-dev-kit')
  const result = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
  expect(result.status).toBe(0)
  return { indexOut }
}

describe('test-command derivation', () => {
  it('TST-B3-018: a grounded targeted test command is returned for a discovered related test', () => {
    const root = createTempRoot('my-dev-kit-v1-cmd-grounded-')
    const { indexOut } = writeVitestFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'test-implementation',
      changedFiles: ['src/widgetRegistry.ts'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    const fileScoped = capsule.testInfrastructure.testCommands.find((c: { scope: string }) => c.scope === 'file')
    expect(fileScoped).toBeDefined()
    expect(fileScoped.commandText).toBe('vitest run src/widgetRegistry.spec.ts')
    expect(fileScoped.framework).toBe('vitest')
    expect(fileScoped.testFiles).toEqual(['src/widgetRegistry.spec.ts'])

    const fullProject = capsule.testInfrastructure.testCommands.find((c: { scope: string }) => c.scope === 'full-project')
    expect(fullProject).toBeDefined()
    expect(fullProject.commandText).toBe('vitest run')
  })

  it('TST-B3-019: missing related-test evidence is reported unresolved, never invented', () => {
    const root = createTempRoot('my-dev-kit-v1-cmd-missing-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'lonelyProduction.ts'), 'export function doThing(): void {}\n')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'cmd-missing', version: '0.0.0', scripts: { test: 'vitest run' } }, null, 2))
    const indexOut = join(root, '.my-dev-kit')
    const indexResult = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
    expect(indexResult.status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'thing',
      role: 'test-implementation',
      changedFiles: ['src/lonelyProduction.ts'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    expect(capsule.testInfrastructure.testCommands.some((c: { scope: string }) => c.scope !== 'full-project')).toBe(false)
    expect(
      capsule.testInfrastructure.unresolved.some(
        (u: { evidenceKind: string; reason: string }) => u.evidenceKind === 'test-commands' && u.reason.includes('No related test file was discovered')
      )
    ).toBe(true)
  })

  it('TST-B3-021: requestedEvidenceKinds=test-infrastructure prioritizes and exposes matching groups for architecture/implementation roles too', () => {
    const root = createTempRoot('my-dev-kit-v1-cmd-requested-infra-')
    const { indexOut } = writeVitestFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'implementation',
      focusSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
      requestedEvidenceKinds: ['test-infrastructure'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    expect(capsule.roleContext.unsupportedRequestedEvidenceKinds).toEqual([])
    expect(capsule.testInfrastructure.relatedTests.some((t: { path: string }) => t.path === 'src/widgetRegistry.spec.ts')).toBe(true)
  })

  it('TST-B3-022: requestedEvidenceKinds=test-commands exposes grounded command evidence for architecture/implementation roles too', () => {
    const root = createTempRoot('my-dev-kit-v1-cmd-requested-commands-')
    const { indexOut } = writeVitestFixture(root)
    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'widget',
      role: 'architecture',
      focusSymbols: ['symbol:src/widgetRegistry.ts#registerWidget'],
      requestedEvidenceKinds: ['test-commands'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    expect(capsule.testInfrastructure.testCommands.length).toBeGreaterThan(0)
    expect(capsule.testInfrastructure.testCommands.some((c: { commandText: string | null }) => c.commandText === 'vitest run')).toBe(true)
  })
})

// v1.12.3 Batch 3: bounded, static Makefile "test" target discovery — the smallest
// confirmed grounded gap identified by the Python test-command discovery audit (a
// repository without package.json, such as a typical Python project, previously had
// no static source of a test command at all beyond an unsupported-framework warning
// for pytest.ini/tox.ini). Static inspection only: the target's literal recipe line
// is used verbatim, never executed, never fabricated from `tests/`/`test_*.py`
// file presence alone.
describe('Makefile "test" target discovery (Python/non-npm repositories)', () => {
  it('positive: an explicit pytest invocation in a Makefile "test" target is discovered verbatim, with Makefile provenance, deterministically across repeated runs', () => {
    const root = createTempRoot('my-dev-kit-v1-cmd-makefile-pytest-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'calc.py'), 'def add(a, b):\n    return a + b\n')
    writeFileSync(join(root, 'Makefile'), ['.PHONY: test', '', 'test:', '\tpytest tests/ -v', ''].join('\n'))
    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'calc',
      role: 'implementation',
      focusSymbols: ['symbol:src/calc.py#add'],
      requestedEvidenceKinds: ['test-infrastructure', 'test-commands'],
    })
    const outPath = join(root, 'capsule.json')

    const first = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(first.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))
    const command = capsule.testInfrastructure.testCommands.find((c: { commandText: string | null }) => c.commandText === 'pytest tests/ -v')
    expect(command).toBeDefined()
    expect(command.framework).toBe('pytest')
    expect(command.scope).toBe('full-project')
    expect(command.commandSource).toContain('Makefile target "test"')

    const outPath2 = join(root, 'capsule2.json')
    const second = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath2])
    expect(second.status).toBe(0)
    const capsule2 = JSON.parse(readFileSync(outPath2, 'utf8'))
    expect(capsule2.testInfrastructure.testCommands).toEqual(capsule.testInfrastructure.testCommands)
  })

  it('negative: a Python repository with no package.json and no Makefile "test" target fabricates nothing; the gap is reported unresolved, never invented as "pytest" or "python -m pytest"', () => {
    const root = createTempRoot('my-dev-kit-v1-cmd-makefile-absent-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'calc.py'), 'def add(a, b):\n    return a + b\n')
    // Python test-shaped file present, but never fabricates a command from its mere
    // existence (section 17: no inference from `tests/`/`test_*.py` presence).
    writeFileSync(join(src, 'test_calc.py'), 'from calc import add\n\ndef test_add():\n    assert add(1, 2) == 3\n')
    // A Makefile exists but has no "test" target, so it must not be mistaken for one.
    writeFileSync(join(root, 'Makefile'), ['.PHONY: lint', '', 'lint:', '\tflake8 src/', ''].join('\n'))
    const indexOut = join(root, '.my-dev-kit')
    expect(runCli(['index', '--root', root, '--src', 'src', '--out', indexOut]).status).toBe(0)

    const requestPath = writeRequest(root, 'req.json', {
      schemaVersion: '1.0.0',
      query: 'calc',
      role: 'implementation',
      focusSymbols: ['symbol:src/calc.py#add'],
      requestedEvidenceKinds: ['test-infrastructure', 'test-commands'],
    })
    const outPath = join(root, 'capsule.json')
    const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
    expect(result.status).toBe(0)
    const capsule = JSON.parse(readFileSync(outPath, 'utf8'))

    expect(capsule.testInfrastructure.testCommands).toEqual([])
    expect(
      capsule.testInfrastructure.testCommands.some((c: { commandText: string | null }) => c.commandText === 'pytest' || c.commandText === 'python -m pytest')
    ).toBe(false)
    expect(
      capsule.testInfrastructure.unresolved.some(
        (u: { evidenceKind: string; reason: string }) =>
          u.evidenceKind === 'test-commands' && u.reason.includes('Makefile')
      )
    ).toBe(true)
  })
})
