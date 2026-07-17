import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../lookup/testCli.js'

// v1.10.1 Batch 3: bounded fixture/factory/mock/setup/configuration/package-script discovery.
// Responsibility IDs: TST-B3-010, 011, 012, 013, 014, 015, 016, 017, 020.

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

/** Production owner + related test importing a fixture, a test-scoped factory, and a
 * mock; plus an unrelated fixture never imported by any related test. */
function writeInfraFixture(root: string): { indexOut: string } {
  const src = join(root, 'src')
  mkdirSync(join(src, 'fixtures'), { recursive: true })
  mkdirSync(join(src, 'test-utils'), { recursive: true })
  mkdirSync(join(src, '__mocks__'), { recursive: true })
  writeFileSync(join(src, 'widgetRegistry.ts'), 'export function registerWidget(name: string): void {}\n')
  // A production "builder" that must never be misclassified as a test factory (TST-B3-013).
  writeFileSync(join(src, 'widgetConfigBuilder.ts'), 'export function buildWidgetConfig(): object { return {} }\n')
  writeFileSync(join(src, 'fixtures', 'widgetFixture.ts'), 'export const widgetFixture = { name: "sample" }\n')
  writeFileSync(join(src, 'fixtures', 'unrelatedFixture.ts'), 'export const unrelatedFixture = { name: "unused" }\n')
  writeFileSync(join(src, 'test-utils', 'widgetTestFactory.ts'), 'export function makeTestWidget(): object { return { name: "built" } }\n')
  writeFileSync(join(src, '__mocks__', 'widgetMock.ts'), 'export const widgetMock = { registerWidget: () => {} }\n')
  writeFileSync(
    join(src, 'widgetRegistry.spec.ts'),
    [
      "import { registerWidget } from './widgetRegistry'",
      "import { widgetFixture } from './fixtures/widgetFixture'",
      "import { makeTestWidget } from './test-utils/widgetTestFactory'",
      "import { widgetMock } from './__mocks__/widgetMock'",
      'export const check = { registerWidget, widgetFixture, makeTestWidget, widgetMock }',
      '',
    ].join('\n')
  )

  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'infra-fixture',
        version: '0.0.0',
        scripts: {
          test: 'vitest run',
          typecheck: 'tsc --noEmit',
          build: 'echo build',
          unrelatedScript: 'echo hi',
        },
        devDependencies: { vitest: '^4.0.0' },
      },
      null,
      2
    )
  )
  writeFileSync(
    join(root, 'vitest.config.ts'),
    [
      "import { defineConfig } from 'vitest/config'",
      'export default defineConfig({',
      '  test: {',
      "    include: ['src/**/*.spec.ts'],",
      "    setupFiles: ['./src/testSetup.ts'],",
      '    testTimeout: 20000,',
      '  },',
      '})',
      '',
    ].join('\n')
  )
  writeFileSync(join(src, 'testSetup.ts'), 'export {}\n')

  const indexOut = join(root, '.my-dev-kit')
  const result = runCli(['index', '--root', root, '--src', 'src', '--out', indexOut])
  expect(result.status).toBe(0)
  return { indexOut }
}

function runTestRoleRequest(root: string, indexOut: string) {
  const requestPath = writeRequest(root, 'req.json', {
    schemaVersion: '1.0.0',
    query: 'widget',
    role: 'test-implementation',
    changedFiles: ['src/widgetRegistry.ts'],
  })
  const outPath = join(root, 'capsule.json')
  const result = runCli(['context', '--index', indexOut, '--request', requestPath, '--out', outPath])
  expect(result.status).toBe(0)
  return JSON.parse(readFileSync(outPath, 'utf8'))
}

