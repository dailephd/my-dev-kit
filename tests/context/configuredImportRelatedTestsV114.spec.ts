import { it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { buildIndex } from '../../src/symbol-index/builder.js'
import { discoverTestInfrastructure } from '../../src/context/testInfrastructureDiscovery.js'
import { allocateV114OutputDir } from '../helpers/v114OutputRoot.js'

it('uses configured imports for related tests, preserving exact named ownership and unrelated-name negatives', () => {
  const task = allocateV114OutputDir('configured-import-related-tests-v114')
  mkdirSync(task, { recursive: true })
  const root = mkdtempSync(join(task, 'related-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'tsconfig.json'), '{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}')
  writeFileSync(join(root, 'src/owner.ts'), 'export function run() {}\nexport function other() {}')
  writeFileSync(join(root, 'src/unrelated.ts'), 'export function run() {}')
  writeFileSync(join(root, 'src/owner.test.ts'), 'import {run as local} from "@/owner"; test("run", () => local());')
  writeFileSync(join(root, 'src/file.test.ts'), 'import owner from "@/owner"; test("run", () => owner());')
  const index = buildIndex({ repoRoot: root, sourceRoots: ['src'] }).index
  expect(index.graph!.fileDeps).toEqual([
    { from: 'src/file.test.ts', to: 'src/owner.ts', kind: 'import' },
    { from: 'src/owner.test.ts', to: 'src/owner.ts', kind: 'import' },
  ])
  const discover = (symbolsOfInterest: string[]) => discoverTestInfrastructure({ repoRoot: root, symbolIndex: index, role: 'test-implementation', filesOfInterest: ['src/owner.ts'], symbolsOfInterest, requestedEvidenceKinds: [] })
  const result = discover(['symbol:src/owner.ts#run'])
  expect(result.relatedTests.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: 'src/owner.test.ts', relationship: 'references-selected-production-symbol' }),
    expect.objectContaining({ path: 'src/file.test.ts', relationship: 'imports-selected-production-file' }),
  ]))
  for (const symbol of ['symbol:src/owner.ts#other', 'symbol:src/unrelated.ts#run']) {
    expect(discover([symbol]).relatedTests.items.every(r => r.relationship !== 'references-selected-production-symbol')).toBe(true)
  }
  index.graph!.fileDeps = []
  expect(discover(['symbol:src/owner.ts#run']).relatedTests.items).toEqual([])
})
