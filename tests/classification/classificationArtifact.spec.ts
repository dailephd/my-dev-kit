import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'
import type { IndexManifest } from '../../src/indexing/manifestTypes.js'
import type { ClassificationArtifact } from '../../src/classification/classificationTypes.js'
import { runCli } from '../lookup/testCli.js'

const tempDirs: string[] = []

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-classification-'))
  tempDirs.push(root)
  const src = join(root, 'src')
  const commandsDir = join(src, 'commands')
  mkdirSync(commandsDir, { recursive: true })
  writeFileSync(
    join(src, 'models.ts'),
    ['export interface User {', '  id: string', '  email?: string | null', '}', ''].join('\n')
  )
  writeFileSync(
    join(src, 'service.ts'),
    "import type { User } from './models'\nexport function formatUser(user: User): string { return user.email ?? user.id }\n"
  )
  writeFileSync(
    join(commandsDir, 'exampleCommand.ts'),
    "export function registerExampleCommand(): void { /* no-op fixture command */ }\n"
  )
  return root
}

function indexFixture(root: string): string {
  const result = runCli(['index', '--root', root, '--src', 'src', '--out', '.my-dev-kit', '--json'])
  expect(result.status).toBe(0)
  return join(root, '.my-dev-kit')
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('classification artifact', () => {
  it('TST-001/AC-001: writes classification.json with schemaVersion 1.0.0 and >=1 entry', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    const classification = readJson<ClassificationArtifact>(join(indexDir, 'classification.json'))

    expect(classification.schemaVersion).toBe('1.0.0')
    expect(classification.entries.length).toBeGreaterThanOrEqual(1)
  })

  it('TST-002/AC-001: manifest.json registers the classification analyzer and artifact path', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    const manifest = readJson<IndexManifest>(join(indexDir, 'manifest.json'))

    const analyzer = manifest.analyzers?.find((entry) => entry.id === 'classification')
    expect(analyzer?.status).toMatch(/complete|partial/)
    expect(analyzer?.artifacts?.[0]?.path).toBe('classification.json')
  })

  it('TST-003: a stale classification.json is replaced (not appended to) on re-index', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    writeFileSync(join(indexDir, 'classification.json'), '{ "stale": true, "entries": [] }', 'utf8')

    const secondIndexDir = indexFixture(root)
    const classification = readJson<ClassificationArtifact>(join(secondIndexDir, 'classification.json'))

    expect(classification.schemaVersion).toBe('1.0.0')
    expect(classification.entries.length).toBeGreaterThanOrEqual(1)
  })

  it('TST-004/AC-005: two index runs on an unchanged source tree produce identical classification entries', () => {
    // createdAt legitimately differs run-to-run (as it does for every other
    // artifact in this codebase); determinism (BEH-071) is about entries/
    // ordering/values, not the timestamp field.
    const root = createFixture()
    const indexDir = indexFixture(root)
    const first = readJson<ClassificationArtifact>(join(indexDir, 'classification.json'))

    indexFixture(root)
    const second = readJson<ClassificationArtifact>(join(indexDir, 'classification.json'))

    expect(second.entries).toEqual(first.entries)
    expect(second.schemaVersion).toBe(first.schemaVersion)
  })

  it('TST-016: a command-handler file receives a command-handler classification entry', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    const classification = readJson<ClassificationArtifact>(join(indexDir, 'classification.json'))

    const commandEntry = classification.entries.find((entry) => entry.targetId === 'file:src/commands/exampleCommand.ts')
    expect(commandEntry?.classifications).toEqual([
      expect.objectContaining({ role: 'command-handler', confidence: 'certain' }),
    ])
  })

  it('TST-040/AC-003: symbol-index.json and code-graph.json receive classificationRoles/classificationRefs for a classified symbol', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    const symbolIndex = readJson<SymbolIndex>(join(indexDir, 'symbol-index.json'))
    const codeGraph = readJson<CodeGraph>(join(indexDir, 'code-graph.json'))

    const userSymbol = symbolIndex.files
      .find((file) => file.path === 'src/models.ts')
      ?.symbols.find((symbol) => symbol.name === 'User')
    expect(userSymbol?.classificationRoles).toEqual([
      expect.objectContaining({ role: 'canonical-type', uncertainty: 'certain' }),
    ])
    expect(userSymbol?.classificationRefs).toEqual([
      expect.objectContaining({ artifact: 'classification.json' }),
    ])

    const userNode = codeGraph.nodes.find((node) => node.id === 'symbol:src/models.ts#User')
    expect(userNode?.classificationRoles).toEqual(userSymbol?.classificationRoles)
    expect(userNode?.classificationRefs).toEqual(userSymbol?.classificationRefs)
  })

  it('TST-042/AC-004: existing semanticRoles/artifactRefs are unchanged after the classification analyzer runs', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    const symbolIndex = readJson<SymbolIndex>(join(indexDir, 'symbol-index.json'))
    const userSymbol = symbolIndex.files
      .find((file) => file.path === 'src/models.ts')
      ?.symbols.find((symbol) => symbol.name === 'User')

    expect(userSymbol?.semanticRoles?.[0]).toMatchObject({
      role: 'data-entity',
      subtype: 'canonical-type',
      confidence: 'explicit',
      source: 'typescript-model-analyzer',
    })
    expect(userSymbol?.artifactRefs?.map((ref) => ref.artifact)).toEqual([
      'data-model.json',
      'data-model-graph.json',
    ])
  })

  it('AC-006/INV-004: an unclassified symbol has classificationRoles/classificationRefs absent, not an empty array', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    const symbolIndex = readJson<SymbolIndex>(join(indexDir, 'symbol-index.json'))
    const helperSymbol = symbolIndex.files
      .find((file) => file.path === 'src/service.ts')
      ?.symbols.find((symbol) => symbol.name === 'formatUser')

    expect(helperSymbol?.classificationRoles).toBeUndefined()
    expect(helperSymbol?.classificationRefs).toBeUndefined()
  })
})