describe('test-infrastructure discovery', () => {
  it('TST-B3-010/011: a fixture imported by a related test is discovered; unrelated fixtures are excluded', () => {
    const root = createTempRoot('my-dev-kit-v1-infra-fixtures-')
    const { indexOut } = writeInfraFixture(root)
    const capsule = runTestRoleRequest(root, indexOut)

    const paths = capsule.testInfrastructure.fixtures.map((f: { path: string }) => f.path)
    expect(paths).toContain('src/fixtures/widgetFixture.ts')
    expect(paths).not.toContain('src/fixtures/unrelatedFixture.ts')
  })

  it('TST-B3-012/013: a test factory referenced by a related test is discovered; a production builder is never mislabeled as a factory', () => {
    const root = createTempRoot('my-dev-kit-v1-infra-factories-')
    const { indexOut } = writeInfraFixture(root)
    const capsule = runTestRoleRequest(root, indexOut)

    const factoryPaths = capsule.testInfrastructure.factories.map((f: { path: string }) => f.path)
    expect(factoryPaths).toContain('src/test-utils/widgetTestFactory.ts')
    expect(factoryPaths).not.toContain('src/widgetConfigBuilder.ts')

    // Also never appears anywhere as a "factory" via the owners/dependencies groups.
    const factoryGroup = capsule.evidenceGroups.find((g: { kind: string }) => g.kind === 'factories')
    expect(factoryGroup.items.some((i: { path: string }) => i.path === 'src/widgetConfigBuilder.ts')).toBe(false)
  })

  it('TST-B3-014: a directly used mock is discovered', () => {
    const root = createTempRoot('my-dev-kit-v1-infra-mocks-')
    const { indexOut } = writeInfraFixture(root)
    const capsule = runTestRoleRequest(root, indexOut)

    const mockPaths = capsule.testInfrastructure.mocks.map((m: { path: string }) => m.path)
    expect(mockPaths).toContain('src/__mocks__/widgetMock.ts')
  })

  it('TST-B3-015: configured setup files are discovered', () => {
    const root = createTempRoot('my-dev-kit-v1-infra-setup-')
    const { indexOut } = writeInfraFixture(root)
    const capsule = runTestRoleRequest(root, indexOut)

    const setupPaths = capsule.testInfrastructure.setupFiles.map((s: { path: string }) => s.path)
    expect(setupPaths).toContain('src/testSetup.ts')
    const setupItem = capsule.testInfrastructure.setupFiles.find((s: { path: string }) => s.path === 'src/testSetup.ts')
    expect(setupItem.relationship).toBe('configured-in-test-configuration')
  })

  it('TST-B3-016: active Vitest test configuration is identified and bounded fields are extracted', () => {
    const root = createTempRoot('my-dev-kit-v1-infra-config-')
    const { indexOut } = writeInfraFixture(root)
    const capsule = runTestRoleRequest(root, indexOut)

    const config = capsule.testInfrastructure.testConfigurations.find((c: { path: string }) => c.path === 'vitest.config.ts')
    expect(config).toBeDefined()
    expect(config.framework).toBe('vitest')
    expect(config.supported).toBe(true)
    expect(config.fields.include).toEqual(['src/**/*.spec.ts'])
    expect(config.fields.testTimeout).toBe(20000)
    expect(config.fields.setupFiles).toEqual(['./src/testSetup.ts'])
  })

  it('TST-B3-017: relevant package.json test scripts are selected without returning every script', () => {
    const root = createTempRoot('my-dev-kit-v1-infra-scripts-')
    const { indexOut } = writeInfraFixture(root)
    const capsule = runTestRoleRequest(root, indexOut)

    const scriptNames = capsule.testInfrastructure.packageScripts.map((s: { name: string }) => s.name)
    expect(scriptNames).toContain('test')
    expect(scriptNames).toContain('typecheck')
    expect(scriptNames).toContain('build')
    expect(scriptNames).not.toContain('unrelatedScript')
  })

  it('TST-B3-020: an unsupported test-framework config produces an honest unresolved/warning entry, not silent support', () => {
    const root = createTempRoot('my-dev-kit-v1-infra-unsupported-')
    const { indexOut } = writeInfraFixture(root)
    writeFileSync(join(root, 'jest.config.js'), 'module.exports = { testEnvironment: "node" }\n')
    const capsule = runTestRoleRequest(root, indexOut)

    const jestConfig = capsule.testInfrastructure.testConfigurations.find((c: { path: string }) => c.path === 'jest.config.js')
    expect(jestConfig).toBeDefined()
    expect(jestConfig.supported).toBe(false)
    expect(capsule.testInfrastructure.unresolved.some((u: { evidenceKind: string; reason: string }) => u.evidenceKind === 'test-configuration' && u.reason.includes('jest'))).toBe(
      true
    )
  })

  it('28.3: missing-infrastructure fixture reports unresolved evidence and never invents a command', () => {
    const root = createTempRoot('my-dev-kit-v1-infra-missing-')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'lonelyProduction.ts'), 'export function doThing(): void {}\n')
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

    expect(capsule.testInfrastructure.relatedTests).toEqual([])
    expect(capsule.testInfrastructure.testCommands.some((c: { scope: string }) => c.scope === 'file' || c.scope === 'suite')).toBe(false)
    expect(
      capsule.testInfrastructure.unresolved.some((u: { evidenceKind: string; reason: string }) => u.evidenceKind === 'test-commands' && u.reason.includes('No package.json'))
    ).toBe(true)
    expect(
      capsule.testInfrastructure.unresolved.some((u: { evidenceKind: string }) => u.evidenceKind === 'related-tests')
    ).toBe(true)
  })

  it('28.4: ambiguous-infrastructure fixture preserves ambiguity without arbitrary selection', () => {
    const root = createTempRoot('my-dev-kit-v1-infra-ambiguous-')
    const { indexOut } = writeInfraFixture(root)
    writeFileSync(join(root, 'jest.config.js'), 'module.exports = {}\n')
    const capsule = runTestRoleRequest(root, indexOut)

    expect(capsule.testInfrastructure.testConfigurations.length).toBeGreaterThanOrEqual(2)
    const paths = capsule.testInfrastructure.testConfigurations.map((c: { path: string }) => c.path)
    expect(paths).toContain('vitest.config.ts')
    expect(paths).toContain('jest.config.js')
    expect(capsule.testInfrastructure.warnings.some((w: string) => w.includes('Multiple test-configuration files'))).toBe(true)
  })
})
