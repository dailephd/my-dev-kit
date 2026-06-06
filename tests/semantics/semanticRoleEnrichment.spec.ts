import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CodeGraph } from '../../src/graph/codeGraphTypes.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'
import { runCli } from '../lookup/testCli.js'

const tempDirs: string[] = []

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'my-dev-kit-semantic-enrichment-'))
  tempDirs.push(root)
  const src = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(
    join(src, 'models.ts'),
    [
      'export interface User {',
      '  id: string',
      '  email?: string | null',
      '}',
      '',
      'export type Session = {',
      '  id: string',
      '}',
      '',
    ].join('\n')
  )
  writeFileSync(
    join(src, 'service.ts'),
    "import type { User } from './models'\nexport function formatUser(user: User): string { return user.email ?? user.id }\n"
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

describe('semantic role enrichment', () => {
  it('adds compact semantic roles and artifact refs to symbol-index symbols', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    const symbolIndex = readJson<SymbolIndex>(join(indexDir, 'symbol-index.json'))
    const userSymbol = symbolIndex.files
      .find((file) => file.path === 'src/models.ts')
      ?.symbols.find((symbol) => symbol.name === 'User')
    const helperSymbol = symbolIndex.files
      .find((file) => file.path === 'src/service.ts')
      ?.symbols.find((symbol) => symbol.name === 'formatUser')

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
    expect(userSymbol).not.toHaveProperty('fields')
    expect(userSymbol).not.toHaveProperty('relationships')
    expect(helperSymbol?.semanticRoles).toBeUndefined()
  })

  it('adds compact semantic roles and artifact refs to code-graph symbol nodes while preserving structure', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    const codeGraph = readJson<CodeGraph>(join(indexDir, 'code-graph.json'))
    const userNode = codeGraph.nodes.find((node) => node.id === 'symbol:src/models.ts#User')
    const serviceNode = codeGraph.nodes.find((node) => node.id === 'symbol:src/service.ts#formatUser')

    expect(userNode).toMatchObject({
      id: 'symbol:src/models.ts#User',
      kind: 'symbol',
      semanticRoles: [
        expect.objectContaining({
          role: 'data-entity',
          artifactRefs: expect.arrayContaining([
            expect.objectContaining({ artifact: 'data-model.json', id: 'entity:User' }),
            expect.objectContaining({ artifact: 'data-model-graph.json', id: 'data-model-entity:User' }),
          ]),
          evidenceRefs: expect.arrayContaining([
            expect.objectContaining({
              filePath: 'src/models.ts',
              symbolId: 'symbol:src/models.ts#User',
              line: 1,
            }),
          ]),
        }),
      ],
    })
    expect(userNode?.kind).toBe('symbol')
    expect(serviceNode?.semanticRoles).toBeUndefined()
    expect(codeGraph.nodes.some((node) => ['entity', 'field'].includes(String(node.kind)))).toBe(false)
    expect(codeGraph.nodes.some((node) => node.id.startsWith('data-model-'))).toBe(false)
  })

  it('keeps structural IDs stable and also enriches compact graph symbols in symbol-index', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    const symbolIndex = readJson<SymbolIndex>(join(indexDir, 'symbol-index.json'))
    const codeGraph = readJson<CodeGraph>(join(indexDir, 'code-graph.json'))

    expect(codeGraph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(['file:src/models.ts', 'symbol:src/models.ts#User', 'symbol:src/service.ts#formatUser'])
    )
    expect(symbolIndex.graph?.symbols.find((symbol) => symbol.name === 'User')?.semanticRoles?.[0].role).toBe(
      'data-entity'
    )
  })

  it('does not introduce boolean dataModel flags or a symbolType shortcut', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    const symbolIndexText = readFileSync(join(indexDir, 'symbol-index.json'), 'utf8')
    const codeGraphText = readFileSync(join(indexDir, 'code-graph.json'), 'utf8')

    expect(symbolIndexText).not.toContain('"dataModel"')
    expect(codeGraphText).not.toContain('"dataModel"')
    expect(symbolIndexText).not.toContain('"symbolType"')
    expect(codeGraphText).not.toContain('"symbolType"')
  })

  it('keeps enriched artifacts current across repeated indexing', () => {
    const root = createFixture()
    const indexDir = indexFixture(root)
    const first = readJson<SymbolIndex>(join(indexDir, 'symbol-index.json'))
    expect(first.files.flatMap((file) => file.symbols).some((symbol) => symbol.semanticRoles?.length)).toBe(true)

    indexFixture(root)
    const second = readJson<SymbolIndex>(join(indexDir, 'symbol-index.json'))
    const userSymbol = second.files
      .find((file) => file.path === 'src/models.ts')
      ?.symbols.find((symbol) => symbol.name === 'User')

    expect(userSymbol?.semanticRoles?.[0].role).toBe('data-entity')
  })
})
