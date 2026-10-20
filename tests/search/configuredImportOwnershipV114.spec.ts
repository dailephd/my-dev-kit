import { it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, cpSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { readIndexManifest } from '../../src/indexing/readIndexManifest.js'
import { searchIndex } from '../../src/search/searchIndex.js'

it('retains relevance and ownership candidates and verifies public CLI lookup/slice/source/context/diff', async () => {
  const task = resolve('.my-dev-kit-workflow/tmp/v1.14.0-configured-imports-20261020/tests')
  mkdirSync(task, { recursive: true })
  const out = mkdtempSync(join(task, 'retrieval-'))
  const root = mkdtempSync(join(task, 'retrieval-project-'))
  cpSync(resolve('tests/fixtures/v114-path-alias/src'), join(root, 'src'), { recursive: true, force: false, errorOnExist: true })
  const before = join(out, 'before')
  await runIndexCommand({ root, src: ['src'], out: before })
  writeFileSync(join(root, 'tsconfig.json'), readFileSync(resolve('tests/fixtures/v114-path-alias/tsconfig.json')))
  await runIndexCommand({ root, src: ['src'], out })
  const symbolIndex = JSON.parse(readFileSync(join(out, 'symbol-index.json'), 'utf8'))
  const codeGraph = JSON.parse(readFileSync(join(out, 'code-graph.json'), 'utf8'))
  const resolved = readIndexManifest(out)
  for (const intent of [undefined, 'ownership'] as const) {
    const result = searchIndex({ symbolIndex, codeGraph, resolved, query: 'ToolPageTemplate', intent, limit: 10 })
    expect(result.results.some(r => r.path === 'src/component/tool/ToolPageTemplate.tsx')).toBe(true)
  }
  const cli = (...args: string[]) => JSON.parse(execFileSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('src/cli.ts'), ...args], { encoding: 'utf8', windowsHide: true }))
  const file = 'src/app/tool/[slug]/page.tsx'
  const lookup = cli('lookup', '--index', out, '--node', 'file:' + file, '--depth', '1', '--json')
  expect(JSON.stringify(lookup)).toContain('file:src/component/tool/ToolPageTemplate.tsx')
  for (const depth of ['1', '2']) {
    const slice = cli('slice', '--index', out, '--node', 'file:' + file, '--depth', depth, '--json')
    expect(JSON.stringify(slice)).toContain('file:src/module/tool/registry.ts')
    expect(JSON.stringify(slice)).toContain('imports')
  }
  const source = cli('source', '--index', out, '--file', file, '--start', '1', '--end', '6', '--json')
  expect(JSON.stringify(source)).toContain('@/component/tool/ToolPageTemplate')
  const capsule = cli('context', '--index', out, '--query', 'ToolPageTemplate', '--role', 'implementation', '--out', join(out, 'context.json'), '--json')
  expect(JSON.stringify(capsule)).toContain('src/component/tool/ToolPageTemplate.tsx')
  const diff = cli('graph-diff', '--before', before, '--after', out, '--json')
  expect(JSON.stringify(diff)).toContain('imports')
}, 30000)
