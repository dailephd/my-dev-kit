import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from './testCli.js'

let outDir = ''

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'my-dev-kit-v1-source-'))
  const result = runCli(['index', '--root', 'examples/basic-ts', '--src', 'src', '--out', outDir])
  expect(result.status).toBe(0)
})

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

describe('source command', () => {
  it('retrieves a line range and prints valid JSON', () => {
    const result = runCli(['source', '--index', outDir, '--file', 'src/index.ts', '--start', '1', '--end', '4', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.mode).toBe('line-range')
    expect(parsed.content).toContain('describeUser')
  })

  it('enforces max-lines', () => {
    const result = runCli(['source', '--index', outDir, '--file', 'src/index.ts', '--start', '1', '--end', '3', '--max-lines', '2'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('exceeds --max-lines')
  })

  it('rejects invalid line range', () => {
    const result = runCli(['source', '--index', outDir, '--file', 'src/index.ts', '--start', '5', '--end', '1'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Start line must be less than or equal to end line.')
  })

  it('rejects path traversal outside project root', () => {
    const result = runCli(['source', '--index', outDir, '--file', '..\\secret.txt', '--start', '1', '--end', '1'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('escapes the indexed project root')
  })

  it('fails clearly for missing file', () => {
    const result = runCli(['source', '--index', outDir, '--file', 'src/missing.ts', '--start', '1', '--end', '1'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Source file does not exist')
  })

  it('retrieves by file node with capped preview warning', () => {
    const result = runCli(['source', '--index', outDir, '--node', 'file:src/index.ts', '--max-lines', '2', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.mode).toBe('node')
    expect(parsed.lineCount).toBe(2)
    expect(parsed.warnings[0]).toContain('capped preview')
  })

  it('retrieves by symbol using symbol location', () => {
    const result = runCli(['source', '--index', outDir, '--file', 'src/index.ts', '--symbol', 'describeUser', '--json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.symbolName).toBe('describeUser')
    expect(parsed.content).toContain('describeUser')
  })

  it('fails clearly for unresolved symbol', () => {
    const result = runCli(['source', '--index', outDir, '--file', 'src/index.ts', '--symbol', 'missingSymbol'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Symbol not found')
  })

  it('--format json prints parseable JSON', () => {
    const result = runCli(['source', '--index', outDir, '--file', 'src/index.ts', '--start', '1', '--end', '4', '--format', 'json'])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('ok')
    expect(parsed.content).toContain('describeUser')
  })

  it('--json with --format json works', () => {
    const result = runCli(['source', '--index', outDir, '--file', 'src/index.ts', '--start', '1', '--end', '4', '--json', '--format', 'json'])
    expect(result.status).toBe(0)
    expect(() => JSON.parse(result.stdout)).not.toThrow()
  })

  it('--format plain prints only source content', () => {
    const result = runCli(['source', '--index', outDir, '--file', 'src/index.ts', '--start', '1', '--end', '4', '--format', 'plain'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('describeUser')
    expect(result.stdout).not.toContain('"status"')
    expect(result.stdout).not.toContain('"mode"')
  })

  it('--format numbered prints numbered source content', () => {
    const result = runCli(['source', '--index', outDir, '--file', 'src/index.ts', '--start', '1', '--end', '4', '--format', 'numbered'])
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/1 \| /)
    expect(result.stdout).toContain('describeUser')
  })

  it('--json with --format plain fails clearly', () => {
    const result = runCli(['source', '--index', outDir, '--file', 'src/index.ts', '--start', '1', '--end', '4', '--json', '--format', 'plain'])
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/cannot be used together/i)
  })

  it('--json with --format numbered fails clearly', () => {
    const result = runCli(['source', '--index', outDir, '--file', 'src/index.ts', '--start', '1', '--end', '4', '--json', '--format', 'numbered'])
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/cannot be used together/i)
  })

  it('invalid --format fails clearly', () => {
    const result = runCli(['source', '--index', outDir, '--file', 'src/index.ts', '--start', '1', '--end', '4', '--format', 'fancy'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Unsupported --format value')
  })

  it('--out writes json output to file', () => {
    const dest = join(outDir, 'out', 'result.json')
    const result = runCli(['source', '--index', outDir, '--file', 'src/index.ts', '--start', '1', '--end', '4', '--format', 'json', '--out', dest])
    expect(result.status).toBe(0)
    expect(existsSync(dest)).toBe(true)
    const content = readFileSync(dest, 'utf8')
    expect(() => JSON.parse(content)).not.toThrow()
    expect(JSON.parse(content).content).toContain('describeUser')
  })

  it('--out writes plain output to file', () => {
    const dest = join(outDir, 'out', 'result.txt')
    const result = runCli(['source', '--index', outDir, '--file', 'src/index.ts', '--start', '1', '--end', '4', '--format', 'plain', '--out', dest])
    expect(result.status).toBe(0)
    expect(existsSync(dest)).toBe(true)
    const content = readFileSync(dest, 'utf8')
    expect(content).toContain('describeUser')
    expect(content).not.toContain('"status"')
  })

  it('--out writes numbered output to file', () => {
    const dest = join(outDir, 'out', 'result.numbered.txt')
    const result = runCli(['source', '--index', outDir, '--file', 'src/index.ts', '--start', '1', '--end', '4', '--format', 'numbered', '--out', dest])
    expect(result.status).toBe(0)
    expect(existsSync(dest)).toBe(true)
    const content = readFileSync(dest, 'utf8')
    expect(content).toMatch(/1 \| /)
  })

  it('--out creates parent directories automatically', () => {
    const dest = join(outDir, 'deep', 'nested', 'dir', 'result.txt')
    const result = runCli(['source', '--index', outDir, '--file', 'src/index.ts', '--start', '1', '--end', '2', '--format', 'plain', '--out', dest])
    expect(result.status).toBe(0)
    expect(existsSync(dest)).toBe(true)
  })
})
