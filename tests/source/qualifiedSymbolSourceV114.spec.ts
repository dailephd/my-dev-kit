import { beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { allocateV114OutputDir } from '../helpers/v114OutputRoot.js'
import { runCli } from '../lookup/testCli.js'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.js'
import { buildCodeGraph } from '../../src/graph/buildCodeGraph.js'
import { AmbiguousSymbolError, resolveSymbolTarget } from '../../src/lookup/resolveSourceTarget.js'
import { getSourceSlice } from '../../src/lookup/getSourceSlice.js'
import type { SymbolIndex } from '../../src/symbol-index/types.js'

let root: string; let out: string; let index: SymbolIndex
const aId = 'symbolq:src%2Fsample.ts#class%3AA#run#0'
const bId = 'symbolq:src%2Fsample.ts#class%3AB#run#0'
beforeAll(async () => {
  root = allocateV114OutputDir('qualified-source-v114'); mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'sample.ts'), [
    'class A {', '  run() {', "    const a = 'alpha'", '    return a', '  }', '}',
    'class B {', '  run() {', "    const b = 'beta'", '    return b', '  }', '}', "const tail = 'adjacent'", '',
  ].join('\n'))
  await runIndexCommand({ root, src: ['src'], out: 'index' }); out = join(root, 'index')
  index = JSON.parse(readFileSync(join(out, 'symbol-index.json'), 'utf8'))
  index.files[0].symbols = [
    { name: 'run', kind: 'function', exported: false, location: { file: 'src/sample.ts', line: 2, endLine: 5 }, ownerKey: 'class:A', qualifiedName: 'A.run', nodeId: aId },
    { name: 'run', kind: 'function', exported: false, location: { file: 'src/sample.ts', line: 8, endLine: 11 }, ownerKey: 'class:B', qualifiedName: 'B.run', nodeId: bId },
  ]
  writeFileSync(join(out, 'symbol-index.json'), JSON.stringify(index))
  writeFileSync(join(out, 'code-graph.json'), JSON.stringify(buildCodeGraph({ symbolIndex: index })))
})

describe('v1.14 qualified source selection', () => {
  it('retrieves exactly the chosen method using independently specified node identity', () => {
    const result = runCli(['source', '--index', out, '--node', bId, '--json'])
    expect(result.status, result.stderr).toBe(0)
    const source = JSON.parse(result.stdout)
    expect(source).toMatchObject({ startLine: 8, endLine: 11, symbolName: 'run', lineCount: 4 })
    expect(source.content).toContain('beta')
    expect(source.content).not.toContain('alpha'); expect(source.content).not.toContain('adjacent')
    expect(source.continuationCursor).toBeUndefined()
  })
  it('retains exact identity in continuation and stops at the proven declaration end', () => {
    const first = runCli(['source', '--index', out, '--node', bId, '--max-lines', '2', '--json'])
    expect(first.status, first.stderr).toBe(0)
    expect(JSON.parse(first.stdout).continuationCursor).toMatchObject({ targetId: bId, nextStartLine: 10, symbolBoundaryKnown: true })
    const next = runCli(['source', '--index', out, '--node', bId, '--max-lines', '2', '--continue', '--json'])
    expect(next.status, next.stderr).toBe(0)
    expect(JSON.parse(next.stdout)).toMatchObject({ startLine: 10, endLine: 11, lineCount: 2 })
    expect(JSON.parse(next.stdout).content).not.toContain('adjacent')
    expect(JSON.parse(next.stdout).continuationCursor).toBeUndefined()
  })
  it('returns an explicit sorted ambiguity response and exit 2 for a simple-name request', () => {
    const result = runCli(['source', '--index', out, '--file', 'src/sample.ts', '--symbol', 'run', '--json'])
    expect(result.status).toBe(2)
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'error', code: 'AMBIGUOUS_SYMBOL', candidates: [
      { nodeId: aId, filePath: 'src/sample.ts', name: 'run', qualifiedName: 'A.run', ownerKey: 'class:A', startLine: 2, endLine: 5 },
      { nodeId: bId, filePath: 'src/sample.ts', name: 'run', qualifiedName: 'B.run', ownerKey: 'class:B', startLine: 8, endLine: 11 },
    ] })
    const plain = runCli(['source', '--index', out, '--file', 'src/sample.ts', '--symbol', 'run'])
    expect(plain.status).toBe(2); expect(plain.stderr).toContain(aId)
    const continuation = runCli(['source', '--index', out, '--file', 'src/sample.ts', '--symbol', 'run', '--continue-from', '3', '--json'])
    expect(continuation.status).toBe(2); expect(JSON.parse(continuation.stdout).code).toBe('AMBIGUOUS_SYMBOL')
  })
  it('caps ambiguity candidates at 20 and does not fabricate unknown end lines', () => {
    const many = { ...index, files: [{ ...index.files[0], symbols: Array.from({ length: 25 }, (_, i) => ({ ...index.files[0].symbols[0], nodeId: `symbolq:src%2Fsample.ts#owner${24-i}#run#0`, location: { file: 'src/sample.ts', line: i + 1 } })) }] }
    try { resolveSymbolTarget(many, 'src/sample.ts', 'run', 10); throw new Error('Expected ambiguity') } catch (error) {
      expect(error).toBeInstanceOf(AmbiguousSymbolError)
      const candidates = (error as AmbiguousSymbolError).candidates
      expect(candidates).toHaveLength(20)
      expect(candidates.map((c) => c.nodeId)).toEqual([...candidates.map((c) => c.nodeId)].sort((a, b) => a.localeCompare(b)))
      expect(candidates.every((c) => c.endLine === undefined)).toBe(true)
    }
  })
  it('retains unknown-boundary previews without claiming an exact end', () => {
    const unknown = { ...index, files: [{ ...index.files[0], symbols: [{ ...index.files[0].symbols[1], location: { file: 'src/sample.ts', line: 8 } }] }] }
    const target = resolveSymbolTarget(unknown, 'src/sample.ts', 'run', 2, bId)
    expect(target.symbolEndLine).toBeUndefined()
    const source = getSourceSlice({ indexDir: out, projectRoot: root, filePath: target.filePath, startLine: target.startLine!, endLine: target.endLine!, mode: 'symbol', maxLines: 2, symbolName: 'run', targetId: target.nodeId })
    expect(source.continuationCursor).toMatchObject({ symbolBoundaryKnown: false, reason: 'symbol-end-unknown', targetId: bId })
  })
  it('handles exact source bundles and rejects ambiguous bundle names', () => {
    const exact = runCli(['source', '--index', out, '--node', bId, '--include-local-deps', '--json'])
    expect(exact.status, exact.stderr).toBe(0)
    expect(exact.stdout).toContain('beta'); expect(exact.stdout).not.toContain('alpha'); expect(exact.stdout).not.toContain('adjacent')
    const ambiguous = runCli(['source', '--index', out, '--file', 'src/sample.ts', '--symbol', 'run', '--include-local-deps', '--json'])
    expect(ambiguous.status).toBe(2); expect(JSON.parse(ambiguous.stdout).code).toBe('AMBIGUOUS_SYMBOL')
  })
  it.each(['symbolq:broken', 'symbolq:src%2Fsample.ts#class%3AC#run#0'])('fails unknown or malformed node %s conservatively', (id) => {
    const result = runCli(['source', '--index', out, '--node', id, '--json'])
    expect(result.status).toBe(2); expect(result.stdout).not.toContain('"status": "ok"')
  })
  it('retains simple-name source behavior when only one declaration matches', () => {
    const single = { ...index, files: [{ ...index.files[0], symbols: [index.files[0].symbols[0]] }] }
    expect(resolveSymbolTarget(single, 'src/sample.ts', 'run', 160)).toMatchObject({ startLine: 2, endLine: 5, symbolEndLine: 5 })
  })
  it('keeps qualified nodes reachable through lookup, slice, view and context CLI paths', () => {
    const lookup = runCli(['lookup', '--index', out, '--node', bId, '--json'])
    expect(lookup.status, lookup.stderr).toBe(0); expect(JSON.parse(lookup.stdout).node.id).toBe(bId)
    const slice = runCli(['slice', '--index', out, '--node', bId, '--depth', '1', '--json'])
    expect(slice.status, slice.stderr).toBe(0); expect(JSON.parse(slice.stdout).nodes.some((n: { id: string }) => n.id === bId)).toBe(true)
    const viewPath = join(root, 'qualified.dot')
    const view = runCli(['view', '--index', out, '--graph', 'code', '--format', 'dot', '--out', viewPath, '--json'])
    expect(view.status, view.stderr).toBe(0); expect(readFileSync(viewPath, 'utf8')).toContain(bId)
    const context = runCli(['context', '--index', out, '--query', 'B.run', '--out', join(root, 'context.json'), '--audit-out', join(root, 'audit.json'), '--json'])
    expect(context.status, context.stderr).toBe(0); expect(context.stdout).toContain(bId)
  })
})
